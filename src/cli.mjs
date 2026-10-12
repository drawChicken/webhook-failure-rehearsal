// SPDX-License-Identifier: MIT
import path from 'node:path';

import { referenceAdapter, buggyAdapter } from './adapters.mjs';
import { runText, exitCode } from './runner.mjs';
import { renderReports } from './report.mjs';
import { readInput, writeReports } from './io.mjs';

const usage = 'Usage: node src/cli.mjs [--workspace /absolute/workspace] --input fixtures/rehearsal.json --adapter reference|buggy --out rehearsal-output/<name> [--force]';
function options(args) {
  const result = { force: false }; const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--workspace', '--input', '--adapter', '--out', '--force'].includes(arg) || seen.has(arg)) throw Error('unknown/duplicate argument');
    seen.add(arg);
    if (arg === '--force') result.force = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) throw Error('missing argument value'); result[arg.slice(2)] = value; }
  }
  if (!result.input || !result.out || !['reference', 'buggy'].includes(result.adapter)) throw Error('required input/output and bundled adapter selection');
  return result;
}
try {
  if (process.argv.length === 3 && process.argv[2] === '--help') console.log(usage);
  else {
    const opts = options(process.argv.slice(2));
    const root = opts.workspace ?? process.cwd();
    if (!path.isAbsolute(root) || root !== path.resolve(root)) throw Error('normalized absolute workspace required');
    const input = readInput(root, opts.input);
    const report = runText(input.text, opts.adapter === 'reference' ? referenceAdapter : buggyAdapter, opts.adapter);
    const rendered = renderReports(report);
    writeReports(root, opts.out, rendered, { force: opts.force, inputAbsolute: input.absolute });
    console.log(JSON.stringify({ outcome: report.outcome, coverage: report.coverage, output: opts.out }));
    process.exitCode = exitCode(report);
  }
} catch (error) {
  // No payload or arbitrary adapter error text is emitted by this bundled CLI.
  console.error(`Operational error: ${error.code || error.message}\n${usage}`); process.exitCode = 3;
}
