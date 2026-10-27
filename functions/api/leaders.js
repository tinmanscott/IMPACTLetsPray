// Individual leader codes (admin only).
//
// GET  /api/leaders                          → [{ id, name, createdAt, codeAt, lastSignIn, revokedAt, active }]   (never the codes)
// POST /api/leaders { action: "add", name }  → { leader, code }   the code is shown this once; only its hash is stored
// POST /api/leaders { action: "newcode", id } → { leader, code }  old code stops working and that leader is signed out
// POST /api/leaders { action: "revoke", id }  → signs them out; the code stops working
// POST /api/leaders { action: "delete", id }  → removes a revoked leader from the list
import { json, loadLeaders, saveLeaders, newLeaderCode, leaderCodeHash, findLeaderByCode } from "../../lib/auth.js";

const publicLeader = l => ({ id: l.id, name: l.name, createdAt: l.createdAt, codeAt: l.codeAt, lastSignIn: l.lastSignIn || null, revokedAt: l.revokedAt || null, active: !l.revokedAt });

async function freshCode(env) {
  for (let i = 0; i < 5; i++) {
    const code = newLeaderCode();
    if (!(await findLeaderByCode(env, code))) return code; // never reuse a live code
  }
  throw new Error("Couldn’t make a code. Try again.");
}

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  if (!ctx || !ctx.session || ctx.session.role !== "admin") return json({ error: "Admin only" }, 401);

  if (request.method === "GET") {
    const list = await loadLeaders(env);
    return json(list.map(publicLeader).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)));
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const list = await loadLeaders(env);

  if (body.action === "add") {
    const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (name.length < 2) return json({ error: "Enter the leader’s first and last name." }, 400);
    if (list.filter(l => !l.revokedAt).length >= 150) return json({ error: "That’s the most leaders the app can hold." }, 400);
    const code = await freshCode(env);
    const now = Date.now();
    const leader = { id: Math.random().toString(36).slice(2, 10) + now.toString(36), name, codeHash: await leaderCodeHash(env, code), ver: 1, createdAt: now, codeAt: now };
    await saveLeaders(env, [...list, leader]);
    return json({ ok: true, leader: publicLeader(leader), code });
  }

  const i = list.findIndex(l => l.id === body.id);
  if (i < 0) return json({ error: "Leader not found" }, 404);
  const l = list[i];

  if (body.action === "newcode") {
    const code = await freshCode(env);
    list[i] = { ...l, codeHash: await leaderCodeHash(env, code), ver: (l.ver || 1) + 1, codeAt: Date.now(), revokedAt: null };
    await saveLeaders(env, list);
    return json({ ok: true, leader: publicLeader(list[i]), code });
  }
  if (body.action === "revoke") {
    list[i] = { ...l, codeHash: null, ver: (l.ver || 1) + 1, revokedAt: Date.now() };
    await saveLeaders(env, list);
    return json({ ok: true, leader: publicLeader(list[i]) });
  }
  if (body.action === "delete") {
    if (!l.revokedAt) return json({ error: "Revoke the code first." }, 400);
    await saveLeaders(env, list.filter(x => x.id !== l.id));
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
