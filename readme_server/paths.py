"""Translate between host paths (what VS Code / the browser use) and paths this process can open.

Running natively the two are the same. In Docker, set READ_ME_PATH_MAP, e.g.
    READ_ME_PATH_MAP="C:/laragon/www=/docs;C:/Users/me/Documents=/documents"
"""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath


def _norm(p: str) -> str:
    return p.replace("\\", "/").rstrip("/")


def _load() -> list[tuple[str, str]]:
    pairs = []
    for part in os.environ.get("READ_ME_PATH_MAP", "").split(";"):
        if "=" in part:
            host, local = part.rsplit("=", 1)
            pairs.append((_norm(host.strip()), _norm(local.strip())))
    # longest prefix first
    return sorted(pairs, key=lambda hp: -len(hp[0]))


MAP = _load()


def _under(path: str, prefix: str, ci: bool) -> str | None:
    a, b = (path.lower(), prefix.lower()) if ci else (path, prefix)
    if a == b or a.startswith(b + "/"):
        return path[len(prefix):]
    return None


def to_local(p: str) -> Path:
    """Host path -> path this process opens."""
    n = _norm(p)
    for host, local in MAP:
        rest = _under(n, host, ci=True)
        if rest is not None:
            return Path(str(PurePosixPath(local + rest)))
    return Path(p).expanduser()


def to_host(p: Path | str) -> str:
    """Path this process opened -> host path for the UI / editor."""
    n = _norm(str(p))
    for host, local in MAP:
        rest = _under(n, local, ci=False)
        if rest is not None:
            out = host + rest
            return out.replace("/", "\\") if len(host) > 1 and host[1] == ":" else out
    return str(p)
