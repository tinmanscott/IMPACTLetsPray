// Student Prayer Wall.
// GET  /api/wall                          → posts with "I prayed" counts      (students, leaders, admins)
// GET  /api/wall?action=stats             → this month's group Gospel conversation total and goal (no names)
// POST /api/wall?action=pray   { id }      → +1 "I prayed"                    (students, leaders, admins)
// POST /api/wall?action=post   { name, text } → add an approved post          (admin)
// POST /api/wall?action=remove { id }      → take a post down                 (admin)
// Access is checked in _middleware.js.
import { readWallWithCounts, addWallPost, removeWallPost, prayForPost } from "../../lib/wall.js";
import { json } from "../../lib/auth.js";

// Group totals only: students see how the whole group is doing, never who did what.
async function gospelStats(kv) {
  const monthOf = ts => new Date(ts).toLocaleDateString("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric" });
  const thisMonth = monthOf(Date.now());
  let month = 0, trusted = 0, people = [];
  try { people = JSON.parse((await kv.get("people")) || "[]"); } catch (_e) {}
  for (const p of people) {
    if (p.active === false) continue;
    for (const g of p.gospelLog || []) {
      if (monthOf(g.at) !== thisMonth) continue;
      month += Number(g.count) || 0;
      if (g.outcome === "trusted") trusted++;
    }
  }
  let goal = 0;
  try { goal = Number(JSON.parse((await kv.get("goals")) || "{}").convGoal) || 0; } catch (_e) {}
  const monthName = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long" });
  return { month, goal, trusted, monthName };
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;
  const action = new URL(request.url).searchParams.get("action");

  if (request.method === "GET" && action === "stats") return json(await gospelStats(kv));
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
