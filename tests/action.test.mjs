// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, invokeAction } from '../scripts/action-harness.mjs';
for (const [adapter, scenario, outcome, status, custom] of [
  ['reference', 'rehearsal', 'PASS', 0, false], ['buggy', 'rehearsal', 'FAIL', 1, false],
  ['reference', 'unknown-event', 'UNSUPPORTED', 2, false], ['reference', 'version-mismatch', 'UNSUPPORTED', 2, false],
  ['custom', 'rehearsal', 'PASS', 0, true],
]) test(`action command: ${adapter}/${scenario} exposes ${outcome} and exit ${status}`, () => {
  const box = sandbox(); const source = fs.readFileSync(path.join(box.workspace, `scenarios/${scenario}.json`));
  const r = invokeAction(box, { adapter, scenario: `scenarios/${scenario}.json`, custom });
  assert.ifError(r.error); assert.equal(r.status, status, r.stderr); assert.equal(r.outputs.outcome, outcome);
  const report = JSON.parse(fs.readFileSync(path.join(box.workspace, r.outputs['report-json'])));
  assert.equal(report.outcome, outcome); assert.equal(fs.existsSync(path.join(box.workspace, r.outputs['report-html'])), true);
  assert.deepEqual(fs.readFileSync(path.join(box.workspace, `scenarios/${scenario}.json`)), source);
});
test('action defaults do not execute custom modules or shell input', () => {
  for (const adapter of ['custom', './evil.mjs', 'reference; touch HACKED', '$(touch HACKED)', 'reference\noutcome=PASS']) {
    const box = sandbox(); const r = invokeAction(box, { adapter });
    assert.equal(r.status, 3); assert.equal(r.outputs.outcome, 'ERROR');
    assert.equal(fs.existsSync(path.join(box.workspace, 'HACKED')), false);
  }
});
test('action scenario path and output path reject traversal, injection and newlines', () => {
  for (const value of ['../secret.json', '/secret.json', 'scenarios//rehearsal.json', '$(touch HACKED)', 'a\noutcome=PASS', 'scenarios\\rehearsal.json']) {
    for (const option of ['scenario', 'output']) {
      const box = sandbox(); const r = invokeAction(box, { [option]: value });
      assert.equal(r.status, 3); assert.equal(r.outputs.outcome, 'ERROR'); assert.equal(r.outputs['report-json'], '');
      assert.equal(fs.existsSync(path.join(box.workspace, 'HACKED')), false);
    }
  }
});
test('action refuses pre-existing output with no overwrite option', () => {
  const box = sandbox(); assert.equal(invokeAction(box).status, 0);
  const file = path.join(box.workspace, 'rehearsal-output/check/report.json'); const before = fs.readFileSync(file);
  const repeat = invokeAction(box); assert.equal(repeat.status, 3); assert.equal(repeat.outputs.outcome, 'ERROR');
  assert.deepEqual(fs.readFileSync(file), before);
});
test('action refuses linked input, linked output directory and linked runner control file', () => {
  const box = sandbox(); fs.symlinkSync('rehearsal.json', path.join(box.workspace, 'scenarios/link.json'));
  assert.equal(invokeAction(box, { scenario: 'scenarios/link.json' }).status, 3);
  fs.mkdirSync(path.join(box.workspace, 'rehearsal-output')); fs.symlinkSync(box.temp, path.join(box.workspace, 'rehearsal-output/check'));
  assert.equal(invokeAction(box).status, 3);
  const target = path.join(box.temp, 'protected'); fs.writeFileSync(target, 'DO NOT CHANGE');
  const link = path.join(box.temp, 'link'); fs.symlinkSync(target, link);
  assert.equal(invokeAction(box, { env: { GITHUB_OUTPUT: link } }).status, 3);
  assert.equal(fs.readFileSync(target, 'utf8'), 'DO NOT CHANGE');
});
test('action cannot append outputs to workspace or a file outside runner temp', () => {
  const box = sandbox(); const target = path.join(box.workspace, 'scenarios/rehearsal.json'); const before = fs.readFileSync(target);
  for (const env of [{ GITHUB_OUTPUT: target }, { GITHUB_OUTPUT: target, RUNNER_TEMP: box.workspace }]) assert.equal(invokeAction(box, { env }).status, 3);
  assert.deepEqual(fs.readFileSync(target), before);
});
test('untrusted JSON cannot select custom code, unsupported input fails without an execution', () => {
  const box = sandbox(); const target = path.join(box.workspace, 'scenarios/rehearsal.json');
  const data = JSON.parse(fs.readFileSync(target)); data.adapter = './evil.mjs'; fs.writeFileSync(target, JSON.stringify(data));
  const r = invokeAction(box); assert.equal(r.status, 2); assert.equal(r.outputs.outcome, 'UNSUPPORTED');
  const report = JSON.parse(fs.readFileSync(path.join(box.workspace, r.outputs['report-json']))); assert.equal(report.coverage.executedAttempts, 0);
});
test('action reports are byte deterministic across distinct workspaces and do not leak host paths', () => {
  const boxes = [sandbox(), sandbox()]; const reports = boxes.map(box => { const r = invokeAction(box); assert.equal(r.status, 0); return ['report-json', 'report-html'].map(key => fs.readFileSync(path.join(box.workspace, r.outputs[key]), 'utf8')); });
  assert.deepEqual(reports[0], reports[1]); for (const box of boxes) assert.equal(reports[0].join('').includes(box.workspace), false);
});
