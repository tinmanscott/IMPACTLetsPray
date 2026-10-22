import { loadSettings, publicSettings } from "../../lib/auth.js";

export async function onRequest(context) {
  const { request, env, data: ctxData } = context;
  const role = ctxData && ctxData.session ? ctxData.session.role : null;

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  if (request.method === "OPTIONS") return new Response(null, { headers });

  if (!env.INTERCEDE_KV) {
    return new Response(JSON.stringify({ error: "KV namespace not bound" }), { status: 500, headers });
  }

  const url = new URL(request.url);
  const key = url.searchParams.get("key") || "people";

  // Settings: only the public parts (name, subtitle). Passwords never leave the server.
  // Changes go through /api/auth.
  if (key === "settings") {
    if (request.method === "GET") {
      return new Response(JSON.stringify(publicSettings(await loadSettings(env))), { headers });
    }
    return new Response(JSON.stringify({ error: "Use /api/auth to change settings" }), { status: 403, headers });
  }

  // Team goals: { weeklyPct, gospelGoal }
  if (key === "goals") {
    if (request.method === "GET") {
      const data = await env.INTERCEDE_KV.get("goals");
      return new Response(data || JSON.stringify({ weeklyPct: 100, gospelGoal: 0 }), { headers });
    }
    if (request.method === "POST") {
      try {
        const g = JSON.parse(await request.text());
        const clean = {
          weeklyPct: Math.min(100, Math.max(10, Math.round(Number(g.weeklyPct) || 100))),
          gospelGoal: Math.min(10000, Math.max(0, Math.round(Number(g.gospelGoal) || 0))),
        };
        await env.INTERCEDE_KV.put("goals", JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, ...clean }), { headers });
      } catch (_e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
      }
    }
  }

  // Small groups endpoint: [{ id, name }]
  if (key === "smallgroups") {
    if (request.method === "GET") {
      const data = await env.INTERCEDE_KV.get("smallgroups");
      return new Response(data || "[]", { headers });
    }
    if (request.method === "POST") {
      try {
        const parsed = JSON.parse(await request.text());
        if (!Array.isArray(parsed)) throw new Error("not array");
        const clean = parsed
          .filter(g => g && typeof g.id === "string" && typeof g.name === "string" && g.name.trim())
          .map(g => ({ id: g.id.slice(0, 40), name: g.name.trim().slice(0, 60) }));
        await env.INTERCEDE_KV.put("smallgroups", JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, count: clean.length }), { headers });
      } catch (_e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
      }
    }
  }

  // People endpoint (default)
  if (request.method === "GET") {
    const data = await env.INTERCEDE_KV.get("people");
    return new Response(data || "[]", { headers });
  }

  if (request.method === "POST") {
    const body = await request.text();
    let incoming, force;
    try {
      const parsed = JSON.parse(body);
      if (Array.isArray(parsed)) {
        incoming = parsed;
        force = false;
      } else {
        incoming = parsed.data;
        force = parsed.force === true;
      }
      if (!Array.isArray(incoming)) throw new Error("not array");
    } catch (_e) {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
    }

    if (incoming.length === 0) {
      return new Response(JSON.stringify({ error: "Refusing to store empty data" }), { status: 400, headers });
    }

    if (force) {
      // A forced save can delete people, so only admins may do it
      if (role !== "admin") {
        return new Response(JSON.stringify({ error: "Admin sign-in required" }), { status: 401, headers });
      }
      await env.INTERCEDE_KV.put("people", JSON.stringify(incoming));
      return new Response(JSON.stringify({ ok: true, count: incoming.length, forced: true }), { headers });
    }

    let stored = [];
    try {
      const raw = await env.INTERCEDE_KV.get("people");
      if (raw) stored = JSON.parse(raw);
      if (!Array.isArray(stored)) stored = [];
    } catch (_e) { stored = []; }

    const storedMap = Object.fromEntries(stored.map(p => [p.id, p]));
    const incomingIds = new Set(incoming.map(p => p.id));

    const merged = incoming.map(p => {
      const s = storedMap[p.id];
      if (!s) return p;
      return (p.updatedAt || 0) >= (s.updatedAt || 0) ? p : s;
    });

    for (const s of stored) {
      if (!incomingIds.has(s.id)) merged.push(s);
    }

    await env.INTERCEDE_KV.put("people", JSON.stringify(merged));
    return new Response(JSON.stringify({ ok: true, count: merged.length }), { headers });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
}
