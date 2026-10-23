// GENERATED from push-worker/src.js (npm run build:worker). Paste this whole file into your Cloudflare Worker.

// lib/webpush.js
var enc = new TextEncoder();
function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) {
    out.set(a, i);
    i += a.length;
  }
  return out;
}
async function getVapidKeys(kv) {
  const raw = await kv.get("push:vapid");
  if (raw) return JSON.parse(raw);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const keys = { publicKey: b64url(pub), jwk: { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y } };
  await kv.put("push:vapid", JSON.stringify(keys));
  return keys;
}
async function vapidAuthHeader(keys, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1e3) + 12 * 60 * 60;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp, sub: subject })));
  const input = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", { ...keys.jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input));
  return `vapid t=${input}.${b64url(sig)}, k=${keys.publicKey}`;
}
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}
async function encryptPayload(payload, subscription) {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const body = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, body));
  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}
async function sendPush(kv, subscription, message, subject = "mailto:admin@example.com") {
  const keys = await getVapidKeys(kv);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(keys, subscription.endpoint, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "43200",
      Urgency: "normal"
    },
    body: await encryptPayload(JSON.stringify(message), subscription)
  });
  return res.status;
}
async function readIndex(kv) {
  try {
    return JSON.parse(await kv.get("push:index") || "[]");
  } catch (_e) {
    return [];
  }
}
async function removeSubscription(kv, id) {
  const index = await readIndex(kv);
  await kv.put("push:index", JSON.stringify(index.filter((e) => e.id !== id)));
  await kv.delete(`push:sub:${id}`);
}
function localParts(tz, date = /* @__PURE__ */ new Date()) {
  let zone = tz;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch (_e) {
    zone = "America/New_York";
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}
function weekStartET(now = /* @__PURE__ */ new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - et.getTime();
  const day = et.getDay();
  et.setDate(et.getDate() - (day === 0 ? 6 : day - 1));
  et.setHours(0, 0, 0, 0);
  return et.getTime() + offset;
}

// push-worker/src.js
function bucket({ hour, minute }) {
  return `${String(hour).padStart(2, "0")}:${String(Math.floor(minute / 15) * 15).padStart(2, "0")}`;
}
async function buildMessage(kv) {
  const settings = JSON.parse(await kv.get("settings") || "{}");
  let remaining = null;
  try {
    const people = JSON.parse(await kv.get("people") || "[]").filter((p) => p.active !== false);
    const start = weekStartET();
    remaining = people.filter((p) => !(p.prayedAt && p.prayedAt >= start)).length;
  } catch (_e) {
  }
  const body = remaining === null ? "Take a few minutes to pray for your students today \u{1F64F}" : remaining === 0 ? "Everyone has been prayed for this week. Keep it going \u{1F64F}" : `${remaining} ${remaining === 1 ? "person still needs" : "people still need"} prayer this week. Take a few minutes today \u{1F64F}`;
  let verse = "";
  try {
    const series = JSON.parse(await kv.get("series") || "null");
    const today = (/* @__PURE__ */ new Date()).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const week = series && (series.weeks || []).filter((w) => w.date <= today).pop();
    if (week && week.memoryRef) verse = ` Memory verse: ${week.memoryRef}.`;
    else if (week && week.verseRef) verse = ` This week: ${week.verseRef}.`;
  } catch (_e) {
  }
  return { title: settings.name || "Let\u2019s Pray", body: body + verse, url: "/" };
}
async function sendDueReminders(env, now = /* @__PURE__ */ new Date()) {
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
      if (status === 404 || status === 410) {
        await removeSubscription(kv, entry.id);
        continue;
      }
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
var src_default = {
  async scheduled(event, env, ctx) {
    if (!env.INTERCEDE_KV) {
      console.log("INTERCEDE_KV is not bound to this Worker");
      return;
    }
    ctx.waitUntil(sendDueReminders(env, new Date(event.scheduledTime)));
  },
  async fetch() {
    return new Response("Let's Pray reminder worker is running. Reminders are sent on a schedule.", { headers: { "Content-Type": "text/plain" } });
  }
};
export {
  src_default as default,
  sendDueReminders
};
