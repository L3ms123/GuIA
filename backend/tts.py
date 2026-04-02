"""Backend TTS helpers for higher-quality local narration."""

from __future__ import annotations

import io
import os
from functools import lru_cache
from pathlib import Path
from typing import Optional


PIPER_REPO_ID = os.getenv("PIPER_REPO_ID", "rhasspy/piper-voices")
PIPER_CACHE_DIR = Path(
    os.getenv("PIPER_CACHE_DIR", Path.home() / ".cache" / "guia" / "piper")
)

KOKORO_LANGUAGE_CODES = {
    "en": "a",
    "es": "e",
}

KOKORO_VOICES = {
    "en": {
        "child": os.getenv("KOKORO_VOICE_EN_CHILD", "af_heart"),
        "default": os.getenv("KOKORO_VOICE_EN", "bf_emma"),
    },
    "es": {
        "child": os.getenv("KOKORO_VOICE_ES_CHILD", "ef_dora"),
        "default": os.getenv("KOKORO_VOICE_ES", "em_alex"),
    },
}

PIPER_VOICES = {
    "ca": {
        "child": os.getenv("PIPER_VOICE_CA_CHILD", "ca_ES-upc_ona-medium"),
        "default": os.getenv("PIPER_VOICE_CA", "ca_ES-upc_ona-medium"),
    },
    "es": {
        "child": os.getenv("PIPER_VOICE_ES_CHILD", "es_ES-sharvard-medium"),
        "default": os.getenv("PIPER_VOICE_ES", "es_ES-davefx-medium"),
    },
    "en": {
        "child": os.getenv("PIPER_VOICE_EN_CHILD", "en_GB-alba-medium"),
        "default": os.getenv("PIPER_VOICE_EN", "en_US-libritts-high"),
    },
}

TTS_ENGINES = {
    "ca": os.getenv("TTS_ENGINE_CA", "piper"),
    "es": os.getenv("TTS_ENGINE_ES", "kokoro"),
    "en": os.getenv("TTS_ENGINE_EN", "kokoro"),
}

SPEED_MULTIPLIERS = {
    "slow": 0.9,
    "normal": 1.0,
    "fast": 1.1,
}


def _resolve_voice(voice_map: dict, language: str, age: Optional[str]) -> str:
    language_voices = voice_map.get(language) or voice_map["en"]
    if age == "child":
        return language_voices["child"]
    return language_voices["default"]


def _resolve_speed_multiplier(speed: str) -> float:
    return SPEED_MULTIPLIERS.get(speed, SPEED_MULTIPLIERS["normal"])


@lru_cache(maxsize=8)
def _load_piper_voice(voice_name: str):
    from huggingface_hub import hf_hub_download
    from piper.voice import PiperVoice

    language_code, speaker_name, quality = voice_name.split("-", 2)
    language_root = language_code.split("_", 1)[0]
    base_filename = f"{voice_name}.onnx"
    repo_path = f"{language_root}/{language_code}/{speaker_name}/{quality}/{base_filename}"

    model_path = hf_hub_download(
        repo_id=PIPER_REPO_ID,
        filename=repo_path,
        local_dir=PIPER_CACHE_DIR,
    )
    config_path = hf_hub_download(
        repo_id=PIPER_REPO_ID,
        filename=f"{repo_path}.json",
        local_dir=PIPER_CACHE_DIR,
    )
    return PiperVoice.load(model_path=model_path, config_path=config_path, use_cuda=False)


def _synthesize_with_piper(text: str, language: str, age: Optional[str], speed: str) -> bytes:
    import numpy as np
    import soundfile as sf
    from piper.config import SynthesisConfig

    voice_name = _resolve_voice(PIPER_VOICES, language, age)
    voice = _load_piper_voice(voice_name)
    speed_multiplier = _resolve_speed_multiplier(speed)
    syn_config = SynthesisConfig(
        length_scale=1 / speed_multiplier,
    )

    audio_chunks = list(voice.synthesize(text=text, syn_config=syn_config))
    if not audio_chunks:
        raise RuntimeError("Piper did not return any audio.")

    wav_buffer = io.BytesIO()
    audio_arrays = [chunk.audio_float_array for chunk in audio_chunks if chunk.audio_float_array is not None]
    if not audio_arrays:
        raise RuntimeError("Piper did not return any audio samples.")
    sample_rate = audio_chunks[0].sample_rate
    sf.write(wav_buffer, np.concatenate(audio_arrays), sample_rate, format="WAV", subtype="PCM_16")
    return wav_buffer.getvalue()


@lru_cache(maxsize=4)
def _load_kokoro_pipeline(language: str):
    from kokoro import KPipeline

    language_code = KOKORO_LANGUAGE_CODES.get(language)
    if not language_code:
        raise RuntimeError(f"Kokoro is not configured for language '{language}'.")

    return KPipeline(lang_code=language_code)


def _synthesize_with_kokoro(text: str, language: str, age: Optional[str], speed: str) -> bytes:
    import numpy as np
    import soundfile as sf

    voice_name = _resolve_voice(KOKORO_VOICES, language, age)
    pipeline = _load_kokoro_pipeline(language)
    speed_multiplier = _resolve_speed_multiplier(speed)

    audio_parts = []
    for _, _, audio in pipeline(text, voice=voice_name, speed=speed_multiplier):
        audio_parts.append(audio)

    if not audio_parts:
        raise RuntimeError("Kokoro did not return any audio.")

    wav_buffer = io.BytesIO()
    sf.write(wav_buffer, np.concatenate(audio_parts), 24000, format="WAV")
    return wav_buffer.getvalue()


def synthesize_speech(text: str, language: Optional[str], age: Optional[str], speed: str) -> bytes:
    """Generate WAV audio from text using the configured local TTS engine."""
    normalized_language = (language or "ca").lower()
    engine = TTS_ENGINES.get(normalized_language, "piper")

    if engine == "piper":
        return _synthesize_with_piper(text, normalized_language, age, speed)

    if engine == "kokoro":
        try:
            return _synthesize_with_kokoro(text, normalized_language, age, speed)
        except Exception:
            return _synthesize_with_piper(text, normalized_language, age, speed)

    raise RuntimeError(f"Unsupported TTS engine '{engine}'.")
