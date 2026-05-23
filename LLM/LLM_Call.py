"""
This file contains everything necessary to call the LLM with the input received from the RAG + initial query and then return the output.
"""

import os
import json
import base64
import csv
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
NEO4J_QUERY_TABLE_FILE = Path(__file__).resolve().parents[1] / "KG" / "neo4j_query_table_data.csv"
XLSX_NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
LOCATION_CACHE = {"mtime": None, "data": None}
NEO4J_QUERY_TABLE_CACHE = {"mtime": None, "data": None}
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
PERSONA_RULES = {
    "artist": "explain how the artwork was made, using simple words for colors, materials, and techniques",
    "storyteller": "explain the visit like a clear, simple story",
    "explorer": "act as a normal museum guide and explain the most important information first",
    "scholar": "give more historical detail and context, while staying clear and understandable",
}
EASY_WORD_SOURCE_LABELS = {
    "es": "Diccionario Facil",
    "en": "Simple Wiktionary",
    "ca": "easy-read rewrite",
}

EASY_WORD_STOPWORDS = {
    "ademas", "ahora", "algunos", "alguna", "algunas", "aunque", "cuando", "donde",
    "durante", "entonces", "estaba", "estaban", "estamos", "porque", "puede",
    "pueden", "tambien", "tiene", "tienen", "sobre", "entre", "desde", "hasta",
    "aquesta", "museo", "obra", "sala", "renacimiento", "persona", "personas", "importante",
}
EASY_WORD_MAX_CANDIDATES = 12
EASY_WORD_USER_AGENT = "GuIA museum accessibility helper/1.0"
DEFAULT_IDEM_API_URL = "https://rafelsv-guia-idem-api.hf.space/answer"
DEFAULT_IDEM_API_TIMEOUT_SECONDS = 180
IDEM_MODEL_ALIASES = {
    "LLAMA1B": "meta-llama/Llama-3.2-1B-Instruct",
    "GEMMA2B": "google/gemma-2-2b-it",
    "SALAMANDRA2B": "BSC-LT/salamandra-2b-instruct",
    "LLAMA3B": "meta-llama/Llama-3.2-3B-Instruct",
    "GEMMA4B": "google/gemma-3-4b-it",
    "OLMO7B": "allenai/OLMo-2-1124-7B-Instruct",
    "SALAMANDRA7B": "BSC-LT/salamandra-7b-instruct",
    "LLAMA8B": "meta-llama/Llama-3.1-8B-Instruct",
    "GEMMA9B": "google/gemma-2-9b-it",
    "GEMMA12B": "google/gemma-3-12b-it",
    "GEMMA27B": "google/gemma-3-27b-it",
}
IDEM_PROMPTS = {
    "en": (
        "Please rewrite the following complex text in order to make it easier to understand by non-native "
        "speakers of English. You can do so by replacing complex words with simpler synonyms, deleting "
        "unimportant information, and/or splitting long complex sentences into several simpler ones. "
        "The final simplified text needs to be grammatical, fluent, and retain the main ideas of the "
        "original without altering its meaning. Return only one reformulation. Do not add facts."
    ),
    "es": (
        "Por favor, reescriba el siguiente texto complejo para que sea mas facil de entender para quienes "
        "no hablan espanol como lengua materna. Puede hacerlo reemplazando palabras complejas con sinonimos "
        "mas simples, eliminando informacion irrelevante o dividiendo oraciones largas en varias mas simples. "
        "El texto simplificado final debe ser gramaticalmente correcto, fluido y conservar las ideas "
        "principales del original sin alterar su significado. Devuelve solo una reformulacion. No anadas datos."
    ),
    "ca": (
        "Si us plau, reescriviu el text complex seguent per tal que sigui mes facil d'entendre per a parlants "
        "no nadius del catala. Podeu fer-ho substituint paraules complexes per sinonims mes simples, eliminant "
        "informacio no important o dividint frases llargues en diverses de mes simples. El text simplificat final "
        "ha de ser gramatical, fluid i conservar les idees principals de l'original sense alterar-ne el significat. "
        "Torna nomes una reformulacio. No afegeixis dades."
    ),
}

IDEM_LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "ca": "Catalan",
}

IDEM_MAX_CONTEXT_ROWS = 3
IDEM_MAX_CONTEXT_VALUE_CHARS = 240
IDEM_MAX_QUESTION_CHARS = 500


def compact_idem_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep iDEM prompts small enough to be usable on free CPU Spaces."""
    compact_rows = []
    for row in (rows or [])[:IDEM_MAX_CONTEXT_ROWS]:
        compact_row = {}
        for key, value in row.items():
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            if len(text) > IDEM_MAX_CONTEXT_VALUE_CHARS:
                text = text[:IDEM_MAX_CONTEXT_VALUE_CHARS].rsplit(" ", 1)[0].strip() + "..."
            compact_row[key] = text
        if compact_row:
            compact_rows.append(compact_row)
    return compact_rows


def get_language_rule(language: str) -> str:
    key = (language or "en").strip().lower()
    return LANGUAGE_RULES.get(key, "Answer strictly in English.")


def get_persona_rule(personality: str) -> str:
    key = (personality or "explorer").strip().lower()
    return PERSONA_RULES.get(key, personality or PERSONA_RULES["explorer"])


def normalize_easy_word(value: str) -> str:
    translation = str.maketrans("áéíóúüñÁÉÍÓÚÜÑ", "aeiouunAEIOUUN")
    return value.translate(translation).lower()


def easy_word_slug(word: str) -> str:
    normalized = normalize_easy_word(word)
    normalized = re.sub(r"[^a-z0-9\s-]", "", normalized)
    normalized = re.sub(r"\s+", "-", normalized.strip())
    return normalized


def normalize_easy_language(language: str) -> str:
    key = (language or "es").strip().lower()
    if key in {"spanish", "español"}:
        return "es"
    if key in {"english", "eng"}:
        return "en"
    if key in {"catalan", "català", "catala"}:
        return "ca"
    return key if key in {"es", "en", "ca"} else "es"


def language_code(language: str) -> str:
    key = (language or "en").strip().lower()
    if key in {"spanish", "espanol", "español", "es"}:
        return "es"
    if key in {"catalan", "catala", "català", "ca"}:
        return "ca"
    if key in {"english", "eng", "en"}:
        return "en"
    return normalize_easy_language(key)


def get_idem_api_url() -> str:
    return (os.getenv("IDEM_API_URL") or DEFAULT_IDEM_API_URL).strip()


def get_idem_api_timeout() -> float:
    raw_timeout = (os.getenv("IDEM_API_TIMEOUT") or "").strip()
    if not raw_timeout:
        return DEFAULT_IDEM_API_TIMEOUT_SECONDS
    try:
        return max(1.0, float(raw_timeout))
    except ValueError:
        return DEFAULT_IDEM_API_TIMEOUT_SECONDS


def parse_idem_rewrite(original_text: str, output_text: str) -> str:
    """Extract the first usable iDEM reformulation from model output."""
    original = original_text.strip()
    responses = []
    for line in output_text.splitlines():
        cleaned = sanitize_chat_text(line).strip()
        cleaned = re.sub(r"^(OUTPUT|INPUT)\s*:?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = cleaned.lstrip("1234567890-").lstrip(".").strip()
        if not cleaned or cleaned == original:
            continue
        if cleaned.lower().startswith(("here are", "rewrite ", "rephrasing ")):
            continue
        responses.append(cleaned)

    if not responses:
        cleaned = sanitize_chat_text(output_text).strip()
        return cleaned if cleaned and cleaned != original else ""

    return responses[0]


def parse_idem_answer(output_text: str) -> str:
    """Clean direct iDEM guide-generation output."""
    lines = []
    for line in output_text.splitlines():
        cleaned = sanitize_chat_text(line).strip()
        cleaned = re.sub(r"^(OUTPUT|ANSWER|INPUT)\s*:?\s*", "", cleaned, flags=re.IGNORECASE)
        if not cleaned:
            continue
        if cleaned.lower().startswith(("here is", "here are", "sure,", "of course")):
            continue
        lines.append(cleaned)

    return format_chat_text("\n".join(lines) if lines else sanitize_chat_text(output_text))


@lru_cache(maxsize=1)
def get_idem_local_model():
    """Load an iDEM-compatible Hugging Face model only when explicitly configured."""
    selected_model = (os.getenv("IDEM_HF_MODEL") or "").strip()
    if not selected_model:
        return None

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoProcessor, AutoTokenizer
    except Exception as exc:
        app.logger.warning(
            "iDEM local model dependencies are unavailable. Install requirements.txt or configure IDEM_API_URL. Error: %s",
            exc,
        )
        return None

    pretrained_model = IDEM_MODEL_ALIASES.get(selected_model.upper(), selected_model)
    token = os.getenv("IDEM_HF_TOKEN") or os.getenv("HF_TOKEN")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu" and getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        device = torch.device("mps")

    try:
        tokenizer = AutoTokenizer.from_pretrained(pretrained_model, token=token)
        try:
            processor = AutoProcessor.from_pretrained(pretrained_model, token=token)
        except Exception:
            processor = None
        model = AutoModelForCausalLM.from_pretrained(pretrained_model, token=token).to(device).eval()
    except Exception as exc:
        app.logger.warning(
            "Could not load iDEM local model %s. The first run may need to download it from Hugging Face; "
            "set IDEM_HF_TOKEN if the model requires access, or configure IDEM_API_URL. Error: %s",
            pretrained_model,
            exc,
        )
        return None

    return {
        "tokenizer": tokenizer,
        "processor": processor,
        "model": model,
        "device": device,
        "torch": torch,
        "name": pretrained_model,
    }


def run_idem_local_rewrite(text: str, language: str) -> str:
    local_model = get_idem_local_model()
    if not local_model:
        return ""

    prompt = f"{IDEM_PROMPTS.get(language, IDEM_PROMPTS['en'])}\nINPUT:\n{text}"
    tokenizer = local_model["tokenizer"]
    processor = local_model["processor"]
    model = local_model["model"]
    device = local_model["device"]
    torch = local_model["torch"]

    try:
        if processor is None:
            raise AttributeError("No processor is available for this model.")
        messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(device)
        input_len = inputs["input_ids"].shape[-1]
        with torch.inference_mode():
            generation = model.generate(**inputs, max_new_tokens=700, do_sample=False, top_p=None, temperature=None)
        output_text = processor.decode(generation[0][input_len:], skip_special_tokens=True)
    except Exception:
        try:
            inputs = tokenizer(prompt, return_tensors="pt", return_token_type_ids=False).to(device)
            input_len = inputs["input_ids"].shape[-1]
            with torch.inference_mode():
                generation = model.generate(**inputs, max_new_tokens=700, do_sample=False, top_p=None, temperature=None)
            output_text = tokenizer.decode(generation[0][input_len:], skip_special_tokens=True)
        except Exception as exc:
            app.logger.warning("iDEM local rewrite failed: %s", exc)
            return ""

    return parse_idem_rewrite(text, output_text)


def run_idem_local_prompt(prompt: str) -> str:
    local_model = get_idem_local_model()
    if not local_model:
        selected_model = (os.getenv("IDEM_HF_MODEL") or "").strip()
        raise RuntimeError(
            f"iDEM local model {selected_model or '<unset>'} could not be loaded. "
            "Install transformers/accelerate/huggingface-hub, allow the Hugging Face model download, "
            "or configure IDEM_API_URL."
        )

    tokenizer = local_model["tokenizer"]
    processor = local_model["processor"]
    model = local_model["model"]
    device = local_model["device"]
    torch = local_model["torch"]

    try:
        if processor is None:
            raise AttributeError("No processor is available for this model.")
        messages = [{"role": "user", "content": [{"type": "text", "text": prompt}]}]
        inputs = processor.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=True,
            return_dict=True,
            return_tensors="pt",
        )
        inputs = inputs.to(device)
        input_len = inputs["input_ids"].shape[-1]
        with torch.inference_mode():
            generation = model.generate(**inputs, max_new_tokens=900, do_sample=False, top_p=None, temperature=None)
        output_text = processor.decode(generation[0][input_len:], skip_special_tokens=True)
    except Exception:
        inputs = tokenizer(prompt, return_tensors="pt", return_token_type_ids=False, truncation=True).to(device)
        input_len = inputs["input_ids"].shape[-1]
        with torch.inference_mode():
            generation = model.generate(**inputs, max_new_tokens=900, do_sample=False, top_p=None, temperature=None)
        output_text = tokenizer.decode(generation[0][input_len:], skip_special_tokens=True)

    answer = parse_idem_answer(output_text)
    if not answer:
        raise RuntimeError("iDEM returned an empty answer.")
    return answer


def run_idem_api_prompt(prompt: str, language: str) -> str:
    api_url = get_idem_api_url()
    if not api_url:
        raise RuntimeError("IDEM_API_URL is not configured.")

    payload = json.dumps({
        "prompt": prompt,
        "text": prompt,
        "language": language,
    }).encode("utf-8")
    request_obj = Request(
        api_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": EASY_WORD_USER_AGENT,
        },
        method="POST",
    )

    with urlopen(request_obj, timeout=get_idem_api_timeout()) as response:
        raw = response.read().decode("utf-8", errors="ignore")

    return parse_idem_api_response(raw)


def parse_idem_api_response(raw: str) -> str:
    def extract_text(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        if isinstance(value, list):
            return "\n".join(extract_text(item) for item in value if extract_text(item))
        if isinstance(value, dict):
            for key in (
                "response",
                "answer",
                "generated_text",
                "text",
                "output",
                "result",
                "prediction",
                "content",
                "message",
            ):
                text = extract_text(value.get(key))
                if text:
                    return text
            return ""
        return str(value)

    try:
        data = json.loads(raw)
        output_text = extract_text(data)
    except json.JSONDecodeError:
        output_text = raw

    answer = parse_idem_answer(str(output_text))
    if not answer:
        preview = re.sub(r"\s+", " ", raw).strip()[:500]
        raise RuntimeError(f"iDEM API returned an empty answer. Raw response preview: {preview}")
    return answer


def build_idem_guide_payload(
    message: str,
    language: str,
    age_range: str,
    personality: str,
    room: Optional[str],
    artwork: Optional[str],
    graph_context: Optional[dict[str, Any]],
    visual_descriptions: bool,
    more_time: bool,
) -> dict[str, Any]:
    rows = compact_idem_rows(graph_context.get("rows") if graph_context else [])
    cypher = graph_context.get("cypher") if graph_context else ""
    lang = language_code(language)
    language_name = IDEM_LANGUAGE_NAMES.get(lang, "English")
    return {
        "task": "answer_with_context",
        "mode": "lectura_facil",
        "language": lang,
        "question": message[:IDEM_MAX_QUESTION_CHARS],
        "context": rows,
        "rows": rows,
        "graph_context": {"cypher": cypher},
        "museum": "Museu del Renaixement in Molins de Rei",
        "room": room,
        "artwork": artwork,
        "visitor_profile": age_range,
        "personality": personality,
        "max_new_tokens": 96,
        "options": {
            "visual_descriptions": visual_descriptions,
            "more_time": more_time,
        },
        "instructions": (
            f"Answer only in {language_name}. "
            "Use only the provided context. "
            "Use Lectura Facil / Easy Read language with short, clear sentences. "
            "Give 3 to 5 useful sentences for a museum guide. "
            "Do not invent facts. Return only the final answer. "
            + (VISUAL_DESCRIPTION_GUIDELINES if visual_descriptions else "")
        ),
    }


def run_idem_api_guide(payload: dict[str, Any]) -> str:
    api_url = get_idem_api_url()
    if not api_url:
        raise RuntimeError("IDEM_API_URL is not configured.")

    request_obj = Request(
        api_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": EASY_WORD_USER_AGENT,
        },
        method="POST",
    )

    with urlopen(request_obj, timeout=get_idem_api_timeout()) as response:
        raw = response.read().decode("utf-8", errors="ignore")
    return parse_idem_api_response(raw)


def call_idem_guide(
    message: str,
    language: str,
    age_range: str,
    personality: str,
    room: Optional[str],
    artwork: Optional[str],
    graph_context: Optional[dict[str, Any]],
    visual_descriptions: bool,
    more_time: bool,
) -> str:
    """Generate the Easy Read answer directly with an iDEM API."""
    api_url = get_idem_api_url()
    if not api_url:
        raise RuntimeError(
            "IDEM_API_URL is not configured. Lectura facil is configured to use iDEM through an API only."
        )

    payload = build_idem_guide_payload(
        message=message,
        language=language,
        age_range=age_range,
        personality=personality,
        room=room,
        artwork=artwork,
        graph_context=graph_context,
        visual_descriptions=visual_descriptions,
        more_time=more_time,
    )
    return run_idem_api_guide(payload)


def simplify_with_idem(text: str, language: str) -> str:
    """Rewrite a complete answer for Lectura Facil using iDEM's simplification task."""
    text = format_chat_text(text)
    if not text:
        return ""

    lang = language_code(language)
    if get_idem_api_url():
        language_name = IDEM_LANGUAGE_NAMES.get(lang, "English")
        prompt = (
            f"{IDEM_PROMPTS.get(lang, IDEM_PROMPTS['en'])}\n\n"
            f"Return only {language_name}. Do not mix languages. "
            "Keep museum facts unchanged. Do not use Markdown.\n\n"
            f"INPUT:\n{text}"
        )
        rewritten = run_idem_api_prompt(prompt, lang)
    else:
        rewritten = run_idem_local_rewrite(text, lang)

    rewritten = format_chat_text(rewritten)
    if not rewritten or rewritten == text:
        return ""
    return rewritten


def easy_word_candidates(text: str, language: str = "es") -> list[str]:
    lang = normalize_easy_language(language)
    words = re.findall(r"\b[a-záéíóúüñçàèòïü'-]{5,}\b", text.lower(), flags=re.IGNORECASE)
    seen = set()
    candidates = []

    for word in words:
        normalized = normalize_easy_word(word)
        if normalized in seen or normalized in EASY_WORD_STOPWORDS:
            continue
        has_accent = word != normalized
        complex_suffix = word.endswith((
            "mente", "acion", "aciones", "imiento", "imientos",
            "tion", "sion", "ment", "ance", "ence", "ity",
            "ció", "cions", "ment",
        ))
        if has_accent or complex_suffix or len(word) >= 10 or is_probably_complex_term(word, lang):
            seen.add(normalized)
            candidates.append(word)
        if len(candidates) >= EASY_WORD_MAX_CANDIDATES:
            break

    return candidates


def is_probably_complex_term(word: str, language: str) -> bool:
    normalized = normalize_easy_word(word)
    if len(normalized) >= 9:
        return True
    if language in {"es", "ca"} and len(normalized) >= 6:
        return bool(re.search(r"(jiv|xiv|giv|qu|gn|mn|pt|ct|str|sc|ç)", normalized))
    if language == "en" and len(normalized) >= 6:
        return bool(re.search(r"(giv|jiv|ph|ps|pt|gn|mn|ct|sc|str|tion|sion)", normalized))
    return False


def extract_diccionario_facil_definition(html: str, word: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</(p|div|h1|h2|h3|li)>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;?", " ", text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]

    marker_index = next(
        (index for index, line in enumerate(lines) if "Esta palabra tiene" in line),
        -1,
    )
    if marker_index == -1:
        return ""

    for line in lines[marker_index + 1:]:
        if line.lower() in {"ejemplo", "imagen", "leer mas", "leer más"}:
            break
        if line.lower() == word.lower():
            continue
        if len(line) >= 24:
            return line[:280]

    return ""


@lru_cache(maxsize=512)
def lookup_diccionario_facil(word: str) -> Optional[dict[str, str]]:
    slug = easy_word_slug(word)
    if not slug:
        return None

    for suffix in ("", "-0"):
        url = f"https://www.diccionariofacil.org/diccionario/{slug}{suffix}"
        request_obj = Request(url, headers={"User-Agent": EASY_WORD_USER_AGENT})
        try:
            with urlopen(request_obj, timeout=2.5) as response:
                html = response.read().decode("utf-8", errors="ignore")
        except (HTTPError, URLError, TimeoutError, OSError):
            continue

        definition = extract_diccionario_facil_definition(html, word)
        if definition:
            return {
                "word": word,
                "definition": definition,
                "replacement": "",
                "source": url,
            }

    return None


@lru_cache(maxsize=512)
def lookup_simple_wiktionary(word: str) -> Optional[dict[str, str]]:
    slug = easy_word_slug(word)
    if not slug:
        return None

    url = f"https://simple.wiktionary.org/wiki/{slug}"
    request_obj = Request(url, headers={"User-Agent": EASY_WORD_USER_AGENT})
    try:
        with urlopen(request_obj, timeout=2.5) as response:
            html = response.read().decode("utf-8", errors="ignore")
    except (HTTPError, URLError, TimeoutError, OSError):
        return None

    definition = extract_simple_wiktionary_definition(html, word)
    if not definition:
        return None

    return {
        "word": word,
        "definition": definition,
        "replacement": "",
        "source": url,
    }


def extract_simple_wiktionary_definition(html: str, word: str) -> str:
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", html)
    text = re.sub(r"(?is)<br\s*/?>", "\n", text)
    text = re.sub(r"(?is)</(p|div|h1|h2|h3|li)>", "\n", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;?", " ", text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    lines = [line for line in lines if line]

    for line in lines:
        if re.match(r"^\d+\.\s+", line):
            cleaned = re.sub(r"^\d+\.\s+", "", line)
            cleaned = re.sub(r"\s+", " ", cleaned).strip()
            if len(cleaned) >= 20:
                return cleaned[:280]

    lowered = word.lower()
    for line in lines:
        if line.lower().startswith(f"{lowered} is ") or line.lower().startswith(f"to {lowered} is "):
            return line[:280]

    return ""


def propose_easy_replacement(word: str, language: str, definition: str = "") -> str:
    language_name = {
        "es": "Spanish",
        "en": "English",
        "ca": "Catalan",
    }.get(language, "Spanish")
    prompt = (
        f"Replace this difficult {language_name} word or term with a simpler {language_name} word or short phrase.\n"
        f"Word: {word}\n"
        f"Definition from {EASY_WORD_SOURCE_LABELS.get(language, 'the dictionary')}: {definition}\n\n"
        "Rules:\n"
        "- Return only the replacement text.\n"
        "- Do not return the original word.\n"
        "- Use 1 to 5 words.\n"
        "- Preserve the meaning in this museum guide context.\n"
        "- If no accurate simpler replacement exists, return EMPTY."
    )

    try:
        response = COHERE_CLIENT.chat(
            model=MODEL_USED,
            preamble="You are an accessibility editor specializing in easy-to-read language.",
            message=prompt,
        )
    except Exception:
        return ""

    replacement = sanitize_chat_text(response.text).strip().strip('"').strip("'")
    replacement = re.sub(r"[\r\n]+", " ", replacement)
    if not replacement or replacement.lower() in {"empty", "no", "none", "n/a"}:
        return ""
    if replacement.lower() == word.lower():
        return ""
    if len(replacement.split()) > 6 or len(replacement) > 70:
        return ""
    return replacement


def validate_easy_replacement(
    original_text: str,
    word: str,
    replacement: str,
    language: str,
    definition: str = "",
) -> bool:
    if not replacement:
        return False
    if len(replacement) >= len(word) and len(replacement.split()) >= len(word.split()):
        return False

    language_name = {
        "es": "Spanish",
        "en": "English",
        "ca": "Catalan",
    }.get(language, "Spanish")
    prompt = (
        f"Decide if this {language_name} easy-read replacement preserves the meaning in context.\n\n"
        f"Original text: {original_text}\n"
        f"Difficult word: {word}\n"
        f"Proposed replacement: {replacement}\n"
        f"Dictionary definition: {definition or 'not available'}\n\n"
        "Answer only YES or NO.\n"
        "Answer YES only when the replacement is easier than the original and fits naturally in the sentence.\n"
        "Answer NO if the replacement changes the meaning, is too broad, is ungrammatical, or depends on a different context."
    )

    try:
        response = COHERE_CLIENT.chat(
            model=MODEL_USED,
            preamble="You are a strict accessibility QA reviewer.",
            message=prompt,
        )
    except Exception:
        return False

    answer = sanitize_chat_text(response.text).strip().upper()
    return answer.startswith("YES")


def simplify_catalan_text(text: str, difficult_words: Optional[list[str]] = None) -> str:
    difficult_terms = ", ".join(difficult_words or [])
    prompt = (
        "Rewrite this Catalan museum guide text in easy-to-read Catalan.\n"
        "Use common words, short sentences, and one idea per sentence.\n"
        "If needed, think of the text in Simple English first, then write the final answer only in Catalan.\n"
        "Replace difficult technical words with simple explanations.\n"
        f"Do not use these difficult words in the final text: {difficult_terms or 'none'}.\n"
        "Do not add facts. Do not use Markdown. Preserve line breaks when useful.\n\n"
        f"Text:\n{text}"
    )

    try:
        response = COHERE_CLIENT.chat(
            model=MODEL_USED,
            preamble="You are an accessibility editor for Catalan easy-to-read museum content.",
            message=prompt,
        )
    except Exception:
        return ""

    simplified = format_chat_text(response.text)
    return simplified if simplified and simplified != text.strip() else ""


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


def load_neo4j_query_table_data() -> dict[str, Any]:
    """Load the local Neo4j vocabulary table used to guide Cypher generation."""
    if not NEO4J_QUERY_TABLE_FILE.exists():
        return {
            "labels": [],
            "relationship_types": [],
            "property_keys": [],
        }

    mtime = NEO4J_QUERY_TABLE_FILE.stat().st_mtime
    if NEO4J_QUERY_TABLE_CACHE["mtime"] == mtime and NEO4J_QUERY_TABLE_CACHE["data"] is not None:
        return NEO4J_QUERY_TABLE_CACHE["data"]

    with NEO4J_QUERY_TABLE_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
        sample = handle.read(2048)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=";,")
        except csv.Error:
            dialect = None

        if dialect is None:
            rows = list(csv.DictReader(handle, delimiter=";"))
        else:
            rows = list(csv.DictReader(handle, dialect=dialect))

    property_keys = sorted(
        {
            (row.get("propertyKey") or "").strip()
            for row in rows
            if (row.get("propertyKey") or "").strip()
        }
    )
    relationship_types = sorted(
        {
            (row.get("relationshipType") or "").strip()
            for row in rows
            if (row.get("relationshipType") or "").strip()
        }
    )
    labels = sorted(
        {
            (row.get("label") or "").strip()
            for row in rows
            if (row.get("label") or "").strip()
        }
    )

    data = {
        "labels": labels,
        "relationship_types": relationship_types,
        "property_keys": property_keys,
    }
    NEO4J_QUERY_TABLE_CACHE["mtime"] = mtime
    NEO4J_QUERY_TABLE_CACHE["data"] = data
    return data


def parse_museum_location(value: Optional[str]) -> Optional[dict[str, str]]:
    """Parse museum room labels like P1-S2 into Neo4j Sala properties."""
    if not value:
        return None

    match = re.search(r"\bP(?:alau)?\s*(?P<palau>\d+)\s*[-, ]+\s*S(?:ala)?\s*(?P<sala>\d+)\b", value, flags=re.IGNORECASE)
    if not match:
        match = re.search(r"\bPalau\s*(?P<palau>\d+).*?\bSala\s*(?P<sala>\d+)\b", value, flags=re.IGNORECASE)
    if not match:
        return None

    return {
        "palau": match.group("palau"),
        "sala": match.group("sala"),
    }


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

# Guide style descriptions to add to the prompt.
PERSONALITY_DESCRIPTIONS = PERSONA_RULES
AGE_DESCRIPTIONS = {
    "Young 10-18 years old": "You use a engaging, relatable and energetic style suitable for younger visitors.",
    "Adult 19-60 years old": "You use a mature and informative style. Full depth as defined by persona",
    "Senior 60+ years old": "You use a relatable and clear style, providing rich historical context suitable to senior visitors.",
}

VISUAL_DESCRIPTION_GUIDELINES = (
    "The user selected visual description accessibility mode. Treat the answer as a concise museum audio description. "
    "Use a structured sequence inspired by visual-art audio-description practice: "
    "1. identify the work with available label facts such as title, artist, date, medium, and location; "
    "2. give a short overall impression of the subject, composition, and mood; "
    "3. move through the work in a clear spatial order, such as foreground to background, center to edges, or top to bottom; "
    "4. include concrete visible or material details from the retrieved context, such as figures, gestures, objects, clothing, colors, textures, technique, and spatial relationships; "
    "5. mention historical or social context only after the visual overview. "
    "Use present tense, third person, short sentences, and spatial/tactile/compositional language. "
    "Avoid phrases about sighted gaze such as 'draws the viewer's eye'. "
    "Do not invent any visual detail, color, pose, object, or composition that is not supported by the retrieved context. "
    "If the retrieved context has too few visual details, say what is known and state that the database does not contain enough visual information for a fuller description."
)


def user_requested_detail(message: str) -> bool:
    lowered = (message or "").lower()
    return any(
        phrase in lowered
        for phrase in (
            "more information",
            "more detail",
            "details",
            "in depth",
            "bastant",
            "més informació",
            "mes informació",
            "més detall",
            "mes detall",
            "explica'm més",
            "explicam mes",
            "dona'm més",
            "donem bastant",
            "más información",
            "mas información",
            "más detalle",
            "mas detalle",
            "amplia",
        )
    )


def compact_previous_graph_context(graph_context: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """Keep enough prior graph context for follow-up retrieval without growing the prompt unbounded."""
    if not graph_context:
        return None

    rows = graph_context.get("rows") or []
    if not rows:
        return None

    return {
        "cypher": graph_context.get("cypher"),
        "rows": rows[:3],
    }


def record_session_turn(
    session_id: str,
    message: str,
    response: str,
    graph_context: Optional[dict[str, Any]],
    room: Optional[str],
    artwork: Optional[str],
) -> None:
    session_context = SESSION_CONTEXTS.setdefault(session_id, {})
    if room is not None:
        session_context["room"] = room
    if artwork is not None:
        session_context["artwork"] = artwork
    session_context["last_user_message"] = message
    session_context["last_assistant_response"] = response
    compact_graph_context = compact_previous_graph_context(graph_context)
    if compact_graph_context:
        session_context["last_graph_context"] = compact_graph_context


def build_system_prompt(
    language: str = "en",
    age_range: str = "Adult 20-60 years old",
    personality: str = "explorer",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None,
    simple_language: bool = False,
    visual_descriptions: bool = False,
    more_time: bool = False,
) -> str:
    """Build a dynamic system prompt based on user preferences and context."""

    language_rule = get_language_rule(language)
    persona_rule = get_persona_rule(personality)

    detail_requested = user_requested_detail(graph_context.get("message", "") if graph_context else "")

    prompt = (
        "You are GuIA, the AI audio guide of the Museu del Renaixement in Molins de Rei."
        "You speak only about this museum and its collection."
        "You answer the user's questions using the retrieved context provided by the "
        "retrieval-augmented generation pipeline. "
        "You answer questions related to museums, artworks, rooms, artists, history and art interpretation. "
        "Never invent facts. If the information is not present in the retrieved context, "
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
        "Do not answer in any other language unless the user explicitly asks you to change language (only english, spanish or catalan) in the current message."
        "\n\n"
        f"VISITOR PROFILE: The user can be described as {age_range}. " # This can be undefined
        f"GUIDE STYLE: {persona_rule}."
        # Consider adding artworks seen so far
    )

    if simple_language:
        prompt += (
            "\n\nEASY-READ ACCESSIBILITY MODE: The user selected Texto facil / Easy Read. "
            "Prioritize cognitive accessibility. Use common words and explain any necessary difficult word immediately. "
            "Use short direct sentences, active voice, and one idea per sentence. "
            "Keep paragraphs very short. Prefer 2 to 4 concise paragraphs. "
            "Avoid idioms, abstract metaphors, jargon, subordinate-heavy sentences, and decorative language. "
            "Choose easy words from the first draft. Do not rely on later replacement. "
            "Before using any noun, adjective, or verb that may be specialized, ask if a common word or short explanation can say the same thing. "
            "Prefer short explanations over rare synonyms. "
            "Do not use specialist terms such as architectural, technical, historical, or artistic jargon unless the exact term is essential. "
            "If a difficult term is essential, write a simple explanation instead of using only the term. "
            "For example, do not write specialist architectural terms by themselves; explain the shape or idea with common words. "
            "If a list helps, use a short numbered list with no more than 5 items. "
            "Do not patronize the user and do not remove essential meaning. "
            "For Spanish, aim for Lectura Facil around CEFR A1-A2 when the facts allow it. "
            "AI-generated Easy Read still needs human validation for formal publication."
        )

    if visual_descriptions:
        prompt += (
            "\n\nVISUAL DESCRIPTION ACCESSIBILITY MODE: "
            f"{VISUAL_DESCRIPTION_GUIDELINES} "
            "For a single artwork, prefer 3 to 5 short paragraphs: label facts, overall image, spatial description, and context. "
            "For a room or multiple artworks, briefly describe each item's visible/material characteristics only where context supports them."
        )

    if more_time:
        prompt += (
            "\n\nPACING REQUEST: Give the answer in a slower rhythm for audio. "
            "Use clear sentence boundaries and avoid dense clauses."
        )

    if detail_requested:
        prompt += (
            "\n\nDETAIL REQUEST: The user explicitly asked for substantial information. "
            "Use the retrieved rows fully and give a richer answer than usual: 4 to 6 short paragraphs when the data supports it. "
            "Do not stop after only a brief identification if biography or contextual fields are present."
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
    artwork: Optional[str] = None,
    previous_graph_context: Optional[dict[str, Any]] = None,
    visual_descriptions: bool = False,
) -> str:
    query = message
    if visual_descriptions:
        query += (
            "\n\nThe visitor selected visual description accessibility mode. "
            "Retrieve artwork label data and any available visual, material, technique, composition, subject, object, gesture, color, texture, location, historical, or social context fields. "
            "Prefer context for the selected artwork when one is provided."
        )

    if room or artwork:
        query += "\n\nCurrent museum context:"
        if room:
            query += f"\nRoom: {room}"
            parsed_location = parse_museum_location(room)
            if parsed_location:
                query += (
                    "\nNeo4j room fields: "
                    f"Sala.palau = '{parsed_location['palau']}', "
                    f"Sala.id = '{parsed_location['sala']}'"
                )
        if artwork:
            query += f"\nArtwork: {artwork}"

    if previous_graph_context:
        query += (
            "\n\nPrevious retrieved Neo4j context from the immediately previous user turn. "
            "Use it to resolve follow-up references like this artwork, the artist, tell me more, or give more information:"
        )
        query += "\n"
        query += json.dumps(previous_graph_context, ensure_ascii=False, indent=2)
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


def repair_cypher_string_literals(cypher: str) -> str:
    """Normalize common LLM string-literal mistakes before sending Cypher to Neo4j."""
    repaired = []
    in_single_quote = False
    index = 0

    while index < len(cypher):
        char = cypher[index]

        if char == "\\":
            repaired.append(char)
            if index + 1 < len(cypher):
                index += 1
                repaired.append(cypher[index])
            index += 1
            continue

        if char == "'":
            if in_single_quote and index + 1 < len(cypher) and cypher[index + 1] == "'":
                repaired.append("\\'")
                index += 2
                continue

            in_single_quote = not in_single_quote
            repaired.append(char)
            index += 1
            continue

        repaired.append(char)
        index += 1

    return "".join(repaired)


def prepare_generated_cypher(cypher: str) -> str:
    """Apply deterministic repairs that keep generated Cypher read-only and parseable."""
    repaired = repair_cypher_string_literals(cypher)
    repaired = rewrite_combined_sala_id_filters(repaired)
    if not is_read_only_cypher(repaired):
        raise ValueError(f"Generated Cypher is not read-only after repair: {repaired}")
    return repaired


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


def rewrite_combined_sala_id_filters(cypher: str) -> str:
    """Rewrite UI room ids like P1-S2 to the graph's separate Sala.palau/Sala.id fields."""
    sala_variables = set(
        match.group("var")
        for match in re.finditer(
            r"\((?P<var>[A-Za-z_][A-Za-z0-9_]*)\s*:\s*Sala\b",
            cypher,
            flags=re.IGNORECASE,
        )
    )

    if not sala_variables:
        return cypher

    def parse_location_literal(value: str) -> Optional[dict[str, str]]:
        return parse_museum_location(value)

    def replace_exact_filter(match: re.Match) -> str:
        variable = match.group("var")
        if variable not in sala_variables:
            return match.group(0)

        location = parse_location_literal(match.group("value"))
        if not location:
            return match.group(0)

        return f"{variable}.palau = '{location['palau']}' AND {variable}.id = '{location['sala']}'"

    rewritten = re.sub(
        r"\b(?P<var>[A-Za-z_][A-Za-z0-9_]*)\.id\s*=\s*['\"](?P<value>P\s*\d+\s*-\s*S\s*\d+)['\"]",
        replace_exact_filter,
        cypher,
        flags=re.IGNORECASE,
    )

    def replace_lower_filter(match: re.Match) -> str:
        variable = match.group("var")
        if variable not in sala_variables:
            return match.group(0)

        location = parse_location_literal(match.group("value"))
        if not location:
            return match.group(0)

        return f"{variable}.palau = '{location['palau']}' AND {variable}.id = '{location['sala']}'"

    return re.sub(
        r"\btoLower\(\s*(?P<var>[A-Za-z_][A-Za-z0-9_]*)\.id\s*\)\s*(?:=|CONTAINS)\s*['\"](?P<value>p\s*\d+\s*-\s*s\s*\d+)['\"]",
        replace_lower_filter,
        rewritten,
        flags=re.IGNORECASE,
    )


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


TITLE_STOP_WORDS = {
    "and",
    "amb",
    "con",
    "del",
    "dels",
    "des",
    "the",
    "una",
    "une",
    "les",
    "los",
    "las",
    "els",
}


def significant_title_terms(title: str) -> list[str]:
    """Return robust title tokens for fallback artwork lookup."""
    normalized = normalize_text_for_cypher(title)
    terms = []
    for term in re.findall(r"[a-z0-9]+", normalized):
        if len(term) < 3 or term in TITLE_STOP_WORDS:
            continue
        if term not in terms:
            terms.append(term)
    return terms[:8]


def cypher_list_literal(values: list[str]) -> str:
    return "[" + ", ".join(cypher_string_literal(value) for value in values) + "]"


def build_artwork_context_fallback_cypher(
    artwork: str,
    room: Optional[str] = None,
    include_room_filter: bool = True,
) -> Optional[str]:
    """Build a less brittle artwork context query using title tokens instead of a full title literal."""
    terms = significant_title_terms(artwork)
    if not terms:
        return None

    parsed_location = parse_museum_location(room)
    minimum_matches = max(2, len(terms) - 1) if len(terms) > 2 else len(terms)
    title_predicate = (
        f"size([term IN {cypher_list_literal(terms)} "
        f"WHERE toLower(a.title) CONTAINS term]) >= {minimum_matches}"
    )

    if include_room_filter and parsed_location:
        return (
            "MATCH (a:ArtPiece)-[:LOCATED_IN]->(s:Sala) "
            f"WHERE {title_predicate} "
            f"AND s.palau = {cypher_string_literal(parsed_location['palau'])} "
            f"AND s.id = {cypher_string_literal(parsed_location['sala'])} "
            "OPTIONAL MATCH (a)-[:CREATED_BY]->(artist:Artist) "
            "OPTIONAL MATCH (a)-[:USES_TECHNIQUE]->(technique:Technique) "
            "RETURN a.title, a.description, a.artist, a.dating, a.technique, "
            "artist.name, artist.biography, technique.name, s.palau, s.id LIMIT 5"
        )

    return (
        "MATCH (a:ArtPiece) "
        f"WHERE {title_predicate} "
        "OPTIONAL MATCH (a)-[:LOCATED_IN]->(s:Sala) "
        "OPTIONAL MATCH (a)-[:CREATED_BY]->(artist:Artist) "
        "OPTIONAL MATCH (a)-[:USES_TECHNIQUE]->(technique:Technique) "
        "RETURN a.title, a.description, a.artist, a.dating, a.technique, "
        "artist.name, artist.biography, technique.name, s.palau, s.id LIMIT 5"
    )


def try_artwork_context_fallback(
    artwork: Optional[str],
    room: Optional[str],
) -> tuple[Optional[str], list[dict[str, Any]]]:
    """Try robust artwork lookup when generated Cypher is empty or invalid."""
    if not artwork:
        return None, []

    for include_room_filter in (True, False):
        fallback_cypher = build_artwork_context_fallback_cypher(
            artwork,
            room,
            include_room_filter=include_room_filter,
        )
        if not fallback_cypher:
            continue

        safe_console_print("\n--- NEO4J QUERY API ARTWORK CONTEXT RETRY CYPHER ---", flush=True)
        safe_console_print(fallback_cypher, flush=True)
        raw_rows = execute_query_api(fallback_cypher)
        if raw_rows:
            return fallback_cypher, raw_rows

    return None, []


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
    query_table_data = load_neo4j_query_table_data()
    preamble = (
        "You convert natural language questions into read-only Neo4j Cypher. "
        "Return only one Cypher query. Do not include markdown or explanation. "
        "Only use labels, relationship types, and properties present in the live schema or local query table. "
        "The local Neo4j query table is authoritative vocabulary for valid graph categories; "
        "if it differs from the live schema, prefer its exact labels, relationship types, and property keys when building MATCH patterns. "
        "Do not invent translated or pluralized labels, relationship types, or property keys. "
        "Use MATCH/OPTIONAL MATCH/WITH/WHERE/RETURN/ORDER BY/LIMIT only. "
        "Never use CREATE, MERGE, DELETE, DETACH, SET, REMOVE, DROP, LOAD CSV, or write procedures. "
        "Always include a reasonable LIMIT unless the question asks for a count. "
        "Artwork titles in the graph are often Catalan even when the visitor asks in Spanish or English. "
        "Do not translate title literals to English. Prefer case-insensitive partial matching with CONTAINS for titles and names. "
        "For room questions, match the graph's separate room fields: Sala.palau is the Palau number and Sala.id is the Sala number. "
        "If the context contains a UI location like P1-S2, query it as s.palau = '1' AND s.id = '2', never as s.id = 'P1-S2'. "
        "Example: MATCH (a:ArtPiece)-[:LOCATED_IN]->(s:Sala) "
        "WHERE toLower(a.title) CONTAINS 'anunciació' AND s.palau = '1' AND s.id = '3' RETURN a.title, a.description LIMIT 5"
    )
    message = (
        f"Live schema:\n{schema}\n\n"
        f"Local Neo4j query table vocabulary:\n{json.dumps(query_table_data, ensure_ascii=False, indent=2)}\n\n"
        f"Question:\n{query}"
    )
    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble=preamble,
        message=message,
    )
    cypher = extract_cypher(response.text)
    cypher = prepare_generated_cypher(cypher)
    if not is_read_only_cypher(cypher):
        raise ValueError(f"Generated Cypher is not read-only: {cypher}")
    return cypher


def retrieve_neo4j_context_query_api(
    message: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    previous_graph_context: Optional[dict[str, Any]] = None,
    visual_descriptions: bool = False,
) -> Optional[dict[str, Any]]:
    """Fallback graph retrieval using Neo4j Query API over HTTPS."""
    if not neo4j_is_configured():
        return None

    query = build_query_with_context(message, room, artwork, previous_graph_context, visual_descriptions)
    try:
        cypher = generate_query_api_cypher(query)
        cypher = prepare_generated_cypher(cypher)
        raw_rows = execute_query_api(cypher)
        if not raw_rows:
            contains_cypher = prepare_generated_cypher(rewrite_exact_property_matches_to_contains(cypher))
            if contains_cypher != cypher:
                safe_console_print("\n--- NEO4J QUERY API CONTAINS RETRY CYPHER ---", flush=True)
                safe_console_print(contains_cypher, flush=True)
                raw_rows = execute_query_api(contains_cypher)
                if raw_rows:
                    cypher = contains_cypher
        if not raw_rows:
            fuzzy_cypher = prepare_generated_cypher(rewrite_exact_property_matches_to_fuzzy(cypher))
            if fuzzy_cypher != cypher:
                safe_console_print("\n--- NEO4J QUERY API ACCENT RETRY CYPHER ---", flush=True)
                safe_console_print(fuzzy_cypher, flush=True)
                raw_rows = execute_query_api(fuzzy_cypher)
                if raw_rows:
                    cypher = fuzzy_cypher
        if not raw_rows and artwork:
            fallback_cypher, fallback_rows = try_artwork_context_fallback(artwork, room)
            if fallback_rows:
                cypher = fallback_cypher or cypher
                raw_rows = fallback_rows
        rows = clean_graph_rows(raw_rows, message)
    except Exception as exc:
        try:
            fallback_cypher, fallback_rows = try_artwork_context_fallback(artwork, room)
            if fallback_rows:
                rows = clean_graph_rows(fallback_rows, message)
                safe_console_print("\n--- NEO4J QUERY API RECOVERED WITH ARTWORK CONTEXT ---", flush=True)
                safe_console_print(fallback_cypher, flush=True)
                safe_console_print("--- NEO4J QUERY API ROWS ---", flush=True)
                safe_console_print(json.dumps(rows, ensure_ascii=False, indent=2), flush=True)
                safe_console_print("--- END NEO4J QUERY API CONTEXT ---\n", flush=True)
                return {
                    "message": message,
                    "cypher": fallback_cypher,
                    "rows": rows,
                }
        except Exception as fallback_exc:
            safe_console_print("\n--- NEO4J QUERY API ARTWORK CONTEXT RECOVERY FAILED ---", flush=True)
            safe_console_print(str(fallback_exc), flush=True)
            safe_console_print("--- END NEO4J QUERY API ARTWORK CONTEXT RECOVERY FAILED ---\n", flush=True)

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
        "message": message,
        "cypher": cypher,
        "rows": rows,
    }


def retrieve_neo4j_context(
    message: str,
    session_id: str,
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    visual_descriptions: bool = False,
) -> Optional[dict[str, Any]]:
    """Convert the user request to Cypher and return graph rows for final LLM context."""
    session_context = SESSION_CONTEXTS.get(session_id, {})
    return retrieve_neo4j_context_query_api(
        message,
        room,
        artwork,
        previous_graph_context=session_context.get("last_graph_context"),
        visual_descriptions=visual_descriptions,
    )


def call_llm(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "explorer",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None,
    simple_language: bool = False,
    visual_descriptions: bool = False,
    more_time: bool = False,
) -> str:
    """Call the guide model with user preferences and optional museum context."""
    graph_rows = graph_context.get("rows") if graph_context else []
    if simple_language and graph_rows:
        try:
            return call_idem_guide(
                message=message,
                language=language,
                age_range=age_range,
                personality=personality,
                room=room,
                artwork=artwork,
                graph_context=graph_context,
                visual_descriptions=visual_descriptions,
                more_time=more_time,
            )
        except Exception as exc:
            app.logger.warning("iDEM direct Easy Read generation failed; falling back to Cohere: %s", exc)
    elif simple_language:
        app.logger.info("Skipping iDEM Easy Read generation because Neo4j returned no context rows.")

    return call_cohere_guide(
        message=message,
        session_id=session_id,
        language=language,
        age_range=age_range,
        personality=personality,
        room=room,
        artwork=artwork,
        graph_context=graph_context,
        simple_language=simple_language,
        visual_descriptions=visual_descriptions,
        more_time=more_time,
    )


def call_cohere_guide(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "explorer",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None,
    simple_language: bool = False,
    visual_descriptions: bool = False,
    more_time: bool = False,
) -> str:
    """Call Cohere for the normal guide path, or as fallback when iDEM fails."""
    system_prompt = build_system_prompt(
        language,
        age_range,
        personality,
        room,
        artwork,
        graph_context,
        simple_language,
        visual_descriptions,
        more_time,
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
    personality: str = "explorer",
    room: Optional[str] = None,
    artwork: Optional[str] = None,
    graph_context: Optional[dict[str, Any]] = None,
    simple_language: bool = False,
    visual_descriptions: bool = False,
    more_time: bool = False,
):
    """Yield generated text chunks from Cohere as they arrive."""
    system_prompt = build_system_prompt(
        language,
        age_range,
        personality,
        room,
        artwork,
        graph_context,
        simple_language,
        visual_descriptions,
        more_time,
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


def language_name(language: str) -> str:
    return {
        "ca": "Catalan",
        "es": "Spanish",
        "en": "English",
        "catalan": "Catalan",
        "spanish": "Spanish",
        "english": "English",
    }.get((language or "").lower(), language or "the target language")


def parse_translation_response(raw: str) -> list[dict[str, Any]]:
    text = (raw or "").strip()
    if not text:
        return []

    candidates = [text]
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidates.append(text[start:end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        translations = parsed.get("translations") if isinstance(parsed, dict) else parsed
        if isinstance(translations, list):
            parsed_translations = []
            for item in translations:
                if isinstance(item, dict):
                    parsed_translations.append({
                        "index": item.get("index"),
                        "role": item.get("role"),
                        "text": str(item.get("text", "")),
                    })
                else:
                    parsed_translations.append({"text": str(item)})
            return parsed_translations

    return []


def translate_conversation_items(items: list[dict[str, Any]], from_language: str, to_language: str) -> list[dict[str, Any]]:
    if not items:
        return []

    target = language_name(to_language)
    payload = [
        {
            "index": item.get("index"),
            "role": item.get("role", "assistant"),
            "source_language": language_name(item.get("source_language") or from_language),
            "text": str(item.get("text", ""))[:4000],
        }
        for item in items[:40]
        if str(item.get("text", "")).strip()
    ]

    prompt = (
        f"Translate this museum guide conversation to {target}.\n"
        "Each item includes its own source_language.\n"
        "Return only valid JSON with this exact shape: {\"translations\":[{\"index\":0,\"role\":\"assistant\",\"text\":\"...\"}]}.\n"
        "Rules:\n"
        "- Preserve the number, order, index, and role of every item.\n"
        "- Translate only the text field.\n"
        "- If an item is already in the target language, keep it unchanged.\n"
        "- Preserve meaning, tone, museum terminology, names, and paragraph breaks.\n"
        "- Do not add explanations or markdown.\n\n"
        f"Items:\n{json.dumps(payload, ensure_ascii=False)}"
    )

    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble="You are a precise translation engine for a museum guide web app.",
        message=prompt,
    )

    translated_texts = parse_translation_response(response.text)
    translations = []

    for position, item in enumerate(payload):
        translated_item = translated_texts[position] if position < len(translated_texts) else {}
        translated = str(translated_item.get("text", "")).strip()
        translations.append({
            "index": translated_item.get("index", item["index"]),
            "role": translated_item.get("role", item["role"]),
            "text": format_chat_text(translated) if translated else item["text"],
        })

    return translations


# ─── Flask API ────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)


@app.route("/translate-conversation", methods=["POST"])
def translate_conversation_endpoint():
    """Translate visible chat bubbles after the visitor changes language."""
    try:
        data = request.get_json() or {}
        items = data.get("items") or []
        if not isinstance(items, list):
            return jsonify({"error": "items must be a list"}), 400

        translations = translate_conversation_items(
            items=items,
            from_language=data.get("from_language", ""),
            to_language=data.get("to_language", "en"),
        )
        return jsonify({"translations": translations}), 200
    except Exception as exc:
        app.logger.exception("Conversation translation failed")
        return jsonify({"error": str(exc)}), 500


@app.route("/easy-words", methods=["POST"])
def easy_words_endpoint():
    """Rewrite complete text in Easy Read mode through the iDEM adapter."""
    data = request.get_json() or {}
    text = (data.get("text") or "").strip()
    language = data.get("language", "es")
    if not text:
        return jsonify({"rewritten_text": "", "annotations": []}), 200

    rewritten_text = simplify_with_idem(text, language)
    return jsonify({
        "annotations": [],
        "rewritten_text": rewritten_text,
        "source": "idem" if rewritten_text else "",
    }), 200


@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """API endpoint for chat requests with user preferences and context."""
    try:
        data = request.get_json() or {}

        session_id = data.get("session_id", "default")
        message = data.get("message", "").strip()
        language = data.get("language", "English")
        age_range = data.get("age_range", "Adult 20-60 years old")
        personality = data.get("personality", "explorer")
        simple_language = bool(data.get("simple_language", False))
        visual_descriptions = bool(data.get("visual_descriptions", False))
        more_time = bool(data.get("more_time", False))

        session_context = SESSION_CONTEXTS.get(session_id, {})
        room = data.get("room") or session_context.get("room")
        artwork = data.get("artwork") or session_context.get("artwork")

        if not message:
            return jsonify({"error": "Message cannot be empty"}), 400

        graph_context = retrieve_neo4j_context(message, session_id, room, artwork, visual_descriptions)
        response = call_llm(
            message=message,
            session_id=session_id,
            language=language,
            age_range=age_range,
            personality=personality,
            room=room,
            artwork=artwork,
            graph_context=graph_context,
            simple_language=simple_language,
            visual_descriptions=visual_descriptions,
            more_time=more_time,
        )
        record_session_turn(session_id, message, response, graph_context, room, artwork)

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
    personality = data.get("personality", "explorer")
    simple_language = bool(data.get("simple_language", False))
    visual_descriptions = bool(data.get("visual_descriptions", False))
    more_time = bool(data.get("more_time", False))

    session_context = SESSION_CONTEXTS.get(session_id, {})
    room = data.get("room") or session_context.get("room")
    artwork = data.get("artwork") or session_context.get("artwork")

    if not message:
        return jsonify({"error": "Message cannot be empty"}), 400

    @stream_with_context
    def generate():
        try:
            yield stream_event({"type": "start"})
            graph_context = retrieve_neo4j_context(message, session_id, room, artwork, visual_descriptions)
            streamed_response = ""

            graph_rows = graph_context.get("rows") if graph_context else []
            if simple_language and graph_rows:
                try:
                    streamed_response = call_idem_guide(
                        message=message,
                        language=language,
                        age_range=age_range,
                        personality=personality,
                        room=room,
                        artwork=artwork,
                        graph_context=graph_context,
                        visual_descriptions=visual_descriptions,
                        more_time=more_time,
                    )
                    yield stream_event({"type": "replace", "text": streamed_response, "source": "idem"})
                    record_session_turn(session_id, message, streamed_response, graph_context, room, artwork)
                    yield stream_event({"type": "done"})
                    return
                except Exception as exc:
                    app.logger.warning("iDEM direct Easy Read generation failed; falling back to Cohere stream: %s", exc)
                    streamed_response = call_cohere_guide(
                        message=message,
                        session_id=session_id,
                        language=language,
                        age_range=age_range,
                        personality=personality,
                        room=room,
                        artwork=artwork,
                        graph_context=graph_context,
                        simple_language=True,
                        visual_descriptions=visual_descriptions,
                        more_time=more_time,
                    )
                    yield stream_event({"type": "replace", "text": streamed_response, "source": "cohere-fallback"})
                    record_session_turn(session_id, message, streamed_response, graph_context, room, artwork)
                    yield stream_event({"type": "done"})
                    return
            elif simple_language:
                app.logger.info("Skipping iDEM Easy Read generation because Neo4j returned no context rows.")

            for event in stream_llm(
                message=message,
                session_id=session_id,
                language=language,
                age_range=age_range,
                personality=personality,
                room=room,
                artwork=artwork,
                graph_context=graph_context,
                simple_language=simple_language,
                visual_descriptions=visual_descriptions,
                more_time=more_time,
            ):
                if event.get("type") == "delta":
                    streamed_response += event.get("text", "")
                elif event.get("type") == "replace":
                    streamed_response = event.get("text", "")
                yield stream_event(event)

            record_session_turn(session_id, message, streamed_response, graph_context, room, artwork)
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

        session_context = SESSION_CONTEXTS.setdefault(session_id, {})
        session_context["room"] = room
        session_context["artwork"] = artwork

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


