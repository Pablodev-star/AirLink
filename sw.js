/*
 * Service worker minimo.
 *
 * Solo cachea la carcasa de la app para que abra al instante y funcione
 * aunque el movil no tenga datos (la conexion con el PC es por WiFi local,
 * no necesita internet). NO cachea nada dinamico: no hay nada dinamico.
 */
const CACHE = 'airlink-v1';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // El WebSocket de senalizacion y cualquier peticion al PC no se tocan.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // Red primero, cache de respaldo: asi una actualizacion del repo llega sola.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html')))
  );
});
