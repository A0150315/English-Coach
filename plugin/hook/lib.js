// hook/lib.js — shared helpers for the English-coach hooks (Stage 1).
// Local Node, no deps. Reads hook JSON from stdin, calls AIGW, posts to Cloudflare,
// emits a display-only desktop toast. Never adds anything to Claude's context.

import {
  readFileSync,
  appendFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

// --- plugin roots (portable across machines/install methods) ---
// CLAUDE_PLUGIN_ROOT = where this plugin lives (skills-dir, cache, or --plugin-dir).
// CLAUDE_PLUGIN_DATA = per-plugin persistent data dir (~/.claude/plugins/data/english-coach/),
//   survives updates, machine-independent. Secrets live here, NOT in the plugin source.
const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT || join(import.meta.dirname, "..");
const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA || join(PLUGIN_ROOT);

// --- secrets resolution order (first existing wins):
//   1. <PLUGIN_DATA>/.env        — persistent, machine-local real secrets (preferred)
//   2. <PLUGIN_ROOT>/.env        — real .env shipped in cache, or plugin-dir dev
//   3. <repo-root>/.env          — dev only: when running from <repo>/plugin/hook/, the
//                                   repo .env lives two levels up. (Plugin install never hits this.)
//   4. <PLUGIN_DATA>/.env seeded from <PLUGIN_ROOT>/.env.example — first-run template
// System env always wins over any file value.
function loadEnv() {
  const dataEnv = join(PLUGIN_DATA, ".env");
  const rootEnv = join(PLUGIN_ROOT, ".env");
  const repoEnv = join(import.meta.dirname, "..", "..", ".env"); // dev: plugin/hook → repo root

  let envPath = null;
  if (existsSync(dataEnv)) envPath = dataEnv;
  else if (existsSync(rootEnv)) envPath = rootEnv;
  else if (existsSync(repoEnv)) envPath = repoEnv;
  else {
    // No real .env anywhere → first run: seed a template into PLUGIN_DATA for the user to edit.
    // (Only seed when PLUGIN_DATA is a real separate dir — never write into the plugin source.)
    const template = join(PLUGIN_ROOT, ".env.example");
    if (PLUGIN_DATA !== PLUGIN_ROOT && existsSync(template)) {
      try {
        mkdirSync(PLUGIN_DATA, { recursive: true });
        copyFileSync(template, dataEnv);
        envPath = dataEnv;
      } catch {
        // PLUGIN_DATA not writable; fall through to no-file
      }
    }
  }
  if (!envPath) return; // no .env anywhere; fall back to system env

  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();

// --- logger: append one line per event to PLUGIN_DATA/hook.log. Best-effort, never throws. ---
const LOG_PATH = join(PLUGIN_DATA, "hook.log");
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

// Surface a placeholder-secrets situation loudly, instead of failing with a cryptic
// "empty JSON after retry" (which is really an AIGW 401 from the placeholder token).
// Fires once per process; the hook still runs and exits 0.
if (
  (process.env.COACH_AIGW_TOKEN || "").includes("put-your") ||
  (process.env.COACH_API_KEY || "").includes("change-me")
) {
  log(
    "config",
    `⚠ placeholder secrets detected — edit ${join(PLUGIN_DATA, ".env")} (or ${join(PLUGIN_ROOT, ".env")}) with your real COACH_AIGW_TOKEN + COACH_API_KEY`,
  );
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
  "Then list ONLY ENGLISH words a Chinese intermediate learner (CEFR B1) would need to look up — " +
  "genuinely unfamiliar vocabulary. The `word` field MUST be an English word or phrase (never " +
  "Chinese); `meaning_zh` is its Chinese gloss. EXCLUDE: basic words (update, display, function, " +
  "change) and programming terms the user uses daily (refactor, deadlock, deploy, module, hook, " +
  "function, variable, log, token, config). Each word: Chinese gloss + example sentence. " +
  "Reply as JSON only: " +
  '{"en": "<...>", "words": [{"word": "<English>", "meaning_zh": "<中文>", "example": "..."}]}. ' +
  "If there are no such words, return an empty words array.";

// Two modes share one JSON shape { en, words[] } but produce `en` differently:
// - "translate": user's Chinese → natural conversational English (coworker-chat style)
// - "summarize": assistant's (English) reply → one SIMPLE English summary sentence
// `en` lands in the messages.text_en column either way.
const PROMPTS = {
  translate:
    "You are an English coach. The user is messaging a COWORKER in a dev team chat " +
    "(Slack/Teams style), NOT writing documentation. Rewrite their Chinese into natural, " +
    "casual spoken English — how a native dev would actually say it in chat: contractions " +
    "(I'll, that's, gonna, kinda), conversational tone, short. NOT a formal/literal " +
    "translation, NOT a doc sentence. Preserve the meaning but make it sound human. " +
    EXTRACT_RULE.replace('"<...>"', '"<one casual English line>"') +
    " Extract words from YOUR English line.",
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
        if (parsed && Array.isArray(parsed.words)) {
          // Hard filter: drop any candidate whose `word` contains CJK characters.
          // Catches the case where the model swaps English word <-> Chinese gloss
          // (the prompt asks for English words, but thinking-off mode sometimes ignores that).
          parsed.words = parsed.words.filter(
            (w) => w.word && !/[一-鿿]/.test(w.word),
          );
          return parsed;
        }
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
