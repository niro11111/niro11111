// Offline support: the app shell is cached on install; fonts are cached as they load.
const VERSION = "__BUILD__";
const SHELL = `shell-${VERSION}`, FONTS = "fonts-v1";
const ASSETS = ["./", "index.html", "app.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("shell-") && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("message", e => { if (e.data === "skip-waiting") self.skipWaiting(); });
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // the backend (when the app runs on its own server) is always live, never cached
  if (/\/(api|verify)\//.test(url.pathname) || /\/(healthz|readyz)$/.test(url.pathname)) return;
  // the app page: network first so updates arrive quickly, cache when offline.
  // Only a successful response for the app itself replaces the cached copy (never a 404 or another page).
  if (e.request.mode === "navigate") {
    const isApp = /\/(index\.html)?$/.test(url.pathname);
    e.respondWith(fetch(e.request).then(r => { if (isApp && r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put("index.html", copy)); } return r; })
      .catch(() => caches.match("index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
});
