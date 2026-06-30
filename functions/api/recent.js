// functions/api/recent.js - GET latest N messages joined with words, corrections, digests.
// Query: ?limit=50. Key-gated.

import { authed, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 50, 200);
  const messages = (
    await env.COACH_DB.prepare(
      "SELECT id, role, text_zh, text_en, text_raw, session_id, created_at " +
        "FROM messages ORDER BY id DESC LIMIT ?",
    )
      .bind(limit)
      .all()
  ).results;

  if (messages.length === 0) return json({ messages: [] });

  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const wordsByMsg = await loadWordsByMessage(env, placeholders, ids);
  const correctionsByMsg = await loadCorrectionsByMessage(env, placeholders, ids);
  const digestsByMsg = await loadDigestsByMessage(env, placeholders, ids);

  const result = messages.map((m) => ({
    ...m,
    words: wordsByMsg.get(m.id) || [],
    correction: correctionsByMsg.get(m.id) || null,
    digest: digestsByMsg.get(m.id) || null,
  }));

  return json({ messages: result });
}

async function loadWordsByMessage(env, placeholders, ids) {
  const usages = (
    await env.COACH_DB.prepare(
      `SELECT w.word, w.meaning_zh, w.status, u.message_id, u.example
       FROM word_usages u
       JOIN words w ON w.id = u.word_id
       WHERE u.message_id IN (${placeholders})`,
    )
      .bind(...ids)
      .all()
  ).results;

  const byMsg = new Map();
  for (const u of usages) {
    if (!byMsg.has(u.message_id)) byMsg.set(u.message_id, []);
    byMsg.get(u.message_id).push({
      word: u.word,
      meaning_zh: u.meaning_zh,
      status: u.status,
      example: u.example,
    });
  }
  return byMsg;
}

async function loadCorrectionsByMessage(env, placeholders, ids) {
  try {
    const rows = (
      await env.COACH_DB.prepare(
        `SELECT message_id, original, corrected, explanation, pattern, error_type
         FROM prompt_corrections
         WHERE message_id IN (${placeholders})`,
      )
        .bind(...ids)
        .all()
    ).results;
    return new Map(rows.map((row) => [row.message_id, row]));
  } catch {
    return new Map();
  }
}

async function loadDigestsByMessage(env, placeholders, ids) {
  try {
    const rows = (
      await env.COACH_DB.prepare(
        `SELECT message_id, summary, next_steps_json, key_terms_json
         FROM response_digests
         WHERE message_id IN (${placeholders})`,
      )
        .bind(...ids)
        .all()
    ).results;
    return new Map(rows.map((row) => [row.message_id, parseDigestRow(row)]));
  } catch {
    return new Map();
  }
}

function parseDigestRow(row) {
  return {
    summary: row.summary,
    next_steps: parseJSON(row.next_steps_json, []),
    key_terms: parseJSON(row.key_terms_json, []),
  };
}

function parseJSON(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
