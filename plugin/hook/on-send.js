// hook/on-send.js - UserPromptSubmit handler.
// Coaches prompt, stores correction + vocab. Never blocks session.

import { readStdin, coachPrompt, postJSON, emit, clip, log } from "./lib.js";

const t0 = Date.now();

async function main() {
  const input = await readStdin();
  const prompt = input?.prompt;
  if (!prompt || typeof prompt !== "string") return;

  let result;
  try {
    result = await coachPrompt(prompt, process.env.COACH_MODE || "ai_prompt");
  } catch (e) {
    log("send", `coach FAILED: ${e.message} ${Date.now() - t0}ms`);
    return;
  }

  if (result.action === "skip") {
    log(
      "send",
      `skip (model: idiomatic or contentless) ${Date.now() - t0}ms | in="${clip(prompt, 60)}"`,
    );
    return;
  }

  const corrected = result.corrected || "";
  const words = Array.isArray(result.words) ? result.words : [];

  const msg = await postJSON("/api/message", {
    role: "user",
    text_zh: prompt,
    text_en: corrected,
    session_id: input.session_id || null,
  });

  if (msg?.id) {
    await postJSON("/api/correction", {
      message_id: msg.id,
      original: prompt,
      corrected,
      explanation: result.explanation || null,
      pattern: result.pattern || null,
      error_type: result.error_type || null,
    });
    await postJSON("/api/vocab", {
      message_id: msg.id,
      candidates: words,
      source: "user-en",
    });
  } else {
    log("send", `api not stored (Cloudflare down? msg=${JSON.stringify(msg)})`);
  }

  const rule = result.pattern ? `\nRule: ${result.pattern}` : "";
  emit(clip(corrected ? `${corrected}${rule}` : "(no correction)"));
  log(
    "send",
    `ok ${Date.now() - t0}ms | corrected="${clip(corrected, 80)}" | +${words.length} words`,
  );
}

main().catch((e) => log("send", `UNCAUGHT: ${e?.message || e}`));
