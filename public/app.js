// public/app.js — viewer. Polls /api/recent every 3s when the tab is focused.
// API key stored in localStorage after a one-time entry.

const KEY = "english_coach_key";
let apiKey = localStorage.getItem(KEY) || "";
let timer = null;
let lastCount = -1;

const $messages = document.getElementById("messages");
const $words = document.getElementById("words");
const $status = document.getElementById("status");

document.getElementById("key").value = apiKey;
document.getElementById("save-key").addEventListener("click", () => {
  apiKey = document.getElementById("key").value.trim();
  localStorage.setItem(KEY, apiKey);
  $status.textContent = "saved";
  fetchRecent();
});

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
    render(messages);
    $status.textContent = `${messages.length} msgs · ${new Date().toLocaleTimeString()}`;
  } catch {
    $status.textContent = "offline";
  }
}

function render(messages) {
  // Messages (newest first).
  $messages.innerHTML = messages
    .map((m) => {
      const isUser = m.role === "user";
      const body = isUser
        ? `<div class="zh">${esc(m.text_zh)}</div>` +
          `<div class="en">${esc(m.text_en)}</div>`
        : `<div class="raw">${esc(m.text_raw).slice(0, 300)}${
            m.text_raw && m.text_raw.length > 300 ? "…" : ""
          }</div>`;
      const words = m.words
        .map((w) => `<span class="chip ${w.status}">${esc(w.word)}</span>`)
        .join("");
      return `<div class="msg ${m.role}">
        <div class="meta">${m.role} · ${m.created_at}</div>
        ${body}
        <div class="chips">${words}</div>
      </div>`;
    })
    .join("");

  // Word list — dedupe across messages, newest first.
  const seen = new Map();
  for (const m of messages) {
    for (const w of m.words) {
      if (!seen.has(w.word)) seen.set(w.word, w);
    }
  }
  $words.innerHTML = [...seen.values()]
    .map(
      (w) =>
        `<div class="word ${w.status}">
          <span class="w">${esc(w.word)}</span>
          <span class="g">${esc(w.meaning_zh)}</span>
        </div>`,
    )
    .join("");
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Poll every 3s when the tab is visible; pause when hidden.
function start() {
  if (timer) return;
  fetchRecent();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") fetchRecent();
  }, 3000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") fetchRecent();
});

start();
