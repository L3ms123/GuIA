import asyncio
import os
import shutil
import tempfile
from functools import lru_cache
from threading import Lock

import edge_tts
from flask import Flask, after_this_request, jsonify, request, send_file
from flask_cors import CORS


app = Flask(__name__)
CORS(app)

WHISPER_MODEL_LOCK = Lock()
WHISPER_FFMPEG_CONFIGURED = False

VOICE_MAP = {
    "en": "en-US-JennyNeural",
    "es": "es-ES-ElviraNeural",
    "ca": "ca-ES-JoanaNeural",
}

AUDIO_SUFFIXES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
}


def get_ffmpeg_executable():
    system_ffmpeg = shutil.which("ffmpeg")
    if system_ffmpeg:
        return system_ffmpeg

    try:
        import imageio_ffmpeg
    except ImportError as exc:
        raise RuntimeError(
            "Whisper needs ffmpeg to decode microphone audio. Install system ffmpeg "
            "or run: python -m pip install imageio-ffmpeg"
        ) from exc

    return imageio_ffmpeg.get_ffmpeg_exe()


def configure_whisper_ffmpeg():
    global WHISPER_FFMPEG_CONFIGURED

    if WHISPER_FFMPEG_CONFIGURED:
        return

    import whisper.audio as whisper_audio

    ffmpeg_executable = get_ffmpeg_executable()
    original_run = whisper_audio.run

    def run_with_configured_ffmpeg(cmd, *args, **kwargs):
        if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
            cmd = [ffmpeg_executable, *cmd[1:]]
        return original_run(cmd, *args, **kwargs)

    whisper_audio.run = run_with_configured_ffmpeg
    WHISPER_FFMPEG_CONFIGURED = True


@lru_cache(maxsize=1)
def load_whisper_model(model_name):
    import whisper

    configure_whisper_ffmpeg()
    return whisper.load_model(model_name)


def get_whisper_model():
    model_name = os.getenv("WHISPER_MODEL", "base")
    with WHISPER_MODEL_LOCK:
        return load_whisper_model(model_name)


async def generate_audio(text, voice, output):
    communicate = edge_tts.Communicate(text=text, voice=voice)
    await communicate.save(output)


def upload_suffix(audio):
    mimetype = (audio.mimetype or "").split(";", 1)[0].lower()
    return AUDIO_SUFFIXES.get(mimetype, ".webm")


@app.route("/transcribe", methods=["POST"])
def transcribe():
    if "file" not in request.files:
        return jsonify({"error": "Missing audio file"}), 400

    audio = request.files["file"]
    lang = request.form.get("lang", "auto")
    whisper_lang = None if lang in ("", "auto") else lang

    fd, filename = tempfile.mkstemp(suffix=upload_suffix(audio))
    os.close(fd)

    try:
        audio.save(filename)
        kwargs = {"language": whisper_lang} if whisper_lang else {}
        result = get_whisper_model().transcribe(filename, **kwargs)
        return jsonify({"text": result["text"]})
    except Exception as exc:
        app.logger.exception("Transcription failed")
        return jsonify({"error": str(exc)}), 500
    finally:
        try:
            os.remove(filename)
        except OSError:
            pass


@app.route("/speak", methods=["POST"])
def tts():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    lang = data.get("lang", "en")

    if not text:
        return jsonify({"error": "Missing text"}), 400

    voice = VOICE_MAP.get(lang, VOICE_MAP["en"])
    fd, filename = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)

    try:
        asyncio.run(generate_audio(text=text, voice=voice, output=filename))
    except Exception as exc:
        try:
            os.remove(filename)
        except OSError:
            pass
        return jsonify({"error": str(exc)}), 500

    @after_this_request
    def cleanup(response):
        try:
            os.remove(filename)
        except OSError:
            pass
        return response

    return send_file(filename, mimetype="audio/mpeg")


if __name__ == "__main__":
    print("GuIA audio API starting on http://127.0.0.1:5000", flush=True)
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
