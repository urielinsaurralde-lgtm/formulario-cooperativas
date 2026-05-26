const APP_CACHE = "coop-app-v2";
const TILES_CACHE = "coop-tiles-v1";

// Archivos del app que se cachean al instalar
const APP_SHELL = [
  "/",
  "/index.html",
  "/panel.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
  "https://unpkg.com/leaflet/dist/leaflet.css",
  "https://unpkg.com/leaflet/dist/leaflet.js",
];

// Dominios de tiles de mapa que queremos cachear
const TILE_HOSTS = [
  "tile.openstreetmap.org",
  "server.arcgisonline.com",
  "basemaps.cartocdn.com",
  "mt1.google.com",
  "mt0.google.com",
  "mt2.google.com",
  "mt3.google.com",
  "openstreetmap.fr",
];

// Tile gris de fallback cuando no hay caché (PNG 256x256 gris)
const FALLBACK_TILE = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><rect width='256' height='256' fill='%23d1d5db'/><text x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236b7280' font-size='12' font-family='sans-serif'>Sin conexión</text></svg>`;

// ── INSTALL: cachear app shell ────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => {
      // Cacheamos de a uno para que un fallo no rompa todo
      return Promise.allSettled(
        APP_SHELL.map((url) => cache.add(url).catch(() => null))
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpiar cachés viejas ──────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_CACHE && k !== TILES_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estrategia según tipo de request ───────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ¿Es un tile de mapa?
  const esTile = TILE_HOSTS.some((host) => url.hostname.includes(host));

  if (esTile) {
    event.respondWith(cacheThenNetwork(event.request));
    return;
  }

  // Para el resto: network first, luego caché
  event.respondWith(networkThenCache(event.request));
});

// Cache-first para tiles: sirve desde caché, si no va a red y guarda
async function cacheThenNetwork(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(TILES_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Sin conexión y sin caché: devolver tile de fallback
    return new Response(
      `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>
        <rect width='256' height='256' fill='#e2e8f0'/>
        <text x='128' y='128' dominant-baseline='middle' text-anchor='middle'
          fill='#94a3b8' font-size='11' font-family='sans-serif'>offline</text>
      </svg>`,
      { headers: { "Content-Type": "image/svg+xml" } }
    );
  }
}

// Network-first para el app: intenta red, si falla usa caché
async function networkThenCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response("Sin conexión", { status: 503 });
  }
}
