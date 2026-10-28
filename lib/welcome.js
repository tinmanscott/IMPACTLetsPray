// Public welcome page (livinghopestudents.com and impactletspray.app/welcome).
//
// KV:  welcome:content        → the page's text, links and settings (admin edits it in Let's Pray → Website)
//      welcome:photo:<slot>   → JPEG for each photo slot (versions are kept in content.photos)
// The teaching series and upcoming events are NOT stored here: the page reads them from Let's Pray
// (Teach) and the BAND calendar, so there's only one place to keep them current.

export const PHOTO_SLOTS = ["logo", "hero1", "hero2", "hero3", "hero4", "students", "parents", "events"];

export const DEFAULT_CONTENT = {
  name: "Living Hope Students",
  intro: "Living Hope Students is the student ministry of Living Hope Church in Findlay, OH. Whether you’re a teenager (or connected to one), in middle school or high school, you are welcome and wanted at Living Hope Students!",
  tagline: "Faith meets fun and friendship here!",
  belongTitle: "You Belong Here",
  belongText: "You are ALWAYS welcome here! Regardless of where you’ve been or where you’re going, what you’ve experienced or haven’t experienced yet, what you know or haven’t figured out yet: YOU BELONG HERE!\n\nThis is a place where you are WELCOMED warmly, WANTED by caring adults and teens just like you, KNOWN by people trying to figure out life, faith, friendship and all the things, and NEEDED by the world around you!",
  gatherings: [
    { title: "Sunday Nights", name: "IMPACT", when: "6:00 – 8:00 PM", text: "Middle school and high school students. Worship, teaching and games." },
    { title: "dGroups", name: "Small groups", when: "Tuesday & Wednesday nights", text: "High school groups meet Tuesday nights. Middle school groups meet Wednesday nights." },
  ],
  alertsKeyword: "student ministry",
  alertsNumber: "833-515-0669",
  parentTitle: "Parent Hub",
  parentText: "We believe parents are the primary influence in a student’s life, and we’re passionate about partnering with you as you raise teenagers who grow in faith, character and purpose. Parenting teenagers isn’t easy, and you don’t have to do it alone. If you ever have questions, concerns or prayer requests, we’re here to help.",
  church: "Living Hope Church",
  address: "2515 Heatherwood Drive, Findlay, OH 45840",
  website: "https://www.livinghopefindlay.com",
  phone: "419.423.5636",
  band: "https://band.us/n/a9a8b8C6l552r",
  instagram: "https://www.instagram.com/impactfindlay/",
  facebook: "https://www.facebook.com/Findlay.Students",
  youtube: "https://www.youtube.com/channel/UCXfguAlGAnK_0sqe1ObRznA",
  staff: [], // [{ id, name, role, group: "staff" | "leader", email, bio, primary }] — photos are "staff-<id>" in photos
  eventCalendars: null, // null = any BAND calendar with "event" in its name
  eventCount: 6,
  photos: {},
};

const str = (v, n, d = "") => (typeof v === "string" ? v.trim().slice(0, n) : d);
const link = v => { const s = str(v, 400); return !s || /^https?:\/\//i.test(s) ? s : `https://${s.replace(/^\/+/, "")}`; };

export async function loadContent(kv) {
  let saved = {};
  try { saved = JSON.parse((await kv.get("welcome:content")) || "{}") || {}; } catch (_e) { saved = {}; }
  return { ...DEFAULT_CONTENT, ...saved, photos: { ...(saved.photos || {}) } };
}

const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const email = v => { const e = str(v, 120).toLowerCase(); return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/.test(e) ? e : ""; };
export const STAFF_SLOT = /^staff-[a-z0-9]{6,16}$/;

function cleanStaff(list) {
  let primarySeen = false;
  return (Array.isArray(list) ? list : []).slice(0, 40).map(x => {
    x = x || {};
    const primary = x.primary === true && !primarySeen && !!email(x.email);
    if (primary) primarySeen = true;
    return { id: /^[a-z0-9]{6,16}$/.test(String(x.id || "")) ? x.id : newId(), name: str(x.name, 60), role: str(x.role, 80), group: x.group === "leader" ? "leader" : "staff", email: email(x.email), bio: str(x.bio, 300), primary };
  }).filter(x => x.name);
}

export function cleanContent(d, prev) {
  const D = DEFAULT_CONTENT;
  const g = Array.isArray(d.gatherings) ? d.gatherings : D.gatherings;
  return {
    name: str(d.name, 80) || D.name,
    intro: str(d.intro, 800),
    tagline: str(d.tagline, 160),
    belongTitle: str(d.belongTitle, 80),
    belongText: str(d.belongText, 2000),
    gatherings: g.slice(0, 6).map(x => ({ title: str(x && x.title, 60), name: str(x && x.name, 60), when: str(x && x.when, 80), text: str(x && x.text, 400) })).filter(x => x.title || x.name || x.when || x.text),
    alertsKeyword: str(d.alertsKeyword, 60),
    alertsNumber: str(d.alertsNumber, 30),
    parentTitle: str(d.parentTitle, 80),
    parentText: str(d.parentText, 2000),
    church: str(d.church, 80),
    address: str(d.address, 160),
    website: link(d.website),
    phone: str(d.phone, 30),
    band: link(d.band), instagram: link(d.instagram), facebook: link(d.facebook), youtube: link(d.youtube),
    staff: cleanStaff(d.staff),
    eventCalendars: Array.isArray(d.eventCalendars) ? d.eventCalendars.map(x => str(x, 40)).filter(Boolean).slice(0, 6) : null,
    eventCount: Math.max(0, Math.min(12, Number(d.eventCount) || 0)),
    photos: (prev && prev.photos) || {},
  };
}
