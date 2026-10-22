// Runs before every /api/* request and blocks anyone without the right access.
import { getSession, json } from "../../lib/auth.js";

function requiredRole(path, url, method) {
  if (path === "/api/auth") return "public";
  if (path === "/api/data" && url.searchParams.get("key") === "goals") return method === "GET" ? "team" : "admin";
  if (path === "/api/data") {
    const key = url.searchParams.get("key") || "people";
    if (key === "settings") return method === "GET" ? "public" : "admin";
    if (key === "smallgroups" && method !== "GET") return "admin";
    return "team"; // people: view + mark prayed (deletes are checked again in data.js)
  }
  if (path === "/api/photo") return method === "GET" ? "team" : "admin";
  if (path === "/api/submit") return method === "GET" ? "public" : "student";
  if (path === "/api/inbox") return "admin";
  return "team"; // history, push, anything new: logged-in leaders only
}

export async function onRequest(context) {
  const { request, env, next, data } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!env.INTERCEDE_KV) return json({ error: "KV namespace not bound" }, 500);

  const url = new URL(request.url);
  const need = requiredRole(url.pathname, url, request.method);
  if (need === "public") return next();

  const session = await getSession(request, env);
  data.session = session;
  const ok = need === "admin" ? session.role === "admin"
    : need === "student" ? !!session.role // students, leaders and admins can all submit
    : session.role === "admin" || session.role === "team";
  if (!ok) return json({ error: "Not signed in", need }, 401);

  const res = await next();
  // Nothing behind a login should be cached by shared caches
  if (url.pathname !== "/api/photo") {
    const r = new Response(res.body, res);
    r.headers.set("Cache-Control", "no-store");
    return r;
  }
  return res;
}
