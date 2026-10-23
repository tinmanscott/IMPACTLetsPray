// Student Prayer Wall, stored in KV.
//   wall              → [{ id, name, text, createdAt }]   (name is a first name or "Anonymous")
//   wall:count:<id>   → number of "I prayed" taps
// Posts only get here when an admin approves them. They drop off after 30 days.

const KEY = "wall";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const MAX_POSTS = 150;

function fresh(list) {
  const cutoff = Date.now() - MAX_AGE;
  return list.filter(p => p && p.createdAt >= cutoff);
}

export async function readWall(kv) {
  let list = [];
  try { list = JSON.parse((await kv.get(KEY)) || "[]"); } catch (_e) {}
  return Array.isArray(list) ? fresh(list) : [];
}

export async function readWallWithCounts(kv) {
  const list = await readWall(kv);
  const counts = await Promise.all(list.map(p => kv.get(`wall:count:${p.id}`)));
  return list
    .map((p, i) => {
      const { notifyId, ...pub } = p; // never send device ids to other students
      return { ...pub, prayed: Number(counts[i]) || 0 };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function findWallPost(kv, id) {
  return (await readWall(kv)).find(p => p.id === id) || null;
}

// Mark a wall request answered, with an optional update ("She got the job!")
export async function answerWallPost(kv, id, update) {
  const list = await readWall(kv);
  let found = false;
  const next = list.map(p => {
    if (p.id !== id) return p;
    found = true;
    return { ...p, answered: { update: String(update || "").trim().slice(0, 600), at: Date.now() } };
  });
  if (found) await kv.put(KEY, JSON.stringify(next));
  return found;
}

export async function addWallPost(kv, { name, text, praise, notifyId }) {
  const list = await readWall(kv);
  const post = {
    id: Math.random().toString(36).slice(2) + Date.now().toString(36),
    name: String(name || "Anonymous").trim().slice(0, 40) || "Anonymous",
    text: String(text || "").trim().slice(0, 600),
    createdAt: Date.now(),
  };
  if (praise === true) post.praise = true;                                  // a praise report, not a request
  if (typeof notifyId === "string" && /^[\w-]{10,40}$/.test(notifyId)) post.notifyId = notifyId; // the student's device, for "someone prayed"
  if (!post.text) return null;
  list.push(post);
  await kv.put(KEY, JSON.stringify(list.slice(-MAX_POSTS)));
  return post;
}

export async function removeWallPost(kv, id) {
  const list = await readWall(kv);
  await kv.put(KEY, JSON.stringify(list.filter(p => p.id !== id)));
  await kv.delete(`wall:count:${id}`);
}

export async function prayForPost(kv, id) {
  const list = await readWall(kv);
  if (!list.some(p => p.id === id)) return null;
  const n = (Number(await kv.get(`wall:count:${id}`)) || 0) + 1;
  await kv.put(`wall:count:${id}`, String(n), { expirationTtl: 40 * 24 * 60 * 60 });
  return n;
}
