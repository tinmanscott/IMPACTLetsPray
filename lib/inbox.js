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
  return next;
}
