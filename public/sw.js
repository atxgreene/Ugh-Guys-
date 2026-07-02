// Offline service worker. The game is fully client-side (procedural, no external
// assets), so once the built files are cached a match plays with no network at all —
// which is what makes the installed PWA feel like a native app.
//
// Strategy (no build-tool integration needed):
//   • Vite emits content-hashed files under assets/ — immutable, so cache-first.
//   • The shell (navigations, manifest, icons) is network-first with cache fallback:
//     online you always get the newest deploy, offline you get the last one.
//   • Cross-origin and non-GET requests (the relay WebSocket upgrades, API calls)
//     are never touched.
const CACHE = 'sotw-v1';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // immutable hashed build artifacts → cache-first
  if (url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  // app shell (navigations, manifest, icons) → network-first, cache fallback
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await caches.match('./', { ignoreSearch: true });
        if (shell) return shell;
      }
      throw new Error('offline and uncached: ' + url.pathname);
    }
  })());
});
