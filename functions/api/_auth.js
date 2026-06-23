// functions/api/_auth.js — shared helpers for Pages Functions over D1.

/** Reject if the X-Coach-Key header doesn't match the secret. Returns true if ok. */
export function authed(request, env) {
  const key = request.headers.get("X-Coach-Key");
  return key && env.COACH_API_KEY && key === env.COACH_API_KEY;
}

/** JSON response helper. */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** ISO timestamp string. */
export function now() {
  return new Date().toISOString();
}

/** Normalize a meaning for conflict comparison: lowercase, trim, strip punctuation. */
export function normalizeMeaning(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[，。、,.;:！!？?（）()【】「」""'']/g, "")
    .trim();
}
