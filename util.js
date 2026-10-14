// ============================================================
// util.js — fungsi kecil yang dipakai banyak modul.
// Ditulis tanpa DOM supaya bisa dites di Node.js juga.
// ============================================================

/** Escape karakter khusus XML/HTML agar teks aman dimasukkan ke markup. */
export function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** ID pendek acak, contoh: "s_k3x9a2". Aman dipakai sebagai identifier XML. */
export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

/** Ubah judul bebas menjadi nama file/identifier aman: "Pengenalan APD!" -> "pengenalan-apd". */
export function slugify(text = '', fallback = 'kursus') {
  const s = String(text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || fallback;
}

/** Tabel MIME berdasarkan ekstensi — penting agar browser mau menjalankan JS/CSS dari paket SCORM. */
const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8', xsd: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm', vtt: 'text/vtt',
  pdf: 'application/pdf', swf: 'application/x-shockwave-flash',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
};
export function mimeFor(path = '') {
  const ext = path.split('?')[0].split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/**
 * Normalisasi path di dalam zip:
 * - ganti backslash (zip buatan Windows) jadi slash
 * - buang "./" dan selesaikan ".."
 * - tolak path yang keluar dari root paket (zip-slip)
 * Mengembalikan null bila path tidak aman.
 */
export function normalizeZipPath(path) {
  const parts = [];
  for (const seg of String(path).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Gabungkan base folder + href relatif dari manifest, lalu normalisasi. */
export function joinPath(base = '', href = '') {
  if (/^[a-z]+:\/\//i.test(href)) return href; // URL absolut (jarang, tapi diizinkan SCORM)
  const [pathPart, ...rest] = href.split(/(?=[?#])/);
  const joined = normalizeZipPath((base ? base.replace(/\/?$/, '/') : '') + pathPart);
  return joined === null ? null : joined + rest.join('');
}

/** Durasi (ms) -> format SCORM 1.2 "HHHH:MM:SS.SS". */
export function toScorm12Time(ms) {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = ((totalCs % 6000) / 100).toFixed(2);
  return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${s.padStart(5, '0')}`;
}

/** Durasi (ms) -> format SCORM 2004 ISO-8601 "PT1H2M3.45S". */
export function toScorm2004Time(ms) {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const h = Math.floor(totalCs / 360000);
  const m = Math.floor((totalCs % 360000) / 6000);
  const s = (totalCs % 6000) / 100;
  return `PT${h ? h + 'H' : ''}${m ? m + 'M' : ''}${s.toFixed(2).replace(/\.?0+$/, '') || 0}S`;
}

/** "0012:34:56.7" -> ms. Mengembalikan NaN bila format salah. */
export function parseScorm12Time(str) {
  const m = /^(\d{2,4}):(\d{2}):(\d{2})(\.\d{1,2})?$/.exec(String(str));
  if (!m) return NaN;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3] + (m[4] ? +m[4] : 0)) * 1000;
}

/** "P1DT2H3M4.5S" -> ms (mendukung Y/M/D/H/M/S; tahun=365 hari, bulan=30 hari). */
export function parseScorm2004Time(str) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,2})?)S)?)?$/.exec(String(str));
  if (!m || str === 'P' || /T$/.test(str)) return NaN;
  const [, y, mo, d, h, mi, s] = m.map((v) => (v === undefined ? 0 : v));
  return ((((+y * 365 + +mo * 30 + +d) * 24 + +h) * 60 + +mi) * 60 + +s) * 1000;
}

/** Format ukuran byte jadi teks: 1536 -> "1,5 KB" (koma desimal Indonesia). */
export function formatBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${u[i]}`;
}

/** ms -> teks ramah: "1 jam 4 mnt", "3 mnt 12 dtk", "8 dtk". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '–';
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  if (h) return `${h} jam ${m} mnt`;
  if (m) return `${m} mnt ${s} dtk`;
  return `${s} dtk`;
}
