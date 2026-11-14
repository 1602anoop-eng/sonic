// Network first: always get the latest files when online, fall back to the cached copy when offline.
// Cross-origin requests (Groq API) are never handled here.
const CACHE = 'sonic-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(e.request, res.clone());
      }
      return res;
    } catch {
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});
