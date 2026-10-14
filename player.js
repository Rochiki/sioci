// ============================================================
// player.js — antarmuka SCORM Player
// ============================================================
import { ScormRuntime } from './scorm-runtime.js';
import { importPackage, openStoredPackage, removePackage, listLibrary, ensureServiceWorker, packageUrl } from './package-store.js';
import { kv } from './store.js';
import { formatBytes, formatDuration, parseScorm12Time, parseScorm2004Time } from './util.js';

const $ = (id) => document.getElementById(id);
const els = {
  file: $('fileInput'), drop: $('dropzone'), lib: $('library'), viewUpload: $('viewUpload'), viewPlayer: $('viewPlayer'),
  title: $('courseTitle'), version: $('courseVersion'), toc: $('toc'), frame: $('frame'), overlay: $('overlay'),
  log: $('log'), prev: $('btnPrev'), next: $('btnNext'), close: $('btnClose'), reset: $('btnReset'),
  progressBox: $('importProgress'), progressBar: document.querySelector('#importProgress .progress > div'), progressText: $('importText'),
  learner: $('learnerName'),
};

let pkg = null;        // paket aktif {id, manifest, ...}
let current = -1;      // indeks SCO aktif
let runtime = null;    // ScormRuntime aktif
const LEARNER_KEY = 'studio-scorm:nama-peserta';

// ---------------------------------------------------------------- util UI
function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), isError ? 7000 : 3000);
}
const progressKey = (scoId) => `studio-scorm:progres:${pkg.id}:${scoId}`;
const loadProgress = (scoId) => { try { return JSON.parse(localStorage.getItem(progressKey(scoId))); } catch { return null; } };
const saveProgress = (scoId, snap) => { try { localStorage.setItem(progressKey(scoId), JSON.stringify(snap)); } catch { toast('Penyimpanan browser penuh — progres tidak tersimpan.', true); } };

const STATUS_ID = {
  'not attempted': 'Belum dimulai', unknown: 'Belum diketahui', incomplete: 'Sedang berjalan', completed: 'Selesai',
  passed: 'Lulus', failed: 'Belum lulus', browsed: 'Dilihat',
};

// ---------------------------------------------------------------- pustaka
function renderLibrary() {
  const list = listLibrary();
  if (!list.length) { els.lib.innerHTML = ''; return; }
  els.lib.innerHTML = '<h2>Paket yang pernah dibuka</h2><ul></ul>';
  const ul = els.lib.querySelector('ul');
  for (const p of list) {
    const li = document.createElement('li');
    li.innerHTML = `<div class="grow"><b></b><small></small></div>
      <button class="btn-primary btn-sm" data-act="open">Buka</button>
      <button class="btn-ghost btn-sm btn-danger" data-act="del" aria-label="Hapus paket">Hapus</button>`;
    li.querySelector('b').textContent = p.title;
    li.querySelector('small').textContent = `SCORM ${p.version} · ${p.fileCount} file · ${formatBytes(p.size || 0)}`;
    li.querySelector('[data-act=open]').onclick = () => openPackage(() => openStoredPackage(p.id));
    li.querySelector('[data-act=del]').onclick = async () => {
      if (!confirm(`Hapus "${p.title}" beserta progresnya dari browser ini?`)) return;
      await removePackage(p.id); renderLibrary(); toast('Paket dihapus.');
    };
    ul.append(li);
  }
}

// ---------------------------------------------------------------- impor
async function handleFile(file) {
  if (!file) return;
  if (!/\.zip$/i.test(file.name)) { toast('Pilih file berekstensi .zip.', true); return; }
  els.progressBox.hidden = false;
  await openPackage(() => importPackage(file, {
    name: file.name,
    onProgress: (d, t) => { els.progressBar.style.width = `${(d / t) * 100}%`; els.progressText.textContent = `Mengekstrak ${d} dari ${t} file…`; },
  }));
  els.progressBox.hidden = true;
}

async function openPackage(loader) {
  try {
    await ensureServiceWorker();
    pkg = await loader();
  } catch (err) {
    console.error(err);
    toast(err.message || String(err), true);
    els.progressBox.hidden = true;
    return;
  }
  els.title.textContent = pkg.title;
  els.version.textContent = `SCORM ${pkg.manifest.version === '2004' ? '2004' : '1.2'}`;
  document.title = `${pkg.title} — Studio SCORM`;
  els.viewUpload.hidden = true;
  els.viewPlayer.hidden = false;
  els.close.hidden = false;
  els.log.textContent = '';
  renderToc();
  // Lanjutkan dari SCO terakhir yang dibuka (bila ada).
  const last = +localStorage.getItem(`studio-scorm:terakhir:${pkg.id}`) || 0;
  await launch(Math.min(last, pkg.manifest.scos.length - 1));
}

// ---------------------------------------------------------------- daftar isi
function renderToc() {
  els.toc.innerHTML = '';
  const build = (items, parent) => {
    for (const it of items) {
      if (!it.visible) continue;
      const li = document.createElement('li');
      if (it.href) {
        const idx = pkg.manifest.scos.indexOf(it);
        const b = document.createElement('button');
        b.dataset.idx = idx;
        const snap = loadProgress(it.id);
        b.innerHTML = `<span class="dot ${snap ? (snap.success !== 'unknown' ? snap.success : snap.status) : ''}"></span><span></span>`;
        b.lastChild.textContent = it.title;
        b.onclick = () => launch(idx);
        li.append(b);
      } else {
        const g = document.createElement('div');
        g.className = 'group'; g.textContent = it.title; li.append(g);
      }
      if (it.children.length) { const ul = document.createElement('ul'); build(it.children, ul); li.append(ul); }
      parent.append(li);
    }
  };
  build(pkg.manifest.items, els.toc);
  // Kursus satu SCO: daftar isi & tombol navigasi tidak perlu.
  const single = pkg.manifest.scos.length === 1;
  els.prev.parentElement.hidden = single;
}

function updateTocMarks() {
  els.toc.querySelectorAll('button[data-idx]').forEach((b) => {
    b.setAttribute('aria-current', String(+b.dataset.idx === current));
    const snap = loadProgress(pkg.manifest.scos[+b.dataset.idx].id);
    b.querySelector('.dot').className = 'dot ' + (snap ? (snap.success && snap.success !== 'unknown' ? snap.success : snap.status) : '');
  });
  els.prev.disabled = current <= 0;
  els.next.disabled = current >= pkg.manifest.scos.length - 1;
}

function showStats(snap) {
  if (!snap) { ['stStatus', 'stScore', 'stSuccess', 'stTime'].forEach((k) => ($(k).textContent = '–')); return; }
  $('stStatus').textContent = STATUS_ID[snap.status] || snap.status || '–';
  $('stScore').textContent = snap.score !== '' && snap.score != null ? snap.score : '–';
  $('stSuccess').textContent = snap.success && snap.success !== 'unknown' ? STATUS_ID[snap.success] : '–';
  const ms = snap.version === '2004' ? parseScorm2004Time(snap.totalTime) : parseScorm12Time(snap.totalTime);
  $('stTime').textContent = snap.totalTime ? formatDuration(ms) : '–';
}

// ---------------------------------------------------------------- peluncuran SCO
/** Kosongkan iframe dulu supaya SCO lama sempat memanggil LMSFinish/Terminate di event unload. */
function blankFrame() {
  return new Promise((resolve) => {
    if (!els.frame.src || els.frame.src === 'about:blank') return resolve();
    els.frame.addEventListener('load', () => resolve(), { once: true });
    els.frame.src = 'about:blank';
    setTimeout(resolve, 1500); // jaga-jaga
  });
}

async function launch(idx) {
  if (!pkg || idx < 0 || idx >= pkg.manifest.scos.length) return;
  await blankFrame();
  // SCO lama tidak menutup sesi? Tutup paksa agar data tersimpan.
  if (runtime && runtime.state === 'running') runtime.terminate('');

  current = idx;
  localStorage.setItem(`studio-scorm:terakhir:${pkg.id}`, String(idx));
  const sco = pkg.manifest.scos[idx];
  const v = pkg.manifest.version;
  const learnerName = els.learner.value.trim() || localStorage.getItem(LEARNER_KEY) || 'Peserta';

  runtime = new ScormRuntime({
    version: v,
    learner: { id: 'lokal-' + learnerName.toLowerCase().replace(/\W+/g, '-'), name: learnerName },
    saved: loadProgress(sco.id),
    context: {
      masteryScore: sco.masteryScore ?? '',
      scaledPassingScore: sco.scaledPassingScore ?? null,
      hasNext: idx < pkg.manifest.scos.length - 1,
      hasPrevious: idx > 0,
    },
    onCommit: (snap) => { saveProgress(sco.id, snap); showStats(snap); updateTocMarks(); },
    onLog: (e) => logLine(e),
    onChange: () => showStats(runtime.snapshot(false)),
    onTerminate: () => setTimeout(() => {
      // Kursus menutup sesi tapi iframe masih memuatnya -> tampilkan layar "selesai" hanya bila tidak ada navigasi.
      if (runtime?.state === 'terminated' && els.frame.src !== 'about:blank') els.overlay.hidden = false;
    }, 400),
    onNavRequest: (req) => handleNav(req),
  });

  // Pasang API di window ini — SCO di iframe akan menemukannya lewat window.parent.
  delete window.API; delete window.API_1484_11;
  if (v === '2004') window.API_1484_11 = runtime.api; else window.API = runtime.api;

  showStats(loadProgress(sco.id));
  els.overlay.hidden = true;
  updateTocMarks();
  const [path, query = ''] = sco.href.split(/\?(.*)/s);
  els.frame.src = packageUrl(pkg.id, path) + (query ? `?${query}` : '');
}

function handleNav(req) {
  els.overlay.hidden = true;
  if (req === 'continue') return launch(current + 1);
  if (req === 'previous') return launch(current - 1);
  const m = /^\{target=([^}]+)\}(choice|jump)$/.exec(req);
  if (m) {
    const idx = pkg.manifest.scos.findIndex((s) => s.id === m[1]);
    if (idx >= 0) return launch(idx);
  }
  if (/exit|suspendAll|abandon/.test(req)) {
    $('overlayTitle').textContent = 'Kursus ditutup';
    els.overlay.hidden = false;
  }
}

// ---------------------------------------------------------------- log debug
let logCount = 0;
function logLine(e) {
  const line = document.createElement('div');
  if (e.error && e.error !== 0) line.className = 'err';
  const t = e.time.toLocaleTimeString('id-ID');
  const args = e.args.map((a) => JSON.stringify(a)).join(', ');
  line.textContent = `${t}  ${e.fn}(${args}) → ${JSON.stringify(e.result)}${e.error ? `  [error ${e.error}: ${e.errorText}]` : ''}`;
  els.log.append(line);
  if (++logCount > 400) { els.log.firstChild.remove(); }
  els.log.scrollTop = els.log.scrollHeight;
}

// ---------------------------------------------------------------- tombol
els.prev.onclick = () => launch(current - 1);
els.next.onclick = () => launch(current + 1);
$('btnRelaunch').onclick = () => launch(current);
els.close.onclick = async () => {
  await blankFrame();
  if (runtime?.state === 'running') runtime.terminate('');
  runtime = null; pkg = null;
  els.viewPlayer.hidden = true; els.viewUpload.hidden = false; els.close.hidden = true;
  document.title = 'Player SCORM — Studio SCORM';
  renderLibrary();
};
els.reset.onclick = async () => {
  if (!confirm('Hapus semua progres (status, nilai, bookmark) kursus ini di browser ini?')) return;
  await blankFrame();
  runtime = null;
  for (const s of pkg.manifest.scos) localStorage.removeItem(progressKey(s.id));
  toast('Progres dihapus. Kursus dimulai dari awal.');
  launch(0);
};
els.file.onchange = () => { handleFile(els.file.files[0]); els.file.value = ''; };
els.learner.value = localStorage.getItem(LEARNER_KEY) || '';
els.learner.onchange = () => localStorage.setItem(LEARNER_KEY, els.learner.value.trim());

// Drag & drop
['dragenter', 'dragover'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.remove('drag'); }));
els.drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

// Simpan progres saat tab ditutup.
window.addEventListener('pagehide', () => { if (runtime?.state === 'running') runtime.commit(''); });

// ---------------------------------------------------------------- mulai
renderLibrary();
// Mode pratinjau dari Builder: player.html#pratinjau
if (location.hash === '#pratinjau') {
  kv.get('pratinjau-zip').then(async (blob) => {
    if (!blob) return;
    // Hapus pratinjau sebelumnya supaya pustaka tidak penuh salinan pratinjau.
    const oldId = localStorage.getItem('studio-scorm:pratinjau-id');
    if (oldId) await removePackage(oldId).catch(() => {});
    els.progressBox.hidden = false;
    await openPackage(async () => {
      const p = await importPackage(blob, { name: 'pratinjau.zip' });
      localStorage.setItem('studio-scorm:pratinjau-id', p.id);
      return p;
    });
    els.progressBox.hidden = true;
  });
}
