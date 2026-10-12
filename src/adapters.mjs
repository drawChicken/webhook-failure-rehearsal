// SPDX-License-Identifier: MIT
import { validateState } from './contract.mjs';

export class SyntheticCommitFailure extends Error {
  constructor() { super('Injected synthetic failure before transaction commit'); this.name = 'SyntheticCommitFailure'; }
}

// Trusted synchronous developer code. This models an atomic in-memory transaction only.
export function referenceAdapter(initial) {
  let state = validateState(initial);
  return {
    handle(event, context) {
      if (state.processed.includes(event.id)) return 'DUPLICATE';
      const next = structuredClone(state);
      const old = next.resources.find(r => r.id === event.data.id);
      const applies = !old || event.data.revision > old.revision;
      if (applies) {
        next.resources = next.resources.filter(r => r.id !== event.data.id);
        next.resources.push(structuredClone(event.data)); next.sideEffects++;
      }
      next.processed.push(event.id);
      if (context.failBeforeCommit) throw new SyntheticCommitFailure();
      state = validateState(next);
      return applies ? 'APPLIED' : 'STALE';
    },
    inspect() { return structuredClone(state); },
  };
}

// Deliberately broken negative control: early ledger commit, no duplicate guard,
// unconditional snapshot overwrite and repeated simulated side effects.
export function buggyAdapter(initial) {
  const state = validateState(initial);
  return {
    handle(event, context) {
      if (!state.processed.includes(event.id)) state.processed.push(event.id);
      if (context.failBeforeCommit) throw new SyntheticCommitFailure();
      state.resources = state.resources.filter(r => r.id !== event.data.id);
      state.resources.push(structuredClone(event.data)); state.sideEffects++;
      return 'APPLIED';
    },
    inspect() { return structuredClone(state); },
  };
}
