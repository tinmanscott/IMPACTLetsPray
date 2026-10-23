import React, { useState, useEffect, useCallback, useRef } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Heart, Plus, Trash2, Upload, X, RefreshCw, BookOpen, RotateCcw, Cake, BarChart2, Bell, Star, Lightbulb, Camera, Users, Check, Lock, Settings as SettingsIcon, Inbox as InboxIcon, Flame, Target, Send } from "lucide-react";

const STORAGE_KEY = "intercede-people-v2";
// Settings loaded from KV on startup
const SETUP_KEY = "letspray-setup"; // legacy local fallback

const TAP_KEY = "intercede-tap-ts";
const TAP_TTL = 24 * 60 * 60 * 1000;

function shouldShowTap() {
  try {
    const raw = localStorage.getItem(TAP_KEY);
    if (!raw) return true;
    return Date.now() - Number(raw) > TAP_TTL;
  } catch (_e) { return true; }
}

function getBdayDismissKey(personId) {
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
  return `intercede-bday-dismissed-${personId}-${today}`;
}
function isBdayDismissed(personId) {
  try { return !!localStorage.getItem(getBdayDismissKey(personId)); } catch (_e) { return false; }
}
function dismissBday(personId) {
  try { localStorage.setItem(getBdayDismissKey(personId), "1"); } catch (_e) {}
}

function recordTapShown() {
  try { localStorage.setItem(TAP_KEY, String(Date.now())); } catch (_e) {}
}
/* ── Sign-in (sessions are HttpOnly cookies set by /api/auth) ── */
async function apiAuthStatus() {
  const res = await fetch("/api/auth", { cache: "no-store" });
  if (!res.ok) throw new Error("status failed");
  return res.json();
}

async function apiAuth(action, body = {}) {
  const res = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

// If any data call comes back 401 (session expired or code changed), tell the app
if (typeof window !== "undefined" && !window.__lpFetchPatched) {
  window.__lpFetchPatched = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await origFetch(input, init);
    const url = typeof input === "string" ? input : input && input.url;
    if (res.status === 401 && url && url.startsWith("/api/") && !url.startsWith("/api/auth")) {
      window.dispatchEvent(new Event("lp-signed-out"));
    }
    return res;
  };
}

/* ── Push reminders ── */
const PUSH_ID_KEY = "lp-push-id";
const PUSH_TIME_KEY = "lp-push-time";
const PUSH_SEEN_KEY = "lp-push-seen";

function pushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function b64ToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function lsGet(k) { try { return localStorage.getItem(k); } catch (_e) { return null; } }
function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_e) {} }
function localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function enablePush(time) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked. Allow them for this app in your phone’s settings, then try again." : "Notifications weren’t allowed.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const keyRes = await fetch("/api/push");
  if (!keyRes.ok) throw new Error("Couldn’t reach the server.");
  const { publicKey } = await keyRes.json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub.toJSON(), time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Couldn’t save your reminder.");
  lsSet(PUSH_ID_KEY, data.id);
  lsSet(PUSH_TIME_KEY, data.time);
  return data;
}

// Students: subscribe this device so they hear when someone prays for them
const STUDENT_NOTIFY_KEY = "lp-student-notify";
async function enableStudentPush() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "Notifications are blocked for this site. Turn them on in your phone’s settings to use this." : "Notifications weren’t allowed.");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const keyRes = await fetch("/api/push");
  if (!keyRes.ok) throw new Error("Couldn’t reach the server.");
  const { publicKey } = await keyRes.json();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  const res = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON() }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Couldn’t turn on notifications.");
  lsSet(STUDENT_NOTIFY_KEY, data.id);
  return data.id;
}

async function disablePush() {
  const id = lsGet(PUSH_ID_KEY);
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (_e) {}
  if (id) await fetch("/api/push?action=unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  lsSet(PUSH_ID_KEY, null);
  lsSet(PUSH_TIME_KEY, null);
}

// Opening the app counts as praying today, so skip today's reminder
async function markSeenToday() {
  const id = lsGet(PUSH_ID_KEY);
  if (!id || lsGet(PUSH_SEEN_KEY) === localDay()) return;
  try {
    const res = await fetch("/api/push?action=seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const data = await res.json().catch(() => ({}));
    if (data.unknown) { lsSet(PUSH_ID_KEY, null); lsSet(PUSH_TIME_KEY, null); return; }
    lsSet(PUSH_SEEN_KEY, localDay());
  } catch (_e) {}
}

const REMINDER_TIMES = (() => {
  const out = [];
  for (let h = 5; h <= 22; h++) for (const m of [0, 15, 30, 45]) {
    const v = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const label = new Date(2000, 0, 1, h, m).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    out.push([v, label]);
  }
  return out;
})();

async function apiLoad() {
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error("load failed");
  const data = await res.json();
  // Treat an empty array from KV as suspicious — never trust it over local state
  if (!Array.isArray(data)) throw new Error("bad data");
  return data;
}

async function apiSave(people, force = false) {
  if (!people || people.length === 0) return;
  await fetch("/api/data", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(force ? { data: people, force: true } : people),
  });
}



async function apiLoadSmallGroups() {
  try {
    const res = await fetch("/api/data?key=smallgroups");
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (_e) { return []; }
}

async function apiSaveSmallGroups(groups) {
  await fetch("/api/data?key=smallgroups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(groups),
  });
}

/* ── Photos ── */
function photoUrl(p) {
  if (typeof window !== "undefined" && window.__lpPhotoUrl) return window.__lpPhotoUrl(p); // demo preview only
  return p && p.photo ? `/api/photo?id=${encodeURIComponent(p.id)}&v=${p.photo}` : null;
}

// Shrink to a centered square JPEG so uploads are small and cards look consistent
// square = true crops to a centered square (profile photos); false keeps the shape (series artwork)
function resizeImage(file, size = 500, square = true) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      if (square) {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const out = Math.min(size, side);
        canvas.width = out; canvas.height = out;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, out, out);
      } else {
        const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      }
      URL.revokeObjectURL(url);
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("Could not read image")), "image/jpeg", 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

async function apiUploadPhoto(personId, file) {
  const blob = await resizeImage(file);
  const form = new FormData();
  form.append("personId", personId);
  form.append("photo", blob, "photo.jpg");
  const res = await fetch("/api/photo", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
  return data.v;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Could not read image"));
    r.readAsDataURL(blob);
  });
}

function pendingPhotoUrl(submissionId) {
  if (typeof window !== "undefined" && window.__lpPendingPhotoUrl) return window.__lpPendingPhotoUrl(submissionId); // demo preview only
  return `/api/inbox?photo=${encodeURIComponent(submissionId)}`;
}

async function apiDeletePhoto(personId) {
  await fetch(`/api/photo?id=${encodeURIComponent(personId)}`, { method: "DELETE" });
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Avatar({ person, size = 40 }) {
  const [broken, setBroken] = React.useState(false);
  const url = photoUrl(person);
  React.useEffect(() => { setBroken(false); }, [url]);
  const base = { width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover", display: "block" };
  if (url && !broken) {
    return <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} style={{ ...base, background: C.faint }} />;
  }
  return (
    <div style={{ ...base, background: C.faint, border: `1px solid ${C.border}`, color: C.muted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.36), fontWeight: 600, fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.02em" }}>
      {initials(person?.name)}
    </div>
  );
}

/* People can belong to several small groups (e.g. a dGroup and an IMPACT group),
   and leaders can serve both MS and HS (group "both"). Older records used one smallGroupId. */
function sgIds(p) {
  if (!p) return [];
  if (Array.isArray(p.smallGroupIds)) return p.smallGroupIds;
  return p.smallGroupId ? [p.smallGroupId] : [];
}
const inSG = (p, id) => sgIds(p).includes(id);
const inHS = p => p.group === "hs" || p.group === "both";
const inMS = p => p.group === "ms" || p.group === "both";
const groupLabel = g => g === "both" ? "MS & HS" : g ? g.toUpperCase() : "";

// One place for every roster filter, including small groups ("sg:<id>")
function matchesFilter(p, f, events) {
  if (!f || f === "all") return true;
  if (f.startsWith("ev:")) { const ev = (events || []).find(e => e.id === f.slice(3)); return !!ev && (ev.attendees || []).includes(p.id); }
  if (f.startsWith("sg:")) return inSG(p, f.slice(3));
  if (f === "students") return p.type === "student";
  if (f === "leaders") return p.type === "leader";
  if (f === "staff") return !!p.staff;
  if (f === "hs") return inHS(p);
  if (f === "ms") return inMS(p);
  if (f === "hs-students") return p.type === "student" && inHS(p);
  if (f === "ms-students") return p.type === "student" && inMS(p);
  if (f === "hs-leaders") return p.type === "leader" && inHS(p);
  if (f === "ms-leaders") return p.type === "leader" && inMS(p);
  return true;
}

async function apiLoadHistory() {
  const res = await fetch("/api/history");
  if (!res.ok) return [];
  return await res.json();
}

async function apiSaveHistory(history) {
  await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(history),
  });
}

function getWeekLabel(weekStartTs) {
  // Show the Monday date of that week clearly
  const d = new Date(weekStartTs);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
}

// Stable per-person rotation so the card looks the same each load but varies per person

function photoRotation(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  // Range: -6 to +6 degrees
  return ((Math.abs(hash) % 13) - 6);
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getWeekStartET() {
  // Returns UTC timestamp of most recent Monday midnight Eastern Time
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etNow = new Date(etStr);
  const day = etNow.getDay(); // 0=Sun
  const daysFromMon = day === 0 ? 6 : day - 1;
  const monET = new Date(etNow);
  monET.setDate(etNow.getDate() - daysFromMon);
  monET.setHours(0, 0, 0, 0);
  // Offset between real UTC and the "fake local" ET date object
  const utcOffset = now.getTime() - etNow.getTime();
  return monET.getTime() + utcOffset;
}


function getWeekDateStringET() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etNow = new Date(etStr);
  const day = etNow.getDay();
  const daysFromMon = day === 0 ? 6 : day - 1;
  const monET = new Date(etNow);
  monET.setDate(etNow.getDate() - daysFromMon);
  return `${monET.getMonth()+1}/${monET.getDate()}/${monET.getFullYear()}`;
}

function getPrevWeekDateStringET() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etNow = new Date(etStr);
  const day = etNow.getDay();
  const daysFromMon = day === 0 ? 6 : day - 1;
  const monET = new Date(etNow);
  monET.setDate(etNow.getDate() - daysFromMon - 7);
  return `${monET.getMonth()+1}/${monET.getDate()}/${monET.getFullYear()}`;
}

function withinWeek(ts) {
  return ts && ts >= getWeekStartET();
}

function timeAgo(ts) {
  if (!ts) return null;
  // Compare calendar dates (midnight-to-midnight) in Eastern time
  const toETMidnight = t => {
    const etStr = new Date(t).toLocaleDateString("en-US", { timeZone: "America/New_York" });
    return new Date(etStr).getTime();
  };
  const todayMidnight = toETMidnight(Date.now());
  const tsMidnight = toETMidnight(ts);
  const days = Math.round((todayMidnight - tsMidnight) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function ordinal(n) {
  const num = Number(n);
  const s = ["th","st","nd","rd"], v = num % 100;
  return num + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Resolves a MM-DD birthday to a real Date in the given year.
// Feb 29 on a non-leap year falls back to Feb 28.
function birthdayInYear(month, day, year) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const resolvedDay = (month === 2 && day === 29 && !isLeap) ? 28 : day;
  return new Date(year, month - 1, resolvedDay);
}

function getBirthdayStatus(birthday) {
  if (!birthday) return null;
  const today = new Date();
  const [month, day] = birthday.split("-").map(Number);
  if (!month || !day) return null;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let bday = birthdayInYear(month, day, today.getFullYear());
  if (bday < todayMidnight) bday = birthdayInYear(month, day, today.getFullYear() + 1);
  const diff = Math.round((bday - todayMidnight) / 86400000);
  if (diff === 0) return { label: "🎂 Birthday today!", urgent: true, today: true };
  if (diff === 1) return { label: "🎂 Birthday tomorrow!", urgent: true, today: false };
  if (diff <= 7) return { label: `🎂 Birthday in ${diff} days`, urgent: false };
  return null;
}

function formatBirthday(birthday) {
  if (!birthday) return "";
  const [month, day] = birthday.split("-").map(Number);
  if (!month || !day) return birthday;
  return new Date(2000, month - 1, day).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function getUpcomingBirthdays(people) {
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const results = [];
  for (const p of people) {
    if (!p.birthday) continue;
    const [month, day] = p.birthday.split("-").map(Number);
    if (!month || !day) continue;
    let bday = birthdayInYear(month, day, today.getFullYear());
    if (bday < todayMidnight) bday = birthdayInYear(month, day, today.getFullYear() + 1);
    const diff = Math.round((bday - todayMidnight) / 86400000);
    if (diff <= 7) results.push({ person: p, diff, date: bday });
  }
  return results.sort((a, b) => a.diff - b.diff);
}

// ── CSV parsing helpers ────────────────────────────────────

// Parse a single CSV line, respecting quoted fields
function splitCSVLine(line) {
  const cells = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ""; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells.map(c => c.replace(/^["']|["']$/g, "").trim());
}

function titleCase(str) {
  return str.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// If "Smith, John" → "John Smith"; also title-cases
function normalizeName(raw) {
  const trimmed = raw.trim();
  const commaFlip = trimmed.match(/^([^,]+),\s*(.+)$/);
  if (commaFlip) return titleCase(`${commaFlip[2].trim()} ${commaFlip[1].trim()}`);
  return titleCase(trimmed);
}

// Parse a birthday string into MM-DD format
function parseBirthdayStr(raw) {
  if (!raw) return "";
  const cleaned = raw.trim();
  // YYYY-MM-DD (ISO format - e.g. 2009-01-15)
  const iso = cleaned.match(/^\d{4}[\-\/](\d{1,2})[\-\/](\d{1,2})$/);
  if (iso) return `${iso[1].padStart(2, "0")}-${iso[2].padStart(2, "0")}`;
  // MM/DD or MM-DD or M/D (e.g. 03/15, 3-15)
  const numeric = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-]\d{2,4})?$/);
  if (numeric) return `${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  // Month name: "March 15", "15 March", "March 15, 2005"
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  const lower = cleaned.toLowerCase();
  for (let mi = 0; mi < months.length; mi++) {
    if (lower.includes(months[mi])) {
      const dayMatch = cleaned.match(/\b(\d{1,2})\b/);
      if (dayMatch) return `${String(mi + 1).padStart(2, "0")}-${dayMatch[1].padStart(2, "0")}`;
    }
  }
  return "";
}

function parseCSV(text) {
  const rawLines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (!rawLines.length) return [];

  const firstCells = splitCSVLine(rawLines[0]);
  const firstNorm = firstCells.map(c => c.toLowerCase().replace(/[^a-z]/g, ""));

  // Detect header row by looking for name/date keywords
  const nameKws = ["name","first","last","fname","lname","given","surname","family","student","person","contact"];
  const hasHeader = firstNorm.some(c => nameKws.some(kw => c.includes(kw)));

  const headers = hasHeader ? firstNorm : [];
  const dataLines = hasHeader ? rawLines.slice(1) : rawLines;

  // Locate name columns
  const firstNameIdx = headers.findIndex(h =>
    h === "firstname" || h === "fname" || h === "givenname" || h === "given" ||
    h === "first" || h.startsWith("first")
  );
  const lastNameIdx = headers.findIndex(h =>
    h === "lastname" || h === "lname" || h === "surname" || h === "familyname" ||
    h === "last" || h.startsWith("last") || h === "family"
  );
  const fullNameIdx = (firstNameIdx < 0 && lastNameIdx < 0)
    ? headers.findIndex(h => h.includes("name") || h.includes("student") || h.includes("person") || h.includes("contact"))
    : -1;

  // Locate birthday column
  const bdayIdx = headers.findIndex(h =>
    h.includes("birth") || h.includes("bday") || h.includes("dob") || h === "bd" || h === "birthday"
  );

  // For headerless files, sniff which column looks like a date
  const fallbackBdayIdx = (() => {
    if (hasHeader || !dataLines.length) return -1;
    const sample = splitCSVLine(dataLines[0]);
    for (let i = 1; i < sample.length; i++) {
      if (parseBirthdayStr(sample[i])) return i;
    }
    return -1;
  })();

  return dataLines.map(line => {
    const cells = splitCSVLine(line);
    if (!cells.length || !cells[0]) return null;

    let name = "";
    if (hasHeader) {
      if (firstNameIdx >= 0 && lastNameIdx >= 0) {
        // Separate first + last columns → join as "First Last"
        const first = (cells[firstNameIdx] || "").trim();
        const last = (cells[lastNameIdx] || "").trim();
        name = titleCase(`${first} ${last}`.trim());
      } else if (firstNameIdx >= 0) {
        name = titleCase((cells[firstNameIdx] || "").trim());
      } else if (lastNameIdx >= 0) {
        name = titleCase((cells[lastNameIdx] || "").trim());
      } else if (fullNameIdx >= 0) {
        name = normalizeName(cells[fullNameIdx] || "");
      } else {
        // No recognized column — fall back to first cell
        name = normalizeName(cells[0] || "");
      }
    } else {
      name = normalizeName(cells[0] || "");
    }

    if (!name || name.length < 2) return null;

    const bi = hasHeader ? bdayIdx : fallbackBdayIdx;
    const birthday = bi >= 0 && cells[bi] ? parseBirthdayStr(cells[bi]) : "";

    return { name, birthday };
  }).filter(Boolean);
}

// ── Component ──────────────────────────────────────────────

function Confetti() {
  const pieces = Array.from({ length: 38 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 2.5,
    duration: 2.8 + Math.random() * 2,
    size: 7 + Math.random() * 8,
    color: ["#4cad3b","#74c464","#7b93db","#80848a","#3f8a32","#74c464","#7b93db"][i % 7],
    rotate: Math.random() * 360,
  }));
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:50, overflow:"hidden" }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:"absolute",
          left: `${p.x}%`,
          top: -20,
          width: p.size,
          height: p.size * 0.55,
          background: p.color,
          borderRadius: 2,
          transform: `rotate(${p.rotate}deg)`,
          animation: `confettiFall ${p.duration}s ${p.delay}s ease-in forwards`,
          opacity: 0,
        }} />
      ))}
    </div>
  );
}

// Isolated ticker — its own state so parent never rerenders on each tick
function CountdownTicker({ targetTs }) {
  const [remaining, setRemaining] = React.useState(Math.max(0, targetTs - Date.now()));
  React.useEffect(() => {
    const t = setInterval(() => setRemaining(Math.max(0, targetTs - Date.now())), 1000);
    return () => clearInterval(t);
  }, [targetTs]);
  const totalSecs = Math.floor(remaining / 1000);
  const d = Math.floor(totalSecs / 86400);
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = n => String(n).padStart(2, "0");
  const label = d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
  return <p style={{ fontSize:13, color:"#80848a", margin:0, fontVariantNumeric:"tabular-nums" }}>{label}</p>;
}

function useCountdown(targetTs) {
  const [remaining, setRemaining] = React.useState(Math.max(0, targetTs - Date.now()));
  React.useEffect(() => {
    const t = setInterval(() => setRemaining(Math.max(0, targetTs - Date.now())), 1000);
    return () => clearInterval(t);
  }, [targetTs]);
  const totalSecs = Math.floor(remaining / 1000);
  const d = Math.floor(totalSecs / 86400);
  const h = Math.floor((totalSecs % 86400) / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  const pad = n => String(n).padStart(2, "0");
  return d > 0
    ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`
    : `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function AllPrayedScreen({ prayedCount, praySessionCount, total, onWeek, onKeepPraying }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => { setTimeout(() => setShow(true), 100); }, []);

  // Calculate next Monday midnight ET — stable, computed once
  const nextMonday = React.useMemo(() => {
    const now = new Date();
    const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
    const etNow = new Date(etStr);
    const day = etNow.getDay();
    const daysUntil = day === 1 ? 7 : (8 - day) % 7 || 7;
    const monET = new Date(etNow);
    monET.setDate(etNow.getDate() + daysUntil);
    monET.setHours(0, 0, 0, 0);
    const utcOffset = now.getTime() - etNow.getTime();
    return monET.getTime() + utcOffset;
  }, []);

  const isMonday = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay() === 1;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"0 24px 40px", gap:20, textAlign:"center" }}>
      {/* Confetti is its own isolated component — never rerenders from countdown ticks */}
      {show && <Confetti />}
      <div style={{ animation:"celebPulse 2s ease-in-out infinite", lineHeight:1 }}>
        <svg width="64" height="64" viewBox="0 0 20 20">
          <path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#4cad3b" />
        </svg>
      </div>
      <h2 style={{ fontFamily:"'Montserrat', system-ui, sans-serif", fontSize:34, fontWeight:400, color:"#f2f1ee", margin:0, lineHeight:1.2 }}>
        Everyone's been<br/>prayed for!
      </h2>
      <p style={{ fontSize:14, color:"#4cad3b", margin:0, fontWeight:500 }}>
        {praySessionCount > prayedCount ? praySessionCount : prayedCount} of {total} this week
      </p>
      {isMonday ? (
        <p style={{ fontSize:13, color:"#80848a", margin:0, lineHeight:1.7, maxWidth:280 }}>
          The week just reset — keep the momentum going!
        </p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"center" }}>
          <p style={{ fontSize:13, color:"#80848a", margin:0 }}>Check Back Monday</p>
          <CountdownTicker targetTs={nextMonday} />
        </div>
      )}
      <button onClick={() => onKeepPraying()} style={{ background:C.accent, border:"none", color:C.bg, borderRadius:12, padding:"13px 28px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", boxShadow:"0 4px 20px rgba(76,173,59,0.3)" }}>
        Keep Praying
      </button>
      <button onClick={onWeek} style={{ background:"none", border:"1px solid #34363a", color:"#80848a", borderRadius:10, padding:"10px 20px", fontSize:13, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
        View Week Summary →
      </button>
    </div>
  );
}


const authInp = { width:"100%", boxSizing:"border-box", background:"#1f2023", border:"1px solid #34363a", borderRadius:10, color:"#f2f1ee", padding:"12px 14px", fontSize:15, fontFamily:"'Inter', system-ui, sans-serif", outline:"none" };
const authLbl = { fontSize:11, color:"#80848a", textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600, display:"block", marginBottom:5 };
const authBtn = { background:"#4cad3b", border:"none", color:"#101112", borderRadius:12, padding:"14px 0", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", marginTop:4 };
const authWrap = { minHeight:"100vh", background:"#161719", fontFamily:"'Inter', system-ui, sans-serif", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"32px 24px", boxSizing:"border-box" };

function SetupScreen({ onComplete }) {
  const [name, setName] = React.useState("");
  const [sub, setSub] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [team, setTeam] = React.useState("");
  const [err, setErr] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function submit() {
    if (!name.trim()) return setErr("Please enter your ministry name.");
    if (pw.length < 6) return setErr("Admin password must be at least 6 characters.");
    if (pw !== pw2) return setErr("Passwords don’t match.");
    if (team.trim().length < 4) return setErr("Team code must be at least 4 characters.");
    setSaving(true); setErr("");
    try {
      onComplete(await apiAuth("setup", { name: name.trim(), sub: sub.trim(), password: pw, teamCode: team.trim() }));
    } catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div style={authWrap}>
      <img src="/logo.png" alt="" style={{ width: 200, height: "auto", marginBottom: 18 }} />
      <p style={{ fontSize:13, color:"#80848a", margin:"0 0 28px", textAlign:"center" }}>Admin setup — only needs to be done once</p>
      <div style={{ width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:12 }}>
        <div><label style={authLbl}>Ministry Name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. IMPACT Students" style={authInp} /></div>
        <div><label style={authLbl}>Subtitle <span style={{ opacity:0.5, fontWeight:400, textTransform:"none" }}>(optional)</span></label><input value={sub} onChange={e => setSub(e.target.value)} placeholder='e.g. "Let’s Pray"' style={authInp} /></div>
        <div><label style={authLbl}>Admin Password</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Only you need this (6+ characters)" style={authInp} /></div>
        <div><label style={authLbl}>Confirm Password</label><input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Re-enter password" style={authInp} /></div>
        <div><label style={authLbl}>Team Code</label><input value={team} onChange={e => setTeam(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} placeholder="What leaders enter to get in" style={authInp} autoCapitalize="none" autoCorrect="off" /></div>
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0 }}>{err}</p>}
        <button onClick={submit} disabled={saving} style={{ ...authBtn, opacity: saving ? 0.7 : 1 }}>{saving ? "Saving…" : "Get Started"}</button>
      </div>
    </div>
  );
}

function LockScreen({ status, onSignedIn }) {
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try {
      const res = await apiAuth("login", { code: code.trim() });
      if (res.role === "parent" && !window.__LP_DEMO) { location.href = "/parents"; return; }
      if (res.role === "student" && !window.__LP_DEMO) { location.href = "/submit"; return; }
      onSignedIn(res);
    } catch (e) { setErr(e.message); setBusy(false); setCode(""); }
  }

  return (
    <div style={authWrap}>
      <img src="/logo.png" alt={status.name || ""} style={{ width: 220, height: "auto", marginBottom: 14 }} />
      <AppWordmark />
      <p style={{ fontSize:14, color:"#80848a", margin:"14px 0 24px", textAlign:"center", maxWidth:300, lineHeight:1.5 }}>
        {status.teamCodeSet ? "Enter your team code to start praying." : "Your admin needs to finish setup. Admins: sign in with your admin password."}
      </p>
      <div style={{ width:"100%", maxWidth:320, display:"flex", flexDirection:"column", gap:12 }}>
        <input autoFocus type="password" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
          placeholder={status.teamCodeSet ? "Team code" : "Admin password"} style={{ ...authInp, textAlign:"center", fontSize:17 }} autoCapitalize="none" autoCorrect="off" />
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0, textAlign:"center" }}>{err}</p>}
        <button onClick={submit} disabled={busy} style={{ ...authBtn, opacity: busy ? 0.7 : 1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Lock size={15} /> {busy ? "Checking…" : "Sign In"}</button>
      </div>
      <p style={{ fontSize:12, color:"#5c6066", marginTop:28, textAlign:"center", maxWidth:300, lineHeight:1.5 }}>Ask your student ministry leader if you don’t have the code.</p>
      {(status.studentCodeSet || status.parentCodeSet) && (
        <p style={{ fontSize:12.5, color:"#80848a", marginTop:6, textAlign:"center", maxWidth:320, lineHeight:1.6 }}>
          {status.studentCodeSet && <>Students: <a href="/submit" style={{ color:"#74c464" }}>share a prayer request</a><br /></>}
          {status.parentCodeSet && <>Parents: <a href="/parents" style={{ color:"#74c464" }}>share a prayer request for your family</a></>}
        </p>
      )}
    </div>
  );
}

function ReminderCard() {
  const supported = pushSupported();
  const [id, setId] = React.useState(() => lsGet(PUSH_ID_KEY));
  const [time, setTime] = React.useState(() => lsGet(PUSH_TIME_KEY) || "07:00");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const on = !!id;

  async function turnOn(t = time) {
    setBusy(true); setMsg("");
    try { const r = await enablePush(t); setId(r.id); setTime(r.time); setMsg("Reminders are on."); }
    catch (e) { setMsg(e.message || "Couldn’t turn on reminders."); }
    setBusy(false);
  }
  async function turnOff() {
    setBusy(true); setMsg("");
    await disablePush(); setId(null); setMsg("Reminders are off.");
    setBusy(false);
  }
  async function test() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/push?action=test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 410 || res.status === 404) { lsSet(PUSH_ID_KEY, null); setId(null); }
      setMsg(data.ok ? "Test sent — it should pop up in a few seconds." : (data.error || "Test didn’t go through."));
    } catch (_e) { setMsg("Test didn’t go through."); }
    setBusy(false);
  }

  const box = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", marginBottom: 16 };
  const head = <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}><Bell size={14} color={C.orange} /><span style={{ fontSize:13, fontWeight:600, color:C.cream }}>Daily Prayer Reminder</span>{on && <span style={{ marginLeft:"auto", fontSize:11, color:C.accent, fontWeight:600 }}>ON</span>}</div>;

  if (typeof window !== "undefined" && window.__LP_DEMO) {
    return (
      <div style={box}>
        {head}
        <p style={{ margin:0, fontSize:12.5, color:C.muted, lineHeight:1.55 }}>Leaders pick a time here and tap Turn on. Notifications only work in the real app, not in this demo.</p>
      </div>
    );
  }

  if (!supported || (isIOS() && !isStandalone())) {
    return (
      <div style={box}>
        {head}
        <p style={{ margin:0, fontSize:12.5, color:C.muted, lineHeight:1.55 }}>
          {isIOS()
            ? <>On iPhone, reminders need the app on your Home Screen. Tap the <b style={{ color:C.cream }}>Share</b> button, choose <b style={{ color:C.cream }}>Add to Home Screen</b>, then open the app from there.</>
            : "This browser doesn’t support notifications. Try Chrome, Edge, or Safari on a phone."}
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      {head}
      <p style={{ margin:"0 0 10px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>Get a nudge each day to pray. It’s skipped on days you’ve already opened the app.</p>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <select value={time} disabled={busy} onChange={e => { setTime(e.target.value); if (on) turnOn(e.target.value); }} style={{ ...S.gradeSelect, padding:"8px 10px" }}>
          {REMINDER_TIMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {on ? (
          <>
            <button onClick={test} disabled={busy} style={S.cancelBtn}>Send test</button>
            <button onClick={turnOff} disabled={busy} style={{ ...S.cancelBtn, marginLeft:"auto" }}>Turn off</button>
          </>
        ) : (
          <button onClick={() => turnOn()} disabled={busy} style={{ ...S.confirmBtn, background: C.orange, color: "#fff" }}>{busy ? "Turning on…" : "Turn on"}</button>
        )}
      </div>
      {msg && <p style={{ margin:"10px 0 0", fontSize:12, color: /on\.|sent/.test(msg) ? C.accentLight : "#e07a5f" }}>{msg}</p>}
    </div>
  );
}

function SettingsCard({ settings, onStatus }) {
  const [name, setName] = React.useState(settings.name || "");
  const [sub, setSub] = React.useState(settings.sub || "");
  const [team, setTeam] = React.useState("");
  const [student, setStudent] = React.useState("");
  const [parentCode, setParentCode] = React.useState("");
  const [curPw, setCurPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [msg, setMsg] = React.useState({});
  const [busy, setBusy] = React.useState("");

  async function save(section, body, reset) {
    setBusy(section); setMsg({});
    try { const res = await apiAuth("update", body); onStatus(res); reset && reset(); setMsg({ [section]: { ok: true, text: "Saved." } }); }
    catch (e) { setMsg({ [section]: { ok: false, text: e.message } }); }
    setBusy("");
  }
  const note = k => msg[k] && <p style={{ margin:"6px 0 0", fontSize:12, color: msg[k].ok ? C.accentLight : "#e07a5f" }}>{msg[k].text}</p>;
  const label = t => <p style={{ margin:"0 0 6px", fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>{t}</p>;
  const row = { display:"flex", gap:8 };
  const inp = { ...S.addInput, margin:0, fontSize:13 };

  return (
    <div style={{ background:C.surface, border:`1px solid ${settings.teamCodeSet ? C.border : C.orange}`, borderRadius:14, padding:"14px", display:"flex", flexDirection:"column", gap:14, marginTop:16 }}>
      <p style={{ margin:0, fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}><SettingsIcon size={12} /> App Settings</p>

      <div>
        {label(settings.teamCodeSet ? "Change team code" : "Set a team code (required)")}
        {!settings.teamCodeSet && <p style={{ margin:"0 0 8px", fontSize:12, color:C.orange, lineHeight:1.5 }}>Leaders can’t get into the app until you set a team code.</p>}
        <div style={row}>
          <input value={team} onChange={e => setTeam(e.target.value)} placeholder="New team code (4+ characters)" style={inp} autoCapitalize="none" autoCorrect="off" />
          <button disabled={busy === "team" || team.trim().length < 4} onClick={() => save("team", { teamCode: team.trim() }, () => setTeam(""))} style={{ ...S.reqAddBtn, opacity: team.trim().length < 4 ? 0.5 : 1 }}>Save</button>
        </div>
        {settings.teamCodeSet && <p style={{ margin:"6px 0 0", fontSize:11.5, color:C.muted }}>Changing it signs out every leader until they enter the new code.</p>}
        {note("team")}
      </div>

      <div>
        {label(settings.studentCodeSet ? "Change student code" : "Student code (optional)")}
        <p style={{ margin:"0 0 8px", fontSize:12, color:C.muted, lineHeight:1.5 }}>
          Students use this at <b style={{ color:C.cream }}>{location.origin}/submit</b> to send prayer requests and CAUSE Circle names. You approve them in the Inbox. Students can’t see the roster.
        </p>
        <div style={row}>
          <input value={student} onChange={e => setStudent(e.target.value)} placeholder="Student code (4+ characters)" style={inp} autoCapitalize="none" autoCorrect="off" />
          <button disabled={busy === "student" || student.trim().length < 4} onClick={() => save("student", { studentCode: student.trim() }, () => setStudent(""))} style={{ ...S.reqAddBtn, opacity: student.trim().length < 4 ? 0.5 : 1 }}>Save</button>
        </div>
        <div style={{ display:"flex", gap:12, marginTop:6 }}>
          <button onClick={() => { try { navigator.clipboard.writeText(`${location.origin}/submit`); setMsg({ student: { ok: true, text: "Link copied." } }); } catch (_e) {} }} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0 }}>Copy student link</button>
          {settings.studentCodeSet && <button onClick={() => save("student", { studentCode: null })} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer", padding:0 }}>Close the student page</button>}
        </div>
        {note("student")}
      </div>

      <div>
        {label(settings.parentCodeSet ? "Change parent code" : "Parent code (optional)")}
        <p style={{ margin:"0 0 8px", fontSize:12, color:C.muted, lineHeight:1.5 }}>
          Parents use this at <b style={{ color:C.cream }}>{location.origin}/parents</b> to share family prayer requests. You approve them in the Inbox. Parents can’t see the roster or the student Prayer Wall.
        </p>
        <div style={row}>
          <input value={parentCode} onChange={e => setParentCode(e.target.value)} placeholder="Parent code (4+ characters)" style={inp} autoCapitalize="none" autoCorrect="off" />
          <button disabled={busy === "parent" || parentCode.trim().length < 4} onClick={() => save("parent", { parentCode: parentCode.trim() }, () => setParentCode(""))} style={{ ...S.reqAddBtn, opacity: parentCode.trim().length < 4 ? 0.5 : 1 }}>Save</button>
        </div>
        <div style={{ display:"flex", gap:12, marginTop:6 }}>
          <button onClick={() => { try { navigator.clipboard.writeText(`${location.origin}/parents`); setMsg({ parent: { ok: true, text: "Link copied." } }); } catch (_e) {} }} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0 }}>Copy parent link</button>
          {settings.parentCodeSet && <button onClick={() => save("parent", { parentCode: null })} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer", padding:0 }}>Close the parent page</button>}
        </div>
        {note("parent")}
      </div>

      <div>
        {label("Ministry name")}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Ministry name" style={inp} />
          <div style={row}>
            <input value={sub} onChange={e => setSub(e.target.value)} placeholder="Subtitle (optional)" style={inp} />
            <button disabled={busy === "name"} onClick={() => save("name", { name, sub })} style={S.reqAddBtn}>Save</button>
          </div>
        </div>
        {note("name")}
      </div>

      <div>
        {label("Change admin password")}
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="Current password" style={inp} />
          <div style={row}>
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password (6+ characters)" style={inp} />
            <button disabled={busy === "pw" || newPw.length < 6 || !curPw} onClick={() => save("pw", { currentPassword: curPw, newPassword: newPw }, () => { setCurPw(""); setNewPw(""); })} style={{ ...S.reqAddBtn, opacity: newPw.length < 6 || !curPw ? 0.5 : 1 }}>Save</button>
          </div>
        </div>
        {note("pw")}
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{ minHeight:"100vh", background:"#161719", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <svg width="36" height="36" viewBox="0 0 20 20" style={{ opacity:0.5 }}>
        <path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#4cad3b" />
      </svg>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) return (
      <div style={{ minHeight:"100vh", background:"#161719", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:32, fontFamily:"monospace" }}>
        <p style={{ color:"#c07070", fontSize:16, marginBottom:16 }}>Error:</p>
        <pre style={{ color:"#f2f1ee", fontSize:12, whiteSpace:"pre-wrap", maxWidth:500, background:"#1f2023", padding:16, borderRadius:8 }}>{this.state.error.message}</pre>
      </div>
    );
    return this.props.children;
  }
}

/* The Let’s Pray name + mark, shown under the IMPACT logo on sign-in screens */
function AppWordmark({ small }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, margin: small ? "0 0 4px" : "2px 0 4px" }}>
      <img src="/icon-192.png" alt="" style={{ width: small ? 22 : 28, height: small ? 22 : 28, borderRadius: small ? 6 : 8 }} />
      <span style={{ fontFamily:"'Montserrat', system-ui, sans-serif", fontSize: small ? 16 : 20, fontWeight:800, color:"#f2f1ee", letterSpacing:"0.01em" }}>Let’s Pray</span>
    </div>
  );
}

/* ── Student page (/submit) ── */
const STUDENT_NAME_KEY = "lp-student-name";
const STUDENT_GRADE_KEY = "lp-student-grade";
const STUDENT_BDAY_KEY = "lp-student-bday";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function StudentPage() {
  const [info, setInfo] = React.useState(null);
  const [series] = useSeries(info && info.role);
  const [events] = useEvents(info && info.role);
  const calendar = useCalendar(info && info.role);
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(() => lsGet(STUDENT_NAME_KEY) || "");
  const [kind, setKind] = React.useState("request");
  const [text, setText] = React.useState("");
  const [friends, setFriends] = React.useState(["", "", ""]);
  const [grade, setGrade] = React.useState(() => lsGet(STUDENT_GRADE_KEY) || "");
  const [bMonth, setBMonth] = React.useState(() => (lsGet(STUDENT_BDAY_KEY) || "").split("-")[0] || "");
  const [bDay, setBDay] = React.useState(() => (lsGet(STUDENT_BDAY_KEY) || "").split("-")[1] || "");
  const [done, setDone] = React.useState(false);
  const [tab, setTab] = React.useState("share");
  const [share, setShare] = React.useState(false);
  const [anonymous, setAnonymous] = React.useState(false);
  const [sharedLast, setSharedLast] = React.useState(false);
  const [photoData, setPhotoData] = React.useState("");
  const [gCount, setGCount] = React.useState(1);
  const [gFriend, setGFriend] = React.useState("");
  const [gOutcome, setGOutcome] = React.useState("");
  const [lastKind, setLastKind] = React.useState("");
  const [notifyId, setNotifyId] = React.useState(() => lsGet(STUDENT_NOTIFY_KEY) || "");
  const [notifyBusy, setNotifyBusy] = React.useState(false);
  const [notifyMsg, setNotifyMsg] = React.useState("");
  async function turnOnNotify() {
    setNotifyBusy(true); setNotifyMsg("");
    try { setNotifyId(await enableStudentPush()); setNotifyMsg("You’ll get a notification when someone prays for you."); }
    catch (e) { setNotifyMsg(e.message || "Couldn’t turn on notifications."); }
    setNotifyBusy(false);
  }
  const [photoBusyS, setPhotoBusyS] = React.useState(false);
  const studentPhotoRef = React.useRef(null);

  async function choosePhoto(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusyS(true); setErr("");
    try { setPhotoData(await blobToDataUrl(await resizeImage(file, 480))); }
    catch (_e) { setErr("That photo couldn’t be used. Try a different one."); }
    setPhotoBusyS(false);
  }

  const load = React.useCallback(() => {
    fetch("/api/submit", { cache: "no-store" }).then(r => r.json()).then(setInfo).catch(() => setInfo({ error: true }));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function signIn() {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try { await apiAuth("login", { code: code.trim() }); load(); setCode(""); }
    catch (e) { setErr(e.message); setCode(""); }
    setBusy(false);
  }

  async function submit() {
    setErr("");
    const list = friends.map(f => f.trim()).filter(Boolean);
    if (name.trim().length < 2) return setErr("Please enter your first and last name.");
    if (kind === "request" && text.trim().length < 3) return setErr("Please write your prayer request.");
    if (kind === "gospel" && (!gCount || gCount < 1)) return setErr("How many Gospel conversations did you have?");
    if (kind === "praise" && text.trim().length < 3) return setErr("Tell us what God did!");
    if (kind === "cause" && !list.length) return setErr("Add at least one friend’s name.");
    if ((bMonth && !bDay) || (!bMonth && bDay)) return setErr("Pick both the month and day of your birthday.");
    const birthday = bMonth && bDay ? `${bMonth}-${bDay}` : "";
    if (kind === "info" && !grade && !birthday && !photoData) return setErr("Add your grade, birthday, or a photo.");
    setBusy(true);
    try {
      const res = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), kind, text: text.trim(), friends: list, grade: grade ? Number(grade) : null, birthday, share: (kind === "request" || kind === "praise") && share, anonymous: (kind === "request" || kind === "praise") && share && anonymous, notifyId: notifyId || undefined, photo: photoData || undefined, count: kind === "gospel" ? gCount : undefined, friend: kind === "gospel" ? gFriend.trim() : undefined, outcome: kind === "gospel" ? (gOutcome || undefined) : undefined }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { load(); throw new Error("Please enter the student code again."); }
      if (!res.ok) throw new Error(data.error || "That didn’t send. Try again.");
      lsSet(STUDENT_NAME_KEY, name.trim());
      lsSet(STUDENT_GRADE_KEY, grade || null);
      lsSet(STUDENT_BDAY_KEY, birthday || null);
      setSharedLast(kind === "request" && share);
      setLastKind(kind); setGCount(1); setGFriend(""); setGOutcome("");
      setDone(true); setText(""); setFriends(["", "", ""]); setShare(false); setAnonymous(false); setPhotoData("");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const card = { width:"100%", maxWidth:400, display:"flex", flexDirection:"column", gap:12 };
  const header = (
    <>
      <img src="/logo.png" alt={info?.name || ""} style={{ width: 210, height: "auto", marginBottom: 10 }} />
      <AppWordmark small />
      <p style={{ fontSize:12, color:"#80848a", margin:"0 0 24px", textTransform:"uppercase", letterSpacing:"0.14em", fontWeight:700 }}>Share with your leaders</p>
    </>
  );

  if (!info) return <LoadingScreen />;
  if (info.error || !info.configured || !info.open) return (
    <div style={authWrap}>{header}<p style={{ color:"#80848a", fontSize:14, textAlign:"center", maxWidth:300, lineHeight:1.5 }}>This page isn’t open yet. Check back soon!</p></div>
  );

  if (!info.role) return (
    <div style={authWrap}>
      {header}
      <div style={{ ...card, maxWidth:320 }}>
        <p style={{ fontSize:14, color:"#80848a", margin:"0 0 4px", textAlign:"center", lineHeight:1.5 }}>Enter the student code your leaders gave you.</p>
        <input autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === "Enter" && signIn()} placeholder="Student code" style={{ ...authInp, textAlign:"center", fontSize:17 }} autoCapitalize="none" autoCorrect="off" />
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0, textAlign:"center" }}>{err}</p>}
        <button onClick={signIn} disabled={busy} style={{ ...authBtn, opacity: busy ? 0.7 : 1 }}>{busy ? "Checking…" : "Continue"}</button>
      </div>
    </div>
  );

  if (done) return (
    <div style={authWrap}>
      {header}
      <div style={{ ...card, alignItems:"center", textAlign:"center" }}>
        <Heart size={40} color="#e95e24" fill="#e95e24" />
        <p style={{ color:"#f2f1ee", fontSize:20, fontWeight:700, fontFamily:"'Montserrat', system-ui, sans-serif", margin:"8px 0 0" }}>{lastKind === "gospel" ? "Thank you for sharing Jesus!" : lastKind === "praise" ? "Praise God! 🎉" : "Got it. Thank you!"}</p>
        <p style={{ color:"#80848a", fontSize:14, margin:0, lineHeight:1.5 }}>
          {lastKind === "gospel" ? "Your leaders will celebrate this with you and keep praying for your friend." : "Your leaders will see this and start praying."}{sharedLast ? " Once a leader approves it, it will show on the Prayer Wall too." : ""}
        </p>
        {lastKind === "gospel" && <div style={{ width:"100%", marginTop:8, textAlign:"left" }}><GospelTracker compact /></div>}
        <button onClick={() => { setDone(false); setKind(lastKind === "gospel" ? "gospel" : "request"); }} style={{ ...authBtn, padding:"12px 28px", marginTop:12 }}>Share something else</button>
        <button onClick={() => { setDone(false); setTab("wall"); }} style={{ background:"none", border:"none", color:"#74c464", fontSize:14, fontWeight:600, cursor:"pointer", marginTop:4 }}>Go to the Prayer Wall →</button>
      </div>
    </div>
  );

  const tabsRow = (
    <div style={{ display:"flex", width:"100%", maxWidth:400, background:"#1f2023", border:"1px solid #34363a", borderRadius:12, padding:4, gap:4, marginBottom:18, boxSizing:"border-box" }}>
      {[["share","Share"],["wall","Prayer Wall"],...(calendar && calendar.configured ? [["calendar","Calendar"]] : [])].map(([v, l]) => (
        <button key={v} onClick={() => setTab(v)} style={{ flex:1, padding:"10px 0", borderRadius:9, border:"none", background: tab === v ? "#4cad3b" : "none", color: tab === v ? "#101112" : "#80848a", fontWeight: tab === v ? 700 : 500, fontSize:14, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{l}</button>
      ))}
    </div>
  );

  if (tab === "calendar") return (
    <div style={{ ...authWrap, justifyContent:"flex-start", paddingTop:48 }}>
      {header}
      {tabsRow}
      <EventCards events={events} mode="student" />
      <CalendarList cal={calendar} title="Calendar" emptyText="Nothing on the calendar yet. Check back soon!" />
    </div>
  );

  if (tab === "wall") return (
    <div style={{ ...authWrap, justifyContent:"flex-start", paddingTop:48 }}>
      {header}
      {tabsRow}
      <SeriesCard series={series} mode="student" />
      <EventCards events={events} mode="student" />
      <PrayerWall />
    </div>
  );

  const chip = on => ({ flex:1, padding:"11px 2px", borderRadius:10, border:`1px solid ${on ? "#4cad3b" : "#34363a"}`, background: on ? "#18241a" : "#1f2023", color: on ? "#f2f1ee" : "#80848a", fontSize:14, fontWeight: on ? 700 : 500, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" });
  return (
    <div style={{ ...authWrap, justifyContent:"flex-start", paddingTop:48 }}>
      {header}
      {tabsRow}
      <SeriesCard series={series} mode="student" />
      <EventCards events={events} mode="student" />
      <div style={card}>
        <div><label style={authLbl}>Your name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" style={authInp} autoComplete="name" /></div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ flex:"0 0 34%" }}>
            <label style={authLbl}>Grade</label>
            <select value={grade} onChange={e => setGrade(e.target.value)} style={{ ...authInp, padding:"12px 10px" }}>
              <option value="">—</option>
              {[6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{g}th</option>)}
            </select>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <label style={authLbl}>Birthday</label>
            <div style={{ display:"flex", gap:6 }}>
              <select value={bMonth} onChange={e => { setBMonth(e.target.value); if (bDay && Number(bDay) > DAYS_IN_MONTH[Number(e.target.value) - 1]) setBDay(""); }} style={{ ...authInp, padding:"12px 8px", flex:1.6, minWidth:0 }}>
                <option value="">Month</option>
                {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, "0")}>{m.slice(0, 3)}</option>)}
              </select>
              <select value={bDay} onChange={e => setBDay(e.target.value)} style={{ ...authInp, padding:"12px 8px", flex:1, minWidth:0 }}>
                <option value="">Day</option>
                {Array.from({ length: bMonth ? DAYS_IN_MONTH[Number(bMonth) - 1] : 31 }, (_, i) => String(i + 1).padStart(2, "0")).map(d => <option key={d} value={d}>{Number(d)}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12, background:"#1f2023", border:"1px solid #34363a", borderRadius:10, padding:"10px 12px" }}>
          <input ref={studentPhotoRef} type="file" accept="image/*" onChange={choosePhoto} style={{ display:"none" }} />
          {photoData
            ? <img src={photoData} alt="Your photo" style={{ width:52, height:52, borderRadius:"50%", objectFit:"cover", flexShrink:0 }} />
            : <div style={{ width:52, height:52, borderRadius:"50%", border:"1.5px dashed #4a4d52", display:"flex", alignItems:"center", justifyContent:"center", color:"#80848a", flexShrink:0 }}><Camera size={20} /></div>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:14, color:"#f2f1ee", fontWeight:600 }}>{photoData ? "Photo added" : "Add your photo"} <span style={{ fontWeight:400, color:"#80848a", fontSize:12 }}>(optional)</span></div>
            <div style={{ fontSize:12, color:"#80848a", lineHeight:1.4 }}>Goes on your prayer card after a leader approves it.</div>
          </div>
          <button onClick={() => studentPhotoRef.current && studentPhotoRef.current.click()} disabled={photoBusyS} style={{ background:"none", border:"1px solid #34363a", color:"#f2f1ee", borderRadius:8, padding:"7px 10px", fontSize:13, cursor:"pointer", flexShrink:0 }}>{photoBusyS ? "…" : photoData ? "Change" : "Choose"}</button>
          {photoData && <button onClick={() => setPhotoData("")} aria-label="Remove photo" style={{ background:"none", border:"none", color:"#80848a", cursor:"pointer", padding:2, display:"flex" }}><X size={16} /></button>}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          <button onClick={() => setKind("request")} style={chip(kind === "request")}>Prayer request</button>
          <button onClick={() => setKind("cause")} style={chip(kind === "cause")}>CAUSE Circle</button>
          <button onClick={() => setKind("gospel")} style={chip(kind === "gospel")}>Gospel conversation</button>
          <button onClick={() => setKind("praise")} style={chip(kind === "praise")}>Praise report 🎉</button>
          <button onClick={() => setKind("info")} style={chip(kind === "info")}>Just my info</button>
        </div>
        {kind === "praise" ? (
          <div>
            <label style={authLbl}>What did God do?</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={1200} placeholder="Share how God answered a prayer or what He’s doing in your life." style={{ ...authInp, resize:"vertical", lineHeight:1.5 }} />
            <div style={{ marginTop:10, background:"#1f2023", border:"1px solid #34363a", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
              <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer", fontSize:14, color:"#f2f1ee", lineHeight:1.4 }}>
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} style={{ marginTop:3, width:17, height:17, accentColor:"#4cad3b" }} />
                <span>Share it on the student Prayer Wall<br /><span style={{ fontSize:12, color:"#80848a" }}>So everyone can celebrate with you</span></span>
              </label>
              {share && (
                <div style={{ display:"flex", gap:8, paddingLeft:27 }}>
                  {[[false, "Show my first name"], [true, "Post anonymously"]].map(([v, l]) => (
                    <button key={l} onClick={() => setAnonymous(v)} style={{ flex:1, padding:"8px 4px", borderRadius:8, border:`1px solid ${anonymous === v ? "#4cad3b" : "#34363a"}`, background: anonymous === v ? "#18241a" : "none", color: anonymous === v ? "#f2f1ee" : "#80848a", fontSize:12.5, cursor:"pointer" }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : kind === "gospel" ? (
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <div>
              <label style={authLbl}>How many Gospel conversations did you have?</label>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <button onClick={() => setGCount(c => Math.max(1, c - 1))} aria-label="One fewer" style={{ width:44, height:44, borderRadius:10, border:"1px solid #34363a", background:"#1f2023", color:"#f2f1ee", fontSize:22, cursor:"pointer" }}>−</button>
                <span style={{ minWidth:40, textAlign:"center", fontSize:28, fontWeight:800, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif", fontVariantNumeric:"tabular-nums" }}>{gCount}</span>
                <button onClick={() => setGCount(c => Math.min(50, c + 1))} aria-label="One more" style={{ width:44, height:44, borderRadius:10, border:"1px solid #34363a", background:"#1f2023", color:"#f2f1ee", fontSize:22, cursor:"pointer" }}>+</button>
              </div>
            </div>
            <div>
              <label style={authLbl}>Who with? <span style={{ opacity:0.6, fontWeight:400, textTransform:"none" }}>(optional, first name is fine)</span></label>
              <input value={gFriend} onChange={e => setGFriend(e.target.value)} placeholder="e.g. a friend from your CAUSE Circle" style={authInp} />
            </div>
            <div>
              <label style={authLbl}>How did it go? <span style={{ opacity:0.6, fontWeight:400, textTransform:"none" }}>(optional)</span></label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {GOSPEL_OUTCOMES.map(([v, l]) => (
                  <button key={v} onClick={() => setGOutcome(o => o === v ? "" : v)} style={{ padding:"8px 12px", borderRadius:18, border:`1px solid ${gOutcome === v ? (v === "trusted" ? "#e95e24" : "#4cad3b") : "#34363a"}`, background: gOutcome === v ? (v === "trusted" ? "#2a1a12" : "#18241a") : "none", color: gOutcome === v ? "#f2f1ee" : "#80848a", fontSize:13, cursor:"pointer" }}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={authLbl}>Tell us the story <span style={{ opacity:0.6, fontWeight:400, textTransform:"none" }}>(optional)</span></label>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={4} maxLength={1200} placeholder="What happened? How can we pray for them?" style={{ ...authInp, resize:"vertical", lineHeight:1.5 }} />
            </div>
          </div>
        ) : kind === "info" ? (
          <p style={{ margin:0, fontSize:13, color:"#80848a", lineHeight:1.5 }}>Sends your grade, birthday, and photo to your leaders so they can update the roster.</p>
        ) : kind === "request" ? (
          <div>
            <label style={authLbl}>How can we pray for you?</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={600} placeholder="Share as much or as little as you want." style={{ ...authInp, resize:"vertical", lineHeight:1.5 }} />
            <div style={{ marginTop:10, background:"#1f2023", border:"1px solid #34363a", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
              <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer", fontSize:14, color:"#f2f1ee", lineHeight:1.4 }}>
                <input type="checkbox" checked={share} onChange={e => setShare(e.target.checked)} style={{ marginTop:3, width:17, height:17, accentColor:"#4cad3b" }} />
                <span>Also share on the student Prayer Wall<br /><span style={{ fontSize:12, color:"#80848a" }}>So other students can pray for you too</span></span>
              </label>
              {share && (
                <div style={{ display:"flex", gap:8, paddingLeft:27 }}>
                  {[[false, "Show my first name"], [true, "Post anonymously"]].map(([v, l]) => (
                    <button key={l} onClick={() => setAnonymous(v)} style={{ flex:1, padding:"8px 4px", borderRadius:8, border:`1px solid ${anonymous === v ? "#4cad3b" : "#34363a"}`, background: anonymous === v ? "#18241a" : "none", color: anonymous === v ? "#f2f1ee" : "#80848a", fontSize:12.5, cursor:"pointer" }}>{l}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <label style={{ ...authLbl, marginBottom:0 }}>Friends you’re praying for to share the Gospel with</label>
            <p style={{ margin:0, fontSize:12, color:"#80848a" }}>First names are fine.</p>
            {friends.map((f, i) => (
              <input key={i} value={f} onChange={e => setFriends(prev => prev.map((x, j) => j === i ? e.target.value : x))} placeholder={`Friend ${i + 1}`} style={authInp} />
            ))}
            {friends.length < 12 && <button onClick={() => setFriends(prev => [...prev, ""])} style={{ alignSelf:"flex-start", background:"none", border:"1px solid #34363a", color:"#80848a", borderRadius:8, padding:"7px 12px", fontSize:13, cursor:"pointer" }}>+ Another friend</button>}
          </div>
        )}
        <div style={{ background:"#1f2023", border:"1px solid #34363a", borderRadius:10, padding:"10px 12px", display:"flex", alignItems:"center", gap:10 }}>
          <Bell size={16} color={notifyId ? "#4cad3b" : "#80848a"} style={{ flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0, fontSize:13, color:"#f2f1ee", lineHeight:1.4 }}>
            {notifyId ? "We’ll let you know when someone prays for you." : "Get a notification when someone prays for you"}
            {!notifyId && isIOS() && !isStandalone() && <span style={{ display:"block", fontSize:11.5, color:"#80848a" }}>On iPhone, first tap Share → Add to Home Screen, then open it from there.</span>}
            {notifyMsg && <span style={{ display:"block", fontSize:11.5, color: /Couldn|blocked|weren/.test(notifyMsg) ? "#e07a5f" : "#74c464" }}>{notifyMsg}</span>}
          </div>
          {!notifyId && pushSupported() && !(isIOS() && !isStandalone()) && (
            <button onClick={turnOnNotify} disabled={notifyBusy} style={{ background:"none", border:"1px solid #4cad3b", color:"#74c464", borderRadius:8, padding:"7px 10px", fontSize:12.5, fontWeight:600, cursor:"pointer", flexShrink:0 }}>{notifyBusy ? "…" : "Turn on"}</button>
          )}
        </div>
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0 }}>{err}</p>}
        <button onClick={submit} disabled={busy} style={{ ...authBtn, background:"#e95e24", color:"#fff", opacity: busy ? 0.7 : 1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Send size={15} /> {busy ? "Sending…" : "Send to my leaders"}</button>
        <p style={{ fontSize:12, color:"#5c6066", margin:"4px 0 24px", textAlign:"center", lineHeight:1.5 }}>
          {kind === "request" && share ? "Your leaders see your full name. A leader approves posts before they go on the wall." : "Only your student ministry leaders will see what you send."}
        </p>
      </div>
    </div>
  );
}

/* ── Gospel conversations ── */
const GOSPEL_OUTCOMES = [
  ["shared", "I shared the Gospel"],
  ["questions", "They had questions"],
  ["visit", "They want to come to church"],
  ["trusted", "They trusted Jesus! 🎉"],
];
const outcomeLabel = o => (GOSPEL_OUTCOMES.find(([v]) => v === o) || [null, ""])[1];
const monthKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}`; };
function gospelTotals(people) {
  const thisMonth = monthKey(Date.now());
  let month = 0, all = 0, trusted = 0;
  for (const p of people) for (const g of p.gospelLog || []) {
    all += g.count || 0;
    if (monthKey(g.at) === thisMonth) month += g.count || 0;
    if (g.outcome === "trusted") trusted++;
  }
  return { month, all, trusted };
}

/* ── Teaching series: weekly verse, prayer prompt, parent conversation ── */
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function seriesWeek(series) {
  if (!series || !Array.isArray(series.weeks) || !series.weeks.length) return null;
  const weeks = series.weeks.slice().sort((a, b) => a.date.localeCompare(b.date));
  const today = ymd();
  let idx = -1;
  weeks.forEach((w, i) => { if (w.date <= today) idx = i; });
  if (idx === -1) return { upcoming: true, week: weeks[0], number: 1, total: weeks.length };
  // After the last week has been taught for 8+ days, the series is over
  const last = weeks[weeks.length - 1];
  if (idx === weeks.length - 1 && (Date.now() - new Date(last.date + "T12:00:00").getTime()) > 8 * 864e5) return null;
  return { upcoming: false, week: weeks[idx], number: idx + 1, total: weeks.length };
}
const prettyDay = date => new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

// Re-checks after sign-in (dep changes), when an admin saves the series, and every 10 minutes
function useSeries(dep) {
  const [series, setSeries] = React.useState(null);
  React.useEffect(() => {
    const load = () => fetch("/api/data?key=series", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(sr => { if (sr !== undefined) setSeries(sr); }).catch(() => {});
    load();
    window.addEventListener("lp-series-updated", load);
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { window.removeEventListener("lp-series-updated", load); clearInterval(t); };
  }, [dep]);
  return [series, setSeries];
}

const artUrl = series => (series && series.art ? (typeof window !== "undefined" && window.__lpArtUrl ? window.__lpArtUrl(series.art) : `/api/art?v=${series.art}`) : null);
const splitLines = t => String(t || "").split(/\n+/).map(l => l.trim().replace(/^[-•*●▪︎◦]\s*|^\d+[.)]\s*/, "")).filter(Boolean);

/* Memory verse: shows the verse, and lets students practice by hiding words step by step */
const MEM_KEY = id => `lp-memorized-${id}`;
function MemoryVerse({ week, mode, sameAsVerse }) {
  const [level, setLevel] = React.useState(0);           // 0 full · 1 some words hidden · 2 first letters only
  const [peek, setPeek] = React.useState(false);
  const [done, setDone] = React.useState(() => lsGet(MEM_KEY(week.id)) === "1");
  const text = week.memoryText || "";
  const practice = (mode === "student" || mode === "parent") && text.split(/\s+/).length > 2;
  const words = text.split(/(\s+)/);
  let n = 0;
  const shown = level === 0 || peek ? text : words.map(w => {
    if (/^\s+$/.test(w) || !w) return w;
    n++;
    if (level === 1 && n % 2 === 1) return w;
    return w.replace(/^([“"‘'(]*)([A-Za-z0-9’']+)(.*)$/, (_m, pre, core, post) => pre + core[0] + core.slice(1).replace(/[A-Za-z0-9’']/g, "_") + post);
  }).join("");
  function markDone() { const v = !done; setDone(v); lsSet(MEM_KEY(week.id), v ? "1" : "0"); }
  const btn = on => ({ flex:1, padding:"7px 4px", borderRadius:8, border:`1px solid ${on ? "#e95e24" : "#34363a"}`, background: on ? "#2c1a12" : "none", color: on ? "#f2f1ee" : "#80848a", fontSize:12.5, fontWeight: on ? 700 : 500, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" });
  return (
    <div style={{ background:"#2a1c15", border:"1px solid #e95e2440", borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:10.5, letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:800, color:"#f08a5d" }}>⭐ Memory verse{mode === "parent" ? " · practice together" : ""}</span>
        {done && practice && <span style={{ marginLeft:"auto", fontSize:11.5, color:"#74c464", fontWeight:700 }}>Memorized ✓</span>}
      </div>
      {text && <div aria-live="polite" style={{ fontSize:14.5, color:"#f2f1ee", lineHeight:1.55, fontWeight:500, letterSpacing: level && !peek ? "0.02em" : 0 }}>{shown}</div>}
      {week.memoryRef && <div style={{ fontSize:12.5, color:"#f08a5d", fontWeight:700 }}>{week.memoryRef}{sameAsVerse && mode !== "parent" ? " · this week’s verse" : ""}</div>}
      {practice && (
        <>
          <div style={{ display:"flex", gap:6, marginTop:4 }} role="group" aria-label="Practice">
            {[["Read it", 0], ["Hide some", 1], ["First letters", 2]].map(([l, v]) => <button key={v} onClick={() => { setLevel(v); setPeek(false); }} aria-pressed={level === v} style={btn(level === v)}>{l}</button>)}
          </div>
          <div style={{ display:"flex", gap:12, alignItems:"center" }}>
            {level > 0 && <button onPointerDown={() => setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onClick={e => e.preventDefault()} style={{ background:"none", border:"none", color:"#80848a", fontSize:12.5, cursor:"pointer", padding:0, fontFamily:"'Inter', system-ui, sans-serif" }}>Hold to peek</button>}
            {mode === "student" && <button onClick={markDone} style={{ marginLeft:"auto", background:"none", border:"none", color: done ? "#80848a" : "#74c464", fontSize:12.5, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter', system-ui, sans-serif" }}>{done ? "Undo" : "I’ve got it memorized ✓"}</button>}
          </div>
        </>
      )}
    </div>
  );
}

function SeriesCard({ series, mode = "leader" }) {
  const cur = seriesWeek(series);
  if (!cur) return null;
  const { week, number, total, upcoming } = cur;
  const isParent = mode === "parent";
  const ask = splitLines(week.parentPrompt);
  const pray = splitLines(week.parentPray);
  if (isParent && (upcoming || (!ask.length && !week.parentThink && !pray.length && !week.memoryText))) return null;
  const art = artUrl(series);
  const hasMemory = !!(week.memoryRef || week.memoryText);
  const norm = r => String(r || "").replace(/[\s–—-]+/g, "").toLowerCase();
  const sameAsVerse = hasMemory && !!week.memoryRef && norm(week.memoryRef) === norm(week.verseRef);
  const memory = hasMemory && <MemoryVerse week={week} mode={mode} sameAsVerse={sameAsVerse} />;
  const wrap = { width:"100%", maxWidth: mode === "leader" ? "none" : 400, boxSizing:"border-box", background:"linear-gradient(160deg, #1d2236 0%, #1f2023 60%)", border:"1px solid #3d59a855", borderRadius:14, marginBottom:14, overflow:"hidden", textAlign:"left" };
  const eyebrow = { fontSize:10.5, letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:700, color:"#8ea3e3" };
  const head = { fontSize:11, letterSpacing:"0.14em", textTransform:"uppercase", fontWeight:800, color:"#e95e24", marginBottom:4 };
  const verse = (week.verseRef || week.verseText) && (
    <div style={{ borderLeft:"3px solid #4cad3b", paddingLeft:10 }}>
      {week.verseText && <div style={{ fontSize:14, color:"#f2f1ee", lineHeight:1.5, fontStyle:"italic" }}>{week.verseText}</div>}
      {week.verseRef && <div style={{ fontSize:12.5, color:"#74c464", fontWeight:700, marginTop:3 }}>{week.verseRef}</div>}
    </div>
  );
  const list = items => (
    <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:5 }}>
      {items.map((l, i) => <li key={i} style={{ fontSize:14, color:"#f2f1ee", lineHeight:1.45 }}>{l}</li>)}
    </ul>
  );
  return (
    <div style={wrap}>
      {art && <img src={art} alt={series.name || "Series artwork"} style={{ width:"100%", height: isParent ? 150 : 110, objectFit:"cover", display:"block" }} onError={e => { e.currentTarget.style.display = "none"; }} />}
      <div style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap: isParent ? 14 : 8 }}>
        <div>
          <div style={eyebrow}>
            {isParent ? `${series.name ? series.name + " · " : ""}${prettyDay(week.date)} message` : `${series.name || "This week"} · ${upcoming ? `starts ${prettyDay(week.date)}` : `Week ${number} of ${total}`}`}
          </div>
          {week.title && <div style={{ fontSize:17, fontWeight:800, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif", lineHeight:1.25, marginTop:4 }}>{week.title}</div>}
        </div>
        {!isParent && !sameAsVerse && verse}
        {!isParent && memory}
        {!isParent && week.prayerPrompt && (
          <div style={{ fontSize:13.5, color:"#f2f1ee", lineHeight:1.45 }}><span style={{ color:"#e95e24", fontWeight:700 }}>Pray: </span>{week.prayerPrompt}</div>
        )}
        {isParent && week.parentThink && <div><div style={head}>Think</div><p style={{ margin:0, fontSize:14, color:"#d9d7d2", lineHeight:1.55, whiteSpace:"pre-wrap" }}>{week.parentThink}</p></div>}
        {isParent && verse && !sameAsVerse && <div><div style={head}>Read</div>{verse}</div>}
        {isParent && memory && <div>{sameAsVerse && <div style={head}>Read</div>}{memory}</div>}
        {isParent && ask.length > 0 && <div><div style={head}>Ask</div><div style={{ fontSize:12.5, color:"#80848a", marginBottom:6 }}>Ask your student about this week’s message. Share personally and encourage them.</div>{list(ask)}</div>}
        {isParent && pray.length > 0 && <div><div style={head}>Pray</div><div style={{ fontSize:12.5, color:"#80848a", marginBottom:6 }}>Pray for your student this week that they would:</div>{list(pray)}</div>}
      </div>
    </div>
  );
}

/* Reads a weekly parent recap (Think / Read / Ask / Pray) pasted as text */
function parseRecap(raw) {
  const text = String(raw || "").replace(/\r/g, "").replace(/[ \t]+/g, " ");
  const lines = text.split("\n").map(l => l.trim());
  const sections = { intro: [] };
  let cur = "intro";
  for (const l of lines) {
    const mv = /^(?:weekly\s+)?memory\s+verse\s*:?\s*(.*)$/i.exec(l);
    if (mv) { cur = "memory"; sections.memory = mv[1] ? [mv[1]] : []; continue; }
    const h = /^(think|read|ask|pray)\s*:?\s*$/i.exec(l);
    if (h) { cur = h[1].toLowerCase(); sections[cur] = []; continue; }
    (sections[cur] = sections[cur] || []).push(l);
  }
  const para = arr => (arr || []).join("\n").replace(/\n(?!\n)/g, " ").replace(/\n+/g, "\n").trim();
  const bullets = arr => {
    const out = [];
    let open = false;
    for (const l of arr || []) {
      if (!l) { open = false; continue; }
      if (/^([•●▪◦*-]|\d+[.)])\s*/.test(l)) { out.push(l.replace(/^([•●▪◦*-]|\d+[.)])\s*/, "")); open = true; }
      else if (open && out.length) out[out.length - 1] += " " + l;
    }
    return out;
  };
  const intro = para(sections.intro);
  const nameM = /series (?:called|titled|named)\s+[“"]?(.+?)[”"]?\s*\.(?:\s|$)/i.exec(intro);
  const bookM = /book of ([A-Z0-9][\w ]+?)[\s,.]/.exec(intro);
  const read = para(sections.read);
  const refM = /^(.+?\d+:\d+(?:\s*[-–]\s*\d+)?)\s+(?:says|reads|tells us)[:,]?\s+([\s\S]*)$/i.exec(read);
  const ask = bullets(sections.ask);
  const pray = bullets(sections.pray);
  // Memory verse: "Romans 12:2 — Do not be conformed…", "“Do not…” Romans 12:2", or a reference alone
  const memRaw = para(sections.memory);
  const REF = /((?:[1-3]\s?)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?\s\d+:\d+(?:\s*[-–]\s*\d+)?)/;
  let memoryRef = "", memoryText = "";
  if (memRaw) {
    const m = REF.exec(memRaw);
    if (m) {
      memoryRef = m[1].replace(/\s*[-–]\s*/, "–").trim();
      memoryText = (memRaw.slice(0, m.index) + " " + memRaw.slice(m.index + m[1].length)).replace(/\(\s*(?:ESV|NIV|NLT|CSB|NKJV|KJV|NASB|NIRV|NIrV|MSG|NRSV)\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/^[\s:—–(),-]+|[\s:—–(),-]+$/g, "").trim();
    } else memoryText = memRaw;
  }
  const prayerLead = pray[0] ? `Pray that students would ${pray[0].charAt(0).toLowerCase()}${pray[0].slice(1)}` : "";
  return {
    seriesName: nameM ? nameM[1].trim() : "",
    book: bookM ? bookM[1].trim() : "",
    verseRef: refM ? refM[1].replace(/\s*[-–]\s*/, "–").trim() : "",
    verseText: refM ? refM[2].trim() : read,
    memoryRef, memoryText,
    parentThink: para(sections.think),
    parentPrompt: ask.join("\n"),
    parentPray: pray.join("\n"),
    prayerPrompt: prayerLead,
    found: !!(sections.think || sections.read || sections.ask || sections.pray || sections.memory),
  };
}

// The most recent message night (Sunday, or today if it is Sunday), as YYYY-MM-DD
const MESSAGE_DAY = 0; // 0 = Sunday … 6 = Saturday
function lastWeekday(dow = MESSAGE_DAY) {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7));
  return ymd(d);
}

function SeriesEditor() {
  const [series, setSeries] = React.useState(null);
  const [loaded, setLoaded] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [confirmDel, setConfirmDel] = React.useState(null);
  const [confirmNew, setConfirmNew] = React.useState(false);
  const [paste, setPaste] = React.useState("");
  const [pasteDate, setPasteDate] = React.useState(lastWeekday(MESSAGE_DAY));
  const [pasteMsg, setPasteMsg] = React.useState("");
  const [artBusy, setArtBusy] = React.useState(false);
  const artRef = React.useRef(null);
  React.useEffect(() => {
    fetch("/api/data?key=series", { cache: "no-store" }).then(r => r.ok ? r.json() : null)
      .then(sr => { setSeries(sr || { name: "", weeks: [] }); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  const weeks = (series?.weeks || []);
  function update(fn) { setSeries(prev => fn({ ...prev, weeks: (prev.weeks || []).slice() })); setDirty(true); setMsg(""); }
  function setWeek(id, field, value) { update(sr => ({ ...sr, weeks: sr.weeks.map(w => w.id === id ? { ...w, [field]: value } : w) })); }
  const blankWeek = date => ({ id: genId(), date, title: "", verseRef: "", verseText: "", memoryRef: "", memoryText: "", prayerPrompt: "", parentPrompt: "", parentThink: "", parentPray: "" });
  function addWeek() {
    update(sr => {
      const last = sr.weeks.slice().sort((a, b) => a.date.localeCompare(b.date)).pop();
      const d = last ? new Date(last.date + "T12:00:00") : new Date();
      if (last) d.setDate(d.getDate() + 7);
      else d.setDate(d.getDate() + ((MESSAGE_DAY - d.getDay() + 7) % 7)); // first week: this coming Sunday
      return { ...sr, weeks: [...sr.weeks, blankWeek(ymd(d))] };
    });
  }
  function fillFromPaste() {
    const r = parseRecap(paste);
    if (!r.found) { setPasteMsg("Couldn’t find the THINK / READ / ASK / PRAY sections. Paste the whole recap, including those headings."); return; }
    update(sr => {
      const existing = sr.weeks.find(w => w.date === pasteDate);
      const n = sr.weeks.filter(w => w.date < pasteDate).length + 1;
      const fill = { verseRef: r.verseRef, verseText: r.verseText, memoryRef: r.memoryRef, memoryText: r.memoryText, parentThink: r.parentThink, parentPrompt: r.parentPrompt, parentPray: r.parentPray };
      const weeksNext = existing
        ? sr.weeks.map(w => w.id === existing.id ? { ...w, ...Object.fromEntries(Object.entries(fill).filter(([, v]) => v)), prayerPrompt: w.prayerPrompt || r.prayerPrompt, title: w.title || `Session ${n}` } : w)
        : [...sr.weeks, { ...blankWeek(pasteDate), ...fill, prayerPrompt: r.prayerPrompt, title: `Session ${n}` }];
      return { ...sr, name: sr.name || r.seriesName, book: sr.book || r.book, weeks: weeksNext };
    });
    setPasteMsg(`Filled in the ${prettyDay(pasteDate)} week. Check it below, then Save series.`);
    setPaste("");
  }
  async function uploadArt(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setArtBusy(true);
    try {
      const blob = await resizeImage(file, 1000, false);
      const form = new FormData(); form.append("art", blob, "art.jpg");
      const res = await fetch("/api/art", { method: "POST", body: form });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Upload failed");
      if (window.__lpArtUpload) window.__lpArtUpload(d.v, blob);
      update(sr => ({ ...sr, art: d.v }));
    } catch (err) { setMsg(err.message || "Couldn’t upload the artwork."); }
    setArtBusy(false);
  }
  async function save() {
    setMsg("Saving…");
    try {
      const res = await fetch("/api/data?key=series", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(series) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error();
      setSeries(d.series || { name: "", weeks: [] }); setDirty(false); setMsg("Saved. Everyone sees the update now.");
      window.dispatchEvent(new Event("lp-series-updated"));
    } catch (_e) { setMsg("Couldn’t save. Check your connection and try again."); }
  }
  if (!loaded) return <div style={S.importWrap}><p style={S.reportEmpty}>Loading…</p></div>;

  const field = { ...S.reqInput, width:"100%", boxSizing:"border-box", fontSize:13.5 };
  const lbl = { fontSize:10.5, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, margin:"0 0 4px", display:"block" };
  const hint = t => <span style={{ textTransform:"none", letterSpacing:0, fontWeight:400 }}>{t}</span>;
  const cur = seriesWeek(series);
  const panel = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><BookOpen size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>Teaching Series</p></div>
      <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>
        Each week shows starting on its Sunday night message date. Leaders and students see the verse and prayer prompt; parents see Think, Read, Ask and Pray on the parent page.
      </p>
      {cur && <SeriesCard series={series} mode="leader" />}

      <div style={{ ...panel, marginBottom:14 }}>
        <label style={lbl} htmlFor="series-name">Series name</label>
        <input id="series-name" value={series.name || ""} onChange={e => update(sr => ({ ...sr, name: e.target.value }))} placeholder="e.g. Grace and Transformation" style={field} />
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input ref={artRef} type="file" accept="image/*" onChange={uploadArt} style={{ display:"none" }} />
          {artUrl(series)
            ? <img src={artUrl(series)} alt="" style={{ width:64, height:80, objectFit:"cover", borderRadius:6, flexShrink:0 }} />
            : <div style={{ width:64, height:80, borderRadius:6, border:`1.5px dashed ${C.border}`, display:"flex", alignItems:"center", justifyContent:"center", color:C.muted, flexShrink:0 }}><Camera size={18} /></div>}
          <div style={{ flex:1, minWidth:0, fontSize:12.5, color:C.muted, lineHeight:1.45 }}>Series artwork shows across the top of the series card.</div>
          <button onClick={() => artRef.current && artRef.current.click()} disabled={artBusy} style={S.cancelBtn}>{artBusy ? "Uploading…" : artUrl(series) ? "Change" : "Add artwork"}</button>
        </div>
      </div>

      <div style={{ ...panel, marginBottom:14, borderColor:`${C.blue}66` }}>
        <span style={{ ...lbl, color:"#8ea3e3" }}>Paste a weekly recap</span>
        <p style={{ margin:0, fontSize:12.5, color:C.muted, lineHeight:1.45 }}>Copy the whole parent recap (with the THINK, READ, ASK and PRAY headings) and paste it here. It fills in that week for you.</p>
        <textarea value={paste} onChange={e => { setPaste(e.target.value); setPasteMsg(""); }} rows={4} placeholder={"This week, we kicked off a new teaching series called…\nTHINK\n…\nREAD\n…\nASK\n• …\nPRAY\n• …"} style={{ ...field, resize:"vertical", lineHeight:1.45 }} />
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
          <span style={{ fontSize:12.5, color:C.muted }}>Message date</span>
          <input type="date" value={pasteDate} onChange={e => e.target.value && setPasteDate(e.target.value)} style={S.gradeSelect} aria-label="Message date for the pasted recap" />
          <button onClick={fillFromPaste} disabled={!paste.trim()} style={{ ...S.reqAddBtn, marginLeft:"auto", opacity: paste.trim() ? 1 : 0.5 }}>Fill in this week</button>
        </div>
        {pasteMsg && <p style={{ margin:0, fontSize:12.5, color: /Couldn/.test(pasteMsg) ? "#e07a5f" : C.accentLight }}>{pasteMsg}</p>}
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {weeks.slice().sort((a, b) => a.date.localeCompare(b.date)).map((w, i) => (
          <div key={w.id} style={{ ...panel, borderColor: cur && cur.week.id === w.id && !cur.upcoming ? C.accent : C.border }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ fontSize:13, fontWeight:700, color:C.cream }}>Week {i + 1}</span>
              {cur && cur.week.id === w.id && !cur.upcoming && <span style={{ ...S.badgeSm, background:C.accentBg, color:C.accentLight }}>showing now</span>}
              <input type="date" value={w.date} onChange={e => e.target.value && setWeek(w.id, "date", e.target.value)} aria-label={`Week ${i + 1} message date`} style={{ ...S.gradeSelect, marginLeft:"auto" }} />
            </div>
            <div><label style={lbl}>Message title</label><input value={w.title} onChange={e => setWeek(w.id, "title", e.target.value)} placeholder="e.g. Not ashamed" style={field} /></div>
            <div><label style={lbl}>Verse reference</label><input value={w.verseRef} onChange={e => setWeek(w.id, "verseRef", e.target.value)} placeholder="e.g. Romans 1:16–17" style={field} /></div>
            <div><label style={lbl}>Verse text {hint("(from the translation you teach)")}</label><textarea value={w.verseText} onChange={e => setWeek(w.id, "verseText", e.target.value)} rows={3} style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
            <div style={{ background:"#2a1c15", border:"1px solid #e95e2433", borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:8 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ ...lbl, color:"#f08a5d", margin:0 }}>⭐ Memory verse {hint("(students, leaders, parents)")}</span>
                {(w.verseRef || w.verseText) && <button onClick={() => { setWeek(w.id, "memoryRef", w.verseRef || ""); setWeek(w.id, "memoryText", w.verseText || ""); }} style={{ marginLeft:"auto", background:"none", border:`1px solid ${C.border}`, color:C.cream, borderRadius:14, padding:"3px 9px", fontSize:11.5, cursor:"pointer", whiteSpace:"nowrap", fontFamily:"'Inter', system-ui, sans-serif" }}>Same as this week’s verse</button>}
              </div>
              <input value={w.memoryRef || ""} onChange={e => setWeek(w.id, "memoryRef", e.target.value)} placeholder="Reference, e.g. Romans 12:2" aria-label={`Week ${i + 1} memory verse reference`} style={field} />
              <textarea value={w.memoryText || ""} onChange={e => setWeek(w.id, "memoryText", e.target.value)} rows={2} placeholder="The words to memorize (keep it short: one or two verses)" aria-label={`Week ${i + 1} memory verse text`} style={{ ...field, resize:"vertical", lineHeight:1.45 }} />
            </div>
            <div><label style={lbl}>Prayer prompt {hint("(students and leaders)")}</label><textarea value={w.prayerPrompt} onChange={e => setWeek(w.id, "prayerPrompt", e.target.value)} rows={2} placeholder="e.g. Pray that students would not be ashamed of the gospel." style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
            <div style={{ borderTop:`1px solid ${C.faint}`, paddingTop:10, display:"flex", flexDirection:"column", gap:10 }}>
              <span style={{ ...lbl, color:"#b49ad0", margin:0 }}>For parents</span>
              <div><label style={lbl}>Think {hint("(the big idea)")}</label><textarea value={w.parentThink || ""} onChange={e => setWeek(w.id, "parentThink", e.target.value)} rows={3} style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
              <div><label style={lbl}>Ask {hint("(one question per line)")}</label><textarea value={w.parentPrompt || ""} onChange={e => setWeek(w.id, "parentPrompt", e.target.value)} rows={3} style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
              <div><label style={lbl}>Pray {hint("(one per line: “pray that they would…”)")}</label><textarea value={w.parentPray || ""} onChange={e => setWeek(w.id, "parentPray", e.target.value)} rows={2} style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
              {confirmDel === w.id ? (
                <>
                  <span style={{ fontSize:12, color:C.muted, alignSelf:"center" }}>Remove this week?</span>
                  <button onClick={() => { update(sr => ({ ...sr, weeks: sr.weeks.filter(x => x.id !== w.id) })); setConfirmDel(null); }} style={{ ...S.reqAddBtn, background:"#8a5050", color:"#fff" }}>Remove</button>
                  <button onClick={() => setConfirmDel(null)} style={S.cancelBtn}>Cancel</button>
                </>
              ) : <button onClick={() => setConfirmDel(w.id)} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer" }}>Remove week</button>}
            </div>
          </div>
        ))}
      </div>

      <button onClick={addWeek} style={{ ...S.addReqTrigger, marginTop:12, alignSelf:"stretch", justifyContent:"center", padding:"10px 12px", fontSize:13 }}><Plus size={14} style={{ marginRight:5 }} /> Add a week</button>

      <div style={{ position:"sticky", bottom:0, background:C.bg, padding:"12px 0", marginTop:12, display:"flex", alignItems:"center", gap:10, borderTop:`1px solid ${C.border}` }}>
        <button onClick={save} disabled={!dirty} style={{ ...S.confirmBtn, opacity: dirty ? 1 : 0.5 }}>Save series</button>
        <span style={{ fontSize:12, color: /Couldn/.test(msg) ? "#e07a5f" : dirty ? C.orange : C.muted }}>{msg || (dirty ? "Unsaved changes" : "")}</span>
        {!confirmNew
          ? <button onClick={() => setConfirmNew(true)} style={{ marginLeft:"auto", background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer" }}>Start a new series…</button>
          : <span style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ fontSize:12, color:C.muted }}>Clear all weeks?</span>
              <button onClick={() => { update(() => ({ name: "", weeks: [], art: 0 })); setConfirmNew(false); }} style={{ ...S.reqAddBtn, background:"#8a5050", color:"#fff" }}>Clear</button>
              <button onClick={() => setConfirmNew(false)} style={S.cancelBtn}>No</button>
            </span>}
      </div>
    </div>
  );
}

/* ── Calendar from BAND (or any iCal link) ── */
function useCalendar(dep) {
  const [cal, setCal] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/calendar", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => { if (alive && d) setCal(d); }).catch(() => {});
    load();
    window.addEventListener("lp-calendar-updated", load);
    const t = setInterval(load, 15 * 60 * 1000);
    return () => { alive = false; window.removeEventListener("lp-calendar-updated", load); clearInterval(t); };
  }, [dep]);
  return cal;
}
const calDate = d => new Date(d.slice(0, 10) + "T12:00:00");
function calDayLabel(day) {
  const t = ymd(), tm = ymd(new Date(Date.now() + 864e5));
  if (day === t) return "Today";
  if (day === tm) return "Tomorrow";
  return calDate(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}
function calTime(e) {
  const short = d => calDate(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (e.allDay) return e.end && e.end !== e.start ? `${short(e.start)} – ${short(e.end)}` : "All day";
  const t = x => { const [h, m] = x.slice(11, 16).split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? " AM" : " PM"}`; };
  const sameDay = e.end && e.end.slice(0, 10) === e.start.slice(0, 10);
  return e.end && e.end !== e.start ? (sameDay ? `${t(e.start)} – ${t(e.end)}` : `${t(e.start)} – ${short(e.end)}, ${t(e.end)}`) : t(e.start);
}
const linkify = text => String(text).split(/(https?:\/\/[^\s]+)/g).map((part, i) => /^https?:\/\//.test(part)
  ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ color:"#8ea3e3", wordBreak:"break-all" }}>{part}</a> : part);

// The first sign-up / registration link in an event (its link field, or a link in the description)
const FORM_HOSTS = /(forms\.gle|docs\.google\.com\/forms|forms\.office\.com|jotform|typeform|wufoo|cognitoforms|formstack|churchcenter|onechurch|ministryplatform|planningcenter|eventbrite|signupgenius|subsplash|tithe\.ly|pushpay|ccbchurch|breezechms|rockrms|squarespace|form)/i;
function signupLink(e) {
  const links = [e.link, ...String(e.desc || "").match(/https?:\/\/[^\s<>"]+/g) || []].filter(Boolean).map(u => u.replace(/[).,;!?]+$/, ""));
  if (!links.length) return null;
  const words = /regist|sign[\s-]?up|form|rsvp|apply|permission|waiver/i.test(e.desc || "") || /regist|sign[\s-]?up|rsvp/i.test(e.title || "");
  return links.find(u => FORM_HOSTS.test(u)) || (words ? links[0] : null);
}

function CalendarList({ cal, limit = 0, emptyText, title = "Coming up", maxWidth = 400 }) {
  const [open, setOpen] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);
  if (!cal || !cal.configured) return null;
  const today = ymd();
  const all = (cal.events || []).filter(e => (e.allDay ? (e.end || e.start) : e.start.slice(0, 10)) >= today || (e.end || "").slice(0, 10) >= today);
  const list = limit && !showAll ? all.slice(0, limit) : all;
  const days = [];
  for (const e of list) {
    const day = e.allDay && e.start < today ? today : e.start.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(e); else days.push({ day, items: [e] });
  }
  return (
    <div style={{ width:"100%", maxWidth, boxSizing:"border-box", background:"#1f2023", border:"1px solid #34363a", borderRadius:14, padding:"14px 16px", marginBottom:14, textAlign:"left" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
        <CalendarDays size={16} color="#8ea3e3" />
        <span style={{ fontSize:14, fontWeight:700, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif" }}>{title}</span>
        {cal.updated && <span style={{ marginLeft:"auto", fontSize:11, color:"#80848a" }}>from BAND</span>}
      </div>
      {days.length === 0 && <p style={{ margin:0, fontSize:13, color:"#80848a" }}>{emptyText || "Nothing on the calendar yet."}</p>}
      {days.map(({ day, items }) => (
        <div key={day} style={{ marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color: day === today ? "#74c464" : "#80848a", marginBottom:4 }}>{calDayLabel(day)}</div>
          {items.map(e => {
            const isOpen = open === e.id;
            const more = e.desc;
            return (
              <div key={e.id} style={{ borderLeft:`3px solid ${e.leadersOnly ? "#e6b34a" : "#3d59a8"}`, padding:"6px 0 6px 10px", marginBottom:4 }}>
                <button onClick={() => more && setOpen(isOpen ? null : e.id)} aria-expanded={more ? isOpen : undefined} style={{ display:"block", width:"100%", textAlign:"left", background:"none", border:"none", padding:0, cursor: more ? "pointer" : "default", fontFamily:"'Inter', system-ui, sans-serif" }}>
                  <div style={{ fontSize:14, fontWeight:600, color:"#f2f1ee", lineHeight:1.3 }}>
                    {e.title}
                    {e.leadersOnly && <span style={{ marginLeft:6, fontSize:10, fontWeight:700, color:"#e6b34a", border:"1px solid #e6b34a66", borderRadius:6, padding:"1px 5px", verticalAlign:"middle" }}>LEADERS</span>}
                  </div>
                  <div style={{ fontSize:12.5, color:"#a9acb1", marginTop:2 }}>{calTime(e)}{e.location ? ` · ${e.location}` : ""}</div>
                </button>
                {isOpen && e.desc && <div style={{ fontSize:13, color:"#d9d7d2", lineHeight:1.5, marginTop:6, whiteSpace:"pre-wrap" }}>{linkify(e.desc)}</div>}
                {signupLink(e) && <a href={signupLink(e)} target="_blank" rel="noopener noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:5, marginTop:7, background:"#4cad3b", color:"#101112", borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:700, textDecoration:"none", fontFamily:"'Inter', system-ui, sans-serif" }}>Register →</a>}
              </div>
            );
          })}
        </div>
      ))}
      {limit > 0 && all.length > limit && (
        <button onClick={() => setShowAll(v => !v)} style={{ background:"none", border:"none", color:"#74c464", fontSize:13, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter', system-ui, sans-serif" }}>
          {showAll ? "Show less" : `See all ${all.length} events →`}
        </button>
      )}
    </div>
  );
}

function CalendarSetup() {
  const [feeds, setFeeds] = React.useState(null);
  const [msg, setMsg] = React.useState("");
  const [tests, setTests] = React.useState({});
  const [dirty, setDirty] = React.useState(false);
  const [errors, setErrors] = React.useState([]);
  React.useEffect(() => {
    fetch("/api/calendar?action=feeds").then(r => r.ok ? r.json() : []).then(l => setFeeds(Array.isArray(l) ? l : [])).catch(() => setFeeds([]));
    fetch("/api/calendar").then(r => r.ok ? r.json() : null).then(d => d && setErrors(d.errors || [])).catch(() => {});
  }, []);
  function setF(id, k, v) { setFeeds(fs => fs.map(f => f.id === id ? { ...f, [k]: v } : f)); setDirty(true); setMsg(""); }
  async function test(f) {
    setTests(t => ({ ...t, [f.id]: { busy: true } }));
    try {
      const r = await fetch("/api/calendar", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ action:"test", url: f.url }) });
      const d = await r.json();
      setTests(t => ({ ...t, [f.id]: r.ok ? { ok: true, text: d.count ? `Found ${d.count} upcoming event${d.count === 1 ? "" : "s"}. Next: ${d.next.map(n => n.title).join(", ")}` : "The link works, but there are no upcoming events on it yet." } : { ok: false, text: d.error || "That link didn’t work." } }));
    } catch (_e) { setTests(t => ({ ...t, [f.id]: { ok: false, text: "Couldn’t reach that link." } })); }
  }
  async function save() {
    setMsg("Saving…");
    try {
      const r = await fetch("/api/calendar", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ action:"save", feeds }) });
      const d = await r.json();
      if (!r.ok) throw new Error();
      await fetch("/api/calendar", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ action:"refresh" }) });
      setFeeds(d.feeds); setDirty(false); setMsg("Saved. The calendar is updated."); setErrors([]);
      window.dispatchEvent(new Event("lp-calendar-updated"));
    } catch (_e) { setMsg("Couldn’t save. Check each link."); }
  }
  async function refresh() {
    setMsg("Checking BAND…");
    try {
      const r = await fetch("/api/calendar", { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ action:"refresh" }) });
      const d = await r.json();
      setMsg(d.counts.map(c => c.error ? `${c.cal}: ${c.error}` : `${c.cal}: ${c.count} upcoming`).join(" · ") || "No calendars yet.");
      window.dispatchEvent(new Event("lp-calendar-updated"));
    } catch (_e) { setMsg("Couldn’t refresh right now."); }
  }
  if (!feeds) return <div style={S.importWrap}><p style={S.reportEmpty}>Loading…</p></div>;
  const field = { ...S.reqInput, width:"100%", boxSizing:"border-box", fontSize:13.5 };
  const lbl = { fontSize:10.5, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, margin:"0 0 4px", display:"block" };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><CalendarDays size={16} color="#8ea3e3" /><p style={{ ...S.reportTitle, margin:0, color:"#8ea3e3" }}>Calendar from BAND</p></div>
      <p style={{ margin:"0 0 10px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>Events from your BAND calendar show in Let’s Pray and update on their own (about every 30 minutes). Keep using BAND to add and change events.</p>
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", marginBottom:14, fontSize:13, color:C.cream, lineHeight:1.55 }}>
        <div style={{ fontWeight:700, marginBottom:4 }}>Get your BAND calendar link</div>
        <ol style={{ margin:0, paddingLeft:18 }}>
          <li>Open your IMPACT Band and go to the <b>Calendar</b> tab.</li>
          <li>Tap <b>Manage Events</b> (on a computer at band.us: Band settings), then <b>Export Band Calendars</b>.</li>
          <li>Copy the link and paste it below.</li>
        </ol>
        <div style={{ color:C.muted, fontSize:12, marginTop:6 }}>Treat the link like a password: anyone with it can see the calendar. Let’s Pray keeps it on the server and never shows it to leaders, students or parents.</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {feeds.map(f => (
          <div key={f.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
            <div><label style={lbl}>Name</label><input value={f.name} onChange={e => setF(f.id, "name", e.target.value)} placeholder="e.g. IMPACT Students" style={field} /></div>
            <div><label style={lbl}>BAND calendar link</label><input value={f.url} onChange={e => setF(f.id, "url", e.target.value)} placeholder="Paste the Export Band Calendars link" style={field} autoComplete="off" spellCheck={false} /></div>
            <div>
              <label style={lbl}>Who sees these events</label>
              <div style={{ display:"flex", gap:6 }}>
                {[["everyone", "Everyone (leaders, students, parents)"], ["leaders", "Leaders only"]].map(([v, l]) => (
                  <button key={v} onClick={() => setF(f.id, "audience", v)} aria-pressed={f.audience === v} style={{ flex:1, padding:"8px 6px", borderRadius:8, border:`1px solid ${f.audience === v ? C.accent : C.border}`, background: f.audience === v ? C.accentBg : "none", color: f.audience === v ? C.cream : C.muted, fontSize:12.5, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <button onClick={() => test(f)} disabled={!f.url.trim()} style={{ ...S.reqAddBtn, opacity: f.url.trim() ? 1 : 0.5 }}>Test link</button>
              <button onClick={() => { setFeeds(fs => fs.filter(x => x.id !== f.id)); setDirty(true); }} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer", marginLeft:"auto" }}>Remove</button>
            </div>
            {tests[f.id] && !tests[f.id].busy && <div style={{ fontSize:12.5, color: tests[f.id].ok ? C.accentLight : "#e07a5f", lineHeight:1.45 }}>{tests[f.id].text}</div>}
            {tests[f.id] && tests[f.id].busy && <div style={{ fontSize:12.5, color:C.muted }}>Checking…</div>}
            {errors.filter(e => e.cal === f.name).map((e, i) => <div key={i} style={{ fontSize:12.5, color:"#e07a5f" }}>Last check: {e.error}</div>)}
          </div>
        ))}
      </div>
      {feeds.length < 6 && (
        <button onClick={() => { setFeeds(fs => [...fs, { id: genId(), name: fs.length ? "" : "IMPACT Students", url: "", audience: "everyone" }]); setDirty(true); }} style={{ ...S.addReqTrigger, marginTop:12, alignSelf:"stretch", justifyContent:"center", padding:"10px 12px", fontSize:13 }}>
          <Plus size={14} style={{ marginRight:5 }} /> {feeds.length ? "Add another BAND calendar" : "Add your BAND calendar"}
        </button>
      )}
      <p style={{ margin:"10px 0 0", fontSize:12, color:C.muted, lineHeight:1.5 }}>Have a separate leaders Band? Add its calendar too and set it to “Leaders only.”</p>
      <div style={{ position:"sticky", bottom:0, background:C.bg, padding:"12px 0", marginTop:12, display:"flex", alignItems:"center", gap:10, borderTop:`1px solid ${C.border}`, flexWrap:"wrap" }}>
        <button onClick={save} disabled={!dirty} style={{ ...S.confirmBtn, opacity: dirty ? 1 : 0.5 }}>Save calendar</button>
        {!dirty && feeds.length > 0 && <button onClick={refresh} style={S.cancelBtn}>Refresh now</button>}
        <span style={{ fontSize:12, color: /Couldn|:.*(didn|answered)/.test(msg) ? "#e07a5f" : dirty ? C.orange : C.muted, lineHeight:1.4 }}>{msg || (dirty ? "Unsaved changes" : "")}</span>
      </div>
    </div>
  );
}

/* ── Event prayer focus (camp, retreats, mission trips) ── */
const dayNum = d => Math.round(new Date(d + "T12:00:00").getTime() / 864e5);
function eventStatus(e) {
  if (!e || !e.start) return null;
  const today = dayNum(ymd()), start = dayNum(e.start), end = dayNum(e.end && e.end >= e.start ? e.end : e.start);
  if (today < start) return start - today <= 45 ? { phase: "upcoming", days: start - today } : null;
  if (today <= end) return { phase: "now", day: today - start + 1, total: end - start + 1 };
  return null;
}
function useEvents(dep) {
  const [events, setEvents] = React.useState([]);
  React.useEffect(() => {
    const load = () => fetch("/api/data?key=events", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) && setEvents(l)).catch(() => {});
    load();
    window.addEventListener("lp-events-updated", load);
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { window.removeEventListener("lp-events-updated", load); clearInterval(t); };
  }, [dep]);
  return [events, setEvents];
}
const prettyRange = e => {
  const f = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return e.end && e.end !== e.start ? `${f(e.start)} – ${f(e.end)}` : f(e.start);
};

function EventCards({ events, mode = "leader", onPrayThrough }) {
  const live = (events || []).map(e => ({ e, st: eventStatus(e) })).filter(x => x.st);
  if (!live.length) return null;
  return (
    <>
      {live.map(({ e, st }) => {
        const going = mode === "leader" ? (e.attendees || []).length : (e.going || 0);
        const points = splitLines(e.prayerPoints);
        return (
          <div key={e.id} style={{ width:"100%", maxWidth: mode === "leader" ? "none" : 400, boxSizing:"border-box", background:"linear-gradient(150deg, #2c1a12 0%, #1f2023 70%)", border:"1px solid #e95e2455", borderRadius:14, padding:"14px 16px", marginBottom:14, display:"flex", flexDirection:"column", gap:8, textAlign:"left" }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
              <div style={{ fontSize:10.5, letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:700, color:"#f08a5d" }}>{st.phase === "now" ? `Happening now · Day ${st.day} of ${st.total}` : `${prettyRange(e)} · pray now`}</div>
              {st.phase === "upcoming" && (
                <div style={{ marginLeft:"auto", textAlign:"right", lineHeight:1 }}>
                  <span style={{ fontSize:24, fontWeight:800, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif", fontVariantNumeric:"tabular-nums" }}>{st.days}</span>
                  <span style={{ fontSize:11, color:"#80848a", display:"block", marginTop:2 }}>{st.days === 1 ? "day to go" : "days to go"}</span>
                </div>
              )}
            </div>
            <div style={{ fontSize:18, fontWeight:800, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif", lineHeight:1.2, marginTop: st.phase === "upcoming" ? -4 : 0 }}>{e.name}</div>
            {e.focus && <p style={{ margin:0, fontSize:13.5, color:"#d9d7d2", lineHeight:1.5, whiteSpace:"pre-wrap" }}>{e.focus}</p>}
            {points.length > 0 && (
              <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:4 }}>
                {points.map((l, i) => <li key={i} style={{ fontSize:13.5, color:"#f2f1ee", lineHeight:1.45 }}>{l}</li>)}
              </ul>
            )}
            {going > 0 && mode !== "leader" && <div style={{ fontSize:12.5, color:"#80848a" }}>{going} going. Pray for every one of them.</div>}
            {e.link && st.phase === "upcoming" && (
              <a href={e.link} target="_blank" rel="noopener noreferrer" style={{ alignSelf:"flex-start", background:"#4cad3b", color:"#101112", borderRadius:10, padding:"9px 14px", fontSize:13.5, fontWeight:700, textDecoration:"none", fontFamily:"'Inter', system-ui, sans-serif" }}>
                {mode === "leader" ? "Registration form →" : "Register →"}
              </a>
            )}
            {mode === "leader" && going > 0 && onPrayThrough && (
              <button onClick={() => onPrayThrough(e.id)} style={{ alignSelf:"flex-start", background:"#e95e24", color:"#fff", border:"none", borderRadius:10, padding:"9px 14px", fontSize:13.5, fontWeight:700, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                🙏 Pray through the {going} going
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

function EventsEditor({ people, smallGroups }) {
  const [events, setEvents] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [openId, setOpenId] = React.useState(null);
  const [search, setSearch] = React.useState("");
  const [confirmDel, setConfirmDel] = React.useState(null);
  React.useEffect(() => {
    fetch("/api/data?key=events", { cache: "no-store" }).then(r => r.ok ? r.json() : []).then(l => setEvents(Array.isArray(l) ? l : [])).catch(() => setEvents([]));
  }, []);
  const roster = React.useMemo(() => people.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)), [people]);
  function change(fn) { setEvents(prev => fn(prev.slice())); setDirty(true); setMsg(""); }
  function setEv(id, field, value) { change(list => list.map(e => e.id === id ? { ...e, [field]: value } : e)); }
  function addEvent() {
    const d = new Date(); d.setDate(d.getDate() + 14);
    const id = genId();
    change(list => [...list, { id, name: "", start: ymd(d), end: ymd(d), focus: "", prayerPoints: "", link: "", attendees: [] }]);
    setOpenId(id);
  }
  function toggleAtt(id, pid) { change(list => list.map(e => e.id !== id ? e : { ...e, attendees: e.attendees.includes(pid) ? e.attendees.filter(x => x !== pid) : [...e.attendees, pid] })); }
  function addMany(id, pids) { change(list => list.map(e => e.id !== id ? e : { ...e, attendees: Array.from(new Set([...e.attendees, ...pids])) })); }
  async function save() {
    setMsg("Saving…");
    try {
      const res = await fetch("/api/data?key=events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(events.filter(e => e.name.trim())) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error();
      setEvents(d.events); setDirty(false); setMsg("Saved."); window.dispatchEvent(new Event("lp-events-updated"));
    } catch (_e) { setMsg("Couldn’t save. Give each event a name and a start date."); }
  }
  if (!events) return <div style={S.importWrap}><p style={S.reportEmpty}>Loading…</p></div>;
  const field = { ...S.reqInput, width:"100%", boxSizing:"border-box", fontSize:13.5 };
  const lbl = { fontSize:10.5, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, margin:"0 0 4px", display:"block" };
  const quick = { background:"none", border:`1px solid ${C.border}`, color:C.cream, borderRadius:14, padding:"4px 10px", fontSize:12, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><Star size={16} color={C.orange} /><p style={{ ...S.reportTitle, margin:0, color:C.orange }}>Event Prayer Focus</p></div>
      <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>Camp, retreats, mission trips. A countdown card shows for leaders, students and parents starting up to 45 days out. Leaders can pray through everyone going; students and parents only see how many are going.</p>
      {events.length === 0 && <p style={S.reportEmpty}>No events yet.</p>}
      <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
        {events.map(e => {
          const open = openId === e.id;
          const st = eventStatus(e);
          return (
            <div key={e.id} style={{ background:C.surface, border:`1px solid ${st ? C.orange + "88" : C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
              <button onClick={() => setOpenId(open ? null : e.id)} style={{ display:"flex", alignItems:"center", gap:8, background:"none", border:"none", padding:0, cursor:"pointer", textAlign:"left", color:C.cream, fontFamily:"'Inter', system-ui, sans-serif" }}>
                <span style={{ fontSize:14, fontWeight:700, flex:1, minWidth:0 }}>{e.name || "New event"}</span>
                <span style={{ fontSize:12, color:C.muted }}>{prettyRange(e)} · {e.attendees.length} going</span>
                <ChevronRight size={16} color={C.muted} style={{ transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
              </button>
              {open && (
                <>
                  <div><label style={lbl}>Event name</label><input value={e.name} onChange={x => setEv(e.id, "name", x.target.value)} placeholder="e.g. Fall Retreat" style={field} /></div>
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                    <div style={{ flex:1, minWidth:130 }}><label style={lbl}>Starts</label><input type="date" value={e.start || ""} onChange={x => x.target.value && setEv(e.id, "start", x.target.value)} style={{ ...field, colorScheme:"dark" }} /></div>
                    <div style={{ flex:1, minWidth:130 }}><label style={lbl}>Ends</label><input type="date" value={e.end || ""} onChange={x => x.target.value && setEv(e.id, "end", x.target.value)} style={{ ...field, colorScheme:"dark" }} /></div>
                  </div>
                  <div><label style={lbl}>Registration link <span style={{ textTransform:"none", letterSpacing:0, fontWeight:400 }}>(optional: shows a Register button until the event starts)</span></label><input value={e.link || ""} onChange={x => setEv(e.id, "link", x.target.value.trim())} placeholder="https://… (your sign-up form)" inputMode="url" style={field} />{e.link && !/^https:\/\//i.test(e.link) && <div style={{ fontSize:12, color:"#e07a5f", marginTop:4 }}>The link needs to start with https://</div>}</div>
                  <div><label style={lbl}>Prayer focus</label><textarea value={e.focus} onChange={x => setEv(e.id, "focus", x.target.value)} rows={3} placeholder="e.g. Pray that every student would meet Jesus this weekend." style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
                  <div><label style={lbl}>Prayer points <span style={{ textTransform:"none", letterSpacing:0, fontWeight:400 }}>(one per line)</span></label><textarea value={e.prayerPoints} onChange={x => setEv(e.id, "prayerPoints", x.target.value)} rows={3} placeholder={"Safe travel\nOpen hearts during worship\nLeaders with energy and wisdom"} style={{ ...field, resize:"vertical", lineHeight:1.45 }} /></div>
                  <div>
                    <label style={lbl}>Who’s going · {e.attendees.length}</label>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                      <button onClick={() => addMany(e.id, roster.filter(p => p.type === "student").map(p => p.id))} style={quick}>+ All students</button>
                      <button onClick={() => addMany(e.id, roster.filter(p => p.type === "student" && inHS(p)).map(p => p.id))} style={quick}>+ HS</button>
                      <button onClick={() => addMany(e.id, roster.filter(p => p.type === "student" && inMS(p)).map(p => p.id))} style={quick}>+ MS</button>
                      <button onClick={() => addMany(e.id, roster.filter(p => p.type === "leader").map(p => p.id))} style={quick}>+ Leaders</button>
                      {smallGroups.map(g => <button key={g.id} onClick={() => addMany(e.id, roster.filter(p => inSG(p, g.id)).map(p => p.id))} style={quick}>+ {g.name}</button>)}
                      {e.attendees.length > 0 && <button onClick={() => setEv(e.id, "attendees", [])} style={{ ...quick, color:C.muted }}>Clear</button>}
                    </div>
                    <input value={search} onChange={x => setSearch(x.target.value)} placeholder="Search to add or remove people…" style={{ ...field, marginBottom:6 }} />
                    <div style={{ maxHeight:220, overflowY:"auto", border:`1px solid ${C.faint}`, borderRadius:8 }}>
                      {roster.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).map(p => (
                        <label key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderBottom:`1px solid ${C.faint}`, fontSize:13, color:C.cream, cursor:"pointer" }}>
                          <input type="checkbox" checked={e.attendees.includes(p.id)} onChange={() => toggleAtt(e.id, p.id)} style={{ accentColor:C.accent }} />
                          <span style={{ flex:1 }}>{p.name}</span>
                          <span style={{ fontSize:11, color:C.muted }}>{p.type === "leader" ? "leader" : p.grade ? `${ordinal(p.grade)}` : ""}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div style={{ display:"flex", justifyContent:"flex-end", gap:8 }}>
                    {confirmDel === e.id ? (
                      <>
                        <span style={{ fontSize:12, color:C.muted, alignSelf:"center" }}>Delete this event?</span>
                        <button onClick={() => { change(list => list.filter(x => x.id !== e.id)); setConfirmDel(null); }} style={{ ...S.reqAddBtn, background:"#8a5050", color:"#fff" }}>Delete</button>
                        <button onClick={() => setConfirmDel(null)} style={S.cancelBtn}>Cancel</button>
                      </>
                    ) : <button onClick={() => setConfirmDel(e.id)} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer" }}>Delete event</button>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <button onClick={addEvent} style={{ ...S.addReqTrigger, marginTop:12, alignSelf:"stretch", justifyContent:"center", padding:"10px 12px", fontSize:13 }}><Plus size={14} style={{ marginRight:5 }} /> Add an event</button>
      <div style={{ position:"sticky", bottom:0, background:C.bg, padding:"12px 0", marginTop:12, display:"flex", alignItems:"center", gap:10, borderTop:`1px solid ${C.border}` }}>
        <button onClick={save} disabled={!dirty} style={{ ...S.confirmBtn, opacity: dirty ? 1 : 0.5 }}>Save events</button>
        <span style={{ fontSize:12, color: /Couldn/.test(msg) ? "#e07a5f" : dirty ? C.orange : C.muted }}>{msg || (dirty ? "Unsaved changes" : "")}</span>
      </div>
    </div>
  );
}

/* ── Leader follow-up nudges: who to check in with this week ── */
const CHECKIN_KEY = () => `lp-checkin-${new Date(getWeekStartET()).toISOString().slice(0, 10)}`;
const DAY = 864e5;

function checkInReasons(p, now = Date.now()) {
  const out = [];
  const fam = (p.familyRequests || []).find(f => now - (f.at || 0) < 7 * DAY);
  if (fam) out.push({ key: "fam", label: fam.dontMention ? "Family shared a request (don’t mention it)" : "Their family shared a request", color: "#b49ad0", rank: 0 });
  if ((p.reqTimes || []).some(t => now - t < 7 * DAY)) out.push({ key: "req", label: "New prayer request this week", color: "#8ea3e3", rank: 1 });
  const b = getBirthdayStatus(p.birthday);
  if (b && (b.today || b.urgent || b.label)) {
    const days = (() => { if (!p.birthday) return 99; const [m, d] = p.birthday.split("-").map(Number); const t = new Date(); t.setHours(0,0,0,0); let x = new Date(t.getFullYear(), m - 1, d); if (x < t) x.setFullYear(t.getFullYear() + 1); return Math.round((x - t) / DAY); })();
    if (days <= 7) out.push({ key: "bday", label: days === 0 ? "Birthday today 🎂" : `Birthday in ${days} day${days === 1 ? "" : "s"} 🎂`, color: "#e6b34a", rank: 2 });
  }
  const g = (p.gospelLog || []).find(x => now - (x.at || 0) < 14 * DAY);
  if (g) out.push({ key: "gospel", label: g.outcome === "trusted" ? "A friend trusted Jesus! Celebrate 🎉" : "Shared the Gospel. Ask how it went", color: C.orange, rank: 1 });
  const since = p.prayedAt ? now - p.prayedAt : Infinity;
  if (since >= 14 * DAY) out.push({ key: "quiet", label: p.prayedAt ? `Not prayed for in ${Math.floor(since / (7 * DAY))} weeks` : "Not prayed for yet", color: C.muted, rank: 3 });
  return out.sort((a, b) => a.rank - b.rank);
}

function CheckInCard({ people, myGroupId, groupName, isAdmin, goToPerson }) {
  const [done, setDone] = React.useState(() => { try { return JSON.parse(lsGet(CHECKIN_KEY()) || "[]"); } catch (_e) { return []; } });
  const [open, setOpen] = React.useState(() => lsGet("lp-checkin-open") !== "0");
  const [calls, setCalls] = React.useState(0);
  React.useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/family").then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) && setCalls(l.filter(f => f.followUp && !f.done).length)).catch(() => {});
  }, [isAdmin]);
  const scope = people.filter(p => p.active !== false && p.type === "student" && (!myGroupId || inSG(p, myGroupId)));
  const items = scope.map(p => ({ p, reasons: checkInReasons(p) })).filter(x => x.reasons.length)
    .sort((a, b) => a.reasons[0].rank - b.reasons[0].rank || (a.p.prayedAt || 0) - (b.p.prayedAt || 0));
  const limit = myGroupId ? 12 : 6;
  const todo = items.filter(x => !done.includes(x.p.id));
  const shown = [...todo, ...items.filter(x => done.includes(x.p.id))].slice(0, limit);
  if (!items.length && !calls) return null;
  function toggle(id) {
    const next = done.includes(id) ? done.filter(x => x !== id) : [...done, id];
    setDone(next); lsSet(CHECKIN_KEY(), JSON.stringify(next));
  }
  function flip() { setOpen(o => { lsSet("lp-checkin-open", o ? "0" : "1"); return !o; }); }
  return (
    <div style={{ width:"100%", boxSizing:"border-box", background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, marginBottom:12 }}>
      <button onClick={flip} style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"12px 14px", background:"none", border:"none", cursor:"pointer", color:C.cream, fontFamily:"'Inter', system-ui, sans-serif" }}>
        <Users size={15} color={C.accent} />
        <span style={{ fontSize:14, fontWeight:700 }}>Check in this week</span>
        <span style={{ fontSize:12, color:C.muted }}>{myGroupId && groupName(myGroupId) ? `· ${groupName(myGroupId)}` : ""}</span>
        {todo.length > 0 && <span style={{ ...S.tabBadge, position:"static", background:C.accent, color:"#101112" }}>{todo.length}</span>}
        <ChevronRight size={16} color={C.muted} style={{ marginLeft:"auto", transform: open ? "rotate(90deg)" : "none", transition:"transform 0.15s" }} />
      </button>
      {open && (
        <div style={{ padding:"0 14px 12px", display:"flex", flexDirection:"column", gap:2 }}>
          {isAdmin && calls > 0 && <div style={{ fontSize:13, color:C.cream, background:"#221e29", border:"1px solid #b49ad033", borderRadius:10, padding:"9px 12px", marginBottom:6 }}>📞 {calls} parent{calls === 1 ? "" : "s"} asked for a call. See the bottom of your Inbox.</div>}
          {shown.map(({ p, reasons }) => {
            const isDone = done.includes(p.id);
            return (
              <div key={p.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 0", borderTop:`1px solid ${C.faint}`, opacity: isDone ? 0.5 : 1 }}>
                <Avatar person={p} size={34} />
                <button onClick={() => goToPerson(p.id)} style={{ flex:1, minWidth:0, textAlign:"left", background:"none", border:"none", padding:0, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                  <div style={{ fontSize:14, color:C.cream, fontWeight:600, textDecoration: isDone ? "line-through" : "none" }}>{p.name}</div>
                  <div style={{ fontSize:12, color: reasons[0].color, lineHeight:1.35 }}>{reasons.map(r => r.label).join(" · ")}</div>
                </button>
                <button onClick={() => toggle(p.id)} aria-pressed={isDone} title={isDone ? "Undo" : "I checked in"} style={{ flexShrink:0, background: isDone ? C.accentBg : "none", border:`1px solid ${isDone ? C.accent : C.border}`, color: isDone ? C.accentLight : C.muted, borderRadius:8, padding:"6px 9px", fontSize:12, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{isDone ? "✓ Done" : "Checked in"}</button>
              </div>
            );
          })}
          {items.length > shown.length && <div style={{ fontSize:12, color:C.muted, paddingTop:6 }}>+ {items.length - shown.length} more{!myGroupId ? ". Pick your small group above to focus this list." : ""}</div>}
          <div style={{ fontSize:11.5, color:C.muted, paddingTop:6 }}>Text, call, or catch them at youth group. “Checked in” is just for you and resets each Monday.</div>
        </div>
      )}
    </div>
  );
}

/* ── Monthly recap (admin → Report) ── */
function MonthlyRecap({ people, weekHistory, ministryName }) {
  const months = React.useMemo(() => {
    const out = []; const d = new Date(); d.setDate(1);
    for (let i = 0; i < 6; i++) { out.push({ y: d.getFullYear(), m: d.getMonth() }); d.setMonth(d.getMonth() - 1); }
    return out;
  }, []);
  const [idx, setIdx] = React.useState(() => (new Date().getDate() <= 7 ? 1 : 0)); // early in the month, show last month
  const [copied, setCopied] = React.useState(false);
  const { y, m } = months[idx];
  const from = new Date(y, m, 1).getTime(), to = new Date(y, m + 1, 1).getTime();
  const inMonth = t => t >= from && t < to;
  const label = new Date(y, m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const active = people.filter(p => p.active !== false);

  const weeks = weekHistory.filter(w => inMonth(w.prevWeekStart || w.weekStart));
  const prayers = weeks.reduce((n, w) => n + (w.count || 0), 0);
  const perWeek = weeks.length ? Math.round(prayers / weeks.length) : null;
  const requests = active.reduce((n, p) => n + (p.reqTimes || []).filter(inMonth).length, 0);
  const family = active.reduce((n, p) => n + (p.familyRequests || []).filter(f => inMonth(f.at || 0)).length, 0);
  const answeredList = active.flatMap(p => (p.answered || []).filter(a => inMonth(a.at || 0)).map(a => ({ ...a, who: p.name })));
  const gospel = active.flatMap(p => (p.gospelLog || []).filter(g => inMonth(g.at || 0)).map(g => ({ ...g, who: p.name })));
  const convos = gospel.reduce((n, g) => n + (g.count || 0), 0);
  const trusted = gospel.filter(g => g.outcome === "trusted").length;
  const sharers = new Set(gospel.map(g => g.who)).size;
  const stories = [
    ...answeredList.filter(a => a.update).map(a => ({ at: a.at, text: `${a.who.split(" ")[0]}: ${a.update}`, kind: "Answered prayer" })),
    ...gospel.filter(g => g.story).map(g => ({ at: g.at, text: `${g.who.split(" ")[0]}: ${g.story}`, kind: g.outcome === "trusted" ? "Trusted Jesus" : "Gospel conversation" })),
  ].sort((a, b) => b.at - a.at).slice(0, 5);

  const stats = [
    [prayers, "times students & leaders were prayed for", weeks.length ? `${weeks.length} week${weeks.length === 1 ? "" : "s"} counted` : "counted each Monday"],
    [perWeek === null ? "—" : perWeek, "prayers in an average week", ""],
    [requests + family, requests + family === 1 ? "prayer request shared" : "prayer requests shared", family ? `${family} from parents` : ""],
    [answeredList.length, answeredList.length === 1 ? "answered prayer" : "answered prayers", ""],
    [convos, "Gospel conversations", sharers ? `by ${sharers} student${sharers === 1 ? "" : "s"}` : ""],
    [trusted, trusted === 1 ? "friend trusted Jesus" : "friends trusted Jesus", ""],
  ];
  const textVersion = [
    `${ministryName || "IMPACT Students"} · Let’s Pray recap · ${label}`,
    ...stats.map(([n, l, sub]) => `• ${n} ${l}${sub ? ` (${sub})` : ""}`),
    stories.length ? "\nStories:" : "",
    ...stories.map(s => `• ${s.kind}. ${s.text}`),
  ].filter(Boolean).join("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(textVersion); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch (_e) { setCopied("select"); }
  }
  return (
    <div style={{ ...S.reportBox, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <BarChart2 size={16} color={C.accent} />
        <p style={{ ...S.reportTitle, margin:0 }}>Monthly Recap</p>
        <select value={idx} onChange={e => setIdx(Number(e.target.value))} style={{ ...S.gradeSelect, marginLeft:"auto" }} aria-label="Month">
          {months.map((mm, i) => <option key={i} value={i}>{new Date(mm.y, mm.m, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}{i === 0 ? " (so far)" : ""}</option>)}
        </select>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2, minmax(0, 1fr))", gap:8 }}>
        {stats.map(([n, l, sub]) => (
          <div key={l} style={{ background:C.faint, borderRadius:10, padding:"10px 12px" }}>
            <div style={{ fontSize:22, fontWeight:800, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif", fontVariantNumeric:"tabular-nums" }}>{n}</div>
            <div style={{ fontSize:12, color:C.cream, lineHeight:1.35 }}>{l}</div>
            {sub && <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{sub}</div>}
          </div>
        ))}
      </div>
      {stories.length > 0 && (
        <div>
          <div style={{ fontSize:10.5, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:700, marginBottom:6 }}>Stories to share</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {stories.map((st, i) => (
              <div key={i} style={{ fontSize:13, color:C.cream, lineHeight:1.45, borderLeft:`3px solid ${st.kind === "Answered prayer" ? C.accent : C.orange}`, paddingLeft:10 }}>
                <span style={{ fontSize:11, color:C.muted, display:"block" }}>{st.kind}</span>{st.text}
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={copy} style={S.confirmBtn}>{copied === true ? "Copied!" : "Copy recap as text"}</button>
        <span style={{ fontSize:12, color:C.muted, lineHeight:1.4 }}>Paste into an email, text or staff meeting notes.</span>
      </div>
      {copied === "select" && <textarea readOnly value={textVersion} rows={8} onFocus={e => e.target.select()} style={{ ...S.reqInput, width:"100%", boxSizing:"border-box", fontSize:12.5 }} />}
      <div style={{ fontSize:11.5, color:C.muted, lineHeight:1.45 }}>Prayer counts come from the weekly totals saved each Monday. Requests, answered prayers and Gospel conversations count from the day they were added.</div>
    </div>
  );
}

/* ── Leader devotional: a weekly note from the student pastor ── */
const DEVO_SEEN_KEY = "lp-devo-seen";

function LeaderNote({ note }) {
  const [seen, setSeen] = React.useState(() => lsGet(DEVO_SEEN_KEY) || "");
  const [open, setOpen] = React.useState(false);
  if (!note || (!note.title && !note.body)) return null;
  const collapsed = seen === note.id && !open;
  const long = (note.body || "").length > 260;
  const wrap = { width:"100%", boxSizing:"border-box", background:"#2b2414", border:"1px solid #e6b34a44", borderRadius:14, marginBottom:12, textAlign:"left" };
  if (collapsed) return (
    <button onClick={() => setOpen(true)} style={{ ...wrap, display:"flex", alignItems:"center", gap:8, padding:"10px 14px", cursor:"pointer", color:C.cream, fontSize:13, fontFamily:"'Inter', system-ui, sans-serif" }}>
      <BookOpen size={14} color="#e6b34a" style={{ flexShrink:0 }} />
      <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{note.title || "A note for leaders"}</span>
      <span style={{ color:"#e6b34a", fontWeight:600, flexShrink:0 }}>Read</span>
    </button>
  );
  return (
    <div style={{ ...wrap, padding:"14px 16px", display:"flex", flexDirection:"column", gap:8 }}>
      <div style={{ fontSize:10.5, letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:700, color:"#e6b34a" }}>
        {note.author ? `From ${note.author}` : "For our leaders"} · {timeAgo(note.at)}
      </div>
      {note.title && <div style={{ fontSize:17, fontWeight:800, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif", lineHeight:1.25 }}>{note.title}</div>}
      {note.verseRef && <div style={{ fontSize:12.5, color:"#e6b34a", fontWeight:700 }}>{note.verseRef}</div>}
      {note.body && (
        <p style={{ margin:0, fontSize:14, color:"#e6e3dc", lineHeight:1.55, whiteSpace:"pre-wrap" }}>
          {long && !open ? note.body.slice(0, 260).trimEnd() + "…" : note.body}
        </p>
      )}
      <div style={{ display:"flex", gap:14, alignItems:"center" }}>
        {long && !open && <button onClick={() => setOpen(true)} style={{ background:"none", border:"none", padding:0, color:"#e6b34a", fontSize:13, fontWeight:600, cursor:"pointer" }}>Read more</button>}
        <button onClick={() => { lsSet(DEVO_SEEN_KEY, note.id); setSeen(note.id); setOpen(false); }} style={{ marginLeft:"auto", background:"none", border:`1px solid ${C.border}`, color:C.muted, borderRadius:8, padding:"6px 12px", fontSize:12.5, cursor:"pointer" }}>Got it</button>
      </div>
    </div>
  );
}

function DevotionalEditor() {
  const [current, setCurrent] = React.useState(null);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [verseRef, setVerseRef] = React.useState("");
  const [author, setAuthor] = React.useState(() => lsGet("lp-devo-author") || "");
  const [notify, setNotify] = React.useState(true);
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    fetch("/api/data?key=devotional", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setCurrent).catch(() => {});
  }, []);
  async function publish() {
    if (!title.trim() && !body.trim()) { setMsg("Add a title or a note."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/data?key=devotional", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, body, verseRef, author }) });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || "Couldn’t publish.");
      lsSet("lp-devo-author", author.trim() || null);
      setCurrent(d.devotional); setTitle(""); setBody(""); setVerseRef("");
      let sent = "";
      if (notify) {
        const r2 = await fetch("/api/push?action=broadcast", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `${author.trim() ? author.trim() + ": " : ""}${d.devotional.title || "A note for leaders"}`, body: "Tap to read this week’s note in Let’s Pray." }) }).then(r => r.json()).catch(() => null);
        if (r2 && r2.ok) sent = ` Sent a notification to ${r2.sent} leader${r2.sent === 1 ? "" : "s"}.`;
      }
      setMsg("Published. Leaders see it at the top of the Pray tab." + sent);
      window.dispatchEvent(new Event("lp-devo-updated"));
    } catch (e) { setMsg(e.message || "Couldn’t publish."); }
    setBusy(false);
  }
  async function removeNote() {
    await fetch("/api/data?key=devotional", { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" }).catch(() => {});
    setCurrent(null); setMsg("Removed."); window.dispatchEvent(new Event("lp-devo-updated"));
  }
  const field = { ...S.reqInput, width:"100%", boxSizing:"border-box", fontSize:13.5 };
  const lbl = { fontSize:10.5, color:C.muted, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600, margin:"0 0 4px", display:"block" };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><BookOpen size={16} color="#e6b34a" /><p style={{ ...S.reportTitle, margin:0, color:"#e6b34a" }}>Leader Note</p></div>
      <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>A short devotional or encouragement for your leaders. It shows at the top of their Pray tab until you post the next one.</p>
      {current && (
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.muted, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.08em", fontWeight:600 }}>Showing now</div>
          <LeaderNote note={{ ...current, id: "preview-" + current.id }} />
          <button onClick={removeNote} style={{ background:"none", border:"none", color:C.muted, fontSize:12, cursor:"pointer", padding:0 }}>Remove this note</button>
        </div>
      )}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:10 }}>
        <div><label style={lbl} htmlFor="devo-author">From</label><input id="devo-author" value={author} onChange={e => setAuthor(e.target.value)} placeholder="e.g. Pastor Scott" style={field} /></div>
        <div><label style={lbl} htmlFor="devo-title">Title</label><input id="devo-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. You’re not too busy to pray" style={field} /></div>
        <div><label style={lbl} htmlFor="devo-verse">Verse (optional)</label><input id="devo-verse" value={verseRef} onChange={e => setVerseRef(e.target.value)} placeholder="e.g. Colossians 4:2" style={field} /></div>
        <div><label style={lbl} htmlFor="devo-body">Note</label><textarea id="devo-body" value={body} onChange={e => setBody(e.target.value)} rows={7} placeholder="Write a few sentences of encouragement for your team this week." style={{ ...field, resize:"vertical", lineHeight:1.5 }} /></div>
        <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:C.cream, cursor:"pointer" }}>
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} style={{ accentColor:C.accent, width:15, height:15 }} />
          Notify leaders who have reminders on
        </label>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={publish} disabled={busy} style={{ ...S.confirmBtn, opacity: busy ? 0.6 : 1 }}>{busy ? "Publishing…" : current ? "Publish new note" : "Publish note"}</button>
          {msg && <span style={{ fontSize:12.5, color: /Couldn|Add a/.test(msg) ? "#e07a5f" : C.accentLight, lineHeight:1.4 }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

/* ── Group Gospel tracker (students see totals only) ── */
function GospelTracker({ compact }) {
  const [st, setSt] = React.useState(null);
  React.useEffect(() => {
    fetch("/api/wall?action=stats", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setSt).catch(() => {});
  }, []);
  if (!st || (!st.month && !st.goal)) return null;
  const pct = st.goal > 0 ? Math.min(100, Math.round((st.month / st.goal) * 100)) : 0;
  const met = st.goal > 0 && st.month >= st.goal;
  return (
    <div style={{ width:"100%", maxWidth:400, boxSizing:"border-box", background:"#1f2023", border:`1px solid ${met ? "#e95e24" : "#34363a"}`, borderRadius:14, padding:"14px 16px", marginBottom: compact ? 0 : 14 }}>
      <div style={{ fontSize:11, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:700, color:"#e95e24" }}>Gospel conversations · {st.monthName}</div>
      <div style={{ display:"flex", alignItems:"baseline", gap:6, margin:"6px 0 8px" }}>
        <span style={{ fontSize:34, fontWeight:800, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif", fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{st.month}</span>
        {st.goal > 0 && <span style={{ fontSize:15, color:"#80848a", fontWeight:600 }}>of {st.goal} goal</span>}
      </div>
      {st.goal > 0 && (
        <div style={{ height:10, background:"#2b2d31", borderRadius:5, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg, #3d59a8, #4cad3b 55%, #e95e24)", borderRadius:5, transition:"width 0.8s ease" }} />
        </div>
      )}
      <p style={{ margin:"8px 0 0", fontSize:13, color:"#80848a", lineHeight:1.45 }}>
        {met ? "We hit our goal! Keep sharing Jesus. 🎉" : st.goal > 0 ? `${st.goal - st.month} more to reach our goal this month.` : "Conversations our group has had this month."}
        {st.trusted > 0 && <><br /><span style={{ color:"#f2f1ee" }}>🎉 {st.trusted} friend{st.trusted === 1 ? "" : "s"} trusted Jesus this month!</span></>}
      </p>
    </div>
  );
}

/* ── Prayer Wall (students) ── */
const WALL_PRAYED_KEY = "lp-wall-prayed";

function PrayerWall() {
  const [posts, setPosts] = React.useState(null);
  const [err, setErr] = React.useState("");
  const [mine, setMine] = React.useState(() => { try { return JSON.parse(lsGet(WALL_PRAYED_KEY) || "{}"); } catch (_e) { return {}; } });

  const load = React.useCallback(() => {
    fetch("/api/wall", { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(list => { setPosts(list); setErr(""); })
      .catch(() => setErr("Couldn’t load the Prayer Wall. Pull down to refresh."));
  }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  async function pray(id) {
    const today = localDay();
    if (mine[id] === today) return;
    const next = { ...mine, [id]: today };
    setMine(next); lsSet(WALL_PRAYED_KEY, JSON.stringify(next));
    setPosts(prev => prev.map(p => p.id === id ? { ...p, prayed: p.prayed + 1 } : p));
    fetch("/api/wall?action=pray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }

  const wrap = { width:"100%", maxWidth:400, display:"flex", flexDirection:"column", gap:10 };
  if (err) return <p style={{ color:"#e07a5f", fontSize:14 }}>{err}</p>;
  if (!posts) return <p style={{ color:"#80848a", fontSize:14 }}>Loading…</p>;
  return (
    <div style={wrap}>
      <GospelTracker />
      <p style={{ margin:"0 0 6px", fontSize:13, color:"#80848a", lineHeight:1.5, textAlign:"center" }}>Take a moment to pray for each other. Tap 🙏 when you do.</p>
      {posts.length === 0 && <p style={{ color:"#80848a", fontSize:14, textAlign:"center", padding:"24px 0" }}>No requests on the wall right now.</p>}
      {posts.map(p => {
        const done = mine[p.id] === localDay();
        const happy = p.praise || p.answered;
        return (
          <div key={p.id} style={{ background: happy ? "#18241a" : "#1f2023", border:`1px solid ${happy ? "#4cad3b66" : "#34363a"}`, borderRadius:14, padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
            {happy && <div style={{ fontSize:11, letterSpacing:"0.12em", textTransform:"uppercase", fontWeight:800, color:"#74c464" }}>{p.praise ? "🎉 Praise report" : "🎉 Prayer answered!"}</div>}
            <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
              <span style={{ fontSize:15, fontWeight:700, color:"#f2f1ee", fontFamily:"'Montserrat', system-ui, sans-serif" }}>{p.name}</span>
              <span style={{ marginLeft:"auto", fontSize:12, color:"#80848a" }}>{timeAgo(p.createdAt)}</span>
            </div>
            <p style={{ margin:0, fontSize:15, color: p.answered ? "#a9ada9" : "#f2f1ee", lineHeight:1.5, whiteSpace:"pre-wrap" }}>{p.text}</p>
            {p.answered && p.answered.update && <p style={{ margin:0, fontSize:15, color:"#f2f1ee", lineHeight:1.5 }}><b style={{ color:"#74c464" }}>Update: </b>{p.answered.update}</p>}
            {!p.praise && <button onClick={() => pray(p.id)} disabled={done}
              style={{ alignSelf:"flex-start", display:"flex", alignItems:"center", gap:8, padding:"9px 14px", borderRadius:20, border:`1px solid ${done ? "#4cad3b" : "#e95e24"}`, background: done ? "#18241a" : "#e95e24", color:"#fff", fontSize:14, fontWeight:700, cursor: done ? "default" : "pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
              {done ? "✓ Prayed" : "🙏 I prayed"}
              <span style={{ fontWeight:500, opacity:0.85 }}>· {p.prayed}</span>
            </button>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Leader Wall: student wall + parent (family) wall, for signed-in leaders ── */
const WALL_SEEN_KEY = "lp-wall-seen";
const FAMILY_WALL_DAYS = 60;

function familyWallItems(people) {
  const cutoff = Date.now() - FAMILY_WALL_DAYS * 24 * 60 * 60 * 1000;
  return people
    .filter(p => p.active !== false)
    .flatMap(p => (p.familyRequests || []).filter(f => (f.at || 0) >= cutoff).map(f => ({ ...f, personId: p.id, student: p.name })))
    .sort((a, b) => b.at - a.at);
}

function LeaderWall({ studentPosts, onStudentPrayed, people, setPeople, goToPerson, isAdmin, initialTab }) {
  const [tab, setTab] = React.useState(initialTab || "students");
  const [mine, setMine] = React.useState(() => { try { return JSON.parse(lsGet(WALL_PRAYED_KEY) || "{}"); } catch (_e) { return {}; } });
  const today = localDay();
  const family = familyWallItems(people);

  function markMine(key) {
    const next = { ...mine, [key]: today };
    setMine(next); lsSet(WALL_PRAYED_KEY, JSON.stringify(next));
  }
  function prayStudent(id) {
    if (mine[id] === today) return;
    markMine(id);
    onStudentPrayed(id);
  }
  function prayFamily(item) {
    const key = `fam:${item.id}`;
    if (mine[key] === today) return;
    markMine(key);
    setPeople(prev => prev.map(p => p.id !== item.personId ? p : {
      ...p,
      familyRequests: (p.familyRequests || []).map(f => f.id === item.id ? { ...f, prayed: (f.prayed || 0) + 1 } : f),
      updatedAt: Date.now(),
    }));
  }

  const seg = on => ({ flex:1, padding:"9px 0", borderRadius:9, border:"none", background: on ? C.accent : "none", color: on ? "#101112" : C.muted, fontWeight: on ? 700 : 500, fontSize:13.5, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" });
  const card = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px", display:"flex", flexDirection:"column", gap:9 };
  const prayBtn = (done, count, onClick) => (
    <button onClick={onClick} disabled={done}
      style={{ alignSelf:"flex-start", display:"flex", alignItems:"center", gap:8, padding:"8px 13px", borderRadius:20, border:`1px solid ${done ? C.accent : C.orange}`, background: done ? C.accentBg : C.orange, color:"#fff", fontSize:13.5, fontWeight:700, cursor: done ? "default" : "pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
      {done ? "✓ Prayed" : "🙏 I prayed"}<span style={{ fontWeight:500, opacity:0.85 }}>· {count}</span>
    </button>
  );

  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:4, gap:4, marginBottom:14 }}>
        <button onClick={() => setTab("students")} style={seg(tab === "students")}>Students{studentPosts.filter(p => !p.praise && !p.answered).length ? ` · ${studentPosts.filter(p => !p.praise && !p.answered).length}` : ""}</button>
        <button onClick={() => setTab("parents")} style={seg(tab === "parents")}>Parents{family.length ? ` · ${family.length}` : ""}</button>
        <button onClick={() => setTab("answered")} style={seg(tab === "answered")}>Answered 🎉</button>
      </div>

      {tab === "answered" ? (() => {
        const cutoff = Date.now() - 90 * 864e5;
        const items = [
          ...people.filter(p => p.active !== false).flatMap(p => (p.answered || []).filter(a => (a.at || 0) >= cutoff).map(a => ({ key: a.id, who: p.name, personId: p.id, request: a.text, update: a.update, at: a.at, by: a.by }))),
          ...studentPosts.filter(p => p.praise || p.answered).map(p => ({ key: "w" + p.id, who: p.name, request: p.praise ? "" : p.text, update: p.praise ? p.text : (p.answered.update || ""), at: p.praise ? p.createdAt : p.answered.at, by: "wall" })),
        ].sort((a, b) => b.at - a.at);
        return (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <p style={{ margin:"0 0 2px", fontSize:12.5, color:C.muted, textAlign:"center", lineHeight:1.5 }}>Answered prayers and praise reports from the last 90 days. Great to share at youth night.</p>
            {items.length === 0 && <p style={S.reportEmpty}>Nothing yet. Tap ✓ on a prayer request when God answers it.</p>}
            {items.map(it => (
              <div key={it.key} style={{ ...card, background:C.accentBg, borderColor:`${C.accent}55` }}>
                <div style={{ display:"flex", alignItems:"baseline", gap:6 }}>
                  {it.personId
                    ? <button onClick={() => goToPerson(it.personId)} style={{ background:"none", border:"none", padding:0, color:C.cream, fontSize:14.5, fontWeight:700, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{it.who}</button>
                    : <span style={{ fontSize:14.5, fontWeight:700, color:C.cream }}>{it.who}</span>}
                  <span style={{ marginLeft:"auto", fontSize:12, color:C.muted }}>{timeAgo(it.at)}</span>
                </div>
                {it.request && <p style={{ margin:0, fontSize:13.5, color:C.muted, lineHeight:1.45 }}>Prayed for: {it.request}</p>}
                {it.update && <p style={{ margin:0, fontSize:14.5, color:C.cream, lineHeight:1.5 }}>🎉 {it.update}</p>}
                {!it.update && <p style={{ margin:0, fontSize:14.5, color:C.accentLight }}>🎉 Answered!</p>}
              </div>
            ))}
          </div>
        );
      })() : tab === "students" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10, alignItems:"center" }}>
          <GospelTracker compact />
          <p style={{ margin:"4px 0 2px", fontSize:12.5, color:C.muted, textAlign:"center", lineHeight:1.5 }}>What students shared on their Prayer Wall. Your 🙏 adds to the count they see.</p>
          {studentPosts.length === 0 && <p style={S.reportEmpty}>No student requests on the wall right now.</p>}
          {studentPosts.filter(p => !p.praise && !p.answered).map(p => (
            <div key={p.id} style={{ ...card, width:"100%", boxSizing:"border-box" }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontSize:15, fontWeight:700, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif" }}>{p.name}</span>
                <span style={{ marginLeft:"auto", fontSize:12, color:C.muted }}>{timeAgo(p.createdAt)}</span>
              </div>
              <p style={{ margin:0, fontSize:14.5, color:C.cream, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{p.text}</p>
              {prayBtn(mine[p.id] === today, p.prayed, () => prayStudent(p.id))}
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ margin:"0 0 2px", fontSize:12.5, color:C.muted, textAlign:"center", lineHeight:1.5 }}>
            Family requests parents shared with our leaders (last {FAMILY_WALL_DAYS} days).{isAdmin ? " Confidential ones stay in your Inbox." : ""}
          </p>
          {family.length === 0 && <p style={S.reportEmpty}>No family requests right now.</p>}
          {family.map(f => (
            <div key={f.id} style={{ ...card, borderColor:"#b49ad033" }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
                <span style={{ fontSize:14.5, fontWeight:700, color:C.cream }}>{f.from}</span>
                <span style={{ fontSize:12.5, color:C.muted }}>for</span>
                <button onClick={() => goToPerson(f.personId)} style={{ background:"none", border:"none", padding:0, color:"#b49ad0", fontSize:13.5, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{f.student}</button>
                <span style={{ marginLeft:"auto", fontSize:12, color:C.muted }}>{timeAgo(f.at)}</span>
              </div>
              <p style={{ margin:0, fontSize:14.5, color:C.cream, lineHeight:1.5, whiteSpace:"pre-wrap" }}>{f.text}</p>
              {f.dontMention && <span style={{ alignSelf:"flex-start", fontSize:12, fontWeight:600, color:C.orange, background:"#2a1a12", borderRadius:8, padding:"3px 9px" }}>Please don’t mention this to {f.student.split(" ")[0]}</span>}
              {prayBtn(mine[`fam:${f.id}`] === today, f.prayed || 0, () => prayFamily(f))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function wallName(item) {
  if (item.anonymous) return "Anonymous";
  return (item.name || "").trim().split(/\s+/)[0] || "Anonymous";
}

/* ── Parent page (/parents) ── */
const PARENT_NAME_KEY = "lp-parent-name";
const PARENT_KIDS_KEY = "lp-parent-kids";

export function ParentPage() {
  const [info, setInfo] = React.useState(null);
  const [series] = useSeries(info && info.role);
  const [events] = useEvents(info && info.role);
  const calendar = useCalendar(info && info.role);
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(() => lsGet(PARENT_NAME_KEY) || "");
  const [kids, setKids] = React.useState(() => lsGet(PARENT_KIDS_KEY) || "");
  const [text, setText] = React.useState("");
  const [privacy, setPrivacy] = React.useState("leaders");
  const [dontMention, setDontMention] = React.useState(false);
  const [followUp, setFollowUp] = React.useState(false);
  const [contact, setContact] = React.useState("");
  const [done, setDone] = React.useState(false);

  const load = React.useCallback(() => {
    fetch("/api/submit", { cache: "no-store" }).then(r => r.json()).then(setInfo).catch(() => setInfo({ error: true }));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  async function signIn() {
    if (!code.trim()) return;
    setBusy(true); setErr("");
    try { await apiAuth("login", { code: code.trim() }); load(); setCode(""); }
    catch (e) { setErr(e.message); setCode(""); }
    setBusy(false);
  }

  async function submit() {
    setErr("");
    if (name.trim().length < 2) return setErr("Please enter your name.");
    if (text.trim().length < 3) return setErr("Please write your prayer request.");
    if (followUp && contact.trim().length < 5) return setErr("Add a phone number or email so we can reach you.");
    setBusy(true);
    try {
      const res = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "parent", name: name.trim(), students: kids.trim(), text: text.trim(), privacy, dontMention, followUp, contact: followUp ? contact.trim() : "" }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 || res.status === 403) { load(); throw new Error("Please enter the parent code again."); }
      if (!res.ok) throw new Error(data.error || "That didn’t send. Please try again.");
      lsSet(PARENT_NAME_KEY, name.trim()); lsSet(PARENT_KIDS_KEY, kids.trim() || null);
      setDone(true); setText(""); setDontMention(false); setFollowUp(false); setContact(""); setPrivacy("leaders");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const card = { width:"100%", maxWidth:400, display:"flex", flexDirection:"column", gap:12 };
  const header = (
    <>
      <img src="/logo.png" alt={info?.name || ""} style={{ width: 210, height: "auto", marginBottom: 10 }} />
      <AppWordmark small />
      <p style={{ fontSize:12, color:"#80848a", margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.14em", fontWeight:700 }}>For parents</p>
      <p style={{ fontSize:14, color:"#80848a", margin:"0 0 22px", textAlign:"center", maxWidth:320, lineHeight:1.5 }}>Talk about this week’s message with your student, and share how our leaders can pray for your family.</p>
    </>
  );
  const signedIn = info && (info.role === "parent" || info.role === "team" || info.role === "admin");

  if (!info) return <LoadingScreen />;
  if (info.error || !info.configured || !info.parentOpen) return (
    <div style={authWrap}>{header}<p style={{ color:"#80848a", fontSize:14, textAlign:"center", maxWidth:300, lineHeight:1.5 }}>This page isn’t open yet. Please check back soon.</p></div>
  );
  if (!signedIn) return (
    <div style={authWrap}>
      {header}
      <div style={{ ...card, maxWidth:320 }}>
        <p style={{ fontSize:14, color:"#80848a", margin:"0 0 4px", textAlign:"center", lineHeight:1.5 }}>Enter the parent code from our student ministry team.</p>
        <input autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => e.key === "Enter" && signIn()} placeholder="Parent code" style={{ ...authInp, textAlign:"center", fontSize:17 }} autoCapitalize="none" autoCorrect="off" />
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0, textAlign:"center" }}>{err}</p>}
        <button onClick={signIn} disabled={busy} style={{ ...authBtn, opacity: busy ? 0.7 : 1 }}>{busy ? "Checking…" : "Continue"}</button>
      </div>
    </div>
  );
  if (done) return (
    <div style={authWrap}>
      {header}
      <div style={{ ...card, alignItems:"center", textAlign:"center" }}>
        <Heart size={40} color="#4cad3b" fill="#4cad3b" />
        <p style={{ color:"#f2f1ee", fontSize:20, fontWeight:700, fontFamily:"'Montserrat', system-ui, sans-serif", margin:"8px 0 0" }}>Thank you for trusting us with this.</p>
        <p style={{ color:"#80848a", fontSize:14, margin:0, lineHeight:1.5 }}>Our team will be praying for your family.</p>
        <button onClick={() => setDone(false)} style={{ ...authBtn, padding:"12px 28px", marginTop:12 }}>Share another request</button>
      </div>
    </div>
  );

  const option = (v, title, sub) => (
    <button onClick={() => setPrivacy(v)} aria-pressed={privacy === v} style={{ textAlign:"left", padding:"12px 14px", borderRadius:10, border:`1px solid ${privacy === v ? "#4cad3b" : "#34363a"}`, background: privacy === v ? "#18241a" : "#1f2023", cursor:"pointer", display:"flex", gap:10, alignItems:"flex-start" }}>
      <span style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${privacy === v ? "#4cad3b" : "#4a4d52"}`, flexShrink:0, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center" }}>{privacy === v && <span style={{ width:8, height:8, borderRadius:"50%", background:"#4cad3b" }} />}</span>
      <span><span style={{ display:"block", fontSize:14, fontWeight:600, color:"#f2f1ee" }}>{title}</span><span style={{ display:"block", fontSize:12.5, color:"#80848a", lineHeight:1.4, marginTop:2 }}>{sub}</span></span>
    </button>
  );
  const check = (checked, set, label, sub) => (
    <label style={{ display:"flex", gap:10, alignItems:"flex-start", cursor:"pointer", fontSize:14, color:"#f2f1ee", lineHeight:1.4 }}>
      <input type="checkbox" checked={checked} onChange={e => set(e.target.checked)} style={{ marginTop:3, width:17, height:17, accentColor:"#4cad3b", flexShrink:0 }} />
      <span>{label}{sub && <><br /><span style={{ fontSize:12, color:"#80848a" }}>{sub}</span></>}</span>
    </label>
  );
  return (
    <div style={{ ...authWrap, justifyContent:"flex-start", paddingTop:48 }}>
      {header}
      <SeriesCard series={series} mode="parent" />
      <EventCards events={events} mode="parent" />
      <CalendarList cal={calendar} limit={4} />
      <div style={card}>
        <p style={{ margin:"4px 0 0", fontSize:12, color:"#80848a", textTransform:"uppercase", letterSpacing:"0.1em", fontWeight:700 }}>Share a prayer request</p>
        <div><label style={authLbl}>Your name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" style={authInp} autoComplete="name" /></div>
        <div><label style={authLbl}>Your student(s) in IMPACT</label><input value={kids} onChange={e => setKids(e.target.value)} placeholder="e.g. Ethan Brooks" style={authInp} /></div>
        <div>
          <label style={authLbl}>How can we pray for your family?</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={1200} placeholder="Share as much or as little as you’d like." style={{ ...authInp, resize:"vertical", lineHeight:1.5 }} />
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <label style={{ ...authLbl, marginBottom:0 }}>Who should see this?</label>
          {option("leaders", "Our IMPACT leaders", "Leaders see it on your student’s prayer card and pray for your family.")}
          {option("staff", "Student ministry staff only", "Kept confidential. Only our staff will see it.")}
        </div>
        <div style={{ background:"#1f2023", border:"1px solid #34363a", borderRadius:10, padding:"12px 14px", display:"flex", flexDirection:"column", gap:12 }}>
          {check(dontMention, setDontMention, "Please don’t mention this to my student")}
          {check(followUp, setFollowUp, "I’d like a staff member to reach out", "Only our staff will see your contact info.")}
          {followUp && <input value={contact} onChange={e => setContact(e.target.value)} placeholder="Phone number or email" style={authInp} autoComplete="tel" />}
        </div>
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0 }}>{err}</p>}
        <button onClick={submit} disabled={busy} style={{ ...authBtn, background:"#e95e24", color:"#fff", opacity: busy ? 0.7 : 1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Send size={15} /> {busy ? "Sending…" : "Send to our leaders"}</button>
        <p style={{ fontSize:12, color:"#5c6066", margin:"4px 0 24px", textAlign:"center", lineHeight:1.5 }}>Our student ministry staff reads every request before it’s shared with leaders.</p>
      </div>
    </div>
  );
}

/* ── Admin inbox ── */
const normName = n => (n || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

function guessPerson(name, people) {
  const n = normName(name);
  if (!n) return "";
  const exact = people.find(p => normName(p.name) === n);
  if (exact) return exact.id;
  const [first, ...rest] = n.split(" ");
  const last = rest[rest.length - 1];
  const firstMatches = people.filter(p => normName(p.name).split(" ")[0] === first);
  if (last) {
    const fl = firstMatches.filter(p => { const parts = normName(p.name).split(" "); return parts[parts.length - 1][0] === last[0]; });
    if (fl.length === 1) return fl[0].id;
  }
  return firstMatches.length === 1 ? firstMatches[0].id : "";
}

// For a parent request, match on their student's name instead of the parent's
function matchName(item) {
  if (item.kind === "parent") return ((item.parent && item.parent.students) || "").split(/,|&|\band\b/i)[0].trim();
  return item.name;
}

function InboxView({ items, people, setPeople, onRemove, studentCodeSet, parentCodeSet }) {
  const [match, setMatch] = React.useState({});
  const [edits, setEdits] = React.useState({});
  const [skipInfo, setSkipInfo] = React.useState({});
  const [skipWall, setSkipWall] = React.useState({});
  const [skipPhoto, setSkipPhoto] = React.useState({});
  const [skipCause, setSkipCause] = React.useState({});
  const [privacyFor, setPrivacyFor] = React.useState({});
  const [family, setFamily] = React.useState([]);
  const loadFamily = React.useCallback(() => {
    fetch("/api/family").then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) && setFamily(l)).catch(() => {});
  }, []);
  React.useEffect(() => { loadFamily(); }, [loadFamily]);
  async function addFamily(entry) {
    await fetch("/api/family", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", entry }) }).catch(() => {});
    loadFamily();
  }
  async function familyAction(action, id, extra = {}) {
    setFamily(prev => action === "remove" ? prev.filter(f => f.id !== id) : prev.map(f => f.id === id ? { ...f, done: extra.done } : f));
    await fetch("/api/family", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id, ...extra }) }).catch(() => {});
  }
  const [wall, setWall] = React.useState([]);
  const loadWall = React.useCallback(() => {
    fetch("/api/wall").then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) && setWall(l)).catch(() => {});
  }, []);
  React.useEffect(() => { loadWall(); }, [loadWall]);
  async function postToWall(name, text, extra = {}) {
    await fetch("/api/wall?action=post", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, text, ...extra }) }).catch(() => {});
    loadWall();
  }
  const [answerFor, setAnswerFor] = React.useState(null);
  const [answerText, setAnswerText] = React.useState("");
  async function answerOnWall(id) {
    const update = answerText.trim();
    setWall(prev => prev.map(p => p.id === id ? { ...p, answered: { update, at: Date.now() } } : p));
    setAnswerFor(null); setAnswerText("");
    await fetch("/api/wall?action=answer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, update }) }).catch(() => {});
  }
  async function removeFromWall(id) {
    setWall(prev => prev.filter(p => p.id !== id));
    await fetch("/api/wall?action=remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  const choices = React.useMemo(() => people.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)), [people]);

  async function approve(item) {
    const chosen = match[item.id] ?? guessPerson(matchName(item), choices);
    const text = (edits[item.id] ?? item.text ?? "").trim();
    if (item.kind === "parent") {
      const pi = item.parent || {};
      const privacy = privacyFor[item.id] || pi.privacy || "leaders";
      const target = choices.find(p => p.id === chosen);
      if (privacy === "staff" || pi.followUp) {
        await addFamily({ at: item.createdAt, parent: item.name, students: pi.students, personId: target ? target.id : "", text, staffOnly: privacy === "staff", dontMention: !!pi.dontMention, followUp: !!pi.followUp, contact: pi.contact });
      }
      if (privacy === "leaders") {
        if (!chosen) return;
        const entry = { id: genId(), at: item.createdAt || Date.now(), from: item.name, text, dontMention: !!pi.dontMention };
        const addFam = p => ({ ...p, familyRequests: [entry, ...(p.familyRequests || [])], updatedAt: Date.now() });
        if (chosen === "__new") {
          const nm = matchName(item) || "New student";
          setPeople(prev => [...prev, addFam({ id: genId(), name: nm, type: "student", group: null, grade: null, active: true, prayedAt: null, prayerRequests: [], causeCircle: [], birthday: "", updatedAt: Date.now() })]);
        } else setPeople(prev => prev.map(p => p.id === chosen ? addFam(p) : p));
      }
      onRemove([item.id]);
      return;
    }
    const friends = item.kind === "cause"
      ? (edits[item.id] !== undefined ? edits[item.id].split(/[,\n]/) : item.friends || []).map(f => f.trim()).filter(Boolean)
      : [];
    const withInfo = p => {
      if (skipInfo[item.id]) return p;
      const next = { ...p };
      if (item.grade) { next.grade = item.grade; if (p.type !== "leader") next.group = item.grade >= 9 ? "hs" : "ms"; }
      if (item.birthday) next.birthday = item.birthday;
      return next;
    };
    const applyContent = p => {
      if (item.kind === "info") return { ...p, updatedAt: Date.now() };
      if (item.kind === "gospel") {
        const g = item.gospel || { count: 1 };
        const entry = { id: genId(), at: item.createdAt || Date.now(), count: g.count || 1, friend: g.friend || "", outcome: g.outcome || null, story: text };
        let causeCircle = p.causeCircle || [];
        if (g.friend && !skipCause[item.id]) {
          const hit = causeCircle.some(f => normName(f.name) === normName(g.friend));
          causeCircle = hit
            ? causeCircle.map(f => normName(f.name) === normName(g.friend) ? { ...f, shared: true } : f)
            : [...causeCircle, { id: genId(), name: g.friend, shared: true }];
        }
        return { ...p, causeCircle, gospelLog: [entry, ...(p.gospelLog || [])], updatedAt: Date.now() };
      }
      if (item.kind === "request") return { ...p, prayerRequests: [...(p.prayerRequests || []), text], reqTimes: [item.createdAt || Date.now(), ...(p.reqTimes || [])].slice(0, 60), updatedAt: Date.now() };
      if (item.kind === "praise") return { ...p, answered: [{ id: genId(), text: "", update: text, at: item.createdAt || Date.now(), by: "student" }, ...(p.answered || [])], updatedAt: Date.now() };
      const have = new Set((p.causeCircle || []).map(f => normName(f.name)));
      const add = friends.filter(f => !have.has(normName(f))).map(f => ({ id: genId(), name: f, shared: false }));
      return { ...p, causeCircle: [...(p.causeCircle || []), ...add], updatedAt: Date.now() };
    };
    // Remember the student's device so leaders' prayers can notify them
    const apply = p => { const next = applyContent(withInfo(p)); return item.notifyId ? { ...next, notifyId: item.notifyId } : next; };
    const usePhoto = item.hasPhoto && !skipPhoto[item.id];
    const attachPhoto = personId => {
      if (!usePhoto) return Promise.resolve();
      return fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "usePhoto", id: item.id, personId }) })
        .then(r => r.json()).then(d => { if (d && d.ok) setPeople(prev => prev.map(p => p.id === personId ? { ...p, photo: d.v, updatedAt: Date.now() } : p)); })
        .catch(() => {});
    };
    if (chosen === "__new") {
      const newId = genId();
      const base = { id: newId, name: item.name, type: "student", group: null, grade: null, active: true, prayedAt: null, prayerRequests: [], causeCircle: [], birthday: "", updatedAt: Date.now() };
      setPeople(prev => [...prev, apply(base)]);
      await attachPhoto(newId);
    } else if (chosen) {
      setPeople(prev => prev.map(p => p.id === chosen ? apply(p) : p));
      await attachPhoto(chosen);
    } else return;
    if (item.kind === "request" && item.share && !skipWall[item.id] && text) postToWall(wallName(item), text, { notifyId: item.notifyId || undefined });
    if (item.kind === "praise" && item.praise && item.praise.share && !skipWall[item.id] && text) postToWall(wallName({ ...item, anonymous: item.praise.anonymous }), text, { praise: true });
    onRemove([item.id]);
  }

  const box = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><InboxIcon size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>Inbox</p></div>
      <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>
        Prayer requests, CAUSE Circle names, Gospel conversations, grades, birthdays and photos from students at <b style={{ color:C.cream }}>{location.origin}/submit</b>, plus parent requests. Nothing shows on a prayer card until you approve it.
        {!studentCodeSet && <span style={{ color:C.orange }}> Set a student code in App Settings (People tab) to open the page.</span>}
      </p>
      {items.length === 0 && <p style={S.reportEmpty}>All caught up. No new submissions.</p>}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.slice().sort((a, b) => a.createdAt - b.createdAt).map(item => {
          const chosen = match[item.id] ?? guessPerson(matchName(item), choices);
          const value = edits[item.id] ?? (item.kind === "request" || item.kind === "gospel" || item.kind === "parent" || item.kind === "praise" ? item.text : (item.friends || []).join(", "));
          const isParent = item.kind === "parent";
          const pi = item.parent || {};
          const privacy = privacyFor[item.id] || pi.privacy || "leaders";
          const canApprove = isParent ? (privacy === "staff" || !!chosen) : !!chosen;
          return (
            <div key={item.id} style={box}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontSize:14, color:C.cream, fontWeight:600 }}>{item.name}</span>
                <span style={{ ...S.badgeSm, ...(item.kind === "cause" ? { background:C.accentBg, color:C.accentLight } : item.kind === "info" ? { background:C.studentBg, color:C.student } : item.kind === "gospel" ? { background:"#2a1a12", color:C.orange } : isParent ? { background:"#2a2433", color:"#b49ad0" } : { background:C.faint, color:C.muted }) }}>{item.kind === "cause" ? "CAUSE Circle" : item.kind === "info" ? (item.grade || item.birthday ? "Roster info" : "Photo") : item.kind === "gospel" ? "Gospel conversation" : isParent ? "Parent request" : item.kind === "praise" ? "Praise report 🎉" : "Prayer request"}</span>
                <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{timeAgo(item.createdAt)}</span>
              </div>
              {isParent && (
                <div style={{ fontSize:13, color:C.muted, lineHeight:1.5 }}>
                  Parent of <b style={{ color:C.cream }}>{pi.students || "(student not given)"}</b>
                  {pi.dontMention && <span style={{ ...S.badgeSm, marginLeft:6, background:"#2a1a12", color:C.orange, textTransform:"none", letterSpacing:0 }}>Don’t mention to student</span>}
                  {pi.followUp && <div style={{ marginTop:4, color:C.cream }}>Wants a staff member to reach out: <span style={{ userSelect:"all" }}>{pi.contact || "(no contact given)"}</span></div>}
                </div>
              )}
              {item.kind === "gospel" && item.gospel && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:8, alignItems:"baseline", fontSize:13.5, color:C.cream }}>
                  <span style={{ fontSize:20, fontWeight:800, color:C.orange, fontFamily:"'Montserrat', system-ui, sans-serif" }}>{item.gospel.count}</span>
                  <span>conversation{item.gospel.count === 1 ? "" : "s"}{item.gospel.friend ? <> with <b>{item.gospel.friend}</b></> : ""}</span>
                  {item.gospel.outcome && <span style={{ ...S.badgeSm, background: item.gospel.outcome === "trusted" ? "#2a1a12" : C.accentBg, color: item.gospel.outcome === "trusted" ? C.orange : C.accentLight, textTransform:"none", letterSpacing:0 }}>{outcomeLabel(item.gospel.outcome)}</span>}
                </div>
              )}
              {item.kind === "gospel" && !value && !edits[item.id] ? null : item.kind !== "info" && (
                <textarea value={value} onChange={e => setEdits(prev => ({ ...prev, [item.id]: e.target.value }))} rows={item.kind === "request" || isParent ? 3 : 2}
                  style={{ ...S.reqInput, resize:"vertical", lineHeight:1.45, fontSize:13.5 }} />
              )}
              {item.kind === "gospel" && item.gospel && item.gospel.friend && (() => {
                const target = choices.find(p => p.id === chosen);
                const inCircle = target && (target.causeCircle || []).some(f => normName(f.name) === normName(item.gospel.friend));
                return (
                  <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer", lineHeight:1.45 }}>
                    <input type="checkbox" checked={!skipCause[item.id]} onChange={e => setSkipCause(prev => ({ ...prev, [item.id]: !e.target.checked }))} style={{ marginTop:2, accentColor:C.accent }} />
                    <span>{inCircle ? <>Mark <b>{item.gospel.friend}</b> as “heard the Gospel” in their CAUSE Circle</> : <>Add <b>{item.gospel.friend}</b> to their CAUSE Circle as “heard the Gospel”</>}</span>
                  </label>
                );
              })()}
              {item.hasPhoto && (
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  <img src={pendingPhotoUrl(item.id)} alt="Photo the student sent" style={{ width:64, height:64, borderRadius:"50%", objectFit:"cover", background:C.faint, flexShrink:0 }} />
                  <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer", lineHeight:1.45 }}>
                    <input type="checkbox" checked={!skipPhoto[item.id]} onChange={e => setSkipPhoto(prev => ({ ...prev, [item.id]: !e.target.checked }))} style={{ marginTop:2, accentColor:C.accent }} />
                    <span>Use this photo on their prayer card</span>
                  </label>
                </div>
              )}
              {item.kind === "praise" && item.praise && item.praise.share && (
                <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer", lineHeight:1.45 }}>
                  <input type="checkbox" checked={!skipWall[item.id]} onChange={e => setSkipWall(prev => ({ ...prev, [item.id]: !e.target.checked }))} style={{ marginTop:2, accentColor:C.accent }} />
                  <span>Also post this praise on the student Prayer Wall as <b>{wallName({ ...item, anonymous: item.praise.anonymous })}</b></span>
                </label>
              )}
              {item.notifyId && <div style={{ fontSize:12, color:C.muted }}>🔔 This student will be notified when leaders pray for them.</div>}
              {item.kind === "request" && item.share && (
                <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer", lineHeight:1.45 }}>
                  <input type="checkbox" checked={!skipWall[item.id]} onChange={e => setSkipWall(prev => ({ ...prev, [item.id]: !e.target.checked }))} style={{ marginTop:2, accentColor:C.orange }} />
                  <span>Also post to the student Prayer Wall as <b>{wallName(item)}</b> <span style={{ color:C.muted }}>(edit the text above first if needed)</span></span>
                </label>
              )}
              {(item.grade || item.birthday) && (() => {
                const target = choices.find(p => p.id === chosen);
                const changes = [];
                if (item.grade && (!target || Number(target.grade) !== item.grade)) changes.push(`Grade ${target && target.grade ? `${target.grade} → ` : ""}${item.grade}`);
                if (item.birthday && (!target || target.birthday !== item.birthday)) changes.push(`Birthday ${target && target.birthday ? `${formatBirthday(target.birthday)} → ` : ""}${formatBirthday(item.birthday)}`);
                if (!changes.length) return <p style={{ margin:0, fontSize:12, color:C.muted }}>Grade and birthday already match the roster.</p>;
                return (
                  <label style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer", lineHeight:1.45 }}>
                    <input type="checkbox" checked={!skipInfo[item.id]} onChange={e => setSkipInfo(prev => ({ ...prev, [item.id]: !e.target.checked }))} style={{ marginTop:2, accentColor:C.accent }} />
                    <span>Update roster: {changes.join(" · ")}</span>
                  </label>
                );
              })()}
              {isParent && (
                <div style={{ display:"flex", gap:6 }}>
                  {[["leaders", "Show to leaders on card"], ["staff", "Staff only"]].map(([v, l]) => (
                    <button key={v} onClick={() => setPrivacyFor(prev => ({ ...prev, [item.id]: v }))} style={{ flex:1, padding:"7px 6px", borderRadius:8, fontSize:12.5, cursor:"pointer", border:`1px solid ${privacy === v ? C.accent : C.border}`, background: privacy === v ? C.accentBg : "none", color: privacy === v ? C.cream : C.muted, fontFamily:"'Inter', system-ui, sans-serif" }}>{l}{pi.privacy === v ? " (their choice)" : ""}</button>
                  ))}
                </div>
              )}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={S.gradeLabel}>{isParent ? (privacy === "staff" ? "Student (optional)" : "Their student") : "Add to"}</span>
                <select value={chosen} onChange={e => setMatch(prev => ({ ...prev, [item.id]: e.target.value }))} style={{ ...S.gradeSelect, flex:1, minWidth:0, borderColor: chosen || (isParent && privacy === "staff") ? C.border : C.orange }}>
                  <option value="">{isParent && privacy === "staff" ? "Not linked to a student" : "Choose a person…"}</option>
                  <option value="__new">+ New student: {matchName(item) || item.name}</option>
                  {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => onRemove([item.id])} style={S.cancelBtn}>Reject</button>
                <button onClick={() => approve(item)} disabled={!canApprove} style={{ ...S.confirmBtn, opacity: canApprove ? 1 : 0.5 }}>Approve</button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, margin:"26px 0 4px" }}><Lock size={15} color="#b49ad0" /><p style={{ ...S.reportTitle, margin:0, color:"#b49ad0" }}>Family requests: staff only & follow-ups</p></div>
      <p style={{ margin:"0 0 12px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>
        Confidential parent requests and parents who asked for a call. Only admins see this list.
        {parentCodeSet ? <> Parents share at <b style={{ color:C.cream }}>{location.origin}/parents</b>.</> : <span style={{ color:C.orange }}> Set a parent code in App Settings (People tab) to open the parent page.</span>}
      </p>
      {family.length === 0 && <p style={S.reportEmpty}>Nothing here yet.</p>}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {family.map(f => (
          <div key={f.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:6, opacity: f.done ? 0.6 : 1 }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:6, flexWrap:"wrap" }}>
              <span style={{ fontSize:13, color:C.cream, fontWeight:600 }}>{f.parent}</span>
              {f.students && <span style={{ fontSize:12, color:C.muted }}>· parent of {f.students}</span>}
              <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{timeAgo(f.at)}</span>
            </div>
            <div style={{ fontSize:13, color:C.cream, lineHeight:1.45, whiteSpace:"pre-wrap" }}>{f.text}</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              {f.staffOnly && <span style={{ ...S.badgeSm, background:"#2a2433", color:"#b49ad0", textTransform:"none", letterSpacing:0 }}>Staff only</span>}
              {f.dontMention && <span style={{ ...S.badgeSm, background:"#2a1a12", color:C.orange, textTransform:"none", letterSpacing:0 }}>Don’t mention to student</span>}
              {f.followUp && <span style={{ ...S.badgeSm, background:C.accentBg, color:C.accentLight, textTransform:"none", letterSpacing:0 }}>Reach out: <span style={{ userSelect:"all" }}>{f.contact || "no contact given"}</span></span>}
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
              <button onClick={() => familyAction("remove", f.id)} style={{ ...S.cancelBtn, padding:"6px 10px", fontSize:12 }}>Remove</button>
              <button onClick={() => familyAction("done", f.id, { done: !f.done })} style={{ ...S.cancelBtn, padding:"6px 10px", fontSize:12, color: f.done ? C.accentLight : C.cream }}>{f.done ? "✓ Done" : f.followUp ? "Mark followed up" : "Mark prayed"}</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:8, margin:"26px 0 4px" }}><Heart size={16} color={C.orange} /><p style={{ ...S.reportTitle, margin:0, color:C.orange }}>On the Prayer Wall now</p></div>
      <p style={{ margin:"0 0 12px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>Students see these at the Prayer Wall tab of the student page. Posts drop off after 30 days.</p>
      {wall.length === 0 && <p style={S.reportEmpty}>Nothing on the wall yet.</p>}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {wall.map(p => (
          <div key={p.id} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"10px 12px", display:"flex", gap:10, alignItems:"flex-start" }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13, color:C.cream, fontWeight:600 }}>{p.name} <span style={{ fontWeight:400, color:C.muted, fontSize:12 }}>· {timeAgo(p.createdAt)} · 🙏 {p.prayed}</span></div>
              <div style={{ fontSize:13, color:C.muted, marginTop:3, lineHeight:1.4 }}>{p.praise && <b style={{ color:C.accentLight }}>Praise: </b>}{p.text}</div>
              {p.answered && <div style={{ fontSize:12.5, color:C.accentLight, marginTop:4 }}>🎉 Answered{p.answered.update ? `: ${p.answered.update}` : ""}</div>}
              {answerFor === p.id && (
                <div style={{ ...S.reqInputRow, marginTop:6 }}>
                  <input autoFocus value={answerText} onChange={e => setAnswerText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") answerOnWall(p.id); if (e.key === "Escape") setAnswerFor(null); }} placeholder="What happened? (optional)" style={S.reqInput} />
                  <button onClick={() => answerOnWall(p.id)} style={S.reqAddBtn}>Save</button>
                </div>
              )}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:6, flexShrink:0 }}>
              {!p.praise && !p.answered && answerFor !== p.id && <button onClick={() => { setAnswerFor(p.id); setAnswerText(""); }} style={{ ...S.cancelBtn, padding:"6px 10px", fontSize:12, color:C.accentLight }}>Answered</button>}
              <button onClick={() => removeFromWall(p.id)} style={{ ...S.cancelBtn, padding:"6px 10px", fontSize:12 }}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Streaks & goals ── */
const MY_DAYS_KEY = "lp-my-prayer-days";

function recordMyPrayerDay() {
  const today = localDay();
  let days = [];
  try { days = JSON.parse(lsGet(MY_DAYS_KEY) || "[]"); } catch (_e) {}
  if (!days.includes(today)) lsSet(MY_DAYS_KEY, JSON.stringify([today, ...days].slice(0, 120)));
}

function myStreak() {
  let days = [];
  try { days = JSON.parse(lsGet(MY_DAYS_KEY) || "[]"); } catch (_e) {}
  const set = new Set(days);
  const d = new Date();
  const key = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  if (!set.has(key(d))) d.setDate(d.getDate() - 1); // today not done yet: streak still alive from yesterday
  let n = 0;
  while (set.has(key(d))) { n++; d.setDate(d.getDate() - 1); }
  return { days: n, today: set.has(localDay()) };
}

function Bar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div style={{ height:8, background:C.faint, borderRadius:4, overflow:"hidden" }}><div style={{ height:"100%", width:`${pct}%`, background:color, borderRadius:4, transition:"width 0.6s ease" }} /></div>;
}

function GoalsCard({ goals, activePeople, weekHistory, smallGroups, myGroupId }) {
  const total = activePeople.length;
  const target = Math.max(1, Math.ceil(total * (goals.weeklyPct || 100) / 100));
  const prayed = activePeople.filter(p => withinWeek(p.prayedAt)).length;
  const met = prayed >= target;
  let teamStreak = 0;
  for (const w of weekHistory) {
    const t = Math.max(1, Math.ceil((w.total || 0) * (goals.weeklyPct || 100) / 100));
    if (w.total > 0 && w.count >= t) teamStreak++; else break;
  }
  const mine = myStreak();
  const friends = activePeople.reduce((n, p) => n + (p.causeCircle || []).length, 0);
  const shared = activePeople.reduce((n, p) => n + (p.causeCircle || []).filter(f => f.shared).length, 0);
  const groupRows = smallGroups.map(g => {
    const list = activePeople.filter(p => inSG(p, g.id));
    return { id: g.id, name: g.name, total: list.length, done: list.filter(p => withinWeek(p.prayedAt)).length };
  }).filter(r => r.total > 0);

  const label = { fontSize:10, color:C.muted, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" };
  const tile = { flex:1, background:C.faint, borderRadius:10, padding:"10px 12px", display:"flex", flexDirection:"column", gap:2 };
  return (
    <div style={{ background:C.surface, border:`1px solid ${met ? C.accent + "66" : C.border}`, borderRadius:14, padding:"14px 16px", marginBottom:16, display:"flex", flexDirection:"column", gap:14 }}>
      <div>
        <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}>
          <Target size={14} color={C.accent} />
          <span style={{ fontSize:13, fontWeight:700, color:C.cream }}>Team goal this week</span>
          <span style={{ marginLeft:"auto", fontSize:13, color: met ? C.accentLight : C.cream, fontWeight:700 }}>{met ? "Goal met! 🎉" : `${prayed} / ${target}`}</span>
        </div>
        <Bar value={prayed} max={target} color={`linear-gradient(90deg, ${C.blue}, ${C.accent})`} />
        <p style={{ margin:"6px 0 0", fontSize:12, color:C.muted }}>
          {goals.weeklyPct >= 100 ? `Pray for every person on the roster (${total}).` : `Pray for ${goals.weeklyPct}% of the roster (${target} of ${total}).`}
          {!met && ` ${target - prayed} to go.`}
        </p>
      </div>

      <div style={{ display:"flex", gap:8 }}>
        <div style={tile}>
          <span style={label}>Team streak</span>
          <span style={{ fontSize:20, fontWeight:800, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif", display:"flex", alignItems:"center", gap:5 }}><Flame size={17} color={teamStreak ? C.orange : C.muted} />{teamStreak}<span style={{ fontSize:12, fontWeight:500, color:C.muted }}>wk{teamStreak === 1 ? "" : "s"}</span></span>
          <span style={{ fontSize:11, color:C.muted }}>goal met in a row</span>
        </div>
        <div style={tile}>
          <span style={label}>Your streak</span>
          <span style={{ fontSize:20, fontWeight:800, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif", display:"flex", alignItems:"center", gap:5 }}><Flame size={17} color={mine.days ? C.orange : C.muted} />{mine.days}<span style={{ fontSize:12, fontWeight:500, color:C.muted }}>day{mine.days === 1 ? "" : "s"}</span></span>
          <span style={{ fontSize:11, color: mine.today ? C.accentLight : C.muted }}>{mine.today ? "prayed today ✓" : mine.days ? "pray today to keep it" : "pray today to start one"}</span>
        </div>
      </div>

      {groupRows.length > 0 && (
        <div>
          <span style={label}>Small groups this week</span>
          <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
            {groupRows.sort((a, b) => (b.id === myGroupId) - (a.id === myGroupId) || (b.done / b.total) - (a.done / a.total)).map(r => (
              <div key={r.id} style={r.id === myGroupId ? { background:C.faint, margin:"0 -8px", padding:"6px 8px", borderRadius:8 } : {}}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, marginBottom:4 }}>
                  <span style={{ color:C.cream, fontWeight: r.id === myGroupId ? 700 : 400 }}>{r.name}{r.id === myGroupId && <span style={{ color:C.accentLight, fontWeight:500 }}> · your group</span>}</span>
                  <span style={{ color: r.done >= r.total ? C.accentLight : C.muted }}>{r.done >= r.total ? "all prayed ✓" : `${r.done} / ${r.total}`}</span>
                </div>
                <Bar value={r.done} max={r.total} color={C.accent} />
              </div>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const gt = gospelTotals(activePeople);
        if (!gt.all && !(goals.convGoal > 0)) return null;
        const monthName = new Date().toLocaleDateString("en-US", { month: "long" });
        return (
          <div>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
              <span style={label}>Gospel conversations in {monthName}</span>
              <span style={{ fontSize:12.5, color:C.cream, fontWeight:600 }}>{gt.month}{goals.convGoal > 0 ? ` / ${goals.convGoal}` : ""}</span>
            </div>
            {goals.convGoal > 0 && <Bar value={gt.month} max={goals.convGoal} color={C.orange} />}
            <p style={{ margin:"6px 0 0", fontSize:12, color:C.muted }}>{gt.all} all time{gt.trusted > 0 ? ` · ${gt.trusted} friend${gt.trusted === 1 ? "" : "s"} trusted Jesus 🎉` : ""}</p>
          </div>
        );
      })()}

      {(goals.gospelGoal > 0 || friends > 0) && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:6 }}>
            <span style={label}>CAUSE Circles — heard the Gospel</span>
            <span style={{ fontSize:12.5, color:C.cream, fontWeight:600 }}>{shared}{goals.gospelGoal > 0 ? ` / ${goals.gospelGoal}` : ` of ${friends}`}</span>
          </div>
          <Bar value={shared} max={goals.gospelGoal > 0 ? goals.gospelGoal : friends} color={C.orange} />
          <p style={{ margin:"6px 0 0", fontSize:12, color:C.muted }}>{friends} friend{friends === 1 ? "" : "s"} being prayed for by name.</p>
        </div>
      )}
    </div>
  );
}

function GoalsEditor({ goals, onSave }) {
  const [pct, setPct] = React.useState(goals.weeklyPct || 100);
  const [gospel, setGospel] = React.useState(goals.gospelGoal || 0);
  const [conv, setConv] = React.useState(goals.convGoal || 0);
  const [msg, setMsg] = React.useState("");
  React.useEffect(() => { setPct(goals.weeklyPct || 100); setGospel(goals.gospelGoal || 0); setConv(goals.convGoal || 0); }, [goals.weeklyPct, goals.gospelGoal, goals.convGoal]);
  return (
    <div style={{ ...S.reportBox, marginTop:14, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}><Target size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>Team Goals</p></div>
      <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:C.cream }}>
        <span style={{ flex:1 }}>Weekly goal: pray for</span>
        <select value={pct} onChange={e => setPct(Number(e.target.value))} style={S.gradeSelect}>
          {[100, 90, 80, 75, 60, 50].map(v => <option key={v} value={v}>{v === 100 ? "everyone" : `${v}% of roster`}</option>)}
        </select>
      </label>
      <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:C.cream }}>
        <span style={{ flex:1 }}>Gospel shared goal <span style={{ color:C.muted }}>(CAUSE friends, 0 = none)</span></span>
        <input type="number" min={0} max={10000} value={gospel} onChange={e => setGospel(e.target.value)} style={{ ...S.gradeSelect, width:72 }} />
      </label>
      <label style={{ display:"flex", alignItems:"center", gap:10, fontSize:13, color:C.cream }}>
        <span style={{ flex:1 }}>Gospel conversations per month <span style={{ color:C.muted }}>(0 = none)</span></span>
        <input type="number" min={0} max={10000} value={conv} onChange={e => setConv(e.target.value)} style={{ ...S.gradeSelect, width:72 }} />
      </label>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={async () => { setMsg(""); try { await onSave({ weeklyPct: pct, gospelGoal: Number(gospel) || 0, convGoal: Number(conv) || 0 }); setMsg("Saved."); } catch (_e) { setMsg("Couldn’t save."); } }} style={S.confirmBtn}>Save goals</button>
        {msg && <span style={{ fontSize:12, color: msg === "Saved." ? C.accentLight : "#e07a5f" }}>{msg}</span>}
      </div>
    </div>
  );
}

export default function App() {
  const [status, setStatus] = React.useState(null);
  const [failed, setFailed] = React.useState(false);

  const refresh = React.useCallback(() => {
    apiAuthStatus().then(s => { setStatus(s); setFailed(false); }).catch(() => setFailed(true));
  }, []);

  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    window.addEventListener("lp-signed-out", refresh);
    return () => window.removeEventListener("lp-signed-out", refresh);
  }, [refresh]);

  if (typeof location !== "undefined" && location.pathname.replace(/\/+$/, "") === "/submit") return <StudentPage />;
  if (typeof location !== "undefined" && location.pathname.replace(/\/+$/, "") === "/parents") return <ParentPage />;
  if (failed) return (
    <div style={authWrap}>
      <p style={{ color:"#f2f1ee", fontSize:16, marginBottom:12 }}>Can’t reach the server.</p>
      <button onClick={refresh} style={{ ...authBtn, padding:"10px 24px" }}>Try again</button>
    </div>
  );
  if (!status) return <LoadingScreen />;
  if (!status.configured) return <SetupScreen onComplete={setStatus} />;
  if (status.role === "student" && !window.__LP_DEMO) return <StudentPage />;
  if (status.role === "parent" && !window.__LP_DEMO) return <ParentPage />;
  if (!status.role || status.role === "student" || status.role === "parent") return <LockScreen status={status} onSignedIn={setStatus} />;
  return <AppMain settings={status} role={status.role} onStatus={setStatus} />;
}

function AppMain({ settings, role, onStatus }) {
  const MINISTRY_NAME = settings.name;
  const MINISTRY_SUB = settings.sub || "";

  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("pray");
  const [order, setOrder] = useState("random");
  // Each leader can pick "my small group" on their device; the Pray deck opens to it
  const [myGroupId, setMyGroupIdState] = useState(() => lsGet("lp-my-group") || "");
  const [filter, setFilter] = useState(() => lsGet("lp-my-group") ? `sg:${lsGet("lp-my-group")}` : "all");
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [pickingGroup, setPickingGroup] = useState(false);
  function setMyGroup(id) {
    lsSet("lp-my-group", id || null);
    setMyGroupIdState(id || "");
    setFilter(id ? `sg:${id}` : "all");
    setCardIdx(0);
    setPickingGroup(false);
  }
  const [cardIdx, setCardIdx] = useState(0);
  const [deckIds, setDeckIds] = useState([]);
  const [ready, setReady] = useState(() => !shouldShowTap());
  const [pinnedPersonId, setPinnedPersonId] = useState(null);
  const [keepPrayingMode, setKeepPrayingMode] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Swipe
  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const [swipeDelta, setSwipeDelta] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [cardAnim, setCardAnim] = useState("idle"); // idle | exiting-left | exiting-right | entering-left | entering-right

  // People mgmt
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState("student");
  const [addGroup, setAddGroup] = useState("hs");
  const [search, setSearch] = useState("");
  const [editBdayFor, setEditBdayFor] = useState(null);
  const [editNameFor, setEditNameFor] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [confirmPromo, setConfirmPromo] = useState(false);
  const [confirmClearInactive, setConfirmClearInactive] = useState(false);
  const [weekHistory, setWeekHistory] = useState([]);
  const [bdayInput, setBdayInput] = useState("");

  // Prayer requests
  const [answeringReq, setAnsweringReq] = useState(null);
  const [answerUpdate, setAnswerUpdate] = useState("");
  const [reqFor, setReqFor] = useState(null);
  const [reqText, setReqText] = useState("");

  // Import
  const [importData, setImportData] = useState(null);
  const fileRef = useRef(null);

  const saveTimer = useRef(null);
  const pollTimer = useRef(null);
  const isSaving = useRef(false);

  // Admin auth
  const adminAuthed = role === "admin";
  const [showAdminPrompt, setShowAdminPrompt] = useState(false);
  const [adminPwInput, setAdminPwInput] = useState("");
  const [adminPwError, setAdminPwError] = useState("");
  const [pendingView, setPendingView] = useState(null);

  // Small groups
  const [smallGroups, setSmallGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [editGroupFor, setEditGroupFor] = useState(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const [confirmDeleteGroup, setConfirmDeleteGroup] = useState(null);
  const [peopleGroupFilter, setPeopleGroupFilter] = useState("all");
  const [rosterSmallGroup, setRosterSmallGroup] = useState("all");

  // Goals + student inbox
  const [goals, setGoals] = useState({ weeklyPct: 100, gospelGoal: 0, convGoal: 0 });
  const [submissions, setSubmissions] = useState([]);

  // CAUSE Circle
  const [causeFor, setCauseFor] = useState(null);
  const [causeText, setCauseText] = useState("");

  // Photos
  const photoInputRef = useRef(null);
  const photoTargetRef = useRef(null);
  const [photoBusy, setPhotoBusy] = useState(null);
  const [photoError, setPhotoError] = useState("");


  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,500;0,600;0,700;0,800;1,500&family=Inter:wght@300;400;500;600&display=swap";
    document.head.appendChild(link);
    const style = document.createElement("style");
    style.textContent = `
  @keyframes tapPulse { 0%,100%{opacity:1} 50%{opacity:0.65} }
  @keyframes flyOutLeft  { to { transform: translateX(-110%) rotate(-8deg); opacity: 0; } }
  @keyframes flyOutRight { to { transform: translateX(110%)  rotate(8deg);  opacity: 0; } }
  @keyframes flyInLeft   { from { transform: translateX(110%)  rotate(6deg);  opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes flyInRight  { from { transform: translateX(-110%) rotate(-6deg); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes confettiFall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
  @keyframes celebPulse { 0%,100%{transform:scale(1) filter:drop-shadow(0 0 0px #4cad3b)} 50%{transform:scale(1.1) filter:drop-shadow(0 0 12px #4cad3b)} }
  @keyframes bdayGlow { 0%,100%{box-shadow:0 0 8px 2px rgba(255,255,255,0.2), 0 0 0 0 rgba(255,255,255,0)} 50%{box-shadow:0 0 18px 6px rgba(255,255,255,0.35), 0 0 32px 12px rgba(255,255,255,0.1)} }
  @keyframes bdaySpin { 0%{transform:rotate(-8deg) scale(1.08)} 50%{transform:rotate(8deg) scale(1.15)} 100%{transform:rotate(-8deg) scale(1.08)} }
`;
    document.head.appendChild(style);
    return () => { link.remove(); style.remove(); };
  }, []);

  useEffect(() => {
    if (groupsLoaded && myGroupId && !smallGroups.some(g => g.id === myGroupId)) setMyGroup("");
  }, [groupsLoaded, smallGroups, myGroupId]);

  const [series] = useSeries();
  const [devotional, setDevotional] = useState(null);
  useEffect(() => {
    const load = () => fetch("/api/data?key=devotional", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setDevotional).catch(() => {});
    load();
    window.addEventListener("lp-devo-updated", load);
    const t = setInterval(load, 10 * 60 * 1000);
    return () => { window.removeEventListener("lp-devo-updated", load); clearInterval(t); };
  }, []);
  const [seriesPane, setSeriesPane] = useState("series");
  const [events] = useEvents();
  const calendar = useCalendar(role);
  function prayThroughEvent(id) { setFilter(`ev:${id}`); setCardIdx(0); window.scrollTo(0, 0); }

  // Prayer walls for leaders: student posts from the server, family requests from the roster
  const [studentWall, setStudentWall] = useState([]);
  const [wallSeen, setWallSeen] = useState(() => Number(lsGet(WALL_SEEN_KEY)) || 0);
  const [wallTab, setWallTab] = useState("students");
  useEffect(() => {
    const load = () => fetch("/api/wall").then(r => r.ok ? r.json() : []).then(l => Array.isArray(l) && setStudentWall(l)).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  function prayStudentPost(id) {
    setStudentWall(prev => prev.map(p => p.id === id ? { ...p, prayed: p.prayed + 1 } : p));
    fetch("/api/wall?action=pray", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
  }
  const newStudentPosts = studentWall.filter(p => p.createdAt > wallSeen).length;
  const newFamily = familyWallItems(people).filter(f => (f.at || 0) > wallSeen).length;
  const wallNew = newStudentPosts + newFamily;
  function openWall(t) {
    if (t) setWallTab(t);
    setView("wall");
  }
  useEffect(() => {
    if (view !== "wall") return;
    const now = Date.now();
    // Mark as seen when they leave the Wall, so the "new" counts stay visible while reading
    return () => { lsSet(WALL_SEEN_KEY, String(now)); setWallSeen(now); };
  }, [view]);

  // Student inbox (admins only)
  const loadInbox = useCallback(() => {
    if (!adminAuthed) return;
    fetch("/api/inbox").then(r => r.ok ? r.json() : []).then(list => Array.isArray(list) && setSubmissions(list)).catch(() => {});
  }, [adminAuthed]);
  useEffect(() => {
    if (!adminAuthed) { setSubmissions([]); return; }
    loadInbox();
    const t = setInterval(loadInbox, 60000);
    return () => clearInterval(t);
  }, [adminAuthed, loadInbox]);

  async function removeSubmissions(ids) {
    setSubmissions(prev => prev.filter(x => !ids.includes(x.id)));
    await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "remove", ids }) }).catch(() => {});
  }

  async function saveGoals(next) {
    const res = await fetch("/api/data?key=goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error("save failed");
    setGoals({ weeklyPct: data.weeklyPct, gospelGoal: data.gospelGoal, convGoal: data.convGoal });
  }

  // Keep the service worker fresh and skip today's reminder once the app is opened
  useEffect(() => {
    if (pushSupported()) navigator.serviceWorker.register("/sw.js").catch(() => {});
    markSeenToday();
  }, []);

  // Load from KV + snapshot previous week if it just rolled over
  useEffect(() => {
    (async () => {
      try {
        const [data, history, groups] = await Promise.all([apiLoad(), apiLoadHistory(), apiLoadSmallGroups()]);
        if (data.length > 0) setPeople(data);
        setSmallGroups(groups);
        setGroupsLoaded(true);
        fetch("/api/data?key=goals").then(r => r.ok ? r.json() : null).then(g => g && setGoals(g)).catch(() => {});

        const currentWeekStart = getWeekStartET();
        const currentWeekDate = new Date(currentWeekStart).toLocaleDateString("en-US", { timeZone: "America/New_York" });
        const lastSnapshotDate = history.length > 0
          ? new Date(history[0].weekStart).toLocaleDateString("en-US", { timeZone: "America/New_York" })
          : null;

        if (lastSnapshotDate !== currentWeekDate) {
          const prevWeekStart = currentWeekStart - 7 * 24 * 60 * 60 * 1000;
          const prevWeekDateStr = getPrevWeekDateStringET();
          // Use date string comparison — immune to timestamp precision issues
          const prevWeekPrayed = data.filter(p =>
            p.prayedWeekDate === prevWeekDateStr ||
            // Fallback for records before prayedWeekDate was introduced
            (!p.prayedWeekDate && p.prayedAt && p.prayedAt >= prevWeekStart && p.prayedAt < currentWeekStart)
          );
          const prevWeekCount = prevWeekPrayed.reduce((sum, p) =>
            sum + (p.prayedWeekDate === prevWeekDateStr && p.weekPrayCount ? p.weekPrayCount : 1), 0
          );
          const total = data.filter(p => p.active !== false).length;
          const newEntry = { weekStart: currentWeekStart, prevWeekStart, prevWeekDateStr, count: prevWeekCount, total };
          const updated = [newEntry, ...history].slice(0, 52);
          setWeekHistory(updated);
          await apiSaveHistory(updated);
        } else {
          setWeekHistory(history);
        }
        setLoaded(true);
      } catch {
        setTimeout(async () => {
          try {
            const data = await apiLoad();
            if (data.length > 0) setPeople(data);
          } catch (_e) {}
          setLoaded(true);
        }, 3000);
      }
    })();
  }, []);

  // Track whether current people state came from a remote poll (no save needed)
  const fromPoll = useRef(false);
  const lastSaved = useRef(null);
  const pendingChange = useRef(false); // true while user has unsaved changes

  // Save to KV (debounced 500ms — fast enough to beat 15s poll)
  useEffect(() => {
    if (!loaded) return;
    if (fromPoll.current) { fromPoll.current = false; return; }
    pendingChange.current = true; // mark that user has changes in flight
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (people.length === 0) { pendingChange.current = false; return; }
      const snapshot = JSON.stringify(people);
      if (snapshot === lastSaved.current) { pendingChange.current = false; return; }
      isSaving.current = true;
      await apiSave(people).catch(() => {});
      lastSaved.current = snapshot;
      isSaving.current = false;
      pendingChange.current = false;
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [people, loaded]);

  // Poll for remote changes every 15s — skip entirely if user has unsaved changes
  useEffect(() => {
    if (!loaded) return;
    const poll = async () => {
      // Skip poll if user is actively making changes or a save is in flight
      if (isSaving.current || pendingChange.current) return;
      try {
        apiLoadSmallGroups().then(g => setSmallGroups(prev => JSON.stringify(prev) === JSON.stringify(g) ? prev : g)).catch(() => {});
        const fresh = await apiLoad();
        if (fresh.length === 0) return;
        const freshStr = JSON.stringify(fresh);
        setPeople(prev => {
          if (prev.length > 0 && fresh.length === 0) return prev;
          if (JSON.stringify(prev) === freshStr) return prev;
          fromPoll.current = true;
          return fresh;
        });
      } catch (_e) {}
    };
    pollTimer.current = setInterval(poll, 15000);
    return () => clearInterval(pollTimer.current);
  }, [loaded]);

  const activePeople = people.filter(p => p.active !== false);

  const getFiltered = useCallback(() => {
    return activePeople.filter(p => matchesFilter(p, filter, events));
  }, [people, filter]);

  const buildDeck = useCallback((filterOverride) => {
    const f = filterOverride ?? filter;
    const list = activePeople.filter(p => matchesFilter(p, f, events));
    // Always exclude prayed-this-week from swipe deck
    const unprayed = list.filter(p => !withinWeek(p.prayedAt));
    const shuffled = shuffle(unprayed.map(p => p.id));
    // Move today's birthday person to front if they're in the deck
    const todayBdayId = unprayed.find(p => getBirthdayStatus(p.birthday)?.today)?.id;
    if (todayBdayId) {
      const idx = shuffled.indexOf(todayBdayId);
      if (idx > 0) { shuffled.splice(idx, 1); shuffled.unshift(todayBdayId); }
    }
    setDeckIds(shuffled);
    setCardIdx(0);
    setPinnedPersonId(null);
    setKeepPrayingMode(false);
    setDropdownOpen(false);
    if (shouldShowTap()) setReady(false); else setReady(true);
  }, [people, filter]);

  useEffect(() => { if (loaded) buildDeck(); }, [loaded, filter, order]);

  // When someone gets marked as prayed, remove them from deck immediately
  useEffect(() => {
    if (!loaded) return;
    setDeckIds(prev => {
      const prayedSet = new Set(activePeople.filter(p => withinWeek(p.prayedAt)).map(p => p.id));
      const filtered = prev.filter(id => !prayedSet.has(id));
      if (filtered.length !== prev.length) { setCardIdx(i => Math.min(i, Math.max(filtered.length - 1, 0))); }
      return filtered;
    });
  }, [people]);

  const deck = (() => {
    if (order === "alpha") return getFiltered().filter(p => !withinWeek(p.prayedAt)).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (order === "oldest") return getFiltered().filter(p => !withinWeek(p.prayedAt)).slice().sort((a, b) => (a.prayedAt || 0) - (b.prayedAt || 0));
    const map = Object.fromEntries(activePeople.map(p => [p.id, p]));
    return deckIds.map(id => map[id]).filter(Boolean);
  })();

  const pinnedPerson = pinnedPersonId ? activePeople.find(p => p.id === pinnedPersonId) ?? null : null;
  const current = pinnedPerson ?? deck[cardIdx] ?? null;

  const prayedPeople = activePeople.filter(p => withinWeek(p.prayedAt));

  // Streak: consecutive weeks where count >= total (everyone prayed for)
  const streak = React.useMemo(() => {
    if (!weekHistory.length) return 0;
    let count = 0;
    for (const w of weekHistory) {
      if (w.total > 0 && w.count >= w.total) count++;
      else break;
    }
    return count;
  }, [weekHistory]);
  const prayedCount = prayedPeople.length; // unique people prayed
  const praySessionCount = prayedPeople.reduce((sum, p) => sum + (p.weekPrayCount || 1), 0); // total sessions this week
  const upcomingBdays = getUpcomingBirthdays(activePeople);
  const urgentBdays = upcomingBdays.filter(b => b.diff <= 3).length;
  const todayBdayPrayed = upcomingBdays.filter(b => b.diff === 0 && withinWeek(b.person.prayedAt) && !isBdayDismissed(b.person.id));

  function goToPerson(personId) {
    setView("pray");
    setDropdownOpen(false);
    const deckIdx = deck.findIndex(p => p.id === personId);
    if (deckIdx >= 0) {
      setPinnedPersonId(null);
      setCardIdx(deckIdx);
    } else {
      setPinnedPersonId(personId);
    }
    if (!ready) { setReady(true); recordTapShown(); }
  }

  function nav(dir, animate = false) {
    setReqFor(null);
    setSwipeDelta(0);
    setPinnedPersonId(null);
    setCardIdx(i => {
      let n = i + dir;
      if (n < 0) n = deck.length - 1;
      if (n >= deck.length) n = 0;
      return n;
    });
  }

  function navWithAnim(dir) {
    const exitAnim = dir > 0 ? "exiting-left" : "exiting-right";
    const enterAnim = dir > 0 ? "entering-left" : "entering-right";
    setCardAnim(exitAnim);
    setTimeout(() => {
      if (keepPrayingMode) {
        // In keep praying mode the deck is empty — pick a new random person
        const p = activePeople;
        if (p.length) {
          const pick = p[Math.floor(Math.random() * p.length)];
          setPinnedPersonId(pick.id);
          setReqFor(null);
        }
      } else {
        nav(dir);
      }
      setCardAnim(enterAnim);
      setTimeout(() => setCardAnim("idle"), 320);
    }, 200);
  }

  function selectFromDropdown(personId) {
    setDropdownOpen(false);
    setReqFor(null);
    // If person is in unprayed deck, jump to their index
    const deckIdx = deck.findIndex(p => p.id === personId);
    if (deckIdx >= 0) {
      setPinnedPersonId(null);
      setCardIdx(deckIdx);
    } else {
      // Already prayed — pin their card
      setPinnedPersonId(personId);
    }
  }

  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setIsSwiping(false);
    setSwipeDelta(0);
  }

  function handleTouchMove(e) {
    if (touchStartX.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isSwiping && Math.abs(dy) > Math.abs(dx)) return;
    setIsSwiping(true);
    e.preventDefault();
    setSwipeDelta(dx);
  }

  function handleTouchEnd() {
    const delta = swipeDelta;
    setIsSwiping(false);
    touchStartX.current = null;
    touchStartY.current = null;
    if (Math.abs(delta) > 55) {
      const dir = delta < 0 ? "left" : "right";
      setCardAnim(`exiting-${dir}`);
      setTimeout(() => {
        if (keepPrayingMode) {
          const p = activePeople;
          if (p.length) { setPinnedPersonId(p[Math.floor(Math.random() * p.length)].id); setReqFor(null); }
        } else {
          nav(delta < 0 ? 1 : -1);
        }
        setSwipeDelta(0);
        setCardAnim(`entering-${dir === "left" ? "left" : "right"}`);
        setTimeout(() => setCardAnim("idle"), 320);
      }, 220);
    } else {
      setSwipeDelta(0);
    }
  }

  function markPrayed() {
    if (!current) return;
    setPeople(prev => prev.map(p => {
      if (p.id !== current.id) return p;
      const weekStart = getWeekStartET();
      const inSameWeek = p.prayedAt && p.prayedAt >= weekStart;
      const weekDateStr = getWeekDateStringET();
      return { ...p, prayedAt: Date.now(), prayedWeek: weekStart, prayedWeekDate: weekDateStr, prayCount: (p.prayCount || 0) + 1, weekPrayCount: inSameWeek ? (p.weekPrayCount || 1) + 1 : 1, updatedAt: Date.now() };
    }));
    if (current?.id) dismissBday(current.id);
    if (current?.notifyId) fetch("/api/push?action=prayed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personId: current.id }) }).catch(() => {});
    recordMyPrayerDay();
    setPinnedPersonId(null);
    setKeepPrayingMode(false); // return to celebration screen after Pray Again
  }

  function startKeepPraying(pool) {
    const p = pool || activePeople;
    if (!p.length) return;
    const pick = p[Math.floor(Math.random() * p.length)];
    setKeepPrayingMode(true);
    setPinnedPersonId(pick.id);
    setReqFor(null);
    setReady(true);
  }

  function unmarkPrayed() {
    if (!current) return;
    setPeople(prev => prev.map(p => p.id === current.id ? { ...p, prayedAt: null, updatedAt: Date.now() } : p));
  }

  const [addGrade, setAddGrade] = useState("");
  const [addBday, setAddBday] = useState("");
  const [peopleSort, setPeopleSort] = useState("name");
  const [peopleTypeFilter, setPeopleTypeFilter] = useState("all");
  const [rosterGroup, setRosterGroup] = useState("all"); // all | ms | hs | leader
  const [rosterSort, setRosterSort] = useState("name"); // name | grade | birthday

  function addPerson() {
    if (!addName.trim()) return;
    setPeople(prev => [...prev, { id: genId(), name: addName.trim(), type: addType, group: addType === "student" ? addGroup : null, grade: addType === "student" && addGrade ? Number(addGrade) : null, active: true, prayedAt: null, prayerRequests: [], birthday: addBday.trim() || "", updatedAt: Date.now() }]);
    setAddBday("");
    setAddName("");
    setAddGrade("");
  }

  function cycleGroup(id) {
    setPeople(prev => prev.map(p => {
      if (p.id !== id) return p;
      if (p.type === "leader") return { ...p, group: p.group === "hs" ? "ms" : p.group === "ms" ? "both" : p.group === "both" ? null : "hs", updatedAt: Date.now() };
      return { ...p, group: p.group === "hs" ? "ms" : p.group === "ms" ? null : "hs", updatedAt: Date.now() };
    }));
  }

  function toggleType(id) {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, type: p.type === "student" ? "leader" : "student", updatedAt: Date.now() } : p));
  }

  function deactivate(id) { setPeople(prev => prev.map(p => p.id === id ? { ...p, active: false, updatedAt: Date.now() } : p)); }
  function restore(id) { setPeople(prev => prev.map(p => p.id === id ? { ...p, active: true, updatedAt: Date.now() } : p)); }
  function exportRoster() {
    const rows = [
      ["First Name", "Last Name", "Type", "Staff", "Group", "Grade", "Birthday", "Small Groups"],
      ...people.filter(p => p.active !== false).map(p => {
        const [first, ...rest] = (p.name || "").trim().split(" ");
        const last = rest.join(" ");
        return [first, last, p.type || "", p.staff ? "Yes" : "", groupLabel(p.group), p.grade || "", p.birthday || "", sgIds(p).map(groupName).filter(Boolean).join("; ")];
      })
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(MINISTRY_NAME || "roster").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearAllInactive() {
    setPeople(prev => {
      const filtered = prev.filter(p => p.active !== false);
      // Save immediately — don't wait for debounce
      apiSave(filtered, true).catch(() => {});
      return filtered;
    });
    setConfirmClearInactive(false);
  }

  function deletePerm(id) {
    setPeople(prev => {
      const filtered = prev.filter(p => p.id !== id);
      apiSave(filtered, true).catch(() => {});
      return filtered;
    });
  }

  function saveBirthday(id, val) {
    setPeople(prev => prev.map(p => p.id === id ? { ...p, birthday: val, updatedAt: Date.now() } : p));
    setEditBdayFor(null);
    setBdayInput("");
  }

  function saveName(id) {
    if (!nameInput.trim()) return;
    setPeople(prev => prev.map(p => p.id === id ? { ...p, name: nameInput.trim(), updatedAt: Date.now() } : p));
    setEditNameFor(null);
    setNameInput("");
  }

  function promoteGrades() {
    setPeople(prev => prev.map(p => {
      if (p.type !== "student" || !p.grade) return p;
      if (Number(p.grade) >= 12) return { ...p, active: false };
      const newGrade = Number(p.grade) + 1;
      const newGroup = Number(p.grade) === 8 ? "hs" : p.group;
      return { ...p, grade: newGrade, group: newGroup };
    }));
    setConfirmPromo(false);
  }

  function addRequest(personId) {
    if (!reqText.trim()) return;
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, prayerRequests: [...(p.prayerRequests || []), reqText.trim()], reqTimes: [Date.now(), ...(p.reqTimes || [])].slice(0, 60), updatedAt: Date.now() } : p));
    setReqText(""); setReqFor(null);
  }

  // Move a request into the person's "Answered" list, with an optional update
  function markAnswered(personId, idx) {
    const update = answerUpdate.trim();
    setPeople(prev => prev.map(p => {
      if (p.id !== personId) return p;
      const text = (p.prayerRequests || [])[idx];
      if (text === undefined) return p;
      return { ...p, prayerRequests: p.prayerRequests.filter((_, i) => i !== idx), answered: [{ id: genId(), text, update, at: Date.now(), by: "leader" }, ...(p.answered || [])], updatedAt: Date.now() };
    }));
    setAnsweringReq(null); setAnswerUpdate("");
  }

  function removeRequest(personId, idx) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, prayerRequests: p.prayerRequests.filter((_, i) => i !== idx), updatedAt: Date.now() } : p));
  }

  /* ── CAUSE Circle ── */
  function addCauseFriend(personId) {
    const name = causeText.trim();
    if (!name) return;
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, causeCircle: [...(p.causeCircle || []), { id: genId(), name, shared: false }], updatedAt: Date.now() } : p));
    setCauseText("");
  }

  function toggleCauseShared(personId, friendId) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, causeCircle: (p.causeCircle || []).map(f => f.id === friendId ? { ...f, shared: !f.shared } : f), updatedAt: Date.now() } : p));
  }

  function removeCauseFriend(personId, friendId) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, causeCircle: (p.causeCircle || []).filter(f => f.id !== friendId), updatedAt: Date.now() } : p));
  }

  /* ── Small groups ── */
  function saveGroups(next) {
    setSmallGroups(next);
    apiSaveSmallGroups(next).catch(() => {});
  }

  function addSmallGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    saveGroups([...smallGroups, { id: genId(), name }]);
    setNewGroupName("");
  }

  function renameSmallGroup(id) {
    const name = groupNameInput.trim();
    if (!name) return;
    saveGroups(smallGroups.map(g => g.id === id ? { ...g, name } : g));
    setEditGroupFor(null);
    setGroupNameInput("");
  }

  function deleteSmallGroup(id) {
    saveGroups(smallGroups.filter(g => g.id !== id));
    setPeople(prev => prev.map(p => inSG(p, id) ? { ...p, smallGroupIds: sgIds(p).filter(x => x !== id), smallGroupId: null, updatedAt: Date.now() } : p));
    if (filter === `sg:${id}`) setFilter("all");
    if (rosterSmallGroup === id) setRosterSmallGroup("all");
    if (peopleGroupFilter === id) setPeopleGroupFilter("all");
    setConfirmDeleteGroup(null);
  }

  function assignSmallGroup(personId, groupId) {
    // Toggle membership in one group; a person can be in several
    setPeople(prev => prev.map(p => {
      if (p.id !== personId) return p;
      const ids = sgIds(p);
      const next = ids.includes(groupId) ? ids.filter(x => x !== groupId) : [...ids, groupId];
      return { ...p, smallGroupIds: next, smallGroupId: null, updatedAt: Date.now() };
    }));
  }

  function toggleStaff(personId) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, staff: !p.staff, updatedAt: Date.now() } : p));
  }

  const groupName = id => smallGroups.find(g => g.id === id)?.name || null;

  /* ── Photos ── */
  function pickPhoto(personId) {
    photoTargetRef.current = personId;
    setPhotoError("");
    if (photoInputRef.current) { photoInputRef.current.value = ""; photoInputRef.current.click(); }
  }

  async function handlePhotoChosen(e) {
    const file = e.target.files && e.target.files[0];
    const personId = photoTargetRef.current;
    if (!file || !personId) return;
    setPhotoBusy(personId);
    try {
      const v = await apiUploadPhoto(personId, file);
      setPeople(prev => prev.map(p => p.id === personId ? { ...p, photo: v, updatedAt: Date.now() } : p));
    } catch (err) {
      setPhotoError(err.message || "Upload failed");
    }
    setPhotoBusy(null);
  }

  async function removePhoto(personId) {
    setPhotoBusy(personId);
    await apiDeletePhoto(personId).catch(() => {});
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, photo: null, updatedAt: Date.now() } : p));
    setPhotoBusy(null);
  }

  function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setImportData(parseCSV(ev.target.result));
    reader.readAsText(file);
    e.target.value = "";
  }

  function confirmImport() {
    const existing = new Set(people.map(p => p.name.toLowerCase()));
    const toAdd = (importData || [])
      .filter(p => !existing.has(p.name.toLowerCase()))
      .map(p => ({ id: genId(), name: p.name, type: "student", group: null, active: true, prayedAt: null, prayerRequests: [], birthday: p.birthday || "" }));
    setPeople(prev => [...prev, ...toAdd]);
    setImportData(null);
    setView("people");
  }

  function handleTabClick(v) {
    if ((v === "people" || v === "import") && !adminAuthed) {
      setPendingView(v);
      setAdminPwInput("");
      setAdminPwError("");
      setShowAdminPrompt(true);
    } else {
      setView(v);
    }
  }

  async function recalculateHistory() {
    const currentWeekStart = getWeekStartET();
    const currentWeekDateStr = getWeekDateStringET();
    const newHistory = [];
    for (let i = 1; i <= 3; i++) {
      const wStart = currentWeekStart - i * 7 * 24 * 60 * 60 * 1000;
      const wEnd   = currentWeekStart - (i - 1) * 7 * 24 * 60 * 60 * 1000;
      // Build date string for this week's Monday
      const wDate = new Date(wStart);
      const etStr = wDate.toLocaleString("en-US", { timeZone: "America/New_York" });
      const etD = new Date(etStr);
      const wDateStr = `${etD.getMonth()+1}/${etD.getDate()}/${etD.getFullYear()}`;
      const prayed = people.filter(p =>
        p.prayedWeekDate === wDateStr ||
        (!p.prayedWeekDate && p.prayedAt && p.prayedAt >= wStart && p.prayedAt < wEnd)
      );
      const count = prayed.reduce((sum, p) =>
        sum + (p.prayedWeekDate === wDateStr && p.weekPrayCount ? p.weekPrayCount : 1), 0
      );
      if (count > 0) {
        newHistory.push({ weekStart: wEnd, prevWeekStart: wStart, prevWeekDateStr: wDateStr, count, total: activePeople.length });
      }
    }
    setWeekHistory(newHistory);
    await apiSaveHistory(newHistory);
  }

  async function submitAdminPw() {
    setAdminPwError("");
    try {
      const res = await apiAuth("login", { code: adminPwInput });
      if (res.role !== "admin") {
        setAdminPwError("That’s the team code — enter the admin password.");
        setAdminPwInput("");
        return;
      }
      onStatus(res);
      setShowAdminPrompt(false);
      if (pendingView) { setView(pendingView); setPendingView(null); }
    } catch (_e) {
      setAdminPwError("Incorrect password.");
      setAdminPwInput("");
    }
  }

  async function lockAdmin() {
    setView("pray");
    try { onStatus(await apiAuth("logout", { scope: "admin" })); } catch (_e) {}
  }

  async function signOutDevice() {
    try { onStatus(await apiAuth("logout", { scope: "all" })); } catch (_e) {}
  }

  if (!loaded) {
    return <div style={S.root}><p style={{ color: C.cream, fontFamily: "Montserrat, system-ui, sans-serif", textAlign: "center", marginTop: 80, fontSize: 20 }}>Loading…</p></div>;
  }

  const bdayStatus = current ? getBirthdayStatus(current.birthday) : null;
  const prayedThis = activePeople.filter(p => withinWeek(p.prayedAt)).sort((a, b) => b.prayedAt - a.prayedAt);
  const notPrayedThis = activePeople.filter(p => !withinWeek(p.prayedAt)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={S.root}>
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoChosen} style={{ display: "none" }} />
      {/* Header */}
      <header style={S.header}>
        <div style={S.logoWrap}>
          <img src="/logo.png" alt={MINISTRY_NAME} style={{ height: 40, width: "auto", display: "block" }} />
          <span style={S.appName}>
            <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" style={{ flexShrink:0 }}><path d="M10,1 C10.6,7.4 12.6,9.4 19,10 C12.6,10.6 10.6,12.6 10,19 C9.4,12.6 7.4,10.6 1,10 C7.4,9.4 9.4,7.4 10,1 Z" fill="#ffffff" /></svg>
            Let’s Pray
          </span>
        </div>
        <div style={{ ...S.weekBar, cursor: "pointer" }} onClick={() => setView("week")}>
          <Heart size={13} color={C.accent} fill={C.accent} />
          <span style={S.weekText}>{prayedCount >= activePeople.length ? praySessionCount : prayedCount} / {activePeople.length} this week</span>
          {urgentBdays > 0 && <span style={{ ...S.bdayAlert, ...(upcomingBdays.some(b => b.diff === 0 && !isBdayDismissed(b.person.id)) ? { animation:"bdayGlow 1.6s ease-in-out infinite" } : {}) }}><Cake size={12} /><span style={{lineHeight:1}}>{urgentBdays}</span></span>}
        </div>
      </header>

      {/* Progress */}
      <div style={S.progressTrack}>
        <div style={{ ...S.progressFill, width: activePeople.length ? `${Math.min(100, ((prayedCount >= activePeople.length ? praySessionCount : prayedCount) / activePeople.length) * 100)}%` : "0%" }} />
      </div>

      {/* Tabs */}
      <nav style={S.tabs}>
        {[["pray","Pray"],["wall","Wall"],...(calendar && calendar.configured ? [["calendar","Calendar"]] : []),["week","Week"],["roster","Roster"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v ? S.tabActive : {}), position:"relative" }}>
            {label}
            {v === "wall" && wallNew > 0 && view !== "wall" && <span style={S.tabBadge}>{wallNew}</span>}
          </button>
        ))}
        {adminAuthed && [["inbox","Inbox"],["series","Teach"],["people","People"],["report","Report"],["import","Import"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v ? S.tabActive : {}), position:"relative" }}>
            {label}
            {v === "inbox" && submissions.length > 0 && <span style={S.tabBadge}>{submissions.length}</span>}
          </button>
        ))}
      </nav>

      {/* Admin password modal */}
      {showAdminPrompt && (
        <div style={S.modalOverlay} onClick={() => setShowAdminPrompt(false)}>
          <div style={S.modalBox} onClick={e => e.stopPropagation()}>
            <p style={S.modalTitle}>Admin Access</p>
            <input
              autoFocus
              type="password"
              value={adminPwInput}
              onChange={e => setAdminPwInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitAdminPw(); if (e.key === "Escape") setShowAdminPrompt(false); }}
              placeholder="Password"
              style={S.modalInput}
            />
            {adminPwError && <p style={S.modalError}>{adminPwError}</p>}
            <div style={S.modalBtns}>
              <button onClick={submitAdminPw} style={S.confirmBtn}>Unlock</button>
              <button onClick={() => setShowAdminPrompt(false)} style={S.cancelBtn}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── PRAY ─── */}
      {view === "pray" && (
        <div style={S.prayWrap}>
          <LeaderNote note={devotional} />
          <SeriesCard series={series} mode="leader" />
          <EventCards events={events} mode="leader" onPrayThrough={prayThroughEvent} />
          <CheckInCard people={people} myGroupId={myGroupId} groupName={groupName} isAdmin={adminAuthed} goToPerson={goToPerson} />
          {wallNew > 0 && (
            <button onClick={() => openWall(newStudentPosts ? "students" : "parents")} style={S.wallBanner}>
              <Heart size={14} color={C.orange} fill={C.orange} style={{ flexShrink:0 }} />
              <span style={{ flex:1, textAlign:"left" }}>
                New on the Wall: {[newStudentPosts ? `${newStudentPosts} from students` : "", newFamily ? `${newFamily} from parents` : ""].filter(Boolean).join(" · ")}
              </span>
              <span style={{ color:C.orange, fontWeight:700 }}>View →</span>
            </button>
          )}
          {smallGroups.length > 0 && (
            <div style={S.myGroupRow}>
              {myGroupId && groupName(myGroupId) && !pickingGroup ? (
                <>
                  <div style={S.myGroupPill}>
                    <button onClick={() => { setFilter(`sg:${myGroupId}`); setCardIdx(0); }} style={{ ...S.myGroupOpt, ...(filter === `sg:${myGroupId}` ? S.myGroupOptOn : {}) }}>
                      <Users size={13} style={{ marginRight:6, flexShrink:0 }} /><span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{groupName(myGroupId)}</span>
                    </button>
                    <button onClick={() => { setFilter("all"); setCardIdx(0); }} style={{ ...S.myGroupOpt, ...(filter === "all" ? S.myGroupOptOn : {}) }}>Everyone</button>
                  </div>
                  <button onClick={() => setPickingGroup(true)} style={S.myGroupChange}>change</button>
                </>
              ) : (
                <>
                  <select value="" onChange={e => setMyGroup(e.target.value)} style={{ ...S.filterSelect, flex:1, color:C.cream, borderColor:C.accent + "66" }}>
                    <option value="">{myGroupId ? "Choose your small group…" : "Pray for my small group…"}</option>
                    {smallGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {myGroupId && <button onClick={() => setMyGroup("")} style={S.myGroupChange}>clear</button>}
                  {pickingGroup && <button onClick={() => setPickingGroup(false)} style={S.myGroupChange}>cancel</button>}
                </>
              )}
            </div>
          )}
          {photoError && view === "pray" && <p style={{ margin:"0 0 8px", fontSize:12, color:"#e07a5f", textAlign:"center" }}>Photo: {photoError}</p>}
          <div style={S.controls}>
            <div style={S.togglePill}>
              <button onClick={() => { setOrder("random"); buildDeck(); }} style={{ ...S.toggleOpt, ...(order === "random" ? S.toggleOptOn : {}) }}>Shuffle</button>
              <button onClick={() => { setOrder("alpha"); setCardIdx(0); if (shouldShowTap()) setReady(false); }} style={{ ...S.toggleOpt, ...(order === "alpha" ? S.toggleOptOn : {}) }}>A–Z</button>
              <button onClick={() => { setOrder("oldest"); setCardIdx(0); if (shouldShowTap()) setReady(false); }} style={{ ...S.toggleOpt, ...(order === "oldest" ? S.toggleOptOn : {}) }}>Time</button>
            </div>
            <select value={filter} onChange={e => { setFilter(e.target.value); setCardIdx(0); if (shouldShowTap()) setReady(false); }} style={S.filterSelect}>
              <option value="all">Everyone</option>
              <option value="ms-students">MS Students</option>
              <option value="hs-students">HS Students</option>
              <option value="leaders">Leaders</option>
              {people.some(p => p.staff && p.active !== false) && <option value="staff">Staff</option>}
              {events.filter(e => eventStatus(e) && (e.attendees || []).length).length > 0 && (
                <optgroup label="Events">
                  {events.filter(e => eventStatus(e) && (e.attendees || []).length).map(e => <option key={e.id} value={`ev:${e.id}`}>{e.name} ({e.attendees.length})</option>)}
                </optgroup>
              )}
              {smallGroups.length > 0 && (
                <optgroup label="Small Groups">
                  {smallGroups.map(g => <option key={g.id} value={`sg:${g.id}`}>{g.name}</option>)}
                </optgroup>
              )}
            </select>
            {order === "random" && (
              <button onClick={() => buildDeck()} style={S.reshuffleBtn} title="Reshuffle"><RotateCcw size={14} /></button>
            )}
          </div>

          {deck.length === 0 && !pinnedPerson && !keepPrayingMode ? (
            activePeople.length === 0 ? (
              <div style={S.empty}>
                <BookOpen size={40} color={C.muted} />
                <p style={S.emptyTitle}>No one here yet</p>
                <p style={S.emptySub}>Add people in the People tab or import a CSV.</p>
              </div>
            ) : filter === "all" ? (
              <>
                {todayBdayPrayed.map(({ person }) => (
                  <div key={person.id} style={{ position:"relative", width:"100%", marginBottom:8 }}>
                    <button onClick={() => { dismissBday(person.id); setPinnedPersonId(person.id); setReqFor(null); setReady(true); setPeople(p => [...p]); }} style={S.bdayBanner}>
                      <Cake size={14} style={{marginRight:6, flexShrink:0, verticalAlign:"middle"}} /> Today is {person.name}{"’"}s birthday! Tap to pray.
                    </button>
                    <button onClick={e => { e.stopPropagation(); dismissBday(person.id); setPeople(p => [...p]); }} style={S.bdayDismiss}>{"✕"}</button>
                  </div>
                ))}
                <AllPrayedScreen prayedCount={prayedCount} praySessionCount={praySessionCount} total={activePeople.length} onWeek={() => setView("week")} onKeepPraying={startKeepPraying} />
              </>
            ) : (
              <div style={S.empty}>
                <Heart size={36} fill={C.prayedGreen} color={C.prayedGreen} />
                <p style={S.emptyTitle}>All prayed for!</p>
                <p style={S.emptySub}>Everyone in this group has been prayed for this week.</p>
                <button onClick={() => startKeepPraying(getFiltered())} style={{ background:C.accent, border:"none", color:C.bg, borderRadius:12, padding:"13px 28px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", boxShadow:"0 4px 20px rgba(233,94,36,0.35)", marginTop:8 }}>
                  Keep Praying
                </button>
              </div>
            )
          ) : null}
          {(deck.length > 0 || pinnedPerson || keepPrayingMode) ? (
            <>
              {!ready && !pinnedPerson ? (
                /* ── Tap to Begin splash ── */
                <div
                  style={S.cardOuter}
                  onClick={() => { setReady(true); recordTapShown(); }}
                >
                  <div style={{ ...S.cardGhost, transform: "rotate(2deg) translateY(6px)", opacity: 0.35 }} />
                  <div style={{ ...S.cardGhost, transform: "rotate(-1.5deg) translateY(3px)", opacity: 0.55 }} />
                  <div style={{ ...S.card, ...S.tapCard }}>
                    <svg width="52" height="52" viewBox="0 0 20 20" style={{ marginBottom: 12, flexShrink:0 }}><path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#4cad3b" /></svg>
                    <h2 style={S.tapTitle}>Tap to Begin</h2>
                    <p style={S.tapSub}>{deck.length} {filter === "all" ? "people" : filter.startsWith("sg:") ? `in ${groupName(filter.slice(3)) || "this group"}` : filter.replace("-", " ")} ready</p>
                  </div>
                </div>
              ) : (
                <>
                  {todayBdayPrayed.map(({ person }) => (
                    <div key={person.id} style={{ position:"relative", width:"100%", marginBottom:8 }}>
                      <button onClick={() => { dismissBday(person.id); setPinnedPersonId(person.id); setReqFor(null); setPeople(p => [...p]); }} style={S.bdayBanner}>
                        <Cake size={14} style={{marginRight:6, flexShrink:0, verticalAlign:"middle"}} /> Today is {person.name}{"’"}s birthday! Tap to pray.
                      </button>
                      <button onClick={e => { e.stopPropagation(); dismissBday(person.id); setPeople(p => [...p]); }} style={S.bdayDismiss}>{"✕"}</button>
                    </div>
                  ))}
                  <div style={S.swipeHint}>← swipe to navigate →</div>

                  <div style={S.cardOuter} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                    <div style={{ ...S.cardGhost, transform: "rotate(2deg) translateY(6px)", opacity: 0.35 }} />
                    <div style={{ ...S.cardGhost, transform: "rotate(-1.5deg) translateY(3px)", opacity: 0.55 }} />
                    <div style={{
                      ...S.card,
                      ...(withinWeek(current?.prayedAt) ? S.cardDone : {}),
                      ...(isSwiping ? {
                        transform: `translateX(${swipeDelta}px) rotate(${swipeDelta * 0.04}deg)`,
                        opacity: Math.max(0.4, 1 - Math.abs(swipeDelta) / 300),
                        transition: "none",
                      } : {}),
                      ...(cardAnim === "exiting-left"  ? { animation: "flyOutLeft  0.22s ease-in forwards" } : {}),
                      ...(cardAnim === "exiting-right" ? { animation: "flyOutRight 0.22s ease-in forwards" } : {}),
                      ...(cardAnim === "entering-left" ? { animation: "flyInLeft  0.3s cubic-bezier(.22,.68,0,1.2) forwards" } : {}),
                      ...(cardAnim === "entering-right"? { animation: "flyInRight 0.3s cubic-bezier(.22,.68,0,1.2) forwards" } : {}),
                    }}>
                      {/* Add / change photo (leaders and admins) */}
                      {current && (
                        <button onClick={() => pickPhoto(current.id)} disabled={photoBusy === current.id}
                          title={current.photo ? "Change photo" : "Add photo"} aria-label={current.photo ? "Change photo" : "Add photo"} style={S.cardCamBtn}>
                          {photoBusy === current.id ? <RefreshCw size={14} /> : <Camera size={14} />}
                          {!current.photo && <span style={{ marginLeft:5 }}>Photo</span>}
                        </button>
                      )}

                      {/* Photo */}
                      {photoUrl(current) && (
                        <div style={{ ...S.cardPhotoWrap, transform: `rotate(${photoRotation(current.id) * 0.5}deg)` }}>
                          <img src={photoUrl(current)} alt="" style={S.cardPhoto} draggable={false} onError={e => { e.currentTarget.parentElement.style.display = "none"; }} />
                        </div>
                      )}

                      {/* Badge row */}
                      <div style={S.badgeRow}>
                        <div style={{ ...S.badge, ...(current?.type === "leader" ? S.leaderBadge : S.studentBadge) }}>
                          {current?.type === "leader" ? "Leader" : "Student"}
                        </div>
                        {current?.staff && <div style={{ ...S.badge, ...S.staffBadge }}>Staff</div>}
                        {current?.group && (
                          <div style={{ ...S.badge, ...(current.group === "ms" ? S.msBadge : S.hsBadge) }}>
                            {groupLabel(current.group)}
                          </div>
                        )}
                        {current?.type === "student" && current?.grade && (
                          <div style={{ ...S.badge, ...S.gradeBadgeLg }}>
                            {ordinal(current.grade)} Gr
                          </div>
                        )}
                        {sgIds(current).map(id => groupName(id) && (
                          <div key={id} style={{ ...S.badge, ...S.sgBadge }}>
                            <Users size={11} style={{ marginRight: 5 }} />{groupName(id)}
                          </div>
                        ))}
                      </div>

                      {/* Name — primary */}
                      <h2 style={S.cardName}>{current?.name}</h2>

                      {/* Birthday — secondary info, below name */}
                      {bdayStatus && (
                        <div style={{ ...S.bdayChip, ...(bdayStatus.urgent ? S.bdayChipUrgent : {}), ...(bdayStatus.today && !isBdayDismissed(current?.id) ? { animation: "bdayGlow 1.6s ease-in-out infinite", fontSize: 14, padding: "7px 16px" } : {}) }}>
                          <Cake size={14} style={{ marginRight:6, flexShrink:0, ...(bdayStatus.today ? { animation:"bdaySpin 2s ease-in-out infinite" } : {}) }} />
                          {bdayStatus.label.replace("🎂 ", "")}
                        </div>
                      )}
                      {current?.birthday && !bdayStatus && (
                        <div style={S.bdayQuiet}>
                          <Cake size={12} style={{ marginRight: 6, opacity: 0.5 }} />
                          <span>{formatBirthday(current.birthday)}</span>
                        </div>
                      )}

                      {/* Last prayed — tertiary */}
                      <div style={S.cardPrayedRow}>
                        {withinWeek(current?.prayedAt) ? (
                          <span style={S.prayedChip}>✓ Prayed {timeAgo(current.prayedAt)}</span>
                        ) : current?.prayedAt ? (
                          <span style={S.lastPrayedChip}>Last Prayed For: {timeAgo(current.prayedAt)}</span>
                        ) : (
                          <span style={S.neverChip}>Not yet prayed for</span>
                        )}
                      </div>

                      {(current?.prayerRequests || []).length > 0 && (
                        <div style={S.reqBox}>
                          <p style={S.reqLabel}>Prayer Requests</p>
                          {current.prayerRequests.map((req, i) => (
                            <React.Fragment key={i}>
                              <div style={S.reqItem}>
                                <span style={S.reqDot}>◆</span>
                                <span style={S.reqText}>{req}</span>
                                <button onClick={() => { setAnsweringReq({ personId: current.id, idx: i }); setAnswerUpdate(""); }} style={{ ...S.reqRemove, color:C.accent }} title="Mark answered" aria-label="Mark answered"><Check size={12} strokeWidth={3} /></button>
                                <button onClick={() => removeRequest(current.id, i)} style={S.reqRemove} title="Remove" aria-label="Remove request"><X size={11} /></button>
                              </div>
                              {answeringReq && answeringReq.personId === current.id && answeringReq.idx === i && (
                                <div style={{ ...S.reqInputRow, margin:"0 0 8px 16px" }}>
                                  <input autoFocus value={answerUpdate} onChange={e => setAnswerUpdate(e.target.value)} onKeyDown={e => { if (e.key === "Enter") markAnswered(current.id, i); if (e.key === "Escape") setAnsweringReq(null); }} placeholder="How did God answer? (optional)" style={S.reqInput} />
                                  <button onClick={() => markAnswered(current.id, i)} style={S.reqAddBtn}>🎉 Answered</button>
                                </div>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                      {(current?.answered || []).length > 0 && (
                        <div style={S.answeredBox}>
                          <p style={{ ...S.reqLabel, color:C.accentLight }}>Answered 🎉</p>
                          {current.answered.slice(0, 3).map(a => (
                            <div key={a.id} style={{ fontSize:13, color:C.cream, lineHeight:1.45, marginBottom:6 }}>
                              {a.text && <span style={{ color:C.muted, textDecoration:"line-through", textDecorationColor:"#4cad3b66" }}>{a.text}</span>}
                              {a.text && a.update && <br />}
                              {a.update && <span>{a.update}</span>}
                              <span style={{ display:"block", fontSize:11, color:C.muted, marginTop:2 }}>{timeAgo(a.at)}{a.by === "student" ? " · shared by student" : ""}</span>
                            </div>
                          ))}
                          {current.answered.length > 3 && <div style={{ fontSize:11.5, color:C.muted }}>+ {current.answered.length - 3} more</div>}
                        </div>
                      )}

                      {(current?.familyRequests || []).length > 0 && (
                        <div style={S.familyBox}>
                          <p style={{ ...S.reqLabel, color:"#b49ad0" }}>From their family</p>
                          {current.familyRequests.map(f => (
                            <div key={f.id} style={{ ...S.reqItem, alignItems:"flex-start" }}>
                              <span style={{ ...S.reqDot, color:"#b49ad0" }}>◆</span>
                              <span style={{ flex:1, minWidth:0 }}>
                                <span style={S.reqText}>{f.text}</span>
                                <span style={{ display:"block", fontSize:11.5, color:C.muted, marginTop:3 }}>
                                  {f.from} · {timeAgo(f.at)}
                                  {f.dontMention && <span style={{ color:C.orange, fontWeight:600 }}> · Don’t mention to student</span>}
                                </span>
                              </span>
                              <button onClick={() => setPeople(prev => prev.map(p => p.id === current.id ? { ...p, familyRequests: (p.familyRequests || []).filter(x => x.id !== f.id), updatedAt: Date.now() } : p))} style={S.reqRemove} title="Remove"><X size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}

                      {reqFor === current?.id ? (
                        <div style={S.reqInputRow}>
                          <input autoFocus value={reqText} onChange={e => setReqText(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") addRequest(current.id); if (e.key === "Escape") setReqFor(null); }}
                            placeholder="Enter prayer request…" style={S.reqInput} />
                          <button onClick={() => addRequest(current.id)} style={S.reqAddBtn}>Add</button>
                          <button onClick={() => setReqFor(null)} style={S.reqCancelBtn}><X size={13} /></button>
                        </div>
                      ) : (
                        <button onClick={() => setReqFor(current?.id)} style={S.addReqTrigger}>
                          <Plus size={13} style={{ marginRight: 4 }} /> Add Request
                        </button>
                      )}

                      {/* CAUSE Circle — friends they're praying for to share the Gospel with */}
                      {current && ((current.causeCircle || []).length > 0 || causeFor === current.id) && (
                        <div style={S.causeBox}>
                          <div style={S.causeHead}>
                            <span style={S.causeLabel}>CAUSE Circle</span>
                            {(current.causeCircle || []).length > 0 && (
                              <span style={S.causeCount}>{(current.causeCircle || []).filter(f => f.shared).length} / {(current.causeCircle || []).length} heard the Gospel</span>
                            )}
                          </div>
                          {(current.causeCircle || []).map(f => (
                            <div key={f.id} style={S.causeItem}>
                              <button onClick={() => toggleCauseShared(current.id, f.id)} title={f.shared ? "Gospel shared" : "Mark Gospel shared"}
                                style={{ ...S.causeCheck, ...(f.shared ? S.causeCheckOn : {}) }}>
                                {f.shared && <Check size={11} strokeWidth={3} />}
                              </button>
                              <span style={{ ...S.reqText, ...(f.shared ? { color: C.accentLight } : {}) }}>{f.name}</span>
                              {f.shared && <span style={S.causeShared}>shared</span>}
                              <button onClick={() => removeCauseFriend(current.id, f.id)} style={S.reqRemove} title="Remove"><X size={11} /></button>
                            </div>
                          ))}
                          {causeFor === current.id && (
                            <div style={{ ...S.reqInputRow, marginTop: (current.causeCircle || []).length ? 6 : 0 }}>
                              <input autoFocus value={causeText} onChange={e => setCauseText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") addCauseFriend(current.id); if (e.key === "Escape") { setCauseFor(null); setCauseText(""); } }}
                                placeholder="Friend’s name…" style={S.reqInput} />
                              <button onClick={() => addCauseFriend(current.id)} style={S.reqAddBtn}>Add</button>
                              <button onClick={() => { setCauseFor(null); setCauseText(""); }} style={S.reqCancelBtn}><X size={13} /></button>
                            </div>
                          )}
                        </div>
                      )}
                      {current && (current.gospelLog || []).length > 0 && (() => {
                        const log = current.gospelLog;
                        const total = log.reduce((n, g) => n + (g.count || 0), 0);
                        const latest = log[0];
                        return (
                          <div style={S.gospelBox}>
                            <div style={S.causeHead}>
                              <span style={{ ...S.causeLabel, color: C.orange }}>Gospel conversations</span>
                              <span style={{ fontSize:13, fontWeight:800, color:C.cream }}>{total}</span>
                            </div>
                            <div style={{ fontSize:12.5, color:C.muted, lineHeight:1.45 }}>
                              Latest {timeAgo(latest.at)}{latest.friend ? ` with ${latest.friend}` : ""}{latest.outcome ? ` · ${outcomeLabel(latest.outcome)}` : ""}
                            </div>
                            {latest.story && <p style={{ margin:"6px 0 0", fontSize:13, color:C.cream, lineHeight:1.45 }}>“{latest.story.length > 180 ? latest.story.slice(0, 180) + "…" : latest.story}”</p>}
                          </div>
                        );
                      })()}
                      {current && causeFor !== current.id && (
                        <button onClick={() => { setCauseFor(current.id); setCauseText(""); setReqFor(null); }} style={S.addReqTrigger}>
                          <Plus size={13} style={{ marginRight: 4 }} /> {(current.causeCircle || []).length ? "Add to CAUSE Circle" : "CAUSE Circle friend"}
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={S.navRow}>
                    <button onClick={() => navWithAnim(-1)} style={S.navArrow}><ChevronLeft size={22} /></button>
                    <span style={S.counter}>
                      {pinnedPerson ? "★" : `${cardIdx + 1}`}
                      <span style={{ color: C.muted }}> / </span>
                      {deck.length}
                    </span>
                    <button onClick={() => navWithAnim(1)} style={S.navArrow}><ChevronRight size={22} /></button>
                  </div>

                  {withinWeek(current?.prayedAt) && !pinnedPerson && !keepPrayingMode ? (
                    <div style={S.prayedActions}>
                      <div style={S.prayedConfirm}><Heart size={16} fill={C.prayedGreen} color={C.prayedGreen} style={{ marginRight: 7 }} /> Prayed!</div>
                      {!pinnedPerson && <button onClick={unmarkPrayed} style={S.undoBtn}>Undo</button>}
                      {pinnedPerson && <button onClick={() => setPinnedPersonId(null)} style={S.undoBtn}>Back</button>}
                    </div>
                  ) : (
                    <button onClick={markPrayed} style={S.prayBtn}>
                      <Heart size={16} style={{ marginRight: 8 }} /> {(pinnedPerson || keepPrayingMode) && withinWeek(current?.prayedAt) ? "Pray Again" : "Mark as Prayed"}
                    </button>
                  )}

                  {/* Quick-find dropdown */}
                  {(() => {
                    const dropList = getFiltered().slice().sort((a, b) => a.name.localeCompare(b.name));
                    return (
                      <div style={S.ddWrap}>
                        <button onClick={() => setDropdownOpen(o => !o)} style={S.ddToggle}>
                          <span>Select a specific name</span>
                          <span style={{ fontSize: 10, opacity: 0.5 }}>{dropdownOpen ? "▲" : "▼"}</span>
                        </button>
                        {dropdownOpen && (
                          <div style={S.ddList}>
                            {dropList.map(p => (
                              <button key={p.id} onClick={() => selectFromDropdown(p.id)}
                                style={{ ...S.ddItem, ...(withinWeek(p.prayedAt) ? S.ddItemPrayed : {}) }}>
                                <span>{p.name}</span>
                                <span style={S.ddItemMeta}>
                                  {withinWeek(p.prayedAt) ? "✓ prayed" : ""}
                                  {p.group ? ` ${groupLabel(p.group)}` : ""}
                                  {sgIds(p).map(groupName).filter(Boolean).length ? ` · ${sgIds(p).map(groupName).filter(Boolean).join(", ")}` : ""}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ─── WALL ─── */}
      {view === "wall" && (
        <LeaderWall key={wallTab} initialTab={wallTab} studentPosts={studentWall} onStudentPrayed={prayStudentPost} people={people} setPeople={setPeople} goToPerson={goToPerson} isAdmin={adminAuthed} />
      )}

      {/* ─── WEEK SUMMARY ─── */}
      {view === "calendar" && (
        <div style={S.importWrap}>
          <CalendarList cal={calendar} title="Calendar" maxWidth="none" emptyText="Nothing coming up on the BAND calendar." />
          <p style={{ fontSize:12, color:C.muted, lineHeight:1.5, margin:"0 2px" }}>Events come from BAND and update about every 30 minutes. Tap an event for details.</p>
        </div>
      )}

      {view === "week" && (
        <div style={S.weekWrap}>
          <h2 style={S.weekTitle}>This Week</h2>

          <GoalsCard goals={goals} activePeople={activePeople} weekHistory={weekHistory} smallGroups={smallGroups} myGroupId={myGroupId} />
          <ReminderCard />

          {upcomingBdays.length > 0 && (
            <div style={S.weekSection}>
              <div style={S.sectionHead}>
                <Cake size={13} color={C.accent} style={{ marginRight: 7 }} />
                <span style={S.sectionTitle}>Upcoming Birthdays</span>
              </div>
              {upcomingBdays.map(({ person, diff, date }) => (
                <div key={person.id} onClick={() => goToPerson(person.id)} style={{ ...S.weekRow, ...(diff === 0 ? { background: C.faint } : {}), cursor: "pointer" }}>
                  <div>
                    <div style={S.weekName}>{person.name}</div>
                    <div style={{ ...S.weekMeta, display:"flex", alignItems:"center", gap:4 }}>{diff === 0 && <Cake size={11} color={C.accent} />}{diff === 0 ? "Today!" : diff === 1 ? "Tomorrow" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {person.group && <span style={{ ...S.badgeSm, ...(person.group === "ms" ? S.msBadgeSm : S.hsBadgeSm) }}>{groupLabel(person.group)}</span>}
                    <span style={{ ...S.badgeSm, ...(person.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{person.type}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={S.weekSection}>
            <div style={S.sectionHead}>
              <Heart size={13} fill={C.prayedGreen} color={C.prayedGreen} style={{ marginRight: 7 }} />
              <span style={S.sectionTitle}>Prayed For — {prayedThis.length}</span>
            </div>
            {prayedThis.length === 0
              ? <p style={S.weekEmpty}>No one marked yet this week.</p>
              : prayedThis.map(p => (
                <div key={p.id} onClick={() => goToPerson(p.id)} style={{ ...S.weekRow, cursor: "pointer" }}>
                  <div>
                    <div style={{ ...S.weekName, display:"flex", alignItems:"center", gap:6 }}>{p.name}{(p.weekPrayCount || 0) >= 2 ? <span style={{ fontSize:11, color:C.accent, fontWeight:700, background:C.faint, padding:"1px 6px", borderRadius:8 }}>x{p.weekPrayCount}</span> : null}</div>
                    <div style={S.weekMeta}>{timeAgo(p.prayedAt)}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {(p.prayerRequests || []).length > 0 && <span style={S.reqCountBadge}>{p.prayerRequests.length} req</span>}
                    <span style={{ color: C.prayedGreen, fontSize: 18 }}>✓</span>
                  </div>
                </div>
              ))
            }
          </div>

          <div style={S.weekSection}>
            <div style={S.sectionHead}>
              <div style={{ width: 13, height: 13, borderRadius: "50%", border: `1.5px solid ${C.muted}`, marginRight: 7, flexShrink: 0 }} />
              <span style={S.sectionTitle}>Still Waiting — {notPrayedThis.length}</span>
            </div>
            {notPrayedThis.length === 0 ? (
              <div style={S.allPrayedBanner}>
                <Heart size={22} fill={C.accent} color={C.accent} />
                <span style={S.allPrayedText}>Everyone prayed for this week!</span>
              </div>
            ) : notPrayedThis.map(p => (
              <div key={p.id} onClick={() => goToPerson(p.id)} style={{ ...S.weekRow, cursor: "pointer" }}>
                <div>
                  <div style={{ ...S.weekName, color: C.muted }}>{p.name}</div>
                  {p.prayedAt && <div style={S.weekMeta}>Last: {timeAgo(p.prayedAt)}</div>}
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {p.staff && <span style={{ ...S.badgeSm, ...S.staffBadgeSm }}>staff</span>}{p.group && <span style={{ ...S.badgeSm, ...(p.group === "ms" ? S.msBadgeSm : S.hsBadgeSm) }}>{groupLabel(p.group)}</span>}
                  <span style={{ ...S.badgeSm, ...(p.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{p.type}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── PEOPLE ─── */}
      {view === "people" && (
        <div style={S.peopleWrap}>
          {!settings.teamCodeSet && (
            <div style={{ background:"#2a1a12", border:`1px solid ${C.orange}`, borderRadius:12, padding:"12px 14px", fontSize:13, color:C.cream, lineHeight:1.5, marginBottom:4 }}>
              <b>One more step:</b> set a team code at the bottom of this page so your leaders can sign in.
            </div>
          )}
          {/* ── Add person form ── */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", display:"flex", flexDirection:"column", gap:8, marginBottom:4 }}>
            <p style={{ margin:0, fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>Add Person</p>
            <input value={addName} onChange={e => setAddName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()} placeholder="Full name" style={{ ...S.addInput, margin:0 }} />
            <div style={{ display:"flex", gap:8 }}>
              <select value={addType} onChange={e => { setAddType(e.target.value); }} style={{ ...S.addTypeSelect, flex:1 }}>
                <option value="student">Student</option>
                <option value="leader">Leader</option>
              </select>
              <select value={addGroup} onChange={e => setAddGroup(e.target.value)} style={{ ...S.addTypeSelect, flex:1 }}>
                <option value="hs">HS</option>
                <option value="ms">MS</option>
              </select>
              {addType === "student" && (
                <select value={addGrade} onChange={e => { const g = e.target.value; setAddGrade(g); if (g) setAddGroup(Number(g) >= 9 ? "hs" : "ms"); }} style={{ ...S.addTypeSelect, flex:1 }}>
                  <option value="">Grade</option>
                  {[5,6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              )}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <input value={addBday} onChange={e => setAddBday(e.target.value)} placeholder="Birthday MM-DD (optional)" style={{ ...S.addInput, flex:1, margin:0, fontSize:13 }} />
              <button onClick={addPerson} style={{ ...S.addPersonBtn, width:44, height:44 }}><Plus size={18} /></button>
            </div>
          </div>

          {/* ── Small groups ── */}
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px", display:"flex", flexDirection:"column", gap:8, marginBottom:4 }}>
            <p style={{ margin:0, fontSize:11, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600, display:"flex", alignItems:"center", gap:6 }}><Users size={12} /> Small Groups</p>
            {smallGroups.length === 0 && (
              <p style={{ margin:0, fontSize:12, color:C.muted, lineHeight:1.5 }}>Create your small groups, then assign each student and leader below. Groups show up in the Pray and Roster filters.</p>
            )}
            {smallGroups.map(g => {
              const members = activePeople.filter(p => inSG(p, g.id));
              return (
                <div key={g.id} style={S.sgRow}>
                  {editGroupFor === g.id ? (
                    <>
                      <input autoFocus value={groupNameInput} onChange={e => setGroupNameInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") renameSmallGroup(g.id); if (e.key === "Escape") setEditGroupFor(null); }}
                        style={{ ...S.reqInput, padding:"6px 10px" }} />
                      <button onClick={() => renameSmallGroup(g.id)} style={S.reqAddBtn}>Save</button>
                      <button onClick={() => setEditGroupFor(null)} style={S.reqCancelBtn}><X size={12} /></button>
                    </>
                  ) : confirmDeleteGroup === g.id ? (
                    <>
                      <span style={{ flex:1, fontSize:12, color:C.muted }}>Delete “{g.name}”? People stay, just unassigned.</span>
                      <button onClick={() => deleteSmallGroup(g.id)} style={{ ...S.reqAddBtn, background:"#8a5050", color:"#fff" }}>Delete</button>
                      <button onClick={() => setConfirmDeleteGroup(null)} style={S.reqCancelBtn}><X size={12} /></button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex:1, fontSize:14, color:C.cream }}>{g.name}</span>
                      <span style={{ fontSize:12, color:C.muted }}>{members.length} {members.length === 1 ? "person" : "people"}</span>
                      <button onClick={() => { setEditGroupFor(g.id); setGroupNameInput(g.name); setConfirmDeleteGroup(null); }} style={S.editNameBtn} title="Rename">✎</button>
                      <button onClick={() => { setConfirmDeleteGroup(g.id); setEditGroupFor(null); }} style={{ ...S.iconBtn, width:26, height:26 }} title="Delete group"><Trash2 size={12} /></button>
                    </>
                  )}
                </div>
              );
            })}
            <div style={{ display:"flex", gap:8 }}>
              <input value={newGroupName} onChange={e => setNewGroupName(e.target.value)} onKeyDown={e => e.key === "Enter" && addSmallGroup()} placeholder="New group, e.g. 9th Grade Guys" style={{ ...S.addInput, margin:0, fontSize:13 }} />
              <button onClick={addSmallGroup} style={{ ...S.addPersonBtn, width:44, height:44 }} title="Add small group"><Plus size={18} /></button>
            </div>
          </div>

          <div style={S.statRow}>
            {[[`${activePeople.length}`, "total"], [`${activePeople.filter(inHS).length}`, "HS"], [`${activePeople.filter(inMS).length}`, "MS"], [`${prayedCount}`, "prayed ✓"]].map(([n, l]) => (
              <div key={l} style={S.statChip}><span style={S.statNum}>{n}</span><span style={S.statLbl}>{l}</span></div>
            ))}
          </div>

          {/* Type filter */}
          <div style={{ display:"flex", gap:16, justifyContent:"center", marginBottom:6 }}>
            {[["all","All"],["student","Students"],["leader","Leaders"],["staff","Staff"]].map(([val, label]) => (
              <button key={val} onClick={() => setPeopleTypeFilter(val)} style={{ background:"none", border:"none", borderBottom: peopleTypeFilter === val ? `2px solid ${C.accent}` : "2px solid transparent", color: peopleTypeFilter === val ? C.cream : C.muted, fontSize:13, fontWeight: peopleTypeFilter === val ? 500 : 400, padding:"2px 0", cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                {label}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…" style={{ ...S.addInput, marginBottom: 4 }} />
          {smallGroups.length > 0 && (
            <select value={peopleGroupFilter} onChange={e => setPeopleGroupFilter(e.target.value)} style={{ ...S.addTypeSelect, marginBottom: 4 }}>
              <option value="all">All small groups</option>
              {smallGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="none">Not in a small group</option>
            </select>
          )}
          {photoError && <p style={{ margin:"0 0 4px", fontSize:12, color:"#c07070", textAlign:"center" }}>Photo: {photoError}</p>}
          <div style={{ display:"flex", gap:16, marginBottom:10, justifyContent:"center" }}>
            {[["name","A–Z"],["group","MS/HS"],["grade","Grade"],["birthday","Birthday"]].map(([val, label]) => (
              <button key={val} onClick={() => setPeopleSort(val)} style={{ background:"none", border:"none", borderBottom: peopleSort === val ? `2px solid ${C.accent}` : "2px solid transparent", color: peopleSort === val ? C.cream : C.muted, fontSize:13, fontWeight: peopleSort === val ? 500 : 400, padding:"2px 0", cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", transition:"color 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          <div style={S.personList}>
            {activePeople.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && (peopleTypeFilter === "all" || (peopleTypeFilter === "staff" ? !!p.staff : p.type === peopleTypeFilter)) && (peopleGroupFilter === "all" || (peopleGroupFilter === "none" ? !sgIds(p).some(groupName) : inSG(p, peopleGroupFilter)))).slice().sort((a, b) => {
              if (peopleSort === "group") {
                const ga = a.group === "ms" ? 0 : a.group === "both" ? 1 : a.group === "hs" ? 2 : 3;
                const gb = b.group === "ms" ? 0 : b.group === "both" ? 1 : b.group === "hs" ? 2 : 3;
                return ga !== gb ? ga - gb : a.name.localeCompare(b.name);
              }
              if (peopleSort === "grade") {
                if (a.type === "leader" && b.type !== "leader") return 1;
                if (a.type !== "leader" && b.type === "leader") return -1;
                const ga = Number(a.grade) || 99;
                const gb = Number(b.grade) || 99;
                return ga !== gb ? ga - gb : a.name.localeCompare(b.name);
              }
              if (peopleSort === "birthday") {
                const ma = a.birthday ? parseInt(a.birthday.split("-")[0] || "99") : 99;
                const da = a.birthday ? parseInt(a.birthday.split("-")[1] || "99") : 99;
                const mb = b.birthday ? parseInt(b.birthday.split("-")[0] || "99") : 99;
                const db = b.birthday ? parseInt(b.birthday.split("-")[1] || "99") : 99;
                return ma !== mb ? ma - mb : da !== db ? da - db : a.name.localeCompare(b.name);
              }
              return a.name.localeCompare(b.name);
            }).map(p => (
              <div key={p.id} style={S.personCard}>
                <div style={S.personRow}>
                  <button onClick={() => pickPhoto(p.id)} style={S.avatarBtn} title={p.photo ? "Change photo" : "Add photo"} disabled={photoBusy === p.id}>
                    <Avatar person={p} size={40} />
                    <span style={S.avatarCam}>{photoBusy === p.id ? <RefreshCw size={9} /> : <Camera size={9} />}</span>
                  </button>
                  <div style={S.personLeft}>
                    {editNameFor === p.id ? (
                      <div style={S.nameEditRow}>
                        <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveName(p.id); if (e.key === "Escape") setEditNameFor(null); }}
                          style={S.nameInput} />
                        <button onClick={() => saveName(p.id)} style={S.reqAddBtn}>Save</button>
                        <button onClick={() => setEditNameFor(null)} style={S.reqCancelBtn}><X size={12} /></button>
                      </div>
                    ) : (
                      <div style={S.nameRow}>

                        <span style={S.personName}>{p.name}</span>
                        <button onClick={() => { setEditNameFor(p.id); setNameInput(p.name); setEditBdayFor(null); }}
                          style={S.editNameBtn} title="Edit name">✎</button>
                      </div>
                    )}
                    <div style={S.personMeta}>
                      <span style={{ ...S.badgeSm, ...(p.type === "leader" ? S.leaderBadgeSm : S.studentBadgeSm) }}>{p.type}</span>
                      {p.staff && <span style={{ ...S.badgeSm, ...S.staffBadgeSm }}>staff</span>}{p.group && <span style={{ ...S.badgeSm, ...(p.group === "ms" ? S.msBadgeSm : S.hsBadgeSm) }}>{groupLabel(p.group)}</span>}
                      {p.type === "student" && p.grade && <span style={S.gradeBadge}>{ordinal(p.grade)} Gr</span>}
                      {withinWeek(p.prayedAt) && <span style={S.prayedSmall}>✓ prayed</span>}
                      {(p.prayerRequests || []).length > 0 && <span style={S.reqCountBadge}>{p.prayerRequests.length} req</span>}
                      {p.birthday && <span style={S.bdayBadgeSm}><Cake size={9} style={{ marginRight: 3 }} />{formatBirthday(p.birthday)}</span>}
                      {(p.causeCircle || []).length > 0 && <span style={S.reqCountBadge}>{p.causeCircle.length} CAUSE</span>}
                      {(p.familyRequests || []).length > 0 && <span style={{ ...S.reqCountBadge, color: "#b49ad0" }}>{p.familyRequests.length} family</span>}
                      {(p.gospelLog || []).length > 0 && <span style={{ ...S.reqCountBadge, color: C.orange }}>{p.gospelLog.reduce((n, g) => n + (g.count || 0), 0)} Gospel</span>}
                    </div>
                  </div>
                  <div style={S.personActions}>
                    <button onClick={() => { setEditBdayFor(editBdayFor === p.id ? null : p.id); setBdayInput(p.birthday || ""); setEditNameFor(null); }}
                      style={{ ...S.iconBtn, color: p.birthday ? C.accent : C.muted }} title="Set birthday"><Cake size={13} /></button>
                    <button onClick={() => cycleGroup(p.id)} style={{ ...S.iconBtn, width: p.group === "both" ? 44 : 30, color: p.group === "hs" ? "#8ea3e3" : p.group === "ms" ? "#74c464" : p.group === "both" ? C.cream : C.muted }} title={p.type === "leader" ? "Cycle HS / MS / MS & HS / none" : "Cycle HS / MS / none"}>
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>{p.group === "both" ? "MS+HS" : p.group ? p.group.toUpperCase() : "—"}</span>
                    </button>
                    <button onClick={() => toggleType(p.id)} style={S.iconBtn} title="Toggle role"><RefreshCw size={13} /></button>
                    <button onClick={() => deactivate(p.id)} style={{ ...S.iconBtn, color: C.muted }} title="Make inactive"><Trash2 size={13} /></button>
                  </div>
                </div>
                {editBdayFor === p.id && (
                  <div style={S.bdayEditRow}>
                    <Cake size={13} style={{ color: C.accent, flexShrink: 0 }} />
                    <input autoFocus value={bdayInput} onChange={e => setBdayInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveBirthday(p.id, parseBirthdayStr(bdayInput)); if (e.key === "Escape") setEditBdayFor(null); }}
                      placeholder="MM-DD  e.g. 03-15" style={S.bdayInput} />
                    <button onClick={() => saveBirthday(p.id, parseBirthdayStr(bdayInput))} style={S.reqAddBtn}>Save</button>
                    {p.birthday && <button onClick={() => saveBirthday(p.id, "")} style={S.reqCancelBtn} title="Clear"><X size={12} /></button>}
                  </div>
                )}
                {p.type === "student" && (
                  <div style={S.gradeRow}>
                    <span style={S.gradeLabel}>Grade</span>
                    <select value={p.grade || ""} onChange={e => setPeople(prev => prev.map(q => q.id === p.id ? { ...q, grade: e.target.value ? Number(e.target.value) : null, updatedAt: Date.now() } : q))}
                      style={S.gradeSelect}>
                      <option value="">—</option>
                      {[5,6,7,8,9,10,11,12].map(g => <option key={g} value={g}>{`Grade ${g}`}</option>)}
                    </select>
                  </div>
                )}
                {p.type === "leader" && (
                  <div style={S.gradeRow}>
                    <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5, color:C.cream, cursor:"pointer" }}>
                      <input type="checkbox" checked={!!p.staff} onChange={() => toggleStaff(p.id)} style={{ accentColor:C.accent, width:15, height:15 }} />
                      Staff member
                    </label>
                    <span style={{ fontSize:11.5, color:C.muted }}>Shows a Staff badge</span>
                  </div>
                )}
                {(smallGroups.length > 0 || p.photo) && (
                  <div style={{ ...S.gradeRow, alignItems:"flex-start" }}>
                    {smallGroups.length > 0 && (
                      <div style={{ display:"flex", flexDirection:"column", gap:6, flex:1, minWidth:0 }}>
                        <span style={S.gradeLabel}>Small groups</span>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                          {smallGroups.map(g => {
                            const on = inSG(p, g.id);
                            return (
                              <button key={g.id} onClick={() => assignSmallGroup(p.id, g.id)} aria-pressed={on}
                                style={{ padding:"4px 9px", borderRadius:14, fontSize:12, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", border:`1px solid ${on ? "#b49ad0" : C.border}`, background: on ? "#2a2433" : "none", color: on ? "#d6c4ea" : C.muted }}>
                                {on ? "✓ " : ""}{g.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {p.photo && (
                      <button onClick={() => removePhoto(p.id)} style={{ background:"none", border:"none", color:C.muted, fontSize:11, cursor:"pointer", marginLeft:"auto", fontFamily:"'Inter', system-ui, sans-serif", flexShrink:0 }}>Remove photo</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* End-of-year grade promotion */}
          <div style={S.promoteSection}>
            {!confirmPromo ? (
              <button onClick={() => setConfirmPromo(true)} style={S.promoteBtn}>
                🎓 End of Year — Promote All Grades
              </button>
            ) : (
              <div style={S.promoteConfirm}>
                <p style={S.promoteConfirmText}>Move every student up one grade? 12th graders will be made inactive.</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={promoteGrades} style={S.confirmBtn}>Yes, Promote</button>
                  <button onClick={() => setConfirmPromo(false)} style={S.cancelBtn}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {people.filter(p => p.active === false).length > 0 && (
            <div style={S.inactiveSection}>
              <p style={S.inactiveHeading}>Inactive</p>
              {people.filter(p => p.active === false).map(p => (
                <div key={p.id} style={S.inactiveRow}>
                  <span style={S.inactiveName}>{p.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => restore(p.id)} style={S.restoreBtn}>Restore</button>
                    <button onClick={() => deletePerm(p.id)} style={S.deleteBtn}>Delete</button>
                  </div>
                </div>
              ))}
            <div style={{ display:"flex", justifyContent:"flex-end", marginTop:8 }}>
              {!confirmClearInactive ? (
                <button onClick={() => setConfirmClearInactive(true)} style={{ background:"none", border:"none", color:"#8a5050", fontSize:12, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                  Clear all inactive…
                </button>
              ) : (
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:12, color:C.muted }}>Remove all inactive?</span>
                  <button onClick={clearAllInactive} style={{ background:"#8a5050", border:"none", color:"#fff", borderRadius:6, padding:"5px 12px", fontSize:12, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>Yes, clear</button>
                  <button onClick={() => setConfirmClearInactive(false)} style={S.cancelBtn}>Cancel</button>
                </div>
              )}
            </div>
            </div>
          )}

          <SettingsCard settings={settings} onStatus={onStatus} />
        </div>
      )}


      {/* ─── ROSTER ─── */}
      {view === "roster" && (
        <div style={S.importWrap}>
          {/* Group filter */}
          <div style={{ display:"flex", gap:0, marginBottom:12, borderRadius:10, overflow:"hidden", border:`1px solid ${C.border}` }}>
            {[["all","All"],["ms","MS"],["hs","HS"],["leader","Leaders"],...(people.some(p => p.staff && p.active !== false) ? [["staff","Staff"]] : [])].map(([val, label]) => (
              <button key={val} onClick={() => setRosterGroup(val)} style={{ flex:1, background: rosterGroup === val ? C.accent : C.surface, border:"none", color: rosterGroup === val ? "#101112" : C.muted, padding:"9px 0", fontSize:13, fontWeight: rosterGroup === val ? 600 : 400, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", transition:"background 0.15s" }}>
                {label}
              </button>
            ))}
          </div>

          {smallGroups.length > 0 && (
            <select value={rosterSmallGroup} onChange={e => setRosterSmallGroup(e.target.value)} style={{ ...S.addTypeSelect, width:"100%", marginBottom:12 }}>
              <option value="all">All small groups</option>
              {smallGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}

          {/* Sort filter */}
          <div style={{ display:"flex", gap:16, marginBottom:12, justifyContent:"center" }}>
            {[["name","A–Z"],["grade","Grade"],["birthday","Birthday"]].map(([val, label]) => (
              <button key={val} onClick={() => setRosterSort(val)} style={{ background:"none", border:"none", borderBottom: rosterSort === val ? `2px solid ${C.accent}` : "2px solid transparent", color: rosterSort === val ? C.cream : C.muted, fontSize:13, fontWeight: rosterSort === val ? 500 : 400, padding:"2px 0", cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                {label}
              </button>
            ))}
          </div>

          {/* People list */}
          <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
            {activePeople
              .filter(p => (rosterGroup === "all" ? true : rosterGroup === "leader" ? p.type === "leader" : rosterGroup === "staff" ? !!p.staff : p.type === "student" && (rosterGroup === "hs" ? inHS(p) : inMS(p))) && (rosterSmallGroup === "all" || inSG(p, rosterSmallGroup)))
              .slice().sort((a, b) => {
                if (rosterSort === "grade") {
                  const ga = Number(a.grade) || 99;
                  const gb = Number(b.grade) || 99;
                  return ga !== gb ? ga - gb : a.name.localeCompare(b.name);
                }
                if (rosterSort === "birthday") {
                  // Sort by days until next birthday (soonest first, just-passed at end)
                  const daysUntil = (bday) => {
                    if (!bday) return 9999;
                    const [m, d] = bday.split("-").map(Number);
                    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
                    const thisYear = new Date(now.getFullYear(), m - 1, d);
                    let diff = Math.ceil((thisYear - now) / 86400000);
                    if (diff < 0) diff += 365; // already passed this year — push to end
                    return diff;
                  };
                  const da = daysUntil(a.birthday);
                  const db = daysUntil(b.birthday);
                  return da !== db ? da - db : a.name.localeCompare(b.name);
                }
                return a.name.localeCompare(b.name);
              })
              .map(p => {
                const bdayFmt = p.birthday ? (() => { const [m, d] = p.birthday.split("-"); const date = new Date(2000, parseInt(m)-1, parseInt(d)); return date.toLocaleDateString("en-US", { month:"short", day:"numeric" }); })() : null;
                return (
                  <div key={p.id} style={{ display:"flex", alignItems:"center", padding:"11px 14px", background:C.surface, borderRadius:8, gap:12 }}>
                    {/* Photo — tap to add or change */}
                    <button onClick={() => pickPhoto(p.id)} style={S.avatarBtn} title={p.photo ? "Change photo" : "Add photo"} aria-label={p.photo ? `Change photo for ${p.name}` : `Add photo for ${p.name}`} disabled={photoBusy === p.id}>
                      <Avatar person={p} size={44} />
                      <span style={S.avatarCam}>{photoBusy === p.id ? <RefreshCw size={9} /> : <Camera size={9} />}</span>
                    </button>
                    {/* Text — left aligned below name */}
                    <div style={{ display:"flex", flexDirection:"column", gap:3, flex:1, minWidth:0 }}>
                      <span style={{ fontSize:15, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif" }}>{p.name}</span>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        {p.type === "student" && p.grade && (
                          <span style={{ fontSize:13, color:C.muted, fontWeight:600 }}>{ordinal(p.grade)} Grade</span>
                        )}
                        {p.type === "leader" && p.group && (
                          <span style={{ fontSize:13, color:C.muted, fontWeight:600 }}>{groupLabel(p.group)}</span>
                        )}
                        {bdayFmt && <span style={{ fontSize:13, color:C.muted, display:"flex", alignItems:"center", gap:3 }}><Cake size={12} />{bdayFmt}</span>}
                        {p.staff && <span style={{ fontSize:12, color:"#e6b34a", fontWeight:600 }}>Staff</span>}
                        {sgIds(p).map(groupName).filter(Boolean).length > 0 && <span style={{ fontSize:13, color:C.muted, display:"flex", alignItems:"center", gap:3 }}><Users size={12} />{sgIds(p).map(groupName).filter(Boolean).join(", ")}</span>}
                      </div>
                    </div>
                    {/* Group badge */}
                    {p.group && <span style={{ fontSize:10, fontWeight:600, color: p.group === "ms" ? C.accent : "#8ea3e3", background: p.group === "ms" ? C.accentBg : C.studentBg, borderRadius:6, padding:"2px 7px", flexShrink:0, whiteSpace:"nowrap" }}>{groupLabel(p.group)}</span>}
                  </div>
                );
              })
            }
            {activePeople.filter(p => (rosterGroup === "all" ? true : rosterGroup === "leader" ? p.type === "leader" : rosterGroup === "staff" ? !!p.staff : p.type === "student" && (rosterGroup === "hs" ? inHS(p) : inMS(p))) && (rosterSmallGroup === "all" || inSG(p, rosterSmallGroup))).length === 0 && (
              <p style={{ textAlign:"center", color:C.muted, fontSize:13, padding:"32px 0" }}>No one in this group yet.</p>
            )}
          </div>
        </div>
      )}


      {/* ─── SERIES ─── */}
      {view === "series" && adminAuthed && (
        <>
          <div style={{ display:"flex", gap:4, margin:"14px 20px 0", background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:4 }}>
            {[["series", "Series"], ["note", "Leader note"], ["events", "Events"], ["calendar", "Calendar"]].map(([v, l]) => (
              <button key={v} onClick={() => setSeriesPane(v)} style={{ flex:1, padding:"8px 0", borderRadius:9, border:"none", background: seriesPane === v ? C.accent : "none", color: seriesPane === v ? "#101112" : C.muted, fontWeight: seriesPane === v ? 700 : 500, fontSize:13, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>{l}</button>
            ))}
          </div>
          {seriesPane === "series" ? <SeriesEditor /> : seriesPane === "note" ? <DevotionalEditor /> : seriesPane === "calendar" ? <CalendarSetup /> : <EventsEditor people={people} smallGroups={smallGroups} />}
        </>
      )}

      {/* ─── INBOX ─── */}
      {view === "inbox" && adminAuthed && (
        <InboxView items={submissions} people={people} setPeople={setPeople} onRemove={removeSubmissions} studentCodeSet={!!settings.studentCodeSet} parentCodeSet={!!settings.parentCodeSet} />
      )}

      {/* ─── REPORT ─── */}
      {view === "report" && (
        <div style={S.importWrap}>
          <MonthlyRecap people={people} weekHistory={weekHistory} ministryName={MINISTRY_NAME} />
          <div style={S.reportBox}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}><BarChart2 size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>Weekly Prayer Report</p></div>
              <div style={{ display:"flex", gap:12 }}>
                <button onClick={recalculateHistory} style={{ background:"none", border:"none", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                  recalculate
                </button>
                {weekHistory.length > 0 && (
                  <button onClick={async () => { setWeekHistory([]); await apiSaveHistory([]); }} style={{ background:"none", border:"none", color:C.muted, fontSize:11, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" }}>
                    clear
                  </button>
                )}
              </div>
            </div>
            {weekHistory.length === 0 ? (
              <p style={S.reportEmpty}>Data will appear here after the first Monday reset.</p>
            ) : weekHistory.map((w, i) => {
              const pct = w.total > 0 ? Math.round((w.count / w.total) * 100) : 0;
              const weekEndTs = w.weekStart - 1;
              const label = i === 0
                ? `${getWeekLabel(w.prevWeekStart)} – ${getWeekLabel(weekEndTs)} (last week)`
                : `${getWeekLabel(w.prevWeekStart)} – ${getWeekLabel(weekEndTs)}`;
              return (
                <div key={w.weekStart} style={S.reportRow}>
                  <div style={S.reportRowTop}>
                    <span style={S.reportWeekLabel}>{label}</span>
                    <span style={S.reportCount}>{w.count} / {w.total}</span>
                  </div>
                  <div style={S.reportBar}>
                    <div style={{ ...S.reportBarFill, width: `${pct}%` }} />
                  </div>
                  <span style={S.reportPct}>{pct}% prayed for</span>
                </div>
              );
            })}
          </div>

          {smallGroups.length > 0 && (
            <div style={{ ...S.reportBox, marginTop:14 }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}><Users size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>This Week by Small Group</p></div>
              {[...smallGroups.map(g => ({ key:g.id, name:g.name, list: activePeople.filter(p => inSG(p, g.id)) })),
                { key:"none", name:"Not in a small group", list: activePeople.filter(p => !sgIds(p).some(groupName)) }]
                .filter(row => row.key !== "none" || row.list.length > 0)
                .map(row => {
                  const done = row.list.filter(p => withinWeek(p.prayedAt)).length;
                  const pct = row.list.length ? Math.round((done / row.list.length) * 100) : 0;
                  return (
                    <div key={row.key} style={S.reportRow}>
                      <div style={S.reportRowTop}>
                        <span style={S.reportWeekLabel}>{row.name}</span>
                        <span style={S.reportCount}>{done} / {row.list.length}</span>
                      </div>
                      <div style={S.reportBar}><div style={{ ...S.reportBarFill, width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
            </div>
          )}

          <GoalsEditor goals={goals} onSave={saveGoals} />

          {(() => {
            const stories = activePeople.flatMap(p => (p.gospelLog || []).map(g => ({ ...g, who: p.name }))).sort((a, b) => b.at - a.at);
            const gt = gospelTotals(activePeople);
            return (
              <div style={{ ...S.reportBox, marginTop:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}><BookOpen size={16} color={C.orange} /><p style={{ ...S.reportTitle, margin:0, color:C.orange }}>Gospel Conversations</p></div>
                {stories.length === 0 ? (
                  <p style={S.reportEmpty}>When students log Gospel conversations on the student page and you approve them, their stories collect here.</p>
                ) : (
                  <>
                    <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                      {[[gt.month, "this month"], [gt.all, "all time"], [gt.trusted, "trusted Jesus"]].map(([n, l]) => (
                        <div key={l} style={{ ...S.statChip, flex:1 }}><span style={S.statNum}>{n}</span><span style={S.statLbl}>{l}</span></div>
                      ))}
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                      {stories.slice(0, 25).map(g => (
                        <div key={g.id} style={{ borderTop:`1px solid ${C.faint}`, paddingTop:10 }}>
                          <div style={{ fontSize:13, color:C.cream }}>
                            <b>{g.who}</b> · {g.count} conversation{g.count === 1 ? "" : "s"}{g.friend ? ` with ${g.friend}` : ""}
                            <span style={{ color:C.muted }}> · {timeAgo(g.at)}</span>
                          </div>
                          {g.outcome && <div style={{ fontSize:12, color: g.outcome === "trusted" ? C.orange : C.accentLight, marginTop:2 }}>{outcomeLabel(g.outcome)}</div>}
                          {g.story && <p style={{ margin:"4px 0 0", fontSize:13, color:C.muted, lineHeight:1.45 }}>{g.story}</p>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          {(() => {
            const circles = activePeople.filter(p => (p.causeCircle || []).length > 0);
            const friends = circles.reduce((n, p) => n + p.causeCircle.length, 0);
            const shared = circles.reduce((n, p) => n + p.causeCircle.filter(f => f.shared).length, 0);
            return (
              <div style={{ ...S.reportBox, marginTop:14 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}><Heart size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>CAUSE Circles</p></div>
                {friends === 0 ? (
                  <p style={S.reportEmpty}>No CAUSE Circle friends yet. Add them from a student’s prayer card.</p>
                ) : (
                  <div style={{ display:"flex", gap:8 }}>
                    {[[friends, "friends prayed for"], [shared, "heard the Gospel"], [circles.length, "people with a circle"]].map(([n, l]) => (
                      <div key={l} style={{ ...S.statChip, flex:1 }}><span style={S.statNum}>{n}</span><span style={S.statLbl}>{l}</span></div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* ─── IMPORT ─── */}
      {view === "import" && (
        <div style={S.importWrap}>
          {/* Export */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 16px", background:C.surface, border:`1px solid ${C.border}`, borderRadius:12 }}>
            <div>
              <p style={{ margin:0, fontSize:14, color:C.cream, fontWeight:500 }}>Export Roster</p>
              <p style={{ margin:"2px 0 0", fontSize:12, color:C.muted }}>Download all active people as a CSV</p>
            </div>
            <button onClick={exportRoster} style={{ background:C.accent, border:"none", color:"#101112", borderRadius:9, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
              <Upload size={14} />Export
            </button>
          </div>

          <h3 style={S.importTitle}>Import CSV</h3>
          <p style={S.importDesc}>
            Just export whatever roster you already have. The importer only looks for name and birthday columns — everything else is ignored.
          </p>

          <div style={S.importRulesBox}>
            <div style={S.importRule}>
              <span style={{ ...S.importRuleIcon, fontFamily:"monospace", fontSize:13 }}>ID</span>
              <div>
                <strong style={{ color: C.cream }}>Names</strong> — recognizes columns like <code style={S.code}>Name</code>, <code style={S.code}>First Name</code>, <code style={S.code}>Last Name</code>, <code style={S.code}>Student</code>. Separate first/last columns are joined automatically. "Smith, John" format is flipped to "John Smith".
              </div>
            </div>
            <div style={S.importRule}>
              <Cake size={16} color={C.muted} style={{ flexShrink:0, marginTop:2 }} />
              <div>
                <strong style={{ color: C.cream }}>Birthdays</strong> — recognizes <code style={S.code}>Birthday</code>, <code style={S.code}>DOB</code>, <code style={S.code}>Birthdate</code>. Accepts MM/DD, MM-DD, or "March 15".
              </div>
            </div>
            <div style={S.importRule}>
              <span style={{ ...S.importRuleIcon, fontFamily:"monospace", fontSize:13 }}>ST</span>
              <div>All imported people start as <strong style={{ color: C.cream }}>Students</strong>. Change roles in the People tab after importing.</div>
            </div>
          </div>

          <pre style={S.csvPreview}>{`Last Name,First Name,Grade,Email,DOB\nSmith,John,10,j@school.edu,03/15\nLee,Sarah,11,s@school.edu,11-02\nBrown,Mike,9,,`}</pre>
          <p style={S.importNote}>Above: a messy real-world export — Grade and Email columns are simply ignored.</p>

          <button onClick={() => fileRef.current.click()} style={S.uploadBtn}>
            <Upload size={16} style={{ marginRight: 8 }} /> Choose File
          </button>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: "none" }} />

          {importData && (
            <div style={S.previewBox}>
              <p style={S.previewTitle}>Preview — {importData.length} people found</p>
              <div style={S.previewScroll}>
                {importData.slice(0, 12).map((p, i) => (
                  <div key={i} style={S.previewRow}>
                    <span style={S.previewName}>{p.name}</span>
                    {p.birthday
                      ? <span style={S.bdayBadgeSm}><Cake size={9} style={{ marginRight: 3 }} />{formatBirthday(p.birthday)}</span>
                      : <span style={{ fontSize: 11, color: C.faint }}>no birthday</span>
                    }
                  </div>
                ))}
                {importData.length > 12 && <p style={S.moreText}>and {importData.length - 12} more</p>}
              </div>
              <div style={S.previewBtnRow}>
                <button onClick={confirmImport} style={S.confirmBtn}>Import All</button>
                <button onClick={() => setImportData(null)} style={S.cancelBtn}>Cancel</button>
              </div>
            </div>
          )}


        </div>
      )}
      {/* Admin footer link */}
      <div style={S.adminFooter}>
        {adminAuthed
          ? <button onClick={lockAdmin} style={S.adminLink}>lock admin</button>
          : <button onClick={() => { setAdminPwInput(""); setAdminPwError(""); setShowAdminPrompt(true); }} style={S.adminLink}>admin</button>
        }
        <span style={{ color: C.border, fontSize: 11, margin: "0 8px" }}>·</span>
        <button onClick={signOutDevice} style={S.adminLink}>sign out</button>
      </div>
    </div>
  );
}

/* ── Colors ─────────────────────────────────────────────── */
// IMPACT Student Ministry brand: blue #3d59a8, green #4cad3b, orange #e95e24, charcoal #3a3a3c
const C = {
  bg: "#161719",        // near-black
  surface: "#1f2023",   // raised surface
  card: "#25272a",      // card surface
  border: "#34363a",    // subtle border
  accent: "#4cad3b",    // IMPACT green
  accentLight: "#74c464", // lighter green
  accentBg: "#18241a",  // green tinted bg
  orange: "#e95e24",    // IMPACT orange
  blue: "#3d59a8",      // IMPACT blue
  cream: "#f2f1ee",     // soft white
  muted: "#80848a",     // cool grey
  faint: "#2b2d31",     // very dark grey
  student: "#7b93db",   // IMPACT blue, lifted for dark backgrounds
  studentBg: "#1a2036", // dark blue
  leader: "#4cad3b",    // green (same as accent)
  leaderBg: "#18241a",
  prayedGreen: "#4cad3b",
  prayedBg: "#18241a",
};

/* ── Styles ─────────────────────────────────────────────── */
const S = {
  root: { minHeight: "100vh", background: C.bg, color: C.cream, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 0" },
  appName: { display: "inline-flex", alignItems: "center", gap: 6, borderLeft: `1px solid ${C.border}`, paddingLeft: 10, marginLeft: 2, fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 15, fontWeight: 700, color: C.cream, letterSpacing: "0.01em", whiteSpace: "nowrap" },
  logoWrap: { display: "flex", alignItems: "center", gap: 8 },
  logoCross: { fontSize: 18, color: C.accent },
  logoText: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 24, fontWeight: 600, color: C.cream, letterSpacing: "0.01em" },
  weekBar: { display: "flex", alignItems: "center", gap: 6, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 20, padding: "5px 12px" },
  weekText: { fontSize: 12, color: C.muted },
  bdayAlert: { fontSize: 11, background: C.faint, color: C.accent, borderRadius: 10, padding: "2px 7px 2px 6px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, verticalAlign: "middle" },
  progressTrack: { margin: "14px 20px 0", height: 3, background: C.faint, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", background: `linear-gradient(90deg, ${C.blue}, ${C.accent} 55%, ${C.orange})`, borderRadius: 2, transition: "width 0.6s ease" },
  tabs: { display: "flex", borderBottom: `1px solid ${C.border}`, margin: "14px 0 0", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" },
  tab: { flex: "1 0 auto", background: "none", borderTop: "none", borderLeft: "none", borderRight: "none", borderBottom: "2px solid transparent", marginBottom: -1, color: C.muted, padding: "10px 8px", cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", fontSize: 13, fontWeight: 400, letterSpacing: "0.01em", whiteSpace: "nowrap", transition: "color 0.2s" },
  tabActive: { color: C.cream, borderBottom: `2px solid ${C.accent}`, marginBottom: -1, fontWeight: 600 },
  // PRAY
  prayWrap: { flex: 1, display: "flex", flexDirection: "column", padding: "16px 20px 28px" },
  controls: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  togglePill: { display: "flex", background: C.faint, borderRadius: 20, padding: 2 },
  toggleOpt: { background: "none", border: "none", color: C.muted, padding: "5px 14px", borderRadius: 18, cursor: "pointer", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", transition: "all 0.2s" },
  toggleOptOn: { background: C.surface, color: C.cream, fontWeight: 500 },
  filterSelect: { background: C.faint, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 20, padding: "5px 12px", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer", outline: "none", flex: 1 },
  reshuffleBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 20, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  bdayDismiss: { position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", color:C.border, cursor:"pointer", fontSize:14, padding:"4px 6px", lineHeight:1 },
  bdayBanner: { background: C.faint, border: `1px solid ${C.accent}`, borderRadius: 12, color: C.accentLight, padding: "12px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", textAlign: "center", width: "100%", marginBottom: 8, animation: "bdayGlow 1.6s ease-in-out infinite" },
  swipeHint: { fontSize: 11, color: C.faint, textAlign: "center", marginBottom: 8, letterSpacing: "0.05em" },
  empty: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingBottom: 60 },
  emptyTitle: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 22, color: C.muted, margin: 0 },
  emptySub: { fontSize: 13, color: C.faint, margin: 0, textAlign: "center" },
  cardOuter: { position: "relative", margin: "0 0 20px", touchAction: "pan-y" },
  cardGhost: { position: "absolute", inset: 0, background: "#242729", borderRadius: 16, boxShadow: "0 4px 16px rgba(0,0,0,0.4)" },
  card: { position: "relative", backgroundColor: C.card, background: `repeating-linear-gradient(${C.card}, ${C.card} 27px, #2b2d31 27px, #2b2d31 28px)`, backgroundPositionY: "52px", border: "1px solid rgba(255,255,255,0.06)", borderTop: `1px solid ${C.accent}33`, borderRadius: 16, padding: "28px 24px 22px", display: "flex", flexDirection: "column", gap: 0, boxShadow: `0 2px 0 ${C.accent}18 inset, 0 12px 48px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.4)`, userSelect: "none", willChange: "transform" },
  cardDone: { background: "#17221a", border: "1px solid rgba(76,173,59,0.2)", borderTop: "1px solid rgba(76,173,59,0.35)" },
  badge: { display: "inline-flex", alignSelf: "flex-start", padding: "3px 11px", borderRadius: 12, fontSize: 11, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 14 },
  studentBadge: { background: C.studentBg, color: C.student, border: `1px solid ${C.student}33` },
  leaderBadge: { background: C.leaderBg, color: C.leader, border: `1px solid ${C.leader}33` },
  cardName: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 34, fontWeight: 500, lineHeight: 1.2, color: C.cream, margin: "6px 0 12px", letterSpacing: "-0.01em" },
  bdayChip: { display: "inline-flex", alignItems: "center", background: C.faint, border: `1px solid ${C.border}`, color: C.accent, borderRadius: 10, padding: "5px 12px", fontSize: 14, marginBottom: 12, gap: 4 },
  bdayChipUrgent: { background: C.accentBg, border: `1px solid ${C.accent}`, color: C.accentLight, fontWeight: 500 },
  bdayQuiet: { display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: C.muted, marginBottom: 10 },
  cardPrayedRow: { marginBottom: 18, marginTop: 4 },
  prayedChip: { fontSize: 12, color: C.prayedGreen, background: C.accentBg, padding: "3px 10px", borderRadius: 10 },
  lastPrayedChip: { fontSize: 13, color: C.muted, lineHeight: 1.4 },
  neverChip: { fontSize: 13, color: C.muted, fontStyle: "italic" },
  cardPhotoWrap: { alignSelf: "center", background: "#f3eee6", padding: "7px 7px 20px", borderRadius: 4, boxShadow: "0 6px 18px rgba(0,0,0,0.45)", marginBottom: 18 },
  cardPhoto: { width: 132, height: 132, objectFit: "cover", display: "block", borderRadius: 2, background: C.faint, pointerEvents: "none" },
  sgBadge: { background: "#2a2433", color: "#b49ad0", display: "inline-flex", alignItems: "center", textTransform: "none", letterSpacing: "0.02em" },
  staffBadge: { background: "#2b2414", color: "#e6b34a", border: "1px solid #e6b34a33", marginBottom: 0 },
  staffBadgeSm: { background: "#2b2414", color: "#e6b34a" },
  answeredBox: { background: C.accentBg, border: `1px solid ${C.accent}33`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  familyBox: { background: "#221e29", border: "1px solid #b49ad033", borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  gospelBox: { background: "#2a1a12", border: `1px solid ${C.orange}40`, borderRadius: 10, padding: "12px 14px", marginTop: 12 },
  causeBox: { background: C.accentBg, border: `1px solid ${C.accent}33`, borderRadius: 10, padding: "12px 14px", marginTop: 12 },
  causeHead: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 8 },
  causeLabel: { fontSize: 10, color: C.accentLight, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 },
  causeCount: { fontSize: 11, color: C.muted },
  causeItem: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 },
  causeCheck: { width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${C.muted}`, background: "none", color: C.bg, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, flexShrink: 0 },
  causeCheckOn: { background: C.accent, border: `1.5px solid ${C.accent}` },
  causeShared: { fontSize: 10, color: C.accent, textTransform: "uppercase", letterSpacing: "0.06em" },
  sgRow: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.faint}` },
  avatarBtn: { position: "relative", background: "none", border: "none", padding: 0, cursor: "pointer", flexShrink: 0, marginRight: 10, borderRadius: "50%" },
  avatarCam: { position: "absolute", right: -2, bottom: -2, width: 17, height: 17, borderRadius: "50%", background: C.accent, color: "#101112", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${C.surface}` },
  reqBox: { background: C.faint, borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  reqLabel: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  reqItem: { display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  reqDot: { color: C.accent, fontSize: 8, marginTop: 3, flexShrink: 0 },
  reqText: { flex: 1, fontSize: 13, color: C.cream, lineHeight: 1.4 },
  reqRemove: { background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 },
  reqInputRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 4 },
  reqInput: { flex: 1, minWidth: 0, background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "7px 10px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none" },
  reqAddBtn: { background: C.accent, border: "none", color: "#101112", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  reqCancelBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  addReqTrigger: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", alignSelf: "flex-start", marginTop: 8, fontFamily: "'Inter', system-ui, sans-serif" },
  navRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 16 },
  navArrow: { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: "50%", width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  counter: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 18, color: C.muted, minWidth: 60, textAlign: "center" },
  prayBtn: { background: C.orange, border: "none", color: "#fff", borderRadius: 12, padding: "14px 0", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter', system-ui, sans-serif", boxShadow: `0 4px 24px rgba(233,94,36,0.4)`, letterSpacing: "0.02em" },
  prayedActions: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12 },
  prayedConfirm: { display: "flex", alignItems: "center", color: C.prayedGreen, fontSize: 15, fontWeight: 500 },
  undoBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  // WEEK
  weekWrap: { flex: 1, padding: "16px 20px 32px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" },
  weekTitle: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 28, color: C.cream, margin: 0, fontWeight: 400 },
  weekSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" },
  sectionHead: { display: "flex", alignItems: "center", padding: "11px 14px", borderBottom: `1px solid ${C.border}`, background: C.bg },
  sectionTitle: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.09em", fontWeight: 500 },
  weekRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${C.faint}` },
  weekName: { fontSize: 14, color: C.cream },
  weekMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  weekEmpty: { fontSize: 13, color: C.faint, padding: "16px 14px", margin: 0, textAlign: "center", fontStyle: "italic" },
  allPrayedBanner: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "22px 14px" },
  allPrayedText: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 18, color: C.accent, textAlign: "center" },
  // PEOPLE
  peopleWrap: { flex: 1, padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 10 },
  addRow: { display: "flex", gap: 8 },
  addInput: { flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.cream, padding: "10px 12px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none" },
  addTypeSelect: { background: C.surface, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 10, padding: "10px 10px", fontSize: 12, fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer", outline: "none" },
  addPersonBtn: { background: C.accent, border: "none", color: "#101112", borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
  statRow: { display: "flex", gap: 6 },
  statChip: { flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 },
  statNum: { fontSize: 18, fontFamily: "'Montserrat', system-ui, sans-serif", color: C.cream },
  statLbl: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" },
  personList: { display: "flex", flexDirection: "column", gap: 4 },
  personCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" },
  personRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px" },
  personLeft: { display: "flex", flexDirection: "column", gap: 4 },
  personName: { fontSize: 14, color: C.cream },
  personMeta: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  badgeSm: { fontSize: 10, padding: "2px 8px", borderRadius: 8, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 },
  studentBadgeSm: { background: C.studentBg, color: C.student },
  leaderBadgeSm: { background: C.leaderBg, color: C.leader },
  prayedSmall: { fontSize: 11, color: C.prayedGreen },
  reqCountBadge: { fontSize: 11, color: C.accent, background: C.faint, padding: "1px 7px", borderRadius: 8 },
  bdayBadgeSm: { display: "inline-flex", alignItems: "center", fontSize: 10, color: C.muted, background: C.faint, padding: "1px 7px", borderRadius: 8 },
  personActions: { display: "flex", gap: 6 },
  iconBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  gradeBadge: { fontSize: 10, padding: "2px 7px", borderRadius: 8, background: C.faint, color: C.muted, fontWeight: 500 },
  gradeBadgeLg: { background: C.faint, color: C.muted, border: `1px solid ${C.border}`, marginBottom: 0 },
  gradeRow: { display: "flex", alignItems: "center", gap: 10, padding: "7px 12px", borderTop: `1px solid ${C.faint}`, background: C.surface },
  gradeLabel: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", flexShrink: 0 },
  gradeSelect: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, color: C.cream, padding: "4px 8px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", cursor: "pointer", outline: "none" },
  promoteSection: { marginTop: 4 },
  promoteBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 10, padding: "11px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", width: "100%", textAlign: "left" },
  promoteConfirm: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 },
  promoteConfirmText: { fontSize: 13, color: C.cream, margin: 0, lineHeight: 1.5 },
  nameRow: { display: "flex", alignItems: "center", gap: 6 },
  editNameBtn: { background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 },
  nameEditRow: { display: "flex", alignItems: "center", gap: 6, marginBottom: 2 },
  nameInput: { flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "5px 8px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none", minWidth: 0 },
  bdayEditRow: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: `1px solid ${C.faint}`, background: C.surface },
  bdayInput: { flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "6px 10px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none" },
  inactiveSection: { marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 12 },
  inactiveHeading: { fontSize: 11, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 8px" },
  inactiveRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid ${C.faint}` },
  inactiveName: { fontSize: 13, color: C.muted },
  restoreBtn: { background: "none", border: `1px solid ${C.border}`, color: C.leader, borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  deleteBtn: { background: "none", border: `1px solid rgba(138,80,80,0.4)`, color: "#8a5050", borderRadius: 7, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  // IMPORT
  importWrap: { flex: 1, padding: "16px 20px 28px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" },
  importTitle: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 26, color: C.cream, margin: 0, fontWeight: 400 },
  importDesc: { fontSize: 13, color: C.muted, margin: 0 },
  importNote: { fontSize: 12, color: C.muted, margin: "0" },
  importRulesBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "4px 0", display: "flex", flexDirection: "column" },
  importRule: { display: "flex", gap: 12, padding: "11px 14px", borderBottom: `1px solid ${C.faint}`, fontSize: 12, color: C.muted, lineHeight: 1.5, alignItems: "flex-start" },
  importRuleIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  code: { background: C.faint, padding: "1px 6px", borderRadius: 4, fontSize: 11, color: C.accent, fontFamily: "monospace" },
  csvPreview: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", fontSize: 12, color: C.muted, margin: 0, lineHeight: 1.6, fontFamily: "monospace", overflowX: "auto" },
  uploadBtn: { background: C.surface, border: `1px solid ${C.border}`, color: C.cream, borderRadius: 10, padding: "12px 20px", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", fontFamily: "'Inter', system-ui, sans-serif", alignSelf: "flex-start" },
  previewBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" },
  previewTitle: { fontSize: 12, color: C.muted, margin: "0 0 10px", textTransform: "uppercase", letterSpacing: "0.06em" },
  previewScroll: { display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" },
  previewRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.faint}` },
  previewName: { fontSize: 13, color: C.cream },
  moreText: { fontSize: 12, color: C.muted, margin: "6px 0 0", textAlign: "center" },
  previewBtnRow: { display: "flex", gap: 8, marginTop: 12 },
  confirmBtn: { background: C.accent, border: "none", color: "#101112", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  cancelBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "9px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  // WEEKLY REPORT
  reportBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "16px" },
  reportTitle: { fontSize: 13, color: C.accent, fontWeight: 500, margin: "0 0 12px" },
  reportEmpty: { fontSize: 12, color: C.muted, margin: 0, fontStyle: "italic" },
  reportRow: { display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 },
  reportRowTop: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  reportWeekLabel: { fontSize: 12, color: C.muted },
  reportCount: { fontSize: 16, fontFamily: "'Montserrat', system-ui, sans-serif", color: C.cream },
  reportBar: { height: 6, background: C.faint, borderRadius: 3, overflow: "hidden" },
  reportBarFill: { height: "100%", background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`, borderRadius: 3, transition: "width 0.6s ease" },
  reportPct: { fontSize: 11, color: C.muted },
  // REMINDERS
  reminderSetupBtn: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 10, padding: "10px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", textAlign: "left" },
  iosDismiss: { background: "none", border: `1px solid ${C.border}`, color: C.muted, borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", alignSelf: "flex-start", marginTop: 4 },
  timeInput: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "6px 10px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none", cursor: "pointer" },
    reminderOffBtn: { background: "none", border: `1px solid ${C.border}`, color: "#8a5050", borderRadius: 10, padding: "9px 0", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  // ADMIN FOOTER
  adminFooter: { display: "flex", justifyContent: "center", padding: "12px 0 20px", marginTop: "auto" },
  cardCamBtn: { position: "absolute", top: 12, right: 12, zIndex: 2, display: "flex", alignItems: "center", background: C.faint, border: `1px solid ${C.border}`, color: C.muted, borderRadius: 16, padding: "6px 9px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  myGroupRow: { display: "flex", alignItems: "center", gap: 8, width: "100%", marginBottom: 10 },
  myGroupPill: { display: "flex", flex: 1, minWidth: 0, background: C.faint, border: `1px solid ${C.border}`, borderRadius: 22, padding: 3, gap: 3 },
  myGroupOpt: { flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: C.muted, borderRadius: 18, padding: "7px 10px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  myGroupOptOn: { background: C.accent, color: "#101112", fontWeight: 600 },
  myGroupChange: { background: "none", border: "none", color: C.muted, fontSize: 12, cursor: "pointer", padding: "4px 2px", fontFamily: "'Inter', system-ui, sans-serif", flexShrink: 0 },
  wallBanner: { display: "flex", alignItems: "center", gap: 10, width: "100%", boxSizing: "border-box", background: "#2a1a12", border: `1px solid ${C.orange}55`, borderRadius: 12, padding: "11px 14px", marginBottom: 12, color: C.cream, fontSize: 13.5, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
  tabBadge: { position: "absolute", top: 2, right: -2, minWidth: 16, height: 16, padding: "0 4px", boxSizing: "border-box", borderRadius: 8, background: C.orange, color: "#fff", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1 },
  adminLink: { background: "none", border: "none", color: C.border, fontSize: 11, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", letterSpacing: "0.06em" },
  // MODAL
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 24 },
  modalBox: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "28px 24px", width: "100%", maxWidth: 320, display: "flex", flexDirection: "column", gap: 14 },
  modalTitle: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 22, color: C.cream, margin: 0, textAlign: "center" },
  modalInput: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.cream, padding: "12px 14px", fontSize: 16, fontFamily: "'Inter', system-ui, sans-serif", outline: "none", textAlign: "center", letterSpacing: "0.08em" },
  modalError: { fontSize: 12, color: "#c07070", margin: 0, textAlign: "center" },
  modalBtns: { display: "flex", gap: 8 },
  // DROPDOWN
  ddWrap: { marginTop: 12, display: "flex", flexDirection: "column" },
  ddToggle: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.muted, padding: "10px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center" },
  ddList: { background: C.surface, border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 10px 10px", maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column" },
  ddItem: { background: "none", border: "none", borderBottom: `1px solid ${C.faint}`, color: C.cream, padding: "11px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif", display: "flex", justifyContent: "space-between", alignItems: "center", textAlign: "left" },
  ddItemPrayed: { color: C.muted },
  ddItemMeta: { fontSize: 11, color: C.muted, marginLeft: 8, flexShrink: 0, background: C.faint, borderRadius: 6, padding: "2px 7px" },
  // TAP TO BEGIN
  tapCard: { cursor: "pointer", alignItems: "center", justifyContent: "center", minHeight: 220, gap: 10, animation: "tapPulse 2s ease-in-out infinite" },
  tapCross: { fontSize: 28, color: C.accent, marginBottom: 8 },
  tapTitle: { fontFamily: "'Montserrat', system-ui, sans-serif", fontSize: 36, fontWeight: 400, color: C.cream, margin: 0, textAlign: "center" },
  tapSub: { fontSize: 13, color: C.muted, margin: 0, textAlign: "center" },
  // GROUP BADGES
  badgeRow: { display: "flex", gap: 6, marginBottom: 14 },
  hsBadge: { background: C.studentBg, color: "#8ea3e3", border: "1px solid #8ea3e333", marginBottom: 0 },
  msBadge: { background: C.faint, color: "#74c464", border: "1px solid #4cad3b33", marginBottom: 0 },
  hsBadgeSm: { background: C.studentBg, color: "#8ea3e3" },
  msBadgeSm: { background: C.faint, color: "#74c464" },
};
