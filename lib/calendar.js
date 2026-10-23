// Reads calendar feeds (the "Export Band Calendars" link from BAND, or any iCal/.ics link)
// and turns them into a simple list of upcoming events.
//
// KV:  calendars            → [{ id, name, url, audience: "everyone" | "leaders" }]   (admin only; the link is private)
//      cal-cache:<id>       → { at, events: [...], error? }                           (refreshed every 30 minutes)

const TZ = "America/New_York";
const CACHE_MS = 30 * 60 * 1000;
const DAY = 864e5;

/* ── ICS parsing ── */
function unfold(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}
function unescapeText(v) {
  return String(v || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}
function parseLine(line) {
  // NAME;PARAM=a;PARAM2="b:c":value
  let i = 0, inQ = false;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ":" && !inQ) break;
  }
  const head = line.slice(0, i), value = line.slice(i + 1);
  const [name, ...ps] = head.split(";");
  const params = {};
  for (const p of ps) { const k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params, value };
}

const pad = n => String(n).padStart(2, "0");
// Wall-clock time in Eastern, as "YYYY-MM-DDTHH:MM"
function utcToET(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
// Offset (ms) of a time zone at a given instant
function tzOffset(tz, ms) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(ms)).map(p => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ms;
  } catch (_e) { return null; }
}
// Parse a DATE or DATE-TIME property → { ms (UTC instant), allDay, local "YYYY-MM-DD[THH:MM]" in Eastern }
function parseWhen(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d || prop.params.VALUE === "DATE") {
    const m = d || /^(\d{4})(\d{2})(\d{2})/.exec(v);
    if (!m) return null;
    return { allDay: true, ms: Date.UTC(+m[1], +m[2] - 1, +m[3], 12), local: `${m[1]}-${m[2]}-${m[3]}` };
  }
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!t) return null;
  const naive = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +(t[6] || 0));
  let ms;
  if (t[7]) ms = naive;
  else {
    const tz = prop.params.TZID || TZ;
    let off = tzOffset(tz, naive); if (off === null) off = tzOffset(TZ, naive);
    ms = naive - off;
    const off2 = tzOffset(tz, ms); if (off2 !== null && off2 !== off) ms = naive - off2; // around DST changes
  }
  return { allDay: false, ms, local: utcToET(ms) };
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
// Expand a repeating event into the instants that fall in [from, to]. Covers the common BAND patterns.
function expand(start, rruleText, exdates, from, to) {
  const out = [];
  if (!rruleText) { out.push(start.ms); return out; }
  const r = Object.fromEntries(rruleText.split(";").map(x => x.split("=")).map(([k, v]) => [String(k).toUpperCase(), v]));
  const freq = r.FREQ, interval = Math.max(1, Number(r.INTERVAL) || 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  let until = Infinity;
  if (r.UNTIL) { const u = parseWhen({ value: r.UNTIL, params: {} }); if (u) until = u.allDay ? u.ms + DAY : u.ms; }
  const byDay = r.BYDAY ? r.BYDAY.split(",").map(x => WD[x.slice(-2)]).filter(x => x !== undefined) : null;
  const ex = new Set(exdates);
  let n = 0;
  const push = ms => {
    if (ms < start.ms) return true;
    if (ms > until || n >= count) return false;
    n++;
    if (ms >= from && ms <= to && !ex.has(ms)) out.push(ms);
    return true;
  };
  // Step through using the event's Eastern wall-clock time so the hour stays put across DST
  const base = new Date(start.ms);
  const step = (k) => {
    if (freq === "DAILY") return start.ms + k * interval * DAY;
    if (freq === "WEEKLY") return start.ms + k * interval * 7 * DAY;
    if (freq === "MONTHLY") { const d = new Date(base); d.setUTCMonth(d.getUTCMonth() + k * interval); return d.getUTCDate() === base.getUTCDate() ? d.getTime() : null; }
    if (freq === "YEARLY") { const d = new Date(base); d.setUTCFullYear(d.getUTCFullYear() + k * interval); return d.getTime(); }
    return undefined;
  };
  const fixDst = ms => start.allDay ? ms : ms - ((tzOffset(TZ, ms) || 0) - (tzOffset(TZ, start.ms) || 0));
  for (let k = 0; k < 2000; k++) {
    const s = step(k);
    if (s === undefined) { out.push(start.ms); break; }
    if (s === null) continue;
    if (s > to && s > until) break;
    if (freq === "WEEKLY" && byDay && byDay.length) {
      // every listed weekday in this week
      const etDay = start.allDay ? new Date(s).getUTCDay() : new Date(utcToET(s).slice(0, 10) + "T12:00:00Z").getUTCDay();
      const weekStart = s - etDay * DAY;
      let keepGoing = true;
      for (const wd of byDay.slice().sort()) { if (!push(fixDst(weekStart + wd * DAY))) { keepGoing = false; break; } }
      if (!keepGoing) break;
    } else if (!push(fixDst(s))) break;
    if (s > to) break;
  }
  return out;
}

export function parseICS(text, { from = Date.now() - DAY, to = Date.now() + 120 * DAY } = {}) {
  const lines = unfold(text);
  const events = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; depth = 0; continue; }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) { depth++; continue; }       // e.g. VALARM inside the event
    if (line.startsWith("END:") && line !== "END:VEVENT") { depth--; continue; }
    if (line === "END:VEVENT") {
      const start = parseWhen(cur.DTSTART);
      if (start && !(cur.STATUS && /CANCELLED/i.test(cur.STATUS.value))) {
        let end = parseWhen(cur.DTEND);
        const dur = end ? end.ms - start.ms : (start.allDay ? DAY : 0);
        const exdates = (cur.EXDATE || []).flatMap(p => p.value.split(",").map(v => parseWhen({ value: v, params: p.params })).filter(Boolean).map(x => x.ms));
        const title = unescapeText(cur.SUMMARY && cur.SUMMARY.value) || "Event";
        const location = unescapeText(cur.LOCATION && cur.LOCATION.value);
        const desc = unescapeText(cur.DESCRIPTION && cur.DESCRIPTION.value).slice(0, 500);
        const uid = (cur.UID && cur.UID.value) || title + start.ms;
        for (const ms of expand(start, cur.RRULE && cur.RRULE.value, exdates, from - dur, to)) {
          if (ms + dur < from) continue;
          const s = start.allDay ? { allDay: true, local: new Date(ms).toISOString().slice(0, 10) } : { allDay: false, local: utcToET(ms) };
          // all-day DTEND is the day after the last day
          const e = start.allDay ? new Date(ms + Math.max(DAY, dur) - DAY).toISOString().slice(0, 10) : utcToET(ms + dur);
          events.push({ id: `${uid}@${ms}`.slice(0, 120), title: title.slice(0, 140), start: s.local, end: e, allDay: s.allDay, location: location.slice(0, 160), desc, ts: ms });
        }
      }
      cur = null; continue;
    }
    if (depth > 0) continue;
    const p = parseLine(line);
    if (p.name === "EXDATE") (cur.EXDATE = cur.EXDATE || []).push(p);
    else if (!cur[p.name]) cur[p.name] = p;
  }
  // Drop exact duplicates (same title and start)
  const seen = new Set();
  return events.sort((a, b) => a.ts - b.ts).filter(e => { const k = e.title + e.start; if (seen.has(k)) return false; seen.add(k); return true; });
}

/* ── Feeds ── */
export async function loadCalendars(kv) {
  try { const l = JSON.parse((await kv.get("calendars")) || "[]"); return Array.isArray(l) ? l : []; } catch (_e) { return []; }
}

export function cleanFeedUrl(u) {
  let s = String(u || "").trim();
  if (s.startsWith("webcal://")) s = "https://" + s.slice(9);
  try { const x = new URL(s); if (x.protocol !== "https:" && x.protocol !== "http:") return null; return x.toString(); } catch (_e) { return null; }
}

export async function fetchFeed(url) {
  let res;
  try { res = await fetch(url, { headers: { "Accept": "text/calendar, text/plain, */*", "User-Agent": "LetsPray-Calendar/1.0" }, redirect: "follow" }); }
  catch (_e) { throw new Error("Couldn’t reach that link. Check that it’s copied in full."); }
  if (!res.ok) throw new Error(`The calendar link answered with ${res.status}.`);
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("That link didn’t return a calendar. Copy the link from BAND’s “Export Band Calendars”.");
  return text.slice(0, 2_000_000);
}

// Upcoming events for one feed, using a 30-minute cache. force=true refreshes now.
export async function feedEvents(kv, cal, { force = false } = {}) {
  const key = `cal-cache:${cal.id}`;
  let cache = null;
  try { cache = JSON.parse((await kv.get(key)) || "null"); } catch (_e) {}
  if (!force && cache && Date.now() - cache.at < CACHE_MS && cache.url === cal.url) return cache;
  try {
    const events = parseICS(await fetchFeed(cal.url)).slice(0, 300);
    const fresh = { at: Date.now(), url: cal.url, events };
    await kv.put(key, JSON.stringify(fresh));
    return fresh;
  } catch (e) {
    // keep showing the last good copy if BAND is briefly unreachable
    const fallback = cache && cache.url === cal.url ? { ...cache, error: String(e.message || e) } : { at: Date.now(), url: cal.url, events: [], error: String(e.message || e) };
    if (!cache || cache.url !== cal.url) await kv.put(key, JSON.stringify(fallback));
    return fallback;
  }
}
