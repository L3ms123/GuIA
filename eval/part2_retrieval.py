"""Part 2 — Retrieval recall (driver + aggregation).

The question Part 2 answers: for a question whose correct answer we already know
(from the Excel inventory), does ``retrieve_neo4j_context`` return rows that
*contain* that answer?

Per-item pipeline (verified against LLM_Call):
    1. render the ground-truth question in the target language
    2. retrieve(question, session_id=<unique>)   -> rows | empty | error
    3. match the known answer against the row values (normalization.match_*)
There is NO answer generation and NO judge here — this isolates retrieval from
the guide's phrasing. We pass only the question (no room/artwork hints) so we
test the pure question->Cypher path, not the artwork-fallback shortcut.

Multilingual by design (same as Part 1): the SAME sampled ground-truth items are
asked in en/es/ca, so per-language recall is directly comparable — it isolates
"does retrieval find the fact regardless of question language?" (the Cypher-gen
preamble explicitly expects Catalan titles even for Spanish/English questions —
LLM_Call:1884). The matcher is language-independent: it always matches against
the graph's (Catalan) row values, never the question text.

Determinism: retrieval has an LLM writing the Cypher, so a single run is not
bit-deterministic. ``--runs N`` (config.RETRIEVAL_RUNS) re-runs each question N
times and reports mean recall + hit-stability to *quantify* that variance
instead of pretending it is zero.

Run:
    python -m eval.part2_retrieval                 # full run, all languages
    python -m eval.part2_retrieval --smoke          # tiny wiring check
    python -m eval.part2_retrieval --lang en        # English only
    python -m eval.part2_retrieval --runs 3         # stability mode
    python -m eval.part2_retrieval --dry-run        # assemble questions, no API
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

from . import config, normalization
from ._bootstrap import preflight


# --- Question assembly ------------------------------------------------------
# A "spec" is a LANGUAGE-NEUTRAL ground-truth item (a GroundTruthItem). It is
# sampled once, then rendered + retrieved in each language so all languages are
# tested on identical content.

def build_question_set(
    per_category: int,
    multi_per_category: int,
    rng: random.Random,
) -> tuple[list[Any], list[Any], list[Any]]:
    """Sample (single_valued_specs, multi_valued_specs, skipped) deterministically.

    Single-valued items are balanced per category (artist/technique/location/
    dating) so recall is comparable across categories rather than dominated by
    whichever category happens to have the most artworks.
    """
    from . import groundtruth as gt

    items, skipped = gt.build_groundtruth()
    by_cat = gt.by_category(items)

    single: list[Any] = []
    for cat in gt.SINGLE_VALUED:
        pool = by_cat.get(cat, [])
        if not pool:
            continue
        single.extend(rng.sample(pool, min(per_category, len(pool))))

    multi: list[Any] = []
    for cat in gt.MULTI_VALUED:
        pool = by_cat.get(cat, [])
        if not pool:
            continue
        multi.extend(rng.sample(pool, min(multi_per_category, len(pool))))

    return single, multi, skipped


def _spec_record_base(it: Any, lang: str) -> dict[str, Any]:
    """The language-tagged, JSON-serializable skeleton for one (item, language)."""
    expected = it.expected
    return {
        "id": f"{it.category}:{(it.title or it.room or it.artist)}",
        "language": lang,
        "category": it.category,
        "multi_valued": it.multi_valued,
        "question": it.question_in(lang),
        "expected": expected,
        "expected_count": len(expected) if isinstance(expected, list) else None,
        "title": it.title,
        "room": it.room,
        "artist": it.artist,
    }


# --- Per-item execution -----------------------------------------------------
def _run_once(question: str, session_id: str, item: Any) -> dict[str, Any]:
    """One retrieval + match. Never raises; encodes a retrieval error as class 'error'."""
    from . import llm_bridge

    try:
        result = llm_bridge.retrieve(question, session_id)
    except Exception as exc:  # noqa: BLE001 — record, don't abort
        return {
            "retrieval_class": "error", "n_rows": 0, "cypher": None, "rows": [],
            "hit": False, "match_detail": f"retrieve raised: {type(exc).__name__}: {exc}",
            "micro_recall": None, "found": 0, "all_present": False, "missing": [],
            "error": f"{type(exc).__name__}: {exc}",
        }

    cls = llm_bridge.classify_retrieval(result)
    rows = (result or {}).get("rows") or []
    cypher = (result or {}).get("cypher")
    base = {"retrieval_class": cls, "n_rows": len(rows), "cypher": cypher, "rows": rows, "error": None}

    if item.multi_valued:
        expected = item.expected if isinstance(item.expected, list) else [item.expected]
        mm = normalization.match_multi(expected, rows)
        base.update({
            "hit": None, "match_detail": f"{mm.found}/{mm.total} titles present",
            "micro_recall": mm.micro_recall, "found": mm.found,
            "all_present": mm.all_present, "missing": mm.missing,
        })
    else:
        m = normalization.match_single(item.category, str(item.expected), rows)
        base.update({
            "hit": m.hit, "match_detail": m.detail,
            "micro_recall": None, "found": int(m.hit), "all_present": m.hit, "missing": [],
        })
    return base


def run_item(item: Any, lang: str, runs: int) -> dict[str, Any]:
    """Run one (item, language) through ``runs`` retrievals and collapse them.

    The representative run (run 0) supplies the displayed cypher/rows; hit_rate /
    stability are computed across all runs. A fresh session_id per run keeps
    SESSION_CONTEXTS and the Cohere conversation isolated between runs.
    """
    record = _spec_record_base(item, lang)
    sid_base = f"eval_p2_{uuid.uuid4().hex}"

    per_run: list[dict[str, Any]] = []
    for r in range(max(1, runs)):
        per_run.append(_run_once(record["question"], f"{sid_base}_r{r}", item))
        if r < runs - 1:
            time.sleep(config.REQUEST_SLEEP_S)

    rep = per_run[0]
    classes = [pr["retrieval_class"] for pr in per_run]

    record.update({
        "session_id": sid_base,
        "n_runs": len(per_run),
        "retrieval_class": rep["retrieval_class"],
        "retrieval_unstable": len(set(classes)) > 1,
        "n_rows": rep["n_rows"],
        "cypher": rep["cypher"],
        "rows": rep["rows"],
        "match_detail": rep["match_detail"],
        "error": rep["error"],
        "error_stage": "retrieve" if rep["error"] else None,
    })

    if item.multi_valued:
        recalls = [pr["micro_recall"] for pr in per_run if pr["micro_recall"] is not None]
        all_present_votes = [pr["all_present"] for pr in per_run]
        ap_rate = sum(all_present_votes) / len(all_present_votes)
        record.update({
            "hit": None,
            "micro_recall": round(sum(recalls) / len(recalls), 4) if recalls else None,
            "found": rep["found"],
            # Majority-or-tie vote, matching the single-valued `hit_rate >= 0.5`
            # rule so even-numbered --runs break ties identically across types.
            "all_present": ap_rate >= 0.5,
            "all_present_rate": round(ap_rate, 4),
            "missing": rep["missing"],
            "stable": len(set(all_present_votes)) == 1,
        })
    else:
        hits = [bool(pr["hit"]) for pr in per_run]
        hit_rate = sum(hits) / len(hits)
        majority_hit = hit_rate >= 0.5            # == the single run when runs==1
        record.update({
            "hit": majority_hit,
            "hit_rate": round(hit_rate, 4),
            "micro_recall": None,
            # Mirror the multi-valued fields so the CSV columns are uniform.
            "found": int(majority_hit),
            "all_present": majority_hit,
            "missing": [] if majority_hit else [str(item.expected)],
            "stable": len(set(hits)) == 1,
        })

    # Keep compact per-run traces (drop bulky rows) for stability triage.
    if runs > 1:
        record["runs"] = [
            {"retrieval_class": pr["retrieval_class"], "n_rows": pr["n_rows"],
             "hit": pr["hit"], "micro_recall": pr["micro_recall"], "cypher": pr["cypher"]}
            for pr in per_run
        ]
    return record


# --- Aggregation ------------------------------------------------------------
def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def _fmt(value: Optional[float]) -> str:
    return "—" if value is None else f"{value:.2f}"


def _metrics_block(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Full metric set over an arbitrary record subset (reused for overall / per
    language / per category) so the numbers are computed identically everywhere."""
    single = [r for r in records if not r.get("multi_valued")]
    multi = [r for r in records if r.get("multi_valued")]

    # Recall denominators are single-valued only (hit/miss is defined for them).
    s_err = sum(1 for r in single if r.get("retrieval_class") == "error")
    s_hit = sum(1 for r in single if r.get("hit") is True)
    s_ran = len(single) - s_err  # single-valued questions where retrieval executed

    # Retrieval HEALTH is independent of scoring, so it spans ALL records in the
    # slice: multi-valued questions retrieve too. (Without this, the per-category
    # table would always print '—' for the two multi-valued categories.)
    all_err = sum(1 for r in records if r.get("retrieval_class") == "error")
    all_empty = sum(1 for r in records if r.get("retrieval_class") == "empty")
    all_hits_cls = sum(1 for r in records if r.get("retrieval_class") == "hits")

    total_expected = sum(int(r.get("expected_count") or 0) for r in multi)
    total_found = sum(int(r.get("found") or 0) for r in multi)
    all_present = sum(1 for r in multi if r.get("all_present") is True)

    # Stability (only meaningful when runs>1; harmless otherwise).
    single_stable = [r for r in single if r.get("stable") is not None]
    hit_rates = [r.get("hit_rate") for r in single if isinstance(r.get("hit_rate"), (int, float))]

    return {
        "n_items": len(records),
        "n_single": len(single),
        "n_multi": len(multi),
        "item_errors": sum(1 for r in records if r.get("error")),
        # --- single-valued recall (the headline) ---
        "single_hits": s_hit,
        "retrieval_recall": _rate(s_hit, len(single)),               # hits / all single-valued
        "retrieval_recall_excl_error": _rate(s_hit, s_ran),          # hits / where it ran
        # --- retrieval health (over all items in the slice) ---
        "retrieval_empty_rate": _rate(all_empty, len(records)),
        "retrieval_error_rate": _rate(all_err, len(records)),
        "retrieval_hits_class_rate": _rate(all_hits_cls, len(records)),
        # --- multi-valued ---
        "multi_micro_recall": _rate(total_found, total_expected),    # pooled titles found
        "multi_all_present_rate": _rate(all_present, len(multi)),
        "multi_total_expected": total_expected,
        "multi_total_found": total_found,
        # --- stability (runs>1) ---
        "mean_hit_rate": round(sum(hit_rates) / len(hit_rates), 4) if hit_rates else None,
        "hit_stability_rate": _rate(sum(1 for r in single_stable if r.get("stable")), len(single_stable)),
    }


def aggregate(records: list[dict[str, Any]], skipped: list[Any]) -> dict[str, Any]:
    cats = []
    for r in records:
        c = r.get("category")
        if c and c not in cats:
            cats.append(c)

    def cat_block(cat: str) -> dict[str, Any]:
        sub = [r for r in records if r.get("category") == cat]
        block = _metrics_block(sub)
        block["multi_valued"] = bool(sub and sub[0].get("multi_valued"))
        return block

    langs: list[str] = []
    for r in records:
        lang = r.get("language")
        if lang and lang not in langs:
            langs.append(lang)

    out = dict(_metrics_block(records))
    out["by_category"] = {c: cat_block(c) for c in cats}
    out["by_language"] = {lang: _metrics_block([r for r in records if r.get("language") == lang]) for lang in langs}
    skip_reasons = Counter(s.reason for s in skipped)
    out["skipped"] = {"total": len(skipped), "reasons": dict(skip_reasons)}
    return out


# --- Output writers ---------------------------------------------------------
def _csv_row(r: dict[str, Any]) -> dict[str, Any]:
    expected = r.get("expected")
    if isinstance(expected, list):
        expected = "; ".join(map(str, expected))
    missing = r.get("missing") or []
    return {
        "language": r.get("language"),
        "category": r.get("category"),
        "multi_valued": r.get("multi_valued"),
        "id": r.get("id"),
        "question": r.get("question"),
        "expected": expected,
        "retrieval_class": r.get("retrieval_class"),
        "n_rows": r.get("n_rows"),
        "hit": r.get("hit"),
        "hit_rate": r.get("hit_rate"),
        "micro_recall": r.get("micro_recall"),
        "found": r.get("found"),
        "expected_count": r.get("expected_count"),
        "all_present": r.get("all_present"),
        "missing": "; ".join(map(str, missing)),
        "stable": r.get("stable"),
        "match_detail": r.get("match_detail"),
        "error": r.get("error"),
        "cypher": (r.get("cypher") or "").replace("\n", " "),
    }


def write_outputs(records: list[dict[str, Any]], summary: dict[str, Any], run_config: dict[str, Any], ts: str) -> dict[str, str]:
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stem = config.RESULTS_DIR / f"part2_{ts}"

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
    runs = run_config.get("retrieval_runs", 1)
    w("=" * 80)
    w("GuIA Part 2 — Retrieval Recall (multilingual)")
    w("=" * 80)
    w(f"Run timestamp : {run_config.get('timestamp')}")
    w(f"Languages     : {', '.join(langs)}   ({run_config.get('n_specs')} specs x {len(langs)} langs)")
    w(f"Retrieval runs: {runs}  ({'single pass' if runs == 1 else 'stability mode'})")
    w(f"Items         : {s['n_items']}  (single-valued: {s['n_single']}, multi-valued: {s['n_multi']}, "
      f"item errors: {s['item_errors']})")
    w("")
    w("WHAT THIS MEASURES: of questions whose answer we know from the Excel")
    w("inventory, how often retrieval returned rows that CONTAIN that answer.")
    w("Faithful != correct (Part 1); this is whether the right fact was fetched.")
    w("")
    w("-" * 80)
    w("HEADLINE — single-valued recall (all languages pooled)")
    w("-" * 80)
    w(f"  retrieval_recall              : {s['retrieval_recall']}   (hits / all {s['n_single']} single-valued)")
    w(f"  retrieval_recall_excl_error   : {s['retrieval_recall_excl_error']}   (hits / where retrieval actually ran)")
    w(f"  retrieval empty / error / hits: {s['retrieval_empty_rate']} / {s['retrieval_error_rate']} / {s['retrieval_hits_class_rate']}")
    if s['retrieval_error_rate'] and s['retrieval_error_rate'] > 0.5:
        w("  ⚠ HIGH error rate — usually Neo4j is unconfigured/unreachable, which caps")
        w("    raw recall at ~0. Check NEO4J_* env; recall_excl_error isolates Cypher quality.")
    if runs > 1:
        w(f"  mean_hit_rate (over {runs} runs)   : {s['mean_hit_rate']}")
        w(f"  hit_stability_rate            : {s['hit_stability_rate']}   (questions where all {runs} runs agreed)")
    w("")
    w("-" * 80)
    w("MULTI-VALUED (artworks-in-room / works-by-artist)")
    w("-" * 80)
    w(f"  micro_recall (pooled titles)  : {s['multi_micro_recall']}   "
      f"({s['multi_total_found']}/{s['multi_total_expected']} expected titles found)")
    w(f"  all_present_rate              : {s['multi_all_present_rate']}   "
      f"(questions where EVERY expected title was returned)")
    w("")
    w("-" * 80)
    w("RECALL BY LANGUAGE  (same questions asked in each language)")
    w("-" * 80)
    hdr = (f"  {'lang':<6}{'single':>7}{'recall':>8}{'r|ran':>8}{'empty':>7}{'error':>7}"
           f"{'multiμR':>9}{'allPres':>9}")
    w(hdr)
    w("  " + "-" * (len(hdr) - 2))
    for lang in langs:
        b = s["by_language"].get(lang)
        if not b:
            continue
        w(f"  {lang:<6}{b['n_single']:>7}{_fmt(b['retrieval_recall']):>8}"
          f"{_fmt(b['retrieval_recall_excl_error']):>8}{_fmt(b['retrieval_empty_rate']):>7}"
          f"{_fmt(b['retrieval_error_rate']):>7}{_fmt(b['multi_micro_recall']):>9}"
          f"{_fmt(b['multi_all_present_rate']):>9}")
    w("  (recall=hits/all, r|ran=hits where retrieval ran, multiμR=multi micro-recall)")
    w("")
    w("-" * 80)
    w("RECALL BY CATEGORY (all languages pooled)")
    w("-" * 80)
    for cat, b in s["by_category"].items():
        if b.get("multi_valued"):
            w(f"  {cat:<18} n={b['n_multi']:<3} micro_recall={_fmt(b['multi_micro_recall'])} "
              f"all_present={_fmt(b['multi_all_present_rate'])} "
              f"empty={_fmt(b['retrieval_empty_rate'])} err={_fmt(b['retrieval_error_rate'])}")
        else:
            w(f"  {cat:<18} n={b['n_single']:<3} recall={_fmt(b['retrieval_recall'])} "
              f"r|ran={_fmt(b['retrieval_recall_excl_error'])} "
              f"empty={_fmt(b['retrieval_empty_rate'])} err={_fmt(b['retrieval_error_rate'])}")
    sk = s.get("skipped", {})
    if sk.get("total"):
        w("")
        w(f"  ground-truth skipped: {sk['total']}  reasons={sk.get('reasons')}")
    w("")
    w("-" * 80)
    w("MISSES — single-valued, with the generated Cypher (usual root cause)")
    w("-" * 80)
    misses = [r for r in records if not r.get("multi_valued") and r.get("hit") is not True]
    if not misses:
        w("  (none)")
    for r in misses[:20]:
        w(f"  [{r.get('language')}|{r.get('category')}] {r.get('question')}")
        exp = r.get("expected")
        w(f"      expected={exp!r}  retrieval={r.get('retrieval_class')} rows={r.get('n_rows')}  ({r.get('match_detail')})")
        cy = (r.get("cypher") or "").strip().replace("\n", " ")
        w(f"      cypher: {cy[:300]}{'...' if len(cy) > 300 else ''}" if cy else "      cypher: (none — retrieval returned None/error)")
    if len(misses) > 20:
        w(f"  ... and {len(misses) - 20} more (see CSV; filter hit==False)")
    w("=" * 80)
    return "\n".join(lines) + "\n"


# --- Entry point ------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 2 — Retrieval recall evaluation (multilingual).")
    parser.add_argument("--smoke", action="store_true", help="tiny run (~2/category/language) to check wiring")
    parser.add_argument("--per-category", type=int, default=None,
                        help=f"single-valued items per category (default {config.PART2_PER_CATEGORY})")
    parser.add_argument("--multi", type=int, default=None,
                        help=f"multi-valued items per category (default {config.PART2_MULTI_PER_CATEGORY})")
    parser.add_argument("--runs", type=int, default=None,
                        help=f"retrievals per question for stability (default {config.RETRIEVAL_RUNS})")
    parser.add_argument("--seed", type=int, default=config.RANDOM_SEED, help="sampling seed")
    parser.add_argument("--lang", default=None,
                        help=f"comma-separated languages (default: {','.join(config.LANGUAGES)})")
    parser.add_argument("--dry-run", action="store_true", help="assemble & print the question set, make NO Cohere calls")
    args = parser.parse_args(argv)

    if args.lang:
        languages = [code.strip() for code in args.lang.split(",") if code.strip()]
        unknown = [c for c in languages if c not in config.LANGUAGE_NAMES]
        if unknown:
            print(f"[eval] Unknown language code(s): {unknown}. Known: {list(config.LANGUAGE_NAMES)}", file=sys.stderr)
            return 2
    else:
        languages = list(config.LANGUAGES)

    if args.smoke:
        per_category = config.SMOKE_PART2_PER_CATEGORY
        multi_per_category = config.SMOKE_PART2_MULTI_PER_CATEGORY
    else:
        per_category = args.per_category if args.per_category is not None else config.PART2_PER_CATEGORY
        multi_per_category = args.multi if args.multi is not None else config.PART2_MULTI_PER_CATEGORY
    runs = args.runs if args.runs is not None else config.RETRIEVAL_RUNS

    rng = random.Random(args.seed)
    try:
        single_specs, multi_specs, skipped = build_question_set(per_category, multi_per_category, rng)
    except Exception as exc:  # noqa: BLE001
        print(f"[eval] ERROR: could not build the ground-truth set: {type(exc).__name__}: {exc}\n"
              f"[eval]        Run `python -m eval.groundtruth --dump` to debug.", file=sys.stderr)
        return 2
    specs = single_specs + multi_specs

    if not specs:
        print("[eval] ERROR: no ground-truth questions were built — nothing to evaluate.\n"
              "[eval]        Run `python -m eval.groundtruth --dump` to inspect the inventory.", file=sys.stderr)
        return 2

    if args.dry_run:
        print(f"[eval] Assembled {len(specs)} specs x {len(languages)} languages "
              f"= {len(specs) * len(languages)} questions "
              f"({len(single_specs)} single-valued, {len(multi_specs)} multi-valued; no API calls):\n")
        for i, it in enumerate(specs, 1):
            exp = it.expected
            exp_s = (f"{len(exp)} titles" if isinstance(exp, list) else repr(exp))
            print(f"  {i:>2}. [{it.category}] expected: {exp_s}")
            for lang in languages:
                print(f"        {lang}: {it.question_in(lang)}")
        print(f"\n  single-valued per category: {per_category}   multi per category: {multi_per_category}")
        print(f"  languages: {languages}   runs/question: {runs}")
        if skipped:
            print(f"  ground-truth skipped: {len(skipped)} ({Counter(s.reason for s in skipped)})")
        return 0

    # Live run. Neo4j is a warning (not fatal) so a misconfigured run still
    # completes and the retrieval_error_rate metric makes the misconfig explicit.
    preflight(require_neo4j=False, warn_neo4j=True)

    from . import llm_bridge
    if not llm_bridge.BACKOFF_INSTALLED:
        print("[eval] NOTE: global Cohere backoff could not be installed; Cypher-gen 429s "
              "will error the item rather than retry.", file=sys.stderr)
    if not llm_bridge.neo4j_is_configured():
        print("[eval] NOTE: Neo4j not configured — every retrieval will be a retrieval_error "
              "(recall will read 0; that's the misconfig, not the matcher).", file=sys.stderr)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    work = [(it, lang) for lang in languages for it in specs]
    run_config = {
        "timestamp": ts,
        "part": 2,
        "smoke": args.smoke,
        "seed": args.seed,
        "per_category": per_category,
        "multi_per_category": multi_per_category,
        "retrieval_runs": runs,
        "languages": languages,
        "n_specs": len(specs),
        "n_single_specs": len(single_specs),
        "n_multi_specs": len(multi_specs),
        "n_questions": len(work),
        "request_sleep_s": config.REQUEST_SLEEP_S,
        "max_retries_429": config.MAX_RETRIES_429,
        "global_backoff_installed": llm_bridge.BACKOFF_INSTALLED,
        "neo4j_configured": llm_bridge.neo4j_is_configured(),
    }

    print(f"[eval] Part 2 starting: {len(specs)} specs x {len(languages)} langs = {len(work)} questions "
          f"x {runs} run(s), sleep={config.REQUEST_SLEEP_S}s, "
          f"backoff={'all' if llm_bridge.BACKOFF_INSTALLED else 'none'}")
    records: list[dict[str, Any]] = []
    for i, (it, lang) in enumerate(work, 1):
        preview = it.question_in(lang)[:64]
        print(f"[eval] ({i}/{len(work)}) [{lang}|{it.category}] {preview}", flush=True)
        try:
            record = run_item(it, lang, runs)
        except Exception as exc:  # noqa: BLE001 — absolute backstop; never abort the run
            # Class it as a retrieval error so it lands in retrieval_error_rate
            # (and out of recall_excl_error's denominator) rather than being
            # silently scored as "ran and missed".
            record = {"id": f"{it.category}", "language": lang, "category": it.category,
                      "multi_valued": it.multi_valued, "question": it.question_in(lang),
                      "retrieval_class": "error", "hit": None,
                      "error": f"UNCAUGHT {type(exc).__name__}: {exc}", "error_stage": "run_item",
                      "traceback": traceback.format_exc()}
        records.append(record)
        if record.get("error"):
            print(f"       ! error @ {record.get('error_stage')}: {record['error']}", file=sys.stderr)
        else:
            verdict = (f"hit={record.get('hit')}" if not record.get("multi_valued")
                       else f"micro_recall={record.get('micro_recall')}")
            print(f"       -> retrieval={record.get('retrieval_class')} rows={record.get('n_rows')} {verdict}")
        # Spacing between items (runs already sleep internally between their own runs).
        if i < len(work):
            time.sleep(config.REQUEST_SLEEP_S)

    summary = aggregate(records, skipped)
    paths = write_outputs(records, summary, run_config, ts)

    print("\n" + _render_summary(summary, run_config, records))
    print("[eval] Wrote:")
    for kind, path in paths.items():
        print(f"  {kind:<8}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
