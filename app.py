import os
import json
import unicodedata
from pathlib import Path

import pandas as pd
from flask import Response, jsonify, request, send_file, send_from_directory
from neo4j import GraphDatabase


def register_env_aliases() -> None:
    aliases = {
        "NEO4J_URI": "AURA_URI",
        "NEO4J_USERNAME": "AURA_USER",
        "NEO4J_PASSWORD": "AURA_PASSWORD",
    }
    for target, source in aliases.items():
        if not os.getenv(target) and os.getenv(source):
            os.environ[target] = os.environ[source]


register_env_aliases()

from LLM.LLM_Call import app
from frontend.audio_api import app as audio_app
from LLM.analytics import ANALYTICS_ENABLED, ANALYTICS_PATH
from LLM.unresolved_questions import get_pending_question, list_pending_questions, mark_question_resolved


ROOT = Path(__file__).resolve().parent
FRONTEND_DIR = ROOT / "frontend"

ADMIN_NODE_CONFIG = {
    "artpiece": {
        "label": "ArtPiece",
        "id_col": "artwork_id",
        "sep": ",",
        "mapping": {
            "INV.": "artwork_id",
            "AUTORIA": "artist",
            "DATACIO": "dating",
            "TECNICA / TIPOLOGIA": "technique",
            "TITOL / DESCRIPCIO": "title",
            "DESCRIPTION": "description",
        },
        "cypher": """
        MERGE (a:ArtPiece {artwork_id: $id})
        SET a += $params
        WITH a
        OPTIONAL MATCH (ar:Artist {name: $params.artist})
        FOREACH (_ IN CASE WHEN ar IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:CREATED_BY]->(ar))
        OPTIONAL MATCH (t:Technique {name: $params.technique})
        FOREACH (_ IN CASE WHEN t IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:USES_TECHNIQUE]->(t))
        """,
    },
    "visualdescription": {
        "label": "VisualDescription",
        "id_col": "artwork_id",
        "sep": ",",
        "cypher": """
        MATCH (a:ArtPiece {artwork_id: $id})
        MERGE (vd:VisualDescription {artwork_id: $id})
        SET vd += $params
        MERGE (a)-[:HAS_VISUAL_DESCRIPTION]->(vd)
        """,
    },
    "artist": {
        "label": "Artist",
        "id_col": "Author's Name",
        "sep": ";",
        "cypher": """
        MERGE (a:Artist {name: $id})
        SET a += $params
        WITH a
        OPTIONAL MATCH (art:ArtPiece {artist: a.name})
        FOREACH (_ IN CASE WHEN art IS NOT NULL THEN [1] ELSE [] END | MERGE (art)-[:CREATED_BY]->(a))
        """,
    },
    "technique": {
        "label": "Technique",
        "id_col": "Art Technique",
        "sep": ";",
        "cypher": """
        MERGE (t:Technique {name: $id})
        SET t += $params
        WITH t
        OPTIONAL MATCH (a:ArtPiece)
        WHERE a.technique = t.name
        FOREACH (_ IN CASE WHEN a IS NOT NULL THEN [1] ELSE [] END | MERGE (a)-[:USES_TECHNIQUE]->(t))
        """,
    },
}
CURATOR_ENTITY_CONFIG = {
    "Artist": {"idProperty": "name", "properties": {"biography", "Information"}},
    "ArtPiece": {"idProperty": "artwork_id", "alternateIdProperty": "title", "properties": {"description", "dating", "artist", "technique", "title"}},
    "Technique": {"idProperty": "name", "properties": {"description", "Information"}},
    "VisualDescription": {
        "idProperty": "artwork_id",
        "properties": {
            "audio_description", "background", "colors", "composition", "figures_gestures",
            "foreground", "materials_textures", "middle_ground", "mood_atmosphere",
            "objects_symbols", "spatial_order", "subject_matter", "uncertainties", "visual_overview",
        },
    },
}
def register_audio_routes() -> None:
    for rule in audio_app.url_map.iter_rules():
        if rule.endpoint == "static":
            continue

        app.add_url_rule(
            rule.rule,
            endpoint=f"audio_{rule.endpoint}",
            view_func=audio_app.view_functions[rule.endpoint],
            methods=sorted(rule.methods - {"HEAD", "OPTIONS"}),
        )


register_audio_routes()


def get_admin_password() -> str:
    return (os.getenv("ADMIN_PASSWORD") or os.getenv("password") or "").strip()


def require_admin_password():
    configured_password = get_admin_password()
    submitted_password = (
        request.form.get("password")
        or request.headers.get("X-Admin-Password")
        or (request.get_json(silent=True) or {}).get("password")
        or ""
    )
    if not configured_password:
        return jsonify({"error": "Admin password is not configured."}), 500
    if submitted_password != configured_password:
        return jsonify({"error": "Invalid admin password."}), 401
    return None


def get_neo4j_driver():
    uri = (os.getenv("AURA_URI") or os.getenv("NEO4J_URI") or "").strip()
    user = (os.getenv("AURA_USER") or os.getenv("NEO4J_USERNAME") or "").strip()
    password = (os.getenv("AURA_PASSWORD") or os.getenv("NEO4J_PASSWORD") or "").strip()

    missing = [
        name
        for name, value in (
            ("AURA_URI or NEO4J_URI", uri),
            ("AURA_USER or NEO4J_USERNAME", user),
            ("AURA_PASSWORD or NEO4J_PASSWORD", password),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(f"Missing Neo4j configuration: {', '.join(missing)}")
    return GraphDatabase.driver(uri, auth=(user, password))


def read_upload_dataframe(file_storage, config):
    filename = (file_storage.filename or "").lower()
    if filename.endswith(".csv"):
        try:
            return pd.read_csv(file_storage.stream, sep=config["sep"], encoding="utf-8")
        except UnicodeDecodeError:
            file_storage.stream.seek(0)
            return pd.read_csv(file_storage.stream, sep=config["sep"], encoding="latin1")

    if filename.endswith(".xlsx"):
        return pd.read_excel(file_storage.stream, header=1)

    raise ValueError("Unsupported file type. Upload a CSV or XLSX file.")


def normalize_columns(df):
    df = df.copy()
    df.columns = df.columns.astype(str).str.strip()
    return df


def normalize_header(value):
    without_accents = unicodedata.normalize("NFKD", str(value))
    ascii_text = without_accents.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_text.upper().split())


def apply_mapping(df, mapping):
    if not mapping:
        return df

    normalized_columns = {normalize_header(column): column for column in df.columns}
    selected = {}
    missing = []
    for source, target in mapping.items():
        original = normalized_columns.get(normalize_header(source))
        if original is None:
            missing.append(source)
        else:
            selected[original] = target

    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")
    return df[list(selected.keys())].rename(columns=selected)


def sync_dataframe(config, df):
    id_col = config["id_col"]
    if id_col not in df.columns:
        raise ValueError(f"Column '{id_col}' not found. Available columns: {', '.join(df.columns)}")

    rows = df.where(pd.notnull(df), None).to_dict(orient="records")
    count = 0
    database = os.getenv("NEO4J_DATABASE") or "neo4j"
    with get_neo4j_driver() as driver:
        with driver.session(database=database) as session:
            for row in rows:
                row_id = row.get(id_col)
                if row_id is None or str(row_id).strip() == "":
                    continue
                params = dict(row)
                params.pop(id_col, None)
                session.run(config["cypher"], id=str(row_id), params=params)
                count += 1
    return count


def run_neo4j_query(statement, **parameters):
    database = os.getenv("NEO4J_DATABASE") or "neo4j"
    with get_neo4j_driver() as driver:
        with driver.session(database=database) as session:
            return [record.data() for record in session.run(statement, **parameters)]


def read_analytics_events(limit=10000):
    path = ANALYTICS_PATH
    if not path.exists():
        return []

    events = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                continue
            if len(events) > limit:
                events = events[-limit:]
    return events


def increment(counter, key):
    if key is None or key == "":
        return
    counter[str(key)] = counter.get(str(key), 0) + 1


def summarize_analytics(events):
    sessions = {}
    totals = {
        "events": len(events),
        "visits": 0,
        "questions": 0,
        "locations": 0,
        "completedOnboarding": 0,
    }
    lang_counts = {}
    age_counts = {}
    persona_counts = {}
    pref_counts = {}
    room_counts = {}
    question_lengths = []
    recent_visits = []

    for event in events:
        visit_id = event.get("visitId") or event.get("sessionId") or "unknown"
        session = sessions.setdefault(
            visit_id,
            {
                "visitId": visit_id,
                "sessionId": event.get("sessionId"),
                "startedAt": event.get("ts"),
                "endedAt": None,
                "lang": None,
                "age": None,
                "persona": None,
                "prefs": {},
                "rooms": [],
                "artworks": [],
                "questions": 0,
                "questionChars": 0,
                "durationMs": None,
            },
        )
        session["endedAt"] = event.get("ts") or session["endedAt"]

        event_type = event.get("event")
        if event_type == "session_start":
            session["lang"] = event.get("lang") or session["lang"]
            increment(lang_counts, event.get("lang"))
        elif event_type == "onboarding_completed":
            totals["completedOnboarding"] += 1
            session["lang"] = event.get("lang") or session["lang"]
            session["age"] = event.get("age") or session["age"]
            session["persona"] = event.get("persona") or session["persona"]
            if isinstance(event.get("prefs"), dict):
                session["prefs"].update(event["prefs"])
            increment(lang_counts, event.get("lang"))
            increment(age_counts, event.get("age") or "not selected")
            increment(persona_counts, event.get("persona"))
            for key, value in session["prefs"].items():
                if value:
                    increment(pref_counts, key)
        elif event_type == "option_changed":
            field = event.get("field")
            value = event.get("to")
            if field == "lang":
                session["lang"] = value
                increment(lang_counts, value)
            elif field == "age":
                session["age"] = value
                increment(age_counts, value or "not selected")
            elif field == "persona":
                session["persona"] = value
                increment(persona_counts, value)
            elif isinstance(field, str) and field.startswith("pref:"):
                pref = field.split(":", 1)[1]
                session["prefs"][pref] = bool(value)
                if value:
                    increment(pref_counts, pref)
        elif event_type == "location_visited":
            totals["locations"] += 1
            room = event.get("roomId")
            artwork = event.get("artworkId")
            if room and room not in session["rooms"]:
                session["rooms"].append(room)
            if artwork and artwork not in session["artworks"]:
                session["artworks"].append(artwork)
            increment(room_counts, room or "no room selected")
        elif event_type == "question_asked":
            msg_len = int(event.get("msgLen") or 0)
            totals["questions"] += 1
            session["questions"] += 1
            session["questionChars"] += msg_len
            question_lengths.append(msg_len)
            session["lang"] = event.get("lang") or session["lang"]
            increment(lang_counts, event.get("lang"))
        elif event_type == "session_end":
            session["durationMs"] = event.get("durationMs")

    totals["visits"] = len(sessions)
    avg_question_chars = round(sum(question_lengths) / len(question_lengths), 1) if question_lengths else 0
    recent_visits = sorted(
        sessions.values(),
        key=lambda item: item.get("endedAt") or item.get("startedAt") or "",
        reverse=True,
    )[:20]

    for visit in recent_visits:
        visit["avgQuestionChars"] = round(visit["questionChars"] / visit["questions"], 1) if visit["questions"] else 0

    return {
        "enabled": ANALYTICS_ENABLED,
        "path": str(ANALYTICS_PATH),
        "totals": totals,
        "questionChars": {
            "avg": avg_question_chars,
            "min": min(question_lengths) if question_lengths else 0,
            "max": max(question_lengths) if question_lengths else 0,
        },
        "languages": lang_counts,
        "ages": age_counts,
        "personas": persona_counts,
        "preferences": pref_counts,
        "rooms": room_counts,
        "recentVisits": recent_visits,
    }


@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/admin")
@app.route("/admin/")
def admin():
    return send_from_directory(FRONTEND_DIR, "admin.html")


@app.route("/admin/api/status", methods=["POST"])
def admin_status():
    denied = require_admin_password()
    if denied:
        return denied

    neo4j_configured = all(
        (os.getenv(aura) or os.getenv(neo4j))
        for aura, neo4j in (
            ("AURA_URI", "NEO4J_URI"),
            ("AURA_USER", "NEO4J_USERNAME"),
            ("AURA_PASSWORD", "NEO4J_PASSWORD"),
        )
    )
    return jsonify({"ok": True, "neo4jConfigured": neo4j_configured, "analyticsEnabled": ANALYTICS_ENABLED})


@app.route("/admin/api/analytics", methods=["POST"])
def admin_analytics():
    denied = require_admin_password()
    if denied:
        return denied

    try:
        return jsonify({"ok": True, "analytics": summarize_analytics(read_analytics_events())})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/admin/api/analytics/download", methods=["POST"])
def admin_analytics_download():
    denied = require_admin_password()
    if denied:
        return denied

    if not ANALYTICS_PATH.exists():
        return jsonify({"error": "Analytics file does not exist yet."}), 404

    return send_file(
        ANALYTICS_PATH,
        mimetype="application/jsonl",
        as_attachment=True,
        download_name="sessions.jsonl",
    )


@app.route("/admin/api/unresolved", methods=["POST"])
def admin_unresolved_questions():
    denied = require_admin_password()
    if denied:
        return denied
    try:
        questions = [
            {key: value for key, value in question.items() if key != "failedCypher"}
            for question in list_pending_questions()
        ]
        return jsonify({"ok": True, "questions": questions})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/admin/api/unresolved/<question_id>/resolve", methods=["POST"])
def admin_resolve_unresolved_question(question_id):
    denied = require_admin_password()
    if denied:
        return denied
    data = request.get_json(silent=True) or {}
    action = str(data.get("action") or "").strip().lower()
    if action not in {"accept", "reject"}:
        return jsonify({"error": "Action must be accept or reject."}), 400
    try:
        if action == "reject":
            if not mark_question_resolved(question_id, "rejected"):
                return jsonify({"error": "Pending question not found."}), 404
        else:
            question = get_pending_question(question_id)
            if not question:
                return jsonify({"error": "Pending question not found."}), 404
            submitted_updates = data.get("updates") if isinstance(data.get("updates"), dict) else {}
            inferred_updates = question.get("inferredUpdates") or []
            if not inferred_updates:
                return jsonify({"error": "The failed query did not identify a supported missing graph field."}), 400
            for update in inferred_updates:
                submitted = submitted_updates.get(update["key"]) if isinstance(submitted_updates.get(update["key"]), dict) else {}
                entity_label = update["entityLabel"]
                config = CURATOR_ENTITY_CONFIG[entity_label]
                entity_id = str(submitted.get("entityId") or update.get("entityId") or "").strip()
                node_match = f"n.{config['idProperty']} = $entityId"
                if config.get("alternateIdProperty"):
                    node_match += f" OR n.{config['alternateIdProperty']} = $entityId"
                if update["kind"] == "property":
                    property_value = str(submitted.get("value") or "").strip()
                    if not entity_id or not property_value:
                        return jsonify({"error": f"Complete the field: {update['fieldLabel']}."}), 400
                    rows = run_neo4j_query(
                        f"MATCH (n:{entity_label}) WHERE {node_match} SET n += $properties RETURN elementId(n) AS id",
                        entityId=entity_id,
                        properties={update["propertyName"]: property_value},
                    )
                else:
                    target_label = update["targetLabel"]
                    target_config = CURATOR_ENTITY_CONFIG[target_label]
                    target_id = str(submitted.get("targetId") or update.get("targetId") or "").strip()
                    if not entity_id or not target_id:
                        return jsonify({"error": f"Complete the field: {update['fieldLabel']}."}), 400
                    rows = run_neo4j_query(
                        f"""
                        MATCH (n:{entity_label}) WHERE {node_match}
                        MATCH (target:{target_label} {{{target_config['idProperty']}: $targetId}})
                        MERGE (n)-[:{update['relationshipType']}]->(target)
                        RETURN elementId(n) AS id
                        """,
                        entityId=entity_id,
                        targetId=target_id,
                    )
                if not rows:
                    return jsonify({"error": f"Graph entity not found for: {update['fieldLabel']}."}), 404
            mark_question_resolved(question_id, "accepted")
        return jsonify({"ok": True, "id": question_id, "status": f"{action}ed"})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/admin/api/upload/<node_type>", methods=["POST"])
def admin_upload(node_type):
    denied = require_admin_password()
    if denied:
        return denied

    config = ADMIN_NODE_CONFIG.get(node_type.lower())
    if not config:
        return jsonify({"error": "Unknown upload type."}), 404

    file_storage = request.files.get("file")
    if not file_storage:
        return jsonify({"error": "No file was uploaded."}), 400

    try:
        df = normalize_columns(read_upload_dataframe(file_storage, config))
        df = apply_mapping(df, config.get("mapping"))
        count = sync_dataframe(config, df)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify({"ok": True, "label": config["label"], "count": count})


@app.route("/favicon.ico")
def favicon():
    return Response(status=204)


@app.route("/<path:filename>")
def frontend_file(filename):
    return send_from_directory(FRONTEND_DIR, filename)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "7860"))
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)
