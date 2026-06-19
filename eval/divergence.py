"""Surface-divergence metrics for Part 4 — how different are two answer strings?

Part 4 (prompt sensitivity) varies the system prompt and measures how much the
guide's ANSWER changes. This module is the scoring heart: pure, deterministic,
network-free text-divergence functions. It deliberately makes **no** Cohere/LLM
call — divergence is a property of two strings, so it must be reproducible and
free to run:

    python -m eval.divergence --selftest

Why surface metrics (not a judge): the question Part 4 asks is "did the output
move, and by how much, relative to resampling noise?" — a *stability* question,
not a *quality* one. Surface divergence answers it deterministically and for
free; an LLM judge would add cost, its own sampling noise, and self-bias. The
honest caveat (documented in HOW_PART4_WORKS.md): surface divergence is NOT
semantic equivalence — a faithful paraphrase scores as "divergent". We measure
surface stability/variation, not correctness.

Metrics (all symmetric; distances in [0, 1]):

* ``jaccard_distance`` — 1 − |A∩B|/|A∪B| over token SETS. **PRIMARY** scalar:
  robust, bounded, ignores order and repetition.
* ``cosine_distance`` — 1 − cosine over token-COUNT vectors. **SECONDARY**:
  sensitive to repetition/emphasis that the set-based Jaccard discards.
* ``length_ratio`` — min/max of token counts. A "shape" signal (1.0 = same
  length, → 0 = very different), NOT a distance.
* ``readability_proxy`` — ``{awps, acpw}`` = avg words/sentence, avg chars/word.
  Corroborates semantic axes (e.g. a scholar persona should read denser).

Tokenization mirrors the accent-folding convention used across the eval suite
(``normalization._normalize_text_for_cypher``, itself a verbatim copy of
``LLM_Call.normalize_text_for_cypher``) so Catalan/Spanish answers compare on the
same footing as English. Inlined, not imported, so this module needs no backend.
"""
from __future__ import annotations

import argparse
import math
import re
from collections import Counter
from typing import Optional

from . import config


# --- Tokenization -----------------------------------------------------------
# Accent/apostrophe folding, kept in sync with normalization.py (which copies
# LLM_Call.normalize_text_for_cypher). Duplicated, not imported, so divergence
# stays network-free and importable with no Cohere key.
_FOLD = {
    "à": "a", "á": "a", "â": "a", "ä": "a",
    "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "ò": "o", "ó": "o", "ô": "o", "ö": "o",
    "ù": "u", "ú": "u", "û": "u", "ü": "u",
    "ç": "c", "·": "", "'": "", "’": "", "`": "",
}


def tokenize(text: str) -> list[str]:
    """Lowercase (optional), fold accents, strip punctuation to spaces, split.

    Honours ``config.DIVERGENCE_LOWERCASE`` / ``config.DIVERGENCE_FOLD_ACCENTS``.
    Empty / whitespace-only input -> ``[]``. Total and deterministic.
    """
    if not text:
        return []
    out = text.lower() if config.DIVERGENCE_LOWERCASE else text
    if config.DIVERGENCE_FOLD_ACCENTS:
        for source, target in _FOLD.items():
            out = out.replace(source, target)
        # Fold any residual accented codepoints the explicit map missed.
        out = out.replace("ñ", "n")
    stripped = re.sub(r"[^0-9a-zA-ZñÑÀ-ſ\s]", " ", out)
    return re.sub(r"\s+", " ", stripped).strip().split()


# --- Distances --------------------------------------------------------------
def jaccard_distance(a: str, b: str) -> float:
    """1 − Jaccard similarity over token sets. Both empty -> 0.0; one empty -> 1.0."""
    sa, sb = set(tokenize(a)), set(tokenize(b))
    if not sa and not sb:
        return 0.0
    if not sa or not sb:
        return 1.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return round(1.0 - inter / union, 6)


def cosine_distance(a: str, b: str) -> float:
    """1 − cosine similarity over token-count vectors. Both empty -> 0.0; one empty -> 1.0."""
    ca, cb = Counter(tokenize(a)), Counter(tokenize(b))
    if not ca and not cb:
        return 0.0
    if not ca or not cb:
        return 1.0
    dot = sum(ca[t] * cb.get(t, 0) for t in ca)
    na = math.sqrt(sum(v * v for v in ca.values()))
    nb = math.sqrt(sum(v * v for v in cb.values()))
    if na == 0.0 or nb == 0.0:  # unreachable given the guards above; defensive
        return 1.0
    cos = dot / (na * nb)
    # Clamp tiny FP overshoot so the distance never goes negative.
    cos = max(0.0, min(1.0, cos))
    return round(1.0 - cos, 6)


def length_ratio(a: str, b: str) -> float:
    """min/max of token counts: 1.0 = same length, -> 0 = very different.

    A shape signal, not a distance. Both empty -> 1.0 (identical, trivially);
    exactly one empty -> 0.0.
    """
    la, lb = len(tokenize(a)), len(tokenize(b))
    if la == 0 and lb == 0:
        return 1.0
    if la == 0 or lb == 0:
        return 0.0
    return round(min(la, lb) / max(la, lb), 6)


# --- Readability proxy ------------------------------------------------------
def readability_proxy(text: str) -> dict[str, float]:
    """Language-agnostic readability proxy: avg words/sentence, avg chars/word.

    ``awps`` (avg words per sentence) and ``acpw`` (avg chars per word) need no
    syllable dictionary, so they work across en/es/ca. Empty -> zeros.
    """
    tokens = tokenize(text)
    if not tokens:
        return {"awps": 0.0, "acpw": 0.0}
    sentences = [s for s in re.split(r"[.!?]+", text or "") if s.strip()]
    n_sent = max(1, len(sentences))
    awps = len(tokens) / n_sent
    acpw = sum(len(t) for t in tokens) / len(tokens)
    return {"awps": round(awps, 4), "acpw": round(acpw, 4)}


# --- Aggregate --------------------------------------------------------------
def divergence(a: str, b: str) -> dict[str, float]:
    """All surface signals between two answer strings, in one symmetric dict.

    ``jaccard`` is the canonical scalar used for the Part 4 sensitivity ratio;
    the rest corroborate it (cosine catches repetition, length_ratio and the
    readability deltas describe HOW the shape changed).
    """
    ra, rb = readability_proxy(a), readability_proxy(b)
    return {
        "jaccard": jaccard_distance(a, b),
        "cosine": cosine_distance(a, b),
        "length_ratio": length_ratio(a, b),
        "awps_delta": round(abs(ra["awps"] - rb["awps"]), 4),
        "acpw_delta": round(abs(ra["acpw"] - rb["acpw"]), 4),
    }


# --- Network-free self-test -------------------------------------------------
def _selftest() -> int:
    """Hand-built cases proving the divergence math with no API. Returns exit code."""
    cases: list[tuple[str, bool, str]] = []

    def check(name: str, got: bool, detail: str = "") -> None:
        cases.append((name, bool(got), detail or name))

    def approx(x: float, y: float, tol: float = 1e-6) -> bool:
        return abs(x - y) <= tol

    # 1. identical strings -> jaccard 0, cosine 0, length_ratio 1
    d = divergence("The painting by Leoni", "The painting by Leoni")
    check("identical jaccard==0", approx(d["jaccard"], 0.0), f"jaccard={d['jaccard']}")
    check("identical cosine==0", approx(d["cosine"], 0.0), f"cosine={d['cosine']}")
    check("identical length_ratio==1", approx(d["length_ratio"], 1.0), f"lr={d['length_ratio']}")

    # 2. disjoint vocab -> jaccard 1, cosine 1
    check("disjoint jaccard==1", approx(jaccard_distance("alpha beta", "gamma delta"), 1.0),
          f"jaccard={jaccard_distance('alpha beta', 'gamma delta')}")
    check("disjoint cosine==1", approx(cosine_distance("alpha beta", "gamma delta"), 1.0),
          f"cosine={cosine_distance('alpha beta', 'gamma delta')}")

    # 3. subset -> jaccard 0.5 (|∩|=2, |∪|=4), length_ratio 0.5
    check("subset jaccard==0.5", approx(jaccard_distance("a b", "a b c d"), 0.5),
          f"jaccard={jaccard_distance('a b', 'a b c d')}")
    check("subset length_ratio==0.5", approx(length_ratio("a b", "a b c d"), 0.5),
          f"lr={length_ratio('a b', 'a b c d')}")

    # 4. accent / case folding makes these identical
    check("fold accents+case jaccard==0", approx(jaccard_distance("Picasso", "picàsso"), 0.0),
          f"jaccard={jaccard_distance('Picasso', 'picàsso')}")
    # The Catalan ela geminada (l·l) is a doubled L: dropping the interpunct
    # yields "ll", so "Flagel·lació" folds to "flagellacio" (not "flagelacio").
    check("fold catalan punct jaccard==0", approx(jaccard_distance("Flagel·lació", "flagellacio"), 0.0),
          f"jaccard={jaccard_distance('Flagel·lació', 'flagellacio')}")

    # 5. same token SET but different counts -> jaccard 0 BUT cosine > 0
    j = jaccard_distance("a a b", "a b b")
    c = cosine_distance("a a b", "a b b")
    check("repetition jaccard==0", approx(j, 0.0), f"jaccard={j}")
    check("repetition cosine>0", c > 0.0, f"cosine={c}")

    # 6. empties handled per documented conventions
    check("both empty jaccard==0", approx(jaccard_distance("", ""), 0.0),
          f"jaccard={jaccard_distance('', '')}")
    check("one empty jaccard==1", approx(jaccard_distance("", "x"), 1.0),
          f"jaccard={jaccard_distance('', 'x')}")
    check("both empty length_ratio==1", approx(length_ratio("", ""), 1.0),
          f"lr={length_ratio('', '')}")
    check("one empty length_ratio==0", approx(length_ratio("", "x"), 0.0),
          f"lr={length_ratio('', 'x')}")

    # 7. symmetry
    a, b = "the cat sat on the mat", "a dog ran in the park"
    check("jaccard symmetric", approx(jaccard_distance(a, b), jaccard_distance(b, a)))
    check("cosine symmetric", approx(cosine_distance(a, b), cosine_distance(b, a)))

    # 8. all distances within [0, 1]
    for label, fn in (("jaccard", jaccard_distance), ("cosine", cosine_distance),
                      ("length_ratio", length_ratio)):
        v = fn(a, b)
        check(f"{label} in [0,1]", 0.0 <= v <= 1.0, f"{label}={v}")

    # 9. readability proxy: denser text reads higher awps
    short = readability_proxy("It is here.")
    longer = readability_proxy("It is a large and richly detailed devotional panel here.")
    check("readability awps grows", longer["awps"] > short["awps"],
          f"short={short['awps']} long={longer['awps']}")

    passed = sum(1 for _, ok, _ in cases if ok)
    print("=" * 64)
    print(f"divergence self-test: {passed}/{len(cases)} passed")
    print("=" * 64)
    for name, ok, detail in cases:
        print(f"  [{'PASS' if ok else 'FAIL'}] {detail if not ok else name}")
    return 0 if passed == len(cases) else 1


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Part 4 surface-divergence metrics (self-test).")
    parser.add_argument("--selftest", action="store_true", help="run network-free divergence checks")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
