// hook/lib.js — shared helpers for the English-coach hooks (Stage 1).
// Local Node, no deps. Reads hook JSON from stdin, calls AIGW, posts to Cloudflare,
// emits a display-only desktop toast. Never adds anything to Claude's context.

import { readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// --- secrets: load .env from the repo root (parent of hook/). System env wins. ---
function loadEnv() {
  const envPath = join(import.meta.dirname, "..", ".env");
  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return; // .env optional; fall back to system env
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

// --- logger: append one line per event to english-coach/hook.log. Best-effort, never throws. ---
const LOG_PATH = join(import.meta.dirname, "..", "hook.log");
function ts() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}
/** Append a line. Best-effort. */
export function log(tag, detail) {
  try {
    const line = `${ts()} | ${tag} | ${detail ?? ""}\n`;
    appendFileSync(LOG_PATH, line, "utf8");
  } catch {
    // logging must never break the hook
  }
}

// All config below is env-driven (read from .env or system env). Nothing is global-required.
const AIGW_URL =
  process.env.COACH_AIGW_URL ||
  "https://aigw.nie.netease.com/v1/chat/completions";
const MODEL = process.env.COACH_AIGW_MODEL || "deepseek-v4-flash";

// Shared extraction instruction. Positive framing ("words a B1 learner would look up") +
// an explicit EXCLUDE list — both needed because thinking-off deepseek-v4-flash ignores
// "skip X" negatives (it extracts the very words you tell it to skip).
const EXTRACT_RULE =
  "Then list ONLY words a Chinese intermediate learner (CEFR B1) would need to look up — " +
  "genuinely unfamiliar vocabulary. EXCLUDE: basic words (update, display, function, change) " +
  "and programming terms the user uses daily (refactor, deadlock, deploy, module, hook, " +
  "function, variable, log, token, config). Each word: Chinese gloss + example sentence. " +
  "Reply as JSON only: " +
  '{"en": "<...>", "words": [{"word": "...", "meaning_zh": "...", "example": "..."}]}. ' +
  "If there are no such words, return an empty words array.";

// Two modes share one JSON shape { en, words[] } but produce `en` differently:
// - "translate": user's Chinese → one idiomatic English sentence (faithful, verbatim)
// - "summarize": assistant's (English) reply → one SIMPLE English summary sentence
// `en` lands in the messages.text_en column either way.
const PROMPTS = {
  translate:
    "You are an English coach. Translate the user's text verbatim into idiomatic English; " +
    "preserve all meaning, add or omit nothing. " +
    EXTRACT_RULE.replace('"<...>"', '"<one English sentence>"') +
    " Extract words from YOUR translation.",
  summarize:
    "You are an English coach. Summarize the user's (English) text into ONE simple, plain " +
    "English sentence a B1 learner could read — capture the key point, drop detail. " +
    EXTRACT_RULE.replace('"<...>"', '"<one simple English summary sentence>"') +
    " Extract words from the ORIGINAL text; quote examples from the original.",
};

/** Read the hook JSON from stdin. */
export function readStdin() {
  return new Promise((resolve) => {
    let s = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (s += c));
    process.stdin.on("end", () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Call deepseek-v4-flash with thinking OFF + json_object. One combined call.
 * mode: "translate" (user msgs) | "summarize" (assistant msgs). Default "translate".
 * Returns { en, words: [{word, meaning_zh, example}] }.
 * Retries once on empty/invalid content (DeepSeek occasionally returns empty).
 * Throws on persistent failure — caller should swallow it so the hook never blocks.
 */
export async function coach(text, mode = "translate") {
  const system = PROMPTS[mode] || PROMPTS.translate;
  const body = {
    model: MODEL,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(AIGW_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.COACH_AIGW_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.words)) return parsed;
      } catch {
        // fall through to retry
      }
    }
  }
  throw new Error("coach: empty or invalid JSON after retry");
}

/** POST JSON to a Pages Function. Returns parsed JSON or null on failure. */
export async function postJSON(path, payload) {
  const base = (process.env.COACH_API_URL || "").replace(/\/$/, "");
  if (!base) return null;
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coach-Key": process.env.COACH_API_KEY || "",
      },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch {
    return null;
  }
}

/**
 * Build the hook JSON output carrying a desktop toast (OSC 9).
 * Display-only: suppressOutput keeps stdout out of Claude's context.
 */
export function emit(toast) {
  const esc = `\x1b]9;EN Coach;${toast}\x07`; // OSC 9 ; title ; body BEL
  process.stdout.write(
    JSON.stringify({ terminalSequence: esc, suppressOutput: true }),
  );
}

/** Truncate a string for a toast (Windows Terminal toast bodies are short). */
export function clip(s, n = 200) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
