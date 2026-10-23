// Staff-only family requests and parent follow-ups, kept in KV under "family_staff".
// Only admins can read these (checked in _middleware.js); they never go to leaders' phones.
const KEY = "family_staff";

export async function readFamily(kv) {
  try { const l = JSON.parse((await kv.get(KEY)) || "[]"); return Array.isArray(l) ? l : []; } catch (_e) { return []; }
}

export async function writeFamily(kv, list) {
  await kv.put(KEY, JSON.stringify(list.slice(0, 300)));
}
