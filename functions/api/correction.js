// functions/api/correction.js - POST insert prompt correction, GET newest corrections.

import { authed, json, now } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { message_id, original, corrected, explanation, pattern, error_type } = body;
  if (!message_id || !original || !corrected) {
    return json({ error: "message_id, original, and corrected required" }, 400);
  }

  const res = await env.COACH_DB.prepare(
    "INSERT INTO prompt_corrections(message_id, original, corrected, explanation, pattern, error_type, created_at) " +
      "VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      message_id,
      original,
      corrected,
      explanation ?? null,
      pattern ?? null,
      error_type ?? null,
      now(),
    )
    .run();

  return json({ id: res.meta.last_row_id });
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Number(params.get("limit")) || 100, 500);
  const corrections = (
    await env.COACH_DB.prepare(
      "SELECT id, message_id, original, corrected, explanation, pattern, error_type, created_at " +
        "FROM prompt_corrections ORDER BY id DESC LIMIT ?",
    )
      .bind(limit)
      .all()
  ).results;

  return json({ corrections });
}
