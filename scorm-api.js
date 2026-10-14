/* ============================================================
   scorm-api.js — jembatan konten ⇄ LMS (ikut di dalam paket SCORM)
   Mendukung SCORM 1.2 dan SCORM 2004 dengan satu antarmuka.
   Bila dibuka tanpa LMS (mis. klik ganda index.html), berjalan
   dalam "mode mandiri" dan menyimpan progres di localStorage.
   ============================================================ */
(function () {
  'use strict';

  function findAPI(win, name) {
    var tries = 0;
    while (win && tries < 10) {
      try { if (win[name]) return win[name]; } catch (e) { /* beda origin: lewati */ }
      if (win.parent === win) break;
      win = win.parent; tries++;
    }
    return null;
  }
  function locate(name) {
    return findAPI(window, name) || (window.opener ? findAPI(window.opener, name) : null);
  }

  var api2004 = locate('API_1484_11');
  var api12 = api2004 ? null : locate('API');
  var version = api2004 ? '2004' : api12 ? '1.2' : 'none';
  var api = api2004 || api12;
  var started = Date.now();
  var active = false;
  var LOCAL_KEY = 'scorm-mandiri:' + location.pathname;
  var local = {};
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch (e) { local = {}; }

  // Nama elemen data model berbeda antara 1.2 dan 2004.
  var MAP = {
    location: ['cmi.core.lesson_location', 'cmi.location'],
    suspend: ['cmi.suspend_data', 'cmi.suspend_data'],
    entry: ['cmi.core.entry', 'cmi.entry'],
    name: ['cmi.core.student_name', 'cmi.learner_name'],
    raw: ['cmi.core.score.raw', 'cmi.score.raw'],
    min: ['cmi.core.score.min', 'cmi.score.min'],
    max: ['cmi.core.score.max', 'cmi.score.max'],
    exit: ['cmi.core.exit', 'cmi.exit'],
    session: ['cmi.core.session_time', 'cmi.session_time'],
  };
  function key(k) { return MAP[k][version === '2004' ? 1 : 0]; }

  function call(fn12, fn2004) {
    if (!api) return 'true';
    var args = Array.prototype.slice.call(arguments, 2);
    var fn = version === '2004' ? fn2004 : fn12;
    try { return String(api[fn].apply(api, args)); } catch (e) { return 'false'; }
  }
  function get(el) { if (!api) return local[el] || ''; return call('LMSGetValue', 'GetValue', el); }
  function set(el, val) {
    if (!api) { local[el] = String(val); return true; }
    var ok = call('LMSSetValue', 'SetValue', el, String(val)) === 'true';
    if (!ok && window.console) console.warn('[SCORM] Gagal set', el, '=', val, 'error', call('LMSGetLastError', 'GetLastError'));
    return ok;
  }

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function sessionTime() {
    var cs = Math.round((Date.now() - started) / 10);
    var h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = (cs % 6000) / 100;
    if (version === '2004') return 'PT' + h + 'H' + m + 'M' + s.toFixed(2) + 'S';
    return pad(h, 4) + ':' + pad(m, 2) + ':' + pad(s.toFixed(2), 5);
  }

  window.ScormAPI = {
    version: version,
    connected: !!api,

    init: function () {
      if (active) return true;
      active = call('LMSInitialize', 'Initialize', '') === 'true';
      return active;
    },
    get: get,
    set: set,
    commit: function () {
      if (!api) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch (e) {} return true; }
      return call('LMSCommit', 'Commit', '') === 'true';
    },

    isResume: function () { return get(key('entry')) === 'resume' || (!api && !!local[key('suspend')]); },
    learnerName: function () {
      var n = get(key('name')) || '';
      // Konvensi LMS: "Belakang, Depan" -> "Depan Belakang"
      return n.indexOf(',') > -1 ? n.split(',').reverse().join(' ').trim() : n;
    },
    getLocation: function () { return get(key('location')); },
    setLocation: function (v) { return set(key('location'), v); },
    getSuspend: function () { return get(key('suspend')); },
    setSuspend: function (v) { return set(key('suspend'), v); },

    setIncomplete: function () {
      if (version === '2004') {
        if (get('cmi.completion_status') !== 'completed') set('cmi.completion_status', 'incomplete');
      } else {
        var st = get('cmi.core.lesson_status');
        if (st === 'not attempted' || st === '' ) set('cmi.core.lesson_status', 'incomplete');
      }
    },
    setCompleted: function () {
      if (version === '2004') {
        set('cmi.completion_status', 'completed');
        set('cmi.progress_measure', '1');
      } else {
        var st = get('cmi.core.lesson_status');
        if (st !== 'passed' && st !== 'failed') set('cmi.core.lesson_status', 'completed');
      }
    },
    setProgress: function (fraction) {
      if (version === '2004') set('cmi.progress_measure', Math.max(0, Math.min(1, fraction)).toFixed(2));
    },
    /** percent: 0..100, passed: boolean */
    setScore: function (percent, passed) {
      set(key('min'), 0); set(key('max'), 100); set(key('raw'), Math.round(percent));
      if (version === '2004') {
        set('cmi.score.scaled', (percent / 100).toFixed(2));
        set('cmi.completion_status', 'completed');
        set('cmi.success_status', passed ? 'passed' : 'failed');
      } else {
        set('cmi.core.lesson_status', passed ? 'passed' : 'failed');
      }
    },

    /** Catat jawaban kuis sebagai "interaction" — muncul di laporan LMS. */
    recordInteraction: function (it) {
      var n = parseInt(get('cmi.interactions._count'), 10) || 0;
      var p = 'cmi.interactions.' + n + '.';
      set(p + 'id', it.id);
      set(p + 'type', 'choice');
      if (version === '2004') {
        set(p + 'description', String(it.description || '').slice(0, 250));
        set(p + 'correct_responses.0.pattern', it.correct);
        set(p + 'learner_response', it.response);
        set(p + 'result', it.isCorrect ? 'correct' : 'incorrect');
        set(p + 'timestamp', new Date().toISOString().slice(0, 19));
      } else {
        set(p + 'correct_responses.0.pattern', it.correct);
        set(p + 'student_response', it.response);
        set(p + 'result', it.isCorrect ? 'correct' : 'wrong');
        set(p + 'time', new Date().toTimeString().slice(0, 8));
      }
    },

    /** Tutup sesi. suspend=true -> peserta bisa melanjutkan dari posisi terakhir. */
    finish: function (suspend) {
      if (!active && api) return;
      set(key('exit'), suspend ? 'suspend' : (version === '2004' ? 'normal' : ''));
      set(key('session'), sessionTime());
      this.commit();
      if (api) call('LMSFinish', 'Terminate', '');
      active = false;
    },
  };
})();
