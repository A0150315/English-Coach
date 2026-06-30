// functions/api/words.js — GET: ALL words with all-time occurrence count.
// Used by the viewer's word table (independent of the message window).
// Query: ?limit= (default 500), ?status=new|known|ignored|all.

import { authed, json } from "./_auth.js";

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 500, 5000);
  const status = params.get("status");
  const statuses = status === "all"
    ? ["new", "known", "ignored"]
    : status
      ? [status]
      : ["new", "known"];
  const placeholders = statuses.map(() => "?").join(",");

  const words = (
    await env.COACH_DB.prepare(
      `SELECT w.id, w.word, w.meaning_zh, w.status,
              COUNT(u.id) AS count
       FROM words w
       LEFT JOIN word_usages u ON u.word_id = w.id
       WHERE w.status IN (${placeholders})
       GROUP BY w.id
       ORDER BY w.id DESC
       LIMIT ?`,
    )
      .bind(...statuses, limit)
      .all()
  ).results;

  return json({ words });
}
