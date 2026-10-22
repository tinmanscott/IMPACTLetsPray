// Shared auth helpers for the Pages Functions.
//
// Three levels of access:
//   student — knows the student code: can only send prayer requests / CAUSE names for approval
//   team    — leaders who know the team code: can view the roster and pray
//   admin   — knows the admin password: can also manage people, groups, photos, settings
//
// Passwords are stored only as salted PBKDF2 hashes. Sessions are signed
// HttpOnly cookies, so nothing secret is ever sent to the browser.

export const TEAM_COOKIE = "lp_team";
export const ADMIN_COOKIE = "lp_admin";
export const STUDENT_COOKIE = "lp_student";
export const STUDENT_TTL = 180 * 24 * 60 * 60; // 180 days
export const TEAM_TTL = 90 * 24 * 60 * 60;   // 90 days, in seconds
export const ADMIN_TTL = 24 * 60 * 60;       // 24 hours

const enc = new TextEncoder();

export function b64url(bytes) {
  let s = "";
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ── Password hashing ── */
export async function hashSecret(secret, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(String(secret)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  return { salt: b64url(salt), hash: b64url(bits) };
}

export async function verifySecret(secret, stored) {
  if (!stored || !stored.salt || !stored.hash || !secret) return false;
  const { hash } = await hashSecret(secret, stored.salt);
  return safeEqual(hash, stored.hash);
}

/* ── Settings ── */
// Loads settings and upgrades a legacy plain-text password to a hash on first sight.
export async function loadSettings(env) {
  const raw = await env.INTERCEDE_KV.get("settings");
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (_e) { return null; }
  if (!s || typeof s !== "object") return null;
  if (s.password && !s.adminHash) {
    s.adminHash = await hashSecret(s.password);
    delete s.password;
    s.adminVer = s.adminVer || 1;
    s.teamVer = s.teamVer || 1;
    await env.INTERCEDE_KV.put("settings", JSON.stringify(s));
  }
  return s;
}

export async function saveSettings(env, s) {
  const clean = { ...s };
  delete clean.password;
  await env.INTERCEDE_KV.put("settings", JSON.stringify(clean));
}

export function publicSettings(s) {
  if (!s) return null;
  return { name: s.name || "", sub: s.sub || "", teamCodeSet: !!s.teamHash, studentCodeSet: !!s.studentHash, configured: true };
}

/* ── Signed cookies ── */
async function getSigningKey(env) {
  let secret = await env.INTERCEDE_KV.get("auth:secret");
  if (!secret) {
    secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await env.INTERCEDE_KV.put("auth:secret", secret);
  }
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, payload) {
  const key = await getSigningKey(env);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function makeToken(env, role, ver, ttl) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${role}.${exp}.${ver}`;
  return `${payload}.${await sign(env, payload)}`;
}

async function checkToken(env, token, role, ver) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [r, exp, v, sig] = parts;
  if (r !== role || String(v) !== String(ver)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  return safeEqual(sig, await sign(env, `${r}.${exp}.${v}`));
}

export function readCookies(request) {
  const out = {};
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

// Returns { role: "admin" | "team" | null, settings }
export async function getSession(request, env) {
  const settings = await loadSettings(env);
  if (!settings) return { role: null, settings: null };
  const c = readCookies(request);
  if (await checkToken(env, c[ADMIN_COOKIE], "admin", settings.adminVer || 1)) return { role: "admin", settings };
  if (settings.teamHash && await checkToken(env, c[TEAM_COOKIE], "team", settings.teamVer || 1)) return { role: "team", settings };
  if (settings.studentHash && await checkToken(env, c[STUDENT_COOKIE], "student", settings.studentVer || 1)) return { role: "student", settings };
  return { role: null, settings };
}

export function json(obj, status = 200, extraHeaders = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store" });
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else headers.set(k, v);
  }
  return new Response(JSON.stringify(obj), { status, headers });
}
