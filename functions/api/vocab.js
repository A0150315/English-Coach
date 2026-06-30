// functions/api/vocab.js - Stage 2: filter known words, upsert, log usages.
// Body: { message_id, candidates: [{word, meaning_zh, example}], source }
// Returns: { new_count }

import { authed, json, now } from "./_auth.js";

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
  if (candidates.length === 0) return json({ new_count: 0 });

  const normalized = candidates.map((c) => ({
    word: (c.word || "").toLowerCase().trim(),
    meaning_zh: c.meaning_zh || "",
    example: c.example || "",
  }));

  const placeholders = normalized.map(() => "?").join(",");
  const rows = (
    await env.COACH_DB.prepare(
      `SELECT id, word, status FROM words WHERE word IN (${placeholders})`,
    )
      .bind(...normalized.map((c) => c.word))
      .all()
  ).results;

  const existing = new Map(rows.map((r) => [r.word, r]));
  let newCount = 0;

  for (const c of normalized) {
    if (!c.word) continue;
    const ex = existing.get(c.word);

    if (!ex) {
      const ins = await insertNewWord(env, c);
      await logUsage(env, ins.meta.last_row_id, message_id, c.example, c.meaning_zh);
      newCount++;
      continue;
    }

    if (ex.status === "ignored") continue;
    await logUsage(env, ex.id, message_id, c.example, c.meaning_zh);
  }

  return json({ new_count: newCount });
}

async function insertNewWord(env, candidate) {
  return env.COACH_DB.prepare(
    "INSERT INTO words(word, meaning_zh, status, created_at, updated_at) VALUES(?,?,'new',?,?)",
  )
    .bind(candidate.word, candidate.meaning_zh, now(), now())
    .run();
}

async function logUsage(env, wordId, messageId, example, meaningAtTime) {
  await env.COACH_DB.prepare(
    "INSERT INTO word_usages(word_id, message_id, example, meaning_at_time, created_at) " +
      "VALUES(?,?,?,?,?)",
  )
    .bind(wordId, messageId, example, meaningAtTime, now())
    .run();
}
