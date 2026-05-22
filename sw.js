const CACHE_NAME = "cooperativas-v2";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css",
  "https://unpkg.com/leaflet/dist/leaflet.css",
  "https://unpkg.com/leaflet/dist/leaflet.js"
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  const method = event.request.method;

  // ── 1. Peticiones POST (envíos de formulario) → siempre red, sin interceptar
  if (method !== "GET") return;

  // ── 2. Google APIs (login, scripts) → siempre red, sin interceptar
  if (url.hostname.includes("google") ||
      url.hostname.includes("googleapis") ||
      url.hostname.includes("gstatic") ||
      url.hostname.includes("accounts.google")) {
    return;
  }

  // ── 3. API propia → network-first, sin fallback JSON
  if (url.hostname.includes("onrender.com")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // Si falla silenciosamente devolvemos array vacío para /cooperativas
        // y "OK" para /registrar-operador, así el formulario no explota
        if (url.pathname.includes("/cooperativas")) {
          return new Response("[]", { headers: { "Content-Type": "application/json" } });
        }
        return new Response("OK", { status: 200 });
      })
    );
    return;
  }

  // ── 4. Tiles del mapa → cache-first, guarda on-the-fly
  if (url.hostname.includes("tile") ||
      url.hostname.includes("arcgisonline") ||
      url.hostname.includes("cartocdn") ||
      url.pathname.includes("/vt/lyrs")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
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

  // ── 5. Todo lo demás (HTML, CSS, JS, fonts) → cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
        }
        return res;
      }).catch(() => {
        // Si es navegación y no hay cache, devolver index.html cacheado
        if (event.request.mode === "navigate") {
          return caches.match("/index.html") || caches.match("/");
        }
      });
    })
  );
});

// ── BACKGROUND SYNC ────────────────────────────────────────
self.addEventListener("sync", event => {
  if (event.tag === "sync-cooperativas") {
    event.waitUntil(enviarPendientes());
  }
});

async function enviarPendientes() {
  const db = await abrirDB();
  const pendientes = await obtenerTodos(db);
  for (const item of pendientes) {
    try {
      const formData = new FormData();
      Object.entries(item.data).forEach(([k, v]) => formData.append(k, v));
      const res = await fetch(item.url, { method: "POST", body: formData });
      if (res.ok) await eliminar(db, item.id);
    } catch (e) { /* reintenta en el próximo sync */ }
  }
}

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("coopOfflineDB", 1);
    req.onupgradeneeded = e =>
      e.target.result.createObjectStore("pendientes", { keyPath: "id", autoIncrement: true });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function obtenerTodos(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction("pendientes", "readonly").objectStore("pendientes").getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function eliminar(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pendientes", "readwrite");
    tx.objectStore("pendientes").delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}
