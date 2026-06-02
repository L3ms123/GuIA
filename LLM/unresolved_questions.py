import hashlib
import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


ROOT = Path(__file__).resolve().parents[1]
UNRESOLVED_PATH = Path(
    os.getenv("GUIA_UNRESOLVED_PATH") or ROOT / "analytics" / "unresolved_questions.json"
)
LOCK = threading.Lock()


def normalize_question(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


ENTITY_PROPERTIES = {
    "Artist": {"biography", "Information"},
    "ArtPiece": {"description", "dating", "artist", "technique", "title"},
    "Technique": {"description", "Information"},
    "VisualDescription": {
        "visual_overview", "audio_description", "background", "colors", "composition",
        "figures_gestures", "foreground", "materials_textures", "middle_ground",
        "mood_atmosphere", "objects_symbols", "spatial_order", "subject_matter", "uncertainties",
    },
}
ENTITY_IDS = {"Artist": "name", "ArtPiece": "artwork_id", "Technique": "name", "VisualDescription": "artwork_id"}
RELATIONSHIPS = {
    "CREATED_BY": ("ArtPiece", "Artist"),
    "USES_TECHNIQUE": ("ArtPiece", "Technique"),
    "HAS_VISUAL_DESCRIPTION": ("ArtPiece", "VisualDescription"),
    "CONTEMPORARY_OF": ("Artist", "Artist"),
}
def infer_missing_updates(failed_cypher: str, artwork: Optional[str]) -> list[dict[str, str]]:
    if not failed_cypher:
        return []
    aliases = {
        alias: label
        for alias, label in re.findall(r"\(\s*(\w+)\s*:\s*(\w+)", failed_cypher)
        if label in ENTITY_PROPERTIES
    }
    returned_fields = re.split(r"\bRETURN\b", failed_cypher, flags=re.IGNORECASE)[-1]
    property_candidates = [
        (aliases.get(alias), property_name)
        for alias, property_name in re.findall(r"\b(\w+)\.(\w+)\b", returned_fields)
        if aliases.get(alias) in ENTITY_PROPERTIES and property_name in ENTITY_PROPERTIES[aliases[alias]]
    ]
    identifiers: dict[str, str] = {}
    for alias, property_name, value in re.findall(r"\b(\w+)\.(\w+)\s*=\s*['\"]([^'\"]+)['\"]", failed_cypher):
        label = aliases.get(alias)
        if label and property_name in {ENTITY_IDS.get(label), "title"}:
            identifiers[alias] = value
    updates = []
    seen = set()
    for label, property_name in property_candidates:
        alias = next((candidate_alias for candidate_alias, candidate_label in aliases.items() if candidate_label == label), "")
        entity_id = identifiers.get(alias) or (artwork if label in {"ArtPiece", "VisualDescription"} else "") or ""
        key = f"property:{label}:{entity_id}:{property_name}"
        if key in seen:
            continue
        seen.add(key)
        updates.append({
            "key": key,
            "kind": "property",
            "entityLabel": label,
            "entityId": entity_id,
            "propertyName": property_name,
            "fieldLabel": f"{property_name.replace('_', ' ').title()} of {entity_id or label}",
        })
    if updates:
        return updates
    for relationship_type, (source_label, target_label) in RELATIONSHIPS.items():
        if not re.search(rf":\s*{relationship_type}\b", failed_cypher, flags=re.IGNORECASE):
            continue
        source_alias = next((alias for alias, label in aliases.items() if label == source_label), "")
        target_alias = next((alias for alias, label in aliases.items() if label == target_label and alias != source_alias), "")
        source_id = identifiers.get(source_alias) or (artwork if source_label == "ArtPiece" else "") or ""
        target_id = identifiers.get(target_alias) or ""
        return [{
            "key": f"relationship:{relationship_type}:{source_id}:{target_id}",
            "kind": "relationship",
            "entityLabel": source_label,
            "entityId": source_id,
            "relationshipType": relationship_type,
            "targetLabel": target_label,
            "targetId": target_id,
            "fieldLabel": f"{target_label} linked by {relationship_type.replace('_', ' ').title()}",
        }]
    return []


def _read_items() -> list[dict[str, Any]]:
    if not UNRESOLVED_PATH.exists():
        return []
    try:
        data = json.loads(UNRESOLVED_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def _write_items(items: list[dict[str, Any]]) -> None:
    UNRESOLVED_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = UNRESOLVED_PATH.with_suffix(".tmp")
    temporary_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary_path.replace(UNRESOLVED_PATH)


def record_unresolved_question(
    question: str,
    language: str,
    room: Optional[str],
    artwork: Optional[str],
    failed_cypher: Optional[str],
) -> None:
    normalized = normalize_question(question)
    if not normalized:
        return
    now = datetime.now(timezone.utc).isoformat()
    question_id = hashlib.sha256(f"{normalized}|{room or ''}|{artwork or ''}".encode("utf-8")).hexdigest()[:24]
    with LOCK:
        items = _read_items()
        existing = next((item for item in items if item.get("id") == question_id), None)
        if existing:
            existing["askCount"] = int(existing.get("askCount") or 0) + 1
            existing["lastAskedAt"] = now
            if failed_cypher:
                existing["failedCypher"] = failed_cypher
            if existing.get("status") != "pending":
                existing["status"] = "pending"
                existing.pop("resolvedAt", None)
        else:
            items.append(
                {
                    "id": question_id,
                    "question": question.strip(),
                    "questionNormalized": normalized,
                    "language": language,
                    "roomId": room,
                    "artworkId": artwork,
                    "askCount": 1,
                    "createdAt": now,
                    "lastAskedAt": now,
                    "status": "pending",
                    "failedCypher": failed_cypher or "",
                }
            )
        _write_items(items)


def list_pending_questions() -> list[dict[str, Any]]:
    with LOCK:
        items = [item for item in _read_items() if item.get("status") == "pending"]
    for item in items:
        item["inferredUpdates"] = infer_missing_updates(item.get("failedCypher", ""), item.get("artworkId"))
    return sorted(items, key=lambda item: item.get("lastAskedAt") or item.get("createdAt") or "", reverse=True)


def get_pending_question(question_id: str) -> Optional[dict[str, Any]]:
    return next((item for item in list_pending_questions() if item.get("id") == question_id), None)


def mark_question_resolved(question_id: str, status: str) -> bool:
    with LOCK:
        items = _read_items()
        item = next((entry for entry in items if entry.get("id") == question_id and entry.get("status") == "pending"), None)
        if not item:
            return False
        item["status"] = status
        item["resolvedAt"] = datetime.now(timezone.utc).isoformat()
        _write_items(items)
    return True
