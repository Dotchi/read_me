# read_me

A local, follow-along **read-aloud reader for Markdown, PDF, Word (.docx) and text files**. The current sentence is highlighted while a neural voice (Kokoro, running offline on your machine) reads it. Use it in the browser or inside VS Code.

> [!NOTE]
> Everything runs locally. No document text leaves your computer.

## What it does

- Reads the doc sentence by sentence, highlights the sentence and auto-scrolls.
- Click any sentence to start reading from there.
- Markdown-aware narration:
  - Headings get a pause.
  - Code blocks are announced, for example "Python code block, 12 lines", and skipped unless you turn on *Read code*.
  - Tables are announced with their columns, and each row is read as `Column: value`.
  - Link text is read, but not the URL.
  - Identifiers are spoken as words: `getUserName` becomes "get User Name" and `README.md` becomes "README dot md".
  - Task list items are read as "Done" or "To do".
- PDF and Word support:
  - PDFs are converted to structured text with headings, lists and tables. Running headers, footers and page numbers are removed, and hyphenated line breaks are joined again.
  - Big books open on their first 8 pages and load the rest while you listen.
  - Scanned PDFs, which have no text layer, are detected. OCR isn't supported yet.
- Speed from 0.7× to 2.5× without changing pitch, plus 20+ voices.
- Remembers where you stopped in each file and offers to resume.
- Reloads when the file changes on disk and keeps your place.

## Run it in Docker (recommended)

```powershell
cd C:\laragon\www\read_me
docker compose up -d
```

First copy `.env.example` to `.env`, then set the two folders the container may read: `READ_ME_DOCS` and `READ_ME_DOCS_2`.

Then open http://127.0.0.1:8765. The container can read any document under those folders. You keep using the normal Windows paths, and the server translates them to the container's mount. The model, the audio cache and your saved progress live in `./models`, `./cache` and `./data` on the host. If the model is missing, it's downloaded on first start. The container restarts itself unless you stop it with `docker compose down`.

## Run it without Docker: setup (once)

```powershell
cd C:\laragon\www\read_me
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\get_models.py
```

## Use it in the browser

```powershell
run.bat C:\laragon\www
```

Open http://127.0.0.1:8765 and pick a file from the sidebar.

## Use it in VS Code

Install the extension from `vscode-extension/`:

```powershell
cd vscode-extension
npx @vscode/vsce package --allow-missing-repository
code --install-extension read-me-aloud-0.1.0.vsix
```

| Action | How |
|---|---|
| Open the reader beside the file | Speaker icon in the editor title bar, or the command **Read Me: Open Reader** |
| Read from the cursor | `Ctrl+Alt+R`, or right-click → **Read Me: Read Aloud From Cursor** |
| Play or pause | `Ctrl+Alt+Space` |

For PDF and Word files, right-click the file in the Explorer and choose **Read Me: Open Reader**, or run **Read Me: Open PDF, Word or Text File…**.

The extension starts the server for you with `docker compose up -d`. To use the Python venv instead, set `readMe.serverMode` to `local`. **On a new machine, set `readMe.projectPath` to the folder where you cloned this repo.** As the doc is read, the source lines are highlighted in the editor.

## Keyboard shortcuts in the reader

| Key | Action |
|---|---|
| Space | Play or pause |
| ← and → | Previous or next sentence |
| Shift+← and Shift+→ | Previous or next section |
| + and − | Change speed |
| Esc | Stop |

## How it fits together

```text
VS Code extension ──► webview ──► iframe: http://127.0.0.1:8765  (UI: app.js)
                                        │
                     Python server ◄────┘  /api/doc  Markdown → HTML with source line numbers
                     (FastAPI)             /api/tts  text → speakable text → Kokoro → WAV (cached)
```

## Licences

The project code is MIT. PDF support uses [PyMuPDF](https://pymupdf.readthedocs.io/) and pymupdf4llm, which are **AGPL-3.0**. That's fine for personal and open-source use. If you ever ship this commercially, swap them for a permissively licensed PDF library or buy an Artifex licence.

## Roadmap

- Export a document to MP3 for listening away from the screen.
- Voice commands with Whisper, such as "skip", "repeat" or "read the code".
- Ask questions about the doc you're reading.
