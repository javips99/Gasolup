/**
 * sw.js — Service Worker de GasoLup
 * Estrategia: cache-first para assets estáticos, network-only para APIs.
 */

const CACHE_NAME = 'gasolup-v24';

const ASSETS_ESTATICOS = [
    './index.html',
    './manifest.json',
    './icon-pwa.svg',
    './css/styles.css',
    './js/utils.js',
    './js/api.js',
    './js/map.js',
    './js/ui.js',
    './js/app.js',
    './con_nombre_transparente.png',
    './solo_icono-transparente.png',
    './favicon.svg',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// APIs que NUNCA se cachean (datos en tiempo real)
const URLS_EXCLUIDAS = [
    'minetur.gob.es',
    'ipapi.co',
    'nominatim.openstreetmap.org',
];

// ── Instalación: precarga el caché con los assets estáticos ──────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS_ESTATICOS))
            .then(() => self.skipWaiting())
    );
});

// ── Activación: elimina cachés de versiones anteriores ───────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ── Fetch: cache-first para estáticos, red para APIs ────────────────────────
self.addEventListener('fetch', event => {
    const url = event.request.url;

    // Excluir APIs de tiempo real → siempre desde red
    if (URLS_EXCLUIDAS.some(dominio => url.includes(dominio))) return;

    event.respondWith(
        caches.match(event.request)
            .then(cached => cached || fetch(event.request))
    );
});
