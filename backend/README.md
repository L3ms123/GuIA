# Backend

This folder contains the Python backend that builds the persona-aware prompt and sends the final request to a local open-source model through Ollama.

## What it does

- Receives the chat message from the frontend
- Builds the system prompt from:
  - selected persona
  - selected visitor type
  - selected language
  - selected room/artwork context
- Sends the final request to a local Ollama model
- Leaves `graph_context` ready for later RAG or graph-RAG integration

## First-time setup

These steps are for Windows PowerShell.

### 1. Create or activate the virtual environment

From the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install -r .\backend\requirements.txt
```

If the repo already has `.venv`, just activate it and install the requirements if needed:

```powershell
.\.venv\Scripts\activate
pip install -r .\backend\requirements.txt
```

### 2. Install Ollama

Install Ollama for Windows from:

```text
https://ollama.com/download/windows
```

After installing Ollama:

1. Close PowerShell completely
2. Open a new PowerShell window
3. Check that Ollama is available:

```powershell
ollama --version
```

### 3. Download the model

Pull the default models once:

```powershell
ollama pull qwen2.5:3b
ollama pull gemma3n:e2b
```

The backend expects Ollama at `http://127.0.0.1:11434`.

This repo now defaults to:

- `gemma3n:e2b` for Catalan
- `qwen2.5:3b` for Spanish and English

This keeps a multilingual model that fits better on low-memory machines for Catalan while preserving a lighter default for the other languages.

### 4. Install the speech prerequisites

For higher-quality backend narration, install the backend requirements and `espeak-ng` on Windows.

Install `espeak-ng` from:

```text
https://github.com/espeak-ng/espeak-ng/releases
```

After installing it, reopen PowerShell so the phonemizer can find it.

## Start everything with one command

From the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-dev.ps1
```

What this script does:

- Starts Ollama if it is not already running
- Starts the backend on port `8000`
- Starts the frontend on port `8080`
- Opens the browser

Optional examples:

```powershell
.\start-dev.ps1 -NoBrowser
.\start-dev.ps1 -Model qwen2.5:3b
.\start-dev.ps1 -Model qwen2.5:3b -CatalanModel gemma3n:e2b
```

The launcher supports both:

- `backend\.venv`
- repo-root `.venv`

## Start manually

If you prefer to launch each part yourself:

### Backend

From the repository root:

```powershell
.\.venv\Scripts\activate
cd .\backend
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

### Frontend

In another terminal:

```powershell
cd .\frontend
python -m http.server 8080
```

### Ollama

In another terminal:

```powershell
ollama serve
```

If Ollama is already running, you do not need to start it again.

### Voice features

Voice input and narration now go through the Python backend:

- backend ASR with `faster-whisper` for microphone transcription
- live dictation updates the input field while audio chunks are being transcribed
- the microphone stops when you click it again, and the transcribed text stays in the input until you press send
- backend TTS for narrated answers instead of browser `speechSynthesis`
- Catalan narration through Piper voices
- Spanish and English narration through Kokoro by default, with Piper fallback if Kokoro is unavailable
- child mode choosing the child-oriented voice when one is configured for that language

The first ASR request may take longer because the Whisper model is downloaded and cached locally. The first TTS request may also take longer because Piper voice files are downloaded and cached locally.

## Quick tests

### Health check

This confirms the backend is running:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok"}
```

### Chat endpoint test

This tests the full backend-to-Ollama path without using the frontend:

```powershell
$body = @{
  message = "Tell me about this artwork"
  persona = "storyteller"
  age = "adult"
  language = "en"
  context = @{
    room = "Room 2 - High Renaissance"
    artwork = "Portrait of a Noblewoman"
  }
  history = @()
  graph_context = ""
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://127.0.0.1:8000/api/chat -Method Post -ContentType "application/json" -Body $body
```

Expected JSON fields:

- `reply`
- `model`
- `system_prompt`

### Frontend test

Open:

```text
http://127.0.0.1:8080
```

Then:

1. Choose a language
2. Choose a persona
3. Optionally choose an age
4. Start the visit
5. Send a message in the chat

If everything is running, the reply should come from the backend and the local Ollama model.

## Normal behavior

- `GET /` on port `8000` returning `404 Not Found` is normal
- `GET /favicon.ico` on port `8000` returning `404 Not Found` is also normal

The backend is meant to expose API routes such as:

- `GET /health`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/tts`
- `POST /api/transcribe`

## If something fails

### `ollama` is not recognized

That means Ollama is not installed yet, or PowerShell has not picked up the new PATH.

Fix:

1. Install Ollama
2. Close PowerShell
3. Open PowerShell again
4. Run:

```powershell
ollama --version
```

### `/health` works but `/api/chat` fails

Usually Ollama is not running, the model has not been pulled yet, or `localhost` resolved differently from `127.0.0.1`.

Check:

```powershell
ollama pull qwen2.5:3b
ollama pull gemma3n:e2b
ollama serve
```

### The frontend opens but chat does nothing

Make sure the frontend is served over HTTP:

```powershell
cd .\frontend
python -m http.server 8080
```

Do not open `index.html` directly from the filesystem.

## Optional environment variables

- `OLLAMA_URL`
- `OLLAMA_MODEL`
- `OLLAMA_MODEL_CA`
- `OLLAMA_MODEL_ES`
- `OLLAMA_MODEL_EN`
- `OLLAMA_TIMEOUT`
- `ASR_MODEL`
- `ASR_DEVICE`
- `ASR_COMPUTE_TYPE`
- `TTS_ENGINE_CA`
- `TTS_ENGINE_ES`
- `TTS_ENGINE_EN`

Example:

```powershell
$env:OLLAMA_MODEL_CA = "gemma3n:e2b"
$env:OLLAMA_MODEL_ES = "qwen2.5:3b"
$env:OLLAMA_MODEL_EN = "qwen2.5:3b"
$env:ASR_MODEL = "small"
$env:ASR_DEVICE = "cpu"
$env:ASR_COMPUTE_TYPE = "int8"
$env:TTS_ENGINE_CA = "piper"
$env:TTS_ENGINE_ES = "kokoro"
$env:TTS_ENGINE_EN = "kokoro"
cd .\backend
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

## API

`POST /api/chat`

Expected JSON body:

```json
{
  "message": "Tell me about this artwork",
  "persona": "storyteller",
  "age": "adult",
  "language": "en",
  "context": {
    "room": "Room 2 - High Renaissance",
    "artwork": "Portrait of a Noblewoman"
  },
  "history": [],
  "graph_context": ""
}
```

`graph_context` is optional and is already supported for later RAG integration.

`POST /api/tts`

Expected JSON body:

```json
{
  "text": "Benvinguts al museu.",
  "language": "ca",
  "age": "child",
  "speed": "normal"
}
```

Response:

- `audio/wav`

`POST /api/transcribe`

Expected multipart form fields:

- `file`: recorded audio file, for example `audio/webm`
- `language`: optional language hint such as `ca`, `es`, or `en`

Expected JSON fields:

- `text`
- `language`
- `language_probability`

## Model files and Git

Do not commit Ollama model weights to the Git repository.

Why:

- Model files are very large
- They make clone, pull, and CI much heavier
- The model can stay local in Ollama instead

Recommended approach:

- Keep the backend code in Git
- Keep the model installed locally with `ollama pull`
- If you later build a custom model, commit only the `Modelfile` or setup instructions, not the weight files
