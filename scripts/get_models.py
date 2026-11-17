"""Download the Kokoro v1.0 ONNX model + voices (~340 MB) into ./models."""
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ["kokoro-v1.0.onnx", "voices-v1.0.bin"]
DEST = Path(__file__).resolve().parent.parent / "models"


def progress(name):
    def hook(blocks, bsize, total):
        if total > 0:
            pct = min(100, blocks * bsize * 100 // total)
            sys.stdout.write(f"\r  {name}: {pct}% of {total // 1_000_000} MB")
            sys.stdout.flush()
    return hook


def main():
    DEST.mkdir(exist_ok=True)
    for name in FILES:
        target = DEST / name
        if target.exists() and target.stat().st_size > 0:
            print(f"  {name}: already present")
            continue
        tmp = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(BASE + name, tmp, progress(name))
        tmp.replace(target)
        print()
    print("Models ready in", DEST)


if __name__ == "__main__":
    main()
