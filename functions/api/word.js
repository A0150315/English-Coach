// functions/api/word.js — PATCH: update a word's status (e.g. mark 'known').
// Body: { id, status } where status is 'new' | 'known'.
// Used by the viewer's ✓ button. Auth-gated.

import { authed, json, now } from "./_auth.js";

const ALLOWED = new Set(["new", "known"]);

export async function onRequestPatch({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const { id, status } = body;
  if (!id || !ALLOWED.has(status)) {
    return json({ error: "id and status ('new'|'known') required" }, 400);
  }

  await env.COACH_DB.prepare(
    "UPDATE words SET status=?, updated_at=? WHERE id=?",
  )
    .bind(status, now(), id)
    .run();

  return json({ ok: true });
}
