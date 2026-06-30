// functions/api/digest.js - POST insert response digest, GET newest digests.

import { authed, json, now } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { message_id, summary, next_steps, key_terms } = body;
  if (!message_id || !summary) {
    return json({ error: "message_id and summary required" }, 400);
  }

  const res = await env.COACH_DB.prepare(
    "INSERT INTO response_digests(message_id, summary, next_steps_json, key_terms_json, created_at) " +
      "VALUES(?,?,?,?,?)",
  )
    .bind(
      message_id,
      summary,
      JSON.stringify(Array.isArray(next_steps) ? next_steps : []),
      JSON.stringify(Array.isArray(key_terms) ? key_terms : []),
      now(),
    )
    .run();

  return json({ id: res.meta.last_row_id });
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 100, 500);
  const digests = (
    await env.COACH_DB.prepare(
      "SELECT id, message_id, summary, next_steps_json, key_terms_json, created_at " +
        "FROM response_digests ORDER BY id DESC LIMIT ?",
    )
      .bind(limit)
      .all()
  ).results.map(parseDigestRow);

  return json({ digests });
}

function parseDigestRow(row) {
  return {
    id: row.id,
    message_id: row.message_id,
    summary: row.summary,
    next_steps: parseJSON(row.next_steps_json, []),
    key_terms: parseJSON(row.key_terms_json, []),
    created_at: row.created_at,
  };
}

function parseJSON(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
