// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { LIMITS } from './contract.mjs';
import { GENERATOR, VERSION } from './runner.mjs';
import { HTML_MARKER } from './report.mjs';

function relativeParts(relative) {
  if (typeof relative !== 'string' || relative.length > 240 || path.isAbsolute(relative)) throw Error('relative bounded path required');
  const parts = relative.split('/');
  if (parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..' || p.startsWith('._'))) throw Error('unsafe path component');
  return parts;
}
function statIfExists(target) {
  try { return fs.lstatSync(target); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
export function checkRoot(root) {
  if (!path.isAbsolute(root)) throw Error('absolute project root required');
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split('/').filter(Boolean)) {
    current = path.join(current, part); const s = fs.lstatSync(current);
    if (s.isSymbolicLink() || !s.isDirectory()) throw Error('project ancestor must be a real directory');
  }
}
function directory(root, parts, create = false) {
  checkRoot(root); let current = root;
  for (const part of parts) {
    current = path.join(current, part); let s = statIfExists(current);
    if (!s && create) { fs.mkdirSync(current); s = fs.lstatSync(current); }
    if (!s || s.isSymbolicLink() || !s.isDirectory()) throw Error('path ancestor must be a real directory');
  }
  return current;
}
function regular(s) { if (!s || !s.isFile() || s.isSymbolicLink() || s.nlink !== 1) throw Error('single-link regular file required'); }
function sameFile(a, b) { return a && b && a.dev === b.dev && a.ino === b.ino; }
function verifiedInputIdentity(root, absolute) {
  if (!path.isAbsolute(absolute) || absolute !== path.resolve(absolute)) throw Error('absolute normalized input path required');
  const parts = relativeParts(path.relative(root, absolute)); const name = parts.pop();
  const target = path.join(directory(root, parts), name);
  const before = fs.lstatSync(target); regular(before);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd); regular(opened);
    if (!sameFile(before, opened)) throw Error('input changed during identity check');
    return opened;
  } finally { fs.closeSync(fd); }
}
function boundedRead(target, limit) {
  const before = fs.lstatSync(target); regular(before);
  if (before.size > limit) throw Error('file byte bound exceeded');
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd); regular(opened);
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size > limit) throw Error('file changed during open');
    const buffer = Buffer.alloc(limit + 1); let count = 0;
    while (count < buffer.length) { const n = fs.readSync(fd, buffer, count, buffer.length - count, null); if (!n) break; count += n; }
    if (count > limit) throw Error('file byte bound exceeded');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
}
export function readInput(root, relative) {
  const parts = relativeParts(relative); if (!relative.endsWith('.json')) throw Error('input must be a .json file');
  const name = parts.pop(); const parent = directory(root, parts); const absolute = path.join(parent, name);
  return { text: boundedRead(absolute, LIMITS.inputBytes), absolute };
}
export function writeReports(root, outputRelative, rendered, { force = false, inputAbsolute = null } = {}) {
  relativeParts(outputRelative);
  if (!/^(?:examples\/output|rehearsal-output)\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(outputRelative)) throw Error('output must be rehearsal-output/<safe-name> or examples/output/<safe-name>');
  if (typeof force !== 'boolean') throw Error('force must be boolean');
  const target = path.join(root, outputRelative);
  const files = [path.join(target, 'report.json'), path.join(target, 'report.html')];
  if (files.includes(inputAbsolute)) throw Error('output collides with input');
  // A lexical alias on a case-insensitive NAS can still identify the input inode.
  // Verify the supplied input through a no-follow descriptor, not case folding.
  const inputIdentity = inputAbsolute === null ? null : verifiedInputIdentity(root, inputAbsolute);
  for (const text of [rendered.json, rendered.html]) if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.outputBytes) throw Error('output byte bound exceeded');
  directory(root, outputRelative.split('/'), true);
  const existing = files.map(statIfExists);
  if (existing.some(s => sameFile(s, inputIdentity))) throw Error('output collides with input identity');
  if (existing.some(Boolean)) {
    if (!force || !existing.every(Boolean)) throw Error('output exists or incomplete pair; explicit force only for complete generated reports');
    existing.forEach(regular);
    const oldJSON = boundedRead(files[0], LIMITS.outputBytes);
    // Avoid parsing a huge/untrusted existing report just to authorize replacement.
    if (![VERSION, '0.1.0'].some(version => oldJSON.startsWith(`{\n  "generator": "${GENERATOR}",\n  "version": "${version}",\n  "reportSchemaVersion": 1,`))) throw Error('refuse unrelated JSON output');
    if (!boundedRead(files[1], LIMITS.outputBytes).startsWith(HTML_MARKER)) throw Error('refuse unrelated HTML output');
  }
  for (const [i, content] of [rendered.json, rendered.html].entries()) {
    const flags = fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW | (existing[i] ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
    const fd = fs.openSync(files[i], flags, 0o600);
    try {
      const current = fs.fstatSync(fd); regular(current);
      if (existing[i] && (existing[i].ino !== current.ino || existing[i].dev !== current.dev)) throw Error('output changed during open');
      if (sameFile(current, inputIdentity)) throw Error('output collides with input identity');
      fs.ftruncateSync(fd, 0); fs.writeFileSync(fd, content, 'utf8');
    } finally { fs.closeSync(fd); }
  }
  return files;
}
