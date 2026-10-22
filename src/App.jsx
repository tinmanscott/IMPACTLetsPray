import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Heart, Plus, Trash2, Upload, X, RefreshCw, BookOpen, RotateCcw, Cake, BarChart2, Bell, Star, Lightbulb, Camera, Users, Check, Lock, Settings as SettingsIcon, Inbox as InboxIcon, Flame, Target, Send } from "lucide-react";

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
  return p && p.photo ? `/api/photo?id=${encodeURIComponent(p.id)}&v=${p.photo}` : null;
}

// Shrink to a centered square JPEG so uploads are small and cards look consistent
function resizeImage(file, size = 500) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const out = Math.min(size, side);
      const canvas = document.createElement("canvas");
      canvas.width = out; canvas.height = out;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, out, out);
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

// One place for every roster filter, including small groups ("sg:<id>")
function matchesFilter(p, f) {
  if (!f || f === "all") return true;
  if (f.startsWith("sg:")) return p.smallGroupId === f.slice(3);
  if (f === "students") return p.type === "student";
  if (f === "leaders") return p.type === "leader";
  if (f === "hs") return p.group === "hs";
  if (f === "ms") return p.group === "ms";
  if (f === "hs-students") return p.type === "student" && p.group === "hs";
  if (f === "ms-students") return p.type === "student" && p.group === "ms";
  if (f === "hs-leaders") return p.type === "leader" && p.group === "hs";
  if (f === "ms-leaders") return p.type === "leader" && p.group === "ms";
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
    color: ["#5aba47","#7fd06c","#7b93db","#80848a","#3f8a32","#7fd06c","#7b93db"][i % 7],
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
          <path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#5aba47" />
        </svg>
      </div>
      <h2 style={{ fontFamily:"'Montserrat', system-ui, sans-serif", fontSize:34, fontWeight:400, color:"#f2f1ee", margin:0, lineHeight:1.2 }}>
        Everyone's been<br/>prayed for!
      </h2>
      <p style={{ fontSize:14, color:"#5aba47", margin:0, fontWeight:500 }}>
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
      <button onClick={() => onKeepPraying()} style={{ background:C.accent, border:"none", color:C.bg, borderRadius:12, padding:"13px 28px", fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", boxShadow:"0 4px 20px rgba(90,186,71,0.3)" }}>
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
const authBtn = { background:"#5aba47", border:"none", color:"#fff", borderRadius:12, padding:"14px 0", fontSize:15, fontWeight:700, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", marginTop:4 };
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
      onSignedIn(res);
    } catch (e) { setErr(e.message); setBusy(false); setCode(""); }
  }

  return (
    <div style={authWrap}>
      <img src="/logo.png" alt={status.name || ""} style={{ width: 220, height: "auto", marginBottom: 14 }} />
      {status.sub && <p style={{ fontSize:13, color:"#80848a", margin:"0 0 6px", textTransform:"uppercase", letterSpacing:"0.12em", fontWeight:600 }}>{status.sub}</p>}
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
          <button onClick={() => turnOn()} disabled={busy} style={{ ...S.confirmBtn, background: C.orange }}>{busy ? "Turning on…" : "Turn on"}</button>
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
        <path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#5aba47" />
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

/* ── Student page (/submit) ── */
const STUDENT_NAME_KEY = "lp-student-name";

function StudentPage() {
  const [info, setInfo] = React.useState(null);
  const [code, setCode] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState(() => lsGet(STUDENT_NAME_KEY) || "");
  const [kind, setKind] = React.useState("request");
  const [text, setText] = React.useState("");
  const [friends, setFriends] = React.useState(["", "", ""]);
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
    const list = friends.map(f => f.trim()).filter(Boolean);
    if (name.trim().length < 2) return setErr("Please enter your first and last name.");
    if (kind === "request" && text.trim().length < 3) return setErr("Please write your prayer request.");
    if (kind === "cause" && !list.length) return setErr("Add at least one friend’s name.");
    setBusy(true);
    try {
      const res = await fetch("/api/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), kind, text: text.trim(), friends: list }) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) { load(); throw new Error("Please enter the student code again."); }
      if (!res.ok) throw new Error(data.error || "That didn’t send. Try again.");
      lsSet(STUDENT_NAME_KEY, name.trim());
      setDone(true); setText(""); setFriends(["", "", ""]);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  const card = { width:"100%", maxWidth:400, display:"flex", flexDirection:"column", gap:12 };
  const header = (
    <>
      <img src="/logo.png" alt={info?.name || ""} style={{ width: 210, height: "auto", marginBottom: 10 }} />
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
        <p style={{ color:"#f2f1ee", fontSize:20, fontWeight:700, fontFamily:"'Montserrat', system-ui, sans-serif", margin:"8px 0 0" }}>Got it. Thank you!</p>
        <p style={{ color:"#80848a", fontSize:14, margin:0, lineHeight:1.5 }}>Your leaders will see this and start praying.</p>
        <button onClick={() => setDone(false)} style={{ ...authBtn, padding:"12px 28px", marginTop:12 }}>Share something else</button>
      </div>
    </div>
  );

  const chip = on => ({ flex:1, padding:"11px 0", borderRadius:10, border:`1px solid ${on ? "#5aba47" : "#34363a"}`, background: on ? "#18241a" : "#1f2023", color: on ? "#f2f1ee" : "#80848a", fontSize:14, fontWeight: on ? 700 : 500, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif" });
  return (
    <div style={{ ...authWrap, justifyContent:"flex-start", paddingTop:48 }}>
      {header}
      <div style={card}>
        <div><label style={authLbl}>Your name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" style={authInp} autoComplete="name" /></div>
        <div style={{ display:"flex", gap:8 }}>
          <button onClick={() => setKind("request")} style={chip(kind === "request")}>Prayer request</button>
          <button onClick={() => setKind("cause")} style={chip(kind === "cause")}>CAUSE Circle</button>
        </div>
        {kind === "request" ? (
          <div>
            <label style={authLbl}>How can we pray for you?</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={5} maxLength={600} placeholder="Share as much or as little as you want." style={{ ...authInp, resize:"vertical", lineHeight:1.5 }} />
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
        {err && <p style={{ color:"#e07a5f", fontSize:13, margin:0 }}>{err}</p>}
        <button onClick={submit} disabled={busy} style={{ ...authBtn, background:"#e95e24", opacity: busy ? 0.7 : 1, display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}><Send size={15} /> {busy ? "Sending…" : "Send to my leaders"}</button>
        <p style={{ fontSize:12, color:"#5c6066", margin:"4px 0 24px", textAlign:"center", lineHeight:1.5 }}>Only your student ministry leaders will see what you send.</p>
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

function InboxView({ items, people, setPeople, onRemove, studentCodeSet }) {
  const [match, setMatch] = React.useState({});
  const [edits, setEdits] = React.useState({});
  const choices = React.useMemo(() => people.filter(p => p.active !== false).slice().sort((a, b) => a.name.localeCompare(b.name)), [people]);

  function approve(item) {
    const chosen = match[item.id] ?? guessPerson(item.name, choices);
    const text = (edits[item.id] ?? item.text ?? "").trim();
    const friends = item.kind === "cause"
      ? (edits[item.id] !== undefined ? edits[item.id].split(/[,\n]/) : item.friends || []).map(f => f.trim()).filter(Boolean)
      : [];
    const apply = p => {
      if (item.kind === "request") return { ...p, prayerRequests: [...(p.prayerRequests || []), text], updatedAt: Date.now() };
      const have = new Set((p.causeCircle || []).map(f => normName(f.name)));
      const add = friends.filter(f => !have.has(normName(f))).map(f => ({ id: genId(), name: f, shared: false }));
      return { ...p, causeCircle: [...(p.causeCircle || []), ...add], updatedAt: Date.now() };
    };
    if (chosen === "__new") {
      const base = { id: genId(), name: item.name, type: "student", group: null, grade: null, active: true, prayedAt: null, prayerRequests: [], causeCircle: [], birthday: "", updatedAt: Date.now() };
      setPeople(prev => [...prev, apply(base)]);
    } else if (chosen) {
      setPeople(prev => prev.map(p => p.id === chosen ? apply(p) : p));
    } else return;
    onRemove([item.id]);
  }

  const box = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"12px 14px", display:"flex", flexDirection:"column", gap:8 };
  return (
    <div style={S.importWrap}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}><InboxIcon size={16} color={C.accent} /><p style={{ ...S.reportTitle, margin:0 }}>Student Inbox</p></div>
      <p style={{ margin:"0 0 14px", fontSize:12.5, color:C.muted, lineHeight:1.5 }}>
        Requests and CAUSE Circle names students send from <b style={{ color:C.cream }}>{location.origin}/submit</b>. Nothing shows on a prayer card until you approve it.
        {!studentCodeSet && <span style={{ color:C.orange }}> Set a student code in App Settings (People tab) to open the page.</span>}
      </p>
      {items.length === 0 && <p style={S.reportEmpty}>All caught up. No new submissions.</p>}
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        {items.slice().sort((a, b) => a.createdAt - b.createdAt).map(item => {
          const chosen = match[item.id] ?? guessPerson(item.name, choices);
          const value = edits[item.id] ?? (item.kind === "request" ? item.text : (item.friends || []).join(", "));
          return (
            <div key={item.id} style={box}>
              <div style={{ display:"flex", alignItems:"baseline", gap:8 }}>
                <span style={{ fontSize:14, color:C.cream, fontWeight:600 }}>{item.name}</span>
                <span style={{ ...S.badgeSm, ...(item.kind === "cause" ? { background:C.accentBg, color:C.accentLight } : { background:C.faint, color:C.muted }) }}>{item.kind === "cause" ? "CAUSE Circle" : "Prayer request"}</span>
                <span style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{timeAgo(item.createdAt)}</span>
              </div>
              <textarea value={value} onChange={e => setEdits(prev => ({ ...prev, [item.id]: e.target.value }))} rows={item.kind === "request" ? 3 : 2}
                style={{ ...S.reqInput, resize:"vertical", lineHeight:1.45, fontSize:13.5 }} />
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={S.gradeLabel}>Add to</span>
                <select value={chosen} onChange={e => setMatch(prev => ({ ...prev, [item.id]: e.target.value }))} style={{ ...S.gradeSelect, flex:1, minWidth:0, borderColor: chosen ? C.border : C.orange }}>
                  <option value="">Choose a person…</option>
                  <option value="__new">+ New student: {item.name}</option>
                  {choices.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
                <button onClick={() => onRemove([item.id])} style={S.cancelBtn}>Reject</button>
                <button onClick={() => approve(item)} disabled={!chosen} style={{ ...S.confirmBtn, opacity: chosen ? 1 : 0.5 }}>Approve</button>
              </div>
            </div>
          );
        })}
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

function GoalsCard({ goals, activePeople, weekHistory, smallGroups }) {
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
    const list = activePeople.filter(p => p.smallGroupId === g.id);
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
            {groupRows.sort((a, b) => (b.done / b.total) - (a.done / a.total)).map(r => (
              <div key={r.id}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12.5, marginBottom:4 }}>
                  <span style={{ color:C.cream }}>{r.name}</span>
                  <span style={{ color: r.done >= r.total ? C.accentLight : C.muted }}>{r.done >= r.total ? "all prayed ✓" : `${r.done} / ${r.total}`}</span>
                </div>
                <Bar value={r.done} max={r.total} color={C.accent} />
              </div>
            ))}
          </div>
        </div>
      )}

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
  const [msg, setMsg] = React.useState("");
  React.useEffect(() => { setPct(goals.weeklyPct || 100); setGospel(goals.gospelGoal || 0); }, [goals.weeklyPct, goals.gospelGoal]);
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
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <button onClick={async () => { setMsg(""); try { await onSave({ weeklyPct: pct, gospelGoal: Number(gospel) || 0 }); setMsg("Saved."); } catch (_e) { setMsg("Couldn’t save."); } }} style={S.confirmBtn}>Save goals</button>
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
  if (failed) return (
    <div style={authWrap}>
      <p style={{ color:"#f2f1ee", fontSize:16, marginBottom:12 }}>Can’t reach the server.</p>
      <button onClick={refresh} style={{ ...authBtn, padding:"10px 24px" }}>Try again</button>
    </div>
  );
  if (!status) return <LoadingScreen />;
  if (!status.configured) return <SetupScreen onComplete={setStatus} />;
  if (!status.role || status.role === "student") return <LockScreen status={status} onSignedIn={setStatus} />;
  return <AppMain settings={status} role={status.role} onStatus={setStatus} />;
}

function AppMain({ settings, role, onStatus }) {
  const MINISTRY_NAME = settings.name;
  const MINISTRY_SUB = settings.sub || "";

  const [people, setPeople] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("pray");
  const [order, setOrder] = useState("random");
  const [filter, setFilter] = useState("all");
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
  const [goals, setGoals] = useState({ weeklyPct: 100, gospelGoal: 0 });
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
  @keyframes celebPulse { 0%,100%{transform:scale(1) filter:drop-shadow(0 0 0px #5aba47)} 50%{transform:scale(1.1) filter:drop-shadow(0 0 12px #5aba47)} }
  @keyframes bdayGlow { 0%,100%{box-shadow:0 0 8px 2px rgba(255,255,255,0.2), 0 0 0 0 rgba(255,255,255,0)} 50%{box-shadow:0 0 18px 6px rgba(255,255,255,0.35), 0 0 32px 12px rgba(255,255,255,0.1)} }
  @keyframes bdaySpin { 0%{transform:rotate(-8deg) scale(1.08)} 50%{transform:rotate(8deg) scale(1.15)} 100%{transform:rotate(-8deg) scale(1.08)} }
`;
    document.head.appendChild(style);
    return () => { link.remove(); style.remove(); };
  }, []);

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
    setGoals({ weeklyPct: data.weeklyPct, gospelGoal: data.gospelGoal });
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
    return activePeople.filter(p => matchesFilter(p, filter));
  }, [people, filter]);

  const buildDeck = useCallback((filterOverride) => {
    const f = filterOverride ?? filter;
    const list = activePeople.filter(p => matchesFilter(p, f));
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
      if (p.type === "leader") return { ...p, group: p.group === "hs" ? "ms" : p.group === "ms" ? null : "hs", updatedAt: Date.now() };
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
      ["First Name", "Last Name", "Type", "Group", "Grade", "Birthday", "Small Group"],
      ...people.filter(p => p.active !== false).map(p => {
        const [first, ...rest] = (p.name || "").trim().split(" ");
        const last = rest.join(" ");
        return [first, last, p.type || "", (p.group || "").toUpperCase(), p.grade || "", p.birthday || "", groupName(p.smallGroupId) || ""];
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
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, prayerRequests: [...(p.prayerRequests || []), reqText.trim()], updatedAt: Date.now() } : p));
    setReqText(""); setReqFor(null);
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
    setPeople(prev => prev.map(p => p.smallGroupId === id ? { ...p, smallGroupId: null, updatedAt: Date.now() } : p));
    if (filter === `sg:${id}`) setFilter("all");
    if (rosterSmallGroup === id) setRosterSmallGroup("all");
    if (peopleGroupFilter === id) setPeopleGroupFilter("all");
    setConfirmDeleteGroup(null);
  }

  function assignSmallGroup(personId, groupId) {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, smallGroupId: groupId || null, updatedAt: Date.now() } : p));
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
          {MINISTRY_SUB && <span style={{ ...S.logoSub, borderLeft: `1px solid ${C.border}`, paddingLeft: 10, marginLeft: 2 }}>{MINISTRY_SUB}</span>}
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
        {[["pray","Pray"],["week","Week"],["roster","Roster"]].map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...S.tab, ...(view === v ? S.tabActive : {}) }}>{label}</button>
        ))}
        {adminAuthed && [["inbox","Inbox"],["people","People"],["report","Report"],["import","Import"]].map(([v, label]) => (
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
                    <svg width="52" height="52" viewBox="0 0 20 20" style={{ marginBottom: 12, flexShrink:0 }}><path d="M10,2 L11.768,8.232 L18,10 L11.768,11.768 L10,18 L8.232,11.768 L2,10 L8.232,8.232 Z" fill="#5aba47" /></svg>
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
                        {current?.group && (
                          <div style={{ ...S.badge, ...(current.group === "hs" ? S.hsBadge : S.msBadge) }}>
                            {current.group.toUpperCase()}
                          </div>
                        )}
                        {current?.type === "student" && current?.grade && (
                          <div style={{ ...S.badge, ...S.gradeBadgeLg }}>
                            {ordinal(current.grade)} Gr
                          </div>
                        )}
                        {groupName(current?.smallGroupId) && (
                          <div style={{ ...S.badge, ...S.sgBadge }}>
                            <Users size={11} style={{ marginRight: 5 }} />{groupName(current.smallGroupId)}
                          </div>
                        )}
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
                            <div key={i} style={S.reqItem}>
                              <span style={S.reqDot}>◆</span>
                              <span style={S.reqText}>{req}</span>
                              <button onClick={() => removeRequest(current.id, i)} style={S.reqRemove}><X size={11} /></button>
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
                                  {p.group ? ` ${p.group.toUpperCase()}` : ""}
                                  {groupName(p.smallGroupId) ? ` · ${groupName(p.smallGroupId)}` : ""}
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

      {/* ─── WEEK SUMMARY ─── */}
      {view === "week" && (
        <div style={S.weekWrap}>
          <h2 style={S.weekTitle}>This Week</h2>

          <GoalsCard goals={goals} activePeople={activePeople} weekHistory={weekHistory} smallGroups={smallGroups} />
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
                    {person.group && <span style={{ ...S.badgeSm, ...(person.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{person.group.toUpperCase()}</span>}
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
                  {p.group && <span style={{ ...S.badgeSm, ...(p.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{p.group.toUpperCase()}</span>}
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
              const members = activePeople.filter(p => p.smallGroupId === g.id);
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
                      <button onClick={() => deleteSmallGroup(g.id)} style={{ ...S.reqAddBtn, background:"#8a5050" }}>Delete</button>
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
            {[[`${activePeople.length}`, "total"], [`${activePeople.filter(p => p.group === "hs").length}`, "HS"], [`${activePeople.filter(p => p.group === "ms").length}`, "MS"], [`${prayedCount}`, "prayed ✓"]].map(([n, l]) => (
              <div key={l} style={S.statChip}><span style={S.statNum}>{n}</span><span style={S.statLbl}>{l}</span></div>
            ))}
          </div>

          {/* Type filter */}
          <div style={{ display:"flex", gap:16, justifyContent:"center", marginBottom:6 }}>
            {[["all","All"],["student","Students"],["leader","Leaders"]].map(([val, label]) => (
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
            {activePeople.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) && (peopleTypeFilter === "all" || p.type === peopleTypeFilter) && (peopleGroupFilter === "all" || (peopleGroupFilter === "none" ? !groupName(p.smallGroupId) : p.smallGroupId === peopleGroupFilter))).slice().sort((a, b) => {
              if (peopleSort === "group") {
                const ga = a.group === "ms" ? 0 : a.group === "hs" ? 1 : 2;
                const gb = b.group === "ms" ? 0 : b.group === "hs" ? 1 : 2;
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
                      {p.group && <span style={{ ...S.badgeSm, ...(p.group === "hs" ? S.hsBadgeSm : S.msBadgeSm) }}>{p.group.toUpperCase()}</span>}
                      {p.type === "student" && p.grade && <span style={S.gradeBadge}>{ordinal(p.grade)} Gr</span>}
                      {withinWeek(p.prayedAt) && <span style={S.prayedSmall}>✓ prayed</span>}
                      {(p.prayerRequests || []).length > 0 && <span style={S.reqCountBadge}>{p.prayerRequests.length} req</span>}
                      {p.birthday && <span style={S.bdayBadgeSm}><Cake size={9} style={{ marginRight: 3 }} />{formatBirthday(p.birthday)}</span>}
                      {(p.causeCircle || []).length > 0 && <span style={S.reqCountBadge}>{p.causeCircle.length} CAUSE</span>}
                    </div>
                  </div>
                  <div style={S.personActions}>
                    <button onClick={() => { setEditBdayFor(editBdayFor === p.id ? null : p.id); setBdayInput(p.birthday || ""); setEditNameFor(null); }}
                      style={{ ...S.iconBtn, color: p.birthday ? C.accent : C.muted }} title="Set birthday"><Cake size={13} /></button>
                    <button onClick={() => cycleGroup(p.id)} style={{ ...S.iconBtn, color: p.group === "hs" ? "#8ea3e3" : p.group === "ms" ? "#7fd06c" : C.muted }} title="Cycle HS/MS/none">
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.02em" }}>{p.group ? p.group.toUpperCase() : "—"}</span>
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
                {(smallGroups.length > 0 || p.photo) && (
                  <div style={S.gradeRow}>
                    {smallGroups.length > 0 && (
                      <>
                        <span style={S.gradeLabel}>Small group</span>
                        <select value={groupName(p.smallGroupId) ? p.smallGroupId : ""} onChange={e => assignSmallGroup(p.id, e.target.value)} style={{ ...S.gradeSelect, flex:1, minWidth:0 }}>
                          <option value="">—</option>
                          {smallGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                        </select>
                      </>
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
            {[["all","All"],["ms","MS"],["hs","HS"],["leader","Leaders"]].map(([val, label]) => (
              <button key={val} onClick={() => setRosterGroup(val)} style={{ flex:1, background: rosterGroup === val ? C.accent : C.surface, border:"none", color: rosterGroup === val ? "#fff" : C.muted, padding:"9px 0", fontSize:13, fontWeight: rosterGroup === val ? 600 : 400, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", transition:"background 0.15s" }}>
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
              .filter(p => (rosterGroup === "all" ? true : rosterGroup === "leader" ? p.type === "leader" : p.group === rosterGroup && p.type === "student") && (rosterSmallGroup === "all" || p.smallGroupId === rosterSmallGroup))
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
                    {/* Photo */}
                    <Avatar person={p} size={44} />
                    {/* Text — left aligned below name */}
                    <div style={{ display:"flex", flexDirection:"column", gap:3, flex:1, minWidth:0 }}>
                      <span style={{ fontSize:15, color:C.cream, fontFamily:"'Montserrat', system-ui, sans-serif" }}>{p.name}</span>
                      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        {p.type === "student" && p.grade && (
                          <span style={{ fontSize:13, color:C.muted, fontWeight:600 }}>{ordinal(p.grade)} Grade</span>
                        )}
                        {p.type === "leader" && p.group && (
                          <span style={{ fontSize:13, color:C.muted, fontWeight:600 }}>{p.group.toUpperCase()}</span>
                        )}
                        {bdayFmt && <span style={{ fontSize:13, color:C.muted, display:"flex", alignItems:"center", gap:3 }}><Cake size={12} />{bdayFmt}</span>}
                        {groupName(p.smallGroupId) && <span style={{ fontSize:13, color:C.muted, display:"flex", alignItems:"center", gap:3 }}><Users size={12} />{groupName(p.smallGroupId)}</span>}
                      </div>
                    </div>
                    {/* Group badge */}
                    {p.group && <span style={{ fontSize:10, fontWeight:600, color: p.group === "hs" ? "#8ea3e3" : C.accent, background: p.group === "hs" ? C.studentBg : C.accentBg, borderRadius:6, padding:"2px 7px", flexShrink:0 }}>{p.group.toUpperCase()}</span>}
                  </div>
                );
              })
            }
            {activePeople.filter(p => (rosterGroup === "all" ? true : rosterGroup === "leader" ? p.type === "leader" : p.group === rosterGroup && p.type === "student") && (rosterSmallGroup === "all" || p.smallGroupId === rosterSmallGroup)).length === 0 && (
              <p style={{ textAlign:"center", color:C.muted, fontSize:13, padding:"32px 0" }}>No one in this group yet.</p>
            )}
          </div>
        </div>
      )}


      {/* ─── INBOX ─── */}
      {view === "inbox" && adminAuthed && (
        <InboxView items={submissions} people={people} setPeople={setPeople} onRemove={removeSubmissions} studentCodeSet={!!settings.studentCodeSet} />
      )}

      {/* ─── REPORT ─── */}
      {view === "report" && (
        <div style={S.importWrap}>
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
              {[...smallGroups.map(g => ({ key:g.id, name:g.name, list: activePeople.filter(p => p.smallGroupId === g.id) })),
                { key:"none", name:"Not in a small group", list: activePeople.filter(p => !groupName(p.smallGroupId)) }]
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
            <button onClick={exportRoster} style={{ background:C.accent, border:"none", color:"#fff", borderRadius:9, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", fontFamily:"'Inter', system-ui, sans-serif", display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
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
// IMPACT Student Ministry brand: blue #3c58a7, green #5aba47, orange #e95e24, charcoal #3a3a3c
const C = {
  bg: "#161719",        // near-black
  surface: "#1f2023",   // raised surface
  card: "#25272a",      // card surface
  border: "#34363a",    // subtle border
  accent: "#5aba47",    // IMPACT green
  accentLight: "#7fd06c", // lighter green
  accentBg: "#18241a",  // green tinted bg
  orange: "#e95e24",    // IMPACT orange
  blue: "#3c58a7",      // IMPACT blue
  cream: "#f2f1ee",     // soft white
  muted: "#80848a",     // cool grey
  faint: "#2b2d31",     // very dark grey
  student: "#7b93db",   // IMPACT blue, lifted for dark backgrounds
  studentBg: "#1a2036", // dark blue
  leader: "#5aba47",    // green (same as accent)
  leaderBg: "#18241a",
  prayedGreen: "#5aba47",
  prayedBg: "#18241a",
};

/* ── Styles ─────────────────────────────────────────────── */
const S = {
  root: { minHeight: "100vh", background: C.bg, color: C.cream, fontFamily: "'Inter', system-ui, sans-serif", fontSize: 14, maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 0" },
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
  cardDone: { background: "#17221a", border: "1px solid rgba(90,186,71,0.2)", borderTop: "1px solid rgba(90,186,71,0.35)" },
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
  avatarCam: { position: "absolute", right: -2, bottom: -2, width: 17, height: 17, borderRadius: "50%", background: C.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${C.surface}` },
  reqBox: { background: C.faint, borderRadius: 10, padding: "12px 14px", marginBottom: 14 },
  reqLabel: { fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 8px" },
  reqItem: { display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  reqDot: { color: C.accent, fontSize: 8, marginTop: 3, flexShrink: 0 },
  reqText: { flex: 1, fontSize: 13, color: C.cream, lineHeight: 1.4 },
  reqRemove: { background: "none", border: "none", color: C.muted, cursor: "pointer", padding: 2, display: "flex", flexShrink: 0 },
  reqInputRow: { display: "flex", gap: 6, alignItems: "center", marginTop: 4 },
  reqInput: { flex: 1, minWidth: 0, background: C.faint, border: `1px solid ${C.border}`, borderRadius: 8, color: C.cream, padding: "7px 10px", fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif", outline: "none" },
  reqAddBtn: { background: C.accent, border: "none", color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
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
  addPersonBtn: { background: C.accent, border: "none", color: "#fff", borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 },
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
  confirmBtn: { background: C.accent, border: "none", color: "#fff", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif" },
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
  msBadge: { background: C.faint, color: "#7fd06c", border: "1px solid #5aba4733", marginBottom: 0 },
  hsBadgeSm: { background: C.studentBg, color: "#8ea3e3" },
  msBadgeSm: { background: C.faint, color: "#7fd06c" },
};
