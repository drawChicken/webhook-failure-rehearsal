// SPDX-License-Identifier: MIT
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  ['reference', 'rehearsal', 'reference', 0],
  ['buggy', 'rehearsal', 'buggy', 1],
  ['reference', 'unknown-event', 'unknown-event', 2],
  ['reference', 'version-mismatch', 'version-mismatch', 2],
];
for (const [adapter, fixture, output, expected] of cases) {
  const child = spawnSync(process.execPath, ['src/cli.mjs', '--input', `fixtures/${fixture}.json`, '--adapter', adapter, '--out', `examples/output/${output}`, '--force'], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 });
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
  if (child.error || child.status !== expected) { console.error(`Demo ${output}: expected exit ${expected}, received ${child.status}`); process.exitCode = 3; break; }
}
