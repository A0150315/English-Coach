// public/app.js - viewer. Polls APIs every 10s when tab is focused.

const KEY = "english_coach_key";
let apiKey = localStorage.getItem(KEY) || "";
let timer = null;
let lastMessages = null;
let lastWords = null;
let lastCorrections = null;

const $messages = document.getElementById("messages");
const $words = document.getElementById("words");
const $corrections = document.getElementById("corrections");
const $status = document.getElementById("status");
const $library = document.getElementById("prompt-library");

document.getElementById("key").value = apiKey;
document.getElementById("save-key").addEventListener("click", () => {
  apiKey = document.getElementById("key").value.trim();
  localStorage.setItem(KEY, apiKey);
  $status.textContent = "saved";
  refreshAll();
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => activateTab(tab.dataset.tab));
});

renderPromptLibrary();

async function refreshAll() {
  await Promise.all([fetchRecent(), fetchWords(), fetchCorrections()]);
}

async function fetchRecent() {
  if (!apiKey) {
    $status.textContent = "enter key";
    return;
  }
  try {
    const r = await fetch("/api/recent?limit=50", {
      headers: { "X-Coach-Key": apiKey },
    });
    if (!r.ok) {
      $status.textContent = "auth failed";
      return;
    }
    const { messages } = await r.json();
    const sig = JSON.stringify(messages);
    if (sig !== lastMessages) {
      lastMessages = sig;
      renderMessages(messages);
    }
    $status.textContent = `${messages.length} msgs - ${new Date().toLocaleTimeString()}`;
  } catch {
    $status.textContent = "offline";
  }
}

async function fetchWords() {
  if (!apiKey) return;
  try {
    const r = await fetch("/api/words", { headers: { "X-Coach-Key": apiKey } });
    if (!r.ok) return;
    const { words } = await r.json();
    const sig = JSON.stringify(words);
    if (sig !== lastWords) {
      lastWords = sig;
      renderWords(words);
    }
  } catch {
    // best-effort; next poll retries
  }
}

async function fetchCorrections() {
  if (!apiKey) return;
  try {
    const r = await fetch("/api/correction?limit=100", {
      headers: { "X-Coach-Key": apiKey },
    });
    if (!r.ok) return;
    const { corrections } = await r.json();
    const sig = JSON.stringify(corrections);
    if (sig !== lastCorrections) {
      lastCorrections = sig;
      renderCorrections(corrections);
    }
  } catch {
    // migration may not be applied yet; keep viewer usable
  }
}

function renderMessages(messages) {
  $messages.innerHTML = messages.map(renderMessage).join("");
}

function renderMessage(m) {
  const isUser = m.role === "user";
  const correction = m.correction || null;
  const digest = m.digest || null;
  const body = isUser
    ? renderUserMessage(m, correction)
    : renderAssistantMessage(m, digest);
  const words = (m.words || [])
    .map((w) => `<span class="chip ${esc(w.status)}">${esc(w.word)}</span>`)
    .join("");

  return `<div class="msg ${esc(m.role)}">
    <div class="meta">${esc(m.role)} - ${fmtLocal(m.created_at)}</div>
    ${body}
    <div class="chips">${words}</div>
  </div>`;
}

function renderUserMessage(m, correction) {
  const original = correction?.original ?? m.text_zh;
  const corrected = correction?.corrected ?? m.text_en;
  const pattern = correction?.pattern;
  return `<div class="zh">${esc(original)}</div>
    <div class="en">${esc(corrected)}</div>
    ${pattern ? `<div class="pattern">Rule: ${esc(pattern)}</div>` : ""}`;
}

function renderAssistantMessage(m, digest) {
  const summary = digest?.summary ?? m.text_en;
  const steps = (digest?.next_steps || [])
    .map((step) => `<li>${esc(step)}</li>`)
    .join("");
  const terms = (digest?.key_terms || [])
    .map((t) => `<span class="term">${esc(t.term)} - ${esc(t.meaning_zh)}</span>`)
    .join("");
  const raw = m.text_raw
    ? `<details class="raw"><summary>stored raw reply</summary>${esc(m.text_raw)}</details>`
    : "";

  return `<div class="en summary">${esc(summary)}</div>
    ${steps ? `<ul class="steps">${steps}</ul>` : ""}
    ${terms ? `<div class="terms">${terms}</div>` : ""}
    ${raw}`;
}

function renderCorrections(corrections) {
  $corrections.innerHTML = corrections.length
    ? corrections.map(renderCorrection).join("")
    : `<div class="empty">No corrections yet.</div>`;
}

function renderCorrection(c) {
  return `<div class="correction">
    <div class="meta">${fmtLocal(c.created_at)}${c.error_type ? ` - ${esc(c.error_type)}` : ""}</div>
    <div class="zh">${esc(c.original)}</div>
    <div class="en">${esc(c.corrected)}</div>
    ${c.pattern ? `<div class="pattern">Rule: ${esc(c.pattern)}</div>` : ""}
    ${c.explanation ? `<div class="explain">${esc(c.explanation)}</div>` : ""}
    <button class="copy" data-copy="${attr(c.corrected)}">Copy</button>
  </div>`;
}

function renderWords(words) {
  $words.innerHTML = words.map(renderWord).join("");
}

function renderWord(w) {
  const known = w.status === "known";
  const count = w.count || 1;
  return `<div class="word ${esc(w.status)}">
    <div class="word-head" data-id="${w.id}">
      <span class="w">${esc(w.word)}</span>
      <span class="g">${esc(w.meaning_zh)}</span>
      <span class="count" title="appeared ${count} time${count > 1 ? "s" : ""}">x${count}</span>
      <button class="mark ${known ? "done" : ""}" data-id="${w.id}" title="${
        known ? "already known" : "mark as known"
      }">${known ? "Known" : "Know"}</button>
      <button class="ignore" data-id="${w.id}" title="ignore word">Ignore</button>
    </div>
    <div class="word-detail" data-id="${w.id}" hidden></div>
  </div>`;
}

$corrections.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy");
  if (!btn) return;
  await navigator.clipboard.writeText(btn.dataset.copy || "");
  btn.textContent = "Copied";
  setTimeout(() => (btn.textContent = "Copy"), 1200);
});

$words.addEventListener("click", async (e) => {
  if (e.target.closest(".mark") || e.target.closest(".ignore")) return;
  const head = e.target.closest(".word-head");
  if (!head) return;
  await toggleWordDetail(head);
});

$words.addEventListener("click", async (e) => {
  const btn = e.target.closest(".mark,.ignore");
  if (!btn || btn.classList.contains("done")) return;
  e.stopPropagation();
  const status = btn.classList.contains("ignore") ? "ignored" : "known";
  await updateWordStatus(btn, status);
});

async function toggleWordDetail(head) {
  const detail = head.nextElementSibling;
  const id = head.dataset.id;
  if (!detail.hidden) {
    detail.hidden = true;
    return;
  }

  detail.hidden = false;
  detail.textContent = "loading...";
  try {
    const r = await fetch(`/api/word?id=${id}`, {
      headers: { "X-Coach-Key": apiKey },
    });
    if (!r.ok) {
      detail.textContent = "(failed to load)";
      return;
    }
    const { meanings } = await r.json();
    detail.innerHTML = meanings.length
      ? meanings.map(renderMeaning).join("")
      : "<em>(no usages)</em>";
  } catch {
    detail.textContent = "(offline)";
  }
}

function renderMeaning(m) {
  return `<div class="meaning"><span class="mg">${esc(m.meaning)}</span>${
    m.example ? `<span class="ex">- ${esc(m.example)}</span>` : ""
  }</div>`;
}

async function updateWordStatus(btn, status) {
  btn.disabled = true;
  try {
    const r = await fetch("/api/word", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Coach-Key": apiKey },
      body: JSON.stringify({ id: Number(btn.dataset.id), status }),
    });
    if (r.ok) fetchWords();
  } catch {
    // best-effort; next poll will re-sync
  }
  btn.disabled = false;
}

function renderPromptLibrary() {
  const templates = [
    "Does this implementation align with the design?",
    "How does Claude Code handle this?",
    "Can we tighten this type to HookConfigSource?",
    "Please verify this against the docs and source.",
    "What is the smallest safe change for this bug?",
  ];
  $library.innerHTML = templates
    .map((text) => `<button class="template" data-copy="${attr(text)}">${esc(text)}</button>`)
    .join("");
}

$library.addEventListener("click", async (e) => {
  const btn = e.target.closest(".template");
  if (!btn) return;
  await navigator.clipboard.writeText(btn.dataset.copy || "");
});

function activateTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === name);
  });
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function attr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

function fmtLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function start() {
  if (timer) return;
  refreshAll();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") refreshAll();
  }, 10000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});

start();
