// Admin inbox for student submissions (admin only — checked in _middleware.js).
// GET  /api/inbox                         → [{ id, name, kind, text, friends, createdAt }]
// POST /api/inbox { action: "remove", ids: [...] }   → after approving or rejecting
//
// Approving happens in the app: it adds the request/names to the student's card
// (a normal roster save), then removes the submission here.
import { readSubmissions, removeSubmissions } from "../../lib/inbox.js";
import { json } from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "GET") return json(await readSubmissions(env.INTERCEDE_KV));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  if (body.action !== "remove" || !Array.isArray(body.ids)) return json({ error: "Unknown action" }, 400);
  const left = await removeSubmissions(env.INTERCEDE_KV, body.ids.map(String));
  return json({ ok: true, remaining: left.length });
}
