// Sign-in, sign-out, first-time setup, and admin settings.
//
// GET  /api/auth                       → { configured, role, leaderName?, name, sub, studentCodeSet, parentCodeSet }
// POST /api/auth { action: "setup", name, sub, password }   (only before setup)
// POST /api/auth { action: "login", code }     admin password → admin; a leader's own code → that leader;
//                                              student code → student; parent code → parent
// POST /api/auth { action: "logout", scope: "admin" | "all" }
// POST /api/auth { action: "update", name?, sub?, studentCode?, parentCode?, newPassword?, currentPassword? }  (admin)
// Leader codes are managed in /api/leaders.
import {
  getSession, loadSettings, saveSettings, publicSettings, hashSecret, verifySecret, shortName,
  makeToken, makeLeaderToken, cookieHeader, json, findLeaderByCode, loadLeaders, saveLeaders,
  TEAM_COOKIE, ADMIN_COOKIE, TEAM_TTL, ADMIN_TTL, STUDENT_COOKIE, STUDENT_TTL, PARENT_COOKIE, PARENT_TTL,
} from "../../lib/auth.js";
import { logEvent } from "../../lib/audit.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sessionCookies(env, settings, role, leader) {
  if (role === "parent") return [cookieHeader(PARENT_COOKIE, await makeToken(env, "parent", settings.parentVer || 1, PARENT_TTL), PARENT_TTL), cookieHeader(STUDENT_COOKIE, "", 0)];
  if (role === "student") return [cookieHeader(STUDENT_COOKIE, await makeToken(env, "student", settings.studentVer || 1, STUDENT_TTL), STUDENT_TTL), cookieHeader(PARENT_COOKIE, "", 0)];
  if (role === "team") return [cookieHeader(TEAM_COOKIE, await makeLeaderToken(env, leader, TEAM_TTL), TEAM_TTL)];
  return [cookieHeader(ADMIN_COOKIE, await makeToken(env, "admin", settings.adminVer || 1, ADMIN_TTL), ADMIN_TTL)];
}

async function status(env, settings, role, leader) {
  if (!settings) return { configured: false, teamCodeSet: false, role: null, name: "", sub: "" };
  const active = (await loadLeaders(env)).filter(l => !l.revokedAt).length;
  return { ...publicSettings(settings), teamCodeSet: active > 0, role, leaderName: leader ? shortName(leader.name) : null };
}

// Slow down code guessing from one network: 25 wrong codes an hour, then wait
async function failKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("lp-login:" + ip))).slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join("");
  return `rl:login:${h}:${Math.floor(Date.now() / 36e5)}`;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    const { role, settings, leader } = await getSession(request, env);
    return json(await status(env, settings, role, leader));
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
  const action = body && body.action;

  /* First-time setup */
  if (action === "setup") {
    if (await loadSettings(env)) return json({ error: "Already set up" }, 409);
    const name = String(body.name || "").trim().slice(0, 80);
    const password = String(body.password || "");
    if (!name) return json({ error: "Please enter your ministry name." }, 400);
    if (password.length < 8) return json({ error: "Admin password must be at least 8 characters." }, 400);
    const settings = {
      name, sub: String(body.sub || "").trim().slice(0, 60),
      adminHash: await hashSecret(password), adminVer: 1,
    };
    await saveSettings(env, settings);
    await logEvent(env, request, { event: "signin", role: "admin", name: "Admin (setup)" });
    return json(await status(env, settings, "admin"), 200, { "Set-Cookie": await sessionCookies(env, settings, "admin") });
  }

  /* Sign in */
  if (action === "login") {
    const settings = await loadSettings(env);
    if (!settings) return json({ error: "Not set up yet" }, 409);
    const fk = await failKey(request);
    const fails = Number(await env.INTERCEDE_KV.get(fk)) || 0;
    if (fails >= 25) return json({ error: "Too many tries. Please wait an hour and try again." }, 429);

    const code = String(body.code || "").trim();
    if (await verifySecret(code, settings.adminHash)) {
      await logEvent(env, request, { event: "signin", role: "admin", name: "Admin" });
      return json(await status(env, settings, "admin"), 200, { "Set-Cookie": await sessionCookies(env, settings, "admin") });
    }
    const leader = await findLeaderByCode(env, code);
    if (leader) {
      const list = await loadLeaders(env);
      await saveLeaders(env, list.map(l => l.id === leader.id ? { ...l, lastSignIn: Date.now() } : l));
      await logEvent(env, request, { event: "signin", role: "team", name: leader.name });
      return json(await status(env, settings, "team", leader), 200, { "Set-Cookie": await sessionCookies(env, settings, "team", leader) });
    }
    if (settings.studentHash && await verifySecret(code, settings.studentHash)) {
      await logEvent(env, request, { event: "signin", role: "student" });
      return json(await status(env, settings, "student"), 200, { "Set-Cookie": await sessionCookies(env, settings, "student") });
    }
    if (settings.parentHash && await verifySecret(code, settings.parentHash)) {
      await logEvent(env, request, { event: "signin", role: "parent" });
      return json(await status(env, settings, "parent"), 200, { "Set-Cookie": await sessionCookies(env, settings, "parent") });
    }
    await env.INTERCEDE_KV.put(fk, String(fails + 1), { expirationTtl: 7200 });
    await logEvent(env, request, { event: "signin-failed", ok: false });
    await sleep(700); // slow down guessing
    return json({ error: "That code didn’t work." }, 401);
  }

  /* Sign out */
  if (action === "logout") {
    const cookies = [cookieHeader(ADMIN_COOKIE, "", 0)];
    if (body.scope === "all") cookies.push(cookieHeader(TEAM_COOKIE, "", 0), cookieHeader(STUDENT_COOKIE, "", 0), cookieHeader(PARENT_COOKIE, "", 0));
    const { settings } = await getSession(new Request(request.url), env);
    return json(await status(env, settings, null), 200, { "Set-Cookie": cookies });
  }

  /* Admin: change name, student/parent codes, or admin password */
  if (action === "update") {
    const { role, settings } = await getSession(request, env);
    if (role !== "admin") return json({ error: "Admin sign-in required" }, 401);
    const next = { ...settings };
    delete next.teamHash; delete next.teamVer; // the old shared team code is retired
    if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim().slice(0, 80);
    if (typeof body.sub === "string") next.sub = body.sub.trim().slice(0, 60);

    const clashes = async (code, others) => (await verifySecret(code, settings.adminHash)) || !!(await findLeaderByCode(env, code)) || (await Promise.all(others.filter(Boolean).map(h => verifySecret(code, h)))).some(Boolean);

    if (typeof body.studentCode === "string" && body.studentCode) {
      const code = body.studentCode;
      if (code.length < 4) return json({ error: "Student code must be at least 4 characters." }, 400);
      if (await clashes(code, [settings.parentHash])) return json({ error: "Student code must be different from the parent code, leader codes and admin password." }, 400);
      next.studentHash = await hashSecret(code);
      next.studentVer = (settings.studentVer || 1) + 1;
    }
    if (body.studentCode === null) { delete next.studentHash; next.studentVer = (settings.studentVer || 1) + 1; }

    if (typeof body.parentCode === "string" && body.parentCode) {
      const code = body.parentCode;
      if (code.length < 4) return json({ error: "Parent code must be at least 4 characters." }, 400);
      if (await clashes(code, [next.studentHash])) return json({ error: "Parent code must be different from the student code, leader codes and admin password." }, 400);
      next.parentHash = await hashSecret(code);
      next.parentVer = (settings.parentVer || 1) + 1;
    }
    if (body.parentCode === null) { delete next.parentHash; next.parentVer = (settings.parentVer || 1) + 1; }

    let rotatedAdmin = false;
    if (typeof body.newPassword === "string" && body.newPassword) {
      if (!(await verifySecret(String(body.currentPassword || ""), settings.adminHash))) return json({ error: "Current admin password is incorrect." }, 401);
      if (body.newPassword.length < 8) return json({ error: "Admin password must be at least 8 characters." }, 400);
      next.adminHash = await hashSecret(body.newPassword);
      next.adminVer = (settings.adminVer || 1) + 1;
      rotatedAdmin = true;
    }

    await saveSettings(env, next);
    const cookies = rotatedAdmin ? await sessionCookies(env, next, "admin") : [];
    return json(await status(env, next, "admin"), 200, cookies.length ? { "Set-Cookie": cookies } : {});
  }

  return json({ error: "Unknown action" }, 400);
}
