const CACHE_NAME = 'warmindo-dipo-v1';
// Pastikan semua file ini ada di folder proyekmu!
const urlsToCache = [
  '/',
  '/index.html',
  '/kasir.html',
  '/owner.html',
  '/history.html',
  '/css/style.css',
  '/js/config.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Menggunakan map agar jika satu file gagal, yang lain tetap tersimpan
        return Promise.allSettled(
          urlsToCache.map(url => {
            return cache.add(url).catch(err => console.warn(`Gagal menyimpan cache: ${url}`, err));
          })
        );
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request).catch(() => {
            // Optional: Berikan fallback jika offline total
        });
      })
  );
});