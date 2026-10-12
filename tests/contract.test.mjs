import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { parseSuite, validateSuite, LIMITS, PROFILE } from '../src/contract.mjs';
import { suite, event, state } from './helpers.mjs';

const reject = (change) => { const s = suite(); change(s); assert.equal(validateSuite(s).ok, false); };
test('minimal complete contract accepted', () => assert.equal(validateSuite(suite()).ok, true));
test('unknown root key is unsupported', () => reject(s => s.adapter = './evil.mjs'));
test('unknown nested key is unsupported', () => reject(s => s.scenarios[0].attempts[0].event.created = 2));
test('missing assertion state is unsupported', () => reject(s => delete s.scenarios[0].attempts[0].expect.state));
test('real data declaration is refused', () => reject(s => s.synthetic = false));
test('suite schema and profile fail closed', () => { reject(s => s.schemaVersion = 2); reject(s => s.apiProfile = 'stripe'); });
test('unknown event and event version fail closed', () => {
  reject(s => s.scenarios[0].attempts[0].event.type = 'invoice.paid');
  reject(s => s.scenarios[0].attempts[0].event.apiProfile = 'future');
});
test('invalid resource/event/scenario IDs refused', () => {
  reject(s => s.scenarios[0].id = '../escape');
  reject(s => s.scenarios[0].attempts[0].event.id = '__proto__');
  reject(s => s.scenarios[0].attempts[0].event.data.id = 'sub_/x');
});
test('invalid revision/status/counter refused', () => {
  reject(s => s.scenarios[0].attempts[0].event.data.revision = 0);
  reject(s => s.scenarios[0].attempts[0].event.data.status = 'paid');
  reject(s => s.scenarios[0].initial.sideEffects = -1);
});
test('empty scenarios and attempts refused', () => { reject(s => s.scenarios = []); reject(s => s.scenarios[0].attempts = []); });
test('duplicate scenario identifiers refused', () => reject(s => s.scenarios.push(structuredClone(s.scenarios[0]))));
test('canonical duplicate payload with different key order accepted', () => {
  const s = suite(); const a = structuredClone(s.scenarios[0].attempts[0]);
  a.event = { data: a.event.data, apiProfile: PROFILE, type: a.event.type, id: a.event.id };
  s.scenarios[0].attempts.push(a); assert.equal(validateSuite(s).ok, true);
});
test('divergent payload under same event ID refused', () => reject(s => {
  const a = structuredClone(s.scenarios[0].attempts[0]); a.event.data.revision++;
  s.scenarios[0].attempts.push(a);
}));
test('contradictory resource revision refused including initial state', () => reject(s => {
  s.scenarios[0].initial = state([{ id: 'sub_demo', revision: 1, status: 'canceled' }]);
}));
test('duplicate resource and processed IDs refused', () => {
  reject(s => { const x = s.scenarios[0].attempts[0].expect.state; x.resources.push(x.resources[0]); });
  reject(s => s.scenarios[0].attempts[0].expect.state.processed.push('evt_one'));
});
test('initial opaque ledger refused', () => reject(s => s.scenarios[0].initial.processed.push('evt_unknown')));
test('scenario and attempt count bounds', () => {
  reject(s => s.scenarios = Array.from({ length: LIMITS.scenarios + 1 }, (_, i) => ({ ...s.scenarios[0], id: `s${i}` })));
  reject(s => s.scenarios[0].attempts = Array(LIMITS.attemptsPerScenario + 1).fill(s.scenarios[0].attempts[0]));
});
test('total attempt bound', () => reject(s => {
  const base = s.scenarios[0]; s.scenarios = Array.from({ length: 5 }, (_, i) => ({ ...base, id: `s${i}`, attempts: Array(103).fill(base.attempts[0]) }));
}));
test('byte and depth bounds', () => {
  assert.equal(parseSuite(' '.repeat(LIMITS.inputBytes + 1)).ok, false);
  assert.equal(parseSuite('['.repeat(17) + '0' + ']'.repeat(17)).ok, false);
});
test('malformed and trailing JSON refused', () => {
  assert.equal(parseSuite('{').ok, false); assert.equal(parseSuite(JSON.stringify(suite()) + 'x').ok, false);
});
test('strings containing braces do not confuse depth scan', () => { const s = suite(); s.title = '[[["\\}{'; assert.equal(parseSuite(JSON.stringify(s)).ok, true); });
test('nonplain, cyclic and accessor library values refused without invoking getter', () => {
  assert.equal(validateSuite(new Date()).ok, false);
  const s = suite(); s.self = s; assert.equal(validateSuite(s).ok, false);
  const g = suite(); Object.defineProperty(g, 'title', { get() { throw Error('must not execute'); }, enumerable: true });
  assert.equal(validateSuite(g).ok, false);
});
test('ERROR expectation requires explicit failure injection', () => reject(s => s.scenarios[0].attempts[0].expect.result = 'ERROR'));
test('resource limit enforced', () => reject(s => s.scenarios[0].initial.resources = Array.from({ length: 129 }, (_, i) => ({ id: `sub_${i}`, revision: 1, status: 'active' }))));
test('NaN and symbols are not JSON contract', () => { reject(s => s.scenarios[0].initial.sideEffects = NaN); reject(s => s[Symbol('x')] = true); });
test('duplicate JSON fields including escaped keys are unsupported', () => {
  for (const text of ['{"schemaVersion":2,"schemaVersion":1}', '{"x":0,"\\u0078":1}', '{"nested":{"x":0,"x":1}}']) {
    const result = parseSuite(text); assert.equal(result.ok, false); assert.match(result.issues[0], /duplicate JSON/);
  }
});
test('cooperative parser deadline fails closed (simulated monotonic clock)', t => {
  let calls = 0; t.mock.method(performance, 'now', () => calls++ === 0 ? 0 : LIMITS.parserMs + 1);
  const result = parseSuite(JSON.stringify(suite())); assert.equal(result.ok, false); assert.match(result.issues[0], /deadline/);
});
test('processed ledger count bound enforced', () => reject(s => s.scenarios[0].attempts[0].expect.state.processed = Array.from({ length: 513 }, (_, i) => `evt_${i}`)));
