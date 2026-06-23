// functions/api/words.js — GET: ALL words with all-time occurrence count.
// Used by the viewer's word table (independent of the message window).
// Query: ?limit= (default 500). Key-gated (personal data).

import { authed, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const limit = Math.min(Number(request.url.split("limit=")[1]) || 500, 5000);

  const words = (
    await env.COACH_DB.prepare(
      `SELECT w.id, w.word, w.meaning_zh, w.status,
              COUNT(u.id) AS count
       FROM words w
       LEFT JOIN word_usages u ON u.word_id = w.id
       GROUP BY w.id
       ORDER BY w.id DESC
       LIMIT ?`,
    )
      .bind(limit)
      .all()
  ).results;

  return json({ words });
}
