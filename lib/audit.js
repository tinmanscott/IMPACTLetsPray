// Audit log of sign-ins and Roster views (admin only).
//
// Each entry is its own KV key that Cloudflare deletes automatically after 90 days:
//   audit:<newest-first sort key>:<random>  →  value "" + metadata { t, e, ok, r, n, ip, ua }
// Keys sort newest first, so the admin screen can page through with KV's list().

const KEEP_DAYS = 90;
const MAX_TS = 9999999999999;

export async function logEvent(env, request, { event, ok = true, role = null, name = "" }) {
  try {
    const t = Date.now();
    const sortKey = String(MAX_TS - t).padStart(13, "0");
    const rand = Math.random().toString(36).slice(2, 8);
    const meta = {
      t,
      e: String(event).slice(0, 20),             // "signin" | "signin-failed" | "roster"
      ok: !!ok,
      r: role || "",                              // admin | team | student | parent | ""
      n: String(name || "").slice(0, 60),         // leader name (full, admin-only)
      ip: (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "").split(",")[0].trim().slice(0, 45),
      ua: (request.headers.get("User-Agent") || "").slice(0, 300),
    };
    await env.INTERCEDE_KV.put(`audit:${sortKey}:${rand}`, "", { expirationTtl: KEEP_DAYS * 24 * 60 * 60, metadata: meta });
  } catch (_e) { /* logging never blocks sign-in */ }
}

export async function listEvents(env, { cursor, limit = 100 } = {}) {
  const res = await env.INTERCEDE_KV.list({ prefix: "audit:", limit: Math.min(200, limit), cursor: cursor || undefined });
  const cutoff = Date.now() - KEEP_DAYS * 864e5;
  const items = res.keys.map(k => ({ id: k.name, ...(k.metadata || {}) })).filter(x => x.t && x.t >= cutoff);
  return { items, cursor: res.list_complete ? null : res.cursor };
}
