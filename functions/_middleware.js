// impactbethere.app and impactletspray.app are served from this one project.
// On the Be There address, every page shows the Be There app (public/bethere/index.html);
// /api/* is shared, so both apps use the same sign-in codes and secure storage.
const BE_THERE_HOSTS = new Set(["impactbethere.app", "www.impactbethere.app"]);

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (BE_THERE_HOSTS.has(url.hostname.toLowerCase()) && !url.pathname.startsWith("/api/")) {
    if (url.hostname.toLowerCase().startsWith("www.")) return Response.redirect(`https://impactbethere.app${url.pathname}${url.search}`, 301);
    const page = await env.ASSETS.fetch(new Request(new URL("/bethere/", url), request));
    const res = new Response(page.body, page);
    res.headers.set("Cache-Control", "no-cache");
    return res;
  }
  return next();
}
