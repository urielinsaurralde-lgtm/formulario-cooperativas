const CACHE_NAME = "cooperativas-v8";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",

  // Leaflet local
  "/assets/leaflet/leaflet.css",
  "/assets/leaflet/leaflet.js",

  // FontAwesome local
  "/assets/fontawesome/css/all.min.css"
];

// ======================
// INSTALL
// ======================
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll con catch individual para que un fallo no rompa todo
      Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
});

// ======================
// ACTIVATE
// ======================
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== "map-tiles").map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ======================
// FETCH
// ======================
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const method = event.request.method;

  // POST y otros métodos no-GET: nunca interceptar
  if (method !== "GET") return;

  // Google APIs: siempre red
  if (url.hostname.includes("google") ||
      url.hostname.includes("googleapis") ||
      url.hostname.includes("gstatic") ||
      url.hostname.includes("accounts.google")) {
    return;
  }

  // API propia: network-first, sin cache
  if (url.hostname.includes("api-cooperativas")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        if (url.pathname.includes("/cooperativas")) {
          return new Response("[]", { headers: { "Content-Type": "application/json" } });
        }
        return new Response("OK", { status: 200 });
      })
    );
    return;
  }

  // Tiles del mapa: cache-first, guarda on-the-fly
  if (url.hostname.includes("tile") ||
      url.hostname.includes("arcgisonline") ||
      url.hostname.includes("cartocdn") ||
      url.pathname.includes("/vt/lyrs")) {
    event.respondWith(
      caches.open("map-tiles").then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(res => {
            if (res && res.status === 200) cache.put(event.request, res.clone());
            return res;
          }).catch(() => new Response("", { status: 503 }));
        })
      )
    );
    return;
  }

  // Todo lo demás: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => {
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// ======================
// BACKGROUND SYNC
// ======================
self.addEventListener("sync", event => {
  if (event.tag === "sync-cooperativas") {
    event.waitUntil(syncPendientes());
  }
});

async function syncPendientes() {
  const db = await abrirDB();
  const pendientes = await obtenerPendientes(db);

  for (const item of pendientes) {
    try {
      const fd = new FormData();
      Object.entries(item.data).forEach(([k, v]) => fd.append(k, v));
      const res = await fetch(item.url, { method: "POST", body: fd });
      if (res.ok) await eliminarPendiente(db, item.id);
    } catch (e) {
      console.log("📴 Sigue offline, reintentará después");
    }
  }
}

// ======================
// IndexedDB — mismo nombre que index.html: "coopOfflineDB"
// ======================
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("coopOfflineDB", 1);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore("pendientes", { keyPath: "id", autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function obtenerPendientes(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction("pendientes", "readonly").objectStore("pendientes").getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function eliminarPendiente(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readwrite");
    tx.objectStore("pendientes").delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = reject;
  });
}
