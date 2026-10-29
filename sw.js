// Bump CACHE_NAME (for example jarvis-v3) whenever you change app files,
// otherwise phones keep showing the old cached version.
const CACHE_NAME = 'jarvis-v4';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './providers.js',
  './brain.js',
  './storage.js',
  './tasks.js',
  './voice.js',
  './avatar.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Only cache our own files. Cross-origin AI API calls go straight to the network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).catch(() => caches.match('./index.html'))
    )
  );

});
