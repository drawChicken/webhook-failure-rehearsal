// SPDX-License-Identifier: MIT
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { canonical, LIMITS, PROFILE, validateState, validateSuite, parseSuite } from './contract.mjs';
import { SyntheticCommitFailure } from './adapters.mjs';

export const GENERATOR = 'private-webhook-failure-rehearsal';
export const VERSION = '1.0.0';
export const EXCLUSIONS = Object.freeze([
  'No Stripe schema, API, delivery or sequencing guarantees. Fixture revisions are an application abstraction, not provider timestamps.',
  'No keys, signatures, webhooks server, network calls, payments or live integration verification.',
  'No concurrent workers, database transactions, durable ledger, crashes, queues or real external side effects.',
  'Synchronous trusted adapters only; not a sandbox. Cooperative deadlines cannot interrupt blocking code or stalled NAS I/O.',
  'PASS means only supplied synthetic assertions matched. Unknown/unsupported is not a pass. No billing-safety or production assurance.',
]);
function base(adapter) {
  if (typeof adapter !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(adapter)) throw new TypeError('bounded adapter label required');
  return {
    generator: GENERATOR, version: VERSION, reportSchemaVersion: 1,
    notice: 'SYNTHETIC WEBHOOK REHEARSAL / NO LIVE PROVIDER VERIFICATION',
    model: PROFILE, adapter, outcome: 'UNSUPPORTED', title: 'Input unsupported',
    synthetic: null, inputFingerprint: null, issues: [],
    coverage: { declaredScenarios: null, declaredAttempts: null, executedScenarios: 0, executedAttempts: 0, passedAssertions: 0, failedAssertions: 0, unevaluatedAttempts: null, initialStateChecks: 0 },
    assertionScope: 'Every executed attempt compares the handler result, full resource state, processed-ID ledger and simulated side-effect counter. Scenario entry checks the full initial state. Index order is replay order, not wall-clock time.',
    unsupported: [...EXCLUSIONS], limits: { ...LIMITS }, scenarios: [],
  };
}
function diff(expected, actual, path = '$') {
  if (canonical(expected) === canonical(actual)) return [];
  if (expected && actual && !Array.isArray(expected) && !Array.isArray(actual) && typeof expected === 'object' && typeof actual === 'object') {
    return [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort().flatMap(k => diff(expected[k] ?? null, actual[k] ?? null, `${path}.${k}`));
  }
  return [{ path, expected: expected ?? null, actual: actual ?? null }];
}
class AdapterContractError extends Error {}
const nativePromiseThen = Promise.prototype.then;
const discard = () => {};
function synchronous(value) {
  // Brand-check across realms without touching value.then/catch or assimilating
  // arbitrary thenables. Both continuations discard values; async is NOT supported.
  if (types.isPromise(value)) {
    Reflect.apply(nativePromiseThen, value, [discard, discard]);
    throw new AdapterContractError('async adapter return unsupported');
  }
  return value;
}
function method(adapter, name) {
  const fn = synchronous(adapter[name]);
  if (typeof fn !== 'function') throw new AdapterContractError('adapter function missing');
  return fn;
}
function invoke(adapter, name, args = []) {
  return synchronous(Reflect.apply(method(adapter, name), adapter, args));
}
function snapshot(adapter) { return validateState(invoke(adapter, 'inspect'), 'adapter.inspect'); }
function runValidated(validation, factory, adapterName) {
  const report = base(adapterName);
  if (!validation.ok) { report.issues = validation.issues; return report; }
  if (typeof factory !== 'function') throw new TypeError('trusted adapter factory required');
  const suite = validation.suite;
  report.title = suite.title; report.synthetic = true;
  report.inputFingerprint = createHash('sha256').update(canonical(suite)).digest('hex');
  report.coverage.declaredScenarios = suite.scenarios.length;
  report.coverage.declaredAttempts = suite.scenarios.reduce((n, s) => n + s.attempts.length, 0);
  report.outcome = 'PASS';
  for (const scenario of suite.scenarios) {
    const result = { id: scenario.id, title: scenario.title, outcome: 'PASS', initialMismatches: [], issues: [], trace: [] };
    report.scenarios.push(result); report.coverage.executedScenarios++;
    let adapter;
    try {
      const start = performance.now();
      adapter = synchronous(factory(structuredClone(scenario.initial)));
      if (!adapter) throw new AdapterContractError('adapter functions missing');
      method(adapter, 'handle'); method(adapter, 'inspect');
      const actual = snapshot(adapter);
      if (performance.now() - start > LIMITS.adapterMs) throw Error('adapter setup exceeded cooperative deadline');
      result.initialMismatches = diff(scenario.initial, actual, '$.initial'); report.coverage.initialStateChecks++;
      if (result.initialMismatches.length) { result.outcome = 'FAIL'; result.issues.push('initial state mismatch; scenario not executed'); }
    } catch {
      result.outcome = 'FAIL'; result.issues.push('adapter setup/inspect contract failure; scenario not executed');
    }
    if (result.outcome === 'PASS') {
      for (const [index, attempt] of scenario.attempts.entries()) {
        let actualResult = 'ERROR'; let state = null; let issue = null;
        const start = performance.now();
        try {
          const returned = invoke(adapter, 'handle', [structuredClone(attempt.event), Object.freeze({ failBeforeCommit: attempt.failBeforeCommit })]);
          // Async code is outside this API, including thenables. Never await it.
          if (!['APPLIED', 'DUPLICATE', 'STALE'].includes(returned)) {
            issue = 'adapter returned unsupported result (async adapters unsupported)';
          } else actualResult = returned;
        } catch (error) {
          if (error instanceof AdapterContractError) issue = 'adapter returned unsupported result (async adapters unsupported)';
          else if (!(error instanceof SyntheticCommitFailure) || !attempt.failBeforeCommit) issue = 'unexpected adapter exception (raw exception omitted)';
        }
        try { state = snapshot(adapter); } catch { issue = 'adapter inspect contract failure'; }
        if (performance.now() - start > LIMITS.adapterMs) issue = 'adapter exceeded cooperative deadline';
        const actual = { result: actualResult, state };
        const mismatches = diff(attempt.expect, actual);
        if (issue) mismatches.push({ path: '$.adapterContract', expected: 'valid bounded synchronous execution', actual: issue });
        const outcome = mismatches.length ? 'FAIL' : 'PASS';
        result.trace.push({ attempt: index + 1, event: attempt.event, failBeforeCommit: attempt.failBeforeCommit, expected: attempt.expect, actual, outcome, mismatches });
        report.coverage.executedAttempts++;
        if (outcome === 'FAIL') { result.outcome = 'FAIL'; report.coverage.failedAssertions++; }
        else report.coverage.passedAssertions++;
        if (issue) { result.issues.push('adapter contract failure; remaining attempts not executed'); break; }
      }
    }
    if (result.outcome === 'FAIL') report.outcome = 'FAIL';
  }
  report.coverage.unevaluatedAttempts = report.coverage.declaredAttempts - report.coverage.executedAttempts;
  return report;
}
export function runSuite(value, factory, adapterName = 'trusted-custom') { return runValidated(validateSuite(value), factory, adapterName); }
export function runText(text, factory, adapterName = 'trusted-custom') { return runValidated(parseSuite(text), factory, adapterName); }
export const exitCode = (report) => ({ PASS: 0, FAIL: 1, UNSUPPORTED: 2 })[report.outcome];
