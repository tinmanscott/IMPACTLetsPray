// Public welcome page data.
//
// GET    /api/welcome                → { content, events, series }   (anyone; no sign-in)
// GET    /api/welcome?photo=<slot>   → the JPEG for that photo slot  (anyone)
// POST   /api/welcome  JSON content  → save the text and links       (admin)
// POST   /api/welcome { action: "importCanva" } → one-time copy of the photos from the old Canva site (admin)
// POST   /api/welcome?photo=<slot>  (form: photo) → replace a photo  (admin)
// DELETE /api/welcome?photo=<slot>   → remove a photo                (admin)
// Access is checked in _middleware.js. Events come from the BAND calendars picked for the website
// (by default, the one with "event" in its name). Only public-facing fields are sent.
import { json } from "../../lib/auth.js";
import { loadContent, cleanContent, PHOTO_SLOTS } from "../../lib/welcome.js";
import { loadCalendars, feedEvents } from "../../lib/calendar.js";

const MAX_BYTES = 1024 * 1024;
// Photos on the old Canva site (livinghopestudents.com), for the one-time copy
const CANVA_PHOTOS = [
  ["logo", "4ec52be6a16f6d9988830a1ad6eff211.png"],
  ["hero1", "090a9a693203b7139a00e8f25688f3d4.jpg"],
  ["hero2", "0475ad999838fa63c0150784879125ac.jpg"],
  ["hero3", "43bb4af598080895ca04bba5610f4841.jpg"],
  ["hero4", "8607c0d55c025847f902e59f61a2a631.jpg"],
  ["students", "f292cab6ad7a6b9ce76b83474be3c1fa.jpg"],
  ["parents", "67a89fe333d050dd12fd012031f26766.jpg"],
  ["events", "a1c90ffe5b3fb87a0c6219375adbdaa4.jpg"],
];

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;
  const url = new URL(request.url);
  const slot = url.searchParams.get("photo");
  if (slot !== null && !PHOTO_SLOTS.includes(slot)) return json({ error: "Unknown photo" }, 400);

  if (request.method === "GET") {
    if (slot) {
      const { value, metadata } = await kv.getWithMetadata(`welcome:photo:${slot}`, { type: "arrayBuffer" });
      if (!value) return new Response("Not found", { status: 404 });
      const type = metadata && /^image\/(png|jpeg|webp)$/.test(metadata.type) ? metadata.type : "image/jpeg";
      return new Response(value, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    const content = await loadContent(kv);
    // Upcoming events from the website calendars
    let events = [];
    try {
      const cals = (await loadCalendars(kv)).filter(c => c.audience !== "leaders")
        .filter(c => Array.isArray(content.eventCalendars) ? content.eventCalendars.includes(c.id) : /event/i.test(c.name));
      const lists = await Promise.all(cals.map(c => feedEvents(kv, c).then(r => r.events || []).catch(() => [])));
      events = lists.flat()
        .filter(e => e.ts + (e.allDay ? 864e5 : 3 * 36e5) >= Date.now())
        .sort((a, b) => a.ts - b.ts)
        .slice(0, content.eventCount)
        .map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.location, desc: String(e.desc || "").slice(0, 600), link: e.link || "" }));
    } catch (_e) { events = []; }
    // This week's teaching (from Teach in Let's Pray)
    let series = null;
    try {
      const sr = JSON.parse((await kv.get("series")) || "null");
      if (sr && Array.isArray(sr.weeks) && sr.weeks.length) {
        series = { name: sr.name || "", book: sr.book || "", art: Number(sr.art) || 0, weeks: sr.weeks.map(w => ({ date: w.date, title: w.title || "", verseRef: w.verseRef || "", verseText: w.verseText || "" })) };
      }
    } catch (_e) { series = null; }
    const res = json({ content, events, series });
    res.headers.set("Cache-Control", "public, max-age=120");
    return res;
  }

  if (request.method === "DELETE" && slot) {
    await kv.delete(`welcome:photo:${slot}`);
    const content = await loadContent(kv);
    delete content.photos[slot];
    await kv.put("welcome:content", JSON.stringify(content));
    return json({ ok: true, photos: content.photos });
  }

  if (request.method === "POST" && slot) {
    let form;
    try { form = await request.formData(); } catch (_e) { return json({ error: "Expected form data" }, 400); }
    const file = form.get("photo");
    if (!file || typeof file === "string") return json({ error: "Missing image" }, 400);
    if (file.type && !file.type.startsWith("image/")) return json({ error: "Not an image" }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ error: "Image too large" }, 413);
    await kv.put(`welcome:photo:${slot}`, buf, { metadata: { type: "image/jpeg" } });
    const content = await loadContent(kv);
    content.photos[slot] = Date.now();
    await kv.put("welcome:content", JSON.stringify(content));
    return json({ ok: true, photos: content.photos });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }
    if (body && body.action === "importCanva") {
      // Works only while livinghopestudents.com still points to Canva. Fills empty photo slots only.
      const content = await loadContent(kv);
      let copied = 0, skipped = 0;
      for (const [slot, file] of CANVA_PHOTOS) {
        if (content.photos[slot]) { skipped++; continue; }
        try {
          const r = await fetch(`https://livinghopestudents.com/_assets/media/${file}`, { headers: { "User-Agent": "Mozilla/5.0 (Let's Pray photo copy)" } });
          const type = (r.headers.get("Content-Type") || "").split(";")[0];
          if (!r.ok || !/^image\/(png|jpeg|webp)$/.test(type)) continue;
          const buf = await r.arrayBuffer();
          if (buf.byteLength > MAX_BYTES) continue;
          await kv.put(`welcome:photo:${slot}`, buf, { metadata: { type } });
          content.photos[slot] = Date.now(); copied++;
        } catch (_e) { /* try the next one */ }
      }
      await kv.put("welcome:content", JSON.stringify(content));
      if (!copied && skipped < CANVA_PHOTOS.length) return json({ error: "Couldn’t reach the old Canva photos. If livinghopestudents.com already points here, upload photos by hand instead." }, 502);
      return json({ ok: true, copied, skipped, photos: content.photos });
    }
    const prev = await loadContent(kv);
    const content = cleanContent(body || {}, prev);
    await kv.put("welcome:content", JSON.stringify(content));
    return json({ ok: true, content });
  }
  return json({ error: "Method not allowed" }, 405);
}
