// SPDX-License-Identifier: MIT
// Completion review: exercise actual commands and fail-closed output boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, invokeAction } from '../scripts/action-harness.mjs';
import { runAction } from '../src/action-runner.mjs';

function environment(box) {
  const control = path.join(box.temp, 'completion-output');
  fs.writeFileSync(control, '', { flag: 'wx' });
  return { GITHUB_WORKSPACE: box.workspace, RUNNER_TEMP: box.temp, GITHUB_OUTPUT: control, WHR_SCENARIO_PATH: 'scenarios/rehearsal.json', WHR_OUTPUT_DIR: 'rehearsal-output/completion', WHR_ADAPTER: 'reference' };
}
test('completion: real customer command fails a deliberately wrong oracle', () => {
  const box = sandbox();
  const target = path.join(box.workspace, 'scenarios/rehearsal.json');
  const fixture = JSON.parse(fs.readFileSync(target));
  fixture.scenarios[0].attempts[0].expect.state.sideEffects += 1;
  fs.writeFileSync(target, JSON.stringify(fixture));
  const result = invokeAction(box, { custom: true, adapter: 'custom' });
  assert.ifError(result.error); assert.equal(result.status, 1);
  assert.equal(result.outputs.outcome, 'FAIL');
  const report = JSON.parse(fs.readFileSync(path.join(box.workspace, result.outputs['report-json'])));
  assert.equal(report.adapter, 'customer-example');
  assert.ok(report.coverage.failedAssertions > 0);
});
test('completion: physical hardlinked runner control is refused without changing target', t => {
  const box = sandbox(); const env = environment(box); const alias = path.join(box.temp, 'hardlink');
  try { fs.linkSync(env.GITHUB_OUTPUT, alias); }
  catch (error) { if (['ENOTSUP', 'EOPNOTSUPP', 'EPERM'].includes(error.code)) { t.skip(`Physical hardlinks unavailable: ${error.code}`); return; } throw error; }
  assert.equal(runAction({ env: { ...env, GITHUB_OUTPUT: alias } }), 3);
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), '');
  assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
});
test('completion: runner inode change at open fails before report writes (simulated metadata)', () => {
  const box = sandbox(); const env = environment(box); const original = fs.fstatSync;
  fs.fstatSync = function (...args) { const stat = Reflect.apply(original, this, args); stat.ino += 1; return stat; };
  try { assert.equal(runAction({ env }), 3); }
  finally { fs.fstatSync = original; }
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), '');
  assert.equal(fs.existsSync(path.join(box.workspace, 'rehearsal-output')), false);
});
test('completion: runner output write failure cannot return PASS (injected I/O fault)', () => {
  const box = sandbox(); const env = environment(box); const original = fs.writeFileSync;
  fs.writeFileSync = function (target, data, ...args) {
    if (typeof target === 'number' && typeof data === 'string' && data.startsWith('outcome=')) throw Error('synthetic I/O failure');
    return Reflect.apply(original, this, [target, data, ...args]);
  };
  try { assert.equal(runAction({ env }), 3); }
  finally { fs.writeFileSync = original; }
  assert.equal(fs.readFileSync(env.GITHUB_OUTPUT, 'utf8'), '');
});
