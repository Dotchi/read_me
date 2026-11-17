import argparse
import os
from pathlib import Path

import uvicorn

from .app import app


def main() -> None:
    ap = argparse.ArgumentParser(prog="readme_server", description="Markdown read-aloud server")
    ap.add_argument("--host", default=os.environ.get("READ_ME_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("READ_ME_PORT", "8765")))
    ap.add_argument("--root", default=os.environ.get("READ_ME_ROOT", str(Path.home() / "Documents")),
                    help="folder shown in the file picker")
    args = ap.parse_args()
    app.state.root = str(Path(args.root).expanduser().resolve())
    print(f"read_me: http://127.0.0.1:{args.port}  (root: {app.state.root})", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
