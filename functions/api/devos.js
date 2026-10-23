// Counts of who finished each daily devo (numbers only, no names).
//
// POST /api/devos { weekId, devoId, done: true|false }   → anyone on the student, parent or leader pages
//      counted as a student, parent or leader by how they're signed in (no sign-in = the open student page)
// GET  /api/devos?weeks=<weekId>,<weekId>               → leaders and admin: { [weekId]: { [devoId]: { s, p, l } } }
//
// KV: devo:<weekId>:<devoId> → { s, p, l }
import { json } from "../../lib/auth.js";

const ID = /^[\w-]{1,40}$/;

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const kv = env.INTERCEDE_KV;
  const role = ctx && ctx.session ? ctx.session.role : null;
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (role !== "team" && role !== "admin") return json({ error: "Leaders only" }, 401);
    let series = null;
    try { series = JSON.parse((await kv.get("series")) || "null"); } catch (_e) {}
    const ids = String(url.searchParams.get("weeks") || "").split(",").filter(x => ID.test(x)).slice(0, 12);
    const out = {};
    for (const wid of ids) {
      const week = series && (series.weeks || []).find(w => w.id === wid);
      out[wid] = {};
      for (const d of (week && week.devos) || []) {
        let c = null;
        try { c = JSON.parse((await kv.get(`devo:${wid}:${d.id}`)) || "null"); } catch (_e) {}
        out[wid][d.id] = c || { s: 0, p: 0, l: 0 };
      }
    }
    return json(out);
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const { weekId, devoId } = body;
  if (!ID.test(String(weekId || "")) || !ID.test(String(devoId || ""))) return json({ error: "Unknown devo" }, 400);

  // Only devos that exist in the current series can be counted
  let series = null;
  try { series = JSON.parse((await kv.get("series")) || "null"); } catch (_e) {}
  const week = series && (series.weeks || []).find(w => w.id === weekId);
  if (!week || !(week.devos || []).some(d => d.id === devoId)) return json({ error: "Unknown devo" }, 404);

  // The student page is open, so keep one phone from running the numbers up
  if (role !== "team" && role !== "admin") {
    const ip = request.headers.get("CF-Connecting-IP") || "local";
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lp-devo:" + ip))).slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join("");
    const rk = `rl:devo:${hash}:${Math.floor(Date.now() / 36e5)}`;
    const n = Number(await kv.get(rk)) || 0;
    if (n >= 40) return json({ ok: true, skipped: true });
    await kv.put(rk, String(n + 1), { expirationTtl: 7200 });
  }

  const who = role === "parent" ? "p" : role === "team" || role === "admin" ? "l" : "s";
  const key = `devo:${weekId}:${devoId}`;
  let c = { s: 0, p: 0, l: 0 };
  try { c = { ...c, ...(JSON.parse((await kv.get(key)) || "null") || {}) }; } catch (_e) {}
  c[who] = Math.max(0, (c[who] || 0) + (body.done === false ? -1 : 1));
  await kv.put(key, JSON.stringify(c), { expirationTtl: 400 * 24 * 60 * 60 });
  return json({ ok: true });
}
