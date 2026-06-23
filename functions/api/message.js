// functions/api/message.js — POST: insert a message, return {id}.
// Body: { role, text_zh?, text_en?, text_raw?, session_id? }

import { authed, json, now } from "./_auth.js";

export async function onRequestPost({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { role, text_zh, text_en, text_raw, session_id } = body;
  if (role !== "user" && role !== "assistant") {
    return json({ error: "role must be 'user' or 'assistant'" }, 400);
  }

  const res = await env.COACH_DB.prepare(
    "INSERT INTO messages(role, text_zh, text_en, text_raw, session_id, created_at) " +
      "VALUES(?,?,?,?,?,?)",
  )
    .bind(
      role,
      text_zh ?? null,
      text_en ?? null,
      text_raw ?? null,
      session_id ?? null,
      now(),
    )
    .run();

  return json({ id: res.meta.last_row_id });
}
