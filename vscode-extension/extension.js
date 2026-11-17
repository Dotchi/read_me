// Read Me Aloud — thin VS Code client for the local read_me server.
// The reader UI runs in an iframe (served by the Python server) inside a webview panel.
// Messages: iframe -> webview -> extension ("reading" lines, links) and back ("open", "seekLine", "toggle").
"use strict";
const vscode = require("vscode");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let panel = null;
let panelDoc = null; // uri of the doc shown in the panel
let serverProc = null;
let out = null;
let decoration = null;

const cfg = () => vscode.workspace.getConfiguration("readMe");
const serverUrl = () => cfg().get("serverUrl").replace(/\/$/, "");

async function healthy() {
  try {
    const r = await fetch(serverUrl() + "/api/health", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

function projectDir(context) {
  const candidates = [cfg().get("projectPath"), path.join(fs.realpathSync(context.extensionPath), "..")];
  return candidates.find((d) => d && fs.existsSync(path.join(d, "readme_server", "app.py")));
}

async function ensureServer(context) {
  if (await healthy()) return true;
  if (!cfg().get("autoStartServer")) {
    vscode.window.showErrorMessage(`read_me server is not running at ${serverUrl()}.`);
    return false;
  }
  const dir = projectDir(context);
  if (!dir) {
    vscode.window.showErrorMessage("read_me project not found. Set 'readMe.projectPath' in settings.");
    return false;
  }
  let cmd, args;
  if (cfg().get("serverMode") === "docker") {
    cmd = "docker"; args = ["compose", "up", "-d"];
  } else {
    cmd = path.join(dir, ".venv", process.platform === "win32" ? "Scripts\\python.exe" : "bin/python");
    args = ["-m", "readme_server", "--port", new URL(serverUrl()).port || "8765"];
  }
  out.appendLine(`Starting: ${cmd} ${args.join(" ")}  (in ${dir})`);
  serverProc = cp.spawn(cmd, args, { cwd: dir, windowsHide: true });
  serverProc.on("error", (e) => { out.appendLine(String(e)); serverProc = null; });
  serverProc.stdout.on("data", (d) => out.append(d.toString()));
  serverProc.stderr.on("data", (d) => out.append(d.toString()));
  serverProc.on("exit", (code) => { out.appendLine(`server exited (${code})`); serverProc = null; });
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Starting read_me server…" },
    async () => {
      for (let i = 0; i < 40; i++) {
        if (await healthy()) return true;
        // `docker compose up -d` exits once the container starts; keep waiting for health
        if (!serverProc && cfg().get("serverMode") !== "docker") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      out.show(true);
      vscode.window.showErrorMessage("read_me server did not start. See the 'Read Me Aloud' output.");
      return false;
    }
  );
}

function themeName() {
  const k = vscode.window.activeColorTheme.kind;
  return k === vscode.ColorThemeKind.Light || k === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

function webviewHtml(src) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const origin = new URL(serverUrl()).origin;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100vh;overflow:hidden;display:block}</style>
</head><body>
<iframe id="f" src="${src}" allow="autoplay"></iframe>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const f = document.getElementById("f");
window.addEventListener("message", (e) => {
  if (e.source === f.contentWindow) vscode.postMessage(e.data);
  else f.contentWindow.postMessage(e.data, "${origin}");
});
</script></body></html>`;
}

function readerUrl(fsPath, line, play) {
  const q = new URLSearchParams({ path: fsPath, embed: "1", theme: themeName() });
  if (line != null) q.set("line", String(line));
  if (play) q.set("play", "1");
  return `${serverUrl()}/?${q}`;
}

function clearDecoration() {
  for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(decoration, []);
}

function onReaderMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "reading" && cfg().get("followInEditor") && m.line != null) {
    const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath.toLowerCase() === String(m.path).toLowerCase());
    if (!ed) return;
    const end = Math.max(m.line, (m.lineEnd ?? m.line + 1) - 1);
    const range = new vscode.Range(m.line, 0, end, ed.document.lineAt(Math.min(end, ed.document.lineCount - 1)).text.length);
    ed.setDecorations(decoration, [range]);
    ed.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  } else if (m.type === "openExternal" && /^https?:/i.test(m.url)) {
    vscode.env.openExternal(vscode.Uri.parse(m.url));
  }
}

async function openReader(context, uri, { line = null, play = false } = {}) {
  if (!uri) {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== "markdown") {
      vscode.window.showInformationMessage("Open a Markdown file first.");
      return;
    }
    uri = ed.document.uri;
  }
  if (uri.scheme !== "file") {
    vscode.window.showWarningMessage("Read Me Aloud can only read files saved on disk.");
    return;
  }
  // unsaved edits: save so the reader sees the same text
  const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (openDoc && openDoc.isDirty) await openDoc.save();

  if (!(await ensureServer(context))) return;

  if (panel && panelDoc && panelDoc.toString() === uri.toString()) {
    panel.reveal(undefined, true);
    if (line != null) panel.webview.postMessage({ type: "seekLine", line, play });
    return;
  }
  if (panel) {
    panelDoc = uri;
    panel.title = "🔊 " + path.basename(uri.fsPath);
    panel.webview.postMessage({ type: "open", path: uri.fsPath, line, play });
    panel.reveal(undefined, true);
    return;
  }
  panelDoc = uri;
  panel = vscode.window.createWebviewPanel(
    "readMeAloud", "🔊 " + path.basename(uri.fsPath),
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = webviewHtml(readerUrl(uri.fsPath, line, play));
  panel.webview.onDidReceiveMessage(onReaderMessage);
  vscode.commands.executeCommand("setContext", "readMe.panelOpen", true);
  panel.onDidDispose(() => {
    panel = null; panelDoc = null; clearDecoration();
    vscode.commands.executeCommand("setContext", "readMe.panelOpen", false);
  });
}

function activate(context) {
  out = vscode.window.createOutputChannel("Read Me Aloud");
  decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
    isWholeLine: true,
    overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });

  context.subscriptions.push(
    out, decoration,
    vscode.commands.registerCommand("readMe.open", (uri) => openReader(context, uri instanceof vscode.Uri ? uri : undefined)),
    vscode.commands.registerCommand("readMe.readFromCursor", () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed) return;
      return openReader(context, ed.document.uri, { line: ed.selection.active.line, play: true });
    }),
    vscode.commands.registerCommand("readMe.togglePlay", () => panel && panel.webview.postMessage({ type: "toggle" })),
    vscode.commands.registerCommand("readMe.stop", () => panel && panel.webview.postMessage({ type: "stop" })),
    vscode.window.onDidChangeActiveColorTheme(() => panel && panel.webview.postMessage({ type: "theme", theme: themeName() })),
  );
}

function deactivate() {
  // a local Python server dies with VS Code; the Docker container keeps running
  if (serverProc && cfg().get("serverMode") !== "docker") serverProc.kill();
}

module.exports = { activate, deactivate };
