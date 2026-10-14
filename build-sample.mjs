// Membuat paket SCORM contoh dari contoh-apd.json lewat baris perintah.
// Berguna untuk tes otomatis & sebagai bukti bahwa packager bisa dipakai di Node.js.
//   npm run build:sample
import { readFile, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { buildPackage, TEMPLATE_FILES } from './packager.js';

const root = new URL('./', import.meta.url);
const template = Object.fromEntries(await Promise.all(
  TEMPLATE_FILES.map(async (f) => [f, await readFile(new URL(f, root), 'utf8')]),
));
const { project } = JSON.parse(await readFile(new URL('contoh-apd.json', root), 'utf8'));

for (const version of ['1.2', '2004']) {
  const out = await buildPackage({ ...project, version }, { template, JSZip, type: 'nodebuffer' });
  await writeFile(new URL(out.filename, root), out.data);
  console.log(`✔ ${out.filename}  (${out.files.length} file, ${(out.data.length / 1024).toFixed(1)} KB)`);
}
