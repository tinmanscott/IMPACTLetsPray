// Person photos, stored in the same KV namespace as the roster (no extra setup).
// GET    /api/photo?id=<personId>          → the JPEG
// POST   /api/photo  (form: photo, personId) → saves it
// DELETE /api/photo?id=<personId>          → removes it
//
// The app shrinks photos to ~500px before upload, so each one is ~30–60 KB.

const MAX_BYTES = 1024 * 1024; // 1 MB safety cap

// Access is checked in _middleware.js: leaders can view and add/change photos, only admins remove.
const cors = {};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function validId(id) {
  return typeof id === "string" && /^[a-z0-9_]{4,40}$/i.test(id);
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (!env.INTERCEDE_KV) return json({ error: "KV namespace not bound" }, 500);

  const url = new URL(request.url);

  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    const data = await env.INTERCEDE_KV.get(`photo:${id}`, { type: "arrayBuffer" });
    if (!data) return new Response("Not found", { status: 404, headers: cors });
    return new Response(data, {
      headers: {
        ...cors,
        "Content-Type": "image/jpeg",
        // URLs carry a ?v=<timestamp>, so a new upload gets a new URL
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  }

  if (request.method === "POST") {
    let form;
    try { form = await request.formData(); } catch (_e) { return json({ error: "Expected form data" }, 400); }
    const file = form.get("photo");
    const id = form.get("personId");
    if (!file || typeof file === "string" || !validId(id)) return json({ error: "Missing photo or personId" }, 400);
    if (file.type && !file.type.startsWith("image/")) return json({ error: "Not an image" }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ error: "Photo too large" }, 413);
    await env.INTERCEDE_KV.put(`photo:${id}`, buf);
    return json({ ok: true, v: Date.now() });
  }

  if (request.method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!validId(id)) return json({ error: "Bad id" }, 400);
    await env.INTERCEDE_KV.delete(`photo:${id}`);
    return json({ ok: true });
  }

  return json({ error: "Method not allowed" }, 405);
}
