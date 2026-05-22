const CACHE_NAME = "cooperativas-v1";

// Recursos que se cachean al instalar
const ASSETS = [
  "/",
  "/index.html",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
  "https://unpkg.com/leaflet/dist/leaflet.css",
  "https://unpkg.com/leaflet/dist/leaflet.js",
  "https://accounts.google.com/gsi/client"
];

// ── INSTALL: cachear assets estáticos ──────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Intentamos cachear cada recurso individualmente
      // para que uno que falle no rompa toda la instalación
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE: limpiar caches viejos ────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estrategia según tipo de request ─────────────────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);

  // Las llamadas a la API siempre van a la red
  // Si fallan, devolvemos un error JSON claro
  if (url.hostname.includes("onrender.com") ||
      url.hostname.includes("clever-cloud.com")) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: "Sin conexión. Los datos se enviarán cuando vuelva la red." }),
          { headers: { "Content-Type": "application/json" } }
        )
      )
    );
    return;
  }

  // Tiles del mapa: cache-first (se guardan on-the-fly)
  if (url.hostname.includes("tile") ||
      url.hostname.includes("arcgisonline") ||
      url.hostname.includes("google.com/vt") ||
      url.hostname.includes("cartocdn")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Todo lo demás: network-first, fallback a cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && event.request.method === "GET") {
          const copia = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copia));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── SYNC: reenvío de formularios pendientes ─────────────────
self.addEventListener("sync", event => {
  if (event.tag === "sync-cooperativas") {
    event.waitUntil(enviarPendientes());
  }
});

async function enviarPendientes() {
  const db = await abrirDB();
  const pendientes = await obtenerPendientes(db);

  for (const item of pendientes) {
    try {
      const res = await fetch(item.url, {
        method: "POST",
        body: item.body,
      });
      if (res.ok) await eliminarPendiente(db, item.id);
    } catch (e) {
      // Sigue en cola para el próximo sync
    }
  }
}

// ── IndexedDB para cola offline ─────────────────────────────
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("coopOfflineDB", 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore("pendientes", {
        keyPath: "id", autoIncrement: true
      });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function obtenerPendientes(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readonly");
    const req = tx.objectStore("pendientes").getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function eliminarPendiente(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readwrite");
    tx.objectStore("pendientes").delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}
