"""Reader server: serves the UI, renders Markdown, speaks sentences.

All paths in requests/responses are *host* paths (e.g. C:\\laragon\\www\\x.md); see paths.py
for how they map into a Docker container.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .paths import to_host, to_local
from .render import doc_title, render_markdown
from .speech import speakable
from .tts import DEFAULT_VOICE, ROOT, TTS

STATIC = Path(__file__).resolve().parent / "static"
PROGRESS_FILE = ROOT / "data" / "progress.json"
MD_EXT = {".md", ".markdown", ".mdx"}
IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"}
SKIP_DIRS = {".git", "node_modules", ".venv", "venv", "vendor", "__pycache__", ".next", "dist", "build"}

app = FastAPI(title="read_me")
app.state.root = os.environ.get("READ_ME_ROOT", str(Path.home()))
tts = TTS()
_progress_lock = threading.Lock()


@app.on_event("startup")
def _warm_up():
    # Load the model in the background so the first sentence isn't slow.
    if tts.ready:
        threading.Thread(target=tts.voices, daemon=True).start()


@app.middleware("http")
async def local_only(request: Request, call_next):
    # Guard against DNS rebinding: only answer requests addressed to this machine.
    host = (request.headers.get("host") or "").split(":")[0]
    if host not in {"127.0.0.1", "localhost"}:
        return JSONResponse({"error": "forbidden host"}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/static/") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache"
    if response.headers.get("content-type", "").startswith("text/html"):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data: https: http:; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' blob:"
        )
    return response


def _resolve_md(path: str) -> Path:
    p = to_local(path).resolve()
    if p.suffix.lower() not in MD_EXT or not p.is_file():
        raise HTTPException(404, f"Not a Markdown file (or not mounted): {path}")
    return p


@app.get("/api/health")
def health():
    return {"ok": True, "tts_ready": tts.ready, "root": to_host(app.state.root)}


@app.get("/api/doc")
def get_doc(path: str):
    p = _resolve_md(path)
    text = p.read_text(encoding="utf-8", errors="replace")
    return {
        "path": to_host(p),
        "title": doc_title(text, p),
        "mtime": p.stat().st_mtime,
        "html": render_markdown(text, p.parent),
    }


@app.get("/api/mtime")
def get_mtime(path: str):
    return {"mtime": _resolve_md(path).stat().st_mtime}


@app.get("/api/files")
def list_files(root: str | None = None):
    base = (to_local(root) if root else Path(app.state.root)).resolve()
    if not base.is_dir():
        raise HTTPException(404, f"Not a folder (or not mounted): {root or app.state.root}")
    found: list[str] = []
    truncated = False
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith("."))
        for f in sorted(filenames):
            if Path(f).suffix.lower() in MD_EXT:
                found.append(to_host(Path(dirpath) / f))
        if len(found) >= 3000:
            truncated = True
            break
    return {"root": to_host(base), "files": found[:3000], "truncated": truncated}


@app.get("/raw")
def raw(path: str):
    p = to_local(path).resolve()
    if p.suffix.lower() not in IMG_EXT or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


class SpeakIn(BaseModel):
    text: str
    voice: str = DEFAULT_VOICE


@app.post("/api/tts")
def speak(body: SpeakIn):
    text = speakable(body.text)[:2000]
    if not text:
        raise HTTPException(400, "nothing to say")
    try:
        wav = tts.synth(text, body.voice)
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/voices")
def voices():
    try:
        return {"voices": tts.voices(), "default": DEFAULT_VOICE}
    except RuntimeError as e:
        raise HTTPException(503, str(e))


def _key(path: str) -> str:
    return to_host(to_local(path).resolve()).lower()


def _load_progress() -> dict:
    try:
        return json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


@app.get("/api/progress")
def get_progress(path: str):
    return _load_progress().get(_key(path), {})


class ProgressIn(BaseModel):
    path: str
    index: int
    line: int | None = None


@app.put("/api/progress")
def put_progress(body: ProgressIn):
    with _progress_lock:
        data = _load_progress()
        data[_key(body.path)] = {"index": body.index, "line": body.line}
        PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROGRESS_FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")
    return {"ok": True}


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", media_type="text/html")


app.mount("/static", StaticFiles(directory=STATIC), name="static")
