// hook/on-stop.js — Stop handler (Stage 1).
// Reads .last_assistant_message, extracts B2+ words via coach(), stores, toasts new words.
// Never blocks the session: any error is swallowed, hook exits 0 with no output.

import { readStdin, coach, postJSON, emit, clip, log, started } from "./lib.js";

started("stop");
const t0 = Date.now();

async function main() {
  const input = await readStdin();
  const msg = input?.last_assistant_message;
  if (!msg || typeof msg !== "string" || !msg.trim()) {
    log("stop", `skip (no msg) ${Date.now() - t0}ms`);
    return;
  }

  let result;
  try {
    result = await coach(msg);
  } catch (e) {
    log("stop", `coach FAILED: ${e.message} ${Date.now() - t0}ms`);
    return; // AIGW failed — don't block
  }

  const words = Array.isArray(result.words) ? result.words : [];

  const rec = await postJSON("/api/message", {
    role: "assistant",
    text_raw: msg,
    session_id: input.session_id || null,
  });
  let summary = { new_count: 0, conflicts: [] };
  if (rec?.id) {
    summary = await postJSON("/api/vocab", {
      message_id: rec.id,
      candidates: words,
      source: "assistant",
    });
  } else {
    log("stop", `api not stored (Cloudflare down? rec=${JSON.stringify(rec)})`);
  }

  // Toast new words. Display-only.
  const newCount = summary?.new_count || 0;
  emit(clip(newCount > 0 ? `📝 +${newCount}` : "no new words"));
  log(
    "stop",
    `ok ${Date.now() - t0}ms | +${words.length} candidates, new=${newCount}, conflicts=${conflicts.length}`,
  );
}

main().catch((e) => log("stop", `UNCAUGHT: ${e?.message || e}`));
