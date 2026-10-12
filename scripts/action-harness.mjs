// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function sandbox() {
  fs.mkdirSync(path.join(kit, '.tmp'), { recursive: true });
  const base = fs.mkdtempSync(path.join(kit, '.tmp/action-'));
  const workspace = path.join(base, 'customer-workspace');
  const temp = path.join(base, 'runner-temp');
  fs.mkdirSync(workspace); fs.mkdirSync(temp); fs.mkdirSync(path.join(workspace, 'scenarios'));
  for (const name of ['rehearsal', 'unknown-event', 'version-mismatch']) fs.copyFileSync(path.join(kit, `fixtures/${name}.json`), path.join(workspace, `scenarios/${name}.json`));
  return { base, workspace, temp };
}
export function invokeAction(box, { adapter = 'reference', scenario = 'scenarios/rehearsal.json', output = 'rehearsal-output/check', custom = false, env = {} } = {}) {
  const control = path.join(box.temp, `outputs-${fs.readdirSync(box.temp).length}.txt`);
  fs.writeFileSync(control, '', { flag: 'wx' });
  // Run the literal run command from action.yml, not a facsimile CLI shortcut.
  const metadata = fs.readFileSync(path.join(kit, 'action.yml'), 'utf8');
  const commands = [...metadata.matchAll(/^      run: (.+)$/gm)].map(m => m[1]);
  if (commands.length !== 1 || commands[0] !== 'node "$WHR_ACTION_PATH/src/action.mjs"') throw Error('smoke harness requires review for changed composite command');
  const command = custom ? 'node "$WHR_ACTION_PATH/examples/customer-action.mjs"' : commands[0];
  const execution = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command], {
    cwd: box.workspace, encoding: 'utf8', timeout: 20000, maxBuffer: 1048576,
    // Minimal synthetic runner environment: no inherited secrets or GitHub token.
    env: { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, TMPDIR: box.temp, GITHUB_WORKSPACE: box.workspace, RUNNER_TEMP: box.temp, GITHUB_OUTPUT: control, WHR_ACTION_PATH: kit, WHR_SCENARIO_PATH: scenario, WHR_OUTPUT_DIR: output, WHR_ADAPTER: adapter, ...env },
  });
  const outputs = Object.fromEntries(fs.readFileSync(control, 'utf8').trimEnd().split('\n').filter(Boolean).map(line => { const n = line.indexOf('='); return [line.slice(0, n), line.slice(n + 1)]; }));
  return { ...execution, outputs, command, control };
}
