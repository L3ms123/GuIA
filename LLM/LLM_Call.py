"""
This file contains everything necessary to call the LLM with the input received from the RAG + initial query and then return the output.
"""

import os
from typing import Optional
from dotenv import load_dotenv
import cohere
from flask import Flask, request, jsonify
from flask_cors import CORS

# Load environment variables from .env file
load_dotenv()

# LLM DEFAULTS
MODEL_USED = "command-a-03-2025"
COHERE_CLIENT = cohere.Client(os.environ["COHERE_LLM_KEY"])

# Conversation storage (simple in-memory for now)
CONVERSATION_ID = "conversation_1"
CURRENT_ROOM = None
CURRENT_ARTWORK = None


def build_system_prompt(language: str = "English", age_range: str = "Adult 20-60 years old", personality: str = "Artist", room: Optional[str] = None, artwork: Optional[str] = None) -> str:
    """Build a dynamic system prompt based on user preferences and context."""
    prompt = (
        "You are an intelligent assistant that answers the user's question using the retrieved "
        "context provided by the retrieval-augmented generation (RAG) pipeline. "
        "You will answer questions related to museums and art. "
        "Do not hallucinate answers. If the information is not present in the retrieved context, "
        "say that you do not know or that the answer cannot be determined from the provided data. "
        f"The user can be described as {age_range}, talk to them like you're an {personality}. "
        f"From now on you will only answer in {language} unless you're specifically asked to change to another language."
    )
    
    # Add context information if available
    if room or artwork:
        context_info = f"\n\nCURRENT MUSEUM CONTEXT:"
        if room:
            context_info += f"\n- Room: {room}"
        if artwork:
            context_info += f"\n- Artwork being viewed: {artwork}"
        prompt += context_info
    
    return prompt


def call_llm(message: str, language: str = "English", age_range: str = "Adult 20-60 years old", personality: str = "Artist", room: Optional[str] = None, artwork: Optional[str] = None) -> str:
    """Call the Cohere LLM with user preferences and optional museum context."""
    system_prompt = build_system_prompt(language, age_range, personality, room, artwork)
    user_input = message
    
    response = COHERE_CLIENT.chat(
        model=MODEL_USED,
        preamble=system_prompt,
        message=user_input,
        conversation_id=CONVERSATION_ID
    )
    return response.text


# ─── Flask API ────────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)


@app.route("/chat", methods=["POST"])
def chat_endpoint():
    """API endpoint for chat requests with user preferences and context."""
    try:
        global CURRENT_ROOM, CURRENT_ARTWORK
        
        data = request.get_json()
        message = data.get("message", "").strip()
        language = data.get("language", "English")
        age_range = data.get("age_range", "Adult 20-60 years old")
        personality = data.get("personality", "Artist")
        room = data.get("room") or CURRENT_ROOM
        artwork = data.get("artwork") or CURRENT_ARTWORK
        
        if not message:
            return jsonify({"error": "Message cannot be empty"}), 400
        
        response = call_llm(message, language, age_range, personality, room, artwork)
        return jsonify({"response": response}), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/context", methods=["POST"])
def context_endpoint():
    """API endpoint to set current museum context (room and artwork)."""
    try:
        global CURRENT_ROOM, CURRENT_ARTWORK
        
        data = request.get_json()
        CURRENT_ROOM = data.get("room")
        CURRENT_ARTWORK = data.get("artwork")
        
        return jsonify({
            "status": "success",
            "room": CURRENT_ROOM,
            "artwork": CURRENT_ARTWORK
        }), 200
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    # Run Flask server for API requests (port 5002 to avoid conflict with speak.py)
    print("🚀 GuIA LLM API server starting on http://127.0.0.1:5002")
    app.run(debug=True, port=5002)


