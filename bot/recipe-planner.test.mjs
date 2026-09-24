import test from 'node:test';
import assert from 'node:assert/strict';
import registryFactory from 'prismarine-registry';
import { planRecipeStep } from './recipe-planner.mjs';

const registry = registryFactory('1.16.5');
const plan = (name, inventory = {}, extra = {}) => planRecipeStep({ registry, name, inventory, ...extra });

test('real recipes advance from a log through planks, table, sticks and pickaxe', () => {
  assert.equal(plan('wooden_pickaxe', { oak_log: 1 }).name, 'oak_planks');
  assert.equal(plan('wooden_pickaxe', { oak_planks: 4 }).name, 'crafting_table');
  assert.deepEqual(plan('wooden_pickaxe', { crafting_table: 1 }).kind, 'place');
  assert.equal(plan('wooden_pickaxe', { oak_planks: 3 }, { hasTable: true }).name, 'stick');
  const ready = plan('wooden_pickaxe', { oak_planks: 3, stick: 2 }, { hasTable: true });
  assert.equal(ready.name, 'wooden_pickaxe');
  assert.equal(ready.count, 1);
});

test('an existing table avoids crafting another and an alternative wood recipe is used', () => {
  assert.equal(plan('wooden_pickaxe', { birch_log: 1 }, { hasTable: true }).name, 'birch_planks');
  assert.equal(plan('wooden_pickaxe', { oak_planks: 3, stick: 2 }, { hasTable: true }).name, 'wooden_pickaxe');
});

test('reserved target stock is kept and base material shortage is reported', () => {
  const result = plan('wooden_pickaxe', { oak_log: 1 }, { targets: { oak_log: 1 }, hasTable: true });
  assert.equal(result.kind, 'missing');
  assert.ok(result.missing.some((m) => /log|planks/.test(m.name)));
});

test('cyclic recipe data terminates with a bounded missing result', () => {
  const fake = { itemsByName: { a: { id: 1 }, b: { id: 2 } }, items: { 1: { name: 'a' }, 2: { name: 'b' } } };
  const recipesForItem = (id) => id === 1
    ? [{ result: { id: 1, count: 1 }, delta: [{ id: 2, count: -1 }, { id: 1, count: 1 }], requiresTable: false }]
    : [{ result: { id: 2, count: 1 }, delta: [{ id: 1, count: -1 }, { id: 2, count: 1 }], requiresTable: false }];
  const result = planRecipeStep({ registry: fake, recipesForItem, name: 'a', inventory: {}, maxDepth: 4 });
  assert.equal(result.kind, 'missing');
  assert.ok(result.missing.length);
});
