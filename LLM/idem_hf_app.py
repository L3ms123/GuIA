import os
import re
import sys
import threading
import time
import unicodedata
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from transformers import AutoModelForCausalLM, AutoTokenizer

sys.path.append("/app/iDEM_writing_assistant")
sys.path.append("/app")

try:
    from core.correctifier import Correctifier
except Exception:
    Correctifier = None

app = FastAPI()

_model_lock = threading.Lock()
_generation_lock = threading.Lock()
_model = None
_model_error = None

MODEL_ALIASES = {
    "QWEN05B": "Qwen/Qwen2.5-0.5B-Instruct",
    "LLAMA1B": "meta-llama/Llama-3.2-1B-Instruct",
    "GEMMA2B": "google/gemma-2-2b-it",
    "SALAMANDRA2B": "BSC-LT/salamandra-2b-instruct",
    "LLAMA3B": "meta-llama/Llama-3.2-3B-Instruct",
    "GEMMA4B": "google/gemma-3-4b-it",
    "OLMO7B": "allenai/OLMo-2-1124-7B-Instruct",
    "SALAMANDRA7B": "BSC-LT/salamandra-7b-instruct",
}

OFFICIAL_IDEM_MODELS = {
    "LLAMA1B",
    "GEMMA2B",
    "SALAMANDRA2B",
    "LLAMA3B",
    "GEMMA4B",
    "OLMO7B",
    "SALAMANDRA7B",
}

CPU_THREADS = max(1, min(int(os.getenv("IDEM_CPU_THREADS", "2")), os.cpu_count() or 1))
torch.set_num_threads(CPU_THREADS)
try:
    torch.set_num_interop_threads(1)
except RuntimeError:
    pass

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

IDEM_SIMPLIFICATION_PROMPTS = {
    "en": (
        "Please rewrite the following complex sentence in order to make it easier to understand by non-native "
        "speakers of English. You can do so by replacing complex words with simpler synonyms (i.e. paraphrasing), "
        "deleting unimportant information (i.e. compression), and/or splitting a long complex sentence into "
        "several simpler ones. The final simplified sentence needs to be grammatical, fluent, and retain the "
        "main ideas of its original counterpart without altering its meaning.\n"
        "Return one reformulation. Do not generate any text except the reformulation."
    ),
    "es": (
        "Por favor, reescriba la siguiente oración compleja para que sea más fácil de entender para quienes no "
        "hablan español como lengua materna. Puede hacerlo reemplazando palabras complejas con sinónimos más "
        "simples, eliminando información irrelevante o dividiendo una oración compleja larga en varias más "
        "simples. La oración simplificada final debe ser gramaticalmente correcta, fluida y conservar las ideas "
        "principales de su contraparte original sin alterar su significado.\n"
        "Da una reformulación. No genere ningún texto excepto la reformulación."
    ),
    "ca": (
        "Reescriviu la següent frase complexa per tal que sigui més fàcil d'entendre per a parlants "
        "no nadius del català. Podeu fer-ho substituint paraules complexes per sinònims més simples, eliminant "
        "informació no important o dividint una frase llarga i complexa en diverses de més simples. La frase "
        "simplificada final ha de ser gramatical, fluida i conservar les idees principals de la seva contrapart "
        "original sense alterar-ne el significat.\n"
        "Dona una reformulació. No genereu cap text excepte la reformulació."
    ),
}


class AnswerRequest(BaseModel):
    question: str = ""
    prompt: str | None = None
    text: str | None = None
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
        self.model_name = model_name.upper()
        self.use_official_correctifier = (
            os.getenv("IDEM_USE_OFFICIAL_CORRECTIFIER", "true").strip().lower() != "false"
            and Correctifier is not None
            and self.model_name in OFFICIAL_IDEM_MODELS
        )

        if self.use_official_correctifier:
            print("Loading official iDEM Correctifier", self.model_name, "device", device, flush=True)
            self.correctifier = Correctifier(self.model_name, token, device, lang="en-multi")
            self.model = self.correctifier.model
            self.tokenizer = self.correctifier.tokenizer
            self.model_id = self.correctifier.pretrained_model
            print("Official iDEM Correctifier loaded.", flush=True)
            return

        self.correctifier = None
        self.model_id = MODEL_ALIASES.get(self.model_name, model_name)
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
        self.model.generation_config.do_sample = False
        self.model.generation_config.temperature = None
        self.model.generation_config.top_p = None
        self.model.generation_config.top_k = None
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
        max_input_tokens = int(os.getenv("IDEM_MAX_INPUT_TOKENS", "1024"))
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

    def simplify_with_official_idem(self, text: str, lang: str) -> str:
        if not self.use_official_correctifier:
            return ""

        self.correctifier.lang = lang
        prompt = IDEM_SIMPLIFICATION_PROMPTS.get(lang, IDEM_SIMPLIFICATION_PROMPTS["en"])
        try:
            return self.correctifier.correct(text, force_prompt=prompt)
        finally:
            self.correctifier.lang = "en-multi"


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
            default_model = "SALAMANDRA2B" if torch.cuda.is_available() else "QWEN05B"
            model_name = os.getenv("IDEM_MODEL", default_model)
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
    max_value_chars = int(os.getenv("IDEM_MAX_CONTEXT_VALUE_CHARS", "700"))
    max_total_chars = int(os.getenv("IDEM_MAX_CONTEXT_CHARS", "2500"))

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


def normalize_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value))
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "_", ascii_text.lower()).strip("_")


def truncate_text(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text

    cut = text[:max_chars].strip()
    sentence_end = max(cut.rfind("."), cut.rfind("!"), cut.rfind("?"))
    if sentence_end >= max_chars * 0.55:
        return cut[:sentence_end + 1].strip()

    word_end = cut.rfind(" ")
    if word_end >= max_chars * 0.55:
        return cut[:word_end].strip() + "..."

    return cut + "..."


def clean_value(value: Any, max_chars: int = 220) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        text = ", ".join(clean_value(item, max_chars=max_chars) for item in value)
    else:
        text = str(value)
    text = text.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if not text or text.lower() in {"none", "null", "nan", "not provided"}:
        return ""
    if text.startswith(("http://", "https://")):
        return ""
    return truncate_text(text, max_chars)


FIELD_ALIASES = {
    "title": ("title", "titol", "titulo", "obra", "artwork", "nom_obra", "name"),
    "artist": ("artist", "artista", "autor", "autoria", "creator", "created_by"),
    "date": ("date", "data", "any", "year", "cronologia", "chronology", "datacio"),
    "room": ("room", "sala", "ubicacio", "location", "palau"),
    "material": ("material", "materials", "technique", "tecnica", "medium"),
    "description": (
        "description",
        "descripcio",
        "descripcion",
        "text",
        "resum",
        "summary",
        "explicacio",
        "comentari",
        "context",
    ),
}


def row_value(row: dict[str, Any], field: str) -> str:
    aliases = FIELD_ALIASES[field]
    normalized_items = [(normalize_key(key), value) for key, value in row.items()]

    for key, value in normalized_items:
        if key in aliases or key.split("_")[-1] in aliases:
            cleaned = clean_value(value)
            if cleaned:
                return cleaned

    for key, value in normalized_items:
        if any(alias in key for alias in aliases):
            cleaned = clean_value(value)
            if cleaned:
                return cleaned

    return ""


def best_context_row(rows: list[dict[str, Any]], req: AnswerRequest) -> dict[str, Any]:
    if not rows:
        return {}

    wanted = " ".join(
        clean_value(value, max_chars=120).lower()
        for value in (req.artwork, req.room, req.question)
        if clean_value(value, max_chars=120)
    )
    if not wanted:
        return rows[0]

    def score(row: dict[str, Any]) -> int:
        text = " ".join(clean_value(value, max_chars=500).lower() for value in row.values())
        return sum(1 for word in re.findall(r"\w+", wanted) if len(word) > 3 and word in text)

    return max(rows, key=score)


def text_looks_english(text: str) -> bool:
    words = set(re.findall(r"[a-zA-Z]+", text.lower()))
    english_markers = {
        "the", "with", "and", "of", "from", "that", "this", "it", "is", "are",
        "was", "were", "had", "has", "still", "also", "very", "likely", "because",
    }
    return len(words & english_markers) >= 3


def text_matches_language(text: str, lang: str) -> bool:
    if not text:
        return True
    if lang in {"ca", "es"} and text_looks_english(text):
        return False
    return True


def is_meta_reformulation(text: str) -> bool:
    lower = text.lower().strip()
    meta_prefixes = (
        "here are",
        "here is",
        "rephrasing",
        "rewrite",
        "si us plau",
        "aquí tenen",
        "aqui tenen",
        "aquí tens",
        "aqui tens",
        "te proporciono",
        "a continuación",
        "a continuacion",
    )
    return (
        lower.startswith(meta_prefixes)
        or lower == "si us plau"
        or "reformulació" in lower
        or "reformulación" in lower
        or "reformulation" in lower
    )


def extractive_answer(req: AnswerRequest, lang: str, description_override: str | None = None) -> str:
    rows = req.context or req.rows or []
    if not rows:
        return ""

    row = best_context_row(rows, req)
    title = clean_value(req.artwork) or row_value(row, "title")
    artist = row_value(row, "artist")
    date = row_value(row, "date")
    room = clean_value(req.room) or row_value(row, "room")
    material = row_value(row, "material")
    description = row_value(row, "description") if description_override is None else description_override

    if lang == "ca":
        lines = []
        if title:
            lines.append(f"L'obra es diu {title}.")
        if artist:
            lines.append(f"La va fer {artist}.")
        if date:
            lines.append(f"És de {date}.")
        if material:
            lines.append(f"Està feta amb {material}.")
        if description:
            lines.append(description)
        if room:
            lines.append(f"La pots veure a {room}.")
    elif lang == "es":
        lines = []
        if title:
            lines.append(f"La obra se llama {title}.")
        if artist:
            lines.append(f"La hizo {artist}.")
        if date:
            lines.append(f"Es de {date}.")
        if material:
            lines.append(f"Está hecha con {material}.")
        if description:
            lines.append(description)
        if room:
            lines.append(f"La puedes ver en {room}.")
    else:
        lines = []
        if title:
            lines.append(f"The artwork is called {title}.")
        if artist:
            lines.append(f"It was made by {artist}.")
        if date:
            lines.append(f"It is from {date}.")
        if material:
            lines.append(f"It is made with {material}.")
        if description:
            lines.append(description)
        if room:
            lines.append(f"You can see it in {room}.")

    cleaned_lines = []
    for line in lines:
        line = clean_value(line, max_chars=260)
        if line and line not in cleaned_lines:
            cleaned_lines.append(line)

    return "\n".join(cleaned_lines[:5])


def build_factual_draft(req: AnswerRequest, lang: str) -> str:
    rows = req.context or req.rows or []
    if not rows:
        return ""

    row = best_context_row(rows, req)
    title = clean_value(req.artwork) or row_value(row, "title")
    artist = row_value(row, "artist")
    date = row_value(row, "date")
    room = clean_value(req.room) or row_value(row, "room")
    material = row_value(row, "material")
    description = row_value(row, "description")

    facts = []
    if title:
        facts.append(f"Title: {title}")
    if artist:
        facts.append(f"Artist: {artist}")
    if date:
        facts.append(f"Date: {date}")
    if material:
        facts.append(f"Material: {material}")
    if room:
        facts.append(f"Room: {room}")
    if description:
        facts.append(f"Description: {clean_value(description, max_chars=1400)}")

    return "\n".join(facts)


def question_asks_artist(question: str) -> bool:
    normalized = normalize_key(question)
    terms = {"artista", "autor", "autoria", "artist", "author", "creator", "creador"}
    return any(term in normalized for term in terms)


def sentence_join(lines: list[str]) -> str:
    return "\n".join(line for line in lines if line)


def normalize_answer_text(text: str) -> str:
    text = str(text or "").replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_repetition_text(text: str) -> list[str]:
    normalized = str(text or "").lower()
    normalized = re.sub(r"[^\w\s'-]", " ", normalized, flags=re.UNICODE)
    return re.findall(r"[\w'-]+", normalized, flags=re.UNICODE)


def has_repetitive_model_output(text: str) -> bool:
    words = normalize_repetition_text(text)
    if len(words) < 24:
        return False

    unique_ratio = len(set(words)) / len(words)
    if len(words) >= 40 and unique_ratio < 0.22:
        return True

    for size in (2, 3, 4, 5):
        grams = [tuple(words[index:index + size]) for index in range(len(words) - size + 1)]
        if not grams:
            continue
        most_common = max(grams.count(gram) for gram in set(grams))
        if most_common >= 6 and most_common * size >= len(words) * 0.35:
            return True

    return False


def build_grounded_answer(req: AnswerRequest, lang: str) -> str:
    rows = req.context or req.rows or []
    if not rows:
        return ""

    row = best_context_row(rows, req)
    title = clean_value(req.artwork) or row_value(row, "title")
    artist = row_value(row, "artist")
    date = row_value(row, "date")
    room = clean_value(req.room) or row_value(row, "room")
    material = row_value(row, "material")
    description = row_value(row, "description")

    if question_asks_artist(req.question):
        if not artist:
            return ""
        if lang == "ca":
            return f"L'artista de {title or 'aquesta obra'} és {artist}."
        if lang == "es":
            return f"El artista de {title or 'esta obra'} es {artist}."
        return f"The artist of {title or 'this artwork'} is {artist}."

    if lang == "ca":
        return sentence_join([
            f"L'obra es diu {title}." if title else "",
            f"La va fer {artist}." if artist else "",
            f"És de {date}." if date else "",
            f"Està feta amb {material}." if material else "",
            clean_value(description, max_chars=1400) if description else "",
            f"La pots veure a {room}." if room else "",
        ])

    if lang == "es":
        return sentence_join([
            f"La obra se llama {title}." if title else "",
            f"La hizo {artist}." if artist else "",
            f"Es de {date}." if date else "",
            f"Está hecha con {material}." if material else "",
            clean_value(description, max_chars=1400) if description else "",
            f"La puedes ver en {room}." if room else "",
        ])

    return sentence_join([
        f"The artwork is called {title}." if title else "",
        f"It was made by {artist}." if artist else "",
        f"It is from {date}." if date else "",
        f"It is made with {material}." if material else "",
        clean_value(description, max_chars=1400) if description else "",
        f"You can see it in {room}." if room else "",
    ])


def introduces_unsupported_ownership(original: str, simplified: str) -> bool:
    original_key = normalize_key(original)
    simplified_key = normalize_key(simplified)
    ownership_terms = ("propietari", "propietaria", "dueno", "duena", "owner", "owns", "owned")
    return not any(term in original_key for term in ownership_terms) and any(
        term in simplified_key for term in ownership_terms
    )


def has_enough_context(req: AnswerRequest) -> bool:
    rows = req.context or req.rows or []
    if not rows:
        return False

    row = best_context_row(rows, req)
    return any(row_value(row, field) for field in ("description", "artist", "date", "material"))


def simplify_grounded_answer(generator: IdemGenerator, req: AnswerRequest, lang: str, max_new_tokens: int) -> str:
    grounded_answer = build_grounded_answer(req, lang)
    if not grounded_answer or not has_enough_context(req):
        return ""

    simplification_prompt = (
        f"{IDEM_SIMPLIFICATION_PROMPTS.get(lang, IDEM_SIMPLIFICATION_PROMPTS['en'])}\n"
        f"INPUT:\n{grounded_answer}"
    )
    simplified = generator.simplify_with_official_idem(grounded_answer, lang)
    if not simplified:
        raw_simplified = generator.generate(simplification_prompt, max_new_tokens=max_new_tokens)
        simplified = first_reformulation(raw_simplified, grounded_answer, lang)
    if not simplified:
        simplified = grounded_answer
    simplified = normalize_answer_text(clean_value(simplified, max_chars=3000))
    if introduces_unsupported_ownership(grounded_answer, simplified):
        simplified = grounded_answer
    if has_repetitive_model_output(simplified):
        return ""
    if not simplified or not text_matches_language(simplified, lang):
        return ""
    return simplified


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
        if is_meta_reformulation(cleaned):
            continue

        cleaned = cleaned.lstrip("1234567890-").lstrip(".").strip()
        if cleaned:
            lines.append(cleaned)

    return normalize_answer_text("\n".join(lines).strip() or raw.strip())


def first_reformulation(output_text: str, original_text: str, lang: str) -> str:
    responses = []
    for line in output_text.splitlines():
        cleaned = clean_value(line, max_chars=3000)
        cleaned = re.sub(r"^(OUTPUT|INPUT|ANSWER|RESPOSTA|RESPUESTA)\s*:?\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"^si us plau,?\s*", "", cleaned, flags=re.I)
        cleaned = cleaned.lstrip("1234567890-").lstrip(".").strip()
        if not cleaned or cleaned == original_text.strip():
            continue
        if is_meta_reformulation(cleaned):
            continue
        if text_matches_language(cleaned, lang):
            responses.append(cleaned)
    return responses[0] if responses else ""


@app.get("/")
def health():
    return {"status": "ok", "service": "guia-idem-api"}


@app.post("/answer")
def answer(req: AnswerRequest):
    generator = load_model()
    lang = language_code(req.language)
    language_name = LANGUAGE_NAMES[lang]

    direct_prompt = (req.prompt or req.text or "").strip()
    if direct_prompt and not req.question.strip():
        input_text = direct_prompt[:2000]
    else:
        rows = req.context or req.rows
        if not rows:
            return {"answer": FALLBACKS[lang], "source": "no-context"}

        context_text = rows_to_context(rows)

        force_prompt = (
            f"Answer in {language_name} only.\n"
            "Use only the museum context.\n"
            "Use Easy Read language: short sentences and common words.\n"
            "Answer with the detail needed by the question and available context.\n"
            "Use complete sentences. Do not cut the answer in the middle of a sentence.\n"
            "Do not invent facts. Return only the answer.\n"
        )

        if req.instructions:
            force_prompt += f"\nExtra instructions:\n{str(req.instructions)[:700]}\n"

        input_text = (
            f"{force_prompt}\n"
            f"Context:\n{context_text}\n\n"
            f"Room: {req.room or 'Not provided'}\n"
            f"Artwork: {req.artwork or 'Not provided'}\n"
            f"Question: {req.question[:320]}"
        )

    default_tokens = 180 if generator.device.type == "cpu" else 220
    requested_tokens = req.max_new_tokens or int(os.getenv("IDEM_MAX_NEW_TOKENS", str(default_tokens)))
    max_new_tokens = max(64, min(requested_tokens, 240 if generator.device.type == "cpu" else 320))

    if not _generation_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail="iDEM is already generating an answer. Please use the fallback or try again later.",
        )

    try:
        use_cpu_simplifier = os.getenv("IDEM_CPU_SIMPLIFIER", "true").strip().lower() != "false"
        if (
            generator.device.type == "cpu"
            and use_cpu_simplifier
            and not (direct_prompt and not req.question.strip())
            and (req.context or req.rows)
        ):
            result = simplify_grounded_answer(generator, req, lang, max_new_tokens)
            source = "idem-easy-read"
        else:
            raw_result = generator.generate(input_text, max_new_tokens=max_new_tokens)
            result = clean_idem_output(raw_result, input_text)
            source = "idem-generate"
    finally:
        _generation_lock.release()

    if not result:
        result = FALLBACKS[lang]
    elif has_repetitive_model_output(result):
        result = FALLBACKS[lang]

    return {"answer": normalize_answer_text(result), "source": source}
