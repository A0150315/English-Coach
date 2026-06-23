// functions/api/recent.js — GET: latest N messages joined with their words.
// Query: ?limit=50. Used by the viewer's 3s poll. Key-gated (personal data).

import { authed, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const limit = Math.min(Number(request.url.split("limit=")[1]) || 50, 200);

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

  // Join words → usages → messages in one query.
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

  const result = messages.map((m) => ({
    ...m,
    words: byMsg.get(m.id) || [],
  }));

  return json({ messages: result });
}
