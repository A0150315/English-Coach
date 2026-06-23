// functions/api/vocab.js — Stage 2: filter known words, detect conflicts, upsert.
// Body: { message_id, candidates: [{word, meaning_zh, example}], source }
// Returns: { new_count, conflicts: [{word, was, now}] }
//
// This is the entire "is this word unfamiliar?" decision. One bulk SELECT against D1,
// O(candidates). The known-set never enters any LLM prompt.

import { authed, json, now, normalizeMeaning } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { message_id, candidates } = body;
  if (!message_id || !Array.isArray(candidates)) {
    return json({ error: "message_id and candidates[] required" }, 400);
  }
  if (candidates.length === 0) return json({ new_count: 0, conflicts: [] });

  // Normalize all candidate words to lowercase for lookup.
  const normalized = candidates.map((c) => ({
    word: (c.word || "").toLowerCase().trim(),
    meaning_zh: c.meaning_zh || "",
    example: c.example || "",
  }));

  // One batched SELECT — fetch every existing row for these words at once.
  const placeholders = normalized.map(() => "?").join(",");
  const rows = (
    await env.COACH_DB.prepare(
      `SELECT id, word, meaning_zh, status FROM words WHERE word IN (${placeholders})`,
    )
      .bind(...normalized.map((c) => c.word))
      .all()
  ).results;

  const known = new Map(rows.map((r) => [r.word, r]));

  const conflicts = [];
  let newCount = 0;

  for (const c of normalized) {
    if (!c.word) continue;
    const existing = known.get(c.word);

    if (!existing) {
      // Brand new word → insert + log usage.
      const ins = await env.COACH_DB.prepare(
        "INSERT INTO words(word, meaning_zh, status, created_at, updated_at) VALUES(?,?,'new',?,?)",
      )
        .bind(c.word, c.meaning_zh, now(), now())
        .run();
      await logUsage(
        env,
        ins.meta.last_row_id,
        message_id,
        c.example,
        c.meaning_zh,
      );
      newCount++;
    } else if (existing.status === "known") {
      // You already know it → just log the usage, don't count as new.
      await logUsage(env, existing.id, message_id, c.example, c.meaning_zh);
    } else if (
      normalizeMeaning(existing.meaning_zh) === normalizeMeaning(c.meaning_zh)
    ) {
      // Same meaning seen again → just add context.
      await logUsage(env, existing.id, message_id, c.example, c.meaning_zh);
    } else {
      // Different meaning → conflict. Flag it and log the new usage.
      await env.COACH_DB.prepare(
        "UPDATE words SET status='conflict', updated_at=? WHERE id=?",
      )
        .bind(now(), existing.id)
        .run();
      await logUsage(env, existing.id, message_id, c.example, c.meaning_zh);
      conflicts.push({
        word: c.word,
        was: existing.meaning_zh,
        now: c.meaning_zh,
      });
    }
  }

  return json({ new_count: newCount, conflicts });
}

async function logUsage(env, wordId, messageId, example, meaningAtTime) {
  await env.COACH_DB.prepare(
    "INSERT INTO word_usages(word_id, message_id, example, meaning_at_time, created_at) " +
      "VALUES(?,?,?,?,?)",
  )
    .bind(wordId, messageId, example, meaningAtTime, now())
    .run();
}
