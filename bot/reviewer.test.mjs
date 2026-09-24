import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openExperience } from './experience.mjs';
import { createReviewer } from './reviewer.mjs';

const operation = () => ({ goal: 'make tools', world: 'test', version: '1.21.4',
  action: 'craft', before: { sticks: 0 }, after: { sticks: 4 },
  result: { status: 'success', evidence: { sticks: 4 } } });
const setup = () => {
  let time = 1000;
  const now = () => time;
  const store = openExperience({ path: ':memory:', now });
  const evidenceId = store.record(operation());
  store.enqueue({ goal: 'make tools', world: 'test', version: '1.21.4', evidenceIds: [evidenceId] });
  return { store, evidenceId, now, advance: n => { time += n; } };
};

test('missing reviewer keeps queue pending and reports disabled state', async () => {
  const f = setup();
  const worker = createReviewer({ store: f.store, review: null, now: f.now });
  await worker.flush();
  assert.equal(worker.stats().enabled, false);
  assert.equal(f.store.stats().queue.pending, 1);
  await worker.stop();
  f.store.close();
});

test('reviewer drains a bounded batch and stores verified evidence', async () => {
  const f = setup();
  let calls = 0;
  const worker = createReviewer({ store: f.store, now: f.now, config: { maxPerFlush: 1 },
    review: async (episode, { signal }) => {
      assert.equal(signal.aborted, false);
      calls++;
      return { memories: [{ goal: episode.goal, conditions: { inventoryMin: { oak_planks: 4 } }, advice: 'craft sticks',
        evidenceIds: episode.evidenceIds, verification: 'verified', executionAction: 'craft', executionArgs: null }] };
    } });
  await worker.flush();
  assert.equal(calls, 1);
  assert.equal(f.store.stats().queue.done, 1);
  assert.equal(f.store.retrieve({ goal: 'make tools', world: 'test', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } })[0].verification, 'verified');
  await worker.stop();
  f.store.close();
});

test('API failure leaves durable pending review with backoff', async () => {
  const f = setup();
  let calls = 0;
  const worker = createReviewer({ store: f.store, now: f.now, config: { baseDelayMs: 200 },
    review: async () => { calls++; throw new Error('HTTP 503'); } });
  await worker.flush();
  assert.equal(calls, 1);
  assert.equal(f.store.stats().queue.pending, 1);
  await worker.flush();
  assert.equal(calls, 1);
  f.advance(200);
  await worker.flush();
  assert.equal(calls, 2);
  await worker.stop();
  f.store.close();
});

test('timeout releases a worker even when review ignores its abort signal', async () => {
  const f = setup();
  const worker = createReviewer({ store: f.store, now: f.now, config: { timeoutMs: 100 },
    review: async () => new Promise(() => {}) });
  await worker.flush();
  assert.equal(worker.stats().failures, 1);
  assert.equal(f.store.stats().queue.suspended, 1);
  assert.equal(f.store.claim(), null);
  await worker.stop();
  f.store.close();
});

test('late review result completes a suspended episode without a duplicate paid request', async () => {
  const f = setup();
  let resolveReview, calls = 0;
  const worker = createReviewer({ store: f.store, now: f.now, config: { timeoutMs: 100 },
    review: async () => { calls++; return new Promise(resolve => { resolveReview = resolve; }); } });
  await worker.flush();
  assert.equal(f.store.stats().queue.suspended, 1);
  await worker.flush();
  assert.equal(calls, 1);
  resolveReview({ memories: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.stats().queue.done, 1);
  await worker.stop();
  f.store.close();
});

test('kick debounces a burst and schedules remaining batches without another action', async () => {
  const f = setup();
  const more = f.store.record({ ...operation(), action: 'dig' });
  f.store.enqueue({ goal: 'make tools', world: 'test', version: '1.21.4', reason: 'other', evidenceIds: [more] });
  let calls = 0;
  const worker = createReviewer({ store: f.store, now: Date.now,
    config: { maxPerFlush: 1, debounceMs: 20, minIntervalMs: 20 },
    review: async () => { calls++; return { memories: [] }; } });
  worker.kick();
  worker.kick();
  assert.equal(calls, 0);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(calls, 2);
  assert.equal(f.store.stats().queue.done, 2);
  await worker.stop();
  f.store.close();
});

test('malformed late review returns to backoff instead of remaining suspended forever', async () => {
  const f = setup();
  let resolveReview;
  const worker = createReviewer({ store: f.store, now: f.now, config: { timeoutMs: 100, baseDelayMs: 200 },
    review: () => new Promise(resolve => { resolveReview = resolve; }) });
  await worker.flush();
  assert.equal(f.store.stats().queue.suspended, 1);
  resolveReview({ memories: [{ advice: 'missing evidence' }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.store.stats().queue.suspended, 0);
  assert.equal(f.store.stats().queue.pending, 1);
  assert.equal(f.store.claim(), null, 'backoff prevents an immediate retry');
  await worker.stop();
  f.store.close();
});
