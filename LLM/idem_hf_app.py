import os
import sys
import threading
import time
from typing import Any

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.append("/app/iDEM_writing_assistant")

app = FastAPI()

_model_lock = threading.Lock()
_model = None
_model_error = None

MODEL_ALIASES = {
    "LLAMA1B": "meta-llama/Llama-3.2-1B-Instruct",
    "GEMMA2B": "google/gemma-2-2b-it",
    "SALAMANDRA2B": "BSC-LT/salamandra-2b-instruct",
    "LLAMA3B": "meta-llama/Llama-3.2-3B-Instruct",
    "GEMMA4B": "google/gemma-3-4b-it",
    "OLMO7B": "allenai/OLMo-2-1124-7B-Instruct",
    "SALAMANDRA7B": "BSC-LT/salamandra-7b-instruct",
}

CPU_THREADS = max(1, min(int(os.getenv("IDEM_CPU_THREADS", "2")), os.cpu_count() or 1))
torch.set_num_threads(CPU_THREADS)

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
    max_new_tokens: int | None = None


class IdemGenerator:
    def __init__(self, model_name: str, token: str | None, device: torch.device):
        self.device = device
        self.model_id = MODEL_ALIASES.get(model_name.upper(), model_name)
        self.tokenizer = AutoTokenizer.from_pretrained(self.model_id, token=token, use_fast=True)
        if self.tokenizer.pad_token_id is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

        dtype = torch.bfloat16 if device.type == "cuda" else torch.float32
        kwargs: dict[str, Any] = {"token": token, "torch_dtype": dtype}
        if device.type == "cuda":
            kwargs["device_map"] = "auto"

        print(
            "Loading model",
            self.model_id,
            "device",
            device,
            "cuda",
            torch.cuda.is_available(),
            "gpus",
            torch.cuda.device_count(),
            "dtype",
            dtype,
            "cpu_threads",
            CPU_THREADS,
            flush=True,
        )
        self.model = AutoModelForCausalLM.from_pretrained(self.model_id, **kwargs).eval()
        if device.type != "cuda":
            self.model.to(device)
        self.model.generation_config.pad_token_id = self.tokenizer.pad_token_id
        print("Model loaded.", flush=True)
        print(
            "Model on GPU: "
            + str(round(100 * sum(param.is_cuda for param in self.model.parameters()) / len(list(self.model.parameters()))))
            + "%",
            flush=True,
        )

    def render_prompt(self, prompt: str) -> str:
        messages = [{"role": "user", "content": prompt}]
        try:
            return self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
            )
        except Exception:
            return prompt

    def generate(self, prompt: str, max_new_tokens: int) -> str:
        max_input_tokens = int(os.getenv("IDEM_MAX_INPUT_TOKENS", "768"))
        rendered_prompt = self.render_prompt(prompt)
        inputs = self.tokenizer(
            rendered_prompt,
            return_tensors="pt",
            return_token_type_ids=False,
            truncation=True,
            max_length=max_input_tokens,
        )
        inputs = {key: value.to(self.device) for key, value in inputs.items()}
        input_len = inputs["input_ids"].shape[-1]
        print("Input tokens:", input_len, "Max new tokens:", max_new_tokens, flush=True)

        start = time.perf_counter()
        with torch.inference_mode():
            generation = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,
                num_beams=1,
                use_cache=True,
                eos_token_id=self.tokenizer.eos_token_id,
                pad_token_id=self.tokenizer.pad_token_id,
            )
        elapsed = time.perf_counter() - start
        print("Response time:", round(elapsed, 2), flush=True)
        output_ids = generation[0][input_len:]
        return self.tokenizer.decode(output_ids, skip_special_tokens=True)


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
            token = os.getenv("HF_TOKEN") or os.getenv("IDEM_HF_TOKEN")
            device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
            _model = IdemGenerator(model_name, token, device)
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
    max_rows = int(os.getenv("IDEM_MAX_CONTEXT_ROWS", "3"))
    max_value_chars = int(os.getenv("IDEM_MAX_CONTEXT_VALUE_CHARS", "240"))
    max_total_chars = int(os.getenv("IDEM_MAX_CONTEXT_CHARS", "1600"))

    for index, row in enumerate(rows[:max_rows], start=1):
        values = []
        for key, value in row.items():
            if value is None:
                continue
            if isinstance(value, str) and not value.strip():
                continue
            text = str(value).strip()
            if len(text) > max_value_chars:
                text = text[:max_value_chars].rsplit(" ", 1)[0].strip() + "..."
            values.append(f"{key}: {text}")
        if values:
            parts.append(f"{index}. " + "\n".join(values))

    context = "\n\n".join(parts) if parts else "No context is available."
    if len(context) > max_total_chars:
        context = context[:max_total_chars].rsplit(" ", 1)[0].strip() + "..."
    return context


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
    generator = load_model()
    lang = language_code(req.language)
    language_name = LANGUAGE_NAMES[lang]

    rows = req.context or req.rows
    context_text = rows_to_context(rows)

    force_prompt = (
        f"Answer in {language_name} only.\n"
        "Use only the museum context.\n"
        "Use Easy Read language: short sentences and common words.\n"
        "Give a direct museum-guide answer in 3 to 5 short sentences.\n"
        "Do not invent facts. Return only the answer.\n"
    )

    if req.instructions:
        force_prompt += f"\nExtra instructions:\n{str(req.instructions)[:700]}\n"

    input_text = (
        f"{force_prompt}\n"
        f"Context:\n{context_text}\n\n"
        f"Room: {req.room or 'Not provided'}\n"
        f"Artwork: {req.artwork or 'Not provided'}\n"
        f"Question: {req.question[:500]}"
    )

    default_tokens = 96 if generator.device.type == "cpu" else 180
    requested_tokens = req.max_new_tokens or int(os.getenv("IDEM_MAX_NEW_TOKENS", str(default_tokens)))
    max_new_tokens = max(24, min(requested_tokens, 220))

    raw_result = generator.generate(input_text, max_new_tokens=max_new_tokens)
    result = clean_idem_output(raw_result, input_text)

    if not result:
        result = FALLBACKS[lang]

    return {"answer": result}
