#!/bin/sh
set -e
# Fetch the Kokoro model on first run if the mounted models folder is empty.
python scripts/get_models.py
exec python -m readme_server "$@"
