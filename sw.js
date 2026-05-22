const CACHE_NAME = "cooperativas-v7";

const ASSETS = [
  "/",
  "/index.html",
  "/panel.html",
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

    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
  );
});

// ======================
// ACTIVATE
// ======================

self.addEventListener("activate", event => {

  event.waitUntil(

    caches.keys().then(keys => {

      return Promise.all(

        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      );
    })
  );

  self.clients.claim();
});

// ======================
// FETCH
// ======================

self.addEventListener("fetch", event => {

  const url = new URL(event.request.url);

  // ======================
  // CACHE MAP TILES
  // ======================

  if (url.hostname.includes("tile.openstreetmap.org")) {

    event.respondWith(

      caches.open("map-tiles")

        .then(cache => {

          return cache.match(event.request)

            .then(response => {

              const fetchPromise = fetch(event.request)

                .then(networkResponse => {

                  cache.put(event.request, networkResponse.clone());

                  return networkResponse;
                })

                .catch(() => response);

              return response || fetchPromise;
            });
        })
    );

    return;
  }

  // ======================
  // CACHE FIRST
  // ======================

  event.respondWith(

    caches.match(event.request)

      .then(response => {

        return response ||

          fetch(event.request)

            .then(networkResponse => {

              return caches.open(CACHE_NAME)

                .then(cache => {

                  cache.put(event.request, networkResponse.clone());

                  return networkResponse;
                });
            })

            .catch(() => {

              // fallback navegación offline
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

// ======================
// SINCRONIZAR PENDIENTES
// ======================

async function syncPendientes() {

  const db = await abrirDB();

  const pendientes = await obtenerPendientes(db);

  for (const item of pendientes) {

    try {

      const formData = new FormData();

      Object.keys(item.data).forEach(key => {

        formData.append(key, item.data[key]);
      });

      await fetch(item.url, {
        method: "POST",
        body: formData
      });

      await eliminarPendiente(db, item.id);

      console.log("✅ Pendiente sincronizado");

    } catch (e) {

      console.log("📴 Sigue offline");
    }
  }
}

// ======================
// ABRIR DB
// ======================

function abrirDB() {

  return new Promise((resolve, reject) => {

    const request = indexedDB.open("cooperativasDB", 1);

    request.onupgradeneeded = e => {

      const db = e.target.result;

      if (!db.objectStoreNames.contains("pendientes")) {

        db.createObjectStore("pendientes", {
          keyPath: "id",
          autoIncrement: true
        });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}

// ======================
// OBTENER PENDIENTES
// ======================

function obtenerPendientes(db) {

  return new Promise((resolve, reject) => {

    const tx = db.transaction("pendientes", "readonly");

    const store = tx.objectStore("pendientes");

    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}

// ======================
// ELIMINAR PENDIENTE
// ======================

function eliminarPendiente(db, id) {

  return new Promise((resolve, reject) => {

    const tx = db.transaction("pendientes", "readwrite");

    tx.objectStore("pendientes").delete(id);

    tx.oncomplete = resolve;

    tx.onerror = reject;
  });
}
