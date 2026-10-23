// Student submissions: prayer requests and CAUSE Circle names.
// Nothing here is shown to anyone until an admin approves it in the Inbox.
//
// GET  /api/submit  → { open, name, sub, role }   (public: tells the student page what to show)
// POST /api/submit { name, kind: "request" | "cause" | "info" | "gospel" | "parent", students?, privacy?, dontMention?, followUp?, contact?, count?, friend?, outcome?, text, friends: [], grade?, birthday?: "MM-DD", photo?: "data:image/jpeg;base64,…" }
//   (student code or higher)
import { getSession, publicSettings, json } from "../../lib/auth.js";
import { addSubmission, savePendingPhoto, decodePhoto } from "../../lib/inbox.js";

export async function onRequest(context) {
  const { request, env, data: ctx } = context;
  const role = ctx && ctx.session ? ctx.session.role : null;

  if (request.method === "GET") {
    const { role, settings } = await getSession(request, env);
    const pub = publicSettings(settings);
    return json({ open: !!(pub && pub.studentCodeSet), parentOpen: !!(pub && pub.parentCodeSet), name: pub ? pub.name : "", sub: pub ? pub.sub : "", configured: !!pub, role });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await request.json(); } catch (_e) { return json({ error: "Invalid JSON" }, 400); }

  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const KINDS = ["request", "cause", "info", "gospel", "parent"];
  const kind = KINDS.includes(body.kind) ? body.kind : "request";
  // Parents can only send family requests; students can't send parent ones
  if (role === "parent" && kind !== "parent") return json({ error: "Please use the parent page." }, 403);
  if (role === "student" && kind === "parent") return json({ error: "Please use the student page." }, 403);
  if (name.length < 2) return json({ error: "Please enter your name." }, 400);

  // Optional roster details, applied only when an admin approves
  const g = Number(body.grade);
  const grade = Number.isInteger(g) && g >= 5 && g <= 12 ? g : null;
  let birthday = null;
  const bm = /^(\d{2})-(\d{2})$/.exec(String(body.birthday || ""));
  if (bm) {
    const m = Number(bm[1]), d = Number(bm[2]);
    const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1]) birthday = `${bm[1]}-${bm[2]}`;
  }

  // Optional photo (a small JPEG the page already shrank). Held until an admin approves it.
  let photo = null;
  if (body.photo) {
    photo = decodePhoto(body.photo);
    if (!photo) return json({ error: "That photo couldn’t be used. Try a different one." }, 400);
  }

  let text = "";
  let friends = [];
  let gospel = null;
  let parent = null;
  if (kind === "parent") {
    // A family prayer request from a parent
    text = String(body.text || "").trim().slice(0, 1200);
    if (text.length < 3) return json({ error: "Please write your prayer request." }, 400);
    const students = String(body.students || "").trim().replace(/\s+/g, " ").slice(0, 160);
    parent = {
      students,
      privacy: body.privacy === "staff" ? "staff" : "leaders",
      dontMention: body.dontMention === true,
      followUp: body.followUp === true,
      contact: body.followUp === true ? String(body.contact || "").trim().slice(0, 120) : "",
    };
  } else if (kind === "gospel") {
    // A Gospel conversation the student had: how many, who with, how it went, and the story
    const count = Math.round(Number(body.count));
    if (!Number.isFinite(count) || count < 1 || count > 50) return json({ error: "How many Gospel conversations did you have?" }, 400);
    const OUTCOMES = ["shared", "questions", "visit", "trusted"];
    gospel = {
      count,
      friend: String(body.friend || "").trim().replace(/\s+/g, " ").slice(0, 60),
      outcome: OUTCOMES.includes(body.outcome) ? body.outcome : null,
    };
    text = String(body.text || "").trim().slice(0, 1200);
  } else if (kind === "info") {
    if (!grade && !birthday && !photo) return json({ error: "Add your grade, birthday, or a photo." }, 400);
  } else if (kind === "request") {
    text = String(body.text || "").trim().slice(0, 600);
    if (text.length < 3) return json({ error: "Please write your prayer request." }, 400);
  } else {
    friends = (Array.isArray(body.friends) ? body.friends : String(body.text || "").split(/[,\n]/))
      .map(f => String(f).trim().replace(/\s+/g, " ").slice(0, 60))
      .filter(Boolean)
      .slice(0, 12);
    if (!friends.length) return json({ error: "Add at least one friend’s name." }, 400);
  }

  // Prayer Wall opt-in (requests only). An admin still approves before anything is posted.
  const share = kind === "request" && body.share === true;
  const anonymous = share && body.anonymous === true;

  const result = await addSubmission(env.INTERCEDE_KV, { name, kind, text, friends, grade, birthday, share, anonymous, hasPhoto: !!photo, gospel, parent });
  if (!result.ok) return json({ error: result.error }, 429);
  if (photo) await savePendingPhoto(env.INTERCEDE_KV, result.id, photo);
  return json({ ok: true, id: result.id });
}
