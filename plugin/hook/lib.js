// hook/lib.js - shared helpers for English Coach hooks.
// Local Node, no deps. Reads hook JSON, calls AIGW, posts to Cloudflare,
// emits display-only desktop toast. Never adds anything to Claude context.

import {
  readFileSync,
  appendFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT =
  process.env.CLAUDE_PLUGIN_ROOT || join(import.meta.dirname, "..");
const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA || join(PLUGIN_ROOT);

function loadEnv() {
  const dataEnv = join(PLUGIN_DATA, ".env");
  const rootEnv = join(PLUGIN_ROOT, ".env");
  const repoEnv = join(import.meta.dirname, "..", "..", ".env");

  let envPath = null;
  if (existsSync(dataEnv)) envPath = dataEnv;
  else if (existsSync(rootEnv)) envPath = rootEnv;
  else if (existsSync(repoEnv)) envPath = repoEnv;
  else {
    const template = join(PLUGIN_ROOT, ".env.example");
    if (PLUGIN_DATA !== PLUGIN_ROOT && existsSync(template)) {
      try {
        mkdirSync(PLUGIN_DATA, { recursive: true });
        copyFileSync(template, dataEnv);
        envPath = dataEnv;
      } catch {
        // env seeding must never break hook startup
      }
    }
  }
  if (!envPath) return;

  let text = "";
  try {
    text = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    if (!process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnv();

const LOG_PATH = join(PLUGIN_DATA, "hook.log");

function ts() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export function log(tag, detail) {
  try {
    appendFileSync(LOG_PATH, `${ts()} | ${tag} | ${detail ?? ""}\n`, "utf8");
  } catch {
    // logging must never break hook behavior
  }
}

if (
  (process.env.COACH_AIGW_TOKEN || "").includes("put-your") ||
  (process.env.COACH_API_KEY || "").includes("change-me")
) {
  log(
    "config",
    `placeholder secrets detected; edit ${join(PLUGIN_DATA, ".env")} or ${join(PLUGIN_ROOT, ".env")}`,
  );
}

const AIGW_URL =
  process.env.COACH_AIGW_URL ||
  "https://aigw.nie.netease.com/v1/chat/completions";
const MODEL = process.env.COACH_AIGW_MODEL || "deepseek-v4-flash";

const EXTRACT_RULE =
  "Then list ONLY ENGLISH words a Chinese intermediate learner (CEFR B1) would need to look up. " +
  "The `word` field MUST be an English word or phrase; `meaning_zh` is its Chinese gloss. " +
  "EXCLUDE basic words and programming terms the user uses daily: update, display, function, " +
  "change, refactor, deadlock, deploy, module, hook, variable, log, token, config. " +
  "Each word needs a Chinese gloss and example sentence. If none, return an empty words array.";

const PROMPT_ACTION_RULE =
  'FIRST judge the message and set "action" to exactly "coach" or "skip". ' +
  'Use "coach" if it is Chinese, mixes Chinese and English, or is English that is not natural. ' +
  'Use "skip" only when it is already precise, natural engineering English or pure noise. ' +
  "Never skip text containing Chinese. Preserve technical identifiers, file names, API names, " +
  "CLI commands, env vars, and code symbols exactly.";

const PROMPT_OUTPUT_RULE =
  'Reply as JSON only (no prose, no markdown) with exactly this shape: ' +
  '{"action":"coach"|"skip","corrected":<string|null>,"explanation":<string|null>,' +
  '"pattern":<string|null>,"error_type":<string|null>,' +
  '"words":[{"word":"<English>","meaning_zh":"<Chinese>","example":"<sentence>"}]}. ' +
  "Always include words array.";

const DIGEST_OUTPUT_RULE =
  'Reply as JSON only (no prose, no markdown) with exactly this shape: ' +
  '{"action":"digest","summary":"<short English TLDR>","next_steps":["<English action>"],' +
  '"key_terms":[{"term":"<English>","meaning_zh":"<Chinese>","example":"<sentence>"}],' +
  '"words":[{"word":"<English>","meaning_zh":"<Chinese>","example":"<sentence>"}]}. ' +
  "Always include next_steps, key_terms, and words arrays. Except meaning_zh, all output " +
  "fields MUST be English.";

const PROMPTS = {
  ai_prompt:
    "You are an English coach for developers using AI coding agents. Polish rough prompts " +
    "into natural, precise engineering English. Do not make the prompt casual or slangy. " +
    "Do not use gonna, kinda, or filler. Keep intent exact. " +
    PROMPT_ACTION_RULE +
    ' When action is "coach", provide corrected, explanation, reusable pattern, and error_type. ' +
    EXTRACT_RULE +
    " Extract words from the corrected English line. " +
    PROMPT_OUTPUT_RULE,
  work_chat:
    "You are an English coach. The user is messaging a coworker in a dev team chat " +
    "(Slack/Teams style). Make it natural, polite, short, and human. Contractions are OK. " +
    PROMPT_ACTION_RULE +
    ' When action is "coach", provide corrected, explanation, reusable pattern, and error_type. ' +
    EXTRACT_RULE +
    " Extract words from the corrected English line. " +
    PROMPT_OUTPUT_RULE,
  digest:
    "You are an English coach. Turn the assistant reply into a short action digest for " +
    "a B1 English learner. Write the summary and next_steps in simple English only. " +
    "Capture key point, next actions, and key terms. " +
    "Do not include sensitive code or logs. " +
    "Never write Chinese in summary, next_steps, term, example, words.word, or words.example. " +
    "Only meaning_zh may contain Chinese. If the original text is Chinese, translate the digest " +
    "and examples into simple English. " +
    EXTRACT_RULE +
    " Extract words from the original text; write examples in simple English. " +
    DIGEST_OUTPUT_RULE,
};

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

export function hasCJK(text) {
  return /[\u3400-\u9fff]/u.test(text || "");
}

export async function coachPrompt(text, mode = "ai_prompt") {
  const safeMode = mode === "work_chat" ? "work_chat" : "ai_prompt";
  const result = await callModel(text, safeMode);
  if (!result) throw new Error("coach: empty or invalid JSON after retry");

  if (result.action === "skip" && hasCJK(text)) {
    const forced = await callModel(
      `${text}\n\n[NOTE: this message contains Chinese. Return action "coach" with the English rewrite in corrected.]`,
      safeMode,
    );
    if (forced?.corrected) return forced;
  }
  return result;
}

export async function digestResponse(text) {
  let result = await callModel(text, "digest");
  if (hasChineseDigest(result)) {
    result = await callModel(
      `${text}\n\n[NOTE: Retry. The digest was not English. Return summary, next_steps, term, example, words.word, and words.example in English only. Only meaning_zh may be Chinese.]`,
      "digest",
    );
  }
  if (!result) throw new Error("digest: empty or invalid JSON after retry");
  if (hasChineseDigest(result)) {
    throw new Error("digest: model returned non-English digest");
  }
  return result;
}

export async function coach(text, mode = "ai_prompt") {
  if (mode === "translate") return coachPrompt(text, "work_chat");
  if (mode === "summarize") {
    const digest = await digestResponse(text);
    return { action: "coach", en: digest.summary, words: digest.words };
  }
  return coachPrompt(text, mode);
}

async function callModel(text, mode = "ai_prompt") {
  const body = {
    model: MODEL,
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PROMPTS[mode] || PROMPTS.ai_prompt },
      { role: "user", content: text },
    ],
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let j;
    try {
      const r = await fetch(AIGW_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.COACH_AIGW_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      j = await r.json();
    } catch {
      continue;
    }
    const raw = j?.choices?.[0]?.message?.content;
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.words)) continue;
      parsed.words = filterEnglishWords(parsed.words);
      if (mode === "digest") return normalizeDigest(parsed);
      if ((parsed.action || parsed.judge) === "skip") return emptyPromptSkip();
      return normalizePromptCoach(parsed);
    } catch {
      // fall through to retry
    }
  }
  return null;
}

function filterEnglishWords(words) {
  return words.filter((w) => w?.word && !hasCJK(w.word));
}

function emptyPromptSkip() {
  return {
    action: "skip",
    corrected: null,
    explanation: null,
    pattern: null,
    error_type: null,
    words: [],
  };
}

function normalizePromptCoach(parsed) {
  return {
    action: "coach",
    corrected: parsed.corrected ?? parsed.en ?? null,
    explanation: parsed.explanation ?? null,
    pattern: parsed.pattern ?? null,
    error_type: parsed.error_type ?? null,
    words: parsed.words,
  };
}

function normalizeDigest(parsed) {
  const maxSteps = Number(process.env.COACH_DIGEST_MAX_NEXT_STEPS || 5);
  const nextSteps = Array.isArray(parsed.next_steps) ? parsed.next_steps : [];
  return {
    action: "digest",
    summary: parsed.summary ?? parsed.en ?? "",
    next_steps: nextSteps.slice(0, Number.isFinite(maxSteps) ? maxSteps : 5),
    key_terms: filterEnglishTerms(parsed.key_terms),
    words: parsed.words,
  };
}

function filterEnglishTerms(keyTerms) {
  if (!Array.isArray(keyTerms)) return [];
  return keyTerms.filter((term) => term?.term && !hasCJK(term.term));
}

function hasChineseDigest(result) {
  if (!result) return false;
  const fields = [
    result.summary,
    ...(Array.isArray(result.next_steps) ? result.next_steps : []),
    ...(Array.isArray(result.key_terms)
      ? result.key_terms.flatMap((term) => [term.term, term.example])
      : []),
  ];
  return fields.some((field) => hasCJK(field));
}

export function redactCodeBlocks(text) {
  let index = 0;
  return String(text || "").replace(/```[\s\S]*?```/g, () => {
    index += 1;
    return `[CODE_BLOCK_${index}]`;
  });
}

export function redactPaths(text) {
  return String(text || "")
    .replace(/[A-Za-z]:\\(?:[^\\\s:"<>|?*]+\\)*[^\\\s:"<>|?*]+/g, "[FILE_PATH]")
    .replace(/(^|[\s("'=])\/(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+/g, "$1[FILE_PATH]")
    .replace(/\b(?:src|lib|app|pages|functions|plugin|public)\/[\w./-]+\.[A-Za-z0-9]+\b/g, "[FILE_PATH]");
}

export function truncateText(text, maxChars) {
  const limit = Number(maxChars);
  const value = String(text || "");
  if (!Number.isFinite(limit) || limit <= 0) return "";
  return value.length > limit ? value.slice(0, limit) : value;
}

export function sanitizeAssistantText(text) {
  let value = String(text || "");
  if ((process.env.COACH_REDACT_CODE_BLOCKS ?? "true") !== "false") {
    value = redactCodeBlocks(value);
  }
  if ((process.env.COACH_REDACT_PATHS ?? "true") !== "false") {
    value = redactPaths(value);
  }
  return value;
}

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

export function emit(toast) {
  const esc = `\x1b]9;EN Coach;${toast}\x07`;
  process.stdout.write(
    JSON.stringify({ terminalSequence: esc, suppressOutput: true }),
  );
}

export function clip(s, n = 200) {
  const value = String(s || "");
  return value.length > n ? `${value.slice(0, n - 1)}...` : value;
}
