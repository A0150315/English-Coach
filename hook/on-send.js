// hook/on-send.js — UserPromptSubmit handler (Stage 1).
// Reads .prompt, translates + extracts via coach(), stores, toasts the English.
// Never blocks the session: any error is swallowed, hook exits 0 with no output.

import { readStdin, coach, postJSON, emit, clip, log } from "./lib.js";

const t0 = Date.now();

async function main() {
  const input = await readStdin();
  const prompt = input?.prompt;
  if (!prompt || typeof prompt !== "string") return; // nothing to do

  let result;
  try {
    result = await coach(prompt);
  } catch (e) {
    log("send", `coach FAILED: ${e.message} ${Date.now() - t0}ms`);
    return; // AIGW failed — don't block the prompt
  }

  const en = result.en || "";
  const words = Array.isArray(result.words) ? result.words : [];

  // Store the message, then the words (Stage 2 runs server-side).
  const msg = await postJSON("/api/message", {
    role: "user",
    text_zh: prompt,
    text_en: en,
    session_id: input.session_id || null,
  });
  if (msg?.id) {
    await postJSON("/api/vocab", {
      message_id: msg.id,
      candidates: words,
      source: "user-en",
    });
  } else {
    log("send", `api not stored (Cloudflare down? msg=${JSON.stringify(msg)})`);
  }

  // Toast the English translation. Display-only (suppressOutput → no context pollution).
  const toast = en ? clip(en) : "(no translation)";
  emit(toast);
  log(
    "send",
    `ok ${Date.now() - t0}ms | en="${clip(en, 80)}" | +${words.length} words`,
  );
}

main().catch((e) => log("send", `UNCAUGHT: ${e?.message || e}`));
