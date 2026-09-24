import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanExecutor, validateSteps } from './plan-executor.mjs';

test('stages advance on inventory evidence and explicit operation receipts', () => {
  const plan = { steps: [
    { id: 'wood', description: 'Get wood', targets: { oak_log: 2 }, operations: [] },
    { id: 'travel', description: 'Travel', targets: {}, operations: [{ action: 'move', args: { x: 2, y: 64, z: 3 } }] },
  ] };
  const execution = createPlanExecutor(plan);
  assert.equal(execution.current().id, 'wood');
  assert.equal(execution.advance({ oak_log: 2 }).length, 1);
  assert.equal(execution.current().id, 'travel');
  assert.equal(execution.advance({ oak_log: 2 }).length, 0);
  assert.equal(execution.done(), false);
  execution.record({ action: 'move', args: { x: 2, y: 64, z: 3 } }, { status: 'blocked' });
  assert.equal(execution.done(), false);
  execution.record({ action: 'move', args: { x: 2, y: 64, z: 3 } }, { status: 'success' });
  assert.equal(execution.advance({ oak_log: 2 }).length, 1);
  assert.equal(execution.done(), true);
});

test('a stage without verifiable completion is invalid', () => {
  assert.throws(() => validateSteps([{ id: 'empty', description: 'Do something', targets: {}, operations: [] }]), /completion|targets|operations/i);
  assert.throws(() => validateSteps([{ id: 'a', description: 'A', targets: { oak_log: -1 } }]), /targets/i);
  assert.throws(() => validateSteps([{ id: 'a', description: 'A', operations: [{ action: 'dig', args: [] }] }]), /args/i);
  assert.throws(() => validateSteps([{ id: 'a', description: 'A', operations: [{ action: 'dig', args: {} }, { action: 'dig', args: {} }] }]), /duplicate/i);
});

test('a stage with both targets and operations needs both and hides receipted operations', () => {
  const operation = { action: 'craft', args: { item: 'wooden_pickaxe', count: 1 } };
  const execution = createPlanExecutor({ steps: [{ id: 'pick', description: 'Craft a pickaxe', targets: { wooden_pickaxe: 1 }, operations: [operation] }] });
  assert.equal(execution.advance({ wooden_pickaxe: 1 }).length, 0);
  execution.record(operation, { status: 'success' });
  assert.deepEqual(execution.pendingOperations(), []);
  assert.equal(execution.advance({ wooden_pickaxe: 1 }).length, 1);
});
