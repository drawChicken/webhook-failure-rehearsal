// SPDX-License-Identifier: MIT
// Private synthetic example. Developer selects/imports code here, never in JSON.
import { runText, referenceAdapter, renderReports, exitCode } from 'private-webhook-failure-rehearsal';
import { readInput, writeReports } from '../src/io.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = readInput(root, 'fixtures/rehearsal.json');

let observedAttempts = 0;
/** @type {import('../src/index.d.ts').AdapterFactory} */
const trustedDeveloperAdapter = initial => {
  const model = referenceAdapter(initial);
  return {
    handle(event, context) { observedAttempts++; return model.handle(event, context); },
    inspect() { return model.inspect(); },
  };
};
const report = runText(input.text, trustedDeveloperAdapter, 'trusted-wrapper-example');
writeReports(root, 'examples/output/trusted-adapter', renderReports(report), { force: true, inputAbsolute: input.absolute });
console.log(JSON.stringify({ outcome: report.outcome, observedAttempts }));
process.exitCode = exitCode(report);
