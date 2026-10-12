// SPDX-License-Identifier: MIT
// Portable 1.0 regressions. Historical reviewer/fix files remain byte-for-byte unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { suite, state, event } from './helpers.mjs';
import { runSuite, runText, referenceAdapter, buggyAdapter, renderReports } from '../src/index.mjs';
import { readInput, writeReports } from '../src/io.mjs';
import { customerAdapter } from '../examples/customer-adapter.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
const workspace = () => fs.mkdtempSync(path.join(root, '.tmp/release-'));

for (const mode of ['factory', 'initial-inspect', 'handle', 'post-handle-inspect']) {
  test(`portable R1 ${mode}: native/cross-realm rejected Promise contained; counts/redaction preserved`, () => {
    const source = `
      import assert from 'node:assert/strict';
      import vm from 'node:vm';
      import { runSuite, referenceAdapter } from './src/index.mjs';
      const mode = ${JSON.stringify(mode)}; const input = ${JSON.stringify(suite())};
      input.scenarios[0].attempts = Array.from({length:3}, () => structuredClone(input.scenarios[0].attempts[0]));
      let reads = 0; const results = [];
      for (const crossRealm of [false, true]) {
        function rejection() {
          const p = crossRealm ? vm.runInNewContext('Promise.reject(Error("private-detail"))') : Promise.reject(Error('private-detail'));
          for (const key of ['then', 'catch']) Object.defineProperty(p, key, {get() { reads++; throw Error('getter'); }});
          return p;
        }
        const report = runSuite(input, initial => {
          if (mode === 'factory') return rejection();
          const model = referenceAdapter(initial); let handled = false;
          return { handle(e,c) { handled = true; return mode === 'handle' ? rejection() : model.handle(e,c); },
            inspect() { return mode === 'initial-inspect' || (handled && mode === 'post-handle-inspect') ? rejection() : model.inspect(); } };
        });
        assert.equal(report.outcome, 'FAIL');
        const executed = ['handle','post-handle-inspect'].includes(mode) ? 1 : 0;
        assert.equal(report.coverage.executedAttempts, executed); assert.equal(report.coverage.failedAssertions, executed);
        assert.equal(report.coverage.unevaluatedAttempts, 3-executed); assert.equal(report.coverage.initialStateChecks, executed);
        assert.equal(JSON.stringify(report).includes('private-detail'), false); results.push(report);
      }
      assert.equal(reads, 0); assert.deepEqual(results[0], results[1]); setImmediate(() => console.log('DRAINED'));
    `;
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '--eval', source], { cwd: root, encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.stderr, ''); assert.match(child.stdout, /DRAINED/);
  });
  test(`portable R1 ${mode}: thenable getters untouched and fulfilled Promise unsupported`, () => {
    let reads = 0;
    for (const value of [() => ({ get then() { reads++; throw Error('not data'); } }), () => Promise.resolve(null)]) {
      const r = runSuite(suite(), initial => {
        if (mode === 'factory') return value();
        let handled = false; const model = referenceAdapter(initial);
        return { handle(e,c) { handled = true; return mode === 'handle' ? value() : model.handle(e,c); }, inspect() { return mode === 'initial-inspect' || (handled && mode === 'post-handle-inspect') ? value() : model.inspect(); } };
      });
      assert.equal(r.outcome, 'FAIL');
    }
    assert.equal(reads, 0);
  });
}
for (const alias of ['rehearsal-output/check/REPORT.json', 'rehearsal-output/CHECK/report.json', 'rehearsal-output/CHECK/REPORT.html']) test(`portable R2 case alias ${alias}`, t => {
  const dir = workspace(); const files = writeReports(dir, 'rehearsal-output/check', renderReports(runSuite(suite(), referenceAdapter)));
  const inputAbsolute = path.join(dir, alias);
  try { const a = fs.statSync(inputAbsolute); const b = fs.statSync(alias.endsWith('html') ? files[1] : files[0]); assert.equal(a.ino, b.ino); assert.equal(a.dev, b.dev); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Case-sensitive filesystem: no case alias exists'); return; } throw error; }
  const before = files.map(f => fs.readFileSync(f));
  assert.throws(() => writeReports(dir, 'rehearsal-output/check', renderReports(runSuite(suite(), buggyAdapter)), { force: true, inputAbsolute }), /collides with input identity/);
  assert.deepEqual(files.map(f => fs.readFileSync(f)), before);
});
test('portable R2 invalid protected input and both-file preflight preserve outputs', () => {
  const dir = workspace(); const rendered = renderReports(runSuite(suite(), referenceAdapter)); const files = writeReports(dir, 'rehearsal-output/check', rendered);
  fs.symlinkSync(files[0], path.join(dir, 'alias.json')); const before = files.map(f => fs.readFileSync(f));
  for (const inputAbsolute of [files[0], path.join(dir, 'missing.json'), path.join(dir, 'alias.json'), path.join(root, 'fixtures/rehearsal.json')]) {
    assert.throws(() => writeReports(dir, 'rehearsal-output/check', rendered, { force: true, inputAbsolute }));
    assert.deepEqual(files.map(f => fs.readFileSync(f)), before);
  }
  fs.writeFileSync(files[1], 'unrelated'); assert.throws(() => writeReports(dir, 'rehearsal-output/check', rendered, { force: true })); assert.deepEqual(fs.readFileSync(files[0]), before[0]);
});
test('portable CLI explicitly uses separate workspace and protects real case aliases', t => {
  const dir = workspace(); fs.copyFileSync(path.join(root, 'fixtures/rehearsal.json'), path.join(dir, 'input.json'));
  const args = [path.join(root, 'src/cli.mjs'), '--workspace', dir, '--input', 'input.json', '--adapter', 'reference', '--out', 'rehearsal-output/cli'];
  const run = options => spawnSync(process.execPath, options, { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(run(args).status, 0); const j = path.join(dir, 'rehearsal-output/cli/report.json'); const h = path.join(dir, 'rehearsal-output/cli/report.html'); const before = [j, h].map(p => fs.readFileSync(p));
  if (!fs.existsSync(path.join(dir, 'rehearsal-output/cli/REPORT.json'))) { t.skip('Explicit workspace passed; case alias absent on this filesystem'); return; }
  const aliasArgs = [...args]; aliasArgs[aliasArgs.indexOf('--input')+1] = 'rehearsal-output/cli/REPORT.json';
  const result = run([...aliasArgs, '--force']); assert.equal(result.status, 3); assert.match(result.stderr, /collides with input identity/); assert.deepEqual([j,h].map(p => fs.readFileSync(p)), before);
});
test('customer integration exercises separate business component against bundled oracle', () => {
  const input = readInput(root, 'fixtures/rehearsal.json'); const r = runText(input.text, customerAdapter, 'customer-example');
  assert.equal(r.outcome, 'PASS'); assert.equal(r.coverage.executedAttempts, 11);
  const fail = runText(input.text, initial => { const app = customerAdapter(initial); return { inspect: app.inspect, handle(e,c) { app.handle(e,c); return 'APPLIED'; } }; });
  assert.equal(fail.outcome, 'FAIL');
});
test('portable repeated failures, stale retry and duplicate assertions preserve transaction', () => {
  const s = suite(); const sc = s.scenarios[0]; const newer = event('evt_new', 2); const older = event('evt_old', 1, 'trialing');
  sc.initial = state([older.data], [], 7); const after = state([newer.data], ['evt_new'], 8); const complete = state([newer.data], ['evt_new', 'evt_old'], 8);
  const a = (e,result,s,failBeforeCommit=false) => ({ event:e, failBeforeCommit, expect:{result,state:s} });
  sc.attempts = [a(newer,'ERROR',sc.initial,true),a(newer,'ERROR',sc.initial,true),a(newer,'APPLIED',after),a(newer,'DUPLICATE',after),a(older,'ERROR',after,true),a(older,'STALE',complete),a(older,'DUPLICATE',complete)];
  assert.equal(runSuite(s, referenceAdapter).outcome, 'PASS'); assert.equal(runSuite(s, customerAdapter).outcome, 'PASS'); assert.equal(runSuite(s, buggyAdapter).outcome, 'FAIL');
});
test('portable unsupported provenance, escaped duplicate keys and JSON code selection execute nothing', () => {
  const samples = [];
  for (const modify of [s => {s.scenarios=[];}, s=>{s.adapter='./evil.mjs';}, s=>{s.apiProfile='future';}, s=>{s.scenarios[0].initial.processed=['evt_one'];}, s=>{s.scenarios[0].attempts[0].event.created=1;}, s=>{s.scenarios[0].initial.resources=[{...event().data,status:'canceled'}];}, s=>{s.scenarios[0].attempts.push({...s.scenarios[0].attempts[0],event:event('evt_one',2)});}]) {
    const s = suite(); modify(s); samples.push(JSON.stringify(s));
  }
  samples.push(JSON.stringify(suite()).replace('"schemaVersion":1', '"schemaVersion":0,"\\u0073chemaVersion":1'));
  samples.push(JSON.stringify(suite()).replace('"revision":1', '"revision":0,"\\u0072evision":1'));
  for (const input of samples) { let called=0; const r=runText(input,()=>{called++;throw Error('must not run');}); assert.equal(r.outcome,'UNSUPPORTED'); assert.equal(called,0); assert.equal(r.coverage.declaredAttempts,null); }
});
test('portable trusted getters allowed but data accessors and prototypes rejected without evaluation', () => {
  let calls=0;
  class Trusted { constructor(initial){this.model=referenceAdapter(initial);} get handle(){calls++;return (e,c)=>this.model.handle(e,c);} inspect(){return this.model.inspect();} }
  assert.equal(runSuite(suite(),initial=>new Trusted(initial)).outcome,'PASS'); assert.ok(calls>0); calls=0;
  const s=suite(); Object.defineProperty(s,'title',{enumerable:true,get(){calls++;return 'bad';}}); assert.equal(runSuite(s,referenceAdapter).outcome,'UNSUPPORTED');
  const r=runSuite(suite(),initial=>({handle(){return 'APPLIED';},inspect(){Object.defineProperty(initial,'sideEffects',{enumerable:true,get(){calls++;return 0;}});return initial;}})); assert.equal(r.outcome,'FAIL'); assert.equal(calls,0);
  const nonplain=suite(); Object.setPrototypeOf(nonplain.scenarios[0].initial,{x:1}); assert.equal(runSuite(nonplain,referenceAdapter).outcome,'UNSUPPORTED');
});
test('readable per-scenario summary remains escaped, actionable and deterministic', () => {
  const s = JSON.parse(readInput(root,'fixtures/rehearsal.json').text);
  s.title = '<script>bad()</script><img src="https://invalid/">'; s.scenarios[0].title = '<a href="bad">bad</a>';
  const report = runSuite(s,buggyAdapter,'buggy'); const first = renderReports(report); assert.deepEqual(renderReports(runSuite(s,buggyAdapter,'buggy')),first);
  for (const text of ['Scenario results: expected / actual','Expected result:','Actual result:','Commit the event ID','Check duplicate guards','Check revision comparison']) assert.ok(first.html.includes(text),text);
  assert.equal(/<(script|img|a|iframe|link)\b/i.test(first.html),false); assert.equal((first.html.match(/<style>/g)||[]).length,1); assert.ok(first.html.includes("connect-src 'none'"));
});
