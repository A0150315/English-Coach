// hook/on-stop.js - Stop handler.
// Digests assistant reply, stores digest + vocab. Raw text storage is opt-in.

import {
  readStdin,
  digestResponse,
  postJSON,
  emit,
  clip,
  log,
  sanitizeAssistantText,
  truncateText,
} from "./lib.js";

const t0 = Date.now();

async function main() {
  const input = await readStdin();
  const msg = input?.last_assistant_message;
  if (!msg || typeof msg !== "string" || !msg.trim()) return;

  const sanitized = sanitizeAssistantText(msg);
  let result;
  try {
    result = await digestResponse(sanitized);
  } catch (e) {
    log("stop", `digest FAILED: ${e.message} ${Date.now() - t0}ms`);
    return;
  }

  const words = Array.isArray(result.words) ? result.words : [];
  const summary = result.summary || "";
  const rawText = getStoredRawText(sanitized);

  const rec = await postJSON("/api/message", {
    role: "assistant",
    text_en: summary,
    text_raw: rawText,
    session_id: input.session_id || null,
  });

  let vocabSummary = { new_count: 0 };
  if (rec?.id) {
    await postJSON("/api/digest", {
      message_id: rec.id,
      summary,
      next_steps: result.next_steps || [],
      key_terms: result.key_terms || [],
    });
    vocabSummary = await postJSON("/api/vocab", {
      message_id: rec.id,
      candidates: words,
      source: "assistant",
    });
  } else {
    log("stop", `api not stored (Cloudflare down? rec=${JSON.stringify(rec)})`);
  }

  const newCount = vocabSummary?.new_count || 0;
  emit(clip(summary.length <= 140 ? `TL;DR: ${summary}` : `new words: ${newCount}`));
  log(
    "stop",
    `ok ${Date.now() - t0}ms | +${newCount} new | summary="${clip(summary, 60)}"`,
  );
}

function getStoredRawText(sanitized) {
  if (process.env.COACH_STORE_RAW_ASSISTANT !== "true") {
    log("stop", "raw assistant storage disabled");
    return null;
  }

  const maxChars = Number(process.env.COACH_MAX_RAW_CHARS ?? 0);
  const rawText = truncateText(sanitized, maxChars);
  if (rawText.length < sanitized.length) {
    log("stop", `raw assistant storage truncated to ${rawText.length} chars`);
  }
  return rawText || null;
}

main().catch((e) => log("stop", `UNCAUGHT: ${e?.message || e}`));
