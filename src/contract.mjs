// SPDX-License-Identifier: MIT
import { performance } from 'node:perf_hooks';

export const PROFILE = 'synthetic-subscription-revision-v1';
export const LIMITS = Object.freeze({ inputBytes: 262144, depth: 16, scenarios: 32, attemptsPerScenario: 128, totalAttempts: 512, resources: 128, processed: 512, labelChars: 240, idChars: 64, integer: 1000000, parserMs: 1000, adapterMs: 1000, outputBytes: 33554432 });
export class ContractError extends Error {}
const bad = (message) => { throw new ContractError(message); };
const check = (condition, message) => { if (!condition) bad(message); };
const clock = () => { const end = performance.now() + LIMITS.parserMs; return () => check(performance.now() <= end, 'parser/validation deadline exceeded'); };

// JSON data only. Descriptors prevent invoking accessors; adapters themselves are trusted code.
export function cloneData(value) {
  const tick = clock(); let nodes = 0; let chars = 0; const seen = new Set();
  function visit(v, depth) {
    tick(); check(depth <= LIMITS.depth && ++nodes <= LIMITS.inputBytes, 'data depth/node bound exceeded');
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') { check(Number.isFinite(v), 'nonfinite number'); return v; }
    if (typeof v === 'string') { chars += v.length; check(chars <= LIMITS.inputBytes, 'data string bound exceeded'); return v; }
    check(typeof v === 'object' && !seen.has(v), 'non-JSON or cyclic value');
    check(Array.isArray(v) ? Object.getPrototypeOf(v) === Array.prototype : Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, 'nonplain object');
    seen.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v);
    check(Reflect.ownKeys(descriptors).every(k => typeof k === 'string'), 'symbol key');
    const entries = [];
    for (const [key, d] of Object.entries(descriptors)) {
      if (Array.isArray(v) && key === 'length') continue;
      check(d.enumerable && Object.hasOwn(d, 'value'), 'accessor/nonenumerable input');
      chars += key.length; check(chars <= LIMITS.inputBytes, 'key bound exceeded');
      entries.push([key, visit(d.value, depth + 1)]);
    }
    let result;
    if (Array.isArray(v)) {
      check(entries.length === v.length && entries.every(([k], i) => k === String(i)), 'sparse/extended array');
      result = entries.map(([, x]) => x);
    } else result = Object.fromEntries(entries);
    seen.delete(v); return result;
  }
  const result = visit(value, 0);
  check(Buffer.byteLength(JSON.stringify(result)) <= LIMITS.inputBytes, 'input byte bound exceeded');
  return result;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function keys(o, fields, path) {
  check(o && typeof o === 'object' && !Array.isArray(o), `${path}: object required`);
  check(Object.keys(o).sort().join('|') === [...fields].sort().join('|'), `${path}: exact fields required (${fields.join(', ')})`);
}
function array(a, max, path, min = 0) { check(Array.isArray(a) && a.length >= min && a.length <= max, `${path}: array count ${min}..${max} required`); }
function id(v, prefix, path) { check(typeof v === 'string' && v.length <= LIMITS.idChars && new RegExp(`^${prefix}[A-Za-z0-9_-]+$`).test(v), `${path}: invalid ID`); }
function number(v, min, path) { check(Number.isSafeInteger(v) && v >= min && v <= LIMITS.integer, `${path}: integer ${min}..${LIMITS.integer} required`); }
function label(v, path) { check(typeof v === 'string' && v.length > 0 && v.length <= LIMITS.labelChars, `${path}: bounded nonempty label required`); }
function resource(r, path) {
  keys(r, ['id', 'revision', 'status'], path); id(r.id, 'sub_', path); number(r.revision, 1, path);
  check(['trialing', 'active', 'canceled'].includes(r.status), `${path}: unsupported status`);
}
export function validateState(value, path = 'state') {
  const s = cloneData(value); keys(s, ['resources', 'processed', 'sideEffects'], path);
  array(s.resources, LIMITS.resources, `${path}.resources`); array(s.processed, LIMITS.processed, `${path}.processed`);
  s.resources.forEach(r => resource(r, `${path}.resource`)); s.processed.forEach(v => id(v, 'evt_', `${path}.processed`)); number(s.sideEffects, 0, path);
  check(new Set(s.resources.map(r => r.id)).size === s.resources.length, `${path}: duplicate resource ID`);
  check(new Set(s.processed).size === s.processed.length, `${path}: duplicate processed ID`);
  s.resources.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0); s.processed.sort(); return s;
}
export function validateSuite(value) {
  try {
    const tick = clock(); const s = cloneData(value);
    keys(s, ['schemaVersion', 'apiProfile', 'synthetic', 'title', 'scenarios'], 'suite');
    check(s.schemaVersion === 1, 'unsupported schemaVersion'); check(s.apiProfile === PROFILE, 'unsupported suite apiProfile');
    check(s.synthetic === true, 'only explicitly synthetic data supported'); label(s.title, 'title'); array(s.scenarios, LIMITS.scenarios, 'scenarios', 1);
    let total = 0; const ids = new Set();
    for (const sc of s.scenarios) {
      tick(); keys(sc, ['id', 'title', 'initial', 'attempts'], 'scenario'); id(sc.id, '', 'scenario'); label(sc.title, 'scenario.title');
      check(!ids.has(sc.id), 'duplicate scenario ID'); ids.add(sc.id); sc.initial = validateState(sc.initial, 'initial');
      check(sc.initial.processed.length === 0, 'initial processed ledger must be empty: payload provenance unknown');
      array(sc.attempts, LIMITS.attemptsPerScenario, 'attempts', 1); total += sc.attempts.length; check(total <= LIMITS.totalAttempts, 'total attempt bound exceeded');
      const payloads = new Map(); const revisions = new Map();
      const register = (r) => { const key = `${r.id}:${r.revision}`; check(!revisions.has(key) || revisions.get(key) === r.status, 'contradictory resource revision'); revisions.set(key, r.status); };
      sc.initial.resources.forEach(register);
      for (const a of sc.attempts) {
        tick(); keys(a, ['event', 'failBeforeCommit', 'expect'], 'attempt'); keys(a.event, ['id', 'type', 'apiProfile', 'data'], 'event');
        const e = a.event; id(e.id, 'evt_', 'event'); check(e.type === 'subscription.snapshot', 'unsupported event type'); check(e.apiProfile === PROFILE, 'unsupported event apiProfile'); resource(e.data, 'event.data'); register(e.data);
        const payload = canonical(e); check(!payloads.has(e.id) || payloads.get(e.id) === payload, 'divergent payload for duplicate event ID'); payloads.set(e.id, payload);
        check(typeof a.failBeforeCommit === 'boolean', 'failBeforeCommit must be boolean'); keys(a.expect, ['result', 'state'], 'expect');
        check(['APPLIED', 'DUPLICATE', 'STALE', 'ERROR'].includes(a.expect.result), 'unsupported assertion result');
        check((a.expect.result === 'ERROR') === a.failBeforeCommit, 'ERROR assertion must correspond to injected failure'); a.expect.state = validateState(a.expect.state, 'expect.state');
      }
    }
    tick(); return { ok: true, suite: s, issues: [] };
  } catch (error) {
    if (!(error instanceof ContractError)) throw error;
    return { ok: false, issues: [error.message] };
  }
}
export function parseSuite(text) {
  try {
    check(typeof text === 'string' && Buffer.byteLength(text) <= LIMITS.inputBytes, 'input byte bound exceeded');
    const tick = clock(); let depth = 0; let quoted = false; let escaped = false; let stringStart = 0;
    const containers = [];
    for (let i = 0; i < text.length; i++) {
      if (i % 1024 === 0) tick(); const c = text[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') {
          quoted = false; let next = i + 1;
          while (next < text.length && /[\t\n\r ]/.test(text[next])) next++;
          if (text[next] === ':' && containers.at(-1) instanceof Set) {
            const key = JSON.parse(text.slice(stringStart, i + 1)); const fields = containers.at(-1);
            check(!fields.has(key), 'duplicate JSON object key'); fields.add(key);
          }
        }
      }
      else if (c === '"') { quoted = true; stringStart = i; }
      else if (c === '{' || c === '[') { depth++; containers.push(c === '{' ? new Set() : null); check(depth <= LIMITS.depth, 'JSON depth bound exceeded'); }
      else if (c === '}' || c === ']') { depth--; containers.pop(); }
    }
    const value = JSON.parse(text); tick(); return validateSuite(value);
  } catch (error) {
    if (!(error instanceof ContractError || error instanceof SyntaxError)) throw error;
    return { ok: false, issues: [error instanceof SyntaxError ? 'invalid JSON syntax' : error.message] };
  }
}
