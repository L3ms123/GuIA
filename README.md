# GuIA - Adaptive AI Museum Audio Guide 🎧🤖

## Overview
This project proposes an adaptive AI-powered museum audio guide that provides interactive spoken dialogue and personalized explanations using AI designed to improve the traditional museum visiting experience.

The guide is implemented as a web platform and operates mainly through a chat (spoken or written) interface with audio integrated, allowing natural interaction for visitors of all age groups.

## Architecture 🏗️

### Knowledge Representation Graph 🕸️

The system uses a Knowledge Representation (KR) graph built from curated museum data.
The graph contains:
- Exhibit information
- Historical context
- Relationships between objects
- Physical locations in the museum

This ensures:
- Factual accuracy
- Institutional reliability
- Consistent explanations

### RAG + LLM Architecture ⚙️🤖
The system uses Retrieval-Augmented Generation (RAG) connected to a prebuilt Large Language Model (LLM).

Workflow:
1.  User asks a question
2.  Relevant data is retrieved from the KR graph
3.  Retrieved data is sent to the LLM
4.  The LLM generates a natural language response


## Personalization 🎯

### 1. Contextual adaptation

The system adapts explanations according to the visitor profile. Examples:
- Children → simpler language, gamification
- Adults → standard explanations
- Experts → more in deep explainations
- Elderly users → slower speech, clearer structure
- Interests are also taken into account as prompts

This transforms the experience from a static guide into a customized educational interaction.

### 2. Multilingual Support 🌍
Supported languages:
- English
- Spanish
- Catalan
 
### 3. Accesibility ♿
The system is designed to be accessible to users with different needs and abilities.

Accessibility features include:
- Voice interaction for users with limited vision or reading difficulties
- Text chat for users with hearing impairments
- Adjustable speech speed and volume
- Clear and simplified language modes
- Multilingual support for non-native speakers
- High-contrast and readable interface design

These features ensure that the museum experience is inclusive and usable for the widest possible audience.

## Run the App

From Windows, run:

```bat
run_guia.bat
```

Or from any terminal with the project environment activated:

```bash
python run_guia.py
```

Before starting, create `LLM/.env` with `COHERE_LLM_KEY=your_key_here`.

Lectura facil uses iDEM directly through an HTTP API for Easy Read answers instead of generating with Cohere and then doing word-by-word replacement. Configure the iDEM endpoint in `LLM/.env`:

```env
# This should be an iDEM endpoint that answers from context, not a rewrite endpoint.
IDEM_API_URL=http://127.0.0.1:8001/answer
```

For the Hugging Face Space created for this project, use:

```env
IDEM_API_URL=https://rafelsv-guia-idem-api.hf.space/answer
```

GuIA sends iDEM a structured payload with `question`, `context`, `graph_context`, `room`, `artwork`, and Easy Read instructions. If iDEM is not configured or returns an error, GuIA falls back to the normal Cohere guide path with the Easy Read prompt.

This starts the frontend at `http://127.0.0.1:8000`, the audio API at `http://127.0.0.1:5000`, and the LLM API at `http://127.0.0.1:5002`. Press `Ctrl+C` in that same terminal to stop everything.

## Deploy on Hugging Face Spaces

This repository includes a Docker setup for Hugging Face Spaces. The Space runs one Flask app on port `7860` that serves:

- the frontend from `frontend/`
- the LLM routes such as `/chat/stream`, `/context`, `/locations`
- the audio routes `/speak` and `/transcribe`

Create a new Hugging Face Space with:

```text
SDK: Docker
Visibility: Public or Private
Hardware: CPU Basic
```

Then add these Space secrets:

```env
COHERE_LLM_KEY=your_cohere_key_here
IDEM_API_URL=https://rafelsv-guia-idem-api.hf.space/answer
```

If you use Neo4j Aura or another public Neo4j endpoint for graph retrieval, also add:

```env
NEO4J_URI=your_neo4j_uri
NEO4J_USERNAME=your_neo4j_username
NEO4J_PASSWORD=your_neo4j_password
NEO4J_DATABASE=neo4j
```

Push this repository to the Space repository. Hugging Face will build the `Dockerfile` and serve the demo at the Space URL.

For local development, keep using:

```bash
python run_guia.py
```

The frontend automatically uses the local split services on `127.0.0.1:8000`, and uses same-origin API routes when deployed.






