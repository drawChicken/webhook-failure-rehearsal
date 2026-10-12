import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runSuite, runText, referenceAdapter, buggyAdapter, renderReports, SyntheticCommitFailure } from '../src/index.mjs';
import { suite, event, state } from './helpers.mjs';
const fixture = () => JSON.parse(fs.readFileSync(new URL('../fixtures/rehearsal.json', import.meta.url), 'utf8'));
const reference = () => runSuite(fixture(), referenceAdapter, 'reference');

test('full independently authored synthetic fixture passes reference assertions', () => {
  const r = reference(); assert.equal(r.outcome, 'PASS'); assert.equal(r.coverage.executedAttempts, 11);
  assert.equal(r.coverage.passedAssertions, 11); assert.equal(r.coverage.failedAssertions, 0);
  assert.equal(r.coverage.initialStateChecks, 4); assert.equal(r.coverage.unevaluatedAttempts, 0);
});
test('duplicate delivery has one ledger entry and one effect', () => {
  const trace = reference().scenarios[0].trace; assert.deepEqual(trace.map(t => t.actual.result), ['APPLIED', 'DUPLICATE', 'DUPLICATE']);
  assert.deepEqual(trace.map(t => t.actual.state.sideEffects), [1, 1, 1]);
  assert.deepEqual(trace[2].actual.state.processed, ['evt_activate']);
});
test('reordered old snapshots cannot regress fixture revision', () => {
  const trace = reference().scenarios[1].trace;
  assert.deepEqual(trace.map(t => t.actual.state.resources[0].revision), [3, 3, 3]);
  assert.deepEqual(trace.map(t => t.actual.result), ['APPLIED', 'STALE', 'STALE']);
});
test('failure before commit leaves idempotency, resource and effect unchanged; retry once', () => {
  const s = reference().scenarios[2]; const [failure, retry, duplicate] = s.trace;
  assert.deepEqual(failure.actual.state, fixture().scenarios[2].initial);
  assert.equal(failure.actual.result, 'ERROR'); assert.equal(retry.actual.result, 'APPLIED');
  assert.deepEqual(retry.actual.state, duplicate.actual.state); assert.equal(duplicate.actual.state.sideEffects, 1);
});
test('same revision under new ID does not repeat effect', () => {
  const t = reference().scenarios[3].trace[1]; assert.equal(t.actual.result, 'STALE');
  assert.equal(t.actual.state.sideEffects, 1); assert.equal(t.actual.state.processed.length, 2);
});
test('buggy control independently fails duplicate and reordered scenarios', () => {
  const r = runSuite(fixture(), buggyAdapter, 'buggy'); assert.equal(r.outcome, 'FAIL');
  for (const id of ['duplicate', 'reordered', 'retry-after-failure', 'same-revision-new-id']) assert.equal(r.scenarios.find(s => s.id === id).outcome, 'FAIL');
  assert.ok(r.scenarios[0].trace[1].mismatches.some(m => m.path === '$.state.sideEffects'));
  assert.ok(r.scenarios[1].trace[1].mismatches.some(m => m.path === '$.state.resources'));
  assert.ok(r.scenarios[2].trace[0].mismatches.some(m => m.path === '$.state.processed'));
});
test('chronological indexes and fixture events are retained', () => {
  const r = reference(); r.scenarios.forEach((s, i) => {
    assert.deepEqual(s.trace.map(t => t.attempt), fixture().scenarios[i].attempts.map((_, j) => j + 1));
    assert.deepEqual(s.trace.map(t => t.event), fixture().scenarios[i].attempts.map(a => a.event));
  });
});
test('each scenario receives fresh adapter state', () => {
  let calls = 0; const s = suite(); const second = structuredClone(s.scenarios[0]); second.id = 'second'; s.scenarios.push(second);
  const r = runSuite(s, initial => { calls++; assert.deepEqual(initial, state()); return referenceAdapter(initial); });
  assert.equal(calls, 2); assert.equal(r.outcome, 'PASS');
});
test('unknown and future-profile fixtures execute no code', () => {
  for (const name of ['unknown-event', 'version-mismatch']) {
    let calls = 0; const r = runText(fs.readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'), () => { calls++; });
    assert.equal(r.outcome, 'UNSUPPORTED'); assert.equal(calls, 0); assert.equal(r.coverage.executedAttempts, 0); assert.equal(r.coverage.declaredAttempts, null);
  }
});
test('divergent duplicate payload blocks entire suite before earlier valid execution', () => {
  const s = fixture(); s.scenarios[0].attempts[1].event.data.revision = 4;
  let calls = 0; const r = runSuite(s, () => { calls++; }); assert.equal(r.outcome, 'UNSUPPORTED'); assert.equal(calls, 0);
});
test('wrong oracle fails even if handler succeeds', () => {
  const s = suite(); s.scenarios[0].attempts[0].expect.state.sideEffects = 2;
  const r = runSuite(s, referenceAdapter); assert.equal(r.outcome, 'FAIL');
  assert.deepEqual(r.scenarios[0].trace[0].mismatches, [{ path: '$.state.sideEffects', expected: 2, actual: 1 }]);
});
test('unexpected handler exception is not an accepted injected failure', () => {
  const s = suite(); s.scenarios[0].attempts[0].failBeforeCommit = true; s.scenarios[0].attempts[0].expect = { result: 'ERROR', state: state() };
  const r = runSuite(s, initial => ({ handle() { throw Error('secret should not appear'); }, inspect() { return initial; } }));
  assert.equal(r.outcome, 'FAIL'); assert.ok(!JSON.stringify(r).includes('secret should not appear'));
});
test('selected SyntheticCommitFailure can be asserted by a trusted adapter', () => {
  const s = suite(); s.scenarios[0].attempts[0].failBeforeCommit = true; s.scenarios[0].attempts[0].expect = { result: 'ERROR', state: state() };
  assert.equal(runSuite(s, initial => ({ handle() { throw new SyntheticCommitFailure(); }, inspect() { return initial; } })).outcome, 'PASS');
});
test('invalid inspection state, initial mismatch and broken factory fail closed', () => {
  assert.equal(runSuite(suite(), () => ({ handle() {}, inspect() { return {}; } })).outcome, 'FAIL');
  assert.equal(runSuite(suite(), () => referenceAdapter(state([], [], 1))).outcome, 'FAIL');
  const r = runSuite(suite(), () => { throw Error('setup'); }); assert.equal(r.outcome, 'FAIL'); assert.equal(r.coverage.unevaluatedAttempts, 1);
});
test('invalid state after handler stops remaining attempts', () => {
  const s = fixture(); let first = true;
  const r = runSuite(s, initial => ({ handle() { first = false; return 'APPLIED'; }, inspect() { return first ? initial : {}; } }));
  assert.equal(r.outcome, 'FAIL'); assert.ok(r.coverage.unevaluatedAttempts > 0);
});
test('async adapter is rejected, not silently passed', () => {
  const r = runSuite(suite(), initial => ({ async handle() { return 'APPLIED'; }, inspect() { return initial; } })); assert.equal(r.outcome, 'FAIL');
});
test('adapter mutation cannot rewrite oracle or source fixture', () => {
  const s = suite(); const before = JSON.stringify(s);
  const r = runSuite(s, initial => ({ handle(e) { e.data.status = 'canceled'; return 'APPLIED'; }, inspect() { return initial; } }));
  assert.equal(r.outcome, 'FAIL'); assert.equal(JSON.stringify(s), before);
});
test('deterministic reports contain no clock calls or current-time data', () => {
  const original = Date.now; Date.now = () => { throw Error('wall clock forbidden'); };
  try { assert.deepEqual(renderReports(reference()), renderReports(reference())); } finally { Date.now = original; }
});
test('input object key order does not change fingerprint', () => {
  const s = suite(); const a = runSuite(s, referenceAdapter);
  const reordered = Object.fromEntries(Object.entries(s).reverse()); assert.equal(runSuite(reordered, referenceAdapter).inputFingerprint, a.inputFingerprint);
});
test('hostile report content is escaped and no active assets/scripts included', () => {
  const s = suite(); s.title = '</pre><script>alert("x")</script><img src="https://evil.invalid/" onerror="x">&\'';
  const { html } = renderReports(runSuite(s, referenceAdapter));
  assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img'));
  assert.ok(!/<(?:link|iframe|script)\b/i.test(html)); assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes("connect-src 'none'"));
  for (const text of ['SYNTHETIC WEBHOOK REHEARSAL / NO LIVE PROVIDER VERIFICATION', 'SYNTHETIC', 'Unsupported cases', 'Exact coverage', 'No production or billing-safety assurance']) assert.ok(html.includes(text));
});
test('unsupported malformed JSON report cannot claim confirmed provenance or PASS', () => {
  const r = runText('{', referenceAdapter); const { html } = renderReports(r);
  assert.equal(r.outcome, 'UNSUPPORTED'); assert.equal(r.synthetic, null); assert.ok(html.includes('UNVERIFIED'));
});
test('reference inspect is detached and handles multiple resources', () => {
  const a = referenceAdapter(state()); a.handle(event(), { failBeforeCommit: false });
  const s = a.inspect(); s.sideEffects = 999;
  a.handle(event('evt_two', 1, 'trialing', 'sub_other'), { failBeforeCommit: false });
  assert.equal(a.inspect().sideEffects, 2); assert.equal(a.inspect().resources.length, 2);
});
test('failed stale transaction does not prematurely commit ledger', () => {
  const a = referenceAdapter(state([{ id: 'sub_demo', revision: 3, status: 'canceled' }]));
  assert.throws(() => a.handle(event(), { failBeforeCommit: true }), SyntheticCommitFailure);
  assert.deepEqual(a.inspect().processed, []); assert.equal(a.handle(event(), { failBeforeCommit: false }), 'STALE');
  assert.equal(a.inspect().sideEffects, 0);
});
