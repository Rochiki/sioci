/* ============================================================
   course.js — mesin tampilan kursus (ikut di dalam paket SCORM)
   Membaca window.COURSE_DATA (dari course-data.js), menampilkan
   slide materi & kuis, memutar narasi, dan melapor ke LMS lewat
   window.ScormAPI (scorm-api.js).
   Ditulis tanpa framework & tanpa modul ES supaya jalan di LMS lama.
   ============================================================ */
(function () {
  'use strict';
  var C = window.COURSE_DATA;
  var S = window.ScormAPI;
  var app = document.getElementById('app');
  var slides = C.slides || [];
  var quizSlides = slides.filter(function (s) { return s.type === 'quiz' && s.questions && s.questions.length; });
  var hasQuiz = quizSlides.length > 0;

  // State yang disimpan ke suspend_data (dibuat ringkas: batas SCORM 1.2 = 4096 karakter)
  // v = slide yang sudah dilihat, a = jawaban {idSoal: indeksPilihan}, d = kuis yang sudah dikirim
  var state = { i: 0, v: [], a: {}, d: {} };
  var audio = null;
  var speaking = false;

  // ---------------------------------------------------------------- util
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /** Markdown mini: paragraf, daftar "- ", **tebal**, *miring*. Teks di-escape dulu (aman dari XSS). */
  function md(text) {
    var blocks = String(text || '').split(/\n\s*\n/);
    return blocks.map(function (b) {
      var lines = b.trim().split('\n');
      var inline = function (s) {
        return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>');
      };
      if (lines.every(function (l) { return /^\s*[-•]\s+/.test(l); })) {
        return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-•]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      }
      if (lines.every(function (l) { return /^\s*\d+[.)]\s+/.test(l); })) {
        return '<ol>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; }).join('') + '</ol>';
      }
      return b.trim() ? '<p>' + lines.map(inline).join('<br>') + '</p>' : '';
    }).join('');
  }
  function letter(i) { return 'abcdefghij'.charAt(i); }
  function save() {
    S.setLocation(String(state.i));
    var data = JSON.stringify(state);
    if (S.version === '1.2' && data.length > 4096) data = JSON.stringify({ i: state.i, v: state.v, d: state.d, a: {} });
    S.setSuspend(data);
    S.commit();
  }

  // ---------------------------------------------------------------- penilaian
  function quizResult() {
    var total = 0, right = 0;
    quizSlides.forEach(function (s) {
      s.questions.forEach(function (q) { total++; if (state.a[q.id] === q.correct) right++; });
    });
    return { total: total, right: right, percent: total ? (right / total) * 100 : 0 };
  }
  function allQuizzesDone() { return quizSlides.every(function (s) { return state.d[s.id]; }); }

  function evaluate() {
    var seen = state.v.length / Math.max(1, slides.length);
    S.setProgress(seen);
    if (hasQuiz) {
      if (allQuizzesDone()) {
        var r = quizResult();
        S.setScore(r.percent, r.percent >= C.passingScore);
      } else S.setIncomplete();
    } else if (state.v.length >= slides.length) {
      S.setCompleted();
    } else S.setIncomplete();
  }

  // ---------------------------------------------------------------- narasi
  function stopNarration() {
    if (audio) { audio.pause(); }
    if (window.speechSynthesis) speechSynthesis.cancel();
    speaking = false;
    var b = document.getElementById('btnVoice');
    if (b) b.textContent = 'Putar narasi';
  }
  function speakText(text) {
    if (!window.speechSynthesis) return;
    // Pecah per kalimat (tanpa regex lookbehind supaya aman di Safari lama).
    var parts = text.replace(/([.!?])\s+/g, '$1\n').split(/\n+/).filter(Boolean);
    var voices = speechSynthesis.getVoices().filter(function (v) { return /^id/i.test(v.lang); });
    voices.sort(function (a, b) { return (/natural|neural|online/i.test(b.name) ? 1 : 0) - (/natural|neural|online/i.test(a.name) ? 1 : 0); });
    speaking = true;
    (function next() {
      if (!speaking || !parts.length) { if (!parts.length) stopNarration(); return; }
      var u = new SpeechSynthesisUtterance(parts.shift());
      u.lang = 'id-ID'; if (voices[0]) u.voice = voices[0];
      u.onend = next;
      speechSynthesis.speak(u);
    })();
  }
  function narrationText(s) {
    if (s.type === 'quiz') return [s.title, s.intro].concat(s.questions.map(function (q) { return q.text; })).join('. ');
    return (s.title ? s.title + '. ' : '') + String(s.body || '').replace(/[*_#>-]/g, ' ');
  }
  function toggleNarration(autoplay) {
    var s = slides[state.i];
    var b = document.getElementById('btnVoice');
    if (speaking || (audio && !audio.paused)) { stopNarration(); return; }
    if (s.audio) {
      audio = audio || new Audio();
      if (audio.dataset.src !== s.audio) { audio.src = s.audio; audio.dataset.src = s.audio; }
      audio.onended = function () { if (b) b.textContent = 'Putar narasi'; };
      var p = audio.play();
      if (p && p.catch) p.catch(function () { if (b) b.textContent = 'Putar narasi'; });
      if (b) b.textContent = 'Hentikan narasi';
    } else if (C.settings.browserNarration && window.speechSynthesis && !autoplay) {
      speakText(narrationText(s));
      if (b) b.textContent = 'Hentikan narasi';
    }
  }
  function canNarrate(s) { return !!s.audio || (C.settings.browserNarration && !!window.speechSynthesis); }

  // ---------------------------------------------------------------- tampilan
  function renderStart() {
    var resume = S.isResume() && state.i > 0;
    app.innerHTML =
      '<section class="start">' +
      '<h1>' + esc(C.title) + '</h1>' +
      (C.description ? '<div class="lead">' + md(C.description) + '</div>' : '') +
      '<p class="meta">' + slides.length + ' bagian' + (hasQuiz ? ' · nilai lulus ' + C.passingScore : '') +
      (S.learnerName() ? ' · Peserta: ' + esc(S.learnerName()) : '') + '</p>' +
      '<div class="start-actions">' +
      (resume ? '<button class="primary" id="btnResume">Lanjutkan dari bagian ' + (state.i + 1) + '</button><button id="btnRestart">Mulai dari awal</button>'
        : '<button class="primary" id="btnStart">Mulai</button>') +
      '</div>' +
      (S.connected ? '' : '<p class="note">Mode mandiri: tidak terhubung ke LMS. Progres disimpan di browser ini saja.</p>') +
      '</section>';
    var go = function (i) { return function () { show(i, true); }; };
    if (resume) {
      document.getElementById('btnResume').onclick = go(state.i);
      document.getElementById('btnRestart').onclick = go(0);
    } else document.getElementById('btnStart').onclick = go(0);
  }

  function show(i, autoplay) {
    stopNarration();
    state.i = Math.max(0, Math.min(slides.length - 1, i));
    if (state.v.indexOf(state.i) === -1) state.v.push(state.i);
    var s = slides[state.i];
    var pct = Math.round(((state.i + 1) / slides.length) * 100);
    app.innerHTML =
      '<header class="bar"><span class="course">' + esc(C.title) + '</span>' +
      '<span class="count">Bagian ' + (state.i + 1) + ' dari ' + slides.length + '</span>' +
      '<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><div style="width:' + pct + '%"></div></div></header>' +
      '<main class="slide" id="slide" tabindex="-1">' + (s.type === 'quiz' ? quizHtml(s) : contentHtml(s)) + '</main>' +
      '<footer class="nav">' +
      '<button id="btnPrev"' + (state.i === 0 ? ' disabled' : '') + '>Sebelumnya</button>' +
      (canNarrate(s) ? '<button id="btnVoice">Putar narasi</button>' : '<span></span>') +
      (state.i < slides.length - 1 ? '<button class="primary" id="btnNext">Berikutnya</button>' : '<button class="primary" id="btnDone">Selesai</button>') +
      '</footer>';
    document.getElementById('btnPrev').onclick = function () { show(state.i - 1); };
    var nb = document.getElementById('btnNext'); if (nb) nb.onclick = function () { show(state.i + 1); };
    var db = document.getElementById('btnDone'); if (db) db.onclick = renderEnd;
    var vb = document.getElementById('btnVoice'); if (vb) vb.onclick = function () { toggleNarration(false); };
    if (s.type === 'quiz') bindQuiz(s);
    document.getElementById('slide').focus();
    evaluate(); save();
    if (autoplay !== false && C.settings.autoplay && s.audio) toggleNarration(true);
  }

  function contentHtml(s) {
    return '<h2>' + esc(s.title) + '</h2>' +
      (s.image ? '<figure><img src="' + esc(s.image) + '" alt="' + esc(s.imageAlt || '') + '"></figure>' : '') +
      '<div class="body">' + md(s.body) + '</div>';
  }

  function quizHtml(s) {
    var done = !!state.d[s.id];
    var html = '<h2>' + esc(s.title) + '</h2>' + (s.intro ? '<div class="body">' + md(s.intro) + '</div>' : '');
    s.questions.forEach(function (q, qi) {
      html += '<fieldset class="q" data-q="' + esc(q.id) + '"><legend>' + (qi + 1) + '. ' + esc(q.text) + '</legend>';
      q.options.forEach(function (o, oi) {
        var checked = state.a[q.id] === oi;
        var cls = done ? (oi === q.correct ? ' right' : checked ? ' wrong' : '') : '';
        html += '<label class="opt' + cls + '"><input type="radio" name="' + esc(q.id) + '" value="' + oi + '"' +
          (checked ? ' checked' : '') + (done ? ' disabled' : '') + '> <span>' + esc(o) + '</span></label>';
      });
      if (done && q.feedback) html += '<p class="feedback">' + esc(q.feedback) + '</p>';
      html += '</fieldset>';
    });
    html += '<div class="quiz-actions" aria-live="polite">';
    if (!done) html += '<button class="primary" id="btnSubmit">Kirim jawaban</button><span id="quizMsg" class="msg"></span>';
    else html += resultHtml();
    return html + '</div>';
  }

  function resultHtml() {
    if (!allQuizzesDone()) return '<p class="msg">Jawaban tersimpan. Kerjakan kuis lain untuk melihat nilai akhir.</p>';
    var r = quizResult();
    var pass = r.percent >= C.passingScore;
    return '<div class="result ' + (pass ? 'pass' : 'fail') + '"><strong>Nilai Anda: ' + Math.round(r.percent) + '</strong> (' + r.right + ' dari ' + r.total + ' benar). ' +
      (pass ? 'Selamat, Anda lulus.' : 'Belum mencapai nilai lulus ' + C.passingScore + '.') +
      (pass ? '' : ' <button id="btnRetry">Ulangi kuis</button>') + '</div>';
  }

  function bindQuiz(s) {
    var form = document.getElementById('slide');
    form.querySelectorAll('input[type=radio]').forEach(function (r) {
      r.onchange = function () { state.a[r.name] = +r.value; save(); };
    });
    var submit = document.getElementById('btnSubmit');
    if (submit) submit.onclick = function () {
      var missing = s.questions.filter(function (q) { return state.a[q.id] === undefined; }).length;
      if (missing) { document.getElementById('quizMsg').textContent = 'Masih ada ' + missing + ' soal yang belum dijawab.'; return; }
      state.d[s.id] = 1;
      s.questions.forEach(function (q) {
        S.recordInteraction({
          id: q.id, description: q.text, response: letter(state.a[q.id]), correct: letter(q.correct),
          isCorrect: state.a[q.id] === q.correct,
        });
      });
      evaluate(); save();
      show(state.i, false);
    };
    var retry = document.getElementById('btnRetry');
    if (retry) retry.onclick = function () {
      quizSlides.forEach(function (qs) { delete state.d[qs.id]; qs.questions.forEach(function (q) { delete state.a[q.id]; }); });
      save();
      show(slides.indexOf(quizSlides[0]), false);
    };
  }

  function renderEnd() {
    stopNarration();
    evaluate(); save();
    var r = hasQuiz && allQuizzesDone() ? quizResult() : null;
    var unfinished = hasQuiz && !allQuizzesDone();
    app.innerHTML = '<section class="start"><h1>' + (unfinished ? 'Belum selesai' : 'Kursus selesai') + '</h1>' +
      (r ? '<p class="lead">Nilai akhir: <strong>' + Math.round(r.percent) + '</strong> — ' + (r.percent >= C.passingScore ? 'Lulus' : 'Belum lulus') + '</p>' : '') +
      (unfinished ? '<p class="lead">Masih ada kuis yang belum dikirim.</p>' : '<p class="lead">Terima kasih. Progres Anda sudah tercatat' + (S.connected ? ' di LMS' : '') + '.</p>') +
      '<div class="start-actions"><button id="btnBack">Kembali ke materi</button>' +
      (S.connected && !unfinished ? '<button class="primary" id="btnExit">Tutup kursus</button>' : '') + '</div></section>';
    document.getElementById('btnBack').onclick = function () { show(state.i, false); };
    var ex = document.getElementById('btnExit');
    if (ex) ex.onclick = function () { closed = true; S.finish(false); app.innerHTML = '<section class="start"><h1>Sesi ditutup</h1><p class="lead">Anda boleh menutup jendela ini.</p></section>'; };
  }

  // ---------------------------------------------------------------- mulai
  var closed = false;
  S.init();
  try {
    var saved = S.getSuspend();
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') state = { i: parsed.i || 0, v: parsed.v || [], a: parsed.a || {}, d: parsed.d || {} };
    }
  } catch (e) { /* suspend_data kosong / rusak: mulai baru */ }
  if (!S.getSuspend()) { var loc = parseInt(S.getLocation(), 10); if (loc > 0) state.i = loc; }
  S.setIncomplete();
  if (hasQuiz && allQuizzesDone()) evaluate();
  S.commit();
  renderStart();

  // Saat jendela/tab ditutup: simpan & tutup sesi (suspend agar bisa dilanjutkan).
  function onLeave() {
    if (closed) return;
    closed = true;
    stopNarration();
    save();
    var finished = hasQuiz ? allQuizzesDone() : state.v.length >= slides.length;
    S.finish(!finished);
  }
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('beforeunload', onLeave);
})();
