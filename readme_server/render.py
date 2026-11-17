"""Markdown -> HTML, with source line numbers on every block.

Every block element gets data-line / data-line-end (0-based, end exclusive) so the
reader can tell an editor which source lines are being read.
"""
from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import quote

from markdown_it import MarkdownIt
from mdit_py_plugins.front_matter import front_matter_plugin
from mdit_py_plugins.tasklists import tasklists_plugin

_md = (
    MarkdownIt("commonmark", {"html": True, "linkify": False, "typographer": False})
    .enable(["table", "strikethrough"])
    .use(front_matter_plugin)
    .use(tasklists_plugin)
)

# Front matter is metadata, not something to read or show.
_md.add_render_rule("front_matter", lambda *a, **k: "")

_EXTERNAL = re.compile(r"^(?:[a-z][a-z0-9+.-]*:|//|#)", re.I)


def _image_rule(self, tokens, idx, options, env):
    token = tokens[idx]
    src = token.attrGet("src") or ""
    if src and not _EXTERNAL.match(src):
        base: Path = env["base_dir"]
        target = (base / src.split("#")[0].split("?")[0]).resolve()
        token.attrSet("src", "/raw?path=" + quote(str(target)))
    return self.image(tokens, idx, options, env)


_md.add_render_rule("image", _image_rule)


def render_markdown(text: str, base_dir: Path) -> str:
    env = {"base_dir": base_dir}
    tokens = _md.parse(text, env)
    for tok in tokens:
        if tok.map and (tok.nesting == 1 or tok.type in ("fence", "code_block", "html_block", "hr")):
            tok.attrSet("data-line", str(tok.map[0]))
            tok.attrSet("data-line-end", str(tok.map[1]))
    return _md.renderer.render(tokens, _md.options, env)


def doc_title(text: str, path: Path) -> str:
    m = re.search(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", text, re.M)
    return m.group(1) if m else path.name
