import os
import sys
import threading
from typing import Any

import torch
from fastapi import FastAPI
from pydantic import BaseModel

sys.path.append("/app/iDEM_writing_assistant")

from core.correctifier import Correctifier

app = FastAPI()

_model_lock = threading.Lock()
_model = None
_model_error = None

LANGUAGE_NAMES = {
    "en": "English",
    "es": "Spanish",
    "ca": "Catalan",
}

FALLBACKS = {
    "en": "I do not have enough information in the context to answer.",
    "es": "No tengo informacion suficiente en el contexto para responder.",
    "ca": "No tinc prou informacio en el context per respondre.",
}


class AnswerRequest(BaseModel):
    question: str
    context: list[dict[str, Any]] | None = None
    rows: list[dict[str, Any]] | None = None
    graph_context: dict[str, Any] | None = None
    language: str = "es"
    room: str | None = None
    artwork: str | None = None
    visitor_profile: str | None = None
    personality: str | None = None
    instructions: str | None = None


def language_code(value: str | None) -> str:
    key = (value or "es").strip().lower()
    if key in {"english", "eng", "en"}:
        return "en"
    if key in {"spanish", "espanol", "es"}:
        return "es"
    if key in {"catalan", "catala", "ca"}:
        return "ca"
    return "es"


def load_model():
    global _model, _model_error

    with _model_lock:
        if _model is not None:
            return _model
        if _model_error is not None:
            raise _model_error

        try:
            model_name = os.getenv("IDEM_MODEL", "SALAMANDRA2B")
            lang = os.getenv("IDEM_LANG", "es")
            token = os.getenv("HF_TOKEN") or os.getenv("IDEM_HF_TOKEN")
            device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
            _model = Correctifier(model_name, token, device, lang)
            return _model
        except Exception as exc:
            _model_error = exc
            raise


@app.on_event("startup")
def warmup_model():
    thread = threading.Thread(target=load_model, daemon=True)
    thread.start()


def rows_to_context(rows: list[dict[str, Any]] | None) -> str:
    if not rows:
        return "No context is available."

    parts = []
    for index, row in enumerate(rows[:5], start=1):
        values = []
        for key, value in row.items():
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            values.append(f"{key}: {value}")
        if values:
            parts.append(f"{index}. " + "\n".join(values))

    return "\n\n".join(parts) if parts else "No context is available."


def clean_idem_output(raw: str, original_input: str) -> str:
    if not raw:
        return ""

    lines = []
    for line in raw.splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if cleaned in {"INPUT:", "OUTPUT:"}:
            continue
        if cleaned == original_input.strip():
            continue
        if cleaned.lower().startswith(("here are", "rephrasing", "rewrite")):
            continue

        cleaned = cleaned.lstrip("1234567890-").lstrip(".").strip()
        if cleaned:
            lines.append(cleaned)

    return "\n".join(lines).strip() or raw.strip()


@app.get("/")
def health():
    return {"status": "ok", "service": "guia-idem-api"}


@app.post("/answer")
def answer(req: AnswerRequest):
    correctifier = load_model()
    lang = language_code(req.language)
    language_name = LANGUAGE_NAMES[lang]

    rows = req.context or req.rows
    context_text = rows_to_context(rows)

    force_prompt = (
        f"Answer only in {language_name}. Do not mix languages.\n"
        f"If the visitor writes in another language, still answer in {language_name}.\n"
        "Answer the visitor question directly using only the provided context.\n"
        "Use Easy Read / Lectura Facil language.\n"
        "Use clear and natural language.\n"
        "Include enough useful detail for a museum audio guide.\n"
        "Explain necessary difficult words with simple words.\n"
        "Do not rewrite a previous answer.\n"
        "Do not invent facts.\n"
        "Return only the final answer.\n"
    )

    if req.instructions:
        force_prompt += f"\nAdditional app instructions:\n{req.instructions}\n"

    input_text = (
        f"Museum context:\n{context_text}\n\n"
        f"Current room: {req.room or 'Not provided'}\n"
        f"Current artwork: {req.artwork or 'Not provided'}\n\n"
        f"Visitor question:\n{req.question}"
    )

    raw_result = correctifier.correct(
        input_text,
        force_prompt=force_prompt,
        force_raw_output=True,
    )
    result = clean_idem_output(raw_result, input_text)

    if not result:
        result = FALLBACKS[lang]

    return {"answer": result}
