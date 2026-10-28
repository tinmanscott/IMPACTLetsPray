// Upcoming events from the Be There app (impactbethere.app), read-only.
//
// GET /api/bethere → { events: [{ id, students, eventName, dateStr, time, location, link, notes, level, highlight, cheers }], updated }
//   Anyone signed in (students with the student code, parents, leaders). Names come back as first name + last initial.
//
// Be There keeps its events in Firebase (project impact-students-events, collection "events"), readable without
// signing in. Its web key is public (every visitor's browser gets it), so it's fine here. Results are cached 5 minutes.
import { json, shortName } from "../../lib/auth.js";

const PROJECT = "impact-students-events";
const PUBLIC_WEB_KEY = "AIzaSyA46PUgkaianFMuPmPundeJO6yFJhCDbvk";
const CACHE_MS = 5 * 60 * 1000;

const ymdET = d => new Date(d).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
function val(v) {
  if (!v || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(val);
  return undefined;
}
// "Ava Nguyen, Lily Anderson & Emma Collins" → "Ava N., Lily A. & Emma C."
const shortNames = s => String(s || "").split(/(\s*(?:,|&|\band\b|\+|\/)\s*)/i).map((part, i) => i % 2 ? part : shortName(part)).join("").trim();
const safeLink = u => /^https?:\/\/\S+$/i.test(String(u || "").trim()) ? String(u).trim().slice(0, 500) : "";

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const kv = env.INTERCEDE_KV;
  try {
    const cached = JSON.parse((await kv.get("bethere:cache")) || "null");
    if (cached && Date.now() - cached.at < CACHE_MS) return json({ events: cached.events, updated: cached.at });
  } catch (_e) {}

  const today = ymdET(Date.now());
  const key = env.BE_THERE_FIREBASE_KEY || PUBLIC_WEB_KEY;
  const res = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:runQuery?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: "events" }],
      where: { fieldFilter: { field: { fieldPath: "dateStr" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: today } } },
      orderBy: [{ field: { fieldPath: "dateStr" }, direction: "ASCENDING" }],
      limit: 300,
    } }),
  }).catch(() => null);
  if (!res || !res.ok) {
    let stale = null;
    try { stale = JSON.parse((await kv.get("bethere:cache")) || "null"); } catch (_e) {}
    if (stale) return json({ events: stale.events, updated: stale.at, stale: true });
    return json({ error: "Couldn’t reach Be There right now.", events: [] }, 200);
  }
  const rows = await res.json();
  const events = (Array.isArray(rows) ? rows : []).filter(r => r.document).map(r => {
    const f = r.document.fields || {};
    const g = k => val(f[k]);
    return {
      id: String(r.document.name || "").split("/").pop(),
      students: shortNames(g("student")).slice(0, 200),
      eventName: String(g("eventName") || "Event").slice(0, 140),
      dateStr: String(g("dateStr") || ""),
      time: /^\d{2}:\d{2}$/.test(String(g("time") || "")) ? g("time") : "",
      location: String(g("location") || "").slice(0, 160),
      link: safeLink(g("link")),
      notes: String(g("notes") || "").slice(0, 400),
      level: g("level") === "ms" || g("level") === "hs" ? g("level") : "",
      highlight: g("adminHighlight") === true,
      cheers: Math.max(0, Number(g("cheers")) || 0),
    };
  }).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.dateStr));
  const at = Date.now();
  await kv.put("bethere:cache", JSON.stringify({ at, events }));
  return json({ events, updated: at });
}
