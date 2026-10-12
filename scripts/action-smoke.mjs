// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox, invokeAction } from './action-harness.mjs';
const cases = [
  { adapter: 'reference', expected: 'PASS', exit: 0 },
  { adapter: 'buggy', expected: 'FAIL', exit: 1 },
  { adapter: 'reference', scenario: 'scenarios/unknown-event.json', expected: 'UNSUPPORTED', exit: 2 },
  { adapter: 'reference', scenario: 'scenarios/version-mismatch.json', expected: 'UNSUPPORTED', exit: 2 },
  { adapter: 'custom', custom: true, expected: 'PASS', exit: 0 },
  { adapter: './untrusted.mjs', expected: 'ERROR', exit: 3 },
];
const results = [];
for (const probe of cases) {
  const box = sandbox(); const result = invokeAction(box, probe);
  assert.ifError(result.error); assert.equal(result.status, probe.exit, result.stderr);
  assert.equal(result.outputs.outcome, probe.expected);
  if (probe.expected !== 'ERROR') {
    const report = JSON.parse(fs.readFileSync(path.join(box.workspace, result.outputs['report-json']), 'utf8'));
    assert.equal(report.outcome, probe.expected);
    assert.ok(fs.readFileSync(path.join(box.workspace, result.outputs['report-html']), 'utf8').includes("script-src 'none'"));
  }
  results.push({ command: result.command, adapter: probe.adapter, scenario: probe.scenario || 'scenarios/rehearsal.json', exit: result.status, outputs: result.outputs });
}
console.log(JSON.stringify({ execution: 'local Bash composite commands with synthetic runner control files; NOT hosted Actions execution', runtime: process.version, results }, null, 2));
