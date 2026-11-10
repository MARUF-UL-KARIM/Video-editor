// Offcut service worker — makes the editor itself available offline.
// Only same-origin GET requests are touched; nothing here ever sees your media.
const CACHE = 'offcut-shell-v1';
const HEAVY = /^\/(assets|ort|mediapipe|sample)\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      let shell = ['/', '/favicon.svg', '/manifest.webmanifest'];
      try {
        const list = await (await fetch('/precache.json', { cache: 'no-store' })).json();
        if (Array.isArray(list.shell)) shell = list.shell;
      } catch {
        /* fall back to the minimal shell */
      }
      // best effort: one failed file must not block installation
      await Promise.all(shell.map((u) => cache.add(u).catch(() => undefined)));
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('offcut-shell-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.headers.has('range')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put('/', res.clone());
          return res;
        } catch {
          return (await cache.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit && HEAVY.test(url.pathname)) return hit; // immutable / large: cache first
      const network = fetch(req)
        .then((res) => {
          if (res.ok && res.status === 200) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(network);
        return hit; // stale-while-revalidate
      }
      return (await network) || Response.error();
    })(),
  );
});
