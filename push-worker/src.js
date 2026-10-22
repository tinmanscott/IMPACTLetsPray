// Scheduled Worker that sends the daily "time to pray" reminders.
// Cloudflare Pages can't run on a schedule, so this small Worker does it,
// sharing the same KV namespace (bound as INTERCEDE_KV) as the app.
//
// Runs every 15 minutes (cron: */15 * * * *). Each leader picks a reminder
// time in the app; if they haven't opened the app yet that day, they get a nudge.
//
// Edit this file, then run `npm run build:worker` to regenerate worker.js
// (worker.js is the single file you paste into the Cloudflare dashboard).
import { sendPush, readIndex, removeSubscription, localParts, weekStartET } from "../lib/webpush.js";

function bucket({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 15) * 15).padStart(2, "0")}`;
}

async function buildMessage(kv) {
  const settings = JSON.parse((await kv.get("settings")) || "{}");
  let remaining = null;
  try {
    const people = JSON.parse((await kv.get("people")) || "[]").filter(p => p.active !== false);
    const start = weekStartET();
    remaining = people.filter(p => !(p.prayedAt && p.prayedAt >= start)).length;
  } catch (_e) {}
  const body = remaining === null
    ? "Take a few minutes to pray for your students today 🙏"
    : remaining === 0
      ? "Everyone has been prayed for this week. Keep it going 🙏"
      : `${remaining} ${remaining === 1 ? "person still needs" : "people still need"} prayer this week. Take a few minutes today 🙏`;
  return { title: settings.name || "Let’s Pray", body, url: "/" };
}

export async function sendDueReminders(env, now = new Date()) {
  const kv = env.INTERCEDE_KV;
  const index = await readIndex(kv);
  let message = null;
  let sent = 0;

  for (const entry of index) {
    const local = localParts(entry.tz, now);
    if (bucket(local) !== entry.time) continue;

    const raw = await kv.get(`push:sub:${entry.id}`);
    if (!raw) continue;
    const rec = JSON.parse(raw);
    if (rec.lastSeen === local.day || rec.lastSent === local.day) continue;

    message = message || await buildMessage(kv);
    try {
      const status = await sendPush(kv, rec.subscription, message, env.PUSH_CONTACT || "mailto:admin@example.com");
      if (status === 404 || status === 410) { await removeSubscription(kv, entry.id); continue; }
      if (status >= 200 && status < 300) {
        rec.lastSent = local.day;
        await kv.put(`push:sub:${entry.id}`, JSON.stringify(rec));
        sent++;
      } else {
        console.log(`Push ${entry.id} failed: HTTP ${status}`);
      }
    } catch (e) {
      console.log(`Push ${entry.id} error: ${e.message}`);
    }
  }
  console.log(`Checked ${index.length} subscription(s), sent ${sent}`);
  return sent;
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.INTERCEDE_KV) { console.log("INTERCEDE_KV is not bound to this Worker"); return; }
    ctx.waitUntil(sendDueReminders(env, new Date(event.scheduledTime)));
  },
  async fetch() {
    return new Response("Let's Pray reminder worker is running. Reminders are sent on a schedule.", { headers: { "Content-Type": "text/plain" } });
  },
};
