import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { buildPackage, validateProject, TEMPLATE_FILES } from './packager.js';
import { parseManifest } from './manifest.js';

const root = new URL('./', import.meta.url);
const template = Object.fromEntries(await Promise.all(TEMPLATE_FILES.map(async (f) => [f, await readFile(new URL(f, root), 'utf8')])));
const { project } = JSON.parse(await readFile(new URL('contoh-apd.json', root), 'utf8'));

test('validasi menangkap proyek yang belum lengkap', () => {
  const p = structuredClone(project);
  p.title = '';
  p.slides[3].questions[0].options = ['Satu', '', '', ''];
  const problems = validateProject(p);
  assert.ok(problems.some((x) => /Judul kursus/.test(x)));
  assert.ok(problems.some((x) => /minimal 2 pilihan/.test(x)));
  assert.equal(validateProject(project).length, 0);
});

for (const version of ['1.2', '2004']) {
  test(`paket SCORM ${version} berisi file lengkap & manifest valid`, async () => {
    const p = structuredClone(project);
    p.version = version;
    // Tambahkan gambar & audio tiruan (Uint8Array) untuk menguji folder media/.
    p.slides[0].image = { data: new Uint8Array([137, 80, 78, 71]), name: 'Foto Helm.PNG', alt: 'Helm' };
    p.slides[0].audio = { data: new Uint8Array([73, 68, 51]), voice: 'id-ID-GadisNeural' };
    p.slides[3].questions[0].options = ['Pertama', '', 'Terakhir', 'Tidak termasuk hierarki'];
    p.slides[3].questions[0].correct = 2;
    const out = await buildPackage(p, { template, JSZip, type: 'nodebuffer' });
    const zip = await JSZip.loadAsync(out.data);
    for (const f of ['imsmanifest.xml', 'index.html', 'assets/course.js', 'assets/course-data.js', 'assets/scorm-api.js', 'assets/course.css', 'media/slide-01.png', 'media/narasi-01.mp3']) {
      assert.ok(zip.file(f), `ada ${f}`);
    }
    const m = parseManifest(await zip.file('imsmanifest.xml').async('string'), DOMParser);
    assert.equal(m.version, version);
    assert.equal(m.title, project.title);
    const listed = (await zip.file('imsmanifest.xml').async('string')).match(/<file href="[^"]+"/g).length;
    assert.equal(listed, out.files.length - 1, 'semua file (kecuali manifest) terdaftar di manifest');

    // Data kursus: pilihan kosong dibuang & kunci jawaban ikut bergeser.
    const dataJs = await zip.file('assets/course-data.js').async('string');
    const data = JSON.parse(dataJs.slice(dataJs.indexOf('{'), dataJs.lastIndexOf('}') + 1));
    const q = data.slides[3].questions[0];
    assert.deepEqual(q.options, ['Pertama', 'Terakhir', 'Tidak termasuk hierarki']);
    assert.equal(q.options[q.correct], 'Terakhir');
    assert.equal(data.passingScore, 80);
    assert.match(await zip.file('index.html').async('string'), /<title>Pengenalan Alat Pelindung Diri \(APD\)<\/title>/);
  });
}
