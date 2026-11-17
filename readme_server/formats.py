"""Turn supported document types into reader HTML.

Markdown keeps source line numbers (for editor sync). PDF, Word and text are converted
to Markdown/HTML first. PDFs come in page batches, so big books open quickly.
"""
from __future__ import annotations

import hashlib
import html
import re
from collections import Counter
from pathlib import Path

from .render import doc_title, render_markdown
from .tts import ROOT

DOC_EXT = {".md", ".markdown", ".mdx", ".pdf", ".docx", ".txt"}
PDF_FIRST = 8
PDF_BATCH = 25
_JUNK_TITLE = re.compile(r"^(microsoft (word|powerpoint)\s*-|untitled)|\.(docx?|pdf|pptx?)$", re.I)
CACHE = ROOT / "cache" / "docs"


def _cache_get(key: str) -> str | None:
    f = CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".html")
    return f.read_text(encoding="utf-8") if f.exists() else None


def _cache_put(key: str, value: str) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / (hashlib.sha1(key.encode()).hexdigest() + ".html")).write_text(value, encoding="utf-8")


def load(p: Path, start: int = 0) -> dict:
    """Returns {title, html, kind, next_start, total_pages}. next_start is set while a PDF has more pages."""
    ext = p.suffix.lower()
    if ext == ".pdf":
        return _pdf(p, start)
    if ext == ".docx":
        return _docx(p)
    text = p.read_text(encoding="utf-8", errors="replace")
    if ext == ".txt":
        paras = re.split(r"\n\s*\n", text.strip())
        body = "\n".join(f"<p>{html.escape(x)}</p>" for x in paras if x.strip())
        return {"title": p.stem, "html": body, "kind": "text", "next_start": None, "total_pages": None}
    return {"title": doc_title(text, p), "html": render_markdown(text, p.parent), "kind": "markdown",
            "next_start": None, "total_pages": None}


# ---------------------------------------------------------------- Word
def _docx(p: Path) -> dict:
    key = f"docx|{p}|{p.stat().st_mtime}"
    body = _cache_get(key)
    if body is None:
        import mammoth

        with p.open("rb") as f:
            body = mammoth.convert_to_html(f).value
        _cache_put(key, body)
    # The first heading of a Word doc is often a section ("Abstract"), so use the file name.
    return {"title": p.stem, "html": body, "kind": "word", "next_start": None, "total_pages": None}


# ---------------------------------------------------------------- PDF
def _strip_running_lines(pages: list[str]) -> list[str]:
    """Drop headers/footers: short lines that repeat on many pages (page numbers normalised)."""
    if len(pages) < 3:
        return pages
    norm = lambda s: re.sub(r"\d+", "#", s.strip().strip("*_# ").lower())
    counts = Counter()
    for pg in pages:
        counts.update({norm(l) for l in pg.splitlines() if 0 < len(l.strip()) < 80})
    limit = max(3, int(len(pages) * 0.4))
    running = {k for k, c in counts.items() if c >= limit and k and k != "#"}
    page_num = re.compile(r"^\W*(page\s*)?#(\s*(of|/)\s*#)?\W*$")
    out = []
    for pg in pages:
        keep = [l for l in pg.splitlines() if norm(l) not in running and not page_num.match(norm(l))]
        out.append("\n".join(keep))
    return out


def _pdf(p: Path, start: int) -> dict:
    import pymupdf
    import pymupdf4llm

    with pymupdf.open(p) as d:
        total = d.page_count
        meta_title = (d.metadata or {}).get("title") or ""
    start = max(0, min(start, total))
    end = min(total, start + (PDF_FIRST if start == 0 else PDF_BATCH))  # small first batch: opens fast
    key = f"pdf|{p}|{p.stat().st_mtime}|{start}|{end}"
    body = _cache_get(key)
    if body is None:
        chunks = pymupdf4llm.to_markdown(str(p), pages=list(range(start, end)), page_chunks=True,
                                         ignore_images=True, show_progress=False)
        texts = _strip_running_lines([c["text"] for c in chunks])
        parts = []
        for c, t in zip(chunks, texts):
            n = c["metadata"].get("page_number") or c["metadata"].get("page", 0) + 1
            t = t.replace("�", "")
            t = re.sub(r"(\w)-\n(\w)", r"\1\2", t)  # re-join hyphenated line breaks
            parts.append(f'\n\n<div class="page-mark" id="page-{n}">Page {n}</div>\n\n{t}')
        body = render_markdown("".join(parts), p.parent)
        _cache_put(key, body)
    if start == 0 and not re.sub(r"<[^>]+>|Page \d+", "", body).strip():
        body = ('<div class="banner">This PDF has no text layer (it looks scanned), so there is nothing '
                "to read yet. OCR support is on the roadmap.</div>") + body
    return {
        "title": p.stem if not meta_title.strip() or _JUNK_TITLE.search(meta_title.strip()) else meta_title.strip(),
        "html": body,
        "kind": "pdf",
        "next_start": end if end < total else None,
        "total_pages": total,
    }
