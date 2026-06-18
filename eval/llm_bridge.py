"""Thin, intentional wrappers over the GuIA backend (LLM_Call).

Re-exports exactly what the eval harnesses use and nothing more. Importing this
module triggers env validation and the one-time backend import via _bootstrap,
so anything that needs the live model imports from here.

Pure, network-free helpers used by groundtruth generation are deliberately NOT
routed through this module — groundtruth.py inlines its own copies so that
question-set inspection works with no Cohere key and no network.
"""
from __future__ import annotations

import time
from typing import Any, Optional

from . import config
from ._bootstrap import load_llm

_LLM = load_llm()

# --- Re-exported backend handles (verified to exist in LLM_Call) ------------
MODEL_USED = _LLM.MODEL_USED
RAW_DATA_FILE = _LLM.RAW_DATA_FILE
detect_dont_know = _LLM.detect_dont_know
normalize_text_for_cypher = _LLM.normalize_text_for_cypher
normalize_header = _LLM.normalize_header
read_xlsx_rows = _LLM.read_xlsx_rows
load_locations_from_excel = _LLM.load_locations_from_excel
neo4j_is_configured = _LLM.neo4j_is_configured


# --- Rate-limit aware Cohere call -------------------------------------------
def _is_rate_limit(exc: Exception) -> bool:
    text = f"{type(exc).__name__} {exc}".lower()
    if "429" in text or "too many requests" in text:
        return True
    return "rate" in text and "limit" in text


# The original (unwrapped) chat bound method, captured before we install backoff.
_ORIGINAL_CHAT = _LLM.COHERE_CLIENT.chat


def _chat_with_backoff(**kwargs) -> Any:
    """The Cohere chat call with bounded exponential backoff on rate-limit errors.

    Non-rate-limit errors (e.g. a TypeError from an unsupported kwarg) propagate
    immediately so the caller can handle them. Never silently swallows.
    """
    delay = config.BACKOFF_BASE_S
    last: Optional[Exception] = None
    for attempt in range(config.MAX_RETRIES_429 + 1):
        try:
            return _ORIGINAL_CHAT(**kwargs)
        except Exception as exc:  # noqa: BLE001 — bridge must not crash the run
            last = exc
            if not _is_rate_limit(exc) or attempt == config.MAX_RETRIES_429:
                raise
            time.sleep(delay)
            delay *= 2
    assert last is not None  # unreachable; for type-checkers
    raise last


def _install_global_backoff() -> bool:
    """Route ALL of LLM_Call's Cohere calls through the backoff wrapper.

    The guide-answer call (call_cohere_guide) and the Cypher-generation call
    (generate_query_api_cypher) invoke ``COHERE_CLIENT.chat`` directly inside the
    backend, so without this they get no 429 protection — only the judge would.
    Reassigning the instance attribute shadows the method for our process only
    (the Flask app is not running here) and changes no request parameters; it is
    purely a retry. Best-effort: if the SDK forbids the assignment, the judge is
    still protected because judge_raw calls _chat_with_backoff directly.
    """
    try:
        _LLM.COHERE_CLIENT.chat = _chat_with_backoff
        return True
    except Exception:  # noqa: BLE001 — e.g. __slots__ without __dict__
        return False


BACKOFF_INSTALLED = _install_global_backoff()


# --- Retrieval --------------------------------------------------------------
def retrieve(
    question: str,
    session_id: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None,
) -> Optional[dict]:
    """``retrieve_neo4j_context`` as-is, preserving the None-vs-empty distinction.

    Returns either ``{"message", "cypher", "rows"}`` or ``None``:

    * ``None``  -> retrieval could not run: Neo4j unconfigured, an HTTP/connection
      error, a Neo4j-reported query error, or the LLM produced invalid /
      non-read-only Cypher. (So None is NOT proof that "Neo4j is down".)
    * dict with ``rows == []`` -> the query ran and matched nothing.
    * dict with non-empty ``rows`` -> hits. NOTE: row column keys are dynamic
      (whatever the generated Cypher chose to RETURN); never assume key names.

    ``cypher`` may be ``None`` (the in-except artwork recovery path), so treat it
    as Optional[str].
    """
    return _LLM.retrieve_neo4j_context(question, session_id, room=room, artwork=artwork)


def classify_retrieval(result: Optional[dict]) -> str:
    """Map a retrieve() result to one of: 'error' | 'empty' | 'hits'."""
    if result is None:
        return "error"
    return "empty" if not result.get("rows") else "hits"


# --- Answer generation ------------------------------------------------------
def answer(
    question: str,
    session_id: str,
    graph_context: Optional[dict],
    language: str = config.GUIDE_LANGUAGE,
) -> str:
    """Generate a guide answer via the plain Cohere path (call_cohere_guide).

    Calls call_cohere_guide directly, bypassing call_llm's iDEM/easy-read branch,
    so there is exactly one model path to reason about. All accessibility/style
    flags are held at their defaults (simple_language / visual_descriptions /
    more_time = False) so the answer is not perturbed by style transforms.
    Passing ``graph_context=None`` is valid — the prompt simply omits the
    "RETRIEVED NEO4J CONTEXT" section.
    """
    return _LLM.call_cohere_guide(
        message=question,
        session_id=session_id,
        language=language,
        graph_context=graph_context,
        simple_language=False,
        visual_descriptions=False,
        more_time=False,
    )


# --- Judge ------------------------------------------------------------------
def judge_raw(system: str, user: str) -> str:
    """Stateless judge call: no conversation_id; temperature/seed for determinism.

    The judge is the one Cohere call the harness fully controls, so we pin
    temperature (and seed if configured). If a future SDK rejects those kwargs
    we retry without them rather than failing the run.
    """
    base = dict(model=config.JUDGE_MODEL, preamble=system, message=user)
    try:
        kwargs = dict(base)
        kwargs["temperature"] = config.JUDGE_TEMPERATURE
        if config.JUDGE_SEED is not None:
            kwargs["seed"] = config.JUDGE_SEED
        response = _chat_with_backoff(**kwargs)
    except TypeError:
        # SDK does not accept temperature/seed on chat(); fall back to plain call.
        response = _chat_with_backoff(**base)
    return response.text


# --- Cultural-bias classifier (Part 3) --------------------------------------
def classify_raw(system: str, user: str) -> str:
    """Stateless cultural-narrative classifier call. Same shape as judge_raw.

    Pins temperature (and seed if configured) so the classification of a given
    answer is as reproducible as the SDK allows — the classifier is, like the
    judge, a Cohere call the harness fully controls. Falls back to a plain call
    if a future SDK rejects those kwargs.
    """
    base = dict(model=config.CLASSIFIER_MODEL, preamble=system, message=user)
    try:
        kwargs = dict(base)
        kwargs["temperature"] = config.CLASSIFIER_TEMPERATURE
        if config.CLASSIFIER_SEED is not None:
            kwargs["seed"] = config.CLASSIFIER_SEED
        response = _chat_with_backoff(**kwargs)
    except TypeError:
        response = _chat_with_backoff(**base)
    return response.text
