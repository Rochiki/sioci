// ============================================================
// store.js — penyimpanan key-value sederhana di IndexedDB.
// Dipakai untuk menyimpan proyek Builder (termasuk gambar & audio
// berupa Blob) yang terlalu besar untuk localStorage (batas ~5 MB).
// ============================================================
const DB_NAME = 'studio-scorm';
const STORE = 'kv';
let dbPromise;

function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaksi IndexedDB dibatalkan (penyimpanan penuh?)'));
  });
}

export const kv = {
  get: (key) => run('readonly', (s) => s.get(key)),
  set: (key, value) => run('readwrite', (s) => s.put(value, key)),
  del: (key) => run('readwrite', (s) => s.delete(key)),
  keys: () => run('readonly', (s) => s.getAllKeys()),
};
