import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openExperience } from './experience.mjs';

const fixtures = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'experience-test-'));
  fixtures.push(dir);
  let clock = 1000;
  const path = join(dir, 'nested', 'experience.db');
  return { path, now: () => clock, advance: ms => { clock += ms; } };
}
test.after(() => fixtures.forEach(dir => rmSync(dir, { recursive: true, force: true })));

const event = (overrides = {}) => ({
  taskVersion: 3, stepId: 'tool', goal: 'craft wooden pickaxe', world: 'world-a', version: '1.21.4',
  action: 'craft', args: { item: 'wooden_pickaxe' }, before: { wooden_pickaxe: 0 },
  after: { wooden_pickaxe: 1 }, result: { status: 'success', evidence: { inventoryDelta: 1 } }, ...overrides,
});
const episode = (evidenceIds, overrides = {}) => ({
  taskVersion: 3, stepId: 'tool', goal: 'craft wooden pickaxe', world: 'world-a', version: '1.21.4',
  reason: 'step_done', evidenceIds, ...overrides,
});
const memory = (evidenceIds, overrides = {}) => ({
  goal: 'craft wooden pickaxe', conditions: { inventoryMin: { oak_planks: 4 } }, advice: 'craft wooden pickaxe',
  avoidWhen: { inventoryMax: { oak_planks: 0 } }, evidenceIds, verification: 'verified',
  executionAction: 'craft', executionArgs: { item: 'wooden_pickaxe' }, ...overrides,
});

test('operation evidence and review queue survive restart, and lease expiry allows recovery', () => {
  const f = fixture();
  let s = openExperience(f);
  const evidenceId = s.record(event({ id: 'operation-1' }));
  assert.equal(s.record(event({ id: 'operation-1' })), evidenceId);
  assert.throws(() => s.record(event({ id: 'operation-1', world: 'other' })), /different evidence/);
  const queueId = s.enqueue(episode([evidenceId], { id: 'episode-1' }));
  assert.equal(s.enqueue(episode([evidenceId], { id: 'episode-1' })), queueId);
  const first = s.claim({ leaseMs: 100 });
  assert.equal(first.id, queueId);
  assert.equal(first.evidence[0].id, evidenceId);
  s.close();
  s = openExperience(f);
  assert.equal(s.claim({ leaseMs: 100 }), null);
  f.advance(101);
  const second = s.claim({ leaseMs: 100 });
  assert.equal(second.id, queueId);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(s.complete(first, { memories: [memory([evidenceId])] }), false);
  assert.equal(s.suspend(second, new Error('review still running')), true);
  assert.equal(s.claim(), null);
  s.close();
  s = openExperience(f);
  const recovered = s.claim();
  assert.equal(recovered.id, queueId);
  assert.notEqual(recovered.leaseToken, second.leaseToken);
  assert.equal(s.complete(recovered, { memories: [memory([evidenceId])] }), true);
  assert.equal(s.stats().queue.done, 1);
  s.close();
});

test('review refuses fabricated evidence and never promotes a model guess', () => {
  const f = fixture();
  const s = openExperience(f);
  const uncertain = s.record(event({ id: 'uncertain', after: null, result: { status: 'unconfirmed' } }));
  assert.throws(() => s.enqueue(episode([999])), /evidence/i);
  assert.throws(() => s.enqueue(episode(['made-up'])), /evidence/i);
  const id = s.enqueue(episode([uncertain]));
  const claim = s.claim();
  assert.equal(claim.id, id);
  assert.throws(() => s.complete(claim, { memories: [memory([999])] }), /evidence/i);
  assert.throws(() => s.complete(claim, { memories: [memory(['made-up'])] }), /evidence/i);
  assert.throws(() => s.complete(claim, { memories: [memory([uncertain], { conditions: Array(17).fill('extra fact') })] }), /too many conditions/);
  assert.equal(s.complete(claim, { memories: [memory([uncertain])] }), true);
  const recalled = s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } });
  assert.equal(recalled[0].verification, 'suggestion');
  assert.deepEqual(recalled[0].evidenceIds, [uncertain]);
  s.close();
});

test('same-class blockers merge evidence while duplicate review completion is idempotent', () => {
  const f = fixture();
  const s = openExperience(f);
  const a = s.record(event({ id: 'blocked-1', after: { wooden_pickaxe: 0 }, result: { status: 'blocked', evidence: { missing: 'table' } } }));
  const b = s.record(event({ id: 'blocked-2', after: { wooden_pickaxe: 0 }, result: { status: 'blocked', evidence: { missing: 'table' } } }));
  const first = s.enqueue(episode([a], { reason: 'craft_blocked' }));
  assert.equal(s.enqueue(episode([b], { reason: 'craft_blocked' })), first);
  const claim = s.claim();
  assert.deepEqual(claim.evidenceIds, [a, b]);
  assert.equal(claim.mergedCount, 2);
  const review = { memories: [memory([a, b], { advice: 'place crafting table first' })] };
  assert.equal(s.complete(claim, review), true);
  assert.equal(s.complete(claim, review), false);
  assert.equal(s.stats().memories, 2);
  assert.equal(s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } })[0].verification, 'observed_failure');
  s.close();
});

test('different blocker causes remain in separate review batches', () => {
  const f = fixture();
  const s = openExperience(f);
  const table = s.record(event({ id: 'missing-table', result: { status: 'blocked', evidence: { missing: 'table' } } }));
  const wood = s.record(event({ id: 'missing-wood', result: { status: 'blocked', evidence: { missing: 'wood' } } }));
  const first = s.enqueue(episode([table], { reason: 'craft_blocked' }));
  const second = s.enqueue(episode([wood], { reason: 'craft_blocked' }));
  assert.notEqual(first, second);
  assert.equal(s.stats().queue.pending, 2);
  s.close();
});

test('an explicit failed receipt without inventory change is an observed failure', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event({ after: { wooden_pickaxe: 0 }, result: { status: 'failed', reason: 'crafting table absent' } }));
  s.enqueue(episode([evidenceId]));
  s.complete(s.claim(), { memories: [memory([evidenceId])] });
  assert.equal(s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } })[0].verification, 'observed_failure');
  s.close();
});

test('retrieval filters world, version, conditions and returns concise bounded memories', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event());
  assert.throws(() => s.enqueue(episode([evidenceId], { world: null })), /world/);
  const claimId = s.enqueue(episode([evidenceId]));
  assert.ok(claimId);
  s.complete(s.claim(), { memories: [memory([evidenceId]), memory([evidenceId], { advice: 'another tip', conditions: { inventoryMin: { diamond: 1 } } })] });
  assert.equal(s.retrieve({ goal: 'craft wooden pickaxe', world: 'world-b', version: '1.21.4' }).length, 0);
  assert.equal(s.retrieve({ goal: 'craft wooden pickaxe', world: 'world-a', version: '1.20.4' }).length, 0);
  assert.equal(s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4' }).filter(item => item.verification === 'suggestion').length, 0);
  const matches = s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } }, { limit: 1 });
  assert.equal(matches.length, 1);
  assert.match(matches[0].advice, /Observed action craft/);
  assert.equal(matches[0].verification, 'verified');
  s.close();
});

test('a failed recommendation is observed failure, and later failed usage invalidates a verified tip', () => {
  const f = fixture();
  const s = openExperience(f);
  const success = s.record(event({ id: 'success' }));
  s.enqueue(episode([success]));
  s.complete(s.claim(), { memories: [memory([success])] });
  const context = { goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } };
  const learned = s.retrieve(context)[0];
  assert.equal(learned.verification, 'verified');
  const partial = s.record(event({ id: 'partial', result: { status: 'partial', evidence: { progress: 'sticks' } } }));
  assert.deepEqual(s.recordUsage(learned.id, { success: false, evidenceId: partial }),
    { id: learned.id, successCount: 0, failureCount: 0, partialCount: 1, verification: 'verified', recorded: true });
  const failed = s.record(event({ id: 'failed', after: { wooden_pickaxe: 0 }, result: { status: 'blocked', evidence: { missing: 'table' } } }));
  const noChange = s.record(event({ id: 'no-change', after: { wooden_pickaxe: 0 }, result: { status: 'blocked', evidence: {} } }));
  assert.throws(() => s.recordUsage(learned.id, { success: false, evidenceId: noChange }), /evidence/);
  assert.deepEqual(s.recordUsage(learned.id, { success: false, evidenceId: failed }),
    { id: learned.id, successCount: 0, failureCount: 1, partialCount: 1, verification: 'invalidated', recorded: true });
  assert.equal(s.recordUsage(learned.id, { success: false, evidenceId: failed }).recorded, false);
  assert.ok(s.retrieve(context).every(item => item.verification !== 'verified'));
  s.close();
});

test('free-text model advice stays a suggestion even when a cited action succeeded', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event());
  s.enqueue(episode([evidenceId]));
  s.complete(s.claim(), { memories: [memory([evidenceId], { advice: 'jump into lava after crafting' })] });
  const recalled = s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } });
  assert.equal(recalled.find(item => item.advice.includes('jump into lava')).verification, 'suggestion');
  assert.ok(recalled.some(item => item.verification === 'verified' && item.advice.startsWith('Observed action craft(')));
  assert.ok(recalled.filter(item => item.verification === 'verified').every(item => !item.advice.includes('lava')));
  s.close();
});

test('structured inventory bounds and dimension are exact, and old fact strings require explicit facts', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event());
  s.enqueue(episode([evidenceId]));
  s.complete(s.claim(), { memories: [memory([evidenceId], {
    conditions: [{ inventoryMin: { oak_planks: 4 }, inventoryMax: { sticks: 0 }, dimension: 'overworld' }, 'near crafting table'],
  })] });
  const base = { goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4' };
  const suggestions = conditions => s.retrieve({ ...base, conditions }).filter(item => item.verification === 'suggestion');
  assert.equal(suggestions({ inventory: { oak_planks: 3, sticks: 0 }, dimension: 'overworld', facts: ['near crafting table'] }).length, 0);
  assert.equal(suggestions({ inventory: { oak_planks: 4, sticks: 1 }, dimension: 'overworld', facts: ['near crafting table'] }).length, 0);
  assert.equal(suggestions({ inventory: { oak_planks: 4, sticks: 0 }, dimension: 'nether', facts: ['near crafting table'] }).length, 0);
  assert.equal(suggestions({ inventory: { oak_planks: 4, sticks: 0 }, dimension: 'overworld' }).length, 0);
  assert.equal(suggestions({ inventory: { oak_planks: 4, sticks: 0 }, dimension: 'overworld', facts: ['near crafting table'] }).length, 1);
  s.close();
});

test('oversized evidence remains stored but cannot be promoted after a truncated review', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event({ before: { wooden_pickaxe: 0, log: 'x'.repeat(2500) } }));
  s.enqueue(episode([evidenceId]));
  const claimed = s.claim();
  assert.equal(claimed.evidence[0].truncated, true);
  s.complete(claimed, { memories: [memory([evidenceId])] });
  const recalled = s.retrieve({ goal: 'wooden pickaxe', world: 'world-a', version: '1.21.4', conditions: { inventory: { oak_planks: 4 } } });
  assert.equal(recalled[0].verification, 'suggestion');
  s.close();
});

test('retrieval scans beyond 200 recent irrelevant memories', () => {
  const f = fixture();
  const s = openExperience(f);
  const evidenceId = s.record(event());
  s.enqueue(episode([evidenceId], { id: 'old', reason: 'old' }));
  s.complete(s.claim(), { memories: [{ goal: 'unique pickaxe', advice: 'old useful tip', evidenceIds: [] }] });
  for (let batch = 0; batch < 9; batch++) {
    s.enqueue(episode([evidenceId], { id: `other-${batch}`, reason: `other-${batch}` }));
    s.complete(s.claim(), { memories: Array.from({ length: 24 }, (_, n) => ({
      goal: 'unrelated objective', advice: `irrelevant ${batch}-${n}`, evidenceIds: [],
    })) });
  }
  assert.equal(s.retrieve({ goal: 'unique pickaxe', world: 'world-a', version: '1.21.4' })[0].advice, 'old useful tip');
  s.close();
});

test('failure backoff and queue overflow persist without dropping episodes', () => {
  const f = fixture();
  let s = openExperience({ ...f, maxPending: 1 });
  const a = s.record(event({ id: 'a' }));
  const b = s.record(event({ id: 'b' }));
  s.enqueue(episode([a], { id: 'one' }));
  const second = s.enqueue(episode([b], { id: 'two', reason: 'other' }));
  assert.equal(s.stats().queue.overflow, 1);
  const claim = s.claim();
  assert.equal(s.fail(claim, new Error('offline'), { baseDelayMs: 100 }), true);
  assert.equal(s.claim(), null);
  s.close();
  s = openExperience(f);
  assert.equal(s.stats().queue.pending, 1);
  f.advance(100);
  const retry = s.claim();
  assert.equal(retry.id, claim.id);
  s.complete(retry, { memories: [] });
  assert.equal(s.claim()?.id, second);
  s.close();
});

test('large evidence batches split into bounded review jobs and stable keys remain deduplicated', () => {
  const f = fixture();
  const s = openExperience({ ...f, maxPending: 1 });
  const evidenceIds = Array.from({ length: 29 }, (_, n) => s.record(event({ id: `batch-${n}` })));
  const first = s.enqueue(episode(evidenceIds, { id: 'large-batch' }));
  assert.equal(s.stats().queue.pending, 1);
  assert.equal(s.stats().queue.overflow, 3);
  let reviewed = 0;
  while (reviewed < 4) {
    const claimed = s.claim();
    assert.ok(claimed);
    assert.ok(claimed.evidence.length <= 8);
    s.complete(claimed, { memories: [] });
    reviewed++;
  }
  assert.equal(s.stats().queue.done, 4);
  assert.equal(s.enqueue(episode(evidenceIds, { id: 'large-batch' })), first);
  assert.equal(s.stats().queue.done, 4);
  s.close();
});
