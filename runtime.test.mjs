import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScormRuntime } from './scorm-runtime.js';

test('SCORM 1.2: siklus normal + status otomatis dari mastery score', () => {
  let saved = null;
  const rt = new ScormRuntime({ version: '1.2', learner: { id: 'u1', name: 'Amelia, Rosiana' }, context: { masteryScore: '80' }, onCommit: (s) => (saved = s) });
  const A = rt.api;
  assert.equal(A.LMSGetValue('cmi.core.student_name'), '');
  assert.equal(A.LMSGetLastError(), '301', 'belum Initialize');
  assert.equal(A.LMSInitialize(''), 'true');
  assert.equal(A.LMSGetValue('cmi.core.student_name'), 'Amelia, Rosiana');
  assert.equal(A.LMSGetValue('cmi.core.lesson_status'), 'not attempted');
  assert.equal(A.LMSGetValue('cmi.student_data.mastery_score'), '80');
  assert.equal(A.LMSSetValue('cmi.core.student_name', 'x'), 'false');
  assert.equal(A.LMSGetLastError(), '403');
  assert.equal(A.LMSGetValue('cmi.core.exit'), '');
  assert.equal(A.LMSGetLastError(), '404', 'exit write-only');
  assert.equal(A.LMSSetValue('cmi.core.lesson_status', 'lulus'), 'false');
  assert.equal(A.LMSGetLastError(), '405');
  assert.equal(A.LMSSetValue('cmi.core.score.raw', '85'), 'true');
  assert.equal(A.LMSSetValue('cmi.core.lesson_status', 'completed'), 'true');
  assert.equal(A.LMSSetValue('cmi.core.session_time', '0000:10:00'), 'true');
  assert.equal(A.LMSSetValue('cmi.core._children', 'x'), 'false');
  assert.equal(A.LMSGetLastError(), '402');
  assert.equal(A.LMSGetValue('cmi.tidak.ada'), '');
  assert.equal(A.LMSGetLastError(), '401');
  assert.equal(A.LMSFinish(''), 'true');
  assert.equal(saved.status, 'passed', 'completed + skor >= mastery -> passed');
  assert.equal(saved.totalTime, '0000:10:00.00');
  assert.equal(A.LMSSetValue('cmi.core.lesson_location', '3'), 'false', 'setelah Finish');
});

test('SCORM 1.2: interaksi & _count', () => {
  const rt = new ScormRuntime({ version: '1.2' });
  const A = rt.api;
  A.LMSInitialize('');
  assert.equal(A.LMSSetValue('cmi.interactions.1.id', 'q2'), 'false', 'loncat indeks ditolak');
  assert.equal(A.LMSSetValue('cmi.interactions.0.id', 'q1'), 'true');
  assert.equal(A.LMSSetValue('cmi.interactions.0.result', 'correct'), 'true');
  assert.equal(A.LMSSetValue('cmi.interactions.0.correct_responses.0.pattern', 'c'), 'true');
  assert.equal(A.LMSGetValue('cmi.interactions._count'), '1');
  assert.equal(A.LMSGetValue('cmi.interactions.0.correct_responses._count'), '1');
  assert.equal(A.LMSGetValue('cmi.interactions.0.id'), '');
  assert.equal(A.LMSGetLastError(), '404', 'interaksi write-only di 1.2');
});

test('SCORM 1.2: suspend lalu resume memulihkan bookmark & suspend_data', () => {
  let saved;
  const a = new ScormRuntime({ version: '1.2', onCommit: (s) => (saved = s) });
  a.api.LMSInitialize('');
  a.api.LMSSetValue('cmi.core.lesson_location', '4');
  a.api.LMSSetValue('cmi.suspend_data', '{"i":4}');
  a.api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
  a.api.LMSSetValue('cmi.core.exit', 'suspend');
  a.api.LMSSetValue('cmi.core.session_time', '0000:01:00');
  a.api.LMSFinish('');
  const b = new ScormRuntime({ version: '1.2', saved });
  b.api.LMSInitialize('');
  assert.equal(b.api.LMSGetValue('cmi.core.entry'), 'resume');
  assert.equal(b.api.LMSGetValue('cmi.core.lesson_location'), '4');
  assert.equal(b.api.LMSGetValue('cmi.suspend_data'), '{"i":4}');
  assert.equal(b.api.LMSGetValue('cmi.core.total_time'), '0000:01:00.00');
});

test('SCORM 1.2: attempt baru tetap membawa status lulus', () => {
  const prev = new ScormRuntime({ version: '1.2' });
  let saved;
  prev.hooks.onCommit = (s) => (saved = s);
  prev.api.LMSInitialize('');
  prev.api.LMSSetValue('cmi.core.lesson_status', 'passed');
  prev.api.LMSSetValue('cmi.core.score.raw', '90');
  prev.api.LMSSetValue('cmi.suspend_data', 'lama');
  prev.api.LMSFinish('');
  const next = new ScormRuntime({ version: '1.2', saved });
  next.api.LMSInitialize('');
  assert.equal(next.api.LMSGetValue('cmi.core.entry'), '');
  assert.equal(next.api.LMSGetValue('cmi.core.lesson_status'), 'passed');
  assert.equal(next.api.LMSGetValue('cmi.suspend_data'), '', 'attempt baru mulai bersih');
});

test('SCORM 2004: error code & evaluasi success_status dari scaled_passing_score', () => {
  let saved;
  const rt = new ScormRuntime({ version: '2004', context: { scaledPassingScore: '0.8' }, onCommit: (s) => (saved = s) });
  const A = rt.api;
  assert.equal(A.Terminate(''), 'false');
  assert.equal(A.GetLastError(), '112');
  assert.equal(A.Initialize(''), 'true');
  assert.equal(A.Initialize(''), 'false');
  assert.equal(A.GetLastError(), '103');
  assert.equal(A.GetValue('cmi.score.raw'), '');
  assert.equal(A.GetLastError(), '403', 'belum di-set');
  assert.equal(A.GetValue('cmi.scaled_passing_score'), '0.8');
  assert.equal(A.SetValue('cmi.score.scaled', '1.5'), 'false');
  assert.equal(A.GetLastError(), '407');
  assert.equal(A.SetValue('cmi.completion_status', 'selesai'), 'false');
  assert.equal(A.GetLastError(), '406');
  assert.equal(A.SetValue('cmi.interactions.0.result', 'correct'), 'false');
  assert.equal(A.SetValue('cmi.interactions.0.id', 'q1'), 'true');
  assert.equal(A.SetValue('cmi.interactions.0.result', 'incorrect'), 'true');
  assert.equal(A.GetValue('cmi.interactions.0.result'), 'incorrect');
  assert.equal(A.SetValue('cmi.score.scaled', '0.67'), 'true');
  assert.equal(A.SetValue('cmi.completion_status', 'completed'), 'true');
  assert.equal(A.SetValue('cmi.session_time', 'PT2M30S'), 'true');
  assert.equal(A.SetValue('cmi.session_time', '00:02:30'), 'false', 'format 1.2 ditolak di 2004');
  assert.equal(A.Terminate(''), 'true');
  assert.equal(saved.success, 'failed', '0.67 < 0.8');
  assert.equal(saved.score, '67');
  assert.equal(saved.totalTime, 'PT2M30S');
  assert.equal(A.GetValue('cmi.location'), '');
  assert.equal(A.GetLastError(), '123');
});

test('SCORM 2004: adl.nav.request diteruskan ke player setelah Terminate', async () => {
  const got = [];
  const rt = new ScormRuntime({ version: '2004', context: { hasNext: true }, onNavRequest: (r) => got.push(r) });
  rt.api.Initialize('');
  assert.equal(rt.api.GetValue('adl.nav.request_valid.continue'), 'true');
  assert.equal(rt.api.SetValue('adl.nav.request', 'lompat'), 'false');
  assert.equal(rt.api.SetValue('adl.nav.request', 'continue'), 'true');
  rt.api.Terminate('');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['continue']);
});
