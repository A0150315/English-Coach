// public/app.js — viewer. Polls /api/recent every 10s when the tab is focused.
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
  fetchWords();
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
    renderMessages(messages);
    $status.textContent = `${messages.length} msgs · ${new Date().toLocaleTimeString()}`;
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
    renderWords(words);
  } catch {
    // best-effort; next poll retries
  }
}

function renderMessages(messages) {
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
}

function renderWords(words) {
  // words already come from /api/words: all words, newest-first, with count.
  $words.innerHTML = words
    .map((w) => {
      const known = w.status === "known";
      const count = w.count || 1;
      return `<div class="word ${w.status}">
          <span class="w">${esc(w.word)}</span>
          <span class="g">${esc(w.meaning_zh)}</span>
          <span class="count" title="appeared ${count} time${count > 1 ? "s" : ""}">×${count}</span>
          <button class="mark ${known ? "done" : ""}" data-id="${w.id}" title="${
            known ? "already known" : "mark as known"
          }">${known ? "✓" : "✓?"}</button>
        </div>`;
    })
    .join("");
}

// Mark a word known (✓ button). PATCH /api/word, then re-fetch the word table.
$words.addEventListener("click", async (e) => {
  const btn = e.target.closest(".mark");
  if (!btn || btn.classList.contains("done")) return;
  btn.disabled = true;
  try {
    const r = await fetch("/api/word", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Coach-Key": apiKey },
      body: JSON.stringify({ id: Number(btn.dataset.id), status: "known" }),
    });
    if (r.ok) fetchWords();
  } catch {
    // best-effort; next poll will re-sync
  }
  btn.disabled = false;
});

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Poll every 10s when the tab is visible; pause when hidden.
function start() {
  if (timer) return;
  fetchRecent();
  fetchWords();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") {
      fetchRecent();
      fetchWords();
    }
  }, 10000);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    fetchRecent();
    fetchWords();
  }
});

start();
