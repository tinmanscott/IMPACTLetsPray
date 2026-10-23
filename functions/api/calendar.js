// Calendar from BAND (or any iCal link).
//
// GET  /api/calendar                       → { events: [{ id, title, start, end, allDay, location, desc, cal, calName }], updated }
//      (anyone signed in; "leaders only" calendars are left out for students and parents)
// GET  /api/calendar?action=feeds          → admin: [{ id, name, url, audience }]
// POST /api/calendar { action: "save", feeds: [...] }  → admin: save the calendar links
// POST /api/calendar { action: "test", url }           → admin: check a link and count upcoming events
// POST /api/calendar { action: "refresh" }             → admin: pull the newest events now
import { json } from "../../lib/auth.js";
import { loadCalendars, cleanFeedUrl, feedEvents, parseICS, fetchFeed } from "../../lib/calendar.js";

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const kv = env.INTERCEDE_KV;
  const role = ctx && ctx.session ? ctx.session.role : null;
  const isLeader = role === "team" || role === "admin";
  const url = new URL(request.url);

  if (request.method === "GET") {
    if (url.searchParams.get("action") === "feeds") {
      if (role !== "admin") return json({ error: "Admin only" }, 401);
      return json(await loadCalendars(kv));
    }
    const cals = (await loadCalendars(kv)).filter(c => isLeader || c.audience !== "leaders");
    const results = await Promise.all(cals.map(c => feedEvents(kv, c).then(r => ({ c, r }))));
    const events = results.flatMap(({ c, r }) => (r.events || []).map(e => ({ ...e, cal: c.id, calName: c.name, leadersOnly: c.audience === "leaders" })))
      .filter(e => e.ts + (e.allDay ? 864e5 : 3 * 36e5) >= Date.now() - 864e5)
      .sort((a, b) => a.ts - b.ts)
      .slice(0, 200);
    const updated = results.length ? Math.min(...results.map(x => x.r.at || Date.now())) : null;
    const errors = role === "admin" ? results.filter(x => x.r.error).map(x => ({ cal: x.c.name, error: x.r.error })) : undefined;
    return json({ events, updated, configured: cals.length > 0, errors });
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (role !== "admin") return json({ error: "Admin only" }, 401);
  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  if (body.action === "test") {
    const link = cleanFeedUrl(body.url);
    if (!link) return json({ error: "That doesn’t look like a web link." }, 400);
    try {
      const events = parseICS(await fetchFeed(link));
      return json({ ok: true, count: events.length, next: events.slice(0, 3).map(e => ({ title: e.title, start: e.start, allDay: e.allDay })) });
    } catch (e) { return json({ error: String(e.message || e) }, 400); }
  }

  if (body.action === "save") {
    const feeds = (Array.isArray(body.feeds) ? body.feeds : []).slice(0, 6).map(f => ({
      id: String(f.id || "").slice(0, 40) || Math.random().toString(36).slice(2, 10),
      name: String(f.name || "").trim().slice(0, 60) || "Calendar",
      url: cleanFeedUrl(f.url),
      audience: f.audience === "leaders" ? "leaders" : "everyone",
    })).filter(f => f.url);
    await kv.put("calendars", JSON.stringify(feeds));
    return json({ ok: true, feeds });
  }

  if (body.action === "refresh") {
    const cals = await loadCalendars(kv);
    const r = await Promise.all(cals.map(c => feedEvents(kv, c, { force: true })));
    return json({ ok: true, counts: r.map((x, i) => ({ cal: cals[i].name, count: (x.events || []).length, error: x.error })) });
  }
  return json({ error: "Unknown action" }, 400);
}
