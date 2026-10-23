// Series artwork (one image, shown on the series card for leaders, students and parents).
// GET  /api/art            → the JPEG          (anyone signed in)
// POST /api/art  (form: art) → replace it        (admin)
// DELETE /api/art          → remove it         (admin)
// Access is checked in _middleware.js. The page shrinks the image before upload.
const MAX_BYTES = 1024 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.INTERCEDE_KV;

  if (request.method === "GET") {
    const data = await kv.get("series-art", { type: "arrayBuffer" });
    if (!data) return new Response("Not found", { status: 404 });
    return new Response(data, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" } });
  }
  if (request.method === "POST") {
    let form;
    try { form = await request.formData(); } catch (_e) { return json({ error: "Expected form data" }, 400); }
    const file = form.get("art");
    if (!file || typeof file === "string") return json({ error: "Missing image" }, 400);
    if (file.type && !file.type.startsWith("image/")) return json({ error: "Not an image" }, 400);
    const buf = await file.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return json({ error: "Image too large" }, 413);
    await kv.put("series-art", buf);
    return json({ ok: true, v: Date.now() });
  }
  if (request.method === "DELETE") {
    await kv.delete("series-art");
    return json({ ok: true });
  }
  return json({ error: "Method not allowed" }, 405);
}
