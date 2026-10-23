// Student Prayer Wall.
// GET  /api/wall                          → posts with "I prayed" counts      (students, leaders, admins)
// POST /api/wall?action=pray   { id }      → +1 "I prayed"                    (students, leaders, admins)
// POST /api/wall?action=post   { name, text } → add an approved post          (admin)
// POST /api/wall?action=remove { id }      → take a post down                 (admin)
// Access is checked in _middleware.js.
import { readWallWithCounts, addWallPost, removeWallPost, prayForPost } from "../../lib/wall.js";
import { json } from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;
  const action = new URL(request.url).searchParams.get("action");

  if (request.method === "GET") return json(await readWallWithCounts(kv));
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  if (action === "pray") {
    const n = await prayForPost(kv, String(body.id || ""));
    return n === null ? json({ error: "That request is no longer on the wall" }, 404) : json({ ok: true, prayed: n });
  }
  if (action === "post") {
    const post = await addWallPost(kv, { name: body.name, text: body.text });
    return post ? json({ ok: true, post }) : json({ error: "Missing text" }, 400);
  }
  if (action === "remove") {
    await removeWallPost(kv, String(body.id || ""));
    return json({ ok: true });
  }
  return json({ error: "Unknown action" }, 400);
}
