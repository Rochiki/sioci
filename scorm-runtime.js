// ============================================================
// scorm-runtime.js — "LMS mini" untuk SCORM Player
//
// Konten SCORM (SCO) berkomunikasi dengan LMS lewat objek JavaScript:
//   SCORM 1.2  -> window.API           (LMSInitialize, LMSGetValue, ...)
//   SCORM 2004 -> window.API_1484_11   (Initialize, GetValue, ...)
// SCO mencari objek itu di window.parent / window.opener. Player kita
// memasang objek ini di halaman player, lalu membuka SCO di <iframe>.
//
// Modul ini TIDAK menyentuh DOM -> bisa dites di Node.js.
// ============================================================
import { toScorm12Time, toScorm2004Time, parseScorm12Time, parseScorm2004Time } from './util.js';

// ---------- Validator kecil ----------
const isDecimal = (v) => /^-?\d+(\.\d+)?$/.test(v);
const range = (min, max) => (v) => isDecimal(v) && +v >= min && +v <= max;
const maxLen = (n) => (v) => v.length <= n;
const oneOf = (...list) => (v) => list.includes(v);
const any = () => true;
const score12 = (v) => v === '' || range(0, 100)(v);
const isTime12 = (v) => !Number.isNaN(parseScorm12Time(v));
const isTime2004 = (v) => !Number.isNaN(parseScorm2004Time(v));
const isTimestamp = (v) => /^\d{4}(-\d{2}(-\d{2}(T\d{2}(:\d{2}(:\d{2}(\.\d{1,2})?)?)?(Z|[+-]\d{2}(:\d{2})?)?)?)?)?$/.test(v);

// ---------- Kamus elemen data model ----------
// Format: [pola, akses, validator]. "n" = indeks array (0,1,2,...).
// akses: ro = baca saja, wo = tulis saja, rw = baca-tulis.
const SPEC_12 = [
  ['cmi.core._children', 'ro'], ['cmi.core.student_id', 'ro'], ['cmi.core.student_name', 'ro'],
  ['cmi.core.lesson_location', 'rw', maxLen(255)], ['cmi.core.credit', 'ro'],
  ['cmi.core.lesson_status', 'rw', oneOf('passed', 'completed', 'failed', 'incomplete', 'browsed')],
  ['cmi.core.entry', 'ro'], ['cmi.core.score._children', 'ro'],
  ['cmi.core.score.raw', 'rw', score12], ['cmi.core.score.min', 'rw', score12], ['cmi.core.score.max', 'rw', score12],
  ['cmi.core.total_time', 'ro'], ['cmi.core.lesson_mode', 'ro'],
  ['cmi.core.exit', 'wo', oneOf('time-out', 'suspend', 'logout', '')],
  ['cmi.core.session_time', 'wo', isTime12],
  ['cmi.suspend_data', 'rw', maxLen(4096)], ['cmi.launch_data', 'ro'],
  ['cmi.comments', 'rw', maxLen(4096)], ['cmi.comments_from_lms', 'ro'],
  ['cmi.objectives._children', 'ro'], ['cmi.objectives._count', 'ro'],
  ['cmi.objectives.n.id', 'rw', maxLen(255)], ['cmi.objectives.n.score._children', 'ro'],
  ['cmi.objectives.n.score.raw', 'rw', score12], ['cmi.objectives.n.score.min', 'rw', score12], ['cmi.objectives.n.score.max', 'rw', score12],
  ['cmi.objectives.n.status', 'rw', oneOf('passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted')],
  ['cmi.student_data._children', 'ro'], ['cmi.student_data.mastery_score', 'ro'],
  ['cmi.student_data.max_time_allowed', 'ro'], ['cmi.student_data.time_limit_action', 'ro'],
  ['cmi.student_preference._children', 'ro'], ['cmi.student_preference.audio', 'rw', range(-1, 100)],
  ['cmi.student_preference.language', 'rw', maxLen(255)], ['cmi.student_preference.speed', 'rw', range(-100, 100)],
  ['cmi.student_preference.text', 'rw', oneOf('-1', '0', '1')],
  ['cmi.interactions._children', 'ro'], ['cmi.interactions._count', 'ro'],
  ['cmi.interactions.n.id', 'wo', maxLen(255)], ['cmi.interactions.n.objectives._count', 'ro'],
  ['cmi.interactions.n.objectives.n.id', 'wo', maxLen(255)], ['cmi.interactions.n.time', 'wo', (v) => /^\d{2}:\d{2}:\d{2}(\.\d{1,2})?$/.test(v)],
  ['cmi.interactions.n.type', 'wo', oneOf('true-false', 'choice', 'fill-in', 'matching', 'performance', 'sequencing', 'likert', 'numeric')],
  ['cmi.interactions.n.correct_responses._count', 'ro'], ['cmi.interactions.n.correct_responses.n.pattern', 'wo', maxLen(255)],
  ['cmi.interactions.n.weighting', 'wo', isDecimal], ['cmi.interactions.n.student_response', 'wo', maxLen(255)],
  ['cmi.interactions.n.result', 'wo', (v) => ['correct', 'wrong', 'unanticipated', 'neutral'].includes(v) || isDecimal(v)],
  ['cmi.interactions.n.latency', 'wo', isTime12],
];

const real = isDecimal;
const SPEC_2004 = [
  ['cmi._version', 'ro'],
  ['cmi.comments_from_learner._children', 'ro'], ['cmi.comments_from_learner._count', 'ro'],
  ['cmi.comments_from_learner.n.comment', 'rw', maxLen(4000)], ['cmi.comments_from_learner.n.location', 'rw', maxLen(250)],
  ['cmi.comments_from_learner.n.timestamp', 'rw', isTimestamp],
  ['cmi.comments_from_lms._children', 'ro'], ['cmi.comments_from_lms._count', 'ro'],
  ['cmi.comments_from_lms.n.comment', 'ro'], ['cmi.comments_from_lms.n.location', 'ro'], ['cmi.comments_from_lms.n.timestamp', 'ro'],
  ['cmi.completion_status', 'rw', oneOf('completed', 'incomplete', 'not attempted', 'unknown')],
  ['cmi.completion_threshold', 'ro'], ['cmi.credit', 'ro'], ['cmi.entry', 'ro'],
  ['cmi.exit', 'wo', oneOf('time-out', 'suspend', 'logout', 'normal', '')],
  ['cmi.interactions._children', 'ro'], ['cmi.interactions._count', 'ro'],
  ['cmi.interactions.n.id', 'rw', (v) => v.length > 0 && v.length <= 4000],
  ['cmi.interactions.n.type', 'rw', oneOf('true-false', 'choice', 'fill-in', 'long-fill-in', 'matching', 'performance', 'sequencing', 'likert', 'numeric', 'other')],
  ['cmi.interactions.n.objectives._count', 'ro'], ['cmi.interactions.n.objectives.n.id', 'rw', maxLen(4000)],
  ['cmi.interactions.n.timestamp', 'rw', isTimestamp],
  ['cmi.interactions.n.correct_responses._count', 'ro'], ['cmi.interactions.n.correct_responses.n.pattern', 'rw', any],
  ['cmi.interactions.n.weighting', 'rw', real], ['cmi.interactions.n.learner_response', 'rw', any],
  ['cmi.interactions.n.result', 'rw', (v) => ['correct', 'incorrect', 'unanticipated', 'neutral'].includes(v) || real(v)],
  ['cmi.interactions.n.latency', 'rw', isTime2004], ['cmi.interactions.n.description', 'rw', maxLen(250)],
  ['cmi.launch_data', 'ro'], ['cmi.learner_id', 'ro'], ['cmi.learner_name', 'ro'],
  ['cmi.learner_preference._children', 'ro'], ['cmi.learner_preference.audio_level', 'rw', (v) => real(v) && +v >= 0],
  ['cmi.learner_preference.language', 'rw', maxLen(250)], ['cmi.learner_preference.delivery_speed', 'rw', (v) => real(v) && +v >= 0],
  ['cmi.learner_preference.audio_captioning', 'rw', oneOf('-1', '0', '1')],
  ['cmi.location', 'rw', maxLen(1000)], ['cmi.max_time_allowed', 'ro'], ['cmi.mode', 'ro'],
  ['cmi.objectives._children', 'ro'], ['cmi.objectives._count', 'ro'],
  ['cmi.objectives.n.id', 'rw', (v) => v.length > 0 && v.length <= 4000], ['cmi.objectives.n.score._children', 'ro'],
  ['cmi.objectives.n.score.scaled', 'rw', range(-1, 1)], ['cmi.objectives.n.score.raw', 'rw', real],
  ['cmi.objectives.n.score.min', 'rw', real], ['cmi.objectives.n.score.max', 'rw', real],
  ['cmi.objectives.n.success_status', 'rw', oneOf('passed', 'failed', 'unknown')],
  ['cmi.objectives.n.completion_status', 'rw', oneOf('completed', 'incomplete', 'not attempted', 'unknown')],
  ['cmi.objectives.n.progress_measure', 'rw', range(0, 1)], ['cmi.objectives.n.description', 'rw', maxLen(250)],
  ['cmi.progress_measure', 'rw', range(0, 1)], ['cmi.scaled_passing_score', 'ro'],
  ['cmi.score._children', 'ro'], ['cmi.score.scaled', 'rw', range(-1, 1)],
  ['cmi.score.raw', 'rw', real], ['cmi.score.min', 'rw', real], ['cmi.score.max', 'rw', real],
  ['cmi.session_time', 'wo', isTime2004],
  ['cmi.success_status', 'rw', oneOf('passed', 'failed', 'unknown')],
  ['cmi.suspend_data', 'rw', maxLen(64000)], ['cmi.time_limit_action', 'ro'], ['cmi.total_time', 'ro'],
  ['adl.nav.request', 'rw', (v) => /^(continue|previous|exit|exitAll|abandon|abandonAll|suspendAll|_none_|\{target=[^}]+\}(choice|jump))$/.test(v)],
  ['adl.nav.request_valid.continue', 'ro'], ['adl.nav.request_valid.previous', 'ro'],
  ['adl.nav.request_valid.choice.{target=x}', 'ro'], ['adl.nav.request_valid.jump.{target=x}', 'ro'],
];

const compile = (spec) => spec.map(([pattern, access, validate = any]) => ({
  re: new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\\\.n(?=\\\.|$)/g, '\\.(\\d+)').replace('\\{target=x\\}', '\\{target=[^}]+\\}') + '$'),
  access, validate, keyword: /\._(children|count|version)$/.test(pattern),
}));
const COMPILED = { '1.2': compile(SPEC_12), '2004': compile(SPEC_2004) };

// ---------- Kode & pesan error resmi ----------
const ERR_12 = {
  0: 'No error', 101: 'General exception', 201: 'Invalid argument error', 202: 'Element cannot have children',
  203: 'Element not an array - cannot have count', 301: 'Not initialized', 401: 'Not implemented error',
  402: 'Invalid set value, element is a keyword', 403: 'Element is read only', 404: 'Element is write only',
  405: 'Incorrect data type',
};
const ERR_2004 = {
  0: 'No error', 101: 'General exception', 102: 'General Initialization Failure', 103: 'Already Initialized',
  104: 'Content Instance Terminated', 111: 'General Termination Failure', 112: 'Termination Before Initialization',
  113: 'Termination After Termination', 122: 'Retrieve Data Before Initialization', 123: 'Retrieve Data After Termination',
  132: 'Store Data Before Initialization', 133: 'Store Data After Termination', 142: 'Commit Before Initialization',
  143: 'Commit After Termination', 201: 'General Argument Error', 301: 'General Get Failure', 351: 'General Set Failure',
  391: 'General Commit Failure', 401: 'Undefined Data Model Element', 402: 'Unimplemented Data Model Element',
  403: 'Data Model Element Value Not Initialized', 404: 'Data Model Element Is Read Only',
  405: 'Data Model Element Is Write Only', 406: 'Data Model Element Type Mismatch',
  407: 'Data Model Element Value Out Of Range', 408: 'Data Model Dependency Not Established',
};

// ---------- Nilai awal data model ----------
function defaults12(learner, ctx) {
  return {
    'cmi.core._children': 'student_id,student_name,lesson_location,credit,lesson_status,entry,score,total_time,lesson_mode,exit,session_time',
    'cmi.core.score._children': 'raw,min,max',
    'cmi.core.student_id': learner.id, 'cmi.core.student_name': learner.name,
    'cmi.core.lesson_location': '', 'cmi.core.credit': 'credit', 'cmi.core.lesson_status': 'not attempted',
    'cmi.core.entry': 'ab-initio', 'cmi.core.score.raw': '', 'cmi.core.score.min': '', 'cmi.core.score.max': '',
    'cmi.core.total_time': '0000:00:00.00', 'cmi.core.lesson_mode': 'normal',
    'cmi.suspend_data': '', 'cmi.launch_data': ctx.launchData || '', 'cmi.comments': '', 'cmi.comments_from_lms': '',
    'cmi.objectives._children': 'id,score,status', 'cmi.objectives._count': '0',
    'cmi.student_data._children': 'mastery_score,max_time_allowed,time_limit_action',
    'cmi.student_data.mastery_score': ctx.masteryScore ?? '', 'cmi.student_data.max_time_allowed': '',
    'cmi.student_data.time_limit_action': '',
    'cmi.student_preference._children': 'audio,language,speed,text',
    'cmi.student_preference.audio': '0', 'cmi.student_preference.language': '', 'cmi.student_preference.speed': '0',
    'cmi.student_preference.text': '0',
    'cmi.interactions._children': 'id,objectives,time,type,correct_responses,weighting,student_response,result,latency',
    'cmi.interactions._count': '0',
  };
}
function defaults2004(learner, ctx) {
  const d = {
    'cmi._version': '1.0',
    'cmi.comments_from_learner._children': 'comment,location,timestamp', 'cmi.comments_from_learner._count': '0',
    'cmi.comments_from_lms._children': 'comment,location,timestamp', 'cmi.comments_from_lms._count': '0',
    'cmi.completion_status': 'unknown', 'cmi.credit': 'credit', 'cmi.entry': 'ab-initio',
    'cmi.interactions._children': 'id,type,objectives,timestamp,correct_responses,weighting,learner_response,result,latency,description',
    'cmi.interactions._count': '0', 'cmi.launch_data': ctx.launchData || '',
    'cmi.learner_id': learner.id, 'cmi.learner_name': learner.name,
    'cmi.learner_preference._children': 'audio_level,language,delivery_speed,audio_captioning',
    'cmi.learner_preference.audio_level': '1', 'cmi.learner_preference.language': '',
    'cmi.learner_preference.delivery_speed': '1', 'cmi.learner_preference.audio_captioning': '0',
    'cmi.mode': 'normal', 'cmi.objectives._children': 'id,score,success_status,completion_status,progress_measure,description',
    'cmi.objectives._count': '0', 'cmi.score._children': 'scaled,raw,min,max', 'cmi.success_status': 'unknown',
    'cmi.suspend_data': '', 'cmi.total_time': 'PT0S', 'cmi.location': '',
    'adl.nav.request': '_none_', 'adl.nav.request_valid.continue': ctx.hasNext ? 'true' : 'false',
    'adl.nav.request_valid.previous': ctx.hasPrevious ? 'true' : 'false',
  };
  if (ctx.scaledPassingScore != null && ctx.scaledPassingScore !== '') d['cmi.scaled_passing_score'] = String(ctx.scaledPassingScore);
  return d;
}

/**
 * Buat runtime untuk SATU SCO.
 * @param {object} opt
 * @param {'1.2'|'2004'} opt.version
 * @param {{id:string,name:string}} [opt.learner]
 * @param {object} [opt.saved]   data hasil snapshot() sesi sebelumnya (untuk resume)
 * @param {object} [opt.context] { masteryScore, scaledPassingScore, launchData, hasNext, hasPrevious }
 * @param {(snapshot:object)=>void} [opt.onCommit]  dipanggil saat Commit/Finish -> simpan ke localStorage dsb.
 * @param {(entry:object)=>void} [opt.onLog]       dipanggil untuk setiap pemanggilan API (debug panel)
 * @param {(change:object)=>void} [opt.onChange]   dipanggil saat nilai berubah
 * @param {(req:string)=>void} [opt.onNavRequest]  SCORM 2004: permintaan navigasi setelah Terminate
 * @param {()=>void} [opt.onTerminate]
 */
export class ScormRuntime {
  constructor({ version, learner = { id: 'peserta-01', name: 'Peserta, Contoh' }, saved = null, context = {},
    onCommit = () => {}, onLog = () => {}, onChange = () => {}, onNavRequest = () => {}, onTerminate = () => {} }) {
    this.version = version === '2004' ? '2004' : '1.2';
    this.spec = COMPILED[this.version];
    this.errors = this.version === '1.2' ? ERR_12 : ERR_2004;
    this.state = 'notInit'; // notInit | running | terminated
    this.lastError = 0;
    this.hooks = { onCommit, onLog, onChange, onNavRequest, onTerminate };
    this.context = context;

    const base = this.version === '1.2' ? defaults12(learner, context) : defaults2004(learner, context);
    this.data = { ...base };
    if (saved?.data) {
      const entryKey = this.version === '1.2' ? 'cmi.core.entry' : 'cmi.entry';
      if (saved.exit === 'suspend') {
        // RESUME: pulihkan semua data (bookmark, suspend_data, skor, interaksi).
        Object.assign(this.data, saved.data);
        this.data[entryKey] = 'resume';
      } else {
        // ATTEMPT BARU: mulai bersih, tapi total waktu & status/skor terakhir tetap dibawa
        // (supaya peserta yang sudah lulus tidak kembali "belum dikerjakan").
        this.carryStatus(saved.data);
        this.data[entryKey] = '';
      }
      // Nilai milik LMS selalu dari LMS, bukan dari data tersimpan.
      for (const k of ['cmi.core.student_id', 'cmi.core.student_name', 'cmi.learner_id', 'cmi.learner_name', 'cmi.launch_data',
        'cmi.student_data.mastery_score', 'cmi.scaled_passing_score', 'adl.nav.request_valid.continue', 'adl.nav.request_valid.previous']) {
        if (k in base) this.data[k] = base[k];
      }
      if (this.version === '2004') this.data['adl.nav.request'] = '_none_';
    }
    this.sessionTimeSet = null;
    this.exitValue = '';
    this.api = this.version === '1.2' ? this.build12() : this.build2004();
  }

  /** Status penyelesaian tetap dibawa ke attempt baru (supaya "lulus" tidak hilang). */
  carryStatus(old) {
    for (const k of ['cmi.core.total_time', 'cmi.total_time', 'cmi.core.lesson_status', 'cmi.core.score.raw',
      'cmi.core.score.min', 'cmi.core.score.max', 'cmi.completion_status', 'cmi.success_status',
      'cmi.score.scaled', 'cmi.score.raw', 'cmi.score.min', 'cmi.score.max']) {
      const belongs = this.version === '1.2' ? k.startsWith('cmi.core.') : !k.startsWith('cmi.core.');
      if (belongs && old[k] !== undefined) this.data[k] = old[k];
    }
  }

  // ---------------------------------------------------------- inti
  log(fn, args, result) {
    this.hooks.onLog({ time: new Date(), fn, args, result, error: this.lastError, errorText: this.errors[this.lastError] });
    return result;
  }
  fail(code, ret = 'false') { this.lastError = code; return ret; }
  ok(ret = 'true') { this.lastError = 0; return ret; }
  find(el) { return this.spec.find((s) => s.re.test(el)); }

  initialize(param) {
    const v12 = this.version === '1.2';
    if (param !== '' && param !== undefined) return this.fail(201);
    if (this.state === 'running') return this.fail(v12 ? 101 : 103);
    if (this.state === 'terminated') return this.fail(v12 ? 101 : 104);
    this.state = 'running';
    this.startedAt = Date.now();
    return this.ok();
  }

  getValue(el) {
    const v12 = this.version === '1.2';
    if (this.state === 'notInit') return this.fail(v12 ? 301 : 122, '');
    if (this.state === 'terminated') return this.fail(v12 ? 101 : 123, '');
    if (!el) return this.fail(v12 ? 201 : 301, '');
    const s = this.find(el);
    if (!s) {
      if (v12 && /\._children$/.test(el)) return this.fail(202, '');
      if (v12 && /\._count$/.test(el)) return this.fail(203, '');
      return this.fail(v12 ? 401 : 401, '');
    }
    if (s.access === 'wo') return this.fail(v12 ? 404 : 405, '');
    // Indeks array harus sudah ada.
    const idxErr = this.checkIndexes(el, false);
    if (idxErr) return this.fail(v12 ? 201 : 301, '');
    const v = this.data[el];
    if (v === undefined) {
      if (/\._count$/.test(el)) return this.ok('0');
      return v12 ? this.ok('') : this.fail(403, '');
    }
    return this.ok(String(v));
  }

  setValue(el, value) {
    const v12 = this.version === '1.2';
    if (this.state === 'notInit') return this.fail(v12 ? 301 : 132);
    if (this.state === 'terminated') return this.fail(v12 ? 101 : 133);
    if (!el) return this.fail(v12 ? 201 : 351);
    value = value === undefined || value === null ? '' : String(value);
    const s = this.find(el);
    if (!s) return this.fail(v12 ? (/\._(children|count)$/.test(el) ? 402 : 401) : 401);
    if (s.keyword) return this.fail(v12 ? 402 : 404);
    if (s.access === 'ro') return this.fail(v12 ? 403 : 404);
    if (!s.validate(value)) return this.fail(v12 ? 405 : (/score|progress|weighting/.test(el) && isDecimal(value) ? 407 : 406));
    const idx = this.checkIndexes(el, true);
    if (idx === 'error') return this.fail(v12 ? 201 : 351);
    // SCORM 2004: elemen anak array baru boleh di-set setelah id-nya ada.
    if (!v12 && /^cmi\.(interactions|objectives)\.\d+\.(?!id$)/.test(el)) {
      const idKey = el.replace(/^(cmi\.(interactions|objectives)\.\d+)\..*$/, '$1.id');
      if (this.data[idKey] === undefined && !/\._count$/.test(el)) return this.fail(408);
    }
    if (idx) for (const key of idx) this.data[key] = String((+this.data[key] || 0) + 1);

    // Simpan nilai khusus ke variabel sesi (tidak dibaca balik).
    if (el === 'cmi.core.session_time' || el === 'cmi.session_time') this.sessionTimeSet = value;
    if (el === 'cmi.core.exit' || el === 'cmi.exit') this.exitValue = value;
    const old = this.data[el];
    this.data[el] = value;
    if (old !== value) this.hooks.onChange({ element: el, value, old });
    return this.ok();
  }

  /**
   * Cek indeks array, mis. cmi.interactions.3.result.
   * Indeks boleh = _count (membuat entri baru) hanya di level terdalam dan hanya saat SET.
   * Return: null (aman, tidak ada pertambahan), array key _count yang perlu ditambah, atau 'error'/true.
   */
  checkIndexes(el, isSet) {
    const re = /\.(\d+)(?=\.)/g;
    const matches = [...el.matchAll(re)];
    if (!matches.length) return null;
    const bump = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const prefix = el.slice(0, m.index);
      const countKey = `${prefix}._count`;
      const count = +this.data[countKey] || 0;
      const n = +m[1];
      const deepest = i === matches.length - 1;
      if (n < count) continue;
      if (n === count && isSet && deepest) { bump.push(countKey); continue; }
      return isSet ? 'error' : true;
    }
    return bump.length ? bump : null;
  }

  commit(param) {
    const v12 = this.version === '1.2';
    if (param !== '' && param !== undefined) return this.fail(201);
    if (this.state === 'notInit') return this.fail(v12 ? 301 : 142);
    if (this.state === 'terminated') return this.fail(v12 ? 101 : 143);
    this.hooks.onCommit(this.snapshot(false));
    return this.ok();
  }

  terminate(param) {
    const v12 = this.version === '1.2';
    if (param !== '' && param !== undefined) return this.fail(201);
    if (this.state === 'notInit') return this.fail(v12 ? 301 : 112);
    if (this.state === 'terminated') return this.fail(v12 ? 101 : 113);
    this.finalizeSession();
    this.state = 'terminated';
    this.hooks.onCommit(this.snapshot(true));
    this.hooks.onTerminate();
    if (!v12) {
      const req = this.data['adl.nav.request'];
      if (req && req !== '_none_') setTimeout(() => this.hooks.onNavRequest(req), 0);
    }
    return this.ok();
  }

  /** Aturan LMS saat sesi selesai: akumulasi waktu & evaluasi status. */
  finalizeSession() {
    if (this.version === '1.2') {
      const add = this.sessionTimeSet ? parseScorm12Time(this.sessionTimeSet) : 0;
      this.data['cmi.core.total_time'] = toScorm12Time(parseScorm12Time(this.data['cmi.core.total_time']) + (add || 0));
      const mastery = this.data['cmi.student_data.mastery_score'];
      const raw = this.data['cmi.core.score.raw'];
      const status = this.data['cmi.core.lesson_status'];
      // Spesifikasi 1.2: bila ada mastery_score dan skor, LMS menentukan passed/failed.
      if (mastery !== '' && raw !== '' && this.data['cmi.core.credit'] === 'credit' && ['completed', 'incomplete', 'not attempted', 'browsed'].includes(status)) {
        this.data['cmi.core.lesson_status'] = +raw >= +mastery ? 'passed' : 'failed';
      } else if (status === 'not attempted') {
        this.data['cmi.core.lesson_status'] = 'completed';
      }
    } else {
      const add = this.sessionTimeSet ? parseScorm2004Time(this.sessionTimeSet) : 0;
      this.data['cmi.total_time'] = toScorm2004Time(parseScorm2004Time(this.data['cmi.total_time']) + (add || 0));
      const sps = this.data['cmi.scaled_passing_score'];
      const scaled = this.data['cmi.score.scaled'];
      if (sps !== undefined && scaled !== undefined) this.data['cmi.success_status'] = +scaled >= +sps ? 'passed' : 'failed';
    }
  }

  getLastError() { return String(this.lastError); }
  getErrorString(code) { return this.errors[+code] || ''; }
  getDiagnostic(code) { const c = code === '' || code === undefined ? this.lastError : +code; return this.errors[c] || ''; }

  /** Ringkasan untuk ditampilkan & disimpan. */
  snapshot(final) {
    const d = this.data;
    const v12 = this.version === '1.2';
    const completion = v12 ? d['cmi.core.lesson_status'] : d['cmi.completion_status'];
    const success = v12 ? (['passed', 'failed'].includes(d['cmi.core.lesson_status']) ? d['cmi.core.lesson_status'] : 'unknown') : d['cmi.success_status'];
    const completed = v12 ? ['passed', 'completed', 'failed'].includes(completion) : completion === 'completed';
    return {
      version: this.version, final, exit: this.exitValue, completed,
      status: completion, success,
      score: v12 ? d['cmi.core.score.raw'] : (d['cmi.score.raw'] ?? (d['cmi.score.scaled'] !== undefined ? String(Math.round(d['cmi.score.scaled'] * 100)) : '')),
      location: v12 ? d['cmi.core.lesson_location'] : d['cmi.location'],
      totalTime: v12 ? d['cmi.core.total_time'] : d['cmi.total_time'],
      data: { ...d },
      savedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------- objek API publik
  build12() {
    const L = (fn, a, r) => this.log(fn, a, r);
    return {
      LMSInitialize: (p = '') => L('LMSInitialize', [p], this.initialize(p)),
      LMSFinish: (p = '') => L('LMSFinish', [p], this.terminate(p)),
      LMSGetValue: (e) => L('LMSGetValue', [e], this.getValue(e)),
      LMSSetValue: (e, v) => L('LMSSetValue', [e, v], this.setValue(e, v)),
      LMSCommit: (p = '') => L('LMSCommit', [p], this.commit(p)),
      LMSGetLastError: () => this.getLastError(),
      LMSGetErrorString: (c) => this.getErrorString(c),
      LMSGetDiagnostic: (c) => this.getDiagnostic(c),
    };
  }
  build2004() {
    const L = (fn, a, r) => this.log(fn, a, r);
    return {
      version: '1.0',
      Initialize: (p = '') => L('Initialize', [p], this.initialize(p)),
      Terminate: (p = '') => L('Terminate', [p], this.terminate(p)),
      GetValue: (e) => L('GetValue', [e], this.getValue(e)),
      SetValue: (e, v) => L('SetValue', [e, v], this.setValue(e, v)),
      Commit: (p = '') => L('Commit', [p], this.commit(p)),
      GetLastError: () => this.getLastError(),
      GetErrorString: (c) => this.getErrorString(c),
      GetDiagnostic: (c) => this.getDiagnostic(c),
    };
  }
}
