// One Church Software → Let's Pray: finds students who checked in to IMPACT and aren't on the roster yet,
// and puts each one in the admin Inbox to approve and place in small groups.
//
// The API key lives only in the Cloudflare secret ONE_CHURCH_API_KEY (never in KV, code or the browser).
// KV:  onechurch        → { tenant, events: [{ id, name }], lastSync, lastResult }
//      onechurch:seen   → [personId, …]   people already added, linked or dismissed (so they aren't offered again)
//
// One Church's reference documents the request parameters but not the response shapes, so the readers below
// accept the common field spellings and the Test screen reports which field names actually came back.

import { readSubmissions } from "./inbox.js";

export const DEFAULT_TENANT = "livinghopefindlay";
export const DEFAULT_EVENT_NAME = "IMPACT"; // the check-in event on Living Hope's One Church calendar
const LOOKBACK_DAYS = 7;

export async function loadConfig(kv) {
  try { return { tenant: DEFAULT_TENANT, eventName: DEFAULT_EVENT_NAME, events: [], ...(JSON.parse((await kv.get("onechurch")) || "{}") || {}) }; } catch (_e) { return { tenant: DEFAULT_TENANT, eventName: DEFAULT_EVENT_NAME, events: [] }; }
}
export async function saveConfig(kv, cfg) { await kv.put("onechurch", JSON.stringify(cfg)); }
export async function loadSeen(kv) { try { const l = JSON.parse((await kv.get("onechurch:seen")) || "[]"); return Array.isArray(l) ? l.map(String) : []; } catch (_e) { return []; } }
export async function addSeen(kv, ids) {
  const seen = new Set(await loadSeen(kv));
  ids.forEach(id => id && seen.add(String(id)));
  await kv.put("onechurch:seen", JSON.stringify([...seen].slice(-5000)));
}

const cleanTenant = t => String(t || DEFAULT_TENANT).toLowerCase().replace(/^https?:\/\//, "").replace(/\.onechurchsoftware\.com.*$/, "").replace(/[^a-z0-9-]/g, "") || DEFAULT_TENANT;

export async function ocFetch(env, tenant, path, params = {}) {
  const key = env.ONE_CHURCH_API_KEY;
  if (!key) { const e = new Error("The One Church key isn’t set up yet. Add ONE_CHURCH_API_KEY as a secret in Cloudflare."); e.code = "nokey"; throw e; }
  const url = new URL(`https://${cleanTenant(tenant)}.onechurchsoftware.com/api${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url.toString(), { headers: { "Ocs-Api-Key": String(key).trim(), "Accept": "application/json", "User-Agent": "LetsPray-IMPACT/1.0 (Cloudflare Pages)" } });
  if (!res.ok) {
    // One Church's own explanation (an error message, never personal data), to show on the Test screen
    let said = "";
    try { said = (await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240); } catch (_e) {}
    const area = path.split("/")[1] || path;
    const e = new Error(
      res.status === 401 ? "One Church didn’t accept the key. Make sure the Cloudflare secret has the whole key (no spaces) and redeploy." :
      res.status === 403 ? `One Church said the key isn’t allowed to read ${area}.` :
      `One Church answered ${res.status} for ${path}.`);
    e.code = res.status === 401 ? "auth" : res.status === 403 ? "perm" : "http";
    e.status = res.status; e.path = path; e.said = said;
    throw e;
  }
  return res.json();
}

/* ── Reading One Church records (tolerant of field spellings) ── */
export const listOf = d => Array.isArray(d) ? d : (d && (d.data || d.items || d.results || d.records || d.value || d.logs || d.events || d.people)) || [];
const pick = (o, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o); if (v !== undefined && v !== null && v !== "") return v; } return undefined; };
export const eventId = e => pick(e, "id", "eventId", "event.id");
export const eventName = e => String(pick(e, "name", "title", "eventName", "event.name") || "Event");
const logPersonId = l => pick(l, "personId", "person.id", "attendee.personId", "attendee.person.id", "profileId", "person");
const logTime = l => pick(l, "checkInTime", "checkedInAt", "checkIn", "in", "inTime", "timeIn", "createdAt", "date", "dateTime");
const logEvent = l => pick(l, "eventName", "event.name", "eventTitle");

function personName(p) {
  const first = pick(p, "preferredName", "nickname", "nickName", "goesBy", "firstName", "first_name", "name.first");
  const last = pick(p, "lastName", "last_name", "name.last");
  if (first || last) return [first, last].filter(Boolean).join(" ").trim();
  return String(pick(p, "fullName", "displayName", "name") || "").trim();
}
function personBirthday(p) {
  const v = pick(p, "birthdate", "birthDate", "birthday", "dateOfBirth", "dob");
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? `${m[2]}-${m[3]}` : ""; // month and day only; the year is never stored
}
function schoolYearEnd(now = new Date()) { return now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear(); }
function personGrade(p) {
  let g = pick(p, "grade", "gradeLevel", "schoolGrade", "currentGrade", "grade.name", "grade.value");
  if (g && typeof g === "object") g = pick(g, "name", "value", "label");
  if (g !== undefined) {
    const n = parseInt(String(g).replace(/[^0-9]/g, ""), 10);
    if (n >= 5 && n <= 12) return n;
  }
  const gy = parseInt(pick(p, "graduationYear", "gradYear", "classOf", "graduatingClass"), 10);
  if (gy > 2000) { const n = 12 - (gy - schoolYearEnd()); if (n >= 5 && n <= 12) return n; }
  return null;
}
const keysOf = o => (o && typeof o === "object" ? Object.keys(o).slice(0, 40) : []);

const ymdET = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/* ── Test: can we reach One Church, and which check-in events exist? ── */
export async function testConnection(env, cfg) {
  // Each step is checked on its own so the screen shows exactly which permission (if any) is missing
  const steps = [];
  const step = async (label, need, fn) => {
    try { const v = await fn(); steps.push({ label, ok: true }); return v; }
    catch (e) { steps.push({ label, ok: false, status: e.status || null, need, said: e.said || e.message }); if (e.code === "auth" || e.code === "nokey") throw Object.assign(e, { steps }); return null; }
  };
  const out = { ok: false, steps };
  const today = new Date();
  try {
    const me = await step("Church account", "(optional)", () => ocFetch(env, cfg.tenant, "/accounts/me"));
    out.account = String(pick(me || {}, "name", "churchName", "organization.name", "account.name") || "Living Hope (One Church)");
    const evRes = await step("Events", "Events: read", () => ocFetch(env, cfg.tenant, "/events", { trackAttendance: true, "date.start": ymdET(today.getTime() - 21 * 864e5), "date.end": ymdET(today.getTime() + 14 * 864e5), limit: 200 }));
    const evs = listOf(evRes);
    const byName = new Map();
    for (const e of evs) { const id = eventId(e); if (id && !byName.has(eventName(e))) byName.set(eventName(e), { id: String(id), name: eventName(e), parentId: pick(e, "parentId", "parent.id", "seriesId") || null }); }
    out.events = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 80);
    out.eventFields = keysOf(evs[0]);
    out.suggested = evRes ? (await step("Find the IMPACT event", "Events: read", () => findEventsByName(env, cfg))) || [] : [];
    const chosen = (cfg.events || [])[0] || (out.suggested || [])[0];
    if (chosen) {
      // Field names only (never values) from one recent check-in and person, so the reader can be adjusted if needed
      const logs = listOf(await step("Check-in logs", "Events: Full Read (check-in logs)", () => ocFetch(env, cfg.tenant, "/checkin/logs", { event: chosen.id, "in.start": ymdET(today.getTime() - 35 * 864e5), "in.end": ymdET(today), limit: 1 })));
      out.logFields = keysOf(logs[0]);
      let pid = logs[0] && logPersonId(logs[0]);
      if (pid && typeof pid === "object") pid = pid.id;
      if (pid) out.personFields = keysOf(await step("People profiles", "People: read (People Directory)", () => ocFetch(env, cfg.tenant, `/people/${pid}`)));
    }
  } catch (e) { out.error = e.message; return out; }
  out.ok = steps.filter(s => s.label !== "Church account").every(s => s.ok);
  return out;
}

/* ── Sync: new check-ins → Inbox cards ── */
// Finds the check-in event(s) named exactly like cfg.eventName ("IMPACT"); falls back to names that start with it
export async function findEventsByName(env, cfg) {
  const want = String(cfg.eventName || DEFAULT_EVENT_NAME).trim().toLowerCase();
  const evs = listOf(await ocFetch(env, cfg.tenant, "/events", { name: cfg.eventName || DEFAULT_EVENT_NAME, trackAttendance: true, limit: 100 }));
  const all = evs.map(e => ({ id: String(eventId(e)), name: eventName(e), parentId: pick(e, "parentId", "parent.id", "seriesId") }));
  const exact = all.filter(e => e.name.trim().toLowerCase() === want);
  const starts = all.filter(e => e.name.trim().toLowerCase().startsWith(want));
  const list = (exact.length ? exact : starts);
  // Prefer the series parent when the search returns individual occurrences
  const byParent = list.filter(e => !e.parentId);
  const chosen = (byParent.length ? byParent : list).slice(0, 3);
  return chosen.map(e => ({ id: e.parentId && !byParent.length ? String(e.parentId) : e.id, name: e.name }));
}

// Step 1: who checked in between `since` and today? Queues anyone new (people are looked up in step 2).
// One Church is read in a handful of requests here, so this stays well inside Cloudflare's per-request limits.
async function collect(env, cfg, since) {
  const kv = env.INTERCEDE_KV;
  const now = Date.now();
  const start = ymdET(since), end = ymdET(now);

  let calls = 0;
  const get = async (path, params) => { calls++; return ocFetch(env, cfg.tenant, path, params); };
  const want = String(cfg.eventName || DEFAULT_EVENT_NAME).trim().toLowerCase();
  const isImpact = n => String(n || "").trim().toLowerCase() === want || cfg.events.some(e => String(e.name || "").trim().toLowerCase() === String(n || "").trim().toLowerCase());

  // Event IDs to read: the chosen event(s), their occurrences in the window (a repeating event),
  // and every event named "IMPACT" in the window (when each Sunday is its own event)
  const ids = new Set(cfg.events.map(e => String(e.id)));
  for (const e of cfg.events) {
    try {
      const occ = listOf(await get("/events", { event: e.id, "date.start": start, "date.end": end, limit: 200 }));
      occ.forEach(o => eventId(o) && ids.add(String(eventId(o))));
    } catch (_e) { /* not a repeating event; the event itself is enough */ }
  }
  try {
    const named = listOf(await get("/events", { name: cfg.eventName || DEFAULT_EVENT_NAME, "date.start": start, "date.end": end, limit: 200 }));
    named.filter(e => isImpact(eventName(e))).forEach(e => eventId(e) && ids.add(String(eventId(e))));
  } catch (_e) {}

  // Everyone who came during the window: first visit and how many different days they came
  const found = new Map();
  const note = (pid, when, evName) => {
    if (pid && typeof pid === "object") pid = pid.id;
    if (!pid) return false;
    const t = Date.parse(when || "") || NaN;
    if (!isNaN(t) && (t < since - 864e5 || t > now + 864e5)) return false; // outside the window
    const at = isNaN(t) ? now : t;
    const key = String(pid);
    const prev = found.get(key) || { at, event: evName || cfg.events[0].name, days: [] };
    if (at < prev.at) prev.at = at;
    const day = ymdET(at);
    if (!prev.days.includes(day)) prev.days.push(day);
    found.set(key, prev);
    return true;
  };
  const diag = { events: ids.size, logs: 0, attendance: 0, fallback: 0 };
  const evNameOf = id => (cfg.events.find(e => String(e.id) === id) || cfg.events[0]).name;

  // 1. Check-in station logs for each IMPACT event
  for (const id of ids) {
    for (let skip = 0; skip < 2000; skip += 200) {
      let logs = [];
      try { logs = listOf(await get("/checkin/logs", { event: id, "in.start": start, "in.end": end, limit: 200, skip })); } catch (e) { if (e.code === "auth") throw e; break; }
      logs.forEach(l => { if (note(logPersonId(l), logTime(l), logEvent(l) || evNameOf(id))) diag.logs++; });
      if (logs.length < 200) break;
    }
  }
  // 2. Attendance marked on the event (taken by a leader instead of a check-in station)
  if (!found.size) {
    for (const id of ids) {
      try {
        const att = listOf(await get(`/events/${id}/attendance`, { "date.start": start, "date.end": end, limit: 500 }));
        att.forEach(a => {
          const present = pick(a, "present", "attended", "isPresent", "checkedIn");
          if (present === false) return;
          if (note(pick(a, "personId", "person.id", "person", "attendee.personId", "profileId"), pick(a, "date", "occurrenceDate", "checkInTime", "attendedAt", "start", "startDate"), evNameOf(id))) diag.attendance++;
        });
      } catch (e) { if (e.code === "auth") throw e; }
    }
  }
  // 3. Last resort: every check-in in the window, keeping only ones labeled with the IMPACT event
  if (!found.size) {
    for (let skip = 0; skip < 1000; skip += 200) {
      let logs = [];
      try { logs = listOf(await get("/checkin/logs", { "in.start": start, "in.end": end, limit: 200, skip })); } catch (e) { if (e.code === "auth") throw e; break; }
      logs.forEach(l => {
        const evId = String(pick(l, "eventId", "event.id", "event") || "");
        if ((evId && ids.has(evId)) || isImpact(logEvent(l))) { if (note(logPersonId(l), logTime(l), logEvent(l))) diag.fallback++; }
      });
      if (logs.length < 200) break;
    }
  }

  // Skip people already on the roster, already in the Inbox, already handled, or already waiting in the queue
  let roster = [];
  try { roster = JSON.parse((await kv.get("people")) || "[]"); } catch (_e) {}
  const onRoster = new Set(roster.filter(p => p.ocId).map(p => String(p.ocId)));
  const inInbox = new Set((await readSubmissions(kv)).filter(s => s.kind === "checkin" && s.ocId).map(s => String(s.ocId)));
  const seen = new Set(await loadSeen(kv));
  const queue = await loadQueue(kv);
  const queued = new Set(queue.map(q => q.pid));
  const fresh = [...found.entries()]
    .filter(([pid]) => !onRoster.has(pid) && !inInbox.has(pid) && !seen.has(pid) && !queued.has(pid))
    .sort((a, b) => a[1].at - b[1].at)
    .map(([pid, v]) => ({ pid, at: v.at, event: v.event, visits: v.days.length }));
  await saveQueue(kv, [...queue, ...fresh]);
  return { checkedIn: found.size, queued: fresh.length, window: `${start} to ${end}`, calls, diag };
}

async function loadQueue(kv) { try { const l = JSON.parse((await kv.get("onechurch:queue")) || "[]"); return Array.isArray(l) ? l : []; } catch (_e) { return []; } }
async function saveQueue(kv, q) { await kv.put("onechurch:queue", JSON.stringify(q.slice(0, 2000))); }

// Step 2: look up the next batch of queued people and put each in the Inbox
export async function processQueue(env, { addSubmission }, max = 25) {
  const kv = env.INTERCEDE_KV;
  const cfg = await loadConfig(kv);
  const queue = await loadQueue(kv);
  let roster = [];
  try { roster = JSON.parse((await kv.get("people")) || "[]"); } catch (_e) {}
  const norm = n => String(n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  let added = 0, done = 0;
  for (const q of queue.slice(0, max)) {
    let person = {};
    try { person = await ocFetch(env, cfg.tenant, `/people/${q.pid}`); } catch (e) { if (e.code === "auth" || e.code === "nokey") throw e; }
    const name = personName(person) || "New student";
    const sameName = roster.filter(p => p.active !== false && norm(p.name) === norm(name));
    const r = await addSubmission(kv, {
      kind: "checkin", name, ocId: q.pid, grade: personGrade(person), birthday: personBirthday(person),
      checkin: { at: q.at, event: q.event, visits: q.visits || 1, matchId: sameName.length === 1 ? sameName[0].id : null },
    });
    if (!r.ok) break; // Inbox full: the rest stay queued
    added++; done++;
  }
  const rest = queue.slice(done);
  await saveQueue(kv, rest);
  return { added, remaining: rest.length };
}

// Weekly check (7 days back), or the one-time import with `since` (e.g. September 1)
export async function syncCheckins(env, deps, { since } = {}) {
  const kv = env.INTERCEDE_KV;
  let cfg = await loadConfig(kv);
  if (!cfg.events || !cfg.events.length) {
    const found = await findEventsByName(env, cfg);
    if (!found.length) return { ok: false, error: `Couldn’t find a check-in event named “${cfg.eventName || DEFAULT_EVENT_NAME}” in One Church. Use Settings → Test connection to pick it.` };
    cfg = { ...cfg, events: found };
    await saveConfig(kv, cfg);
  }
  const now = Date.now();
  const from = since || now - LOOKBACK_DAYS * 864e5;
  const c = await collect(env, cfg, from);
  const p = await processQueue(env, deps, Math.max(0, 45 - c.calls - 2));
  const result = { ok: true, at: now, ...c, added: p.added, remaining: p.remaining };
  await saveConfig(kv, { ...(await loadConfig(kv)), lastSync: now, lastResult: result, ...(since ? { importedSince: ymdET(since), importedAt: now } : {}) });
  return result;
}
