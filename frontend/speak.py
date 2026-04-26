import edge_tts
import asyncio
from flask import Flask, request, send_file, after_this_request
import os
from flask_cors import CORS
import tempfile

app = Flask(__name__)
CORS(app)

VOICE_MAP = {
    "en": "en-US-JennyNeural",
    "es": "es-ES-ElviraNeural",
    "ca": "ca-ES-JoanaNeural"
}

async def generate_audio(text, voice, output):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(output)

@app.route("/speak", methods=["POST"])
def tts():
    data = request.get_json()
    text = data["text"]
    lang = data.get("lang", "en")

    voice = VOICE_MAP.get(lang, VOICE_MAP["en"])

    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as f:
        filename = f.name

    asyncio.run(generate_audio(text=text, voice=voice, output=filename))

    @after_this_request
    def cleanup(response):
        try:
            os.remove(filename)
        except:
            pass
        return response


    return send_file(filename, mimetype="audio/mpeg")

if __name__ == "__main__":
    app.run(debug=True)