// Admin inbox for student submissions (admin only — checked in _middleware.js).
// GET  /api/inbox                         → [{ id, name, kind, text, friends, createdAt, hasPhoto }]
// GET  /api/inbox?photo=<id>              → the photo a student sent with a submission
// POST /api/inbox { action: "usePhoto", id, personId } → put that photo on a person's card
// POST /api/inbox { action: "remove", ids: [...] }   → after approving or rejecting
//
// Approving happens in the app: it adds the request/names to the student's card
// (a normal roster save), then removes the submission here.
import { readSubmissions, removeSubmissions, readPendingPhoto } from "../../lib/inbox.js";
import { json } from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  const photoId = new URL(request.url).searchParams.get("photo");
  if (request.method === "GET" && photoId) {
    const buf = await readPendingPhoto(env.INTERCEDE_KV, photoId);
    if (!buf) return new Response("Not found", { status: 404 });
    return new Response(buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600" } });
  }
  if (request.method === "GET") return json(await readSubmissions(env.INTERCEDE_KV));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "usePhoto") {
    const personId = String(body.personId || "");
    if (!/^[a-z0-9_]{4,40}$/i.test(personId)) return json({ error: "Bad person" }, 400);
    const buf = await readPendingPhoto(env.INTERCEDE_KV, String(body.id || ""));
    if (!buf) return json({ error: "Photo not found" }, 404);
    await env.INTERCEDE_KV.put(`photo:${personId}`, buf);
    return json({ ok: true, v: Date.now() });
  }
  if (body.action !== "remove" || !Array.isArray(body.ids)) return json({ error: "Unknown action" }, 400);
  const left = await removeSubmissions(env.INTERCEDE_KV, body.ids.map(String));
  return json({ ok: true, remaining: left.length });
}
