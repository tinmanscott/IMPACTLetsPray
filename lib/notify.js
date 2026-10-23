// Sends one push notification to one device, at most once per day per "topic".
// Used for "someone prayed for you" so students get a nudge, not a flood.
import { sendPush, removeSubscription } from "./webpush.js";

export async function notifyOnce(kv, subId, topic, message) {
  if (!subId) return false;
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const key = `notified:${topic}:${day}`;
  if (await kv.get(key)) return false;
  const raw = await kv.get(`push:sub:${subId}`);
  if (!raw) return false;
  const rec = JSON.parse(raw);
  await kv.put(key, "1", { expirationTtl: 2 * 24 * 60 * 60 });
  try {
    const status = await sendPush(kv, rec.subscription, message);
    if (status === 404 || status === 410) await removeSubscription(kv, subId);
    return status >= 200 && status < 300;
  } catch (_e) { return false; }
}
