// SPDX-License-Identifier: MIT
import { GENERATOR } from './runner.mjs';
import { LIMITS } from './contract.mjs';
export const HTML_MARKER = '<!doctype html>\n<!-- generated:private-webhook-failure-rehearsal:report-v1 -->';
export function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function guidance(mismatch) {
  if (mismatch.path.includes('adapterContract')) return 'Use synchronous handle/inspect methods and bounded plain state. Check adapter setup; raw exceptions are intentionally omitted.';
  if (mismatch.path.includes('sideEffects')) return 'Check duplicate guards and stage the simulated effect counter in the same transaction as state and ledger.';
  if (mismatch.path.includes('processed')) return 'Commit the event ID only after a successful transaction; failed attempts must leave the ledger unchanged.';
  if (mismatch.path.includes('resources')) return 'Check revision comparison and rollback: stale snapshots must not overwrite newer application state.';
  return 'Compare the reviewed oracle with the handler result and initial state. Do not change expectations simply to get a pass.';
}
function mismatchList(items) {
  return items.length ? `<ul>${items.map(m => `<li><code>${escapeHTML(m.path)}</code>: expected <code>${escapeHTML(JSON.stringify(m.expected))}</code>; actual <code>${escapeHTML(JSON.stringify(m.actual))}</code><p>${escapeHTML(guidance(m))}</p></li>`).join('')}</ul>` : '<p>No mismatches in evaluated assertions.</p>';
}
function scenarioSummary(scenario) {
  return `<section><h3>${escapeHTML(scenario.id)}: ${escapeHTML(scenario.outcome)}</h3><p>${escapeHTML(scenario.title)}</p>${scenario.issues.map(issue => `<p>${escapeHTML(issue)}</p>`).join('')}${mismatchList(scenario.initialMismatches)}${scenario.trace.map(t => `<article><h4>Attempt ${t.attempt}: ${escapeHTML(t.outcome)}</h4><p>Event ${escapeHTML(t.event.id)}. Expected result: <strong>${escapeHTML(t.expected.result)}</strong>. Actual result: <strong>${escapeHTML(t.actual.result)}</strong>. Injected precommit failure: ${t.failBeforeCommit ? 'yes' : 'no'}.</p>${mismatchList(t.mismatches)}<details><summary>Full expected / actual state</summary><pre>${escapeHTML(JSON.stringify({ expected: t.expected, actual: t.actual }, null, 2))}</pre></details></article>`).join('')}</section>`;
}
export function renderReports(report) {
  if (report.generator !== GENERATOR || !['PASS', 'FAIL', 'UNSUPPORTED'].includes(report.outcome)) throw Error('not a rehearsal report');
  const json = JSON.stringify(report, null, 2) + '\n';
  const html = `${HTML_MARKER}
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Webhook Failure Rehearsal</title>
<style>body{font:16px system-ui,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#17212b;background:#fff}header{border:3px solid #814500;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:1rem}li{margin:.6rem 0}h1{font-size:1.6rem}</style></head>
<body><header><strong>${escapeHTML(report.notice)}</strong><h1>${escapeHTML(report.outcome)}: supplied assertions only</h1><p>${escapeHTML(report.title)}</p><p>Synthetic input declaration: ${report.synthetic === true ? 'confirmed by input contract (not independently verified)' : 'UNVERIFIED: input contract rejected; no execution'}.</p><p>No production or billing-safety assurance. Unknown is not pass.</p></header>
<h2>Exact coverage</h2><p>Model: ${escapeHTML(report.model)}. Adapter: ${escapeHTML(report.adapter)}.</p><p>${escapeHTML(report.assertionScope)}</p><pre>${escapeHTML(JSON.stringify(report.coverage, null, 2))}</pre>
<h2>Scenario results: expected / actual</h2><p>${report.adapter === 'reference' ? 'Reference model only: this result does not test your application handler.' : 'Only the explicitly selected adapter was exercised; this is not production verification.'}</p>${report.issues.map(issue => `<p>${escapeHTML(issue)}</p>`).join('')}${report.scenarios.length ? report.scenarios.map(scenarioSummary).join('') : '<p>No scenario executed. Correct unsupported input using the documented schema; do not treat this as a pass.</p>'}
<h2>Unsupported cases and limits</h2><ul>${report.unsupported.map(s => `<li>${escapeHTML(s)}</li>`).join('')}</ul><pre>${escapeHTML(JSON.stringify(report.limits, null, 2))}</pre>
<h2>Chronological attempt trace and mismatch evidence</h2><p>Attempt indexes are synthetic replay order. The complete deterministic report follows, including expected/actual state and counter assertions.</p><pre>${escapeHTML(json)}</pre></body></html>\n`;
  if (Buffer.byteLength(json) > LIMITS.outputBytes || Buffer.byteLength(html) > LIMITS.outputBytes) throw Error('report output byte bound exceeded');
  return { json, html };
}
