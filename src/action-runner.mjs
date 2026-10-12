// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { checkRoot, readInput, writeReports } from './io.mjs';
import { runText, exitCode } from './runner.mjs';
import { referenceAdapter, buggyAdapter } from './adapters.mjs';
import { renderReports } from './report.mjs';

function absoluteRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value !== path.resolve(value)) throw Error('normalized root required');
  checkRoot(value); return value;
}
function within(root, target) { const r = path.relative(root, target); return r === '' || (!r.startsWith(`..${path.sep}`) && r !== '..' && !path.isAbsolute(r)); }
function outputDescriptor(env, workspace) {
  // Runner-owned control file is the only write outside the report workspace.
  // No file is created, followed through links, read for content or selected by JSON.
  const temp = absoluteRoot(env.RUNNER_TEMP);
  if (within(temp, workspace) || within(workspace, temp)) throw Error('runner temp and workspace must be disjoint');
  const target = env.GITHUB_OUTPUT;
  if (typeof target !== 'string' || !path.isAbsolute(target) || target !== path.resolve(target) || !within(temp, target)) throw Error('runner output outside temp');
  checkRoot(path.dirname(target));
  const before = fs.lstatSync(target);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 1048576) throw Error('unsafe runner output');
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
  const opened = fs.fstatSync(fd);
  if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > 1048576) { fs.closeSync(fd); throw Error('runner output changed'); }
  return fd;
}

// Explicit code integration only. The environment/JSON cannot import a factory.
// Trusted factory code has process privileges; this is NOT a sandbox.
export function runAction({ factory = null, label = 'trusted-custom', env = process.env } = {}) {
  let fd = null;
  let outcome = 'ERROR'; let files = []; let status = 3;
  try {
    const workspace = absoluteRoot(env.GITHUB_WORKSPACE);
    fd = outputDescriptor(env, workspace);
    if (Number(process.versions.node.split('.')[0]) !== 22) throw Error('Node 22 required');
    const selection = env.WHR_ADAPTER || 'reference';
    let chosen;
    if (factory !== null) {
      if (selection !== 'custom' || typeof factory !== 'function') throw Error('explicit custom selection required');
      chosen = factory;
    } else {
      if (!['reference', 'buggy'].includes(selection)) throw Error('bundled selection required');
      chosen = selection === 'reference' ? referenceAdapter : buggyAdapter;
      label = selection;
    }
    const output = env.WHR_OUTPUT_DIR || 'rehearsal-output/action';
    if (!/^rehearsal-output\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(output)) throw Error('bounded output required');
    const input = readInput(workspace, env.WHR_SCENARIO_PATH);
    const report = runText(input.text, chosen, label);
    writeReports(workspace, output, renderReports(report), { inputAbsolute: input.absolute });
    files = [`${output}/report.json`, `${output}/report.html`];
    outcome = report.outcome; status = exitCode(report);
    // Fixed-label JSON only: never emit payload, fixture titles, credentials or raw adapter exceptions.
    console.log(JSON.stringify({ outcome, adapter: label, coverage: report.coverage }));
  } catch {
    console.error('Webhook Failure Rehearsal operational error: check Node 22, trusted adapter selection, bounded paths, fresh output directory and runner control-file permissions. No input or exception details emitted.');
  } finally {
    if (fd !== null) {
      try { fs.writeFileSync(fd, `outcome=${outcome}\nreport-json=${files[0] || ''}\nreport-html=${files[1] || ''}\n`); }
      catch { status = 3; console.error('Webhook Failure Rehearsal could not write runner outputs.'); }
      finally { fs.closeSync(fd); }
    }
  }
  return status;
}
