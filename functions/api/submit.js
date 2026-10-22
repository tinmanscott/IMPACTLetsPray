// Student submissions: prayer requests and CAUSE Circle names.
// Nothing here is shown to anyone until an admin approves it in the Inbox.
//
// GET  /api/submit  → { open, name, sub, role }   (public: tells the student page what to show)
// POST /api/submit { name, kind: "request" | "cause", text, friends: [] }   (student code or higher)
import { getSession, publicSettings, json } from "../../lib/auth.js";
import { addSubmission } from "../../lib/inbox.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    const { role, settings } = await getSession(request, env);
    const pub = publicSettings(settings);
    return json({ open: !!(pub && pub.studentCodeSet), name: pub ? pub.name : "", sub: pub ? pub.sub : "", configured: !!pub, role });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const kind = body.kind === "cause" ? "cause" : "request";
  if (name.length < 2) return json({ error: "Please enter your name." }, 400);

  let text = "";
  let friends = [];
  if (kind === "request") {
    text = String(body.text || "").trim().slice(0, 600);
    if (text.length < 3) return json({ error: "Please write your prayer request." }, 400);
  } else {
    friends = (Array.isArray(body.friends) ? body.friends : String(body.text || "").split(/[,\n]/))
      .map(f => String(f).trim().replace(/\s+/g, " ").slice(0, 60))
      .filter(Boolean)
      .slice(0, 12);
    if (!friends.length) return json({ error: "Add at least one friend’s name." }, 400);
  }

  const result = await addSubmission(env.INTERCEDE_KV, { name, kind, text, friends });
  if (!result.ok) return json({ error: result.error }, 429);
  return json({ ok: true });
}
