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
/** Mark that a hook fired, even if it crashes before doing anything. */
export function started(event) {
  log(event, "STARTED");
}

const AIGW_URL = "https://aigw.nie.netease.com/v1/chat/completions";
const MODEL = "deepseek-v4-flash";

const SYSTEM_PROMPT =
  "You are an English coach. Translate the user's text verbatim into idiomatic English; " +
  "preserve all meaning, add or omit nothing. Then extract CEFR B2+ words from YOUR " +
  "translation; give each a Chinese gloss and the example sentence. Reply as JSON only: " +
  '{"en": "<one English sentence>", "words": [{"word": "...", "meaning_zh": "...", "example": "..."}]}. ' +
  "If there are no B2+ words, return an empty words array.";

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
 * Returns { en, words: [{word, meaning_zh, example}] }.
 * Retries once on empty/invalid content (DeepSeek occasionally returns empty).
 * Throws on persistent failure — caller should swallow it so the hook never blocks.
 */
export async function coach(text) {
  const body = {
    model: MODEL,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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
