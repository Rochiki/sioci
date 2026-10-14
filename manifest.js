// ============================================================
// manifest.js — MEMBUAT dan MEMBACA imsmanifest.xml
//
// imsmanifest.xml adalah "daftar isi" paket SCORM. LMS membacanya
// untuk tahu: versi SCORM, judul kursus, struktur materi (item),
// dan file mana yang harus dibuka (resource href).
// ============================================================
import { escapeXml, joinPath } from './util.js';

// ------------------------------------------------------------
// 1) MEMBUAT MANIFEST (dipakai SCORM Builder)
// ------------------------------------------------------------

/**
 * @param {object} opt
 * @param {'1.2'|'2004'} opt.version   versi SCORM tujuan
 * @param {string} opt.identifier      ID unik kursus (huruf, angka, -, _)
 * @param {string} opt.title           judul kursus
 * @param {string} [opt.launch]        file yang dibuka LMS (default index.html)
 * @param {string[]} opt.files         semua file di dalam paket (path relatif)
 * @param {number|null} [opt.passingScore] nilai lulus 0-100; null bila tanpa kuis
 * @returns {string} isi imsmanifest.xml
 */
export function buildManifest({ version, identifier, title, launch = 'index.html', files, passingScore = null }) {
  if (version !== '1.2' && version !== '2004') throw new Error(`Versi SCORM tidak dikenal: ${version}`);
  // Identifier bertipe xs:ID: tanpa spasi & harus diawali huruf/underscore.
  let id = String(identifier).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = `K_${id}`;
  const t = escapeXml(title || 'Kursus tanpa judul');
  const fileTags = [...new Set(files)]
    .filter((f) => f !== 'imsmanifest.xml')
    .sort()
    .map((f) => `        <file href="${escapeXml(f)}"/>`)
    .join('\n');
  const hasScore = typeof passingScore === 'number' && passingScore >= 0 && passingScore <= 100;

  if (version === '1.2') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-${id}">
    <organization identifier="ORG-${id}">
      <title>${t}</title>
      <item identifier="ITEM-${id}" identifierref="RES-${id}" isvisible="true">
        <title>${t}</title>${hasScore ? `\n        <adlcp:masteryscore>${Math.round(passingScore)}</adlcp:masteryscore>` : ''}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-${id}" type="webcontent" adlcp:scormtype="sco" href="${escapeXml(launch)}">
${fileTags}
    </resource>
  </resources>
</manifest>
`;
  }

  // SCORM 2004 4th Edition
  const seq = hasScore
    ? `
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="PRIMARYOBJ" satisfiedByMeasure="true">
              <imsss:minNormalizedMeasure>${(passingScore / 100).toFixed(2)}</imsss:minNormalizedMeasure>
            </imsss:primaryObjective>
          </imsss:objectives>
        </imsss:sequencing>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-${id}">
    <organization identifier="ORG-${id}">
      <title>${t}</title>
      <item identifier="ITEM-${id}" identifierref="RES-${id}" isvisible="true">
        <title>${t}</title>${seq}
      </item>
      <imsss:sequencing>
        <imsss:controlMode choice="true" flow="true"/>
      </imsss:sequencing>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-${id}" type="webcontent" adlcp:scormType="sco" href="${escapeXml(launch)}">
${fileTags}
    </resource>
  </resources>
</manifest>
`;
}

// ------------------------------------------------------------
// 2) MEMBACA MANIFEST (dipakai SCORM Player)
// ------------------------------------------------------------

// Ambil elemen anak langsung berdasarkan nama lokal (abaikan prefix namespace).
const kids = (el, name) => [...(el?.childNodes || [])].filter((c) => c.nodeType === 1 && c.localName === name);
const kid = (el, name) => kids(el, name)[0] || null;
const text = (el) => (el ? el.textContent.trim() : '');
const xmlBase = (el) => el?.getAttributeNS?.('http://www.w3.org/XML/1998/namespace', 'base') || el?.getAttribute?.('xml:base') || '';
// Atribut "scormtype" (1.2) vs "scormType" (2004) — cari dua-duanya, tanpa peduli prefix.
const scormTypeOf = (el) => {
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if ((a.localName || a.name).toLowerCase().endsWith('scormtype')) return a.value.toLowerCase();
  }
  return '';
};

/**
 * @param {string} xmlString isi imsmanifest.xml
 * @param {typeof DOMParser} [Parser] di browser cukup pakai default; di Node isi dengan @xmldom/xmldom
 * @returns {{version:'1.2'|'2004', title:string, items:object[], scos:object[]}}
 *   items = pohon daftar isi; scos = daftar datar item yang bisa diluncurkan (urut tampil)
 */
export function parseManifest(xmlString, Parser = globalThis.DOMParser) {
  let doc;
  try {
    doc = new Parser().parseFromString(xmlString.replace(/^\uFEFF/, ''), 'application/xml');
  } catch (err) {
    throw new Error(`imsmanifest.xml rusak: ${err.message}`);
  }
  const root = doc.documentElement;
  if (!root || root.localName !== 'manifest' || doc.getElementsByTagName('parsererror').length) {
    throw new Error('imsmanifest.xml rusak atau bukan manifest SCORM.');
  }

  // --- Deteksi versi ---
  const schemaVersion = text(kid(kid(root, 'metadata'), 'schemaversion'));
  let version;
  if (schemaVersion === '1.2') version = '1.2';
  else if (/2004|CAM\s*1\.3/i.test(schemaVersion)) version = '2004';
  else version = /adlcp_v1p3|imsss/.test(xmlString) ? '2004' : '1.2';

  // --- Peta resource: identifier -> href lengkap ---
  const manifestBase = xmlBase(root);
  const resourcesEl = kid(root, 'resources');
  const resBase = joinPath(manifestBase, xmlBase(resourcesEl)) || '';
  const resources = new Map();
  for (const r of kids(resourcesEl, 'resource')) {
    const href = r.getAttribute('href');
    resources.set(r.getAttribute('identifier'), {
      href: href ? joinPath(joinPath(resBase, xmlBase(r)) || '', href) : null,
      scormType: scormTypeOf(r) || 'asset',
    });
  }

  // --- Pohon item dari organization default ---
  const orgsEl = kid(root, 'organizations');
  const orgs = kids(orgsEl, 'organization');
  const org = orgs.find((o) => o.getAttribute('identifier') === orgsEl?.getAttribute('default')) || orgs[0];
  const scos = [];

  const walk = (itemEl) => {
    const ref = itemEl.getAttribute('identifierref');
    const res = ref ? resources.get(ref) : null;
    let href = res?.href || null;
    const params = itemEl.getAttribute('parameters');
    if (href && params) {
      // Atribut "parameters" (mis. "?hal=1" atau "hal=1" atau "#bagian") ditempel ke href.
      if (params.startsWith('#')) href += params;
      else href += (href.includes('?') ? '&' : '?') + params.replace(/^[?&]/, '');
    }
    const node = {
      id: itemEl.getAttribute('identifier'),
      title: text(kid(itemEl, 'title')) || itemEl.getAttribute('identifier'),
      href,
      scormType: res?.scormType || null,
      visible: itemEl.getAttribute('isvisible') !== 'false',
      masteryScore: text(kid(itemEl, 'masteryscore')) || null, // khusus 1.2
      children: [],
    };
    // 2004: nilai lulus dari minNormalizedMeasure (0..1)
    const mnm = itemEl.getElementsByTagNameNS ? itemEl.getElementsByTagNameNS('*', 'minNormalizedMeasure')[0] : null;
    if (mnm) node.scaledPassingScore = text(mnm);
    if (href) scos.push(node);
    node.children = kids(itemEl, 'item').map(walk);
    return node;
  };

  let items = org ? kids(org, 'item').map(walk) : [];
  // Manifest tanpa organization: pakai resource pertama yang punya href.
  if (!items.length) {
    for (const [id, r] of resources) {
      if (r.href) {
        const node = { id, title: id, href: r.href, scormType: r.scormType, visible: true, children: [] };
        items = [node]; scos.push(node); break;
      }
    }
  }
  if (!scos.length) throw new Error('Manifest tidak punya materi yang bisa dibuka (tidak ada resource dengan href).');

  return { version, schemaVersion, title: text(kid(org, 'title')) || 'Kursus SCORM', items, scos };
}
