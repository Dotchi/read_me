"""Make developer text speakable before it reaches the TTS engine.

The browser decides *what* to read (it knows the document structure); this module
decides *how* it sounds: identifiers, paths, operators and URLs.
"""
from __future__ import annotations

import re

_URL = re.compile(r"\bhttps?://[^\s)>\]]+", re.I)

_PHRASES = [
    (re.compile(r"\be\.g\.", re.I), "for example"),
    (re.compile(r"\bi\.e\.", re.I), "that is"),
    (re.compile(r"\betc\."), "etcetera"),
    (re.compile(r"\bvs\.?(?=\s)"), "versus"),
]

_OPERATORS = [
    ("===", " strictly equals "),
    ("!==", " strictly not equal "),
    ("==", " equals "),
    ("!=", " not equal "),
    ("<=", " less than or equal "),
    (">=", " greater than or equal "),
    ("=>", " arrow "),
    ("->", " arrow "),
    ("&&", " and "),
    ("||", " or "),
    ("::", " "),
]

# A "word" that looks like code: has _, internal capitals, dots between letters, or slashes.
_CODEISH = re.compile(r"[A-Za-z0-9_$][\w$.\\/:-]*[\w$]")


def _split_identifier(word: str) -> str:
    # Paths and dotted names: README.md -> README dot md, src/app -> src slash app
    word = re.sub(r"(?<=\w)\.(?=\w)", " dot ", word)
    word = re.sub(r"(?<=\w)[\\/](?=\w)", " slash ", word)
    word = word.replace("_", " ")
    # camelCase / PascalCase -> camel Case; keep acronyms together (parseHTTPResponse)
    word = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", word)
    word = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", word)
    return word


def _codeish(m: re.Match) -> str:
    w = m.group(0)
    if re.fullmatch(r"v?\d+(\.\d+)*", w):  # versions and decimals: leave to the engine
        return w
    if "_" in w or re.search(r"[a-z][A-Z]", w) or re.search(r"\w[./\\]\w", w):
        return _split_identifier(w)
    return w


def speakable(text: str) -> str:
    t = _URL.sub("link", text)
    for rx, rep in _PHRASES:
        t = rx.sub(rep, t)
    for op, rep in _OPERATORS:
        t = t.replace(op, rep)
    t = _CODEISH.sub(_codeish, t)
    # Markdown-ish leftovers and symbols that engines read badly
    t = re.sub(r"[`*_~#>|]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t
