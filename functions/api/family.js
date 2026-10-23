// Staff-only family requests (admin only — checked in _middleware.js).
// GET  /api/family                                  → list, newest first
// POST /api/family { action: "add", entry }         → add after approving a parent request
// POST /api/family { action: "done", id, done }     → mark followed up / prayed
// POST /api/family { action: "remove", id }
import { readFamily, writeFamily } from "../../lib/family.js";
import { json } from "../../lib/auth.js";

const clip = (v, n) => String(v || "").trim().slice(0, n);

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;
  if (request.method === "GET") return json((await readFamily(kv)).sort((a, b) => b.at - a.at));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const list = await readFamily(kv);

  if (body.action === "add") {
    const e = body.entry || {};
    const entry = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      at: Number(e.at) || Date.now(),
      parent: clip(e.parent, 80),
      students: clip(e.students, 160),
      personId: clip(e.personId, 40),
      text: clip(e.text, 1200),
      staffOnly: e.staffOnly === true,
      dontMention: e.dontMention === true,
      followUp: e.followUp === true,
      contact: clip(e.contact, 120),
      done: false,
    };
    list.unshift(entry);
    await writeFamily(kv, list);
    return json({ ok: true, entry });
  }
  if (body.action === "done") {
    await writeFamily(kv, list.map(x => x.id === body.id ? { ...x, done: body.done !== false } : x));
    return json({ ok: true });
  }
  if (body.action === "remove") {
    await writeFamily(kv, list.filter(x => x.id !== body.id));
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
