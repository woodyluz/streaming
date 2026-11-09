// Streamfinder Service Worker: App offline verfügbar, Poster zwischenspeichern, Push-Mitteilungen
const SHELL = "sf-shell-v5", IMGS = "sf-img-v1", META = "sf-meta";
const FILES = ["./", "./config.js","./css/app.css","./icon-192.png","./icon-512.png","./icon.svg","./index.html","./js/a11y.js","./js/api.js","./js/cache.js","./js/calendar.js","./js/cards.js","./js/constants.js","./js/data.js","./js/importers.js","./js/main.js","./js/merge.js","./js/picker.js","./js/recommend.js","./js/router.js","./js/state.js","./js/stats.js","./js/sync.js","./js/util.js","./js/views/calendar.js","./js/views/detail.js","./js/views/discover.js","./js/views/foryou.js","./js/views/importer.js","./js/views/lists.js","./js/views/news.js","./js/views/settings.js","./js/views/stats.js","./manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => ![SHELL, IMGS, META].includes(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
async function trim(cache, max) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.hostname === "image.tmdb.org") {
    e.respondWith(caches.open(IMGS).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok || r.type === "opaque") { c.put(e.request, r.clone()); trim(c, 500); }
      return r;
    }));
    return;
  }
  // Eigene Dateien: zuerst Netz (damit Updates sofort ankommen), sonst Zwischenspeicher. API-Wege nie zwischenspeichern.
  if (u.origin === location.origin && !/^\/(3|sa|api|omdb|batch)\//.test(u.pathname) && u.pathname !== "/omdb" && !u.pathname.endsWith("/__meta")) {
    e.respondWith(fetch(e.request)
      .then(r => { if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); } return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
  }
});

// Push: Die Nachricht selbst ist leer. Den Inhalt holt der Service Worker beim Worker ab.
async function readMeta() {
  const c = await caches.open(META), r = await c.match("./__meta");
  return r ? r.json() : {};
}
async function writeMeta(m) {
  const c = await caches.open(META);
  await c.put("./__meta", new Response(JSON.stringify(m)));
}
async function handlePush() {
  let shown = 0;
  try {
    const m = await readMeta();
    if (m.proxy && m.sync) {
      const r = await fetch(m.proxy.replace(/\/+$/, "") + "/api/inbox?after=" + (m.last || 0), { headers: { Authorization: "Bearer " + m.sync } });
      const list = r.ok ? await r.json() : [];
      for (const n of list.slice(-3)) {
        await self.registration.showNotification(n.title, { body: n.body, icon: "icon-192.png", badge: "icon-192.png", tag: "sf-" + n.id, data: { url: n.url } });
        shown++;
      }
      if (list.length > 3) await self.registration.showNotification("Streamfinder", { body: `Und ${list.length - 3} weitere Neuigkeiten`, icon: "icon-192.png", tag: "sf-more", data: { url: "./#listen" } });
      if (list.length) { m.last = Math.max(...list.map(n => n.t)); await writeMeta(m); }
    }
  } catch (err) {}
  if (!shown) await self.registration.showNotification("Streamfinder", { body: "Es gibt Neuigkeiten zu deinen Listen und Serien.", icon: "icon-192.png", data: { url: "./#listen" } });
}
self.addEventListener("push", e => e.waitUntil(handlePush()));
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "./#listen", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
