// impactletspray.app, impactbethere.app and livinghopestudents.com are all served from this one project.
// On the Be There address, every page shows the Be There app (public/bethere/index.html).
// On livinghopestudents.com, every page shows the public welcome page (public/welcome/index.html).
// /api/* is shared, so they all use the same sign-in codes and secure storage.
const BE_THERE_HOSTS = new Set(["impactbethere.app", "www.impactbethere.app"]);
const WELCOME_HOSTS = new Set(["livinghopestudents.com", "www.livinghopestudents.com"]);

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
  if (WELCOME_HOSTS.has(url.hostname.toLowerCase()) && !url.pathname.startsWith("/api/")) {
    if (url.hostname.toLowerCase().startsWith("www.")) return Response.redirect(`https://livinghopestudents.com${url.pathname}${url.search}`, 301);
    // The app's own pages live at impactletspray.app (so sign-ins and Home Screen icons stay in one place)
    if (/^\/(students|parents|leaders|admin)(\/|$)/i.test(url.pathname)) return Response.redirect(`https://impactletspray.app${url.pathname}${url.search}`, 302);
    // Pictures and icons are shared with Let's Pray; every other address shows the welcome page
    if (/\.(png|jpe?g|svg|ico|webp)$/i.test(url.pathname)) return next();
    const page = await env.ASSETS.fetch(new Request(new URL("/welcome/", url), request));
    const res = new Response(page.body, page);
    res.headers.set("Cache-Control", "no-cache");
    return res;
  }
  return next();
}
