"""The hand-curated expected cultural distribution Q(c) for Part 3.

Unlike Part 2's ground truth (deterministic facts read straight from the Excel),
Q(c) cannot be read from the knowledge graph: the graph has NO structured
cultural-origin fields — only free-text artist bios and uneven descriptions. So
Q(c) is **hand-curated art-historical judgment**, committed and versioned at
``data/cultural_groundtruth.json`` and reviewed in PRs. CBS is only as defensible
as this table; each row carries a ``confidence`` and a ``source``/``rationale``.

THE central honesty rule: curate Q to the truth, NOT to a diversity target. The
collection is genuinely European-dominated, so a high ``italian_western`` /
``iberian_local`` share is usually CORRECT, not bias. Inflating non-European mass
here would make a faithful guide score as biased. (CBS uses direction Q||P, so a
work that IS Italian and is described as Italian scores ~0 — see cbs.py.)

This module:
  * loads + validates the table (network-free)        -> ``--validate``
  * joins curated titles to the Excel inventory via the Part 2 normalizer
  * drafts candidate rows from the graph's own bio+description text (the one
    path that needs the LLM)                            -> ``--template``
  * prints a human-readable dump                        -> ``--dump``

    python -m eval.cultural_groundtruth --validate       # free, gate a run
    python -m eval.cultural_groundtruth --dump
    python -m eval.cultural_groundtruth --template --out draft.json --limit 5
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from . import config, normalization
from . import groundtruth as gt

ALLOWED_THEMES = ("religious", "secular")
ALLOWED_CONFIDENCE = ("high", "medium", "low")


@dataclass
class CuratedItem:
    title: str                       # canonical inventory title (post-join)
    raw_title: str                   # the title as written in the table
    theme: str                       # religious | secular
    artist_origin: str               # balancing/aggregation dimension (free-ish label)
    distribution: dict[str, float]   # raw Q(c) over CBS_LABELS (need not sum to exactly 1)
    confidence: str
    source: str
    rationale: str

    def to_record(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "theme": self.theme,
            "artist_origin": self.artist_origin,
            "distribution": self.distribution,
            "confidence": self.confidence,
            "source": self.source,
            "rationale": self.rationale,
        }


# --- Inventory join ---------------------------------------------------------
def inventory_title_index(path: Path = gt.RAW_DATA_FILE) -> dict[str, str]:
    """Map ``norm(title) -> canonical inventory title`` for every unique artwork.

    Built from the same parser Part 2 uses, with the same ``normalization.norm``
    fold, so a curator's minor accent/quote/case variation still binds to the
    real title. Duplicate titles collapse to one entry (the graph MERGEs them).
    """
    inv = gt.load_inventory(path)
    cols = inv.columns
    index: dict[str, str] = {}
    for row in inv.data_rows:
        title = gt._cell(row, cols["title"])
        room = gt._cell(row, cols["location"])
        if not title or not room:
            continue
        key = normalization.norm(title)
        if key and key not in index:
            index[key] = title
    return index


def _raw_table(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(
            f"Curated table not found: {path}\n"
            f"Create it (see HOW_PART3_WORKS.md) or scaffold a draft with --template."
        )
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# --- Load + validate --------------------------------------------------------
@dataclass
class ValidationReport:
    items: list[CuratedItem]
    errors: list[str]            # fatal: a row is malformed
    unmatched_titles: list[str]  # curated titles with no inventory match
    uncovered_titles: list[str]  # inventory titles with no curated row

    @property
    def ok(self) -> bool:
        return not self.errors and not self.unmatched_titles


def load_and_validate(
    path: Path = config.CBS_GROUNDTRUTH_FILE,
    inv_path: Path = gt.RAW_DATA_FILE,
) -> ValidationReport:
    """Parse, validate, and inventory-join the curated table. Never raises on a
    bad row — collects every problem so ``--validate`` can report them all."""
    errors: list[str] = []
    items: list[CuratedItem] = []
    unmatched: list[str] = []

    try:
        data = _raw_table(path)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        return ValidationReport([], [f"{type(exc).__name__}: {exc}"], [], [])

    # Top-level stale-file guard.
    label_set = data.get("label_set")
    if label_set != config.CBS_LABELS:
        errors.append(
            f"label_set mismatch: table has {label_set!r} but config.CBS_LABELS is "
            f"{config.CBS_LABELS!r}. The table was written for a different label set."
        )
    if "version" not in data:
        errors.append("missing top-level 'version'")

    try:
        index = inventory_title_index(inv_path)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"could not load inventory for title join: {type(exc).__name__}: {exc}")
        index = {}

    artworks = data.get("artworks")
    if not isinstance(artworks, list):
        errors.append("'artworks' must be a list")
        artworks = []

    matched_canonical: set[str] = set()
    for i, raw in enumerate(artworks):
        where = f"artworks[{i}]"
        if not isinstance(raw, dict):
            errors.append(f"{where}: not an object")
            continue
        raw_title = str(raw.get("title", "")).strip()
        if not raw_title:
            errors.append(f"{where}: missing 'title'")
            continue

        # Distribution: keys must match exactly, values >= 0, sum ~ 1.
        dist_raw = raw.get("distribution")
        if not isinstance(dist_raw, dict):
            errors.append(f"{where} ({raw_title!r}): 'distribution' must be an object")
            continue
        if set(dist_raw.keys()) != set(config.CBS_LABELS):
            errors.append(
                f"{where} ({raw_title!r}): distribution keys {sorted(dist_raw)} != "
                f"CBS_LABELS {sorted(config.CBS_LABELS)}"
            )
            continue
        dist: dict[str, float] = {}
        bad_value = False
        for label in config.CBS_LABELS:
            try:
                value = float(dist_raw[label])
            except (TypeError, ValueError):
                errors.append(f"{where} ({raw_title!r}): distribution[{label}] is not a number")
                bad_value = True
                break
            if value < 0.0:
                errors.append(f"{where} ({raw_title!r}): distribution[{label}]={value} is negative")
                bad_value = True
                break
            dist[label] = value
        if bad_value:
            continue
        total = sum(dist.values())
        if not (0.99 <= total <= 1.01):
            errors.append(f"{where} ({raw_title!r}): distribution sums to {total:.4f}, must be ~1.0")
            continue

        # Enum fields.
        theme = str(raw.get("theme", "")).strip().lower()
        if theme not in ALLOWED_THEMES:
            errors.append(f"{where} ({raw_title!r}): theme {theme!r} not in {ALLOWED_THEMES}")
            continue
        confidence = str(raw.get("confidence", "")).strip().lower()
        if confidence not in ALLOWED_CONFIDENCE:
            errors.append(f"{where} ({raw_title!r}): confidence {confidence!r} not in {ALLOWED_CONFIDENCE}")
            continue
        artist_origin = str(raw.get("artist_origin", "")).strip() or "unknown"

        # Inventory join.
        canonical = index.get(normalization.norm(raw_title))
        if canonical is None:
            unmatched.append(raw_title)
            continue
        matched_canonical.add(canonical)

        items.append(CuratedItem(
            title=canonical,
            raw_title=raw_title,
            theme=theme,
            artist_origin=artist_origin,
            distribution=dist,
            confidence=confidence,
            source=str(raw.get("source", "")).strip(),
            rationale=str(raw.get("rationale", "")).strip(),
        ))

    uncovered = sorted(t for t in index.values() if t not in matched_canonical)
    return ValidationReport(items=items, errors=errors,
                            unmatched_titles=unmatched, uncovered_titles=uncovered)


def load_items(path: Path = config.CBS_GROUNDTRUTH_FILE) -> list[CuratedItem]:
    """Convenience for the driver: validated items, or raise with the errors."""
    report = load_and_validate(path)
    if report.errors or report.unmatched_titles:
        problems = report.errors + [f"unmatched title: {t!r}" for t in report.unmatched_titles]
        raise ValueError("curated table invalid:\n  - " + "\n  - ".join(problems))
    return report.items


# --- CLI: validate ----------------------------------------------------------
def _print_validation(report: ValidationReport) -> int:
    print("=" * 72)
    print("CULTURAL GROUND-TRUTH VALIDATION (network-free)")
    print("=" * 72)
    print(f"Table file   : {config.CBS_GROUNDTRUTH_FILE}")
    print(f"Labels       : {config.CBS_LABELS}")
    print(f"Valid rows   : {len(report.items)}")
    by_conf = {c: sum(1 for it in report.items if it.confidence == c) for c in ALLOWED_CONFIDENCE}
    by_theme = {t: sum(1 for it in report.items if it.theme == t) for t in ALLOWED_THEMES}
    origins: dict[str, int] = {}
    for it in report.items:
        origins[it.artist_origin] = origins.get(it.artist_origin, 0) + 1
    print(f"By confidence: {by_conf}")
    print(f"By theme     : {by_theme}")
    print(f"By origin    : {origins}")

    if report.errors:
        print(f"\nERRORS ({len(report.errors)}):")
        for e in report.errors:
            print(f"  ✗ {e}")
    if report.unmatched_titles:
        print(f"\nUNMATCHED curated titles ({len(report.unmatched_titles)}) — fix the title to bind:")
        for t in report.unmatched_titles:
            print(f"  ✗ {t!r}")
    if report.uncovered_titles:
        print(f"\nUNCOVERED inventory titles ({len(report.uncovered_titles)}) — no curated Q "
              f"(fine; just not sampleable for Part 3):")
        for t in report.uncovered_titles[:40]:
            print(f"  · {t}")
        if len(report.uncovered_titles) > 40:
            print(f"  ... and {len(report.uncovered_titles) - 40} more")

    print("\n" + "=" * 72)
    if report.ok:
        print(f"OK — {len(report.items)} valid rows, all titles bind to the inventory.")
        return 0
    print("FAILED — fix the errors above before running Part 3.")
    return 1


# --- CLI: dump --------------------------------------------------------------
def _print_dump(report: ValidationReport) -> int:
    print("=" * 72)
    print("CURATED Q(c) DUMP")
    print("=" * 72)
    for it in report.items:
        top = sorted(it.distribution.items(), key=lambda kv: kv[1], reverse=True)
        mix = "  ".join(f"{c}={v:.2f}" for c, v in top if v > 0.0)
        print(f"\n[{it.theme}|{it.artist_origin}|conf={it.confidence}] {it.title}")
        print(f"   Q: {mix}")
        if it.rationale:
            print(f"   why: {it.rationale}")
    print("\n" + "=" * 72)
    return 0 if report.ok else 1


# --- CLI: template ----------------------------------------------------------
def _draft_rows(limit: Optional[int]) -> list[dict[str, Any]]:
    """LLM-draft candidate rows from each artwork's bio+description text.

    This is the ONLY path here that needs the LLM. Output is a DRAFT for human
    correction — every row is confidence='low' with an explicit source flag.
    """
    from ._bootstrap import preflight
    preflight(require_neo4j=False, warn_neo4j=False)
    from . import cbs

    inv = gt.load_inventory()
    cols = inv.columns
    seen: set[str] = set()
    drafts: list[dict[str, Any]] = []
    rows = inv.data_rows
    for row in rows:
        title = gt._cell(row, cols["title"])
        room = gt._cell(row, cols["location"])
        if not title or not room or title in seen:
            continue
        seen.add(title)
        description = gt._cell(row, cols["description"])
        artist = gt._cell(row, cols["artist"])
        source_text = " ".join(t for t in (artist, description) if t).strip()

        if not source_text:
            # No text to draft from: uniform prior, flagged for sourcing.
            uniform = round(1.0 / len(config.CBS_LABELS), 4)
            dist = {c: uniform for c in config.CBS_LABELS}
            # fix rounding drift onto the catch-all
            dist[config.CBS_LABELS[-1]] = round(1.0 - sum(list(dist.values())[:-1]), 4)
            drafts.append(_draft_row(title, artist, dist, needs_source=True))
            continue

        result = cbs.classify(source_text)
        if result.distribution is None:
            uniform = round(1.0 / len(config.CBS_LABELS), 4)
            dist = {c: uniform for c in config.CBS_LABELS}
            dist[config.CBS_LABELS[-1]] = round(1.0 - sum(list(dist.values())[:-1]), 4)
            drafts.append(_draft_row(title, artist, dist, needs_source=True))
        else:
            dist = {c: round(result.distribution[c], 4) for c in config.CBS_LABELS}
            drafts.append(_draft_row(title, artist, dist, needs_source=False))

        if limit is not None and len(drafts) >= limit:
            break
    return drafts


def _draft_row(title: str, artist: str, dist: dict[str, float], needs_source: bool) -> dict[str, Any]:
    return {
        "title": title,
        "theme": "religious",  # PLACEHOLDER — curator must set religious|secular
        "artist_origin": (artist or "unknown"),
        "distribution": dist,
        "confidence": "low",
        "source": ("AUTO-DRAFT from graph bio+description — REVIEW REQUIRED"
                   if not needs_source else
                   "AUTO-DRAFT (no source text — uniform prior) — REVIEW REQUIRED"),
        "rationale": "",
        "needs_source": needs_source,
    }


def _write_template(out_path: Path, limit: Optional[int]) -> int:
    print(f"[eval] Drafting candidate rows (LLM) -> {out_path} ...", file=sys.stderr)
    drafts = _draft_rows(limit)
    payload = {
        "version": 1,
        "label_set": config.CBS_LABELS,
        "_note": ("AUTO-DRAFTED scaffold — NOT ground truth. Review every row: set "
                  "theme (religious|secular), correct the distribution, set confidence, "
                  "fill source+rationale, then remove this note and the per-row "
                  "needs_source flags before committing as data/cultural_groundtruth.json."),
        "artworks": drafts,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"[eval] Wrote {len(drafts)} DRAFT rows to {out_path}")
    print("[eval] These are a starting point for human correction, NOT ground truth.")
    return 0


# --- Entry point ------------------------------------------------------------
def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Curated cultural ground truth (Q) for Part 3.")
    parser.add_argument("--validate", action="store_true", help="validate the committed table (network-free)")
    parser.add_argument("--dump", action="store_true", help="print the curated distributions")
    parser.add_argument("--template", action="store_true",
                        help="LLM-draft candidate rows from graph text (needs COHERE_LLM_KEY)")
    parser.add_argument("--out", type=Path, default=None, help="output path for --template draft")
    parser.add_argument("--limit", type=int, default=None, help="cap rows drafted by --template")
    args = parser.parse_args(argv)

    if args.template:
        out = args.out or (config.CBS_GROUNDTRUTH_FILE.parent / "cultural_groundtruth.draft.json")
        if out.resolve() == config.CBS_GROUNDTRUTH_FILE.resolve():
            print("[eval] Refusing to overwrite the committed table with a draft. "
                  "Pass a different --out.", file=sys.stderr)
            return 2
        return _write_template(out, args.limit)

    if args.validate or args.dump:
        report = load_and_validate()
        if args.dump:
            return _print_dump(report)
        return _print_validation(report)

    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
