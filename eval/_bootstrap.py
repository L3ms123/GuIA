"""Environment validation + sys.path shim for importing the GuIA backend.

Import this FIRST, before any ``import LLM_Call``. The backend module has
import-time side effects that make a naive import fragile:

* ``LLM/LLM_Call.py`` runs ``load_dotenv(LLM/.env)`` at import (:32) and builds
  ``COHERE_CLIENT = cohere.Client(os.environ["COHERE_LLM_KEY"])`` at :36, which
  raises a bare ``KeyError`` at import time if the key is missing.
* ``LLM/`` is not a Python package (no ``__init__.py``) and ``LLM_Call`` does
  *sibling* imports (``import analytics`` / ``from unresolved_questions import
  ...``). So ``from LLM.LLM_Call import ...`` breaks those siblings.

Therefore we validate env first, then put the ``LLM/`` directory on ``sys.path``
and ``import LLM_Call`` directly (resolving the file, not the package). Its
sibling imports still resolve: run as ``python -m eval.part1_faithfulness`` the
repo root stays on ``sys.path``, so ``from LLM import analytics`` succeeds via
the ``try`` branch (``LLM/`` is a PEP 420 implicit namespace package — it has no
``__init__.py``); the bare ``import analytics`` fallback only matters if the repo
root is absent from the path. Either way the import works. This mirrors the
verified "LLM_Call import quirks" approach.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LLM_DIR = REPO_ROOT / "LLM"
ENV_FILE = LLM_DIR / ".env"

COHERE_KEY = "COHERE_LLM_KEY"
NEO4J_KEYS = ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD")

_llm_module = None  # memoised LLM_Call module


def _load_env_file() -> None:
    """Populate ``os.environ`` from ``LLM/.env`` *before* importing LLM_Call.

    LLM_Call loads the same file at import, but we need the key visible to our
    own validation first. Uses python-dotenv (already a project dependency);
    falls back to a tiny stdlib parser if it is somehow unavailable. Never
    overrides values already present in the environment.
    """
    try:
        from dotenv import load_dotenv

        load_dotenv(dotenv_path=ENV_FILE)
        return
    except Exception:
        pass  # fall through to the stdlib parser

    if not ENV_FILE.exists():
        return
    for raw_line in ENV_FILE.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def missing_cohere() -> bool:
    return not os.environ.get(COHERE_KEY)


def missing_neo4j() -> list[str]:
    return [k for k in NEO4J_KEYS if not os.environ.get(k)]


def preflight(require_neo4j: bool = False, warn_neo4j: bool = True) -> None:
    """Validate env and exit cleanly with a friendly message if misconfigured.

    Never prints secret values. Call from every entry point before ``load_llm``.
    Neo4j is only a warning by default for Part 1: without it every retrieval
    returns ``None`` (counted as retrieval_error), which the metrics surface
    explicitly rather than masquerading as "0% recall".
    """
    _load_env_file()
    if missing_cohere():
        print(
            f"[eval] Missing required env var {COHERE_KEY}.\n"
            f"       Set it in your environment or in {ENV_FILE}.\n"
            f"       (LLM_Call builds the Cohere client at import time and needs this key.)",
            file=sys.stderr,
        )
        raise SystemExit(2)

    missing = missing_neo4j()
    if missing:
        msg = (
            f"[eval] Neo4j is not fully configured (missing: {', '.join(missing)}).\n"
            f"       retrieve_neo4j_context() will return None for every question, so every\n"
            f"       item is counted as a retrieval_error and the grounded bucket cannot get\n"
            f"       graph rows. {{tail}}"
        )
        if require_neo4j:
            print(msg.format(tail="Aborting."), file=sys.stderr)
            raise SystemExit(2)
        if warn_neo4j:
            print(
                msg.format(
                    tail="The run will still complete; the retrieval_error_rate metric makes this explicit."
                ),
                file=sys.stderr,
            )


def load_llm():
    """Validate the Cohere key, fix ``sys.path``, import and return LLM_Call (once)."""
    global _llm_module
    if _llm_module is not None:
        return _llm_module

    if missing_cohere():
        _load_env_file()
    if missing_cohere():
        print(
            f"[eval] Missing required env var {COHERE_KEY}; cannot import the backend.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    # Inject the OS/Windows certificate store so httpx trusts corporate TLS proxies.
    # Must happen before `import LLM_Call` because cohere.Client is created at
    # module level (:36) and opens HTTPS connections on its first call.
    try:
        import truststore
        truststore.inject_into_ssl()
    except ImportError:
        pass  # truststore not installed; SSL will use the default certifi bundle

    llm_path = str(LLM_DIR)
    if llm_path not in sys.path:
        # Put LLM/ first so `import LLM_Call` resolves the file directly. Its
        # `from LLM import analytics` still succeeds because the repo root remains
        # on sys.path (LLM resolves as a PEP 420 namespace package); the bare
        # `import analytics` fallback only matters if the repo root is absent.
        sys.path.insert(0, llm_path)

    import LLM_Call  # noqa: E402  (deliberately imported after the sys.path shim)

    _llm_module = LLM_Call
    return _llm_module
