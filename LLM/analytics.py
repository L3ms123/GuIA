"""
Session analytics logging for GuIA.

Writes one JSON event per line (JSONL) to a local file. Collection is gated
behind the GUIA_ANALYTICS_ENABLED flag and is OFF by default, so production
deployments record nothing and the onboarding privacy notice stays true.

Only metadata is stored (counts, lengths, flags, timestamps, language, options,
locations, latencies). The text of user questions and model answers is never
written here.
"""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


SCHEMA_VERSION = 1

# Truthy values for the testing flag. Anything else (incl. unset) means OFF.
_TRUTHY = {"1", "true", "yes", "on"}
ANALYTICS_ENABLED = (os.getenv("GUIA_ANALYTICS_ENABLED") or "").strip().lower() in _TRUTHY

_PERSISTENT_DATA_DIR = Path("/data")
_DEFAULT_PATH = (
    _PERSISTENT_DATA_DIR / "analytics" / "sessions.jsonl"
    if _PERSISTENT_DATA_DIR.exists()
    else Path(__file__).resolve().parents[1] / "analytics" / "sessions.jsonl"
)
ANALYTICS_PATH = Path(os.getenv("GUIA_ANALYTICS_PATH") or _DEFAULT_PATH)

# gunicorn runs a single worker, but the streaming endpoint uses threads, so a
# module-level lock keeps appends atomic.
_LOCK = threading.Lock()
_DIR_READY = False

# Event types accepted from the frontend. Backend-emitted events are appended
# directly and are not validated against this set.
FRONTEND_EVENTS = {
    "session_start",
    "onboarding_completed",
    "option_changed",
    "location_visited",
    "question_asked",
    "answer_timing",
    "session_end",
}

# Maximum characters kept for any string value, as a defensive guard so that
# free-text never accidentally lands in the analytics file.
_MAX_STR_CHARS = 120


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sanitize(value: Any, _depth: int = 0) -> Any:
    """Truncate strings and bound nesting so no large free-text is persisted."""
    if isinstance(value, str):
        return value[:_MAX_STR_CHARS]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value
    if _depth >= 3:
        return None
    if isinstance(value, dict):
        return {str(k)[:64]: _sanitize(v, _depth + 1) for k, v in list(value.items())[:30]}
    if isinstance(value, (list, tuple)):
        return [_sanitize(item, _depth + 1) for item in list(value)[:30]]
    return str(value)[:_MAX_STR_CHARS]


def _ensure_dir() -> None:
    global _DIR_READY
    if _DIR_READY:
        return
    ANALYTICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    _DIR_READY = True


def log_event(
    event_type: str,
    payload: Optional[dict[str, Any]] = None,
    *,
    visit_id: Optional[str] = None,
    session_id: Optional[str] = None,
    client_ts: Optional[str] = None,
    source: str = "backend",
) -> None:
    """Append one analytics event. No-op when disabled. Never raises."""
    if not ANALYTICS_ENABLED:
        return

    try:
        record: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "event": event_type,
            "ts": _now_iso(),
            "source": source,
            "visitId": visit_id,
            "sessionId": session_id,
        }
        if client_ts:
            record["clientTs"] = str(client_ts)[:64]
        for key, value in _sanitize(payload or {}).items():
            if key not in record:
                record[key] = value

        line = json.dumps(record, ensure_ascii=False) + "\n"
        with _LOCK:
            _ensure_dir()
            with open(ANALYTICS_PATH, "a", encoding="utf-8") as handle:
                handle.write(line)
    except Exception:
        # Analytics must never break the app. Best-effort logging only.
        try:
            from flask import current_app

            current_app.logger.warning("Analytics log_event failed", exc_info=True)
        except Exception:
            pass


def log_frontend_event(event: dict[str, Any]) -> bool:
    """Validate and log one event coming from the frontend. Returns True if logged."""
    if not ANALYTICS_ENABLED:
        return False
    if not isinstance(event, dict):
        return False

    event_type = event.get("event")
    if event_type not in FRONTEND_EVENTS:
        return False

    payload = {
        key: value
        for key, value in event.items()
        if key not in {"event", "visitId", "sessionId", "clientTs", "schema_version", "source", "ts"}
    }
    log_event(
        event_type,
        payload,
        visit_id=event.get("visitId"),
        session_id=event.get("sessionId"),
        client_ts=event.get("clientTs"),
        source="frontend",
    )
    return True
