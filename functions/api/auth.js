// Sign-in, sign-out, first-time setup, and admin settings.
//
// GET  /api/auth                       → { configured, teamCodeSet, role, name, sub }
// POST /api/auth { action: "setup", name, sub, password, teamCode }   (only before setup)
// POST /api/auth { action: "login", code }     admin password → admin; team code → leader; student code → student
// POST /api/auth { action: "logout", scope: "admin" | "all" }
// POST /api/auth { action: "update", name?, sub?, teamCode?, newPassword?, currentPassword? }  (admin)
import {
  getSession, loadSettings, saveSettings, publicSettings, hashSecret, verifySecret,
  makeToken, cookieHeader, json, TEAM_COOKIE, ADMIN_COOKIE, TEAM_TTL, ADMIN_TTL, STUDENT_COOKIE, STUDENT_TTL, PARENT_COOKIE, PARENT_TTL,
} from "../../lib/auth.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sessionCookies(env, settings, role) {
  if (role === "parent") return [cookieHeader(PARENT_COOKIE, await makeToken(env, "parent", settings.parentVer || 1, PARENT_TTL), PARENT_TTL), cookieHeader(STUDENT_COOKIE, "", 0)];
  if (role === "student") return [cookieHeader(STUDENT_COOKIE, await makeToken(env, "student", settings.studentVer || 1, STUDENT_TTL), STUDENT_TTL), cookieHeader(PARENT_COOKIE, "", 0)];
  const cookies = [cookieHeader(TEAM_COOKIE, await makeToken(env, "team", settings.teamVer || 1, TEAM_TTL), TEAM_TTL)];
  if (role === "admin") cookies.push(cookieHeader(ADMIN_COOKIE, await makeToken(env, "admin", settings.adminVer || 1, ADMIN_TTL), ADMIN_TTL));
  return cookies;
}

function status(settings, role) {
  if (!settings) return { configured: false, teamCodeSet: false, role: null, name: "", sub: "" };
  return { ...publicSettings(settings), role };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "GET") {
    const { role, settings } = await getSession(request, env);
    return json(status(settings, role));
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
    const teamCode = String(body.teamCode || "");
    if (!name) return json({ error: "Please enter your ministry name." }, 400);
    if (password.length < 6) return json({ error: "Admin password must be at least 6 characters." }, 400);
    if (teamCode.length < 4) return json({ error: "Team code must be at least 4 characters." }, 400);
    if (teamCode === password) return json({ error: "Team code and admin password must be different." }, 400);
    const settings = {
      name, sub: String(body.sub || "").trim().slice(0, 60),
      adminHash: await hashSecret(password), adminVer: 1,
      teamHash: await hashSecret(teamCode), teamVer: 1,
    };
    await saveSettings(env, settings);
    return json(status(settings, "admin"), 200, { "Set-Cookie": await sessionCookies(env, settings, "admin") });
  }

  /* Sign in with the team code or the admin password */
  if (action === "login") {
    const settings = await loadSettings(env);
    if (!settings) return json({ error: "Not set up yet" }, 409);
    const code = String(body.code || "");
    if (await verifySecret(code, settings.adminHash)) {
      return json(status(settings, "admin"), 200, { "Set-Cookie": await sessionCookies(env, settings, "admin") });
    }
    if (settings.teamHash && await verifySecret(code, settings.teamHash)) {
      return json(status(settings, "team"), 200, { "Set-Cookie": await sessionCookies(env, settings, "team") });
    }
    if (settings.studentHash && await verifySecret(code, settings.studentHash)) {
      return json(status(settings, "student"), 200, { "Set-Cookie": await sessionCookies(env, settings, "student") });
    }
    if (settings.parentHash && await verifySecret(code, settings.parentHash)) {
      return json(status(settings, "parent"), 200, { "Set-Cookie": await sessionCookies(env, settings, "parent") });
    }
    await sleep(700); // slow down guessing
    return json({ error: "That code didn’t work." }, 401);
  }

  /* Sign out */
  if (action === "logout") {
    const cookies = [cookieHeader(ADMIN_COOKIE, "", 0)];
    if (body.scope === "all") cookies.push(cookieHeader(TEAM_COOKIE, "", 0), cookieHeader(STUDENT_COOKIE, "", 0), cookieHeader(PARENT_COOKIE, "", 0));
    const { settings } = await getSession(new Request(request.url), env);
    return json(status(settings, body.scope === "all" ? null : "team"), 200, { "Set-Cookie": cookies });
  }

  /* Admin: change name, team code, or admin password */
  if (action === "update") {
    const { role, settings } = await getSession(request, env);
    if (role !== "admin") return json({ error: "Admin sign-in required" }, 401);
    const next = { ...settings };
    if (typeof body.name === "string" && body.name.trim()) next.name = body.name.trim().slice(0, 80);
    if (typeof body.sub === "string") next.sub = body.sub.trim().slice(0, 60);

    if (typeof body.teamCode === "string" && body.teamCode) {
      if (body.teamCode.length < 4) return json({ error: "Team code must be at least 4 characters." }, 400);
      if (await verifySecret(body.teamCode, settings.adminHash)) return json({ error: "Team code must be different from the admin password." }, 400);
      if (settings.studentHash && await verifySecret(body.teamCode, settings.studentHash)) return json({ error: "Team code must be different from the student code." }, 400);
      if (settings.parentHash && await verifySecret(body.teamCode, settings.parentHash)) return json({ error: "Team code must be different from the parent code." }, 400);
      next.teamHash = await hashSecret(body.teamCode);
      next.teamVer = (settings.teamVer || 1) + 1; // signs out everyone using the old code
    }

    if (typeof body.studentCode === "string" && body.studentCode) {
      const code = body.studentCode;
      if (code.length < 4) return json({ error: "Student code must be at least 4 characters." }, 400);
      if (await verifySecret(code, settings.adminHash) || (next.teamHash && await verifySecret(code, next.teamHash)) || (settings.parentHash && await verifySecret(code, settings.parentHash))) {
        return json({ error: "Student code must be different from the team code, parent code and admin password." }, 400);
      }
      next.studentHash = await hashSecret(code);
      next.studentVer = (settings.studentVer || 1) + 1;
    }
    if (body.studentCode === null) { delete next.studentHash; next.studentVer = (settings.studentVer || 1) + 1; }

    if (typeof body.parentCode === "string" && body.parentCode) {
      const code = body.parentCode;
      if (code.length < 4) return json({ error: "Parent code must be at least 4 characters." }, 400);
      if (await verifySecret(code, settings.adminHash) || (next.teamHash && await verifySecret(code, next.teamHash)) || (next.studentHash && await verifySecret(code, next.studentHash))) {
        return json({ error: "Parent code must be different from the team code, student code and admin password." }, 400);
      }
      next.parentHash = await hashSecret(code);
      next.parentVer = (settings.parentVer || 1) + 1;
    }
    if (body.parentCode === null) { delete next.parentHash; next.parentVer = (settings.parentVer || 1) + 1; }

    let rotatedAdmin = false;
    if (typeof body.newPassword === "string" && body.newPassword) {
      if (!(await verifySecret(String(body.currentPassword || ""), settings.adminHash))) return json({ error: "Current admin password is incorrect." }, 401);
      if (body.newPassword.length < 6) return json({ error: "Admin password must be at least 6 characters." }, 400);
      if (next.teamHash && await verifySecret(body.newPassword, next.teamHash)) return json({ error: "Admin password must be different from the team code." }, 400);
      next.adminHash = await hashSecret(body.newPassword);
      next.adminVer = (settings.adminVer || 1) + 1;
      rotatedAdmin = true;
    }

    await saveSettings(env, next);
    // Re-issue this admin's cookies so they stay signed in after a change
    const cookies = (rotatedAdmin || next.teamVer !== settings.teamVer) ? await sessionCookies(env, next, "admin") : [];
    return json(status(next, "admin"), 200, cookies.length ? { "Set-Cookie": cookies } : {});
  }

  return json({ error: "Unknown action" }, 400);
}
