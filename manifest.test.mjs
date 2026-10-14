import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { buildManifest, parseManifest } from './manifest.js';
import { normalizeZipPath, joinPath, toScorm12Time, toScorm2004Time, parseScorm12Time, parseScorm2004Time } from './util.js';

const files = ['index.html', 'assets/course.js', 'media/foto 1.png'];

for (const version of ['1.2', '2004']) {
  test(`manifest SCORM ${version}: dibuat lalu dibaca ulang`, () => {
    const xml = buildManifest({ version, identifier: 'kursus k3', title: 'APD & "K3" <dasar>', files, passingScore: 80 });
    const m = parseManifest(xml, DOMParser);
    assert.equal(m.version, version);
    assert.equal(m.title, 'APD & "K3" <dasar>');
    assert.equal(m.scos.length, 1);
    assert.equal(m.scos[0].href, 'index.html');
    assert.equal(m.scos[0].scormType, 'sco');
    if (version === '1.2') assert.equal(m.scos[0].masteryScore, '80');
    else assert.equal(m.scos[0].scaledPassingScore, '0.80');
    assert.match(xml, /<file href="media\/foto 1.png"\/>/);
    assert.doesNotMatch(xml, /identifier="kursus k3"/, 'spasi di identifier harus dibersihkan');
  });
}

test('manifest tanpa kuis tidak menulis masteryscore', () => {
  const xml = buildManifest({ version: '1.2', identifier: 'x', title: 'T', files, passingScore: null });
  assert.doesNotMatch(xml, /masteryscore/);
});

test('parse manifest multi-SCO pihak ketiga dengan xml:base & parameters', () => {
  const xml = `<?xml version="1.0"?>
  <manifest identifier="m" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
    <metadata><schema>ADL SCORM</schema><schemaversion>2004 3rd Edition</schemaversion></metadata>
    <organizations default="o2">
      <organization identifier="o1"><title>Salah</title></organization>
      <organization identifier="o2"><title>Kursus Multi</title>
        <item identifier="bab1"><title>Bab 1</title>
          <item identifier="i1" identifierref="r1" parameters="?hal=1"><title>Pelajaran 1</title></item>
          <item identifier="i2" identifierref="r1" parameters="hal=2"><title>Pelajaran 2</title></item>
        </item>
        <item identifier="i3" identifierref="r2" isvisible="false"><title>Tersembunyi</title></item>
      </organization>
    </organizations>
    <resources xml:base="konten/">
      <resource identifier="r1" type="webcontent" adlcp:scormType="sco" xml:base="bab1/" href="mulai.html"/>
      <resource identifier="r2" type="webcontent" adlcp:scormType="asset" href="../lampiran.pdf"/>
    </resources>
  </manifest>`;
  const m = parseManifest(xml, DOMParser);
  assert.equal(m.version, '2004');
  assert.equal(m.title, 'Kursus Multi');
  assert.deepEqual(m.scos.map((s) => s.href), ['konten/bab1/mulai.html?hal=1', 'konten/bab1/mulai.html?hal=2', 'lampiran.pdf']);
  assert.equal(m.items[0].href, null, 'item induk tanpa resource = grup');
  assert.equal(m.items[1].visible, false);
});

test('manifest rusak memberi pesan jelas', () => {
  assert.throws(() => parseManifest('<bukan>', DOMParser), /rusak|bukan manifest/);
});

test('path zip: normalisasi & tolak zip-slip', () => {
  assert.equal(normalizeZipPath('a\\b\\.\\c.png'), 'a/b/c.png');
  assert.equal(normalizeZipPath('a/../b.js'), 'b.js');
  assert.equal(normalizeZipPath('../../etc/passwd'), null);
  assert.equal(joinPath('konten/', '../x.html?y=1'), 'x.html?y=1');
});

test('format waktu SCORM bolak-balik', () => {
  const ms = (1 * 3600 + 2 * 60 + 3.45) * 1000;
  assert.equal(toScorm12Time(ms), '0001:02:03.45');
  assert.equal(toScorm2004Time(ms), 'PT1H2M3.45S');
  assert.equal(parseScorm12Time('0001:02:03.45'), ms);
  assert.equal(parseScorm2004Time('PT1H2M3.45S'), ms);
  assert.equal(parseScorm2004Time('P1DT0S'), 86400000);
  assert.ok(Number.isNaN(parseScorm2004Time('PT')));
  assert.equal(toScorm2004Time(0), 'PT0S');
});

test('identifier diawali angka diberi awalan agar valid xs:ID', () => {
  const xml = buildManifest({ version: '1.2', identifier: '2026-k3', title: 'T', files });
  assert.match(xml, /<manifest identifier="K_2026-k3"/);
});
