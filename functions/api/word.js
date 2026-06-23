// functions/api/word.js — PATCH: update a word's status (e.g. mark 'known').
//                    GET ?id=X: one word's distinct meanings + examples (for the expand view).
// Auth-gated.

import { authed, json, now, normalizeMeaning } from "./_auth.js";

const ALLOWED = new Set(["new", "known"]);

// GET ?id=X → distinct meanings (deduped by normalized meaning) with one example each.
export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return json({ error: "unauthorized" }, 401);

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return json({ error: "id required" }, 400);

  const usages = (
    await env.COACH_DB.prepare(
      "SELECT meaning_at_time, example, created_at FROM word_usages " +
        "WHERE word_id=? ORDER BY created_at DESC",
    )
      .bind(id)
      .all()
  ).results;

  // Dedupe by meaning: keep the first (newest) example for each distinct meaning.
  const seen = new Set();
  const meanings = [];
  for (const u of usages) {
    const key = normalizeMeaning(u.meaning_at_time);
    if (seen.has(key)) continue;
    seen.add(key);
    meanings.push({ meaning: u.meaning_at_time, example: u.example });
  }

  return json({ meanings });
}

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
