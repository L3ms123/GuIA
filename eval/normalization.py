"""Recall matcher for Part 2 — does a retrieved row set CONTAIN a known answer?

This is the scoring heart of Part 2. Retrieval returns rows whose column names
are dynamic (whatever the generated Cypher chose to ``RETURN``) and whose values
may be strings, numbers, ``None`` or lists. We never assume key names: we
stringify every value into one normalized *haystack* and ask whether the known
answer appears in it.

Matching is **substring after normalization**, not equality, because the guide's
own retrieval fallback is ``CONTAINS``-based and RETURN formatting varies. Two
categories get special handling, both grounded in how the graph actually stores
the data (verified against ``LLM_Call.py`` / ``KG/kg.ipynb``):

* **location** — the UI label ``P1-S3`` is NOT stored verbatim. ``kg.ipynb``'s
  ``parse_ubic`` (``:183``) splits on ``-`` and does ``parts[0].replace('P','')``,
  so ``Sala.palau`` and ``Sala.id`` hold the bare tokens (``"1"`` and ``"3"``);
  ground-floor ``PB-S0`` becomes palau ``"B"`` (a letter, not a digit). The
  Cypher-gen preamble (``LLM_Call.py:1886``) confirms the split. So we extract
  palau+sala from the expected UBIC the same way the graph did and require BOTH
  tokens to appear — never the literal ``P1-S3``.
* **dating** — free-text and noisy ("c. 1550", "1450-1460", "Segle XVI"). We
  extract 4-digit years and HIT if ANY expected year appears as a token; with no
  year we fall back to requiring all expected tokens (so "Segle XVI" does not
  match "Segle XVII").

This module is intentionally **network-free**: it inlines a verbatim copy of
``normalize_text_for_cypher`` (``LLM_Call.py:1404``) rather than importing the
backend, so the matcher can be unit-tested with no Cohere key:

    python -m eval.normalization --selftest
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from typing import Any, Optional


# --- Verbatim copy of LLM_Call.normalize_text_for_cypher (:1404) ------------
# Kept in sync intentionally; duplicated (not imported) so this module needs no
# Cohere key / network — same pattern as groundtruth.py's inlined helpers.
def _normalize_text_for_cypher(text: str) -> str:
    replacements = {
        "à": "a", "á": "a", "â": "a", "ä": "a",
        "è": "e", "é": "e", "ê": "e", "ë": "e",
        "ì": "i", "í": "i", "î": "i", "ï": "i",
        "ò": "o", "ó": "o", "ô": "o", "ö": "o",
        "ù": "u", "ú": "u", "û": "u", "ü": "u",
        "ç": "c", "·": "", "'": "", "’": "", "`": "",
    }
    normalized = text.lower()
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def norm(s: Any) -> str:
    """Normalize for matching: fold accents/apostrophes (the LLM_Call way), strip
    remaining punctuation to spaces, collapse whitespace. Total and idempotent."""
    folded = _normalize_text_for_cypher(str(s))
    stripped = re.sub(r"[^a-z0-9\s]", " ", folded)
    return re.sub(r"\s+", " ", stripped).strip()


# --- Row -> haystack --------------------------------------------------------
def _flatten_values(value: Any) -> list[str]:
    """Stringify a single row value into atom strings. None drops out; lists and
    dicts recurse; everything else becomes ``str(value)``."""
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        out: list[str] = []
        for item in value:
            out.extend(_flatten_values(item))
        return out
    if isinstance(value, dict):
        out = []
        for item in value.values():
            out.extend(_flatten_values(item))
        return out
    text = str(value).strip()
    return [text] if text else []


def row_haystack(rows: Optional[list[dict[str, Any]]]) -> str:
    """Concatenate every value across every row into one normalized string."""
    if not rows:
        return ""
    atoms: list[str] = []
    for row in rows:
        if isinstance(row, dict):
            for value in row.values():
                atoms.extend(_flatten_values(value))
        else:  # defensive: a non-dict row
            atoms.extend(_flatten_values(row))
    return norm(" ".join(atoms))


# --- Match results ----------------------------------------------------------
@dataclass
class MatchResult:
    hit: bool
    needle: str = ""        # what we looked for (normalized), for triage
    detail: str = ""        # how it matched / why it missed


@dataclass
class MultiMatchResult:
    found: int
    total: int
    all_present: bool
    missing: list[str] = field(default_factory=list)

    @property
    def micro_recall(self) -> Optional[float]:
        return round(self.found / self.total, 4) if self.total else None


# --- Location helpers -------------------------------------------------------
def parse_ubic_like_graph(ubic: str) -> tuple[Optional[str], Optional[str]]:
    """Split a UI UBIC into the (palau, sala) tokens the GRAPH stores.

    Mirrors ``KG/kg.ipynb`` ``parse_ubic`` (:183) verbatim in spirit:
    split on '-', drop the leading 'P'/'S'. ``"P1-S3"`` -> ("1","3");
    ``"PB-S0"`` -> ("B","0") because ``"PB".replace('P','') == "B"``.
    """
    if not ubic or "-" not in ubic:
        return None, None
    parts = ubic.split("-")
    palau = parts[0].replace("P", "").replace("p", "").strip()
    sala = parts[1].replace("S", "").replace("s", "").strip() if len(parts) > 1 else ""
    return (palau or None), (sala or None)


def _match_location(expected_ubic: str, haystack: str) -> MatchResult:
    palau, sala = parse_ubic_like_graph(expected_ubic)
    if not palau or not sala:
        # Malformed UBIC -> fall back to plain substring of the whole label.
        needle = norm(expected_ubic)
        return MatchResult(bool(needle) and needle in haystack, needle, "fallback-substring")
    tokens = set(haystack.split())
    np, ns = norm(palau), norm(sala)
    # Two accepted forms: bare tokens ("1","3") or the joined form ("p1","s3").
    # BOTH palau and sala are required: sala numbers repeat across palaus (the
    # graph has ~6 Sala across 3 Palau), so sala alone is not a unique location.
    bare = np in tokens and ns in tokens
    joined = f"p{np}" in tokens and f"s{ns}" in tokens
    hit = bare or joined
    # On a miss, say WHICH half was present — the common reason a correct
    # retrieval misses here is that the generated Cypher RETURNed only s.id and
    # omitted s.palau, so "1" never reaches the rows. That makes location recall
    # a CONSERVATIVE lower bound; the detail string lets you spot it in triage.
    sala_present = ns in tokens or f"s{ns}" in tokens
    palau_present = np in tokens or f"p{np}" in tokens
    if hit:
        detail = "both-tokens" if bare else "joined-tokens"
    elif sala_present and not palau_present:
        detail = "sala matched; palau not in rows (Cypher likely omitted s.palau)"
    elif palau_present and not sala_present:
        detail = "palau matched; sala not in rows"
    else:
        detail = "neither palau nor sala present"
    return MatchResult(hit, f"palau={np} sala={ns}", detail)


def _match_dating(expected: str, haystack: str) -> MatchResult:
    tokens = set(haystack.split())
    years = re.findall(r"\d{4}", expected)
    if years:
        hit = any(year in tokens for year in years)
        return MatchResult(hit, " ".join(years), "any-year-token" if hit else "no expected year present")
    # No 4-digit year (e.g. "Segle XVI"): require all expected tokens as tokens,
    # so "xvi" does not match inside "xvii".
    needles = norm(expected).split()
    hit = bool(needles) and all(tok in tokens for tok in needles)
    return MatchResult(hit, " ".join(needles), "all-tokens" if hit else "not all tokens present")


# --- Public matchers --------------------------------------------------------
def match_single(category: str, expected: str, rows: Optional[list[dict[str, Any]]]) -> MatchResult:
    """Does the answer to a single-valued question appear in the rows?

    ``location-of`` and ``dating-of`` use the special logic above; everything
    else (artist/technique) is a plain normalized-substring test.
    """
    haystack = row_haystack(rows)
    if not haystack:
        return MatchResult(False, norm(expected), "no rows")
    if category == "location-of":
        return _match_location(expected, haystack)
    if category == "dating-of":
        return _match_dating(expected, haystack)
    needle = norm(expected)
    return MatchResult(bool(needle) and needle in haystack, needle,
                       "substring" if needle and needle in haystack else "substring absent")


def match_multi(expected_titles: list[str], rows: Optional[list[dict[str, Any]]]) -> MultiMatchResult:
    """Micro-recall for a multi-valued answer set: how many expected titles appear."""
    haystack = row_haystack(rows)
    found, missing = [], []
    for title in expected_titles:
        needle = norm(title)
        if needle and needle in haystack:
            found.append(title)
        else:
            missing.append(title)
    return MultiMatchResult(found=len(found), total=len(expected_titles),
                            all_present=(len(found) == len(expected_titles) and bool(expected_titles)),
                            missing=missing)


# --- Network-free self-test -------------------------------------------------
def _selftest() -> int:
    """Hand-built cases proving the matcher logic with no API/Neo4j. Returns exit code."""
    cases: list[tuple[str, bool, Any]] = []

    def check(name: str, got: bool, want: bool) -> None:
        cases.append((name, got == want, f"{name}: got hit={got}, want hit={want}"))

    # artist (substring, dynamic keys, accents)
    check("artist hit", match_single("artist-of", "Leone Leoni",
          [{"artist.name": "Leone Leoni"}]).hit, True)
    check("artist accents", match_single("artist-of", "Perot Gascó",
          [{"a.artist": "PEROT GASCO"}]).hit, True)
    check("artist miss", match_single("artist-of", "Leone Leoni",
          [{"a.title": "Carles V"}]).hit, False)

    # technique (expected is substring of a more verbose row value)
    check("technique hit", match_single("technique-of", "Oli sobre tela",
          [{"a.technique": "Oli sobre tela i fusta"}]).hit, True)
    check("technique miss", match_single("technique-of", "Oli sobre tela",
          [{"x": "Bronze"}]).hit, False)

    # location (split palau/sala; ground-floor letter palau; wrong sala)
    check("loc hit", match_single("location-of", "P1-S3",
          [{"s.palau": "1", "s.id": "3"}]).hit, True)
    check("loc wrong sala", match_single("location-of", "P1-S3",
          [{"s.palau": "1", "s.id": "2"}]).hit, False)
    check("loc ground floor", match_single("location-of", "PB-S0",
          [{"s.palau": "B", "s.id": "0"}]).hit, True)
    check("loc no sala token", match_single("location-of", "P1-S3",
          [{"s.palau": "1"}]).hit, False)

    # dating (year-any; range; roman numeral century must not over-match)
    check("dating year", match_single("dating-of", "c. 1550",
          [{"a.dating": "c. 1550"}]).hit, True)
    check("dating wrong year", match_single("dating-of", "1550",
          [{"a.dating": "1576"}]).hit, False)
    check("dating range", match_single("dating-of", "1450-1460",
          [{"a.dating": "Cap a 1460"}]).hit, True)
    check("dating roman hit", match_single("dating-of", "Segle XVI",
          [{"a.dating": "Segle XVI"}]).hit, True)
    check("dating roman strict", match_single("dating-of", "Segle XVI",
          [{"a.dating": "Segle XVII"}]).hit, False)

    # row value robustness (None dropped, numbers + lists stringified)
    check("mixed values", match_single("artist-of", "Leoni",
          [{"n": None, "k": 17, "names": ["Leone Leoni", "Pompeo"]}]).hit, True)
    check("empty rows", match_single("artist-of", "Leoni", []).hit, False)

    # multi-valued micro-recall
    mm = match_multi(["Davallament", "Sant Jeroni", "Anunciació"],
                     [{"t": "Davallament"}, {"t": "Anunciació"}])
    check("multi found count", mm.found == 2 and mm.total == 3, True)
    check("multi not all present", mm.all_present, False)
    cases.append(("multi missing == ['Sant Jeroni']", mm.missing == ["Sant Jeroni"],
                  f"missing={mm.missing}"))

    passed = sum(1 for _, ok, _ in cases if ok)
    print("=" * 64)
    print(f"normalization self-test: {passed}/{len(cases)} passed")
    print("=" * 64)
    for name, ok, detail in cases:
        print(f"  [{'PASS' if ok else 'FAIL'}] {detail if not ok else name}")
    return 0 if passed == len(cases) else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 2 recall matcher (self-test).")
    parser.add_argument("--selftest", action="store_true", help="run network-free matcher checks")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
