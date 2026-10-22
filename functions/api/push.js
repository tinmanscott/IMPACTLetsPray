// Daily prayer reminders (signed-in leaders only — checked in _middleware.js).
//
// GET  /api/push                          → { publicKey }
// POST /api/push { subscription, time, tz } → subscribe or change time
// POST /api/push?action=seen { id }        → opened the app today, skip today's reminder
// POST /api/push?action=unsubscribe { id }
// POST /api/push?action=test { id }        → send a test notification to this device now
import { getVapidKeys, sendPush, subscriptionId, readIndex, removeSubscription, localParts } from "../../lib/webpush.js";
import { json } from "../../lib/auth.js";

const TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "subscribe";

  if (request.method === "GET") {
    const keys = await getVapidKeys(kv);
    return json({ publicKey: keys.publicKey });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  if (action === "subscribe") {
    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: "Invalid subscription" }, 400);
    }
    const time = TIME_RE.test(body.time || "") ? body.time : "09:00";
    const tz = typeof body.tz === "string" ? body.tz.slice(0, 64) : "America/New_York";
    const id = await subscriptionId(sub.endpoint);
    const existing = JSON.parse((await kv.get(`push:sub:${id}`)) || "null");
    await kv.put(`push:sub:${id}`, JSON.stringify({
      subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      time, tz, lastSeen: existing ? existing.lastSeen : null,
    }));
    const index = (await readIndex(kv)).filter(e => e.id !== id);
    index.push({ id, time, tz });
    await kv.put("push:index", JSON.stringify(index));
    return json({ ok: true, id, time });
  }

  const id = typeof body.id === "string" ? body.id.slice(0, 40) : "";
  if (!id) return json({ error: "Missing id" }, 400);

  if (action === "seen") {
    const raw = await kv.get(`push:sub:${id}`);
    if (!raw) return json({ ok: false, unknown: true });
    const rec = JSON.parse(raw);
    const today = localParts(rec.tz).day;
    if (rec.lastSeen !== today) {
      rec.lastSeen = today;
      await kv.put(`push:sub:${id}`, JSON.stringify(rec));
    }
    return json({ ok: true });
  }

  if (action === "unsubscribe") {
    await removeSubscription(kv, id);
    return json({ ok: true });
  }

  if (action === "test") {
    const raw = await kv.get(`push:sub:${id}`);
    if (!raw) return json({ error: "This device isn’t subscribed" }, 404);
    const rec = JSON.parse(raw);
    const settings = JSON.parse((await kv.get("settings")) || "{}");
    const status = await sendPush(kv, rec.subscription, {
      title: settings.name || "Let’s Pray",
      body: "Test reminder — notifications are working 🙏",
      url: "/",
    });
    if (status === 404 || status === 410) { await removeSubscription(kv, id); return json({ error: "Subscription expired — turn reminders on again" }, 410); }
    return json({ ok: status >= 200 && status < 300, status });
  }

  return json({ error: "Unknown action" }, 400);
}
