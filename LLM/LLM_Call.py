"""
This file contains everything necessary to call the LLM with the input received from the RAG + initial query and then return the output.
"""

import os
import json
import base64
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from dotenv import load_dotenv
import cohere
from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS

# Load environment variables from .env file
load_dotenv(dotenv_path=Path(__file__).with_name(".env"))

# LLM DEFAULTS
MODEL_USED = "command-a-03-2025"
COHERE_CLIENT = cohere.Client(os.environ["COHERE_LLM_KEY"])
NEO4J_REQUIRED_ENV = ("NEO4J_URI", "NEO4J_USERNAME", "NEO4J_PASSWORD")
RAW_DATA_FILE = Path(__file__).resolve().parents[1] / "raw_data" / "2026_obres_Museu_del_Renaixement.xlsx"
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
LOCATION_CACHE = {"mtime": None, "data": None}
WRITE_CYPHER_KEYWORDS = re.compile(
    r"\b(CREATE|MERGE|DELETE|DETACH|SET|REMOVE|DROP|LOAD\s+CSV|CALL\s*\{\s*.*IN\s+TRANSACTIONS)\b",
    re.IGNORECASE | re.DOTALL,
)
LANGUAGE_RULES = {
    "ca": "Answer strictly in Catalan. Use natural, correct Catalan.",
    "es": "Answer strictly in Spanish.",
    "en": "Answer strictly in English.",
    "catalan": "Answer strictly in Catalan. Use natural, correct Catalan.",
    "spanish": "Answer strictly in Spanish.",
    "english": "Answer strictly in English.",
}


def get_language_rule(language: str) -> str:
    key = (language or "en").strip().lower()
    return LANGUAGE_RULES.get(key, "Answer strictly in English.")


def sanitize_chat_text(text: str) -> str:
    """Remove lightweight Markdown markers because the frontend renders plain text."""
    return text.replace("**", "").replace("*", "").replace("__", "").replace("`", "")


def format_chat_text(text: str) -> str:
    """Keep chat answers readable by splitting long plain-text blocks."""
    text = sanitize_chat_text(text).strip()
    if not text:
        return text

    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text) if paragraph.strip()]
    formatted = []
    for paragraph in paragraphs:
        if len(paragraph) <= 420:
            formatted.append(paragraph)
            continue

        sentences = re.split(r"(?<=[.!?])\s+", paragraph)
        current = []
        current_length = 0
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            if current and (current_length + len(sentence) > 360 or len(current) >= 2):
                formatted.append(" ".join(current))
                current = []
                current_length = 0
            current.append(sentence)
            current_length += len(sentence) + 1
        if current:
            formatted.append(" ".join(current))

    return "\n\n".join(formatted)


def safe_console_print(value: Any = "", **kwargs) -> None:
    """Print debug text without crashing on Windows console encoding limits."""
    text = str(value)
    encoding = sys.stdout.encoding or "utf-8"
    safe_text = text.encode(encoding, errors="backslashreplace").decode(encoding)
    print(safe_text, **kwargs)


def normalize_header(value: str) -> str:
    normalized = value.strip().lower()
    for source, target in {
        "à": "a",
        "á": "a",
        "è": "e",
        "é": "e",
        "í": "i",
        "ï": "i",
        "ò": "o",
        "ó": "o",
        "ú": "u",
        "ü": "u",
        "ç": "c",
    }.items():
        normalized = normalized.replace(source, target)
    return re.sub(r"[^a-z0-9]+", "", normalized)


def excel_column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "")
    if not letters:
        return 0

    index = 0
    for char in letters.group(0):
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def read_xlsx_rows(path: Path) -> list[list[str]]:
    """Read the first worksheet from an .xlsx file using only the standard library."""
    with zipfile.ZipFile(path) as archive:
        shared_strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", XLSX_NS):
                shared_strings.append("".join(text.text or "" for text in item.findall(".//a:t", XLSX_NS)))

        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in sheet.findall(".//a:row", XLSX_NS):
            values = []
            for cell in row.findall("a:c", XLSX_NS):
                index = excel_column_index(cell.get("r", ""))
                while len(values) <= index:
                    values.append("")

                value_node = cell.find("a:v", XLSX_NS)
                inline_node = cell.find("a:is", XLSX_NS)
                if cell.get("t") == "s" and value_node is not None:
                    values[index] = shared_strings[int(value_node.text)]
                elif inline_node is not None:
                    values[index] = "".join(text.text or "" for text in inline_node.findall(".//a:t", XLSX_NS))
                elif value_node is not None:
                    values[index] = value_node.text or ""
            rows.append(values)
    return rows


def room_sort_key(room: str) -> tuple[int, int, str]:
    numbers = [int(match) for match in re.findall(r"\d+", room)]
    floor = numbers[0] if numbers else 999
    sala = numbers[1] if len(numbers) > 1 else floor
    return floor, sala, room


def load_locations_from_excel() -> dict[str, Any]:
    """Load rooms and artworks from the raw Excel file, refreshing when it changes."""
    if not RAW_DATA_FILE.exists():
        return {"rooms": []}

    mtime = RAW_DATA_FILE.stat().st_mtime
    if LOCATION_CACHE["mtime"] == mtime and LOCATION_CACHE["data"] is not None:
        return LOCATION_CACHE["data"]

    rows = read_xlsx_rows(RAW_DATA_FILE)
    header_index = next(
        (
            index for index, row in enumerate(rows)
            if any(normalize_header(cell) == "ubic" for cell in row)
        ),
        None,
    )
    if header_index is None:
        return {"rooms": []}

    headers = [normalize_header(cell) for cell in rows[header_index]]
    title_index = next(
        (
            index for index, header in enumerate(headers)
            if header.startswith("titol") or header.startswith("title")
        ),
        None,
    )
    location_index = next(
        (index for index, header in enumerate(headers) if header == "ubic"),
        None,
    )

    if title_index is None or location_index is None:
        return {"rooms": []}

    rooms_by_id: dict[str, dict[str, Any]] = {}
    seen_artworks: dict[str, set[str]] = {}
    for row in rows[header_index + 1:]:
        title = row[title_index].strip() if len(row) > title_index else ""
        room = row[location_index].strip() if len(row) > location_index else ""
        if not title or not room:
            continue

        room_entry = rooms_by_id.setdefault(room, {"id": room, "label": room, "artworks": []})
        room_seen = seen_artworks.setdefault(room, set())
        if title in room_seen:
            continue

        room_seen.add(title)
        room_entry["artworks"].append({"id": title, "title": title})

    data = {
        "rooms": sorted(rooms_by_id.values(), key=lambda item: room_sort_key(item["id"]))
    }
    LOCATION_CACHE["mtime"] = mtime
    LOCATION_CACHE["data"] = data
    return data


# Conversation storage (simple in-memory for now)
SESSION_CONTEXTS = {}


def build_system_prompt(
    language: str = "en",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None
) -> str:
    """Build a dynamic system prompt based on user preferences and context."""

    language_rule = get_language_rule(language)

    prompt = (
        "You are GuIA, an intelligent museum guide assistant. "
        "You answer the user's questions using the retrieved context provided by the "
        "retrieval-augmented generation pipeline. "
        "You answer questions related to museums, artworks, rooms, artists, history and art interpretation. "
        "Do not hallucinate. If the information is not present in the retrieved context, "
        "say that you do not know or that the answer cannot be determined from the provided data. "
        "Format answers for a chat bubble using plain text, not Markdown. "
        "Use short paragraphs and real line breaks. "
        "Keep each paragraph to 1 or 2 sentences. "
        "For a single artwork, answer in 2 or 3 short paragraphs: what it is, why it matters, and one concrete detail. "
        "For lists, use numbered items like '1. Title - explanation'. "
        "Do not use bold markers, tables, headings, or decorative language. "
        "Avoid long monologues and do not end with generic follow-up questions. "
        "If the graph returns many rows, summarize the most relevant 3 to 5 items unless the user asks for all of them. "
        "Do not mention missing fields, null values, NaN values, or unavailable details for individual items. "
        "\n\n"
        f"LANGUAGE RULE: {language_rule} "
        "Do not answer in any other language unless the user explicitly asks you to change language in the current message. "
        "\n\n"
        f"VISITOR PROFILE: The user can be described as: {age_range}. "
        f"Guide them with the personality/style of: {personality}."
    )

    if room or artwork:
        prompt += "\n\nCURRENT MUSEUM CONTEXT:"
        if room:
            prompt += f"\n- Room: {room}"
        if artwork:
            prompt += f"\n- Artwork being viewed: {artwork}"

    if graph_context:
        cypher = graph_context.get("cypher")
        rows = graph_context.get("rows") or []

        prompt += (
            "\n\nRETRIEVED NEO4J CONTEXT:\n"
            "Use these graph database results as factual context for the answer. "
            "If the rows do not answer the user's question, say that the graph does not contain enough information. "
            "Do not mechanically list every returned field. Prefer title, artist, dating, technique, and one concise interpretive detail when available. "
            "If a row only has a title, include the title without apologizing for missing metadata."
        )
        if cypher:
            prompt += f"\nGenerated Cypher: {cypher}"
        prompt += "\nRows:\n"
        prompt += json.dumps(rows, ensure_ascii=False, indent=2)

    return prompt


def neo4j_is_configured() -> bool:
    """Return True when the minimum Neo4j credentials are available."""
    return all(os.getenv(key) for key in NEO4J_REQUIRED_ENV)


def build_query_with_context(
    message: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None
) -> str:
    query = message
    if room or artwork:
        query += "\n\nCurrent museum context:"
        if room:
            query += f"\nRoom: {room}"
        if artwork:
            query += f"\nArtwork: {artwork}"
    return query


def is_read_only_cypher(cypher: str) -> bool:
    cleaned = cypher.strip()
    if not cleaned:
        return False
    return WRITE_CYPHER_KEYWORDS.search(cleaned) is None


def normalize_text_for_cypher(text: str) -> str:
    replacements = {
        "à": "a",
        "á": "a",
        "â": "a",
        "ä": "a",
        "è": "e",
        "é": "e",
        "ê": "e",
        "ë": "e",
        "ì": "i",
        "í": "i",
        "î": "i",
        "ï": "i",
        "ò": "o",
        "ó": "o",
        "ô": "o",
        "ö": "o",
        "ù": "u",
        "ú": "u",
        "û": "u",
        "ü": "u",
        "ç": "c",
        "·": "",
        "'": "",
        "’": "",
        "`": "",
    }
    normalized = text.lower()
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def cypher_fuzzy_text_expression(expression: str) -> str:
    result = f"toLower({expression})"
    for source, target in {
        "à": "a",
        "á": "a",
        "è": "e",
        "é": "e",
        "í": "i",
        "ï": "i",
        "ò": "o",
        "ó": "o",
        "ú": "u",
        "ü": "u",
        "ç": "c",
        "·": "",
        "`": "",
    }.items():
        result = f"replace({result}, '{source}', '{target}')"
    return result


def cypher_case_insensitive_text_expression(expression: str) -> str:
    return f"toLower({expression})"


def cypher_string_literal(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def rewrite_exact_property_matches(cypher: str, normalize_accents: bool = False) -> str:
    """Convert common exact property map matches into fuzzy WHERE predicates."""
    predicates = []

    def replace_map(match: re.Match) -> str:
        variable = match.group("var")
        label = match.group("label")
        properties = match.group("props")

        def property_replacer(property_match: re.Match) -> str:
            key = property_match.group("key")
            value = property_match.group("value")
            normalized_value = normalize_text_for_cypher(value)
            if key.lower() == "id":
                room_digits = re.search(r"\d+", value)
                if room_digits:
                    normalized_value = room_digits.group(0)
            expression = (
                cypher_fuzzy_text_expression(f"{variable}.{key}")
                if normalize_accents
                else cypher_case_insensitive_text_expression(f"{variable}.{key}")
            )
            predicates.append(
                f"{expression} CONTAINS {cypher_string_literal(normalized_value)}"
            )
            return ""

        remaining = re.sub(
            r"(?P<key>title|name|id)\s*:\s*'(?P<value>[^']*)'\s*,?\s*",
            property_replacer,
            properties,
            flags=re.IGNORECASE,
        ).strip().strip(",")

        if remaining:
            return f"({variable}:{label} {{{remaining}}})"
        return f"({variable}:{label})"

    rewritten = re.sub(
        r"\((?P<var>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?P<label>[A-Za-z_][A-Za-z0-9_]*)\s*\{(?P<props>[^}]*)\}\)",
        replace_map,
        cypher,
    )

    if not predicates:
        return cypher

    where_clause = " AND ".join(predicates)
    if re.search(r"\bWHERE\b", rewritten, flags=re.IGNORECASE):
        return re.sub(r"\bWHERE\b", f"WHERE {where_clause} AND", rewritten, count=1, flags=re.IGNORECASE)
    return re.sub(r"\bRETURN\b", f"WHERE {where_clause} RETURN", rewritten, count=1, flags=re.IGNORECASE)


def rewrite_exact_property_matches_to_contains(cypher: str) -> str:
    return rewrite_exact_property_matches(cypher, normalize_accents=False)


def rewrite_exact_property_matches_to_fuzzy(cypher: str) -> str:
    return rewrite_exact_property_matches(cypher, normalize_accents=True)


def user_asked_for_all(message: str) -> bool:
    lowered = message.lower()
    return any(
        phrase in lowered
        for phrase in (
            "all",
            "every",
            "complete list",
            "full list",
            "todas",
            "todos",
            "llista completa",
            "lista completa",
        )
    )


def clean_graph_rows(rows: list[dict[str, Any]], message: str) -> list[dict[str, Any]]:
    """Remove empty graph values and cap broad results before sending them to the LLM."""
    cleaned_rows = []
    for row in rows:
        cleaned = {}
        for key, value in row.items():
            if value is None:
                continue
            if isinstance(value, str) and value.strip().lower() in {"", "nan", "none", "null"}:
                continue
            cleaned[key] = value
        if cleaned:
            cleaned_rows.append(cleaned)

    if user_asked_for_all(message):
        return cleaned_rows
    return cleaned_rows[:5]


def extract_cypher(text: str) -> str:
    """Extract a Cypher statement from an LLM response."""
    match = re.search(r"```(?:cypher)?\s*(.*?)```", text, flags=re.IGNORECASE | re.DOTALL)
    if match:
        text = match.group(1)
    return " ".join(text.strip().strip("`").split())


def get_query_api_url() -> str:
    """Build the Neo4j Query API URL from env vars."""
    explicit_url = os.getenv("NEO4J_QUERY_API_URL")
    if explicit_url:
        return explicit_url.rstrip("/")

    database = os.getenv("NEO4J_DATABASE") or "neo4j"
    uri = os.environ["NEO4J_URI"].strip().rstrip("/")
    host = re.sub(r"^[a-zA-Z0-9+.-]+://", "", uri)
    host = host.split("/", 1)[0]
    return f"https://{host}/db/{database}/query/v2"


def execute_query_api(statement: str, parameters: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
    """Execute one read-only Cypher statement through Neo4j's HTTPS Query API."""
    statement = " ".join(statement.split())
    if not is_read_only_cypher(statement):
        raise ValueError("Refusing to execute non-read-only Cypher through the Query API.")

    credentials = f"{os.environ['NEO4J_USERNAME']}:{os.environ['NEO4J_PASSWORD']}"
    encoded_credentials = base64.b64encode(credentials.encode("utf-8")).decode("ascii")
    payload = json.dumps(
        {"statement": statement, "parameters": parameters or {}},
        ensure_ascii=False,
    ).encode("utf-8")

    request = Request(
        get_query_api_url(),
        data=payload,
        headers={
            "Authorization": f"Basic {encoded_credentials}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Neo4j Query API HTTP {exc.code}: {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"Neo4j Query API connection failed: {exc}") from exc

    data = json.loads(body or "{}")
    errors = data.get("errors") or []
    if errors:
        raise RuntimeError(f"Neo4j Query API returned errors: {errors}")

    result_data = data.get("data") or {}
    fields = result_data.get("fields") or []
    values = result_data.get("values") or []
    return [dict(zip(fields, row)) for row in values]


@lru_cache(maxsize=1)
def get_query_api_schema() -> str:
    """Fetch a compact schema summary using read-only Query API statements."""
    node_rows = execute_query_api(
        """
        MATCH (n)
        WITH labels(n) AS labels, keys(n) AS keys
        UNWIND labels AS label
        UNWIND keys AS property
        RETURN label, collect(DISTINCT property) AS properties
        ORDER BY label
        """
    )
    rel_rows = execute_query_api(
        """
        MATCH (a)-[r]->(b)
        RETURN DISTINCT labels(a) AS from_labels, type(r) AS relationship, labels(b) AS to_labels
        ORDER BY relationship
        LIMIT 200
        """
    )
    rel_property_rows = execute_query_api(
        """
        MATCH ()-[r]->()
        WITH type(r) AS relationship, keys(r) AS keys
        UNWIND keys AS property
        RETURN relationship, collect(DISTINCT property) AS properties
        ORDER BY relationship
        """
    )

    return json.dumps(
        {
            "node_properties": node_rows,
            "relationships": rel_rows,
            "relationship_properties": rel_property_rows,
        },
        ensure_ascii=False,
        indent=2,
    )


def generate_query_api_cypher(query: str) -> str:
    """Generate read-only Cypher for the HTTPS Query API fallback."""
    schema = get_query_api_schema()
    preamble = (
        "You convert natural language questions into read-only Neo4j Cypher. "
        "Return only one Cypher query. Do not include markdown or explanation. "
        "Only use labels, relationship types, and properties present in the schema. "
        "Use MATCH/OPTIONAL MATCH/WITH/WHERE/RETURN/ORDER BY/LIMIT only. "
        "Never use CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, LOAD CSV, or write procedures. "
        "Always include a reasonable LIMIT unless the question asks for a count. "
        "Artwork titles in the graph are often Catalan even when the visitor asks in Spanish or English. "
        "Do not translate title literals to English. Prefer case-insensitive partial matching with CONTAINS for titles and names. "
        "For room questions, prefer matching Sala.id to the numeric room id such as '3', not a full translated room label. "
        "Example: MATCH (a:ArtPiece)-[:LOCATED_IN]->(s:Sala) "
        "WHERE toLower(a.title) CONTAINS 'anunciació' AND s.id = '3' RETURN a.title, a.description LIMIT 5"
    )
    message = f"Schema:\n{schema}\n\nQuestion:\n{query}"
    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble=preamble,
        message=message,
    )
    cypher = extract_cypher(response.text)
    if not is_read_only_cypher(cypher):
        raise ValueError(f"Generated Cypher is not read-only: {cypher}")
    return cypher


def retrieve_neo4j_context_query_api(
    message: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None
) -> Optional[dict[str, Any]]:
    """Fallback graph retrieval using Neo4j Query API over HTTPS."""
    if not neo4j_is_configured():
        return None

    query = build_query_with_context(message, room, artwork)
    try:
        cypher = generate_query_api_cypher(query)
        raw_rows = execute_query_api(cypher)
        if not raw_rows:
            contains_cypher = rewrite_exact_property_matches_to_contains(cypher)
            if contains_cypher != cypher:
                safe_console_print("\n--- NEO4J QUERY API CONTAINS RETRY CYPHER ---", flush=True)
                safe_console_print(contains_cypher, flush=True)
                raw_rows = execute_query_api(contains_cypher)
                if raw_rows:
                    cypher = contains_cypher
        if not raw_rows:
            fuzzy_cypher = rewrite_exact_property_matches_to_fuzzy(cypher)
            if fuzzy_cypher != cypher:
                safe_console_print("\n--- NEO4J QUERY API ACCENT RETRY CYPHER ---", flush=True)
                safe_console_print(fuzzy_cypher, flush=True)
                raw_rows = execute_query_api(fuzzy_cypher)
                if raw_rows:
                    cypher = fuzzy_cypher
        rows = clean_graph_rows(raw_rows, message)
    except Exception as exc:
        safe_console_print("\n--- NEO4J QUERY API FAILED ---", flush=True)
        safe_console_print(str(exc), flush=True)
        safe_console_print("--- END NEO4J QUERY API FAILED ---\n", flush=True)
        return None

    safe_console_print("\n--- NEO4J QUERY API GENERATED CYPHER ---", flush=True)
    safe_console_print(cypher, flush=True)
    safe_console_print("--- NEO4J QUERY API ROWS ---", flush=True)
    safe_console_print(json.dumps(rows, ensure_ascii=False, indent=2), flush=True)
    safe_console_print("--- END NEO4J QUERY API CONTEXT ---\n", flush=True)

    return {
        "cypher": cypher,
        "rows": rows,
    }


def retrieve_neo4j_context(
    message: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None
) -> Optional[dict[str, Any]]:
    """Convert the user request to Cypher and return graph rows for final LLM context."""
    return retrieve_neo4j_context_query_api(message, room, artwork)


def call_llm(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None
) -> str:
    """Call the Cohere LLM with user preferences and optional museum context."""
    system_prompt = build_system_prompt(
        language,
        age_range,
        personality,
        room,
        artwork,
        graph_context,
    )

    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble=system_prompt,
        message=message,
        conversation_id=f"guia_{session_id}"
    )

    return format_chat_text(response.text)


def stream_llm(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None
):
    """Yield generated text chunks from Cohere as they arrive."""
    system_prompt = build_system_prompt(
        language,
        age_range,
        personality,
        room,
        artwork,
        graph_context,
    )

    response = COHERE_CLIENT.chat_stream(
        model=MODEL_USED,
        preamble=system_prompt,
        message=message,
        conversation_id=f"guia_{session_id}"
    )

    full_text = ""
    for event in response:
        event_type = getattr(event, "event_type", None)
        if event_type == "text-generation":
            text = getattr(event, "text", "")
            if text:
                sanitized = sanitize_chat_text(text)
                full_text += sanitized
                yield {"type": "delta", "text": sanitized}

    formatted_text = format_chat_text(full_text)
    if formatted_text and formatted_text != full_text.strip():
        yield {"type": "replace", "text": formatted_text}


def stream_event(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False) + "\n"


# ─── Flask API ────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)


@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """API endpoint for chat requests with user preferences and context."""
    try:
        data = request.get_json() or {}

        session_id = data.get("session_id", "default")
        message = data.get("message", "").strip()
        language = data.get("language", "English")
        age_range = data.get("age_range", "Adult 20-60 years old")
        personality = data.get("personality", "Artist")

        session_context = SESSION_CONTEXTS.get(session_id, {})
        room = data.get("room") or session_context.get("room")
        artwork = data.get("artwork") or session_context.get("artwork")

        if not message:
            return jsonify({"error": "Message cannot be empty"}), 400

        graph_context = retrieve_neo4j_context(message, room, artwork)
        response = call_llm(
            message=message,
            session_id=session_id,
            language=language,
            age_range=age_range,
            personality=personality,
            room=room,
            artwork=artwork,
            graph_context=graph_context,
        )

        return jsonify({"response": response}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/chat/stream", methods=["POST"])
def chat_stream_endpoint():
    """Streaming API endpoint for chat requests."""
    data = request.get_json() or {}

    session_id = data.get("session_id", "default")
    message = data.get("message", "").strip()
    language = data.get("language", "English")
    age_range = data.get("age_range", "Adult 20-60 years old")
    personality = data.get("personality", "Artist")

    session_context = SESSION_CONTEXTS.get(session_id, {})
    room = data.get("room") or session_context.get("room")
    artwork = data.get("artwork") or session_context.get("artwork")

    if not message:
        return jsonify({"error": "Message cannot be empty"}), 400

    @stream_with_context
    def generate():
        try:
            yield stream_event({"type": "start"})
            graph_context = retrieve_neo4j_context(message, room, artwork)

            for event in stream_llm(
                message=message,
                session_id=session_id,
                language=language,
                age_range=age_range,
                personality=personality,
                room=room,
                artwork=artwork,
                graph_context=graph_context,
            ):
                yield stream_event(event)

            yield stream_event({"type": "done"})

        except Exception as exc:
            app.logger.exception("Streaming chat failed")
            yield stream_event({"type": "error", "error": str(exc)})

    return Response(
        generate(),
        mimetype="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/context", methods=["POST"])
def context_endpoint():
    """API endpoint to set current museum context for one session."""
    try:
        data = request.get_json() or {}

        session_id = data.get("session_id", "default")
        room = data.get("room")
        artwork = data.get("artwork")

        SESSION_CONTEXTS[session_id] = {
            "room": room,
            "artwork": artwork
        }

        return jsonify({
            "status": "success",
            "session_id": session_id,
            "room": room,
            "artwork": artwork
        }), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/locations", methods=["GET"])
def locations_endpoint():
    """Return room/artwork options loaded from the raw museum Excel file."""
    try:
        return jsonify(load_locations_from_excel()), 200
    except Exception as e:
        app.logger.exception("Could not load locations from Excel")
        return jsonify({"error": str(e), "rooms": []}), 500
    
@app.route("/reset", methods=["POST"])
def reset_endpoint():
    """Reset local context for one frontend session."""
    data = request.get_json() or {}
    session_id = data.get("session_id", "default")

    SESSION_CONTEXTS.pop(session_id, None)

    return jsonify({
        "status": "success",
        "session_id": session_id
    }), 200


if __name__ == "__main__":
    # Run Flask server for API requests (port 5002 to avoid conflict with speak.py)
    safe_console_print("GuIA LLM API server starting on http://127.0.0.1:5002")
    app.run(debug=True, port=5002)


