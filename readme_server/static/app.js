// read_me — follow-along Markdown reader.
// The page is split into "items" (sentences, headings, code/table announcements).
// Each item has a DOM Range for highlighting and the text that gets spoken.
"use strict";

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const EMBED = params.has("embed");

const store = {
  get(k, d) { try { const v = localStorage.getItem("readme." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("readme." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const settings = Object.assign(
  { speed: 1.2, voice: "af_heart", readCode: false, readTables: true, follow: true },
  store.get("settings", {})
);

const state = {
  path: null, mtime: 0, items: [], idx: -1, loadedIdx: -1,
  playing: false, token: 0, cache: new Map(), userScrollUntil: 0, blockEl: null,
};
const audio = new Audio();
audio.preservesPitch = true;
const hl = window.Highlight && CSS.highlights ? new Highlight() : null;
if (hl) CSS.highlights.set("reading", hl);

// ---------------------------------------------------------------- helpers
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* not json */ }
    throw new Error(msg);
  }
  return r;
};

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function post(msg) { if (EMBED && window.parent !== window) window.parent.postMessage(msg, "*"); }

const LANGS = {
  py: "Python", python: "Python", js: "JavaScript", javascript: "JavaScript", ts: "TypeScript",
  typescript: "TypeScript", tsx: "TSX", jsx: "JSX", sh: "shell", bash: "shell", shell: "shell", zsh: "shell",
  ps1: "PowerShell", powershell: "PowerShell", pwsh: "PowerShell", bat: "batch", cmd: "batch",
  json: "JSON", yaml: "YAML", yml: "YAML", toml: "TOML", sql: "SQL", html: "HTML", css: "CSS",
  md: "Markdown", markdown: "Markdown", php: "PHP", go: "Go", rs: "Rust", rust: "Rust", java: "Java",
  cs: "C sharp", csharp: "C sharp", cpp: "C plus plus", c: "C", rb: "Ruby", ruby: "Ruby", xml: "XML",
  dockerfile: "Dockerfile", diff: "diff", text: "text", txt: "text", ini: "INI", env: "env",
};

// ---------------------------------------------------------------- building items
const UNIT = new Set(["PRE", "TABLE"]);
const TEXT_BLOCK = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "LI", "DT", "DD", "SUMMARY"]);
const STOP = new Set(["P", "UL", "OL", "PRE", "TABLE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "DL", "DT", "DD", "DIV", "DETAILS", "HR", "SCRIPT", "STYLE", "FIGURE"]);
const segmenter = Intl.Segmenter ? new Intl.Segmenter("en", { granularity: "sentence" }) : null;

/** Text of an element (stopping at nested blocks) plus a way to map offsets back to DOM Ranges. */
function textMap(el) {
  const segs = []; let text = "";
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(n) {
      if (n.nodeType === 1) return n !== el && STOP.has(n.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  // Hard-wrapped Markdown has newlines mid-sentence; the segmenter treats them as breaks.
  // Replace with spaces (same length, so offsets still map onto the DOM).
  for (let n = tw.nextNode(); n; n = tw.nextNode()) { segs.push({ node: n, start: text.length }); text += n.data.replace(/[\r\n]/g, " "); }
  const at = (off, isEnd) => {
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (off > s.start || (off === s.start && !isEnd) || i === 0) return [s.node, Math.min(off - s.start, s.node.length)];
    }
  };
  const range = (a, b) => {
    const r = document.createRange();
    r.setStart(...at(a, false)); r.setEnd(...at(b, true));
    return r;
  };
  return { text, range, empty: segs.length === 0 };
}

function sentences(text) {
  if (segmenter) return [...segmenter.segment(text)].map((s) => [s.index, s.index + s.segment.length]);
  const out = []; const rx = /[^.!?]+(?:[.!?]+(?=\s|$)|$)/g; let m;
  while ((m = rx.exec(text))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function lineOf(el) {
  const c = el.closest("[data-line]") || el.querySelector("[data-line]");
  return c ? [Number(c.dataset.line), Number(c.dataset.lineEnd)] : [null, null];
}

function spokenFix(t) {
  return t.replace(/^\s*\[!(\w+)\]\s*/, (_, w) => w[0] + w.slice(1).toLowerCase() + ". ").replace(/\s+/g, " ").trim();
}

function buildItems(root) {
  const items = [];
  const add = (it) => {
    const [line, lineEnd] = lineOf(it.blockEl);
    items.push(Object.assign({ line, lineEnd }, it));
  };

  const textBlock = (el) => {
    const m = textMap(el);
    const isHeading = /^H\d$/.test(el.tagName);
    let prefix = "";
    const box = el.tagName === "LI" && el.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox]");
    if (box) prefix = box.checked ? "Done: " : "To do: ";
    if (!/[\p{L}\p{N}]/u.test(m.text)) {
      const img = el.querySelector("img[alt]");
      if (img && img.alt.trim() && el.querySelectorAll("img").length === 1) {
        const r = document.createRange(); r.selectNode(img);
        add({ kind: "image", text: "Image: " + img.alt, range: r, blockEl: el });
      }
      return;
    }
    const spans = isHeading ? [[0, m.text.length]] : sentences(m.text);
    let first = true;
    for (let [a, b] of spans) {
      while (a < b && /\s/.test(m.text[a])) a++;
      while (b > a && /\s/.test(m.text[b - 1])) b--;
      const raw = m.text.slice(a, b);
      if (!/[\p{L}\p{N}]/u.test(raw)) continue;
      let spoken = spokenFix(raw);
      if (first && prefix) spoken = prefix + spoken;
      if (isHeading && !/[.!?:]$/.test(spoken)) spoken += ".";
      add({ kind: isHeading ? "heading" : "text", level: isHeading ? +el.tagName[1] : 0, text: spoken, range: m.range(a, b), blockEl: el });
      first = false;
    }
  };

  const unit = (el) => {
    if (el.tagName === "PRE") {
      const code = el.querySelector("code") || el;
      const lang = ((code.className.match(/language-([\w+#-]+)/) || [])[1] || "").toLowerCase();
      const name = LANGS[lang] || lang;
      const body = code.textContent.replace(/\n$/, "");
      const lines = body.split("\n");
      const n = lines.length;
      const whole = document.createRange(); whole.selectNodeContents(el);
      add({ kind: "code", text: `${name ? name + " " : ""}code block, ${n} ${n === 1 ? "line" : "lines"}.`, range: whole, blockEl: el, noTextHl: true });
      if (settings.readCode) {
        const m = textMap(code); let off = 0;
        for (const ln of lines) {
          if (ln.trim()) add({ kind: "codeline", text: ln.trim(), range: m.range(off, off + ln.length), blockEl: el });
          off += ln.length + 1;
        }
      }
      return;
    }
    // TABLE
    const heads = [...el.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    const rows = [...el.querySelectorAll("tbody tr")];
    const whole = document.createRange(); whole.selectNodeContents(el);
    const cols = heads.length || (rows[0] ? rows[0].children.length : 0);
    add({
      kind: "table", range: whole, blockEl: el, noTextHl: true,
      text: `Table, ${cols} columns${heads.length ? ": " + heads.join(", ") : ""}. ${rows.length} ${rows.length === 1 ? "row" : "rows"}.`,
    });
    if (settings.readTables) {
      rows.forEach((tr) => {
        const cells = [...tr.children].map((td, i) => {
          const v = td.textContent.trim();
          return v ? (heads[i] ? `${heads[i]}: ${v}` : v) : "";
        }).filter(Boolean);
        if (!cells.length) return;
        const r = document.createRange(); r.selectNodeContents(tr);
        add({ kind: "row", text: cells.join(". ") + ".", range: r, blockEl: tr, rowOf: el, noTextHl: true });
      });
    }
  };

  const walk = (el) => {
    for (const c of el.children) {
      if (UNIT.has(c.tagName)) unit(c);
      else if (TEXT_BLOCK.has(c.tagName)) { textBlock(c); walk(c); }
      else walk(c);
    }
  };
  walk(root);
  return items;
}

/** Visual touches done once after render: GitHub-style callouts, links. */
function decorate(root) {
  root.querySelectorAll("blockquote > p:first-child").forEach((p) => {
    const tn = p.firstChild;
    if (!tn || tn.nodeType !== 3) return;
    const m = tn.data.match(/^\s*\[!(\w+)\]\s*/);
    if (!m) return;
    p.parentElement.classList.add("callout", "callout-" + m[1].toLowerCase());
    // Show "[!NOTE]" as a label "Note"; the hidden ". " makes it its own spoken sentence.
    const label = document.createElement("span");
    label.className = "callout-label";
    const w = m[1].toLowerCase();
    label.textContent = w[0].toUpperCase() + w.slice(1);
    const sep = document.createElement("span");
    sep.className = "sr"; sep.textContent = ". ";
    label.appendChild(sep);
    tn.data = tn.data.slice(m[0].length);
    p.insertBefore(label, tn);
  });
  root.querySelectorAll("a[href^='http']").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; });
}

// ---------------------------------------------------------------- highlight & scroll
function show(i, { scroll = true } = {}) {
  const it = state.items[i];
  if (state.blockEl) state.blockEl.classList.remove("reading-block");
  if (hl) hl.clear();
  if (!it) { state.blockEl = null; updateStatus(); return; }
  const block = it.kind === "codeline" ? it.blockEl : it.blockEl;
  block.classList.add("reading-block"); state.blockEl = block;
  if (hl && !it.noTextHl) hl.add(it.range);
  if (scroll && settings.follow && Date.now() > state.userScrollUntil) {
    const rect = (it.noTextHl ? block : it.range).getBoundingClientRect();
    const top = 70, bottom = innerHeight * 0.7;
    if (rect.top < top || rect.bottom > bottom) {
      scrollTo({ top: scrollY + rect.top - innerHeight * 0.3, behavior: "smooth" });
    }
  }
  $("#toc").querySelectorAll("li").forEach((li) => li.classList.toggle("active", +li.dataset.idx === currentHeading(i)));
  updateStatus();
  post({ type: "reading", path: state.path, line: it.line, lineEnd: it.lineEnd });
}

function currentHeading(i) {
  for (let k = i; k >= 0; k--) if (state.items[k].kind === "heading") return k;
  return -1;
}

function updateStatus() {
  document.body.classList.toggle("playing", state.playing);
  $("#btn-play").setAttribute("aria-label", state.playing ? "Pause" : "Play");
  const n = state.items.length;
  $("#status").textContent = (n ? `${state.idx >= 0 ? state.idx + 1 : 0} / ${n}` : "") +
    (state.loadingNote ? ` · ${state.loadingNote}` : "");
}

// ---------------------------------------------------------------- audio
function audioFor(i) {
  const it = state.items[i];
  if (!it) return null;
  const key = settings.voice + "|" + it.text;
  if (!state.cache.has(key)) {
    const p = api("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: it.text, voice: settings.voice }),
    }).then(async (r) => URL.createObjectURL(await r.blob()));
    p.catch(() => state.cache.delete(key));
    state.cache.set(key, p);
  }
  return state.cache.get(key);
}

// CPU synthesis is ~real time and the server speaks one request at a time, so walk ahead
// sequentially (never more than one request queued behind the current sentence).
async function prefetchAhead(i, tok) {
  try { await audioFor(i); } catch { return; }
  for (let k = 1; k <= 8; k++) {
    if (tok !== state.token && !state.playing) return;
    if (state.idx > i + k) continue;          // already played past it
    if (i + k > state.idx + 8) return;        // far enough ahead; the next playFrom continues
    const p = audioFor(i + k);
    if (!p) return;
    try { await p; } catch { return; }
  }
}

async function playFrom(i) {
  if (!state.items.length) return;
  i = Math.max(0, Math.min(i, state.items.length - 1));
  const tok = ++state.token;
  state.idx = i; state.playing = true;
  audio.pause();
  show(i);
  saveProgress();
  let url;
  const current = audioFor(i);
  prefetchAhead(i, tok);
  try { url = await current; }
  catch (e) { if (tok === state.token) { stop(); toast("Speech failed: " + e.message, 6000); } return; }
  if (tok !== state.token) return;
  audio.src = url;
  audio.defaultPlaybackRate = settings.speed; audio.playbackRate = settings.speed;
  state.loadedIdx = i;
  try { await audio.play(); }
  catch (e) {
    if (tok !== state.token) return;
    state.playing = false; updateStatus();
    if (e.name === "NotAllowedError") toast("Click ▶ to start — autoplay was blocked.");
  }
}

audio.addEventListener("ended", () => {
  if (!state.playing) return;
  const it = state.items[state.idx], nx = state.items[state.idx + 1];
  if (!nx) {
    if (state.loadingNote && state.more) { // more PDF pages on the way: carry on when they land
      const tok = state.token;
      const waitMore = () => {
        if (tok !== state.token || !state.playing) return;
        if (state.items[state.idx + 1]) playFrom(state.idx + 1);
        else if (state.loadingNote) setTimeout(waitMore, 500);
        else { state.playing = false; updateStatus(); toast("End of document"); }
      };
      return waitMore();
    }
    state.playing = false; updateStatus(); saveProgress(); toast("End of document"); return;
  }
  let gap = 0;
  if (it.kind === "heading" || nx.kind === "heading") gap = 380;
  else if (nx.blockEl !== it.blockEl) gap = 160;
  const tok = state.token;
  setTimeout(() => { if (tok === state.token && state.playing) playFrom(state.idx + 1); }, gap / settings.speed);
});

function pause() { state.playing = false; state.token++; audio.pause(); updateStatus(); saveProgress(); }
function stop() { pause(); }
function resume() {
  if (state.idx < 0) return playFrom(firstVisibleItem());
  if (state.loadedIdx === state.idx && audio.src && !audio.ended && audio.currentTime > 0) {
    state.playing = true; state.token++;
    audio.playbackRate = settings.speed;
    audio.play().catch(() => playFrom(state.idx));
    updateStatus();
  } else playFrom(state.idx);
}
function toggle() { state.playing ? pause() : resume(); }

function firstVisibleItem() {
  const i = state.items.findIndex((it) => it.range.getBoundingClientRect().bottom > 70);
  return i < 0 ? 0 : i;
}

function seek(i) {
  i = Math.max(0, Math.min(i, state.items.length - 1));
  if (state.playing) playFrom(i);
  else { state.idx = i; state.loadedIdx = -1; show(i); saveProgress(); }
}
function step(d) { seek((state.idx < 0 ? firstVisibleItem() : state.idx) + d); }
function stepSection(d) {
  const from = state.idx < 0 ? firstVisibleItem() : state.idx;
  if (d < 0) {
    const cur = currentHeading(from);
    // if we're more than a heading in, go to the start of this section first
    const target = cur >= 0 && from > cur ? cur : currentHeading(cur - 1);
    return seek(Math.max(0, target));
  }
  const nx = state.items.findIndex((it, k) => k > from && it.kind === "heading");
  if (nx >= 0) seek(nx);
}

function indexForLine(line) {
  let i = state.items.findIndex((it) => it.line != null && it.line <= line && line < it.lineEnd);
  if (i < 0) i = state.items.findIndex((it) => it.line != null && it.line >= line);
  return i < 0 ? state.items.length - 1 : i;
}

// ---------------------------------------------------------------- progress
let progressTimer;
function saveProgress() {
  clearTimeout(progressTimer);
  const it = state.items[state.idx];
  if (!state.path || !it) return;
  const body = JSON.stringify({ path: state.path, index: state.idx, line: it.line });
  progressTimer = setTimeout(() => fetch("/api/progress", { method: "PUT", headers: { "Content-Type": "application/json" }, body }).catch(() => {}), 800);
}

async function offerResume() {
  const btn = $("#btn-resume"); btn.hidden = true;
  try {
    const p = await (await api("/api/progress?path=" + encodeURIComponent(state.path))).json();
    if (p.index == null || p.index < 2) return;
    let i = p.index;
    if (!state.items[i] || (p.line != null && state.items[i].line !== p.line)) i = indexForLine(p.line ?? 0);
    const it = state.items[i]; if (!it) return;
    btn.textContent = "Resume: " + it.text.slice(0, 40) + (it.text.length > 40 ? "…" : "");
    btn.hidden = false;
    btn.onclick = () => { btn.hidden = true; playFrom(i); };
  } catch { /* no progress */ }
}

// ---------------------------------------------------------------- documents
function revokeCache() {
  for (const p of state.cache.values()) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  state.cache.clear();
}

async function loadDoc(path, { line = null, play = false, keep = false } = {}) {
  let d;
  try { d = await (await api("/api/doc?path=" + encodeURIComponent(path))).json(); }
  catch (e) { toast(e.message, 6000); return; }
  const prev = keep ? state.items[state.idx] : null;
  const prevOrdinal = prev ? state.items.filter((it, k) => k < state.idx && it.blockEl === prev.blockEl).length : 0;
  if (!keep) { pause(); revokeCache(); state.idx = -1; }
  state.path = d.path; state.mtime = d.mtime;
  document.title = d.title + " — read_me";
  const doc = $("#doc");
  doc.innerHTML = d.html;
  decorate(doc);
  state.items = buildItems(doc);
  buildToc();
  markActiveFile();
  state.docGen = (state.docGen || 0) + 1;
  state.more = d.next_start != null ? loadMore(d.path, d.next_start, d.total_pages, state.docGen) : null;
  if (!EMBED) history.replaceState(null, "", "?path=" + encodeURIComponent(d.path));

  if (keep && prev) {
    // stay on the same sentence after an edit
    let i = state.items.findIndex((it) => it.line === prev.line && it.text === prev.text);
    if (i < 0) i = Math.min(indexForLine(prev.line ?? 0) + prevOrdinal, state.items.length - 1);
    state.idx = i; show(i, { scroll: false });
    return;
  }
  if (line != null) {
    const i = indexForLine(line);
    if (play) playFrom(i); else { state.idx = i; show(i); }
  } else {
    scrollTo(0, 0); updateStatus(); offerResume();
  }
}

/** PDFs arrive in page batches: append each batch while the reader keeps going. */
async function loadMore(path, start, total, gen) {
  while (start != null && gen === state.docGen) {
    state.loadingNote = `loading pages ${start + 1}+ of ${total}`;
    updateStatus();
    let d;
    try { d = await (await api(`/api/doc?path=${encodeURIComponent(path)}&start=${start}`)).json(); }
    catch (e) { toast(e.message, 6000); break; }
    if (gen !== state.docGen) return;
    const tmp = document.createElement("div");
    tmp.innerHTML = d.html;
    decorate(tmp);
    $("#doc").append(...tmp.childNodes);
    // appended at the end, so existing indexes stay valid
    state.items = buildItems($("#doc"));
    buildToc();
    if (state.idx >= 0) show(state.idx, { scroll: false });
    start = d.next_start;
  }
  if (gen === state.docGen) { state.loadingNote = ""; updateStatus(); }
}

function buildToc() {
  const ul = $("#toc"); ul.innerHTML = "";
  state.items.forEach((it, i) => {
    if (it.kind !== "heading" || it.level > 3) return;
    const li = document.createElement("li");
    li.className = "l" + it.level; li.dataset.idx = i;
    li.textContent = it.blockEl.textContent.trim();
    li.title = li.textContent;
    li.onclick = () => seek(i);
    ul.appendChild(li);
  });
}

// ---------------------------------------------------------------- files
let allFiles = [], filesRoot = "";
async function loadFiles(root) {
  try {
    const d = await (await api("/api/files" + (root ? "?root=" + encodeURIComponent(root) : ""))).json();
    allFiles = d.files; filesRoot = d.root; $("#root").value = d.root;
    renderFiles();
  } catch (e) { toast(e.message); }
}
function renderFiles() {
  const q = $("#filter").value.toLowerCase();
  const ul = $("#files"); ul.innerHTML = "";
  const base = filesRoot.replace(/[\\/]$/, "").length + 1;
  allFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 400).forEach((f) => {
    const rel = f.slice(base), parts = rel.split(/[\\/]/), name = parts.pop();
    const li = document.createElement("li");
    li.dataset.path = f; li.title = rel;
    li.innerHTML = "";
    li.append(name);
    if (parts.length) { const s = document.createElement("small"); s.textContent = "  " + parts.join("/"); li.append(s); }
    li.onclick = () => loadDoc(f);
    ul.appendChild(li);
  });
  markActiveFile();
}
function markActiveFile() {
  $("#files").querySelectorAll("li").forEach((li) => li.classList.toggle("active", li.dataset.path === state.path));
}

// ---------------------------------------------------------------- events
function bindUI() {
  $("#btn-play").onclick = toggle;
  $("#btn-prev").onclick = () => step(-1);
  $("#btn-next").onclick = () => step(1);
  $("#btn-prev-sec").onclick = () => stepSection(-1);
  $("#btn-next-sec").onclick = () => stepSection(1);
  $("#btn-side").onclick = () => {
    document.body.classList.toggle("side-hidden");
    store.set("sideHidden" + (EMBED ? "Embed" : ""), document.body.classList.contains("side-hidden"));
  };

  const sp = $("#speed"), spv = $("#speed-val");
  const setSpeed = (v) => {
    settings.speed = Math.round(Math.max(0.7, Math.min(2.5, v)) * 10) / 10;
    sp.value = settings.speed; spv.textContent = settings.speed.toFixed(1) + "×";
    audio.playbackRate = settings.speed; store.set("settings", settings);
  };
  sp.oninput = () => setSpeed(+sp.value);
  setSpeed(settings.speed);
  window.setSpeed = setSpeed;

  const opt = (id, key, rebuild) => {
    const el = $(id); el.checked = settings[key];
    el.onchange = () => {
      settings[key] = el.checked; store.set("settings", settings);
      if (rebuild && state.path) {
        const cur = state.items[state.idx]; const wasPlaying = state.playing; pause();
        state.items = buildItems($("#doc")); buildToc();
        if (cur) { const i = Math.max(0, state.items.findIndex((it) => it.blockEl === cur.blockEl || it.rowOf === cur.blockEl)); state.idx = i; show(i, { scroll: false }); if (wasPlaying) playFrom(i); }
      }
    };
  };
  opt("#opt-code", "readCode", true);
  opt("#opt-tables", "readTables", true);
  opt("#opt-follow", "follow", false);

  $("#voice").onchange = (e) => {
    settings.voice = e.target.value; store.set("settings", settings);
    revokeCache(); if (state.playing) playFrom(state.idx);
  };

  $("#root-form").onsubmit = (e) => { e.preventDefault(); loadFiles($("#root").value.trim()); };
  $("#filter").oninput = renderFiles;

  // click a sentence to read from there; local .md links open in the reader
  $("#doc").addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (a) {
      const href = a.getAttribute("href");
      if (/^https?:/i.test(href)) { if (EMBED) { e.preventDefault(); post({ type: "openExternal", url: a.href }); } return; }
      if (href.startsWith("#")) return;
      if (/\.(md|markdown|mdx|pdf|docx|txt)(#.*)?$/i.test(href)) {
        e.preventDefault();
        const dir = state.path.replace(/[\\/][^\\/]*$/, "");
        loadDoc(dir + "/" + decodeURIComponent(href.split("#")[0]));
      }
      return;
    }
    if (e.target.closest("input, summary, button")) return;
    if (!getSelection().isCollapsed) return; // user is selecting text
    let node, off;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(e.clientX, e.clientY); if (p) { node = p.offsetNode; off = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r) { node = r.startContainer; off = r.startOffset; }
    }
    let idx = -1;
    if (node) state.items.forEach((it, i) => { try { if (it.range.isPointInRange(node, off)) idx = i; } catch { /* detached */ } });
    if (idx < 0) idx = state.items.findIndex((it) => it.blockEl.contains(e.target));
    if (idx >= 0) playFrom(idx);
  });

  addEventListener("wheel", () => { state.userScrollUntil = Date.now() + 4000; }, { passive: true });
  addEventListener("touchmove", () => { state.userScrollUntil = Date.now() + 4000; }, { passive: true });

  addEventListener("keydown", (e) => {
    if (e.target.closest("input:not([type=range]):not([type=checkbox]), select, textarea")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === " ") { e.preventDefault(); toggle(); }
    else if (k === "ArrowRight") { e.preventDefault(); e.shiftKey ? stepSection(1) : step(1); }
    else if (k === "ArrowLeft") { e.preventDefault(); e.shiftKey ? stepSection(-1) : step(-1); }
    else if (k === "+" || k === "=") setSpeed(settings.speed + 0.1);
    else if (k === "-" || k === "_") setSpeed(settings.speed - 0.1);
    else if (k === "Escape") stop();
  });

  // messages from the VS Code extension
  addEventListener("message", (e) => {
    if (!EMBED || e.source !== window.parent) return;
    const m = e.data || {};
    if (m.type === "open") loadDoc(m.path, { line: m.line ?? null, play: !!m.play });
    else if (m.type === "seekLine") { const i = indexForLine(m.line); m.play ? playFrom(i) : seek(i); }
    else if (m.type === "toggle") toggle();
    else if (m.type === "stop") stop();
    else if (m.type === "theme") document.documentElement.dataset.theme = m.theme;
  });

  // live reload when the file changes on disk
  setInterval(async () => {
    if (!state.path || document.hidden && !state.playing) return;
    try {
      const { mtime } = await (await api("/api/mtime?path=" + encodeURIComponent(state.path))).json();
      if (mtime !== state.mtime) loadDoc(state.path, { keep: true });
    } catch { /* file moved */ }
  }, 2000);
}

async function loadVoices() {
  try {
    const d = await (await api("/api/voices")).json();
    const sel = $("#voice"); sel.innerHTML = "";
    const label = (v) => {
      const [p, name] = v.split("_");
      const acc = { a: "US", b: "UK" }[p[0]] || p[0].toUpperCase();
      const g = { f: "female", m: "male" }[p[1]] || "";
      return `${name ? name[0].toUpperCase() + name.slice(1) : v} (${acc} ${g})`;
    };
    d.voices.filter((v) => /^[ab][fm]_/.test(v)).forEach((v) => sel.add(new Option(label(v), v)));
    if (!d.voices.includes(settings.voice)) settings.voice = d.default;
    sel.value = settings.voice;
  } catch (e) {
    const b = $("#banner"); b.hidden = false;
    b.textContent = "Voice engine not ready: " + e.message;
  }
}

async function init() {
  if (EMBED) {
    document.body.classList.add("embed");
    if (store.get("sideHiddenEmbed", true)) document.body.classList.add("side-hidden");
    $("#files-panel").hidden = true;
  } else if (store.get("sideHidden", false)) document.body.classList.add("side-hidden");
  if (params.get("theme")) document.documentElement.dataset.theme = params.get("theme");
  bindUI();
  loadVoices();
  if (!EMBED) loadFiles();
  const p = params.get("path");
  if (p) await loadDoc(p, { line: params.has("line") ? +params.get("line") : null, play: params.has("play") });
  post({ type: "ready" });
}
init();
