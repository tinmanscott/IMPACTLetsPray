// Audit log (admin only to read).
//
// GET  /api/audit?cursor=…        → { items: [{ t, e, ok, r, n, ip, ua }], cursor }   newest first, last 90 days
// POST /api/audit { event: "roster" } → a leader opened the Roster (logged with their name, IP and browser)
import { json } from "../../lib/auth.js";
import { logEvent, listEvents } from "../../lib/audit.js";

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const session = (ctx && ctx.session) || {};
  if (request.method === "GET") {
    if (session.role !== "admin") return json({ error: "Admin only" }, 401);
    const url = new URL(request.url);
    return json(await listEvents(env, { cursor: url.searchParams.get("cursor") }));
  }
  if (request.method === "POST") {
    if (session.role !== "team" && session.role !== "admin") return json({ error: "Leaders only" }, 401);
    await logEvent(env, request, { event: "roster", role: session.role, name: session.leader ? session.leader.name : session.role === "admin" ? "Admin" : "" });
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
