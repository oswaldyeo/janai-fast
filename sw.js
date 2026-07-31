/* Fast — service worker.
 *
 * Cache-first app shell. The app has no backend and no remote assets, so once
 * the shell is cached the whole thing runs with the network switched off.
 * Bump CACHE whenever any shell file changes — old caches are dropped on
 * activate and the new worker takes over immediately.
 */
const CACHE = 'fast-v6';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // `cache: 'reload'` bypasses the HTTP cache. Without it addAll is free to
      // re-cache a stale index.html next to a fresh app.js and freeze that
      // mismatch into the new cache — markup missing the elements the script
      // expects, which is a shell that boots straight into a dead page.
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // Only our own caches. github.io puts every project on the account onto
      // one origin, and caches are origin-scoped — a blanket delete here would
      // wipe a sibling Pages PWA's offline shell out from under it.
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('fast-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the shell so a reload works offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const shell = await caches.match('./index.html', { ignoreSearch: true });
      if (!shell) return fetch(req);

      // This is a one-page app. Serving the shell at, say, /a/b/ would give it
      // a document base of /a/b/, so ./styles.css and ./app.js would resolve
      // into nothing and you'd get an unstyled, dead page. Redirect to the
      // scope root instead, where the relative paths line up.
      const root = new URL('./', self.registration.scope).pathname;
      if (url.pathname !== root && url.pathname !== root + 'index.html') {
        return Response.redirect(root, 302);
      }
      return shell;
    })());
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        // Cache same-origin successes so anything added later stays offline-safe.
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
