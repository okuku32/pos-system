// Kapu service worker: makes the site installable and fast, and works on a weak connection.
//  - App code (/assets/…, hashed names): cache first — it never changes once built.
//  - Pages: network first, falling back to the last copy, or to the offline page.
//  - Photos (/uploads/…): served from the cache, refreshed in the background.
//  - The API (/api/…), log-ins, payments and anything personal: NEVER cached, always from the network.
const VERSION = 'kapu-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const PHOTOS = `${VERSION}-photos`;
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((result) => result.addAll([OFFLINE, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((item) => caches.delete(item)))).then(() => self.clients.claim())
  );
});

// keep the photo cache small
async function trim(name, max) {
  const value = await caches.open(name);
  const keys = await value.keys();
  for (let index = 0; index < keys.length - max; index++) await value.delete(keys[index]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google Maps…: the browser handles them
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return; // personal & live data: never cached

  // built app code and our fonts (versioned names): cache first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(
      caches.open(ASSETS).then(async (result) => {
        const hit = await result.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) result.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // ad photos: cached copy right away, refreshed in the background
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      caches.open(PHOTOS).then(async (result) => {
        const hit = await result.match(req);
        const fresh = fetch(req).then((res) => {
          if (res.ok) result.put(req, res.clone()).then(() => trim(PHOTOS, 300));
          return res;
        }).catch(() => hit);
        return hit || fresh;
      })
    );
    return;
  }

  // pages: the network first (always the latest), the last copy or the offline page when there's no connection
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !/^\/(admin|staff|checkout|orders|sales|account|market\/messages|market\/my)/.test(url.pathname)) {
            const copy = res.clone();
            caches.open(SHELL).then((result) => result.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/')) || caches.match(OFFLINE))
    );
  }
});

// the page can ask a new version to take over at once ("Update now")
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
