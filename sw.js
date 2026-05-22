const CACHE_NAME = "cooperativas-v5";

    try {

      const formData = new FormData();

      Object.keys(item.data).forEach(key => {
        formData.append(key, item.data[key]);
      });

      await fetch(item.url, {
        method: 'POST',
        body: formData
      });

      await eliminarPendiente(db, item.id);

    } catch (e) {
      console.log('Sigue offline');
    }
  }
}

function abrirDB() {

  return new Promise((resolve, reject) => {

    const request = indexedDB.open("cooperativasDB", 1);

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}

function obtenerPendientes(db) {

  return new Promise((resolve, reject) => {

    const tx = db.transaction("pendientes", "readonly");

    const store = tx.objectStore("pendientes");

    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);

    request.onerror = () => reject(request.error);
  });
}

function eliminarPendiente(db, id) {

  return new Promise((resolve, reject) => {

    const tx = db.transaction("pendientes", "readwrite");

    tx.objectStore("pendientes").delete(id);

    tx.oncomplete = resolve;

    tx.onerror = reject;
  });
}
