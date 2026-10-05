// Offline cache: the app works with no network.
const NAME = 'navigator-v1';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'src/app.js', 'src/grid.js', 'src/planner.js', 'src/profile.js', 'src/guidance.js', 'src/voice.js', 'src/session.js', 'src/store.js', 'src/demo-room.js'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(NAME).then((c) => c.addAll(FILES))));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== NAME).map((k) => caches.delete(k))))));
self.addEventListener('fetch', (e) => e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request))));
