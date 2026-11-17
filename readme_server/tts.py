"""Kokoro (ONNX) text-to-speech with an on-disk WAV cache."""
from __future__ import annotations

import hashlib
import io
import threading
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models"
CACHE_DIR = ROOT / "cache" / "audio"
MODEL_FILE = MODEL_DIR / "kokoro-v1.0.onnx"
VOICES_FILE = MODEL_DIR / "voices-v1.0.bin"

DEFAULT_VOICE = "af_heart"


class TTS:
    def __init__(self) -> None:
        self._kokoro = None
        self._lock = threading.Lock()
        CACHE_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def ready(self) -> bool:
        return MODEL_FILE.exists() and VOICES_FILE.exists()

    def _engine(self):
        if self._kokoro is None:
            if not self.ready:
                raise RuntimeError(
                    "Kokoro model files missing. Run: .venv\\Scripts\\python scripts\\get_models.py"
                )
            from kokoro_onnx import Kokoro

            self._kokoro = Kokoro(str(MODEL_FILE), str(VOICES_FILE))
        return self._kokoro

    def voices(self) -> list[str]:
        with self._lock:
            return sorted(self._engine().get_voices())

    def synth(self, text: str, voice: str = DEFAULT_VOICE) -> bytes:
        lang = "en-gb" if voice.startswith("b") else "en-us"
        key = hashlib.sha1(f"{voice}|{lang}|{text}".encode()).hexdigest()
        cached = CACHE_DIR / f"{key}.wav"
        if cached.exists():
            return cached.read_bytes()
        with self._lock:  # one ONNX session; serialise inference
            samples, rate = self._engine().create(text, voice=voice, speed=1.0, lang=lang)
        buf = io.BytesIO()
        sf.write(buf, samples, rate, format="WAV", subtype="PCM_16")
        data = buf.getvalue()
        cached.write_bytes(data)
        return data
