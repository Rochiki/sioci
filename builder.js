// ============================================================
// builder.js — antarmuka SCORM Builder
//
// Model data proyek (disimpan di IndexedDB):
// {
//   id, title, description, version: '1.2'|'2004', passingScore,
//   settings: { autoplay, browserNarration },
//   slides: [
//     { id, type:'content', title, body, narration, image:{data:Blob,name,alt}|null, audio:{data:Blob,voice}|null },
//     { id, type:'quiz', title, intro, narration, audio, questions:[{text, options:[], correct, feedback}] }
//   ]
// }
// ============================================================
import { kv } from './store.js';
import { uid, formatBytes } from './util.js';
import { loadTemplate, buildPackage, validateProject } from './packager.js';
import { EdgeTTS, BrowserTTS, cleanForSpeech } from './tts.js';

const $ = (id) => document.getElementById(id);
const PROJECT_KEY = 'proyek-aktif';
const TTS_KEY = 'studio-scorm:tts';

let project = null;
let currentId = null;
const browserTTS = new BrowserTTS();

// ---------------------------------------------------------------- proyek
function blankProject() {
  return {
    id: uid('kursus'), title: 'Kursus baru', description: '', version: '1.2', passingScore: 80,
    settings: { autoplay: true, browserNarration: true },
    slides: [newContentSlide('Pengantar'), newQuizSlide()],
  };
}
function newContentSlide(title = 'Slide baru') {
  return { id: uid('s'), type: 'content', title, body: '', narration: '', image: null, audio: null };
}
function newQuizSlide() {
  return { id: uid('s'), type: 'quiz', title: 'Kuis', intro: '', narration: '', audio: null, questions: [newQuestion()] };
}
function newQuestion() { return { text: '', options: ['', '', '', ''], correct: 0, feedback: '' }; }
const current = () => project.slides.find((s) => s.id === currentId) || project.slides[0];

let saveTimer;
function save() {
  $('saveState').textContent = 'Menyimpan…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await kv.set(PROJECT_KEY, project); $('saveState').textContent = 'Tersimpan'; }
    catch (e) { $('saveState').textContent = 'Gagal menyimpan'; toast('Penyimpanan browser penuh. Ekspor proyek lalu hapus audio yang tidak dipakai.', true); }
  }, 500);
}

function toast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.setAttribute('role', isError ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), isError ? 8000 : 3000);
}

// ---------------------------------------------------------------- daftar slide
function renderList() {
  const ol = $('slideList');
  ol.innerHTML = '';
  project.slides.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'slide-item';
    b.setAttribute('aria-current', String(s.id === currentId));
    b.innerHTML = `<span class="num">${i + 1}</span><span><span class="title"></span><br><span class="kind">${s.type === 'quiz' ? `Kuis · ${s.questions.length} soal` : 'Materi'}</span></span>${s.audio ? '<span class="has-audio" title="Ada narasi MP3"></span>' : '<span></span>'}`;
    b.querySelector('.title').textContent = s.title || '(tanpa judul)';
    b.onclick = () => { currentId = s.id; browserTTS.stop(); renderList(); renderEditor(); };
    li.append(b);
    ol.append(li);
  });
}

// ---------------------------------------------------------------- editor
function field(label, input, hint = '') {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = uid('f');
  input.id = id;
  const l = document.createElement('label');
  l.htmlFor = id; l.textContent = label;
  wrap.append(l, input);
  if (hint) { const h = document.createElement('div'); h.className = 'hint'; h.innerHTML = hint; wrap.append(h); }
  return wrap;
}
function textInput(value, onInput, multiline = false, rows = 8) {
  const el = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) el.type = 'text'; else el.rows = rows;
  el.value = value || '';
  el.addEventListener('input', () => { onInput(el.value); save(); });
  return el;
}
function button(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label; b.className = cls; b.type = 'button';
  b.onclick = onClick;
  return b;
}

function renderEditor() {
  const s = current();
  if (!s) return;
  currentId = s.id;
  const ed = $('editor');
  ed.innerHTML = '';
  const idx = project.slides.indexOf(s);

  // Kepala editor: judul + aksi slide
  const head = document.createElement('div');
  head.className = 'editor-head';
  const h = document.createElement('h2');
  h.textContent = `${s.type === 'quiz' ? 'Kuis' : 'Materi'} — slide ${idx + 1}`;
  head.append(h,
    button('Naik', () => move(-1), 'btn-sm'),
    button('Turun', () => move(1), 'btn-sm'),
    button('Duplikat', duplicate, 'btn-sm'),
    button('Hapus', remove, 'btn-sm btn-danger'));
  head.children[1].disabled = idx === 0;
  head.children[2].disabled = idx === project.slides.length - 1;
  ed.append(head);

  ed.append(field('Judul slide', textInput(s.title, (v) => { s.title = v; renderList(); })));

  if (s.type === 'content') {
    ed.append(field('Isi materi', textInput(s.body, (v) => (s.body = v), true, 12),
      'Format sederhana: baris kosong = paragraf baru, <b>- </b> di awal baris = daftar poin, <b>1. </b> = daftar bernomor, <b>**tebal**</b>.'));
    ed.append(imageBox(s));
  } else {
    ed.append(field('Petunjuk kuis (opsional)', textInput(s.intro, (v) => (s.intro = v), true, 3)));
    s.questions.forEach((q, qi) => ed.append(questionBox(s, q, qi)));
    ed.append(button('+ Tambah soal', () => { s.questions.push(newQuestion()); save(); renderEditor(); renderList(); }));
  }
  ed.append(audioBox(s));
}

function imageBox(s) {
  const box = document.createElement('div');
  box.className = 'field';
  const lab = document.createElement('label'); lab.textContent = 'Gambar (opsional)';
  const drop = document.createElement('div'); drop.className = 'image-drop';
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml'; fileIn.hidden = true;
  fileIn.onchange = () => {
    const f = fileIn.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Gambar lebih dari 5 MB. Perkecil dulu agar paket SCORM ringan.', true); return; }
    s.image = { data: f, name: f.name, alt: s.image?.alt || '' };
    save(); renderEditor();
  };
  if (s.image?.data) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(s.image.data);
    img.alt = s.image.alt || '';
    drop.append(img);
    const alt = textInput(s.image.alt, (v) => (s.image.alt = v));
    alt.placeholder = 'Teks alternatif: jelaskan isi gambar untuk pembaca layar';
    drop.append(alt);
    const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '8px'; row.style.justifyContent = 'center';
    row.append(button('Ganti gambar', () => fileIn.click(), 'btn-sm'), button('Hapus gambar', () => { s.image = null; save(); renderEditor(); }, 'btn-sm btn-danger'));
    drop.append(row);
  } else {
    drop.append(button('Pilih gambar', () => fileIn.click()));
    const p = document.createElement('div'); p.className = 'hint'; p.textContent = 'PNG, JPG, WebP, GIF, atau SVG. Maks 5 MB.';
    drop.append(p);
  }
  box.append(lab, drop, fileIn);
  return box;
}

function questionBox(s, q, qi) {
  const box = document.createElement('fieldset');
  box.className = 'question';
  const lg = document.createElement('legend'); lg.textContent = `Soal ${qi + 1}`; lg.style.fontWeight = '700';
  box.append(lg);
  box.append(field('Pertanyaan', textInput(q.text, (v) => (q.text = v), true, 2)));
  const optLabel = document.createElement('label'); optLabel.textContent = 'Pilihan jawaban — tandai bulatan pada jawaban yang benar';
  box.append(optLabel);
  const group = uid('g');
  q.options.forEach((o, oi) => {
    const row = document.createElement('div'); row.className = 'option-row';
    const r = document.createElement('input'); r.type = 'radio'; r.name = group; r.checked = q.correct === oi;
    r.setAttribute('aria-label', `Jawaban benar: pilihan ${oi + 1}`);
    r.onchange = () => { q.correct = oi; save(); };
    const t = textInput(o, (v) => (q.options[oi] = v)); t.placeholder = `Pilihan ${String.fromCharCode(65 + oi)}`;
    const del = button('×', () => {
      if (q.options.length <= 2) { toast('Minimal 2 pilihan.', true); return; }
      q.options.splice(oi, 1);
      if (q.correct >= q.options.length) q.correct = 0; else if (q.correct > oi) q.correct--;
      save(); renderEditor();
    }, 'btn-ghost btn-sm');
    del.setAttribute('aria-label', `Hapus pilihan ${oi + 1}`);
    row.append(r, t, del);
    box.append(row);
  });
  const actions = document.createElement('div'); actions.className = 'row'; actions.style.margin = '6px 0 12px';
  const addOpt = button('+ Pilihan', () => { if (q.options.length >= 8) return; q.options.push(''); save(); renderEditor(); }, 'btn-sm');
  const delQ = button('Hapus soal', () => {
    if (s.questions.length <= 1) { toast('Kuis minimal punya 1 soal. Hapus slidenya bila tidak perlu.', true); return; }
    s.questions.splice(qi, 1); save(); renderEditor(); renderList();
  }, 'btn-sm btn-danger');
  actions.append(addOpt, delQ);
  box.append(actions);
  box.append(field('Umpan balik setelah dijawab (opsional)', textInput(q.feedback, (v) => (q.feedback = v))));
  return box;
}

/** Teks yang akan dibacakan untuk satu slide. */
function narrationFor(s) {
  if (s.narration?.trim()) return s.narration;
  if (s.type === 'quiz') return [s.title, s.intro, ...s.questions.map((q, i) => `Soal ${i + 1}. ${q.text}`)].filter(Boolean).join('.\n\n');
  return [s.title, s.body].filter(Boolean).join('.\n\n');
}

function audioBox(s) {
  const box = document.createElement('div');
  box.className = 'audio-box';
  const h = document.createElement('h3'); h.textContent = 'Narasi suara';
  box.append(h);
  const narr = textInput(s.narration, (v) => (s.narration = v), true, 4);
  narr.placeholder = 'Kosongkan untuk membacakan judul + isi slide. Isi bila ingin naskah narasi berbeda.';
  box.append(field('Naskah narasi (opsional)', narr, `Panjang naskah tidak dibatasi ketat — server memecah teks panjang otomatis (default maks 20.000 karakter per slide).`));

  const row = document.createElement('div'); row.className = 'row';
  const gen = button(s.audio ? 'Buat ulang suara' : 'Buat suara (MP3)', () => generateAudio(s, gen), 'btn-primary');
  const listen = button('Dengarkan cepat (suara browser)', () => {
    if (!browserTTS.stopped) { browserTTS.stop(); listen.textContent = 'Dengarkan cepat (suara browser)'; return; }
    BrowserTTS.voices('id').then((voices) => {
      try {
        browserTTS.speak(narrationFor(s), { voice: voices[0] || null, rate: 1 + (+$('ttsRate').value / 100), onEnd: () => (listen.textContent = 'Dengarkan cepat (suara browser)') });
        listen.textContent = 'Hentikan';
      } catch (e) { toast(e.message, true); }
    });
  });
  if (!BrowserTTS.supported) listen.disabled = true;
  const up = document.createElement('input'); up.type = 'file'; up.accept = 'audio/mpeg,.mp3'; up.hidden = true;
  up.onchange = () => {
    const f = up.files[0]; if (!f) return;
    s.audio = { data: f, voice: 'unggahan' }; save(); renderEditor(); renderList();
  };
  row.append(gen, listen, button('Unggah MP3 sendiri', () => up.click(), 'btn-sm'), up);
  box.append(row);

  if (s.audio?.data) {
    const a = document.createElement('audio'); a.controls = true; a.src = URL.createObjectURL(s.audio.data);
    const info = document.createElement('div'); info.className = 'row'; info.style.marginTop = '6px';
    const sm = document.createElement('small'); sm.className = 'muted grow';
    sm.textContent = `MP3 · ${formatBytes(s.audio.data.size)} · ${s.audio.voice || ''}`;
    info.append(sm, button('Hapus audio', () => { s.audio = null; save(); renderEditor(); renderList(); }, 'btn-sm btn-danger'));
    box.append(a, info);
  }
  return box;
}

// ---------------------------------------------------------------- TTS
function ttsSettings() {
  return { url: $('ttsUrl').value.trim() || 'http://localhost:8000', voice: $('ttsVoice').value, rate: +$('ttsRate').value, pitch: +$('ttsPitch').value };
}
function saveTtsSettings() { localStorage.setItem(TTS_KEY, JSON.stringify(ttsSettings())); }

async function generateAudio(s, btn) {
  const cfg = ttsSettings();
  const text = cleanForSpeech(narrationFor(s));
  if (!text) { toast('Slide ini belum punya teks untuk dibacakan.', true); return; }
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = `Membuat suara (${text.length.toLocaleString('id-ID')} karakter)…`; }
  try {
    const blob = await new EdgeTTS(cfg.url).synthesize(text, cfg);
    s.audio = { data: blob, voice: cfg.voice };
    save();
    if (s.id === currentId) renderEditor();
    renderList();
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = old; }
  }
}

async function checkServer() {
  const cfg = ttsSettings();
  const st = $('ttsStatus');
  st.textContent = 'Menghubungi server…';
  try {
    const tts = new EdgeTTS(cfg.url);
    const h = await tts.health();
    const voices = await tts.voices('id');
    const sel = $('ttsVoice');
    const keep = sel.value;
    sel.innerHTML = '';
    for (const v of voices) {
      const o = document.createElement('option');
      o.value = v.name;
      o.textContent = `${v.name.replace(/^[a-z]{2}-[A-Z]{2}-/, '').replace(/Neural$/, '')} — ${v.locale}, ${v.gender.toLowerCase()}${v.multilingual ? ', multibahasa' : ''}`;
      sel.append(o);
    }
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    st.innerHTML = `<span class="badge">Terhubung</span> ${voices.length} suara · maks ${h.max_chars.toLocaleString('id-ID')} karakter`;
    saveTtsSettings();
  } catch (e) {
    st.innerHTML = '';
    const b = document.createElement('span'); b.className = 'badge badge-bad'; b.textContent = 'Tidak terhubung';
    st.append(b, ' ', e.message);
  }
}

async function generateAll() {
  const targets = project.slides.filter((s) => cleanForSpeech(narrationFor(s)));
  if (!targets.length) return;
  if (project.slides.some((s) => s.audio) && !confirm('Slide yang sudah punya audio akan dibuat ulang. Lanjutkan?')) return;
  const prog = $('ttsAllProg'); const bar = prog.firstElementChild; const txt = $('ttsAllText');
  prog.hidden = false; $('ttsAll').disabled = true;
  let ok = 0;
  for (const [i, s] of targets.entries()) {
    txt.textContent = `Slide ${i + 1} dari ${targets.length}: ${s.title}`;
    if (await generateAudio(s)) ok++; else break;
    bar.style.width = `${((i + 1) / targets.length) * 100}%`;
  }
  txt.textContent = `${ok} dari ${targets.length} slide sudah bersuara.`;
  $('ttsAll').disabled = false;
  setTimeout(() => (prog.hidden = true), 1500);
}

// ---------------------------------------------------------------- aksi slide
function move(d) {
  const i = project.slides.indexOf(current());
  const j = i + d;
  if (j < 0 || j >= project.slides.length) return;
  [project.slides[i], project.slides[j]] = [project.slides[j], project.slides[i]];
  save(); renderList(); renderEditor();
}
function duplicate() {
  const s = current();
  const copy = structuredClone(s); // Blob gambar/audio ikut tersalin
  copy.id = uid('s');
  copy.title = `${s.title} (salinan)`;
  project.slides.splice(project.slides.indexOf(s) + 1, 0, copy);
  currentId = copy.id; save(); renderList(); renderEditor();
}
function remove() {
  if (project.slides.length <= 1) { toast('Kursus minimal punya 1 slide.', true); return; }
  if (!confirm('Hapus slide ini?')) return;
  const i = project.slides.indexOf(current());
  project.slides.splice(i, 1);
  currentId = project.slides[Math.max(0, i - 1)].id;
  save(); renderList(); renderEditor();
}

// ---------------------------------------------------------------- pengaturan kursus
function bindSettings() {
  $('cTitle').value = project.title;
  $('cDesc').value = project.description;
  $('cVersion').value = project.version;
  $('cPass').value = project.passingScore;
  $('cAutoplay').checked = !!project.settings.autoplay;
  $('cBrowserVoice').checked = project.settings.browserNarration !== false;
}
$('cTitle').oninput = (e) => { project.title = e.target.value; save(); };
$('cDesc').oninput = (e) => { project.description = e.target.value; save(); };
$('cVersion').onchange = (e) => { project.version = e.target.value; save(); };
$('cPass').oninput = (e) => { project.passingScore = Math.max(0, Math.min(100, +e.target.value || 0)); save(); };
$('cAutoplay').onchange = (e) => { project.settings.autoplay = e.target.checked; save(); };
$('cBrowserVoice').onchange = (e) => { project.settings.browserNarration = e.target.checked; save(); };

// ---------------------------------------------------------------- build & pratinjau
async function makeZip() {
  const problems = validateProject(project);
  if (problems.length) {
    toast(`Belum bisa dibuat:\n• ${problems.slice(0, 4).join('\n• ')}${problems.length > 4 ? `\n…dan ${problems.length - 4} lagi` : ''}`, true);
    return null;
  }
  const template = await loadTemplate();
  return buildPackage(project, { template });
}
$('btnBuild').onclick = async () => {
  const btn = $('btnBuild'); btn.disabled = true;
  try {
    const out = await makeZip();
    if (!out) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out.data);
    a.download = out.filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Paket ${out.filename} (${formatBytes(out.data.size)}) diunduh.`);
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
};
$('btnPreview').onclick = async () => {
  // Buka tab lebih dulu (sinkron) agar tidak diblokir pop-up blocker.
  const win = window.open('about:blank', '_blank');
  try {
    const out = await makeZip();
    if (!out) { win?.close(); return; }
    await kv.set('pratinjau-zip', out.data);
    if (win) win.location.href = 'player.html#pratinjau'; else location.href = 'player.html#pratinjau';
  } catch (e) { win?.close(); toast(e.message, true); }
};

// ---------------------------------------------------------------- ekspor / impor proyek (.json)
const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
const dataUrlToBlob = async (url) => (await fetch(url)).blob();

async function exportProject() {
  const copy = structuredClone({ ...project, slides: [] });
  for (const s of project.slides) {
    const c = { ...s, image: null, audio: null };
    if (s.image?.data) c.image = { ...s.image, data: await blobToDataUrl(s.image.data) };
    if (s.audio?.data) c.audio = { ...s.audio, data: await blobToDataUrl(s.audio.data) };
    copy.slides.push(structuredClone(c));
  }
  const blob = new Blob([JSON.stringify({ format: 'studio-scorm-proyek', formatVersion: 1, project: copy })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(project.title || 'proyek').replace(/[^\w-]+/g, '-').toLowerCase()}.studio-scorm.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importProjectData(json) {
  if (json?.format !== 'studio-scorm-proyek' || !json.project?.slides) throw new Error('File ini bukan proyek Studio SCORM.');
  const p = json.project;
  for (const s of p.slides) {
    if (typeof s.image?.data === 'string') s.image.data = await dataUrlToBlob(s.image.data);
    if (typeof s.audio?.data === 'string') s.audio.data = await dataUrlToBlob(s.audio.data);
    s.id ||= uid('s');
    if (s.type === 'quiz') s.questions = (s.questions || []).map((q) => ({ feedback: '', ...q }));
  }
  p.settings ||= { autoplay: true, browserNarration: true };
  project = p;
  currentId = p.slides[0]?.id;
  save(); bindSettings(); renderList(); renderEditor();
}

$('btnExport').onclick = () => exportProject().catch((e) => toast(e.message, true));
$('importInput').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  if (!confirm('Proyek yang sedang dibuka akan diganti. Sudah diekspor sebagai cadangan?')) return;
  try { await importProjectData(JSON.parse(await f.text())); toast('Proyek diimpor.'); } catch (err) { toast(err.message, true); }
};
$('btnNew').onclick = () => {
  if (!confirm('Mulai proyek baru? Proyek sekarang akan diganti (ekspor dulu bila perlu).')) return;
  project = blankProject(); currentId = project.slides[0].id;
  save(); bindSettings(); renderList(); renderEditor();
};
$('btnSample').onclick = async () => {
  if (!confirm('Muat contoh kursus "Pengenalan APD"? Proyek sekarang akan diganti.')) return;
  try { await importProjectData(await (await fetch('contoh-apd.json')).json()); toast('Contoh dimuat.'); } catch (e) { toast(e.message, true); }
};
$('addContent').onclick = () => { const s = newContentSlide(); project.slides.push(s); currentId = s.id; save(); renderList(); renderEditor(); };
$('addQuiz').onclick = () => { const s = newQuizSlide(); project.slides.push(s); currentId = s.id; save(); renderList(); renderEditor(); };

// TTS controls
$('ttsCheck').onclick = checkServer;
$('ttsAll').onclick = generateAll;
$('ttsRate').oninput = (e) => { $('ttsRateVal').textContent = `${e.target.value > 0 ? '+' : ''}${e.target.value}%`; saveTtsSettings(); };
$('ttsPitch').oninput = (e) => { $('ttsPitchVal').textContent = `${e.target.value > 0 ? '+' : ''}${e.target.value} Hz`; saveTtsSettings(); };
$('ttsVoice').onchange = saveTtsSettings;
$('ttsUrl').onchange = saveTtsSettings;

// ---------------------------------------------------------------- mulai
(async function init() {
  try {
    const cfg = JSON.parse(localStorage.getItem(TTS_KEY) || '{}');
    if (cfg.url) $('ttsUrl').value = cfg.url;
    if (cfg.voice) {
      if (![...$('ttsVoice').options].some((o) => o.value === cfg.voice)) $('ttsVoice').append(new Option(cfg.voice, cfg.voice));
      $('ttsVoice').value = cfg.voice;
    }
    if (cfg.rate != null) { $('ttsRate').value = cfg.rate; $('ttsRate').dispatchEvent(new Event('input')); }
    if (cfg.pitch != null) { $('ttsPitch').value = cfg.pitch; $('ttsPitch').dispatchEvent(new Event('input')); }
  } catch { /* abaikan */ }
  project = (await kv.get(PROJECT_KEY).catch(() => null)) || blankProject();
  currentId = project.slides[0]?.id;
  bindSettings(); renderList(); renderEditor();
  $('saveState').textContent = 'Tersimpan';
})();
