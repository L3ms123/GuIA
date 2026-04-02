"""Backend endpoint added to keep prompt building and Ollama calls out of the existing frontend."""

import json
import os
from pathlib import Path
from typing import List, Literal, Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from asr import transcribe_audio_bytes
from prompt_builder import build_messages, build_system_prompt
from tts import synthesize_speech


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
OLLAMA_MODEL_CA = os.getenv("OLLAMA_MODEL_CA", "gemma3n:e2b")
OLLAMA_MODEL_ES = os.getenv("OLLAMA_MODEL_ES", OLLAMA_MODEL)
OLLAMA_MODEL_EN = os.getenv("OLLAMA_MODEL_EN", OLLAMA_MODEL)
OLLAMA_MODEL_FALLBACK = os.getenv("OLLAMA_MODEL_FALLBACK", OLLAMA_MODEL)
OLLAMA_TIMEOUT = float(os.getenv("OLLAMA_TIMEOUT", "60"))


class ContextPayload(BaseModel):
    room: str = ""
    artwork: str = ""


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    text: str


class ChatRequest(BaseModel):
    message: str
    persona: Optional[str] = None
    language: Optional[str] = None
    age: Optional[str] = None
    context: ContextPayload = Field(default_factory=ContextPayload)
    history: List[HistoryMessage] = Field(default_factory=list)
    graph_context: str = ""


class ChatResponse(BaseModel):
    reply: str
    model: str
    system_prompt: str


class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = None
    age: Optional[str] = None
    speed: Literal["slow", "normal", "fast"] = "normal"


class TranscriptionResponse(BaseModel):
    text: str
    language: Optional[str] = None
    language_probability: Optional[float] = None


app = FastAPI(title="GuIA Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Simple health check used to confirm the backend is running."""
    return {"status": "ok"}


def build_ollama_messages(request: ChatRequest):
    return build_messages(
        message=request.message,
        persona=request.persona,
        age=request.age,
        language=request.language,
        context=request.context.model_dump(),
        history=[item.model_dump() for item in request.history],
        graph_context=request.graph_context,
    )


def resolve_ollama_model(language: Optional[str]) -> str:
    """Allow a language-specific model override without changing the frontend payload."""
    if language == "ca":
        return OLLAMA_MODEL_CA
    if language == "es":
        return OLLAMA_MODEL_ES
    if language == "en":
        return OLLAMA_MODEL_EN
    return OLLAMA_MODEL


def build_ollama_model_candidates(language: Optional[str]) -> List[str]:
    """Try the preferred language model first and fall back to the lighter default if needed."""
    preferred_model = resolve_ollama_model(language)
    candidates = [preferred_model]
    if OLLAMA_MODEL_FALLBACK and OLLAMA_MODEL_FALLBACK not in candidates:
        candidates.append(OLLAMA_MODEL_FALLBACK)
    return candidates


def should_retry_with_fallback(response_text: str) -> bool:
    text = (response_text or "").lower()
    return (
        "requires more system memory" in text
        or "model '" in text and "not found" in text
        or '"error":"model ' in text and "not found" in text
    )


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Build the personalized prompt server-side and forward the request to Ollama."""
    model_candidates = build_ollama_model_candidates(request.language)
    system_prompt = build_system_prompt(
        request.language,
        request.persona,
        request.age,
        request.context.model_dump(),
    )
    messages = build_ollama_messages(request)

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            response = None
            ollama_model = model_candidates[0]
            for candidate in model_candidates:
                ollama_model = candidate
                response = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": candidate,
                        "stream": False,
                        "messages": messages,
                    },
                )
                if response.status_code == 200 or not should_retry_with_fallback(response.text):
                    break
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Ollama: {exc}") from exc

    if response is None:
        raise HTTPException(status_code=502, detail="Ollama did not return a response.")

    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=response.text)

    data = response.json()
    reply = (
        data.get("message", {}).get("content", "").strip()
        or data.get("response", "").strip()
    )

    if not reply:
        raise HTTPException(status_code=502, detail="Ollama returned an empty response.")

    return ChatResponse(
        reply=reply,
        model=ollama_model,
        system_prompt=system_prompt,
    )


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream the model response so the frontend can render it progressively."""
    model_candidates = build_ollama_model_candidates(request.language)
    messages = build_ollama_messages(request)

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
                for index, candidate in enumerate(model_candidates):
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_URL}/api/chat",
                        json={
                            "model": candidate,
                            "stream": True,
                            "messages": messages,
                        },
                    ) as response:
                        if response.status_code != 200:
                            body = (await response.aread()).decode("utf-8", errors="replace")
                            if index < len(model_candidates) - 1 and should_retry_with_fallback(body):
                                continue
                            yield json.dumps({"type": "error", "text": body or "Ollama returned an error."}) + "\n"
                            return

                        async for line in response.aiter_lines():
                            if not line:
                                continue

                            data = json.loads(line)
                            if data.get("error"):
                                if index < len(model_candidates) - 1 and should_retry_with_fallback(data["error"]):
                                    break
                                yield json.dumps({"type": "error", "text": data["error"]}) + "\n"
                                return

                            chunk = data.get("message", {}).get("content", "")
                            if chunk:
                                yield json.dumps({"type": "chunk", "text": chunk}) + "\n"
                        else:
                            yield json.dumps({"type": "done"}) + "\n"
                            return

        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            yield json.dumps({"type": "error", "text": str(exc)}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


@app.post("/api/tts")
async def tts(request: TTSRequest):
    """Generate narration audio in the backend so the frontend is not tied to browser voices."""
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for TTS.")

    try:
        audio_bytes = await run_in_threadpool(
            synthesize_speech,
            text,
            request.language,
            request.age,
            request.speed,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not synthesize speech: {exc}") from exc

    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
):
    """Transcribe recorded speech in the backend so recognition quality is not browser-dependent."""
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio file is required for transcription.")

    suffix = Path(file.filename or "speech.webm").suffix or ".webm"

    try:
        result = await run_in_threadpool(
            transcribe_audio_bytes,
            audio_bytes,
            language=language,
            suffix=suffix,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not transcribe audio: {exc}") from exc

    if not result["text"]:
        raise HTTPException(status_code=422, detail="No speech could be transcribed from the audio.")

    return TranscriptionResponse(**result)
