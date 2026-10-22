// Service worker: shows daily prayer reminders and opens the app when tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Let’s Pray", {
    body: data.body || "Time to pray for your students 🙏",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "daily-prayer",
    renotify: true,
    data: { url: data.url || "/" },
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.focus(); return; }
    }
    await self.clients.openWindow(target);
  })());
});
