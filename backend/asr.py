"""Backend ASR helpers for local multilingual transcription."""

from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional


ASR_MODEL = os.getenv("ASR_MODEL", "small")
ASR_DEVICE = os.getenv("ASR_DEVICE", "cpu")
ASR_COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "int8")
ASR_BEAM_SIZE = int(os.getenv("ASR_BEAM_SIZE", "1"))
ASR_DOWNLOAD_ROOT = os.getenv("ASR_DOWNLOAD_ROOT")


@lru_cache(maxsize=1)
def _load_whisper_model():
    from faster_whisper import WhisperModel

    kwargs = {
        "device": ASR_DEVICE,
        "compute_type": ASR_COMPUTE_TYPE,
    }
    if ASR_DOWNLOAD_ROOT:
        kwargs["download_root"] = ASR_DOWNLOAD_ROOT

    return WhisperModel(ASR_MODEL, **kwargs)


def transcribe_audio_bytes(
    audio_bytes: bytes,
    *,
    language: Optional[str] = None,
    suffix: str = ".webm",
) -> dict:
    """Transcribe recorded audio bytes with faster-whisper."""
    if not audio_bytes:
        raise ValueError("Audio bytes are required for transcription.")

    whisper_model = _load_whisper_model()

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_audio:
        temp_audio.write(audio_bytes)
        temp_path = Path(temp_audio.name)

    try:
        segments, info = whisper_model.transcribe(
            str(temp_path),
            language=language or None,
            beam_size=ASR_BEAM_SIZE,
            vad_filter=True,
            condition_on_previous_text=False,
            task="transcribe",
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text).strip()
        return {
            "text": text,
            "language": info.language,
            "language_probability": info.language_probability,
        }
    finally:
        temp_path.unlink(missing_ok=True)
