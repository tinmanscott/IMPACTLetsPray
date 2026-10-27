// One Church check-ins (admin only).
//
// GET  /api/onechurch                         → { keySet, tenant, events, lastSync, lastResult }
// POST /api/onechurch { action: "test" }      → account name, check-in events to pick from, field names seen
// POST /api/onechurch { action: "save", events: [{ id, name }] }
// POST /api/onechurch { action: "sync" }      → new check-ins (last 7 days) become Inbox cards. Leaders' apps call this too,
//                                                at most every 6 hours, so new students show up each week without anyone tapping
// POST /api/onechurch { action: "import", since: "2026-09-01" } → one-time catch-up from a start date (admin)
// POST /api/onechurch { action: "continue" }  → look up the next batch of queued people (admin)
// POST /api/onechurch { action: "seen", ocIds: [...] } → don't offer these people again (added, linked or dismissed)
import { json } from "../../lib/auth.js";
import { addSubmission, readSubmissions } from "../../lib/inbox.js";
import { loadConfig, saveConfig, addSeen, testConnection, syncCheckins, processQueue } from "../../lib/onechurch.js";

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const role = ctx && ctx.session ? ctx.session.role : null;
  const kv = env.INTERCEDE_KV;
  const cfg = await loadConfig(kv);

  // Leaders: only the background weekly check, and only counts come back (no names)
  if (role === "team") {
    if (request.method !== "POST" || !env.ONE_CHURCH_API_KEY) return json({ ok: true, skipped: true });
    if (cfg.lastSync && Date.now() - cfg.lastSync < 6 * 3600 * 1000) return json({ ok: true, skipped: true });
    try { const r = await syncCheckins(env, { addSubmission, readSubmissions }); return json({ ok: !!r.ok }); }
    catch (_e) { return json({ ok: false }); }
  }
  if (role !== "admin") return json({ error: "Admin only" }, 401);

  if (request.method === "GET") {
    let queued = 0;
    try { queued = (JSON.parse((await kv.get("onechurch:queue")) || "[]") || []).length; } catch (_e) {}
    return json({ keySet: !!env.ONE_CHURCH_API_KEY, tenant: cfg.tenant, eventName: cfg.eventName, events: cfg.events || [], queued, importedSince: cfg.importedSince || null, importedAt: cfg.importedAt || null, lastSync: cfg.lastSync || null, lastResult: cfg.lastResult || null });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  try {
    if (body.action === "test") {
      try { return json({ ...(await testConnection(env, cfg)), tested: true }); }
      catch (e) { return json({ ok: false, tested: true, error: e.message, steps: e.steps || [] }); }
    }
    if (body.action === "save") {
      const events = (Array.isArray(body.events) ? body.events : []).slice(0, 6)
        .map(e => ({ id: String(e.id || "").replace(/[^0-9]/g, "").slice(0, 12), name: String(e.name || "").slice(0, 120) }))
        .filter(e => e.id);
      await saveConfig(kv, { ...cfg, events });
      return json({ ok: true, events });
    }
    if (body.action === "sync") {
      // At most once every 10 minutes unless the admin taps "Check now"
      if (!body.force && cfg.lastSync && Date.now() - cfg.lastSync < 10 * 60 * 1000) return json({ ok: true, skipped: true, ...(cfg.lastResult || {}) });
      return json(await syncCheckins(env, { addSubmission, readSubmissions }));
    }
    if (body.action === "import") {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.since || ""));
      if (!m) return json({ ok: false, error: "Pick a start date." });
      const since = Date.UTC(+m[1], +m[2] - 1, +m[3], 12);
      if (since > Date.now() || Date.now() - since > 400 * 864e5) return json({ ok: false, error: "Pick a start date in the last year." });
      return json(await syncCheckins(env, { addSubmission, readSubmissions }, { since }));
    }
    if (body.action === "continue") return json({ ok: true, ...(await processQueue(env, { addSubmission })) });
    if (body.action === "seen") {
      await addSeen(kv, (Array.isArray(body.ocIds) ? body.ocIds : []).map(x => String(x).slice(0, 20)));
      return json({ ok: true });
    }
  } catch (e) {
    return json({ ok: false, error: e.message || "Couldn’t reach One Church.", code: e.code || null }, 200);
  }
  return json({ error: "Unknown action" }, 400);
}
