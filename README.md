# Webhook Failure Rehearsal

An MIT-licensed offline application-state assertion kit with a runnable GitHub Action. Rehearse synthetic duplicate delivery, reordering and failure/retry expectations, then inspect expected versus actual state. This is not a Stripe integration verifier or a statement that billing is safe. See LICENSE for the software license and warranty disclaimer.

## Install and run without a service

Use Node 22 (tested on 22.22.2). Unpack the source package into a real, non-symlink directory and change into it. No npm install, runtime package downloads, keys or services are needed. Other Node majors and Windows runners are outside the tested scope.

```sh
mkdir -p .tmp
export TMPDIR="$PWD/.tmp"
export npm_config_cache="$PWD/.tmp/npm-cache"
export npm_config_update_notifier=false
npm test
npm run demo
```

`npm test` creates package-local test scratch and runs portable regressions using Node's built-in runner, not a typechecker. `npm run smoke:action` runs the actual composite Bash command with synthetic runner variables, including a separately located consumer workspace. It is not a hosted Actions run. The demo checks child exit codes and generates these self-contained JSON/HTML pairs:

- `examples/output/reference/report.json` and `report.html`: reference PASS, four scenarios, eleven attempt assertion packets.
- `examples/output/buggy/report.json` and `report.html`: intentional FAIL against exactly the same fixture/oracles.
- `examples/output/unknown-event/report.json` and `report.html`: UNSUPPORTED, no handler execution.
- `examples/output/version-mismatch/report.json` and `report.html`: UNSUPPORTED, no handler execution.

The demo uses explicit `--force`, limited to existing recognizable generated report pairs. Its own exit is zero when all expected outcomes occur, including the intentionally failing adapter. Do not infer that the buggy adapter passed.

Individual sample command (add `--force` only to replace this kit's generated pair):

```sh
node src/cli.mjs --workspace "$PWD" --input fixtures/rehearsal.json --adapter reference --out rehearsal-output/manual-reference
node src/cli.mjs --workspace "$PWD" --input fixtures/rehearsal.json --adapter buggy --out rehearsal-output/manual-buggy
node src/cli.mjs --workspace "$PWD" --input fixtures/unknown-event.json --adapter reference --out rehearsal-output/manual-unknown
node src/cli.mjs --workspace "$PWD" --input fixtures/version-mismatch.json --adapter reference --out rehearsal-output/manual-version
```

Exit codes: 0 PASS, 1 assertion or adapter-contract FAIL, 2 UNSUPPORTED input, 3 operational error (bad CLI/path/I/O/output collision). Missing/oversized/non-UTF8/nonregular files are I/O errors, not passing reports. Unsupported structured input or invalid JSON produces an UNSUPPORTED report if the output path is writable. `--help` exits zero without generating reports. CLI arguments are exact, no positional forms or arbitrary module import flag. `--workspace` is an absolute normalized, non-symlink workspace; when omitted it is the current working directory, never the kit installation folder. Invoke the CLI by an absolute path to keep kit code separate from consumer fixtures/output.

## GitHub Action

The root `action.yml` is a dependency-free composite Action, not a paid GitHub App. See `examples/workflow.yml` for a read-only `contents: read`, no-persisted-credentials example using the kit as a local Action. Provision Node 22 before it runs. Examples are deliberately outside `.github/workflows`; private verification exercised the actual commands, not a GitHub-hosted workflow. Pin dependencies and the product revision to reviewed immutable SHAs before running a hosted workflow.

Inputs:
- `scenario-path`: required bounded workspace-relative `.json` file, for example `fixtures/rehearsal.json`.
- `output-dir`: `rehearsal-output/<safe-name>`, default `rehearsal-output/action`. The directory must not already contain either report. There is no Action overwrite switch.
- `adapter`: `reference` by default, or `buggy`. Reference PASS checks a synthetic model against your declared assertions, NOT your application code. Buggy is an intentional failing control. Neither input can select a module, script, expression or custom code.

Outputs: `outcome` (PASS/FAIL/UNSUPPORTED/ERROR), `report-json`, `report-html`. Paths are workspace-relative and empty on operational errors. The Action returns the same nonzero exit policy as the CLI: FAIL and UNSUPPORTED fail the step/job; no continue-on-error masking or permissive fail policy. Runner-output setup failure may prevent outputs entirely. Report files are not uploaded, committed, posted or transmitted by this Action. The only outside-workspace write is appending fixed fields to GitHub's existing runner-owned GITHUB_OUTPUT file, checked under disjoint RUNNER_TEMP. No GitHub token is read or requested. GitHub provisioning/checkout and ordinary hosted job logs are platform behavior, not an offline or universally free workflow guarantee. Never use customer/private payloads in this synthetic-only tool.

Untrusted PR JSON is data only. A trusted, pinned action can evaluate it without selecting executable code, but a workflow must not execute the PR's replacement action/scripts. Do not use `pull_request_target` with an untrusted checkout, expose secrets, or accept event-derived action/module paths. Prefer a reviewed revision and isolated, unprivileged job. These examples use manual dispatch on reviewed code.

## Connect actual customer-owned code

`examples/customer-handler.mjs` is a separate, pure in-memory application component, not a reference-adapter wrapper. `examples/customer-adapter.mjs` maps its apply/snapshot seam into the kit. Replace that component with your reviewed synchronous business logic using synthetic storage/effect counters only. `examples/customer-action.mjs` imports the factory at a fixed code location and calls `runAction({ factory, label })`, with `WHR_ADAPTER=custom`. `examples/customer-workflow.yml` shows that explicit trusted-code workflow. It uses the same real runner, local reports and exit policy as the composite adapter. The manifest intentionally offers no custom-module input.

For local integration without runner control files, import `runText`, your factory, `renderReports`, and `exitCode`; read fixtures via the exported `/io` helper, pass `inputAbsolute` when writing, then return `exitCode(report)`. The existing `examples/trusted-adapter.mjs` demonstrates this sequence. `npm run smoke:action` actually executes the customer component through the runner and tests all eleven bundled attempts. This is an integration pattern, not proof that your production handler behaves the same way. Only your explicitly reviewed pure code should run; arbitrary custom code is not sandboxed.

## What the fixture model means

`synthetic-subscription-revision-v1` is an invented application model. Each event carries an explicit application fixture state revision. No Stripe timestamp is treated as a universal order; there are no provider creation timestamps in the accepted schema. These are independently authored examples, not copies of vendor or customer payloads.

A reference adapter stages resource changes, processed-event IDs and a simulated side-effect counter in a single in-memory transaction. On a new higher revision, resource state updates and the counter increases once. Older or equal revisions are STALE and do not increment it. Successfully handling a stale new event ID still commits that ID. Identical repeated IDs return DUPLICATE. A selected `failBeforeCommit` throws `SyntheticCommitFailure` before committing any of those staged changes. The retry commits once. The counter is an assertion aid, not proof of a real email, queue, database or payment transaction.

The negative control intentionally commits IDs too early, ignores duplicate guards, and overwrites newer snapshots with stale data. It fails independently on duplicate effects, reordering, failure/retry and equal revision under another ID. Tests assert these failures; removing the faults without changing expectations must break the negative-control tests.

## Input contract

See `src/index.d.ts` for the complete typed shapes, `src/contract.mjs` for runtime rules, and `fixtures/rehearsal.json` for a complete executable example. Unknown fields are rejected at every level. Nothing in JSON can import code, name a handler module, evaluate an expression, provide SQL or run commands.

- Root: `schemaVersion` exactly 1, `apiProfile` exactly `synthetic-subscription-revision-v1`, `synthetic` exactly true, nonempty bounded `title`, nonempty `scenarios`.
- Scenario: unique `id`, `title`, `initial`, `attempts`. Fresh adapter instance per scenario. There is no shared process/ledger state between scenarios.
- State: `resources` with objects `{id, revision, status}`, `processed` event IDs, `sideEffects` integer. Resources and IDs are compared in sorted ID order. Initial `processed` must be empty: opaque preexisting payload provenance is unsupported. Initial resources/counter can be explicitly declared.
- Envelope: `{id, type:"subscription.snapshot", apiProfile:"synthetic-subscription-revision-v1", data:{id,revision,status}}`.
- Resource status: `trialing`, `active`, or `canceled`. ID patterns: `evt_` or `sub_` then one or more ASCII letters, digits, `_` or `-`; scenario IDs use that same suffix character set without a required prefix.
- Attempt: `event`, boolean `failBeforeCommit`, `expect:{result,state}`. Result is APPLIED, DUPLICATE, STALE or ERROR. ERROR is reserved for an explicitly injected failure; arbitrary exceptions cannot satisfy it. Inject only on a nonduplicate event since duplicate handling does not enter a transaction.
- Each attempt requires full expected resources, ledger and counter. Empty scenarios and missing expectations cannot accidentally pass. Repeated event IDs with divergent canonical payloads, contradictory resource/revision status pairs, duplicate IDs within state, duplicate JSON keys and unsupported profiles are rejected before any adapter executes.

A valid contract does not prove an oracle is correct. Developers must review each expected application-state transition. Changing expected results simply to make a handler green defeats the point.

## Trusted adapter library boundary

A developer supplies a trusted synchronous factory directly to `runSuite(value, factory, label)` or `runText(jsonText, factory, label)`. `runText` preserves duplicate-key validation; prefer it for JSON intake. `runSuite` validates already-created plain JSON data. Both return a deterministic report without writing files. `renderReports(report)` returns `{json, html}`. `exitCode(report)` returns 0/1/2.

The factory receives a detached initial state and returns:

- `handle(event, context)`: synchronous function; returns APPLIED, DUPLICATE or STALE, or throws `SyntheticCommitFailure` for the selected synthetic failure.
- `inspect()`: detached JSON application-state snapshot using the state contract.

Trusted code execution begins when the caller invokes the factory. This is not a sandbox. Never obtain factories/import paths from fixture JSON or execute customer-supplied code. Adapters could access their process privileges, network or filesystem; the kit cannot prevent that. Bundled adapters make no network calls. Promise/async adapters are rejected; rejecting an async return cannot undo code the adapter already started. Use only reviewed synchronous adapters with no asynchronous or external side effects. Cooperative deadlines detect overruns after return, not interrupt an infinite loop.

The R1 correction applies one synchronous-return check to factory, handler and initial/post-handler inspection, including method lookup. Native and cross-realm Promise returns receive discard-only fulfillment/rejection handlers through the captured native Promise `then`, without reading supplied `then` or `catch` properties. They still produce sanitized contract FAIL; no result is awaited or accepted. Ordinary thenables are not assimilated or executed. Trusted class methods and method getters remain executable API code. Setup failures leave all scenario attempts unevaluated; a post-attempt failure counts that attempted packet as failed and leaves subsequent attempts unevaluated.

A runnable explicit injection example is `examples/trusted-adapter.mjs`. It wraps the reference model to observe calls; it is not another independently verified business handler:

```sh
node examples/trusted-adapter.mjs
```

It emits a PASS report under `examples/output/trusted-adapter` and prints the observed eleven attempts. The ESM package identifier `private-webhook-failure-rehearsal` exposes library types at `src/index.d.ts`, plus `/io` and `/action` subpaths. No install is necessary inside the package. Consumers can vendor the source and use direct ESM imports or install a reviewed local source package; no npm publication is implied. The npm private flag protects against accidental npm publication and does not disable the Action. `tsconfig.json` and `tests/types.mts` provide positive and expected-error consumer declaration checks. Run a compatible TypeScript compiler with `--project tsconfig.json`; Node syntax/native stripping is not a typecheck. Compiler installation is a separate development-environment choice, not a runtime requirement.

## Reports and coverage

Reports state their synthetic-only scope, exact model, unsupported cases and bounds. PASS means the supplied assertions matched in this invented model only. FAIL contains expected versus actual mismatches and an ordered attempt trace. UNSUPPORTED executes no scenarios; declared counts remain null because the rejected contract was not accepted, executed counts are zero, and synthetic provenance is marked unverified. Unknown is not pass.

`passedAssertions` and `failedAssertions` count complete per-attempt assertion packets (result plus entire state), not individual scalar comparisons. `initialStateChecks` is separate. `unevaluatedAttempts` discloses early stopping after an adapter contract/setup failure. Ordinary assertion failures continue to show subsequent attempts. A fresh initial-state mismatch or invalid adapter state never passes. Unexpected exception text is omitted to avoid accidental disclosure; the failure category is retained.

Semantic JSON/HTML contains no run timestamps, durations, random IDs or host paths. The SHA-256 fingerprint is of the normalized accepted suite, not provenance or trust certification. Identical accepted inputs and deterministic adapters produce byte-identical reports; custom adapter determinism remains the developer's responsibility. Test logs may contain durations and random temp-directory names but are not semantic reports.

HTML is escaped text with inline static CSS, no executable scripts or external assets, and restrictive CSP. Per-scenario/attempt summaries show expected/actual results, field mismatches and actionable repair guidance. Native details sections expose complete expected/actual state, and the full deterministic JSON trace remains available. Actual generated reports were exercised in Chrome, including inert hostile text and native mouse/keyboard detail controls. This is not a cross-browser certification or comprehensive accessibility audit.

## Limits and safe paths

Runtime limits: 262144 input bytes; depth 16; 32 scenarios; 128 attempts per scenario; 512 total attempts; 128 resources/state; 512 processed IDs/state; 240-character labels; 64-character IDs; revisions 1..1000000; counters 0..1000000; 33554432 bytes per report output. Parser/validation and adapter-operation deadlines are 1000 ms, cooperative. Bounded input work is checked against a monotonic clock; slow OS/NAS I/O cannot be interrupted by these synchronous checks. No guarantee of a hard wall-clock timeout under a stalled mount or malicious trusted adapter. Demo/test child processes use explicit outer timeouts.

CLI input is a relative `.json` path under the explicitly selected workspace, with no `..`, empty components, absolute paths, backslashes or AppleDouble entries. All ancestors, input and output targets are checked; symlinks, nonregular files and reported multiple hardlinks are refused. CLI output is confined to `rehearsal-output/<safe-name>` or legacy `examples/output/<safe-name>`, each containing only `report.json` and `report.html`. `--force` refuses incomplete pairs, unrelated content, input collision and unsafe links; it replaces only recognized current-version or original 0.1.0 schema-1 generated pairs. These markers prevent ordinary accidents, not forgery by an adversarial directory writer. The Action accepts only the first output namespace and never forces replacement.

Both output files are checked before either is changed. File descriptor checks include type/link count/inode identity. The pair is not an atomic transaction: storage failure/crash can leave a partial report. Review it manually rather than forcing a blind retry. Filesystem races with a malicious concurrent writer/NAS administrator remain outside the kit's guarantees. Do not use attacker-writable roots. SMB permissions may not enforce requested file mode; this is not access-control certification.

The R2 correction verifies the protected input with a no-follow file descriptor and compares its device/inode identity against BOTH existing output targets before any output is opened for writing. Lexical collision checks remain, but case folding is not used as a filesystem identity substitute. Actual NAS filename/directory case aliases, including an HTML-target alias, preserve both original output byte sequences when refused. Direct users of `writeReports` must pass `inputAbsolute` for the file they read; the CLI and trusted-library example both do so. Missing, out-of-root or symlink protected inputs fail closed rather than disabling collision protection.

Physical hardlink tests explicitly skip when the filesystem refuses hardlink creation. Separate simulated link-count tests verify the rejection rule, not physical filesystem behavior; inspect the actual test output and skips for your environment. Test scratch is in `.tmp/`; CLI test reports have `io-tests-` names under `examples/output/`. AppleDouble `._*` files are ignored and never removed.

## Verification and maintenance

```sh
npm test
npm run smoke:action
npm run demo
node examples/trusted-adapter.mjs
```

The portable release tests include Promise-return and file-identity regressions, Action injection/path/control-file checks and fresh independent safety tests. Private review receipts, operational instructions and authoring-only history tests are excluded from this package. Verify SHA256SUMS before running a newly unpacked package. The manifest covers every payload file except itself.

Version code/schema/profile explicitly when changing semantics, preserve regressions, and rerun independent review for release. Private verification included native Linux execution and actual Chrome report workflows; it was not a GitHub-hosted run or a comprehensive accessibility/performance certification. Physical hardlink coverage depends on the test filesystem.

## Bug and security reports

Use repository Issues for ordinary bugs. Include a minimal synthetic fixture, version, expected behavior and actual outcome. Do not post customer payloads, credentials or private application data.

For a suspected vulnerability, use the repository Security tab and its private Report a vulnerability form, not a public issue. Provide a synthetic reproduction and impact description.

No response SLA, emergency coverage, auto-updates or unlimited maintenance are promised.
