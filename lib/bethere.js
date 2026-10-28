// Be There events, stored in the same KV as Let's Pray (Firebase is no longer used).
//
// KV:  bt:events  → [{ id, student, eventName, dateStr, time, location, link, notes, level,
//                      adminHighlight, adminNote, cheers, ownerId, createdAt, updatedAt }]
//      bt:config  → { groupName }
// Everyone signed in (student code, parent code, leader code, admin) can see and post events.
// Only the device that posted an event, or an admin, can edit or delete it.

export async function loadEvents(kv) {
  try { const l = JSON.parse((await kv.get("bt:events")) || "[]"); return Array.isArray(l) ? l : []; } catch (_e) { return []; }
}
export async function saveEvents(kv, list) {
  // Keep upcoming events and the last 13 months of past ones
  const cutoff = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10);
  const kept = list.filter(e => (e.dateStr || "") >= cutoff).sort((a, b) => (a.dateStr || "").localeCompare(b.dateStr || "")).slice(-3000);
  await kv.put("bt:events", JSON.stringify(kept));
  return kept;
}
export async function loadConfig(kv) {
  try { return { groupName: "IMPACT Students", ...(JSON.parse((await kv.get("bt:config")) || "{}") || {}) }; } catch (_e) { return { groupName: "IMPACT Students" }; }
}

const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

// Same checks as Be There's old Firebase rules
export function cleanEvent(d, { isAdmin = false } = {}) {
  const eventName = str(d.eventName, 200);
  const dateStr = str(d.dateStr, 10);
  const level = d.level === "hs" || d.level === "ms" ? d.level : "";
  if (!eventName) return { error: "Add the event name." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: "Pick a date." };
  if (!level) return { error: "Pick MS or HS." };
  const link = str(d.link, 500);
  const ev = {
    student: str(d.student, 100),
    eventName, dateStr, level,
    time: /^\d{2}:\d{2}$/.test(str(d.time, 5)) ? str(d.time, 5) : "",
    location: str(d.location, 200),
    link: !link || /^https?:\/\//i.test(link) ? link : "",
    notes: str(d.notes, 1000),
  };
  if (isAdmin) {
    if ("adminHighlight" in d) ev.adminHighlight = d.adminHighlight === true;
    if ("adminNote" in d) ev.adminNote = str(d.adminNote, 300);
  }
  return { event: ev };
}

export const canEdit = (ev, { isAdmin, deviceId }) => isAdmin || (!!deviceId && ev.ownerId === deviceId);

// One-time copy from Be There's old Firebase database (readable without sign-in until its rules are locked)
export async function importFromFirebase(env, key) {
  const project = "impact-students-events";
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/events?pageSize=300&key=${encodeURIComponent(key)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { "Referer": "https://impactbethere.app/" } });
    if (!res.ok) throw new Error(`Firebase answered ${res.status}. If you already locked its rules, the import has to happen before that.`);
    const d = await res.json();
    for (const doc of d.documents || []) {
      const f = doc.fields || {};
      const v = x => !x ? undefined : "stringValue" in x ? x.stringValue : "booleanValue" in x ? x.booleanValue : "integerValue" in x ? Number(x.integerValue) : "doubleValue" in x ? x.doubleValue : "timestampValue" in x ? x.timestampValue : undefined;
      const raw = Object.fromEntries(Object.keys(f).map(k => [k, v(f[k])]));
      const c = cleanEvent(raw, { isAdmin: true });
      if (!c.event) continue;
      out.push({ id: String(doc.name || "").split("/").pop() || newId(), ...c.event, cheers: Math.max(0, Number(raw.cheers) || 0), ownerId: str(raw.ownerId, 60), createdAt: Date.parse(raw.createdAt || "") || Date.now(), updatedAt: Date.now() });
    }
    pageToken = d.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}
