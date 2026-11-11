// Offline app shell: every file the app needs is cached on first visit, then served from the device.
const CACHE = 'lyrics-studio-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './assets/icon.svg',
  './js/main.js', './js/util.js', './js/db.js', './js/store.js', './js/lyrics.js', './js/backgrounds.js', './js/lyricfx.js',
  './js/render.js', './js/templates.js', './js/media.js', './js/player.js', './js/timeline.js', './js/panels.js', './js/exporter.js',
  './vendor/mediabunny.min.mjs',
  './fonts/inter-latin-400-normal.woff2', './fonts/inter-latin-600-normal.woff2', './fonts/poppins-latin-600-normal.woff2',
  './fonts/poppins-latin-800-normal.woff2', './fonts/anton-latin-400-normal.woff2', './fonts/bebas-neue-latin-400-normal.woff2',
  './fonts/space-grotesk-latin-500-normal.woff2', './fonts/space-grotesk-latin-700-normal.woff2',
  './fonts/playfair-display-latin-700-normal.woff2', './fonts/pacifico-latin-400-normal.woff2',
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Network first when online (so updates arrive), cache when offline.
  e.respondWith(fetch(req).then(res => {
    if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html'))));
});
