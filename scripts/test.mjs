// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
// Historical review tests write outside the package and/or assume case-insensitive NAS.
// They stay unchanged in the authoring tree, rerun separately with receipt routing.
const tests = ['contract', 'runner', 'io', 'release', 'action', 'final-review', 'completion'].map(name => `tests/${name}.test.mjs`);
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: path.join(root, '.tmp') } });
process.exitCode = result.status ?? 3;
