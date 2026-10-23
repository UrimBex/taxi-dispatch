// Makes the app installable and gives it a fallback when the network drops. This is a LIVE dispatch app, so the
// rule is: the network always wins when it's reachable (a deployed update shows up on the next load, never a stale
// cached script talking to a newer server), and the cache is only a fallback for the app's own static files.
// Never touched: the API, the live WebSocket, the admin console (sign-in gated), and anything cross-origin (map tiles).
'use strict';
const CACHE = 'taxi-ardi-shell-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add('/')).catch(() => { }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws') || url.pathname === '/admin.html') return;
  // every page navigation is the same single-page app, whatever the query string
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then(hit => hit || Response.error()))
  );
});
