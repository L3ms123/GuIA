"""
This file contains everything necessary to call the LLM with the input received from the RAG + initial query and then return the output.
"""

import os
import json
from typing import Optional
from dotenv import load_dotenv
import cohere
from flask import Flask, Response, request, jsonify, stream_with_context
from flask_cors import CORS

# Load environment variables from .env file
load_dotenv()

# LLM DEFAULTS
MODEL_USED = "command-a-03-2025"
COHERE_CLIENT = cohere.Client(os.environ["COHERE_LLM_KEY"])
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

# Conversation storage (simple in-memory for now)
SESSION_CONTEXTS = {}

# Personality/ age descriptions to add to the prompt
PERSONALITY_DESCRIPTIONS = {
    "Artist": "You have a creative and expressive style, using emotional language. Focus on technique, materials, the act of making. ",
    "Explorer": "Efficient. Lead with the most surprising fact. Do not over-explain.",
    "Storyteller": "Narrative, first-person connection. Start with a human moment. Weave facts into compelling stories.",
    "Sholar": "Analytical. Include provenance, dates, historical context, comparative references. Formal register. You have a clear and informative style, breaking down complex concepts into easy-to-understand explanations.",
}
AGE_DESCRIPTIONS = {
    "Young 10-18 years old": "You use a engaging, relatable and energetic style suitable for younger visitors.",
    "Adult 19-60 years old": "You use a mature and informative style. Full depth as defined by persona",
    "Senior 60+ years old": "You use a relatable and clear style, providing rich historical context suitable to senior visitors.",
}

def build_system_prompt(
    language: str = "en",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None
) -> str:
    """Build a dynamic system prompt based on user preferences and context."""

    language_rule = get_language_rule(language)

    prompt = (
        "You are GuIA, the AI audio guide of the Museu del Renaixement in Molins de Rei."
        "You speak only about this museum and its collection."
        "You answer the user's questions using the retrieved context provided by the "
        "retrieval-augmented generation pipeline. "
        "You answer questions related to museums, artworks, rooms, artists, history and art interpretation. "
        "Never invent facts. If the information is not present in the retrieved context, "
        "say that you do not know or that the answer cannot be determined from the provided data. "
        "\n\n"
        f"LANGUAGE RULE: {language_rule} "
        "Do not answer in any other language unless the user explicitly asks you to change language (only english, spanish or catalan) in the current message."
        "\n\n"
        f"VISITOR PROFILE: The user can be described as {age_range}. " # This can be undefined
        f"Guide them with the personality/style of {personality}."
        # Consider adding artworks seen so far
    )

    if room or artwork:
        prompt += "\n\nCURRENT MUSEUM CONTEXT:"
        if room:
            prompt += f"\n- Room: {room}"
        if artwork:
            prompt += f"\n- Artwork being viewed: {artwork}"

    return prompt


def call_llm(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None
) -> str:
    """Call the Cohere LLM with user preferences and optional museum context."""
    system_prompt = build_system_prompt(language, age_range, personality, room, artwork)

    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble=system_prompt,
        message=message,
        conversation_id=f"guia_{session_id}"
    )

    return response.text


def stream_llm(
    message: str,
    session_id: str,
    language: str = "English",
    age_range: str = "Adult 20-60 years old",
    personality: str = "Artist",
    room: Optional[str] = None,
    artwork: Optional[str] = None
):
    """Yield generated text chunks from Cohere as they arrive."""
    system_prompt = build_system_prompt(language, age_range, personality, room, artwork)

    response = COHERE_CLIENT.chat_stream(
        model=MODEL_USED,
        preamble=system_prompt,
        message=message,
        conversation_id=f"guia_{session_id}"
    )

    for event in response:
        event_type = getattr(event, "event_type", None)
        if event_type == "text-generation":
            text = getattr(event, "text", "")
            if text:
                yield text


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

        response = call_llm(
            message=message,
            session_id=session_id,
            language=language,
            age_range=age_range,
            personality=personality,
            room=room,
            artwork=artwork
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

            for text in stream_llm(
                message=message,
                session_id=session_id,
                language=language,
                age_range=age_range,
                personality=personality,
                room=room,
                artwork=artwork
            ):
                yield stream_event({"type": "delta", "text": text})

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
    print("🚀 GuIA LLM API server starting on http://127.0.0.1:5002")
    app.run(debug=True, port=5002)


