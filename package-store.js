// ============================================================
// package-store.js — EKSTRAK paket SCORM .zip di browser
//
// Alur:
//   1. JSZip membaca file .zip di memori.
//   2. Cari imsmanifest.xml (di root, atau di dalam satu folder induk).
//   3. Setiap file disimpan ke Cache Storage dengan kunci khusus.
//   4. Service worker (sw.js) melayani URL  ./__pkg/<id>/<path>
//      dari cache tsb. -> link relatif di dalam konten (CSS, JS,
//      gambar, audio) berjalan normal seperti di web server biasa.
//
// Kenapa tidak pakai blob: URL? Karena blob URL tidak bisa
// memuat file relatif ("../css/style.css"), sehingga kebanyakan
// paket SCORM akan rusak tampilannya.
// ============================================================
import { parseManifest } from './manifest.js';
import { mimeFor, normalizeZipPath, uid } from './util.js';

export const CACHE_NAME = 'studio-scorm-paket-v1';
const LIB_KEY = 'studio-scorm:pustaka';

// Batas pengaman terhadap "zip bomb" (zip kecil yang mengembang sangat besar).
export const LIMITS = { maxFiles: 10000, maxTotalBytes: 1024 * 1024 * 1024 /* 1 GB */ };

/** Basis URL aplikasi, mis. https://nama.github.io/studio-scorm/ */
export const appBase = () => new URL('./', location.href).href;
/** URL publik file dalam paket (yang dibuka iframe). */
export const packageUrl = (pkgId, path = '') => `${appBase()}__pkg/${pkgId}/${path.split('/').map(encodeURIComponent).join('/')}`;
/** Kunci internal di Cache Storage (path di-encode utuh -> konsisten untuk spasi, +, dsb). */
export const cacheKey = (pkgId, path) => `${appBase()}__key__/${pkgId}/${encodeURIComponent(path)}`;

/**
 * Ekstrak & daftarkan paket.
 * @param {Blob} zipBlob
 * @param {{name?:string, onProgress?:(done:number,total:number)=>void, JSZip?:any}} opt
 * @returns {Promise<{id:string, manifest:object, title:string, version:string, fileCount:number, size:number}>}
 */
export async function importPackage(zipBlob, { name = 'paket.zip', onProgress = () => {}, JSZip = globalThis.JSZip } = {}) {
  if (!JSZip) throw new Error('Library JSZip belum dimuat.');
  if (!('caches' in globalThis)) throw new Error('Browser ini tidak mendukung Cache Storage. Buka aplikasi lewat http://localhost atau https://.');

  let zip;
  try { zip = await JSZip.loadAsync(zipBlob); } catch { throw new Error('File bukan .zip yang valid atau rusak.'); }

  const entries = Object.values(zip.files).filter((f) => !f.dir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/i.test(f.name));
  if (entries.length > LIMITS.maxFiles) throw new Error(`Paket berisi ${entries.length} file — melebihi batas ${LIMITS.maxFiles}.`);

  // Cari imsmanifest.xml — boleh di root atau tepat satu folder di bawahnya.
  const manifestEntry = entries
    .filter((f) => /(^|\/)imsmanifest\.xml$/i.test(f.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0];
  if (!manifestEntry) throw new Error('imsmanifest.xml tidak ditemukan. Ini bukan paket SCORM (atau file .zip berisi .zip lain).');
  const rootPrefix = manifestEntry.name.slice(0, manifestEntry.name.length - 'imsmanifest.xml'.length);
  if (rootPrefix.split('/').length > 2) throw new Error('imsmanifest.xml terlalu dalam di struktur folder. Zip ulang dari folder yang berisi manifest.');

  const manifest = parseManifest(await manifestEntry.async('string'));
  const id = uid('pkg');
  const cache = await caches.open(CACHE_NAME);
  const index = {}; // path huruf kecil -> path asli (untuk paket buatan Windows yang tidak konsisten huruf besar/kecil)

  let total = 0;
  let done = 0;
  try {
    for (const entry of entries) {
      if (!entry.name.startsWith(rootPrefix)) continue;
      const path = normalizeZipPath(entry.name.slice(rootPrefix.length));
      if (!path) continue; // path berbahaya (../) diabaikan
      const blob = await entry.async('blob');
      total += blob.size;
      if (total > LIMITS.maxTotalBytes) throw new Error('Ukuran hasil ekstrak melebihi 1 GB — dihentikan demi keamanan.');
      await cache.put(cacheKey(id, path), new Response(blob, {
        headers: { 'Content-Type': mimeFor(path), 'Content-Length': String(blob.size) },
      }));
      index[path.toLowerCase()] = path;
      onProgress(++done, entries.length);
    }
    await cache.put(cacheKey(id, '__index.json'), new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }));
  } catch (err) {
    await removePackage(id);
    throw err;
  }

  const info = { id, name, title: manifest.title, version: manifest.version, fileCount: done, size: total, addedAt: new Date().toISOString() };
  const lib = listLibrary().filter((p) => p.id !== id);
  lib.unshift(info);
  saveLibrary(lib);
  return { ...info, manifest };
}

/** Ambil ulang manifest paket yang sudah tersimpan (tanpa upload ulang). */
export async function openStoredPackage(id) {
  const cache = await caches.open(CACHE_NAME);
  const index = await (await cache.match(cacheKey(id, '__index.json')))?.json();
  if (!index) throw new Error('Paket sudah tidak ada di penyimpanan browser. Unggah ulang file .zip-nya.');
  const realPath = index['imsmanifest.xml'];
  const res = await cache.match(cacheKey(id, realPath));
  const manifest = parseManifest(await res.text());
  const info = listLibrary().find((p) => p.id === id) || { id, title: manifest.title, version: manifest.version };
  return { ...info, manifest };
}

/** Hapus semua file paket dari cache + dari daftar pustaka + progres. */
export async function removePackage(id) {
  const cache = await caches.open(CACHE_NAME);
  const prefix = `${appBase()}__key__/${id}/`;
  for (const req of await cache.keys()) if (req.url.startsWith(prefix)) await cache.delete(req);
  saveLibrary(listLibrary().filter((p) => p.id !== id));
  for (const k of Object.keys(localStorage)) if (k.startsWith(`studio-scorm:progres:${id}:`)) localStorage.removeItem(k);
}

export function listLibrary() {
  try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch { return []; }
}
function saveLibrary(list) {
  try { localStorage.setItem(LIB_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* penyimpanan penuh: abaikan */ }
}

/** Daftarkan service worker & tunggu sampai aktif. */
export async function ensureServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service worker tidak tersedia. Buka aplikasi lewat http://localhost (bukan file://) atau lewat https:// (mis. GitHub Pages).');
  }
  const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
  if (reg.active) return reg;
  const sw = reg.installing || reg.waiting;
  await new Promise((resolve) => {
    if (!sw) return resolve();
    sw.addEventListener('statechange', () => sw.state === 'activated' && resolve());
  });
  return reg;
}
