"""Part 4 — Prompt Sensitivity (driver + aggregation).

The question Part 4 answers: GuIA personalizes by PROMPTING (persona, age, the
few-shot examples, the order of the RAG block are all prompt choices). So — how
much does the guide's ANSWER change when we change the prompt, and is that change
SIGNAL or NOISE? Inspired by "The Prompt Report: A Systematic Survey of Prompting
Techniques", which warns that output varies with wording, few-shot example order,
and the position of the context block (RAG before vs after the rules).

Two axis KINDS, one metric, opposite readings:
  * ROBUSTNESS axes (few-shot on/off, RAG-block position) are fact-neutral — the
    answer SHOULD NOT move. We want the sensitivity ratio ~= 1.
  * SEMANTIC axes (persona explorer->scholar; age) are the personalization test —
    the answer SHOULD move. We want the ratio >> 1.

The method (why "mean and variance, not a single run"):
  1. FREEZE RETRIEVAL. Retrieve once per (question, language) and reuse those exact
     rows for every variant and every repeat. Retrieval is itself nondeterministic
     (an LLM writes the Cypher), so freezing it removes it as a confound — the only
     thing that varies downstream is the prompt.
  2. Generate each variant R times (--runs, default PROMPT_RUNS). We do NOT pin the
     answer temperature: that run-to-run sampling variance IS the NOISE FLOOR we
     measure the prompt effect against (contrast the judge/classifier, which pin
     temp=0 because they are graders).
  3. within-variant divergence (noise) = mean±std pairwise divergence among a
     variant's R repeats. between-variant divergence (signal) = mean±std over the
     R×R cross pairs between a treatment and the baseline.
  4. sensitivity ratio = between / within_pooled  (effect size vs noise).

Surface-only metric (divergence.py): token Jaccard (primary), cosine, length
ratio, readability deltas. No judge call — Part 4 asks "did it move, vs noise?",
a stability question a deterministic surface metric answers for free. Caveat: a
faithful paraphrase still scores "divergent" (surface != semantics); the
most-divergent offenders carry answer snippets so a human can adjudicate.

Run:
    python -m eval.part4_prompt_sensitivity                 # full, all langs
    python -m eval.part4_prompt_sensitivity --smoke          # tiny wiring check
    python -m eval.part4_prompt_sensitivity --lang en        # English only
    python -m eval.part4_prompt_sensitivity --axes fewshot   # one axis (cheaper)
    python -m eval.part4_prompt_sensitivity --dry-run --smoke # assemble, no API
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
import sys
import time
import traceback
import uuid
from datetime import datetime
from itertools import combinations, product
from typing import Any, Optional

from . import config, divergence, prompt_variants
from ._bootstrap import preflight


# --- Question assembly ------------------------------------------------------
def build_question_set(n: int, rng: random.Random) -> list[Any]:
    """Sample ``n`` grounded single-valued items, balanced round-robin across the
    four single-valued categories (artist/technique/location/dating).

    Grounded single-valued items have a known stored answer, so retrieval reliably
    returns rows — and the rag_position axis is meaningless without rows. Sampling
    is deterministic under the seed (the groundtruth order is stable)."""
    from . import groundtruth as gt

    items, _ = gt.build_groundtruth()
    by_cat = gt.by_category(items)

    # Shuffle each category pool once, then round-robin draw until we have n.
    pools: dict[str, list[Any]] = {}
    for cat in gt.SINGLE_VALUED:
        pool = list(by_cat.get(cat, []))
        rng.shuffle(pool)
        pools[cat] = pool

    chosen: list[Any] = []
    cats = [c for c in gt.SINGLE_VALUED if pools.get(c)]
    while len(chosen) < n and cats:
        for cat in list(cats):
            if pools[cat]:
                chosen.append(pools[cat].pop())
                if len(chosen) >= n:
                    break
            else:
                cats.remove(cat)
    return chosen


# --- Divergence helpers -----------------------------------------------------
def _pairwise(answers: list[str], metric: str = "jaccard") -> list[float]:
    """All unordered within-set pairwise distances for one metric (the noise floor
    when ``answers`` are repeats of the same variant)."""
    return [divergence.divergence(a, b)[metric] for a, b in combinations(answers, 2)]


def _cross(a_runs: list[str], b_runs: list[str], metric: str = "jaccard") -> list[float]:
    """All R×R cross distances between two variants' run sets (the between signal).

    Run indices are arbitrary (no shared seed, temperature unpinned), so the full
    cross product is the unbiased estimator of E[divergence(a, b)] rather than an
    arbitrary 1:1 run pairing."""
    return [divergence.divergence(a, b)[metric] for a, b in product(a_runs, b_runs)]


def _stat(values: list[float]) -> tuple[Optional[float], Optional[float]]:
    """(mean, population-std) of a value list, rounded; (None, None) if empty.

    pstdev (not stdev) because we enumerate the FULL set of pairwise samples, not a
    sample drawn from a larger population — the spread of exactly these pairs."""
    if not values:
        return None, None
    mean = round(statistics.fmean(values), 6)
    std = round(statistics.pstdev(values), 6) if len(values) > 1 else 0.0
    return mean, std


def _cross_companions(a_runs: list[str], b_runs: list[str]) -> dict[str, Optional[float]]:
    """Mean of the corroborating surface signals over the R×R cross pairs."""
    pairs = [divergence.divergence(a, b) for a, b in product(a_runs, b_runs)]
    if not pairs:
        return {"cosine_between_mean": None, "length_ratio_mean": None,
                "awps_delta_mean": None, "acpw_delta_mean": None}
    def m(key: str) -> float:
        return round(statistics.fmean([p[key] for p in pairs]), 6)
    return {
        "cosine_between_mean": m("cosine"),
        "length_ratio_mean": m("length_ratio"),
        "awps_delta_mean": m("awps_delta"),
        "acpw_delta_mean": m("acpw_delta"),
    }


# --- Per-item execution -----------------------------------------------------
def run_item(item: Any, lang: str, axes: list[prompt_variants.Axis], runs: int) -> dict[str, Any]:
    """Run one (item, language): freeze retrieval, generate every variant R times,
    compute within/between divergence and the sensitivity ratio per axis.

    Never raises; each Cohere call is wrapped so a failure is recorded with its
    ``error_stage`` and the run continues (Part 2/3 discipline)."""
    from . import llm_bridge  # lazy import so --dry-run needs no Cohere key

    question = item.question_in(lang)
    sid = f"eval_p4_{uuid.uuid4().hex}"

    record: dict[str, Any] = {
        "id": f"{item.category}:{(item.title or item.room or item.artist)}",
        "language": lang,
        "category": item.category,
        "title": item.title,
        "room": item.room,
        "artist": item.artist,
        "expected": item.expected,
        "question": question,
        "frozen": True,
        "runs": runs,
        "retrieval_class": None,
        "n_rows": 0,
        "cypher": None,
        "variants": {},
        "axes": {},
        "error": None,
        "error_stage": None,
    }

    # 1. FREEZE retrieval once. None/empty rows are handled per-axis below.
    try:
        result = llm_bridge.retrieve(question, sid)
    except Exception as exc:  # noqa: BLE001 — record, don't abort
        record["error"] = f"{type(exc).__name__}: {exc}"
        record["error_stage"] = "retrieve"
        record["retrieval_class"] = "error"
        result = None
    if record["error_stage"] != "retrieve":
        record["retrieval_class"] = llm_bridge.classify_retrieval(result)
        record["cypher"] = (result or {}).get("cypher")
        record["n_rows"] = len((result or {}).get("rows") or [])
    # Reuse the frozen result verbatim (it is None on error, a dict with rows
    # otherwise — exactly what build_prompt expects). The product would feed the
    # same graph_context, so this is faithful. rag_position only makes sense when
    # rows are actually present (see below).
    frozen_gc = result
    has_rows = record["retrieval_class"] == "hits"

    # 2. Build the variant set (shared baseline + one treatment per axis).
    variants = prompt_variants.variants_for(axes)

    # 3. Generate each variant R times, reusing the frozen graph context.
    answers: dict[str, list[str]] = {}
    for vname, params in variants:
        prompt = prompt_variants.build_prompt(language=lang, graph_context=frozen_gc, **params)
        runs_out: list[str] = []
        for r in range(max(1, runs)):
            try:
                ans = llm_bridge.answer_with_prompt(prompt, question)
            except Exception as exc:  # noqa: BLE001
                record["error"] = f"{type(exc).__name__}: {exc}"
                record["error_stage"] = f"answer:{vname}"
                ans = ""
            runs_out.append(ans)
            time.sleep(config.REQUEST_SLEEP_S)
        answers[vname] = runs_out
        wmean, wstd = _stat(_pairwise(runs_out))
        record["variants"][vname] = {
            "answers": runs_out,
            "within_mean": wmean,
            "within_std": wstd,
        }

    # 4. Per-axis between/within/ratio.
    base_runs = answers.get(prompt_variants.BASELINE_NAME, [])
    base_within, _ = _stat(_pairwise(base_runs))
    for ax in axes:
        # rag_position is a no-op without rows — moving an empty/absent RAG block
        # cannot change the answer, so excluding it keeps the signal honest.
        if ax.key == "rag_position" and not has_rows:
            record["axes"][ax.key] = {"kind": ax.kind, "excluded": "no_rows"}
            continue
        treat_runs = answers.get(ax.treatment.name, [])
        between_vals = _cross(treat_runs, base_runs)
        between_mean, between_std = _stat(between_vals)
        treat_within, _ = _stat(_pairwise(treat_runs))
        # Pool the noise floor over BOTH sides so a noisier treatment doesn't
        # inflate the ratio. Falls back to whichever side is available.
        within_parts = [v for v in (base_within, treat_within) if v is not None]
        within_pooled = round(statistics.fmean(within_parts), 6) if within_parts else None
        ratio = None
        if between_mean is not None and within_pooled not in (None, 0.0):
            ratio = round(between_mean / within_pooled, 4)
        entry = {
            "kind": ax.kind,
            "between_mean": between_mean,
            "between_std": between_std,
            "within_baseline_mean": base_within,
            "within_treatment_mean": treat_within,
            "within_pooled": within_pooled,
            "ratio": ratio,
        }
        entry.update(_cross_companions(treat_runs, base_runs))
        record["axes"][ax.key] = entry

    return record


# --- Aggregation ------------------------------------------------------------
def _rate(num: int, den: int) -> Optional[float]:
    return round(num / den, 4) if den else None


def _fmt(value: Optional[float]) -> str:
    return "—" if value is None else f"{value:.3f}"


def _axis_block(records: list[dict[str, Any]], axis_key: str) -> dict[str, Any]:
    """Aggregate one axis over a record subset (reused for overall / per language)."""
    entries = [r["axes"].get(axis_key) for r in records if axis_key in r.get("axes", {})]
    entries = [e for e in entries if e]
    scored = [e for e in entries if e.get("ratio") is not None]
    excluded = [e for e in entries if e.get("excluded")]

    betweens = [e["between_mean"] for e in entries if isinstance(e.get("between_mean"), (int, float))]
    withins = [e["within_pooled"] for e in entries if isinstance(e.get("within_pooled"), (int, float))]
    ratios = [e["ratio"] for e in scored]
    cosines = [e["cosine_between_mean"] for e in entries if isinstance(e.get("cosine_between_mean"), (int, float))]
    lrs = [e["length_ratio_mean"] for e in entries if isinstance(e.get("length_ratio_mean"), (int, float))]
    awps = [e["awps_delta_mean"] for e in entries if isinstance(e.get("awps_delta_mean"), (int, float))]
    acpw = [e["acpw_delta_mean"] for e in entries if isinstance(e.get("acpw_delta_mean"), (int, float))]

    b_mean, b_std = _stat(betweens)
    r_mean, r_std = _stat(ratios)
    kind = next((e.get("kind") for e in entries if e.get("kind")), None)
    return {
        "kind": kind,
        "n_items": len(entries),
        "n_scored": len(scored),
        "n_excluded": len(excluded),
        "mean_between": b_mean,
        "std_between": b_std,
        "mean_within": round(statistics.fmean(withins), 6) if withins else None,
        "mean_ratio": r_mean,
        "std_ratio": r_std,
        "mean_cosine_between": round(statistics.fmean(cosines), 6) if cosines else None,
        "mean_length_ratio": round(statistics.fmean(lrs), 6) if lrs else None,
        "mean_awps_delta": round(statistics.fmean(awps), 6) if awps else None,
        "mean_acpw_delta": round(statistics.fmean(acpw), 6) if acpw else None,
    }


def _noise_floor(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Baseline within-variant divergence pooled across items = the global noise floor."""
    vals = [r["variants"][prompt_variants.BASELINE_NAME]["within_mean"]
            for r in records
            if prompt_variants.BASELINE_NAME in r.get("variants", {})
            and isinstance(r["variants"][prompt_variants.BASELINE_NAME].get("within_mean"), (int, float))]
    mean, std = _stat(vals)
    return {"baseline_within_mean": mean, "baseline_within_std": std, "n_items": len(vals)}


def aggregate(records: list[dict[str, Any]], axis_keys: list[str]) -> dict[str, Any]:
    n = len(records)
    out: dict[str, Any] = {
        "n_items": n,
        "item_errors": sum(1 for r in records if r.get("error")),
        "retrieval_hits_rate": _rate(sum(1 for r in records if r.get("retrieval_class") == "hits"), n),
        "retrieval_empty_rate": _rate(sum(1 for r in records if r.get("retrieval_class") == "empty"), n),
        "retrieval_error_rate": _rate(sum(1 for r in records if r.get("retrieval_class") == "error"), n),
        "noise_floor": _noise_floor(records),
        "by_axis": {k: _axis_block(records, k) for k in axis_keys},
    }

    langs: list[str] = []
    for r in records:
        if r.get("language") and r["language"] not in langs:
            langs.append(r["language"])
    out["by_language"] = {
        lang: {k: _axis_block([r for r in records if r.get("language") == lang], k) for k in axis_keys}
        for lang in langs
    }
    return out


# --- Output writers ---------------------------------------------------------
def _csv_rows(r: dict[str, Any]) -> list[dict[str, Any]]:
    """One CSV row per (item, language, axis)."""
    rows: list[dict[str, Any]] = []
    base = {
        "language": r.get("language"),
        "category": r.get("category"),
        "id": r.get("id"),
        "title": r.get("title"),
        "question": (r.get("question") or "")[:120],
        "retrieval_class": r.get("retrieval_class"),
        "n_rows": r.get("n_rows"),
        "runs": r.get("runs"),
    }
    for axis_key, e in (r.get("axes") or {}).items():
        row = dict(base)
        row.update({
            "axis": axis_key,
            "axis_kind": e.get("kind"),
            "between_mean": e.get("between_mean"),
            "between_std": e.get("between_std"),
            "within_baseline_mean": e.get("within_baseline_mean"),
            "within_treatment_mean": e.get("within_treatment_mean"),
            "within_pooled": e.get("within_pooled"),
            "ratio": e.get("ratio"),
            "cosine_between_mean": e.get("cosine_between_mean"),
            "length_ratio_mean": e.get("length_ratio_mean"),
            "awps_delta_mean": e.get("awps_delta_mean"),
            "acpw_delta_mean": e.get("acpw_delta_mean"),
            "excluded": e.get("excluded"),
            "error": r.get("error"),
        })
        rows.append(row)
    return rows


_CSV_FIELDS = [
    "language", "category", "id", "title", "question", "retrieval_class", "n_rows",
    "axis", "axis_kind", "runs", "between_mean", "between_std", "within_baseline_mean",
    "within_treatment_mean", "within_pooled", "ratio", "cosine_between_mean",
    "length_ratio_mean", "awps_delta_mean", "acpw_delta_mean", "excluded", "error",
]


def write_outputs(records: list[dict[str, Any]], summary: dict[str, Any],
                  run_config: dict[str, Any], ts: str) -> dict[str, str]:
    config.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    stem = config.RESULTS_DIR / f"part4_{ts}"

    json_path = f"{stem}.json"
    with open(json_path, "w", encoding="utf-8") as fh:
        json.dump({"config": run_config, "summary": summary, "items": records},
                  fh, ensure_ascii=False, indent=2)

    csv_path = f"{stem}.csv"
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=_CSV_FIELDS)
        writer.writeheader()
        for r in records:
            for row in _csv_rows(r):
                writer.writerow(row)

    txt_path = f"{stem}.summary.txt"
    with open(txt_path, "w", encoding="utf-8") as fh:
        fh.write(_render_summary(summary, run_config, records))

    return {"json": json_path, "csv": csv_path, "summary": txt_path}


def _verdict(kind: Optional[str], ratio: Optional[float]) -> str:
    """Human-readable interpretation of a mean ratio given the axis kind."""
    if ratio is None:
        return "no data"
    if kind == "robustness":
        return "NOT ROBUST" if ratio > config.PROMPT_ROBUST_RATIO_WARN else "robust"
    if kind == "semantic":
        return "may be COSMETIC" if ratio < config.PROMPT_SEMANTIC_RATIO_MIN else "differentiates"
    return ""


def _render_summary(s: dict[str, Any], run_config: dict[str, Any], records: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    w = lines.append
    langs = run_config.get("languages") or list(s.get("by_language", {}).keys())
    axis_keys = run_config.get("axis_keys") or list(s.get("by_axis", {}).keys())
    nf = s.get("noise_floor", {})

    w("=" * 80)
    w("GuIA Part 4 — Prompt Sensitivity (Fusionado)")
    w("=" * 80)
    w(f"Run timestamp : {run_config.get('timestamp')}")
    w(f"Languages     : {', '.join(langs)}   "
      f"({run_config.get('n_items_per_lang')} items x {len(langs)} langs)")
    w(f"Design        : {run_config.get('n_items_per_lang')} items x {len(langs)} langs "
      f"x {run_config.get('variants_generated')} variants x {run_config.get('runs')} runs "
      f"= {run_config.get('n_answer_calls')} answer calls")
    w(f"Axes          : " + ", ".join(f"{k}:{s['by_axis'][k].get('kind')}" for k in axis_keys if k in s['by_axis']))
    w(f"Method        : frozen retrieval (1 retrieve/item, reused), no conversation_id, "
      f"temperature NOT pinned (run-to-run variance = the noise floor)")
    w("")
    w("WHAT THIS MEASURES: surface divergence (token Jaccard, primary) between the")
    w("guide's answers. sensitivity ratio = between-variant / within-variant.")
    w("  ROBUSTNESS axes (few-shot, RAG position) want ratio ~= 1 (a fact-neutral")
    w("    change moves the output no more than resampling noise).")
    w("  SEMANTIC axes (persona, age) want ratio >> 1 (personalization is real).")
    w("Surface-only: a faithful paraphrase still counts as divergent. Read offenders.")
    w("")
    w("-" * 80)
    w("NOISE FLOOR — baseline within-variant divergence (R repeats, same prompt)")
    w("-" * 80)
    w(f"  baseline within Jaccard : {_fmt(nf.get('baseline_within_mean'))} ± {_fmt(nf.get('baseline_within_std'))}"
      f"   (over {nf.get('n_items')} items)")
    if run_config.get("runs", 0) < 2:
        w("  WARNING: --runs < 2 -> no within-variant pairs -> ratio is UNDEFINED.")
        w("  Only raw between-divergence is reported. Re-run with --runs >= 3.")
    w("")
    w("-" * 80)
    w("HEADLINE — per axis (all languages pooled)")
    w("-" * 80)
    for k in axis_keys:
        b = s["by_axis"].get(k)
        if not b:
            continue
        verdict = _verdict(b.get("kind"), b.get("mean_ratio"))
        w(f"  {k:<14} ({b.get('kind'):<10})  ratio={_fmt(b.get('mean_ratio'))} ± {_fmt(b.get('std_ratio'))}"
          f"   between={_fmt(b.get('mean_between'))} ± {_fmt(b.get('std_between'))}"
          f"   within={_fmt(b.get('mean_within'))}   [{verdict}]")
        if b.get("n_excluded"):
            w(f"  {'':<14} ({b['n_excluded']} item(s) excluded — no rows for rag_position)")
    w("")
    w("-" * 80)
    w("PER AXIS x PER LANGUAGE  —  ratio (± std)")
    w("-" * 80)
    hdr = f"  {'axis':<14}" + "".join(f"{lang:>14}" for lang in langs)
    w(hdr)
    w("  " + "-" * (len(hdr) - 2))
    for k in axis_keys:
        cells = ""
        for lang in langs:
            b = s.get("by_language", {}).get(lang, {}).get(k)
            cell = "—" if not b or b.get("mean_ratio") is None else f"{b['mean_ratio']:.2f}±{(b['std_ratio'] or 0):.2f}"
            cells += f"{cell:>14}"
        w(f"  {k:<14}{cells}")
    w("")
    w("  (between-variant divergence, same layout)")
    for k in axis_keys:
        cells = ""
        for lang in langs:
            b = s.get("by_language", {}).get(lang, {}).get(k)
            cell = "—" if not b or b.get("mean_between") is None else f"{b['mean_between']:.3f}"
            cells += f"{cell:>14}"
        w(f"  {k:<14}{cells}")
    w("")
    w("-" * 80)
    w("READABILITY DELTAS (corroborate semantic axes; scholar should read denser)")
    w("-" * 80)
    for k in axis_keys:
        b = s["by_axis"].get(k)
        if not b:
            continue
        w(f"  {k:<14} awps_delta={_fmt(b.get('mean_awps_delta'))}  acpw_delta={_fmt(b.get('mean_acpw_delta'))}  "
          f"length_ratio={_fmt(b.get('mean_length_ratio'))}  cosine={_fmt(b.get('mean_cosine_between'))}")
    w("")
    w("-" * 80)
    w("RETRIEVAL HEALTH (frozen once per item; reused across all variants/runs)")
    w("-" * 80)
    w(f"  hits / empty / error : {_fmt(s.get('retrieval_hits_rate'))} / "
      f"{_fmt(s.get('retrieval_empty_rate'))} / {_fmt(s.get('retrieval_error_rate'))}"
      f"   (item errors: {s.get('item_errors')})")
    w("")
    w("-" * 80)
    w("MOST-DIVERGENT (item, language, axis) — top 15 by between-variant Jaccard")
    w("-" * 80)
    flat: list[tuple[float, dict[str, Any], str, dict[str, Any]]] = []
    for r in records:
        for axis_key, e in (r.get("axes") or {}).items():
            if isinstance(e.get("between_mean"), (int, float)):
                flat.append((e["between_mean"], r, axis_key, e))
    flat.sort(key=lambda t: t[0], reverse=True)
    if not flat:
        w("  (nothing scored)")
    for between, r, axis_key, e in flat[:15]:
        ratio = e.get("ratio")
        w(f"  [{r.get('language')}|{axis_key}] {r.get('title') or r.get('id')}  "
          f"between={between:.3f}  ratio={_fmt(ratio)}  ({e.get('kind')})")
        base_ans = (r["variants"].get(prompt_variants.BASELINE_NAME, {}).get("answers") or [""])[0]
        treat_name = next((ax.treatment.name for ax in prompt_variants.AXES if ax.key == axis_key), None)
        treat_ans = (r["variants"].get(treat_name, {}).get("answers") or [""])[0] if treat_name else ""
        bs = base_ans.replace("\n", " ").strip()
        ts_ = treat_ans.replace("\n", " ").strip()
        w(f"      baseline : {bs[:160]}{'...' if len(bs) > 160 else ''}")
        w(f"      treatment: {ts_[:160]}{'...' if len(ts_) > 160 else ''}")
    if len(flat) > 15:
        w(f"  ... and {len(flat) - 15} more (see CSV, sort by between_mean desc)")
    w("=" * 80)
    return "\n".join(lines) + "\n"


# --- Entry point ------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 4 — Prompt Sensitivity (multilingual).")
    parser.add_argument("--smoke", action="store_true", help="tiny run (SMOKE_PART4_N items/lang) to check wiring")
    parser.add_argument("--n", type=int, default=None,
                        help=f"grounded items PER LANGUAGE (default {config.PART4_N})")
    parser.add_argument("--runs", type=int, default=config.PROMPT_RUNS,
                        help=f"repeats per variant — the noise floor (default {config.PROMPT_RUNS}; >=3 recommended)")
    parser.add_argument("--seed", type=int, default=config.RANDOM_SEED, help="sampling seed")
    parser.add_argument("--lang", default=None,
                        help=f"comma-separated languages (default: {','.join(config.LANGUAGES)})")
    parser.add_argument("--axes", default=None,
                        help=f"comma-separated axis keys (default: {','.join(prompt_variants.default_axis_keys())}; "
                             f"all: {','.join(a.key for a in prompt_variants.AXES)})")
    parser.add_argument("--dry-run", action="store_true",
                        help="assemble & print the benchmark + variants + call budget, make NO Cohere calls")
    args = parser.parse_args(argv)

    if args.lang:
        languages = [c.strip() for c in args.lang.split(",") if c.strip()]
        unknown = [c for c in languages if c not in config.LANGUAGE_NAMES]
        if unknown:
            print(f"[eval] Unknown language code(s): {unknown}. Known: {list(config.LANGUAGE_NAMES)}", file=sys.stderr)
            return 2
    else:
        languages = list(config.LANGUAGES)

    try:
        axes = prompt_variants.resolve_axes(
            [a.strip() for a in args.axes.split(",") if a.strip()] if args.axes else None)
    except ValueError as exc:
        print(f"[eval] {exc}", file=sys.stderr)
        return 2
    axis_keys = [ax.key for ax in axes]

    n = config.SMOKE_PART4_N if args.smoke else (args.n if args.n is not None else config.PART4_N)
    runs = max(1, args.runs)

    rng = random.Random(args.seed)
    items = build_question_set(n, rng)
    if not items:
        print("[eval] ERROR: no grounded items sampled — is the inventory available?", file=sys.stderr)
        return 2

    variants = prompt_variants.variants_for(axes)
    n_variants = len(variants)
    n_retrievals = len(items) * len(languages)
    n_answer_calls = len(items) * len(languages) * n_variants * runs
    n_total_calls = n_retrievals + n_answer_calls

    if args.dry_run:
        print(f"[eval] Part 4 dry-run — NO API calls.")
        print(f"[eval] Benchmark: {len(items)} grounded items x {len(languages)} langs "
              f"= {n_retrievals} retrievals")
        print(f"[eval] Variants ({n_variants}): " + ", ".join(name for name, _ in variants))
        print(f"[eval] Axes: " + ", ".join(f"{ax.key}({ax.kind})" for ax in axes))
        print(f"[eval] Budget: {n_retrievals} retrievals + {n_answer_calls} answers = "
              f"{n_total_calls} Cohere calls")
        approx_min = round(n_total_calls * config.REQUEST_SLEEP_S / 60, 1)
        print(f"[eval] ~{approx_min} min at {config.REQUEST_SLEEP_S}s/call (plus retrieval Cypher-gen calls).")
        if runs < 2:
            print("[eval] WARNING: --runs < 2 -> no noise floor -> sensitivity ratio undefined.")
        print()
        for i, it in enumerate(items, 1):
            print(f"  {i:>2}. [{it.category}] {(it.title or it.room or it.artist)!r}  expected={it.expected!r}")
            for lang in languages:
                print(f"        {lang}: {it.question_in(lang)}")
        return 0

    # Live run.
    preflight(require_neo4j=False, warn_neo4j=True)
    from . import llm_bridge
    if not llm_bridge.BACKOFF_INSTALLED:
        print("[eval] NOTE: global Cohere backoff could not be installed; 429s will error "
              "the call rather than retry.", file=sys.stderr)
    if not llm_bridge.neo4j_is_configured():
        print("[eval] NOTE: Neo4j not configured — every retrieval will error, so the "
              "rag_position axis is excluded for all items (fewshot/persona still run).", file=sys.stderr)
    if runs < 2:
        print("[eval] WARNING: --runs < 2 -> no within-variant noise floor -> sensitivity "
              "ratio will be undefined; only raw between-divergence is reported.", file=sys.stderr)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    work = [(it, lang) for lang in languages for it in items]
    run_config = {
        "timestamp": ts,
        "part": 4,
        "smoke": args.smoke,
        "seed": args.seed,
        "languages": languages,
        "n_items_per_lang": len(items),
        "n_items": len(work),
        "runs": runs,
        "axis_keys": axis_keys,
        "axes": [{"key": ax.key, "kind": ax.kind, "treatment": ax.treatment.name,
                  "params": ax.treatment.params} for ax in axes],
        "variants_generated": n_variants,
        "variant_names": [name for name, _ in variants],
        "n_answer_calls": n_answer_calls,
        "n_retrievals": n_retrievals,
        "model": llm_bridge.MODEL_USED,
        "divergence_metric": "jaccard",
        "divergence_lowercase": config.DIVERGENCE_LOWERCASE,
        "divergence_fold_accents": config.DIVERGENCE_FOLD_ACCENTS,
        "robust_ratio_warn": config.PROMPT_ROBUST_RATIO_WARN,
        "semantic_ratio_min": config.PROMPT_SEMANTIC_RATIO_MIN,
        "request_sleep_s": config.REQUEST_SLEEP_S,
        "global_backoff_installed": llm_bridge.BACKOFF_INSTALLED,
        "neo4j_configured": llm_bridge.neo4j_is_configured(),
        "no_conversation_id": True,
        "temperature_pinned": False,
        "frozen_retrieval": True,
        "baseline_params": prompt_variants.BASELINE_PARAMS,
    }

    print(f"[eval] Part 4 starting: {len(items)} items x {len(languages)} langs x {n_variants} variants "
          f"x {runs} runs = {n_answer_calls} answer calls (+{n_retrievals} retrievals), "
          f"sleep={config.REQUEST_SLEEP_S}s, backoff={'all' if llm_bridge.BACKOFF_INSTALLED else 'none'}")
    records: list[dict[str, Any]] = []
    for i, (it, lang) in enumerate(work, 1):
        print(f"[eval] ({i}/{len(work)}) [{lang}|{it.category}] {(it.title or it.room or it.artist)[:46]}", flush=True)
        try:
            record = run_item(it, lang, axes, runs)
        except Exception as exc:  # noqa: BLE001 — absolute backstop; never abort the run
            record = {"id": f"{it.category}:{(it.title or it.room or it.artist)}", "language": lang,
                      "category": it.category, "title": it.title, "room": it.room, "artist": it.artist,
                      "variants": {}, "axes": {},
                      "error": f"UNCAUGHT {type(exc).__name__}: {exc}",
                      "error_stage": "run_item", "traceback": traceback.format_exc()}
        records.append(record)
        if record.get("error"):
            print(f"       ! error @ {record.get('error_stage')}: {record['error']}", file=sys.stderr)
        else:
            tops = "  ".join(
                f"{k}:ratio={_fmt(record['axes'][k].get('ratio'))}"
                for k in axis_keys if record["axes"].get(k) and "ratio" in record["axes"][k])
            print(f"       -> retrieval={record.get('retrieval_class')} n_rows={record.get('n_rows')}  {tops}")

    summary = aggregate(records, axis_keys)
    paths = write_outputs(records, summary, run_config, ts)

    print("\n" + _render_summary(summary, run_config, records))
    print("[eval] Wrote:")
    for kind, path in paths.items():
        print(f"  {kind:<8}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
