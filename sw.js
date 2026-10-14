// ============================================================
// sw.js — Service Worker untuk SCORM Player
//
// Tugasnya cuma satu: kalau browser meminta URL
//      <app>/__pkg/<idPaket>/<path/file>
// jawab dengan file dari Cache Storage (hasil ekstrak .zip).
// Semua URL lain dibiarkan lewat seperti biasa.
//
// File ini HARUS berada di folder root aplikasi (sejajar
// player.html) supaya scope-nya mencakup /__pkg/.
// ============================================================
const CACHE_NAME = 'studio-scorm-paket-v1';
const BASE = new URL('./', self.location.href).href;
const PKG_PREFIX = `${BASE}__pkg/`;
const keyFor = (pkgId, path) => `${BASE}__key__/${pkgId}/${encodeURIComponent(path)}`;
const indexMemo = new Map(); // pkgId -> {lowercasePath: realPath}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = event.request.url.split('#')[0].split('?')[0];
  if (!url.startsWith(PKG_PREFIX) || event.request.method !== 'GET') return; // bukan urusan kita
  event.respondWith(servePackageFile(event.request, url.slice(PKG_PREFIX.length)));
});

async function servePackageFile(request, rest) {
  const slash = rest.indexOf('/');
  const pkgId = slash === -1 ? rest : rest.slice(0, slash);
  let path = slash === -1 ? '' : rest.slice(slash + 1);
  try { path = decodeURIComponent(path); } catch { /* biarkan apa adanya */ }
  if (path === '' || path.endsWith('/')) path += 'index.html';

  const cache = await caches.open(CACHE_NAME);
  let res = await cache.match(keyFor(pkgId, path));

  // Fallback: beda huruf besar/kecil (paket buatan Windows sering begini).
  if (!res) {
    if (!indexMemo.has(pkgId)) {
      const idx = await cache.match(keyFor(pkgId, '__index.json'));
      indexMemo.set(pkgId, idx ? await idx.json() : {});
    }
    const real = indexMemo.get(pkgId)[path.toLowerCase()];
    if (real) res = await cache.match(keyFor(pkgId, real));
  }

  if (!res) {
    return new Response(`File tidak ditemukan di dalam paket SCORM: ${path}`, {
      status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // Dukungan "Range" — dibutuhkan Safari/iOS untuk memutar audio & video.
  const range = request.headers.get('Range');
  if (range) {
    const blob = await res.blob();
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      let start = m[1] === '' ? blob.size - +m[2] : +m[1];
      let end = m[1] !== '' && m[2] !== '' ? +m[2] : blob.size - 1;
      start = Math.max(0, start); end = Math.min(end, blob.size - 1);
      if (start <= end) {
        return new Response(blob.slice(start, end + 1), {
          status: 206,
          headers: {
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Range': `bytes ${start}-${end}/${blob.size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }
  }
  return res;
}
