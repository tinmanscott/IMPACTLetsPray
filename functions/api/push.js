// Daily prayer reminders (signed-in leaders only — checked in _middleware.js).
//
// GET  /api/push                          → { publicKey }
// POST /api/push { subscription, time, tz } → subscribe or change time
// POST /api/push?action=seen { id }        → opened the app today, skip today's reminder
// POST /api/push?action=unsubscribe { id }
// POST /api/push?action=test { id }        → send a test notification to this device now
// POST /api/push?action=prayed { personId } → tell that student a leader prayed for them (once a day; leaders)
// POST /api/push?action=broadcast { title, body } → send to every leader with reminders on (admin)
// Students can subscribe too (for "someone prayed for you"); they aren't added to the daily reminder list.
import { getVapidKeys, sendPush, subscriptionId, readIndex, removeSubscription, localParts } from "../../lib/webpush.js";
import { json } from "../../lib/auth.js";
import { notifyOnce } from "../../lib/notify.js";

const TIME_RE = /^([01]\d|2[0-3]):(00|15|30|45)$/;

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const role = ctx && ctx.session ? ctx.session.role : null;
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
    if (role === "student") {
      await kv.put(`push:sub:${id}`, JSON.stringify({
        subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        kind: "student",
      }), { expirationTtl: 365 * 24 * 60 * 60 });
      return json({ ok: true, id });
    }
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

  if (action === "prayed") {
    if (role !== "team" && role !== "admin") return json({ error: "Leaders only" }, 401);
    const personId = String(body.personId || "");
    let people = [];
    try { people = JSON.parse((await kv.get("people")) || "[]"); } catch (_e) {}
    const person = people.find(p => p.id === personId);
    if (!person || !person.notifyId) return json({ ok: true, sent: false });
    context.waitUntil(notifyOnce(kv, person.notifyId, `person:${personId}`, {
      title: "You were prayed for today 🙏",
      body: "One of your IMPACT leaders just prayed for you.",
      url: "/submit",
    }));
    return json({ ok: true, sent: true });
  }

  if (action === "broadcast") {
    if (role !== "admin") return json({ error: "Admin only" }, 401);
    const title = String(body.title || "").trim().slice(0, 80);
    const text = String(body.body || "").trim().slice(0, 180);
    if (!title) return json({ error: "Missing title" }, 400);
    const index = await readIndex(kv);
    let sent = 0;
    for (const entry of index) {
      const raw = await kv.get(`push:sub:${entry.id}`);
      if (!raw) continue;
      try {
        const status = await sendPush(kv, JSON.parse(raw).subscription, { title, body: text, url: "/" });
        if (status === 404 || status === 410) await removeSubscription(kv, entry.id);
        else if (status >= 200 && status < 300) sent++;
      } catch (_e) {}
    }
    return json({ ok: true, sent });
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
