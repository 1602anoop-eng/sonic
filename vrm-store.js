// Saves the user's own VRM model file in this phone's browser (IndexedDB).
// The model is never uploaded to GitHub or to any server.

const DB_NAME = 'jarvis-vrm';
const STORE = 'models';
const KEY = 'current';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(mode, action) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = action(tx.objectStore(STORE));
    tx.oncomplete = () => { db.close(); resolve(req?.result ?? null); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  }));
}

export function saveModel(blob) {
  return run('readwrite', (store) => store.put(blob, KEY));
}

export function loadModel() {
  return run('readonly', (store) => store.get(KEY));
}

export function deleteModel() {
  return run('readwrite', (store) => store.delete(KEY));
}
