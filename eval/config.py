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
