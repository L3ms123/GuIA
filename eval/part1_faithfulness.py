"""Part 1 — LLM faithfulness to retrieved graph facts (driver + aggregation).

Per-question pipeline (verified against LLM_Call):
    1. retrieve(question, session_id=<unique uuid>)  -> rows | empty | error
    2. answer(question, session_id, graph_context)   -> guide answer (plain Cohere path)
    3. judge(question, rows, answer)                 -> {faithfulness, answered, verdict}
Plus a cheap cross-check: detect_dont_know(answer) vs the judge's `answered`.

The same unique session_id is reused across a single question's retrieve+answer
calls (covers SESSION_CONTEXTS cleanliness AND Cohere conversation_id isolation),
and is fresh per question so items never contaminate each other.

Run:
    python -m eval.part1_faithfulness            # full run (PART1_N items)
    python -m eval.part1_faithfulness --smoke    # ~6 items, wiring check
    python -m eval.part1_faithfulness --n 12     # custom size
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
import time
import traceback
import uuid
from collections import Counter
from datetime import datetime
from typing import Any, Optional

from . import config, question_bank
from ._bootstrap import preflight


# --- Question assembly ------------------------------------------------------
# A "spec" is a LANGUAGE-NEUTRAL question. It is sampled once, then rendered in
# each target language so all languages are tested on identical content. Fields:
#   id        stable identifier (bucket + category + subject), shared across langs
#   bucket    grounded | out_of_graph | near_miss
#   category  finer category (artist-of, ..., or the adversarial bucket name)
#   expected  known answer (grounded) or None (adversarial -> expect refusal)
#   title/artist/room   subject slots
#   _gt / _bank   the source object used to render the text per language

def render_spec(spec: dict[str, Any], lang: str) -> str:
    """Render a spec's question text in the target language."""
    gt_item = spec.get("_gt")
    if gt_item is not None:
        return gt_item.question_in(lang)
    bank_q = spec["_bank"]
    return bank_q.render(lang, title=spec.get("title", ""), artist=spec.get("artist", ""))


def build_question_set(counts: dict[str, int], rng: random.Random) -> list[dict[str, Any]]:
    """Assemble the language-neutral spec set deterministically (sampled once).

    Grounded specs carry their known expected value; adversarial specs expect a
    faithful refusal (expected=None). Each spec is later rendered per language.
    """
    from . import groundtruth as gt

    questions: list[dict[str, Any]] = []

    # --- Grounded: sample unique-title single-valued items, spread across the
    # four categories so we don't draw 15 artist-of questions by chance.
    grounded_pool: list[Any] = []
    title_fills: list[str] = []
    artist_fills: list[str] = []
    try:
        items, _ = gt.build_groundtruth()
        grounded_pool = gt.single_valued(items)
        title_fills = sorted({it.title for it in grounded_pool if it.title})
        artist_fills = sorted({it.artist for it in grounded_pool if it.artist})
    except Exception as exc:  # inventory unreadable -> grounded bucket degrades to 0
        # Surface LOUDLY: an empty grounded bucket guts the headline comparison
        # (grounded vs out-of-graph), so this must never pass silently.
        print(
            f"[eval] ERROR: could not build the grounded question set: "
            f"{type(exc).__name__}: {exc}\n"
            f"[eval]        The grounded bucket will be EMPTY — grounded-vs-empty "
            f"comparisons will be meaningless. Run `python -m eval.groundtruth --dump` to debug.",
            file=sys.stderr,
        )

    n_grounded = counts.get("grounded", 0)
    if n_grounded and not grounded_pool:
        print(
            "[eval] WARNING: grounded bucket requested "
            f"({n_grounded} items) but no grounded questions were built — "
            "every grounded slot is dropped.",
            file=sys.stderr,
        )
    if grounded_pool and n_grounded:
        by_cat = gt.by_category(grounded_pool)
        cats = [c for c in gt.SINGLE_VALUED if by_cat.get(c)]
        picked: list[Any] = []
        # round-robin across categories for a balanced grounded sample
        shuffled = {c: rng.sample(by_cat[c], len(by_cat[c])) for c in cats}
        idx = 0
        while len(picked) < n_grounded and any(shuffled.values()):
            c = cats[idx % len(cats)]
            if shuffled[c]:
                picked.append(shuffled[c].pop())
            idx += 1
        for it in picked[:n_grounded]:
            subject = it.title or it.room or it.artist
            questions.append({
                "id": f"grounded:{it.category}:{subject}",
                "bucket": "grounded",
                "category": it.category,
                "expected": it.expected,
                "title": it.title,
                "artist": it.artist,
                "room": it.room,
                "_gt": it,
            })

    # Fallbacks for slot filling if the grounded pool was empty.
    if not title_fills:
        title_fills = ["Davallament", "Sant Jeroni penitent"]
    if not artist_fills:
        artist_fills = ["Leone Leoni", "Perot Gascó"]

    # --- Adversarial buckets: sample probes, fill {title}/{artist} from real data.
    def add_bank(pool: list[question_bank.BankQuestion], bucket: str, n: int) -> None:
        if not n:
            return
        chosen = rng.sample(pool, min(n, len(pool)))
        for bq in chosen:
            title = rng.choice(title_fills) if bq.needs_title else ""
            artist = rng.choice(artist_fills) if bq.needs_artist else ""
            subject = title or artist or bq.key
            questions.append({
                "id": f"{bucket}:{bq.key}:{subject}",
                "bucket": bucket,
                "category": bq.category,
                "expected": None,
                "title": title,
                "artist": artist,
                "room": "",
                "_bank": bq,
            })

    add_bank(question_bank.OUT_OF_GRAPH, "out_of_graph", counts.get("out_of_graph", 0))
    add_bank(question_bank.NEAR_MISS, "near_miss", counts.get("near_miss", 0))

    rng.shuffle(questions)
    return questions


# --- Per-item execution -----------------------------------------------------
def run_item(spec: dict[str, Any], lang: str) -> dict[str, Any]:
    """Run one (spec, language) through retrieve -> answer -> judge. Never raises.

    The question is rendered in ``lang`` and the guide answers in ``lang``; the
    judge grades the answer against the (language-independent) rows.
    """
    # Imported lazily so build/--dump paths don't require a Cohere key.
    from . import judge as judge_mod
    from . import llm_bridge

    question = render_spec(spec, lang)
    session_id = f"eval_p1_{uuid.uuid4().hex}"
    # The record drops the internal _gt/_bank objects (not JSON-serializable) and
    # carries the rendered question + language instead.
    record: dict[str, Any] = {
        "id": spec.get("id"),
        "language": lang,
        "bucket": spec.get("bucket"),
        "category": spec.get("category"),
        "question": question,
        "expected": spec.get("expected"),
        "title": spec.get("title", ""),
        "artist": spec.get("artist", ""),
        "room": spec.get("room", ""),
        "session_id": session_id,
        "retrieval_class": None,
        "n_rows": None,
        "cypher": None,
        "rows": None,
        "answer": None,
        "faithfulness": None,
        "answered": None,
        "verdict": None,
        "judge_parse_failed": None,
        "judge_attempts": None,
        "dont_know": None,
        "dont_know_disagreement": None,
        "error": None,
        "error_stage": None,
    }

    try:
        result = llm_bridge.retrieve(question, session_id)
        record["retrieval_class"] = llm_bridge.classify_retrieval(result)
        rows = (result or {}).get("rows") or []
        record["n_rows"] = len(rows)
        record["cypher"] = (result or {}).get("cypher")
        record["rows"] = rows
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["error_stage"] = "retrieve"
        record["retrieval_class"] = "error"
        result, rows = None, []

    try:
        answer_text = llm_bridge.answer(question, session_id, result, language=lang)
        record["answer"] = answer_text
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["error_stage"] = "answer"
        return record  # cannot judge without an answer

    try:
        jr = judge_mod.judge(question, rows, answer_text)
        record.update({
            "faithfulness": jr.faithfulness,
            "answered": jr.answered,
            "verdict": jr.verdict,
            "judge_parse_failed": jr.parse_failed,
            "judge_attempts": jr.attempts,
        })
    except Exception as exc:  # noqa: BLE001
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["error_stage"] = "judge"
        return record

    # Cross-check: detect_dont_know is a refusal detector; answered==False is also
    # "refused". They should be inverses; flag disagreement as a cheap sanity signal.
    try:
        dk = llm_bridge.detect_dont_know(answer_text, lang)
        record["dont_know"] = dk
        if jr.answered is not None:
            record["dont_know_disagreement"] = (dk == jr.answered)
    except Exception:  # noqa: BLE001 — cross-check is best-effort
        pass

    return record


# --- Aggregation ------------------------------------------------------------
def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def _fmt(value: Optional[float]) -> str:
    """Compact fixed-width number for summary tables; '—' for None."""
    return "—" if value is None else f"{value:.2f}"


def _metrics_block(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute the full metric set over an arbitrary record subset.

    Reused for the overall summary, per-bucket, and per-language slices, so the
    numbers are computed identically everywhere.
    """
    n = len(records)
    judged = [r for r in records if r.get("verdict") is not None and not r.get("judge_parse_failed")]
    faithful_vals = [r["faithfulness"] for r in judged if isinstance(r.get("faithfulness"), (int, float))]
    verdict_dist = Counter(r["verdict"] for r in judged)
    retr = Counter(r.get("retrieval_class") for r in records)
    empty_judged = [r for r in judged if r.get("retrieval_class") == "empty"]
    empty_faithful = [r["faithfulness"] for r in empty_judged if isinstance(r.get("faithfulness"), (int, float))]

    return {
        "n_items": n,
        "n_judged": len(judged),
        "judge_parse_failures": sum(1 for r in records if r.get("judge_parse_failed")),
        "item_errors": sum(1 for r in records if r.get("error")),
        "mean_faithfulness": round(sum(faithful_vals) / len(faithful_vals), 4) if faithful_vals else None,
        "verdict_distribution": {str(k): verdict_dist.get(k, 0) for k in (1, 2, 3)},
        "hallucination_rate": _rate(verdict_dist.get(3, 0), len(judged)),
        "partial_rate": _rate(verdict_dist.get(2, 0), len(judged)),
        "refusal_rate": _rate(sum(1 for r in judged if r.get("answered") is False), len(judged)),
        "retrieval_empty_rate": _rate(retr.get("empty", 0), n),
        "retrieval_error_rate": _rate(retr.get("error", 0), n),
        "retrieval_hits_rate": _rate(retr.get("hits", 0), n),
        # Headline: does the guide invent when handed nothing?
        "mean_faithfulness__retrieval_empty": round(sum(empty_faithful) / len(empty_faithful), 4) if empty_faithful else None,
        "hallucination_rate__retrieval_empty": _rate(
            sum(1 for r in empty_judged if r["verdict"] == 3), len(empty_judged)
        ),
        "n_retrieval_empty_judged": len(empty_judged),
        "dont_know_disagreements": sum(1 for r in records if r.get("dont_know_disagreement") is True),
    }


def aggregate(records: list[dict[str, Any]]) -> dict[str, Any]:
    def bucket_block(bucket: str) -> dict[str, Any]:
        b = [r for r in records if r.get("bucket") == bucket]
        bj = [r for r in b if r.get("verdict") is not None and not r.get("judge_parse_failed")]
        bf = [r["faithfulness"] for r in bj if isinstance(r.get("faithfulness"), (int, float))]
        return {
            "n": len(b),
            "judged": len(bj),
            "mean_faithfulness": round(sum(bf) / len(bf), 4) if bf else None,
            "hallucination_rate": _rate(sum(1 for r in bj if r["verdict"] == 3), len(bj)),
            "refusal_rate": _rate(sum(1 for r in bj if r.get("answered") is False), len(bj)),
            "retrieval_empty_rate": _rate(sum(1 for r in b if r.get("retrieval_class") == "empty"), len(b)),
            "retrieval_error_rate": _rate(sum(1 for r in b if r.get("retrieval_class") == "error"), len(b)),
        }

    # Per-language slices (in the order languages appear in the records).
    langs: list[str] = []
    for r in records:
        lang = r.get("language")
        if lang and lang not in langs:
            langs.append(lang)
    by_language = {lang: _metrics_block([r for r in records if r.get("language") == lang]) for lang in langs}

    out = dict(_metrics_block(records))
    out["by_bucket"] = {b: bucket_block(b) for b in ("grounded", "out_of_graph", "near_miss")}
    out["by_language"] = by_language
    return out


# --- Output writers ---------------------------------------------------------
def _csv_row(r: dict[str, Any]) -> dict[str, Any]:
    expected = r.get("expected")
    if isinstance(expected, list):
        expected = "; ".join(map(str, expected))
    return {
        "language": r.get("language"),
        "bucket": r.get("bucket"),
        "category": r.get("category"),
        "id": r.get("id"),
        "question": r.get("question"),
        "expected": expected,
        "retrieval_class": r.get("retrieval_class"),
        "n_rows": r.get("n_rows"),
        "faithfulness": r.get("faithfulness"),
        "answered": r.get("answered"),
        "verdict": r.get("verdict"),
        "judge_parse_failed": r.get("judge_parse_failed"),
        "dont_know": r.get("dont_know"),
        "dont_know_disagreement": r.get("dont_know_disagreement"),
        "error": r.get("error"),
        "cypher": r.get("cypher"),
        "answer": (r.get("answer") or "").replace("\n", " ⏎ "),
    }


def write_outputs(records: list[dict[str, Any]], summary: dict[str, Any], run_config: dict[str, Any], ts: str) -> dict[str, str]:
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stem = config.RESULTS_DIR / f"part1_{ts}"

    json_path = f"{stem}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump({"config": run_config, "summary": summary, "items": records}, fh, ensure_ascii=False, indent=2)

    csv_path = f"{stem}.csv"
    fields = list(_csv_row(records[0]).keys()) if records else []
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for r in records:
            writer.writerow(_csv_row(r))

    txt_path = f"{stem}.summary.txt"
    with open(txt_path, "w", encoding="utf-8") as fh:
        fh.write(_render_summary(summary, run_config, records))

    return {"json": json_path, "csv": csv_path, "summary": txt_path}


def _render_summary(s: dict[str, Any], run_config: dict[str, Any], records: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    w = lines.append
    langs = run_config.get("languages") or list(s.get("by_language", {}).keys())
    w("=" * 78)
    w("GuIA Part 1 — LLM Faithfulness (multilingual)")
    w("=" * 78)
    w(f"Run timestamp : {run_config.get('timestamp')}")
    w(f"Judge model   : {run_config.get('judge_model')}  (temp={run_config.get('judge_temperature')}, seed={run_config.get('judge_seed')})")
    w(f"Languages     : {', '.join(langs)}   ({run_config.get('n_specs')} specs x {len(langs)} langs)")
    w(f"Items         : {s['n_items']}  (judged OK: {s['n_judged']}, parse failures: {s['judge_parse_failures']}, item errors: {s['item_errors']})")
    w("")
    w("CAVEAT: the judge is the same model family as the guide, so faithfulness")
    w("        is an OPTIMISTIC UPPER BOUND (self-grading is lenient).")
    w("")
    w("-" * 78)
    w("LANGUAGE COMPARISON  (same questions asked & answered in each language)")
    w("-" * 78)
    hdr = (f"  {'lang':<6}{'judged':>7}{'faith':>8}{'halluc':>8}{'partial':>8}"
           f"{'refusal':>9}{'empty':>7}{'error':>7}{'h|empty':>9}{'dkΔ':>6}")
    w(hdr)
    w("  " + "-" * (len(hdr) - 2))
    for lang in langs:
        b = s["by_language"].get(lang)
        if not b:
            continue
        w(f"  {lang:<6}{b['n_judged']:>7}{_fmt(b['mean_faithfulness']):>8}"
          f"{_fmt(b['hallucination_rate']):>8}{_fmt(b['partial_rate']):>8}"
          f"{_fmt(b['refusal_rate']):>9}{_fmt(b['retrieval_empty_rate']):>7}"
          f"{_fmt(b['retrieval_error_rate']):>7}{_fmt(b['hallucination_rate__retrieval_empty']):>9}"
          f"{b['dont_know_disagreements']:>6}")
    w("  (faith=mean faithfulness, halluc=verdict-3 rate, h|empty=hallucination when")
    w("   retrieval returned no rows — the headline invention test, dkΔ=don't-know mismatches)")
    w("")
    w("-" * 78)
    w("OVERALL (all languages pooled)")
    w("-" * 78)
    w(f"  mean_faithfulness        : {s['mean_faithfulness']}")
    w(f"  verdict distribution     : 1(faithful)={s['verdict_distribution']['1']}  "
      f"2(partial)={s['verdict_distribution']['2']}  3(fabrication)={s['verdict_distribution']['3']}")
    w(f"  hallucination_rate (v==3): {s['hallucination_rate']}")
    w(f"  refusal_rate (answered=F): {s['refusal_rate']}")
    w(f"  retrieval empty / error / hits : {s['retrieval_empty_rate']} / {s['retrieval_error_rate']} / {s['retrieval_hits_rate']}")
    w("")
    w("  HEADLINE — does the guide invent when retrieval returns NOTHING?")
    w(f"    items with empty rows (judged): {s['n_retrieval_empty_judged']}")
    w(f"    mean_faithfulness | empty      : {s['mean_faithfulness__retrieval_empty']}")
    w(f"    hallucination_rate | empty     : {s['hallucination_rate__retrieval_empty']}")
    w("")
    w("-" * 78)
    w("BY BUCKET (all languages pooled)")
    w("-" * 78)
    for bucket, b in s["by_bucket"].items():
        w(f"  {bucket:<12} n={b['n']:<3} judged={b['judged']:<3} "
          f"faith={_fmt(b['mean_faithfulness'])} halluc={_fmt(b['hallucination_rate'])} "
          f"refusal={_fmt(b['refusal_rate'])} empty={_fmt(b['retrieval_empty_rate'])} err={_fmt(b['retrieval_error_rate'])}")
    w("")
    w("-" * 78)
    w("WORST OFFENDERS (verdict == 3: fabrication)")
    w("-" * 78)
    offenders = [r for r in records if r.get("verdict") == 3]
    if not offenders:
        w("  (none)")
    for r in offenders[:15]:
        w(f"  [{r.get('language')}|{r.get('bucket')}/{r.get('category')}] {r.get('question')}")
        w(f"      retrieval={r.get('retrieval_class')} rows={r.get('n_rows')} faithfulness={r.get('faithfulness')}")
        ans = (r.get("answer") or "").strip().replace("\n", " ")
        w(f"      answer: {ans[:240]}{'...' if len(ans) > 240 else ''}")
    w("=" * 78)
    return "\n".join(lines) + "\n"


# --- Entry point ------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 1 — LLM faithfulness evaluation (multilingual).")
    parser.add_argument("--smoke", action="store_true", help="tiny run (~6 items/language) to check wiring")
    parser.add_argument("--n", type=int, default=None, help="items PER LANGUAGE (default PART1_N=30)")
    parser.add_argument("--seed", type=int, default=config.RANDOM_SEED, help="sampling seed")
    parser.add_argument("--lang", default=None,
                        help=f"comma-separated languages to run (default: {','.join(config.LANGUAGES)})")
    parser.add_argument("--dry-run", action="store_true", help="assemble & print the question set, make NO Cohere calls")
    args = parser.parse_args(argv)

    # Resolve languages (validate against the configured set).
    if args.lang:
        languages = [code.strip() for code in args.lang.split(",") if code.strip()]
        unknown = [c for c in languages if c not in config.LANGUAGE_NAMES]
        if unknown:
            print(f"[eval] Unknown language code(s): {unknown}. Known: {list(config.LANGUAGE_NAMES)}", file=sys.stderr)
            return 2
    else:
        languages = list(config.LANGUAGES)

    counts = config.bucket_counts(n=args.n, smoke=args.smoke)
    rng = random.Random(args.seed)
    specs = build_question_set(counts, rng)

    if args.dry_run:
        print(f"[eval] Assembled {len(specs)} specs x {len(languages)} languages "
              f"= {len(specs) * len(languages)} questions (no API calls):\n")
        for i, spec in enumerate(specs, 1):
            exp = spec["expected"]
            exp_s = f" -> expected: {exp!r}" if exp is not None else " -> expect faithful refusal"
            print(f"  {i:>2}. [{spec['bucket']}/{spec['category']}]{exp_s}")
            for lang in languages:
                print(f"        {lang}: {render_spec(spec, lang)}")
        print(f"\n  bucket counts requested (per language): {counts}")
        print(f"  languages: {languages}")
        return 0

    # Live run: validate env (Neo4j is a warning, not fatal — empty/error tracked).
    preflight(require_neo4j=False, warn_neo4j=True)

    # Importing the bridge installs 429-backoff over the shared Cohere client
    # (covers retrieve + answer + judge). Surface whether the global hook took.
    from . import llm_bridge
    if not llm_bridge.BACKOFF_INSTALLED:
        print(
            "[eval] NOTE: global Cohere backoff could not be installed; only the "
            "judge call is rate-limit protected. retrieve/answer 429s will error the item.",
            file=sys.stderr,
        )

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    # One (spec, language) pair = one item. Build the full work list up front.
    work = [(spec, lang) for lang in languages for spec in specs]
    run_config = {
        "timestamp": ts,
        "part": 1,
        "smoke": args.smoke,
        "seed": args.seed,
        "counts": counts,
        "languages": languages,
        "n_specs": len(specs),
        "n_questions": len(work),
        "judge_model": config.JUDGE_MODEL,
        "judge_temperature": config.JUDGE_TEMPERATURE,
        "judge_seed": config.JUDGE_SEED,
        "judge_retries": config.JUDGE_RETRIES,
        "request_sleep_s": config.REQUEST_SLEEP_S,
        "max_retries_429": config.MAX_RETRIES_429,
        "global_backoff_installed": llm_bridge.BACKOFF_INSTALLED,
    }

    print(f"[eval] Part 1 starting: {len(specs)} specs x {len(languages)} langs = {len(work)} questions, "
          f"judge={config.JUDGE_MODEL}, sleep={config.REQUEST_SLEEP_S}s, "
          f"backoff={'all' if llm_bridge.BACKOFF_INSTALLED else 'judge-only'}")
    records: list[dict[str, Any]] = []
    for i, (spec, lang) in enumerate(work, 1):
        preview = render_spec(spec, lang)[:64]
        print(f"[eval] ({i}/{len(work)}) [{lang}|{spec['bucket']}/{spec['category']}] {preview}", flush=True)
        try:
            record = run_item(spec, lang)
        except Exception as exc:  # noqa: BLE001 — absolute backstop; never abort the run
            record = {"id": spec.get("id"), "language": lang, "bucket": spec.get("bucket"),
                      "category": spec.get("category"), "error": f"UNCAUGHT {type(exc).__name__}: {exc}",
                      "error_stage": "run_item", "traceback": traceback.format_exc()}
        records.append(record)
        if record.get("error"):
            print(f"       ! error @ {record.get('error_stage')}: {record['error']}", file=sys.stderr)
        if i < len(work):
            time.sleep(config.REQUEST_SLEEP_S)

    summary = aggregate(records)
    paths = write_outputs(records, summary, run_config, ts)

    print("\n" + _render_summary(summary, run_config, records))
    print("[eval] Wrote:")
    for kind, path in paths.items():
        print(f"  {kind:<8}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
