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

  // Teaching series: { name, weeks: [{ id, date: "YYYY-MM-DD", title, verseRef, verseText, prayerPrompt, parentPrompt }] }
  if (key === "series") {
    if (request.method === "GET") {
      const data = await env.INTERCEDE_KV.get("series");
      return new Response(data || "null", { headers });
    }
    if (request.method === "POST") {
      try {
        const sr = JSON.parse(await request.text());
        const clip = (v, n) => String(v || "").trim().slice(0, n);
        const clean = sr === null ? null : {
          name: clip(sr.name, 80),
          art: Number(sr.art) || 0,                      // version stamp of the uploaded series artwork (0 = none)
          book: clip(sr.book, 80),
          weeks: (Array.isArray(sr.weeks) ? sr.weeks : []).slice(0, 60)
            .filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.date || "")))
            .map(w => ({
              id: clip(w.id, 40) || Math.random().toString(36).slice(2),
              date: w.date,
              title: clip(w.title, 120),
              verseRef: clip(w.verseRef, 80),
              verseText: clip(w.verseText, 1200),
              memoryRef: clip(w.memoryRef, 80),           // memory verse for the week
              memoryText: clip(w.memoryText, 800),
              prayerPrompt: clip(w.prayerPrompt, 600),
              parentPrompt: clip(w.parentPrompt, 2000),   // ASK: questions, one per line
              parentThink: clip(w.parentThink, 3000),     // THINK: the big idea for parents
              parentPray: clip(w.parentPray, 2000),       // PRAY: one line per thing to pray for their student
              // Daily devos that follow the lesson: day 1 = Monday after the Sunday message … 6 = Saturday
              devos: (Array.isArray(w.devos) ? w.devos : []).slice(0, 7).map(d => ({
                id: clip(d.id, 40) || Math.random().toString(36).slice(2),
                day: Math.min(6, Math.max(1, Math.round(Number(d.day) || 1))),
                title: clip(d.title, 120),
                ref: clip(d.ref, 80),
                passage: clip(d.passage, 2500),
                reflect: clip(d.reflect, 3000),
                respond: clip(d.respond, 1000),
                pray: clip(d.pray, 1000),
              })).filter(d => d.title || d.ref || d.reflect).sort((a, b) => a.day - b.day),
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
        await env.INTERCEDE_KV.put("series", JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, series: clean }), { headers });
      } catch (_e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers });
      }
    }
  }

  // Event prayer focus: [{ id, name, start, end, focus, prayerPoints, attendees: [personId] }]
  // Students and parents see the name, dates, focus and how many are going; leaders see who.
  if (key === "events") {
    const role = ctxData && ctxData.session ? ctxData.session.role : null;
    if (request.method === "GET") {
      let list = [];
      try { list = JSON.parse((await env.INTERCEDE_KV.get("events")) || "[]"); } catch (_e) {}
      if (role !== "team" && role !== "admin") list = list.map(({ attendees, ...e }) => ({ ...e, going: (attendees || []).length }));
      return new Response(JSON.stringify(list), { headers });
    }
    if (request.method === "POST") {
      try {
        const raw = JSON.parse(await request.text());
        if (!Array.isArray(raw)) throw new Error("not array");
        const clip = (v, n) => String(v || "").trim().slice(0, n);
        const day = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? v : null;
        const clean = raw.slice(0, 20).map(e => ({
          id: clip(e.id, 40) || Math.random().toString(36).slice(2),
          name: clip(e.name, 80),
          start: day(e.start),
          end: day(e.end) || day(e.start),
          focus: clip(e.focus, 1500),
          prayerPoints: clip(e.prayerPoints, 2000),
          link: /^https:\/\/[^\s]+$/i.test(String(e.link || "").trim()) ? String(e.link).trim().slice(0, 500) : "", // registration form
          attendees: (Array.isArray(e.attendees) ? e.attendees : []).map(x => clip(x, 40)).filter(Boolean).slice(0, 500),
        })).filter(e => e.name && e.start);
        await env.INTERCEDE_KV.put("events", JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, events: clean }), { headers });
      } catch (_e) {
        return new Response(JSON.stringify({ error: "Invalid events" }), { status: 400, headers });
      }
    }
  }

  // Leader devotional: { id, title, body, verseRef, author, at }
  if (key === "devotional") {
    if (request.method === "GET") {
      const data = await env.INTERCEDE_KV.get("devotional");
      return new Response(data || "null", { headers });
    }
    if (request.method === "POST") {
      try {
        const d = JSON.parse(await request.text());
        const clip = (v, n) => String(v || "").trim().slice(0, n);
        const clean = d === null ? null : {
          id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          title: clip(d.title, 120),
          body: clip(d.body, 5000),
          verseRef: clip(d.verseRef, 80),
          author: clip(d.author, 60),
          at: Date.now(),
        };
        if (clean && !clean.title && !clean.body) throw new Error("empty");
        await env.INTERCEDE_KV.put("devotional", JSON.stringify(clean));
        return new Response(JSON.stringify({ ok: true, devotional: clean }), { headers });
      } catch (_e) {
        return new Response(JSON.stringify({ error: "Add a title or a note." }), { status: 400, headers });
      }
    }
  }

  // Team goals: { weeklyPct, gospelGoal, convGoal }
  if (key === "goals") {
    if (request.method === "GET") {
      const data = await env.INTERCEDE_KV.get("goals");
      return new Response(data || JSON.stringify({ weeklyPct: 100, gospelGoal: 0, convGoal: 0 }), { headers });
    }
    if (request.method === "POST") {
      try {
        const g = JSON.parse(await request.text());
        const clean = {
          weeklyPct: Math.min(100, Math.max(10, Math.round(Number(g.weeklyPct) || 100))),
          gospelGoal: Math.min(10000, Math.max(0, Math.round(Number(g.gospelGoal) || 0))),
          convGoal: Math.min(10000, Math.max(0, Math.round(Number(g.convGoal) || 0))), // Gospel conversations per month
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
