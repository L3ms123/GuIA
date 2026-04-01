"""Backend endpoint added to keep prompt building and Ollama calls out of the existing frontend."""

import json
import os
from typing import List, Literal, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from prompt_builder import build_messages, build_system_prompt


OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Build the personalized prompt server-side and forward the request to Ollama."""
    system_prompt = build_system_prompt(
        request.language,
        request.persona,
        request.age,
        request.context.model_dump(),
    )
    messages = build_ollama_messages(request)

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "stream": False,
                    "messages": messages,
                },
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach Ollama: {exc}") from exc

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
        model=OLLAMA_MODEL,
        system_prompt=system_prompt,
    )


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream the model response so the frontend can render it progressively."""
    messages = build_ollama_messages(request)

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_URL}/api/chat",
                    json={
                        "model": OLLAMA_MODEL,
                        "stream": True,
                        "messages": messages,
                    },
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", errors="replace")
                        yield json.dumps({"type": "error", "text": body or "Ollama returned an error."}) + "\n"
                        return

                    async for line in response.aiter_lines():
                        if not line:
                            continue

                        data = json.loads(line)
                        if data.get("error"):
                            yield json.dumps({"type": "error", "text": data["error"]}) + "\n"
                            return

                        chunk = data.get("message", {}).get("content", "")
                        if chunk:
                            yield json.dumps({"type": "chunk", "text": chunk}) + "\n"

                    yield json.dumps({"type": "done"}) + "\n"
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            yield json.dumps({"type": "error", "text": str(exc)}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")
