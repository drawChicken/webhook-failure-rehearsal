// SPDX-License-Identifier: MIT
import { SyntheticCommitFailure } from '../src/index.mjs';
import { createCustomerHandler } from './customer-handler.mjs';
// Code imports are fixed in reviewed developer source, never selected by fixture JSON.
export function customerAdapter(initial) {
  const app = createCustomerHandler(initial, () => { throw new SyntheticCommitFailure(); });
  return {
    handle(event, context) { return app.applySnapshot(event, context.failBeforeCommit); },
    inspect() { return app.snapshot(); },
  };
}
