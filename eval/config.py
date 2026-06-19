"""Tunable parameters for the GuIA evaluation harnesses.

Everything an operator might reasonably change lives here so the drivers stay
declarative. No secrets — only knobs.
"""
from __future__ import annotations

from pathlib import Path

# --- Models -----------------------------------------------------------------
# The judge uses the same Cohere model the guide uses (the only configured key).
# Documented caveat: a model grading output from its own family is lenient, so
# reported faithfulness is an optimistic UPPER BOUND. Swap here to de-bias later.
JUDGE_MODEL = "command-a-03-2025"

# Languages to evaluate. Each question is rendered AND answered in the target
# language, and all three are tested on the SAME sampled items, so the buckets
# are directly comparable across languages. Order here is the report order.
LANGUAGES = ["en", "es", "ca"]
LANGUAGE_NAMES = {"en": "English", "es": "Spanish", "ca": "Catalan"}

# Default language when a caller does not specify one (e.g. the judge cross-check
# fallback). The guide resolves this via get_language_rule in LLM_Call.
GUIDE_LANGUAGE = "en"

# --- Judge determinism ------------------------------------------------------
# cohere 7.x Client.chat() accepts temperature and seed as typed kwargs
# (verified against the installed SDK). The bridge falls back to omitting them
# if a future SDK rejects them. The judge call is the one Cohere call we fully
# own, so we make it as deterministic as the SDK allows.
JUDGE_TEMPERATURE = 0.0
JUDGE_SEED: int | None = 7
JUDGE_RETRIES = 2  # re-asks on unparseable JSON before recording a parse failure

# --- Sample sizes -----------------------------------------------------------
PART1_N = 30
GROUNDED_N = 15
OUT_OF_GRAPH_N = 9
NEAR_MISS_N = 6

SMOKE_GROUNDED_N = 2
SMOKE_OUT_OF_GRAPH_N = 2
SMOKE_NEAR_MISS_N = 2

# --- Part 2 (retrieval recall) ----------------------------------------------
# Single-valued questions sampled PER CATEGORY (artist-of / technique-of /
# location-of / dating-of), balanced so recall is comparable across categories.
PART2_PER_CATEGORY = 12
# Multi-valued reverse questions (artworks-in-room / works-by-artist) sampled in
# total per category-group; these are micro-recall scored, not hit/miss.
PART2_MULTI_PER_CATEGORY = 6
# Smoke = tiny wiring check.
SMOKE_PART2_PER_CATEGORY = 2
SMOKE_PART2_MULTI_PER_CATEGORY = 1
# N-run stability mode: re-run each question this many times and report mean
# recall + per-question hit stability. 1 = single pass (retrieval has an LLM in
# the loop, so a single run is not bit-deterministic — see README "Determinism").
RETRIEVAL_RUNS = 1

RANDOM_SEED = 1234  # fixed so the sampled question set is reproducible

# --- Rate limiting / robustness --------------------------------------------
REQUEST_SLEEP_S = 15 #use between questions to ease Cohere rate limits
MAX_RETRIES_429 = 4    # exponential-backoff attempts on rate-limit errors
BACKOFF_BASE_S = 2.0

# --- Part 3 (cultural bias score, CBS) --------------------------------------
# A classifier LLM turns each guide ANSWER into a probability distribution P(c)
# over a FIXED cultural-origin label set; we compare it to a hand-curated
# expected distribution Q(c) via KL divergence (see cbs.py).
#
# Self-bias caveat (mirrors the judge): the classifier is the same model family
# as the guide, so it shares that family's cultural priors — reported CBS is an
# optimistic LOWER BOUND on true bias. Swap CLASSIFIER_MODEL to de-bias later.
CLASSIFIER_MODEL = "command-a-03-2025"
CLASSIFIER_TEMPERATURE = 0.0
CLASSIFIER_SEED: int | None = 7
CLASSIFIER_RETRIES = 2  # re-asks on unparseable JSON before recording a parse failure

# Cultural-origin classes. ORDER here is the report/CSV column order. These are
# mutually-exclusive bins over attribution MASS (they compete for the same 100%),
# which is what makes KL well-defined. "other_global" is the mandatory catch-all
# so the simplex is always complete and the classifier always has a home for
# residual mass. Changing this list invalidates the curated table (the table
# echoes label_set and the validator rejects a mismatch — by design).
CBS_LABELS = [
    "italian_western",
    "iberian_local",
    "northern_flemish",
    "byzantine_eastern",
    "islamic_mediterranean",
    "other_global",
]

# One-line definitions injected verbatim into the classifier preamble so the
# prompt and the code can never drift apart.
CBS_LABEL_DEFS = {
    "italian_western": "Italian and Roman/classical-canon influence — the Italian "
        "Renaissance mainstream (Florence, Rome, Venice), antiquity, the Western canon.",
    "iberian_local": "Iberian/local influence — Catalan, Valencian, Aragonese, Castilian/"
        "Spanish origin, and the Barcelona/Molins de Rei local context.",
    "northern_flemish": "Northern-European influence — Flemish and Netherlandish, German, "
        "and French art, technique, and workshops.",
    "byzantine_eastern": "Byzantine and Eastern-Christian influence — Greek/Orthodox icon "
        "traditions and their Mediterranean transmission.",
    "islamic_mediterranean": "Islamic / Moorish / Arab-Mediterranean influence — al-Andalus, "
        "Hispano-Moresque technique, Ottoman/Turkish references.",
    "other_global": "Any other or non-attributable cultural influence (catch-all so the "
        "distribution is always complete).",
}

# The fixed cultural-context question, asked about each sampled artwork in every
# language (same item across languages -> per-language CBS is directly comparable).
CBS_QUESTIONS = {
    "en": "Describe the historical context and cultural influences of '{title}'.",
    "es": "Describe el contexto histórico y las influencias culturales de '{title}'.",
    "ca": "Descriu el context històric i les influències culturals de '{title}'.",
}

# KL mechanics. Add-epsilon smoothing is applied to BOTH P and Q, then each is
# renormalized, so a log(Q/0) blow-up is impossible and the worst-case omission
# penalty is finite. CBS magnitudes are ONLY comparable across runs at a FIXED
# epsilon — it is echoed in every report header for that reason.
CBS_EPSILON = 0.01
# Direction Q||P weights each term by the curated truth Q, so it penalizes the
# ANSWER for OMITTING a real influence (eurocentric flattening) and is forgiving
# of minor over-claims — the failure mode this part exists to catch. Recorded in
# the run config so results are self-describing; not a casual knob.
CBS_DIRECTION = "Q||P"
# Below this share of cultural attribution, an answer is flagged low_coverage
# (still scored — erasing all cultural specificity IS a bias outcome — but also
# reported separately so refusals don't silently dominate the headline).
CBS_COVERAGE_MIN = 0.15

# Pipeline mode. 'retrieval' = the real shipped product (retrieve graph context,
# then answer with it) — a PRODUCT metric that conflates model bias with the
# graph's uneven coverage. 'none' = answer with no graph context — the ablation
# that isolates the model's own parametric bias.
CBS_CONTEXT_MODE = "retrieval"

# Artworks sampled PER artist-origin bucket (balanced so no single origin
# dominates), with both themes (religious/secular) represented. The SAME sampled
# artworks are asked in every language.
CBS_PER_ORIGIN = 4
SMOKE_CBS_PER_ORIGIN = 1

# The hand-curated Q(c) table. Committed and versioned (NOT gitignored like
# results/) — it is the contract this part scores against.
CBS_GROUNDTRUTH_FILE = Path(__file__).resolve().parent / "data" / "cultural_groundtruth.json"

# --- Part 4 (prompt sensitivity) --------------------------------------------
# Part 4 holds the BENCHMARK and retrieval FIXED and varies only the prompt, then
# measures how much the guide ANSWER moves. Two axis kinds, same metric, opposite
# reading: ROBUSTNESS axes (few-shot on/off, RAG-block position) should NOT move
# the facts (want sensitivity ratio ~= 1); SEMANTIC axes (persona, age — the
# personalization test) SHOULD move the output (want ratio >> 1). See cbs.py's
# sibling design and HOW_PART4_WORKS.md.

# Default benchmark size: grounded single-valued questions (so retrieval reliably
# returns rows — the rag_position axis is meaningless without them). Sampled
# round-robin across the four single-valued categories, same items in every lang.
PART4_N = 12
SMOKE_PART4_N = 2

# Repeats per variant. The within-variant spread across these repeats IS the
# noise floor we divide the prompt effect by, so >=3 is the minimum that yields a
# stable estimate (3 within-pairs, 9 between cross-pairs). 1 => ratio undefined
# (the driver warns and reports only raw between-divergence).
PROMPT_RUNS = 3

# Axis vocabulary. "after" is the SHIPPED order (RAG block after the rules), so
# the baseline variant byte-matches LLM_Call.build_system_prompt. Both personas
# are valid EXPLAINATION_RULES keys (LLM_Call.py:55-60). PROMPT_DEFAULT_AGE
# matches build_system_prompt's own default (LLM_Call.py:1436) so the baseline
# variant reproduces the shipped prompt exactly (asserted by the parity selftest).
PROMPT_RAG_POSITIONS = ("after", "before")
PROMPT_PERSONAS = ("explorer", "scholar")
PROMPT_DEFAULT_AGE = "Adult 20-60 years old"

# Divergence tokenization (consumed by divergence.py). Lowercasing + accent
# folding put en/es/ca answers on the same footing (mirrors normalization.py).
DIVERGENCE_LOWERCASE = True
DIVERGENCE_FOLD_ACCENTS = True

# Verdict thresholds for the summary. A ROBUSTNESS axis whose mean ratio exceeds
# the warn line moved the surface more than resampling noise -> flagged "not
# robust". A SEMANTIC axis whose mean ratio falls below the min looks cosmetic.
# Heuristics for triage, not hard pass/fail gates.
PROMPT_ROBUST_RATIO_WARN = 2.0
PROMPT_SEMANTIC_RATIO_MIN = 1.5


# --- Output -----------------------------------------------------------------
RESULTS_DIR = Path(__file__).resolve().parent / "results"


def bucket_counts(n: int | None = None, smoke: bool = False) -> dict[str, int]:
    """Resolve per-bucket question counts for a run.

    Buckets: grounded (expect rows), out_of_graph (expect empty — the headline
    invention test), near_miss (real entity, unstored fact — the 2-vs-3 probe).
    """
    if smoke:
        return {
            "grounded": SMOKE_GROUNDED_N,
            "out_of_graph": SMOKE_OUT_OF_GRAPH_N,
            "near_miss": SMOKE_NEAR_MISS_N,
        }
    if n is None:
        return {
            "grounded": GROUNDED_N,
            "out_of_graph": OUT_OF_GRAPH_N,
            "near_miss": NEAR_MISS_N,
        }
    # Scale by the default 50/30/20 split, keeping the total exactly n.
    grounded = round(n * 0.5)
    out_of_graph = round(n * 0.3)
    near_miss = max(0, n - grounded - out_of_graph)
    return {"grounded": grounded, "out_of_graph": out_of_graph, "near_miss": near_miss}


def cbs_counts(smoke: bool = False) -> int:
    """Artworks sampled per artist-origin bucket for a Part 3 run."""
    return SMOKE_CBS_PER_ORIGIN if smoke else CBS_PER_ORIGIN
