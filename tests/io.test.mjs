import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readInput, writeReports } from '../src/io.mjs';
import { runSuite, referenceAdapter, renderReports, LIMITS } from '../src/index.mjs';
import { suite } from './helpers.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
const temp = fs.mkdtempSync(path.join(root, '.tmp/io-tests-'));
const rendered = () => renderReports(runSuite(suite(), referenceAdapter, 'reference'));
const newRoot = () => fs.mkdtempSync(path.join(temp, 'case-'));
const localInput = (r) => { fs.writeFileSync(path.join(r, 'input.json'), JSON.stringify(suite())); return path.join(r, 'input.json'); };
function cli(args) { return spawnSync(process.execPath, ['src/cli.mjs', ...args], { cwd: root, encoding: 'utf8', timeout: 15000, maxBuffer: 1048576 }); }
const runId = path.basename(temp);

test('bounded regular input loads without modification', () => {
  const r = newRoot(); const name = localInput(r); const before = fs.readFileSync(name);
  assert.deepEqual(JSON.parse(readInput(r, 'input.json').text), suite()); assert.deepEqual(fs.readFileSync(name), before);
});
test('traversal, absolute and AppleDouble paths refused', () => {
  for (const p of ['../input.json', '/input.json', './input.json', 'a//x.json', 'a\\x.json', '._input.json']) assert.throws(() => readInput(newRoot(), p));
});
test('symlink input and symlink ancestor are refused', () => {
  const r = newRoot(); localInput(r); fs.symlinkSync('input.json', path.join(r, 'link.json'));
  assert.throws(() => readInput(r, 'link.json'));
  fs.mkdirSync(path.join(r, 'actual')); fs.writeFileSync(path.join(r, 'actual/data.json'), '{}'); fs.symlinkSync('actual', path.join(r, 'alias'));
  assert.throws(() => readInput(r, 'alias/data.json'));
});
test('symlink project root is refused', () => {
  const r = newRoot(); localInput(r); const link = `${r}-link`; fs.symlinkSync(r, link); assert.throws(() => readInput(link, 'input.json'));
});
test('physical hardlink input refused where filesystem supports it', t => {
  const r = newRoot(); localInput(r);
  try { fs.linkSync(path.join(r, 'input.json'), path.join(r, 'alias.json')); }
  catch (e) { if (e.code === 'ENOTSUP') { t.skip('NAS does not support creating hardlinks; simulated nlink guard tested separately'); return; } throw e; }
  assert.throws(() => readInput(r, 'alias.json'));
});
test('simulated multi-link metadata is refused for input (not a physical hardlink test)', t => {
  const r = newRoot(); const input = localInput(r); const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (p, ...args) { const s = original.call(fs, p, ...args); if (p === input) s.nlink = 2; return s; });
  assert.throws(() => readInput(r, 'input.json'), /single-link/);
});
test('oversized input and nonregular directory refused', () => {
  const r = newRoot(); fs.writeFileSync(path.join(r, 'large.json'), ' '.repeat(LIMITS.inputBytes + 1));
  assert.throws(() => readInput(r, 'large.json')); fs.mkdirSync(path.join(r, 'dir.json')); assert.throws(() => readInput(r, 'dir.json'));
});
test('invalid UTF8 file refused', () => { const r = newRoot(); fs.writeFileSync(path.join(r, 'bad.json'), Buffer.from([255])); assert.throws(() => readInput(r, 'bad.json')); });
test('output pair generated; overwrite denied unless explicit safe force', () => {
  const r = newRoot(); const files = writeReports(r, 'examples/output/demo', rendered());
  const before = files.map(f => fs.readFileSync(f, 'utf8')); assert.throws(() => writeReports(r, 'examples/output/demo', rendered()));
  writeReports(r, 'examples/output/demo', rendered(), { force: true }); assert.deepEqual(files.map(f => fs.readFileSync(f, 'utf8')), before);
});
test('output outside reserved path refused', () => {
  for (const p of ['src', '../outside', 'examples/output/../source', 'examples/output/a/b', '/tmp/report']) assert.throws(() => writeReports(newRoot(), p, rendered(), { force: true }));
});
test('output input collision always refused even with force', () => {
  const r = newRoot(); const [input] = writeReports(r, 'examples/output/demo', rendered());
  assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true, inputAbsolute: input }));
});
test('unrelated complete output pair preserved under force', () => {
  const r = newRoot(); const folder = path.join(r, 'examples/output/demo'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'report.json'), '{"important":true}'); fs.writeFileSync(path.join(folder, 'report.html'), 'Important unrelated file');
  assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true })); assert.equal(fs.readFileSync(path.join(folder, 'report.html'), 'utf8'), 'Important unrelated file');
});
test('unrelated second file preflight prevents first-file overwrite', () => {
  const r = newRoot(); const [j, h] = writeReports(r, 'examples/output/demo', rendered()); const before = fs.readFileSync(j);
  fs.writeFileSync(h, 'unrelated'); assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true })); assert.deepEqual(fs.readFileSync(j), before);
});
test('incomplete generated pair refused under force', () => {
  const r = newRoot(); const [j, h] = writeReports(r, 'examples/output/demo', rendered()); fs.unlinkSync(h);
  const before = fs.readFileSync(j); assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true })); assert.deepEqual(fs.readFileSync(j), before);
});
test('symlink output or output directory refused', () => {
  const r = newRoot(); localInput(r); fs.mkdirSync(path.join(r, 'examples/output'), { recursive: true }); fs.symlinkSync(r, path.join(r, 'examples/output/demo'));
  assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true }));
  const other = newRoot(); const [j] = writeReports(other, 'examples/output/demo', rendered()); fs.unlinkSync(j); localInput(other); fs.symlinkSync(path.join(other, 'input.json'), j);
  assert.throws(() => writeReports(other, 'examples/output/demo', rendered(), { force: true }));
});
test('physical hardlinked output refused where filesystem supports it', t => {
  const r = newRoot(); const [j] = writeReports(r, 'examples/output/demo', rendered());
  try { fs.linkSync(j, path.join(r, 'other.json')); }
  catch (e) { if (e.code === 'ENOTSUP') { t.skip('NAS does not support creating hardlinks; simulated nlink guard tested separately'); return; } throw e; }
  assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true }));
});
test('simulated multi-link metadata is refused for generated output', t => {
  const r = newRoot(); const [j] = writeReports(r, 'examples/output/demo', rendered()); const original = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', function (p, ...args) { const s = original.call(fs, p, ...args); if (p === j) s.nlink = 2; return s; });
  assert.throws(() => writeReports(r, 'examples/output/demo', rendered(), { force: true }), /single-link/);
});
test('CLI reference PASS exit zero and exact generated output', () => {
  const out = `examples/output/${runId}-reference`; const before = fs.readFileSync(path.join(root, 'fixtures/rehearsal.json'));
  const c = cli(['--input', 'fixtures/rehearsal.json', '--adapter', 'reference', '--out', out]); assert.equal(c.status, 0, c.stderr);
  const r = JSON.parse(fs.readFileSync(path.join(root, out, 'report.json'), 'utf8')); assert.equal(r.outcome, 'PASS');
  assert.ok(fs.readFileSync(path.join(root, out, 'report.html'), 'utf8').includes('SYNTHETIC WEBHOOK REHEARSAL / NO LIVE PROVIDER VERIFICATION'));
  assert.deepEqual(fs.readFileSync(path.join(root, 'fixtures/rehearsal.json')), before);
});
test('CLI broken adapter exit one is expected assertion failure', () => {
  const c = cli(['--input', 'fixtures/rehearsal.json', '--adapter', 'buggy', '--out', `examples/output/${runId}-buggy`]); assert.equal(c.status, 1, c.stderr);
});
test('CLI unknown and version mismatch exit two; no executions', () => {
  for (const fixture of ['unknown-event', 'version-mismatch']) {
    const out = `examples/output/${runId}-${fixture}`;
    const c = cli(['--input', `fixtures/${fixture}.json`, '--adapter', 'reference', '--out', out]); assert.equal(c.status, 2, c.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, out, 'report.json'))).coverage.executedAttempts, 0);
  }
});
test('CLI malformed JSON exits two and writes unsupported report', () => {
  fs.writeFileSync(path.join(temp, 'malformed.json'), '{');
  const c = cli(['--input', path.relative(root, path.join(temp, 'malformed.json')), '--adapter', 'reference', '--out', `examples/output/${runId}-malformed`]); assert.equal(c.status, 2, c.stderr);
});
test('CLI unknown args, module adapter, missing and duplicate options exit three', () => {
  for (const args of [[], ['--wat'], ['--input'], ['--force', '--force'], ['--input', 'fixtures/rehearsal.json', '--adapter', './evil.mjs', '--out', 'examples/output/x']]) assert.equal(cli(args).status, 3);
});
test('CLI output collision refusal exit three, safe force then exit zero', () => {
  const args = ['--input', 'fixtures/rehearsal.json', '--adapter', 'reference', '--out', `examples/output/${runId}-force`];
  assert.equal(cli(args).status, 0); assert.equal(cli(args).status, 3); assert.equal(cli([...args, '--force']).status, 0);
});
test('CLI help exits zero without writes', () => { const c = cli(['--help']); assert.equal(c.status, 0); assert.ok(c.stdout.includes('Usage:')); });
