// SPDX-License-Identifier: MIT
// Independently authored application seam example, not a wrapper around the kit's reference adapter.
// Replace this in-memory business component with your reviewed synchronous pure code.
// Do not connect a production DB, HTTP client, queue, payment API or credentials.
export function createCustomerHandler(initial, beforeCommit) {
  let records = new Map(initial.resources.map(r => [r.id, structuredClone(r)]));
  let delivered = new Set(initial.processed);
  let effects = initial.sideEffects;
  return {
    applySnapshot(event, injectFailure) {
      if (delivered.has(event.id)) return 'DUPLICATE';
      const current = records.get(event.data.id);
      const newer = !current || current.revision < event.data.revision;
      const draftRecords = new Map(records);
      const draftDelivered = new Set(delivered);
      if (newer) draftRecords.set(event.data.id, structuredClone(event.data));
      draftDelivered.add(event.id);
      if (injectFailure) beforeCommit();
      records = draftRecords; delivered = draftDelivered; effects += newer ? 1 : 0;
      return newer ? 'APPLIED' : 'STALE';
    },
    snapshot() { return { resources: [...records.values()].map(r => structuredClone(r)), processed: [...delivered], sideEffects: effects }; },
  };
}
