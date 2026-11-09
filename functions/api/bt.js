// Be There API (used by the Be There page at impactbethere.app). Everyone must be signed in with a code.
//
// GET  /api/bt?what=events                      → [events]      (ownerId replaced by "mine": true/false)
// GET  /api/bt?what=config                      → { groupName, isAdmin }
// POST /api/bt { action: "add", event }          → { ok, event }
// POST /api/bt { action: "addMany", events }     → { ok, count }   (spreadsheet / PDF import, up to 200)
// POST /api/bt { action: "update", id, event }   → owner or admin
// POST /api/bt { action: "delete", id }          → owner or admin
// POST /api/bt { action: "cheer", id, on, name } → anyone signed in: "I'll be there" — adds/removes this phone
//                                                  from the event's crowd list, shown as first name + last initial
// POST /api/bt { action: "config", groupName }   → admin
// POST /api/bt { action: "import" }              → admin: one-time copy from the old Firebase database
// The device that posts an event sends its device ID in the X-Device header (Be There's "your events" feature).
import { json, shortName } from "../../lib/auth.js";
import { loadEvents, saveEvents, loadConfig, cleanEvent, canEdit, newId, importFromFirebase } from "../../lib/bethere.js";

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const kv = env.INTERCEDE_KV;
  const role = ctx && ctx.session ? ctx.session.role : null;
  if (!role) return json({ error: "Please sign in." }, 401);
  const isAdmin = role === "admin";
  const deviceId = String(request.headers.get("X-Device") || "").replace(/[^\w-]/g, "").slice(0, 60);
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (url.searchParams.get("what") === "config") {
      const c = await loadConfig(kv);
      const leader = ctx.session.leader && ctx.session.leader.name;
      return json({ groupName: c.groupName, isAdmin, role, me: leader ? shortName(leader) : "" });
    }
    const list = await loadEvents(kv);
    // Phone IDs never leave the server: each crowd entry is just a short name, a role and whether it's this phone
    return json(list.map(({ ownerId, going, ...e }) => ({
      ...e,
      ownerId: ownerId && ownerId === deviceId ? deviceId : undefined,
      going: (Array.isArray(going) ? going : []).map(g => ({ n: g.n, r: g.r, mine: !!deviceId && g.d === deviceId })),
    })));
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const list = await loadEvents(kv);
  const now = Date.now();

  if (body.action === "add" || body.action === "addMany") {
    const incoming = body.action === "add" ? [body.event] : (Array.isArray(body.events) ? body.events : []).slice(0, 200);
    const added = [];
    for (const raw of incoming) {
      const c = cleanEvent(raw || {}, { isAdmin });
      if (c.error) { if (body.action === "add") return json({ error: c.error }, 400); continue; }
      added.push({ id: newId(), ...c.event, cheers: 0, ownerId: deviceId, createdAt: now, updatedAt: now });
    }
    if (list.length + added.length > 3000) return json({ error: "The board is full. Remove some old events first." }, 400);
    await saveEvents(kv, [...list, ...added]);
    return json({ ok: true, count: added.length, event: added[0] || null });
  }

  if (body.action === "import") {
    if (!isAdmin) return json({ error: "Admin only" }, 401);
    if (!env.BE_THERE_FIREBASE_KEY) return json({ error: "Add BE_THERE_FIREBASE_KEY in Cloudflare first (only needed for this one-time import)." }, 400);
    try {
      const old = await importFromFirebase(env, env.BE_THERE_FIREBASE_KEY);
      const have = new Set(list.map(e => e.id));
      const fresh = old.filter(e => !have.has(e.id));
      await saveEvents(kv, [...list, ...fresh]);
      return json({ ok: true, found: old.length, added: fresh.length });
    } catch (e) { return json({ error: e.message }, 502); }
  }

  if (body.action === "config") {
    if (!isAdmin) return json({ error: "Admin only" }, 401);
    const groupName = String(body.groupName || "").trim().slice(0, 80);
    if (!groupName) return json({ error: "Add a board name." }, 400);
    await kv.put("bt:config", JSON.stringify({ groupName }));
    return json({ ok: true, groupName });
  }

  const i = list.findIndex(e => e.id === String(body.id || ""));
  if (i < 0) return json({ error: "That event isn’t on the board anymore." }, 404);

  if (body.action === "cheer") {
    const ev = list[i];
    const going = Array.isArray(ev.going) ? ev.going.slice() : [];
    const at = deviceId ? going.findIndex(g => g.d === deviceId) : -1;
    let cheers = ev.cheers || 0;
    if (body.on === false) {
      if (at >= 0) going.splice(at, 1);
      cheers = Math.max(0, cheers - 1);
    } else if (at < 0) {
      // Leaders show under their own name; everyone else types theirs once on their phone
      const leaderName = ctx.session.leader && ctx.session.leader.name;
      const name = shortName(leaderName || String(body.name || "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").slice(0, 60));
      const r = role === "team" || role === "admin" ? "leader" : role === "parent" ? "parent" : "student";
      if (deviceId && name && going.length < 300) going.push({ d: deviceId, n: name, r, at: now });
      cheers += 1;
    } else if (body.name || (ctx.session.leader && ctx.session.leader.name)) {
      // Already going: just update the name shown
      const name = shortName((ctx.session.leader && ctx.session.leader.name) || String(body.name).replace(/<[^>]*>/g, "").replace(/[<>]/g, "").slice(0, 60));
      if (name) going[at] = { ...going[at], n: name };
    }
    list[i] = { ...ev, cheers, going };
    await saveEvents(kv, list);
    return json({ ok: true, cheers, going: going.map(g => ({ n: g.n, r: g.r, mine: g.d === deviceId })) });
  }
  if (!canEdit(list[i], { isAdmin, deviceId })) return json({ error: "Only the person who posted this (or an admin) can change it." }, 403);
  if (body.action === "update") {
    const c = cleanEvent({ ...list[i], ...(body.event || {}) }, { isAdmin });
    if (c.error) return json({ error: c.error }, 400);
    list[i] = { ...list[i], ...c.event, updatedAt: now };
    await saveEvents(kv, list);
    return json({ ok: true });
  }
  if (body.action === "delete") {
    await saveEvents(kv, list.filter((_, k) => k !== i));
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
