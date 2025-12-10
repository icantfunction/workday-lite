const SW_VERSION = 'daylight-sw-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/main.js',
  './js/api.js',
  './js/storage.js',
  './js/resumeParser.js',
  './vendor/pdf.min.js',
  './vendor/pdf.worker.min.js',
  './vendor/jszip.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SW_VERSION).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== SW_VERSION).map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // stale-while-revalidate
        fetch(request).then((response) => {
          caches.open(SW_VERSION).then((cache) => cache.put(request, response.clone()));
        });
        return cached;
      }

      return fetch(request)
        .then((response) => {
          const respClone = response.clone();
          caches.open(SW_VERSION).then((cache) => cache.put(request, respClone));
          return response;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
    })
  );
});
