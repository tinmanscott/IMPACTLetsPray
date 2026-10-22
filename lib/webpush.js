// Minimal Web Push (VAPID + aes128gcm) for Cloudflare Workers / Pages Functions.
// Keys are created automatically the first time they're needed and kept in KV,
// so there are no secrets to paste into the Cloudflare dashboard.

const enc = new TextEncoder();

function b64url(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function concat(...arrays) {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}

/* ── VAPID keys (stored in KV as "push:vapid") ── */
export async function getVapidKeys(kv) {
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
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud, exp, sub: subject })));
  const input = `${header}.${claims}`;
  const key = await crypto.subtle.importKey("jwk", { ...keys.jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(input));
  return `vapid t=${input}.${b64url(sig)}, k=${keys.publicKey}`;
}

/* ── RFC 8291 payload encryption ── */
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

// Returns the HTTP status from the push service. 404/410 mean the subscription is gone.
export async function sendPush(kv, subscription, message, subject = "mailto:admin@example.com") {
  const keys = await getVapidKeys(kv);
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(keys, subscription.endpoint, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "43200",
      Urgency: "normal",
    },
    body: await encryptPayload(JSON.stringify(message), subscription),
  });
  return res.status;
}

/* ── Subscription storage ──
   push:index      → [{ id, time: "HH:MM", tz }]
   push:sub:<id>   → { subscription, time, tz, lastSeen }            */
export async function subscriptionId(endpoint) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(endpoint));
  return b64url(digest).slice(0, 22);
}

export async function readIndex(kv) {
  try { return JSON.parse((await kv.get("push:index")) || "[]"); } catch (_e) { return []; }
}

export async function removeSubscription(kv, id) {
  const index = await readIndex(kv);
  await kv.put("push:index", JSON.stringify(index.filter(e => e.id !== id)));
  await kv.delete(`push:sub:${id}`);
}

export function localParts(tz, date = new Date()) {
  let zone = tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); } catch (_e) { zone = "America/New_York"; }
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

// Monday 00:00 Eastern, as a UTC timestamp (matches the app's weekly reset)
export function weekStartET(now = new Date()) {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const offset = now.getTime() - et.getTime();
  const day = et.getDay();
  et.setDate(et.getDate() - (day === 0 ? 6 : day - 1));
  et.setHours(0, 0, 0, 0);
  return et.getTime() + offset;
}
