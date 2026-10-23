// Pending student submissions, kept in KV under "submissions".
const KEY = "submissions";
const MAX_PENDING = 300;

export async function readSubmissions(kv) {
  try {
    const list = JSON.parse((await kv.get(KEY)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch (_e) { return []; }
}

export async function addSubmission(kv, item) {
  const list = await readSubmissions(kv);
  if (list.length >= MAX_PENDING) return { ok: false, error: "The inbox is full right now. Please tell a leader in person." };
  const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
  list.push({ id, createdAt: Date.now(), ...item });
  await kv.put(KEY, JSON.stringify(list));
  return { ok: true, id };
}

export async function removeSubmissions(kv, ids) {
  const drop = new Set(ids);
  const list = await readSubmissions(kv);
  const next = list.filter(s => !drop.has(s.id));
  await kv.put(KEY, JSON.stringify(next));
  await Promise.all(ids.map(id => kv.delete(`pending-photo:${id}`)));
  return next;
}

/* Student photos wait here until approved */
const MAX_PHOTO = 400 * 1024;

export function decodePhoto(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  let bin;
  try { bin = atob(m[1]); } catch (_e) { return null; }
  if (bin.length < 100 || bin.length > MAX_PHOTO) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null; // must really be a JPEG
  return bytes.buffer;
}

export async function savePendingPhoto(kv, id, buf) {
  await kv.put(`pending-photo:${id}`, buf, { expirationTtl: 60 * 24 * 60 * 60 });
}

export async function readPendingPhoto(kv, id) {
  return kv.get(`pending-photo:${id}`, { type: "arrayBuffer" });
}
