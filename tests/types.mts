// SPDX-License-Identifier: MIT
import { runSuite, runText, referenceAdapter, buggyAdapter, renderReports, exitCode, SyntheticCommitFailure, validateSuite, parseSuite, validateState, PROFILE, LIMITS } from 'private-webhook-failure-rehearsal';
import type { AdapterFactory, ApplicationState, Suite, Report, Outcome, HandlerResult } from 'private-webhook-failure-rehearsal';
import { readInput, writeReports } from 'private-webhook-failure-rehearsal/io';
import { runAction } from 'private-webhook-failure-rehearsal/action';
const initial: ApplicationState = { resources: [], processed: [], sideEffects: 0 };
const factory: AdapterFactory = state => ({ handle(_event, context) { if (context.failBeforeCommit) throw new SyntheticCommitFailure(); return 'STALE'; }, inspect() { return state; } });
const suite: Suite = { schemaVersion: 1, apiProfile: PROFILE, synthetic: true, title: 'Typechecking only', scenarios: [] };
const report: Report = runSuite(suite, factory);
const outcome: Outcome = report.outcome;
const status: 0 | 1 | 2 = exitCode(report);
const actionStatus: 0 | 1 | 2 | 3 = runAction({ factory, label: 'typed', env: {} });
const input = readInput('/workspace', 'fixture.json');
writeReports('/workspace', 'rehearsal-output/typed', renderReports(runText(input.text, referenceAdapter)), { inputAbsolute: input.absolute });
const validation = validateSuite(suite);
if (validation.ok) { const typed: Suite = validation.suite; void typed; }
parseSuite('{}'); validateState(initial); buggyAdapter(initial); void outcome; void status; void actionStatus; void LIMITS;
// @ts-expect-error async factories are not supported
const asyncFactory: AdapterFactory = async state => referenceAdapter(state);
// @ts-expect-error async handlers are not supported
const asyncHandler: AdapterFactory = state => ({ handle: async () => 'STALE', inspect: () => state });
// @ts-expect-error provider event types are not supported by this synthetic model
const unsupportedResult: HandlerResult = 'PAID';
// @ts-expect-error outcome cannot include a production-safe assurance
const assurance: Outcome = 'PRODUCTION_SAFE';
void asyncFactory; void asyncHandler; void unsupportedResult; void assurance;
