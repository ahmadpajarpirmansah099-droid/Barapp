// Service worker minimal: hanya agar aplikasi bisa di-install.
// Tidak menyimpan cache, supaya data dan versi aplikasi selalu terbaru.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
