// SPDX-License-Identifier: MIT
export type Outcome = 'PASS' | 'FAIL' | 'UNSUPPORTED';
export type HandlerResult = 'APPLIED' | 'DUPLICATE' | 'STALE';
export type Profile = 'synthetic-subscription-revision-v1';
export interface Resource { id: string; revision: number; status: 'trialing' | 'active' | 'canceled' }
export interface ApplicationState { resources: Resource[]; processed: string[]; sideEffects: number }
export interface Envelope { id: string; type: 'subscription.snapshot'; apiProfile: Profile; data: Resource }
export interface AttemptContext { readonly failBeforeCommit: boolean }
/** Trusted synchronous developer code, NOT sandboxed. Never obtained from JSON. */
export interface Adapter {
  handle(event: Envelope, context: AttemptContext): HandlerResult;
  inspect(): ApplicationState;
}
export type AdapterFactory = (initial: ApplicationState) => Adapter;
export interface Expectation { result: HandlerResult | 'ERROR'; state: ApplicationState }
export interface Attempt { event: Envelope; failBeforeCommit: boolean; expect: Expectation }
export interface Scenario { id: string; title: string; initial: ApplicationState; attempts: Attempt[] }
export interface Suite { schemaVersion: 1; apiProfile: Profile; synthetic: true; title: string; scenarios: Scenario[] }
export interface Mismatch { path: string; expected: unknown; actual: unknown }
export interface Trace {
  attempt: number; event: Envelope; failBeforeCommit: boolean; expected: Expectation;
  actual: { result: HandlerResult | 'ERROR'; state: ApplicationState | null };
  outcome: 'PASS' | 'FAIL'; mismatches: Mismatch[];
}
export interface ScenarioReport { id: string; title: string; outcome: 'PASS' | 'FAIL'; initialMismatches: Mismatch[]; issues: string[]; trace: Trace[] }
export interface Coverage {
  declaredScenarios: number | null; declaredAttempts: number | null;
  executedScenarios: number; executedAttempts: number; passedAssertions: number;
  failedAssertions: number; unevaluatedAttempts: number | null; initialStateChecks: number;
}
export interface Report {
  generator: string; version: string; reportSchemaVersion: 1; notice: string;
  model: Profile; adapter: string; outcome: Outcome; title: string; synthetic: true | null;
  inputFingerprint: string | null; issues: string[]; coverage: Coverage;
  assertionScope: string; unsupported: string[]; limits: Readonly<Record<string, number>>;
  scenarios: ScenarioReport[];
}
export type Validation = { ok: true; suite: Suite; issues: [] } | { ok: false; issues: string[] };
export function runSuite(value: unknown, factory: AdapterFactory, adapterName?: string): Report;
export function runText(text: string, factory: AdapterFactory, adapterName?: string): Report;
export function referenceAdapter(initial: ApplicationState): Adapter;
export function buggyAdapter(initial: ApplicationState): Adapter;
export class SyntheticCommitFailure extends Error { constructor(); }
export function validateSuite(value: unknown): Validation;
export function parseSuite(text: string): Validation;
export function validateState(value: unknown, path?: string): ApplicationState;
export function renderReports(report: Report): { json: string; html: string };
export function exitCode(report: Report): 0 | 1 | 2;
export const PROFILE: Profile;
export const LIMITS: Readonly<Record<string, number>>;
