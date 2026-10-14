// ============================================================
// packager.js — MERAKIT file .zip SCORM dari proyek Builder
//
// Isi paket yang dihasilkan:
//   imsmanifest.xml            <- daftar isi untuk LMS (manifest.js)
//   index.html                 <- halaman yang dibuka LMS
//   assets/course.css          <- tampilan kursus
//   assets/scorm-api.js        <- jembatan ke LMS (1.2 & 2004)
//   assets/course.js           <- mesin slide, kuis, narasi
//   assets/course-data.js      <- ISI kursus Anda (judul, slide, soal)
//   media/...                  <- gambar & MP3 narasi
// ============================================================
import { buildManifest } from './manifest.js';
import { escapeXml, slugify } from './util.js';

// Nama file template di repo (struktur datar). index.html paket disimpan sebagai paket-index.html
// supaya tidak bentrok dengan index.html beranda aplikasi.
export const TEMPLATE_FILES = ['paket-index.html', 'course.css', 'scorm-api.js', 'course.js'];

/** Ambil file template dari root aplikasi (di browser). */
export async function loadTemplate(base = './') {
  const out = {};
  for (const name of TEMPLATE_FILES) {
    const res = await fetch(base + name, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Template ${name} tidak ditemukan (${res.status}).`);
    out[name] = await res.text();
  }
  return out;
}

/** Cek kelengkapan proyek. Mengembalikan daftar masalah (kosong = siap build). */
export function validateProject(p) {
  const problems = [];
  if (!p.title?.trim()) problems.push('Judul kursus masih kosong.');
  if (!p.slides?.length) problems.push('Belum ada slide.');
  p.slides?.forEach((s, i) => {
    const where = `Slide ${i + 1}${s.title ? ` "${s.title}"` : ''}`;
    if (!s.title?.trim()) problems.push(`${where}: judul kosong.`);
    if (s.type === 'quiz') {
      if (!s.questions?.length) problems.push(`${where}: kuis belum punya soal.`);
      s.questions?.forEach((q, qi) => {
        if (!q.text?.trim()) problems.push(`${where}, soal ${qi + 1}: pertanyaan kosong.`);
        const filled = q.options.filter((o) => o.trim()).length;
        if (filled < 2) problems.push(`${where}, soal ${qi + 1}: minimal 2 pilihan jawaban.`);
        if (!(q.correct >= 0 && q.correct < q.options.length) || !q.options[q.correct]?.trim()) {
          problems.push(`${where}, soal ${qi + 1}: pilih kunci jawaban yang benar.`);
        }
      });
    }
  });
  return problems;
}

const extOf = (name = '', mime = '') => {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName) return fromName === 'jpeg' ? 'jpg' : fromName;
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3' }[mime] || 'bin';
};

/**
 * Rakit paket SCORM.
 * @param {object} project proyek dari Builder
 * @param {object} opt
 * @param {Record<string,string>} opt.template isi file template (lihat loadTemplate)
 * @param {any} [opt.JSZip] konstruktor JSZip (default: global)
 * @param {'blob'|'uint8array'|'nodebuffer'} [opt.type] tipe output
 * @returns {Promise<{data:any, filename:string, files:string[]}>}
 */
export async function buildPackage(project, { template, JSZip = globalThis.JSZip, type = 'blob' } = {}) {
  const problems = validateProject(project);
  if (problems.length) throw Object.assign(new Error(problems.join('\n')), { problems });
  const zip = new JSZip();
  const version = project.version === '2004' ? '2004' : '1.2';
  const hasQuiz = project.slides.some((s) => s.type === 'quiz' && s.questions?.length);
  const pad = (n) => String(n).padStart(2, '0');

  // 1) Media: gambar & audio tiap slide -> folder media/
  const slides = [];
  for (const [i, s] of project.slides.entries()) {
    const out = { id: s.id, type: s.type, title: s.title.trim() };
    if (s.image?.data) {
      const path = `media/slide-${pad(i + 1)}.${extOf(s.image.name, s.image.data.type)}`;
      zip.file(path, s.image.data);
      out.image = path;
      out.imageAlt = s.image.alt || '';
    }
    if (s.audio?.data) {
      const path = `media/narasi-${pad(i + 1)}.mp3`;
      zip.file(path, s.audio.data);
      out.audio = path;
    }
    if (s.type === 'quiz') {
      out.intro = s.intro || '';
      out.questions = s.questions.map((q, qi) => {
        // Buang pilihan kosong tapi pertahankan kunci jawaban yang benar.
        const kept = q.options.map((o, oi) => ({ o: o.trim(), oi })).filter((x) => x.o);
        return {
          id: `${String(s.id).replace(/[^A-Za-z0-9_-]/g, '_')}_q${qi + 1}`,
          text: q.text.trim(),
          options: kept.map((x) => x.o),
          correct: kept.findIndex((x) => x.oi === q.correct),
          feedback: q.feedback?.trim() || '',
        };
      });
    } else {
      out.body = s.body || '';
    }
    slides.push(out);
  }

  // 2) Data kursus
  const data = {
    title: project.title.trim(),
    description: project.description || '',
    version,
    passingScore: hasQuiz ? Number(project.passingScore ?? 80) : null,
    settings: { autoplay: !!project.settings?.autoplay, browserNarration: project.settings?.browserNarration !== false },
    slides,
    builtWith: 'Studio SCORM',
    builtAt: new Date().toISOString(),
  };
  zip.file('assets/course-data.js', `/* Dibuat oleh Studio SCORM — isi kursus */\nwindow.COURSE_DATA = ${JSON.stringify(data, null, 1)};\n`);

  // 3) File template
  zip.file('index.html', template['paket-index.html'].replace(/<title>[^<]*<\/title>/, `<title>${escapeXml(data.title)}</title>`));
  zip.file('assets/course.css', template['course.css']);
  zip.file('assets/scorm-api.js', template['scorm-api.js']);
  zip.file('assets/course.js', template['course.js']);

  // 4) Manifest — dibuat terakhir supaya daftar file lengkap
  const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
  const identifier = `${slugify(data.title)}-${String(project.id || '').replace(/[^A-Za-z0-9]/g, '').slice(-6) || 'kursus'}`;
  zip.file('imsmanifest.xml', buildManifest({
    version, identifier, title: data.title, files, passingScore: hasQuiz ? data.passingScore : null,
  }));

  const filename = `${slugify(data.title)}-scorm${version === '2004' ? '2004' : '12'}.zip`;
  const out = await zip.generateAsync({ type, compression: 'DEFLATE', compressionOptions: { level: 6 }, mimeType: 'application/zip' });
  return { data: out, filename, files: [...files, 'imsmanifest.xml'].sort() };
}
