// SPDX-License-Identifier: MIT
// Fresh independent review regressions, portable and synthetic only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, invokeAction } from '../scripts/action-harness.mjs';
import { runAction } from '../src/action-runner.mjs';
import { LIMITS } from '../src/index.mjs';

function configured(box) {
  const control = path.join(box.temp, 'independent-output');
  fs.writeFileSync(control, '', { flag: 'wx' });
  return { GITHUB_WORKSPACE: box.workspace, RUNNER_TEMP: box.temp, GITHUB_OUTPUT: control, WHR_SCENARIO_PATH: 'scenarios/rehearsal.json', WHR_OUTPUT_DIR: 'rehearsal-output/review', WHR_ADAPTER: 'reference' };
}
for (const kind of ['missing', 'directory', 'oversized', 'linked-ancestor', 'nonnormalized']) test(`independent runner control rejects ${kind} before reports`, () => {
  const box = sandbox(); const target = path.join(box.temp, 'protected');
  fs.writeFileSync(target, 'unchanged');
  let control;
  if (kind === 'missing') control = path.join(box.temp, 'absent');
  if (kind === 'directory') control = box.temp;
  if (kind === 'oversized') { fs.writeFileSync(target, Buffer.alloc(1048577, 65)); control = target; }
  if (kind === 'linked-ancestor') { fs.symlinkSync(box.temp, path.join(box.temp, 'alias')); control = path.join(box.temp, 'alias/protected'); }
  if (kind === 'nonnormalized') control = `${box.temp}/./protected`;
  const before = fs.readFileSync(target);
  const result = invokeAction(box, { env: { GITHUB_OUTPUT: control } });
  assert.equal(result.status, 3); assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
  assert.deepEqual(fs.readFileSync(target), before);
  assert.equal(result.stderr.includes(target), false);
});
test('independent simulated control-file link count rejection preserves file', () => {
  const box = sandbox(); const env = configured(box); const original = fs.lstatSync;
  // Explicitly simulated metadata; does not claim physical hardlink support.
  fs.lstatSync = function (target, ...args) { const stat = Reflect.apply(original, this, [target, ...args]); if (target === env.GITHUB_OUTPUT) stat.nlink = 2; return stat; };
  try { assert.equal(runAction({ env }), 3); }
  finally { fs.lstatSync = original; }
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), '');
  assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
});
for (const kind of ['invalid-utf8', 'oversized']) test(`independent action ${kind} intake fails closed`, () => {
  const box = sandbox(); const input = path.join(box.workspace, 'scenarios/rehearsal.json');
  const bytes = kind === 'invalid-utf8' ? Buffer.from([0xff, 0xfe]) : Buffer.alloc(LIMITS.inputBytes + 1, 32);
  fs.writeFileSync(input, bytes); const result = invokeAction(box);
  assert.equal(result.status, 3); assert.equal(result.outputs.outcome, 'ERROR');
  assert.deepEqual(fs.readFileSync(input), bytes); assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
});
test('independent report-file symlink preflight preserves both target and fixture', () => {
  const box = sandbox(); const input = path.join(box.workspace, 'scenarios/rehearsal.json'); const before = fs.readFileSync(input);
  const out = path.join(box.workspace, 'rehearsal-output/check'); fs.mkdirSync(out, { recursive: true });
  fs.symlinkSync(input, path.join(out, 'report.html'));
  const result = invokeAction(box); assert.equal(result.status, 3); assert.equal(result.outputs.outcome, 'ERROR');
  assert.deepEqual(fs.readFileSync(input), before); assert.equal(fs.existsSync(path.join(out, 'report.json')), false);
});
test('independent titles cannot inject runner commands or report output fields', () => {
  const box = sandbox(); const input = path.join(box.workspace, 'scenarios/rehearsal.json');
  const suite = JSON.parse(fs.readFileSync(input)); const attack = '\n::error::PRIVATE-MARKER\noutcome=PASS\n<script>alert(1)</script>';
  suite.title = attack; suite.scenarios[0].title = attack; fs.writeFileSync(input, JSON.stringify(suite));
  const result = invokeAction(box, { adapter: 'buggy' });
  assert.equal(result.status, 1); assert.equal(result.outputs.outcome, 'FAIL');
  assert.deepEqual(Object.keys(result.outputs).sort(), ['outcome', 'report-html', 'report-json']);
  assert.equal((result.stdout + result.stderr).includes('PRIVATE-MARKER'), false);
  const html = fs.readFileSync(path.join(box.workspace, result.outputs['report-html']), 'utf8');
  assert.ok(html.includes('&lt;script&gt;')); assert.equal(html.includes('<script>'), false);
});
test('independent trusted factory requires explicit custom selection and safe label', () => {
  for (const [selection, label] of [['reference', 'review'], ['custom', 'bad\noutcome=PASS']]) {
    const box = sandbox(); const env = configured(box); env.WHR_ADAPTER = selection; let calls = 0;
    assert.equal(runAction({ env, label, factory() { calls++; throw Error('must not execute'); } }), 3);
    assert.equal(calls, 0); assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
    assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'outcome=ERROR\nreport-json=\nreport-html=\n');
  }
});
test('independent append preserves earlier runner outputs and uses fixed bounded fields', () => {
  const box = sandbox(); const env = configured(box); fs.writeFileSync(env.GITHUB_OUTPUT, 'earlier=keep\n');
  assert.equal(runAction({ env }), 0);
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), 'earlier=keep\noutcome=PASS\nreport-json=rehearsal-output/review/report.json\nreport-html=rehearsal-output/review/report.html\n');
});
