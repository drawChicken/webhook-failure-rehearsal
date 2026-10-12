export const PROFILE = 'synthetic-subscription-revision-v1';
export const state = (resources = [], processed = [], sideEffects = 0) => ({ resources, processed, sideEffects });
export const event = (id = 'evt_one', revision = 1, status = 'active', resource = 'sub_demo') => ({ id, type: 'subscription.snapshot', apiProfile: PROFILE, data: { id: resource, revision, status } });
export const suite = () => ({ schemaVersion: 1, apiProfile: PROFILE, synthetic: true, title: 'Synthetic contract sample', scenarios: [{ id: 'basic', title: 'Synthetic activation', initial: state(), attempts: [{ event: event(), failBeforeCommit: false, expect: { result: 'APPLIED', state: state([event().data], ['evt_one'], 1) } }] }] });
