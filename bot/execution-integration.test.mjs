import test from 'node:test';
import assert from 'node:assert/strict';
import registryFactory from 'prismarine-registry';
import recipeFactory from 'prismarine-recipe';
import { Vec3 } from 'vec3';
import { createSkills, inventoryCounts } from './skills.mjs';
import { createActionRegistry } from './actions.mjs';
import { createAgent } from './agent.mjs';
import { openExperience } from './experience.mjs';
import { createReviewer } from './reviewer.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('real recipes and skill candidates bootstrap a pickaxe while preserving standing log stock', async () => {
  const registry = registryFactory('1.16.5');
  const Recipe = recipeFactory(registry).Recipe;
  const inventory = { oak_log: 16 }, blocks = new Map(), performed = [];
  function put(name, p) {
    const data = registry.blocksByName[name];
    blocks.set(String(p), { name, type: data.id, harvestTools: data.harvestTools, position: p, boundingBox: 'block' });
  }
  for (let x = 2; x < 7; x++) put('oak_log', new Vec3(x, 64, 0));
  for (let x = 2; x < 4; x++) put('stone', new Vec3(x, 64, 2));
  const bot = {
    registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) },
    food: 20, health: 20, time: { timeOfDay: 0 }, entities: {}, players: {},
    inventory: { items: () => Object.entries(inventory).filter(([, count]) => count > 0).map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) },
    findBlock: ({ matching }) => [...blocks.values()].find((b) => typeof matching === 'function' ? matching(b) : Array.isArray(matching) ? matching.includes(b.type) : b.type === matching) || null,
    findBlocks: ({ matching }) => [...blocks.values()].filter((b) => matching.includes(b.type)).map((b) => b.position),
    blockAt: (p) => blocks.get(String(p)) || (p.y === 63 ? { name: 'dirt', position: p, boundingBox: 'block' } : { name: 'air', position: p, boundingBox: 'empty' }),
    equip: async () => {}, clearControlStates: () => {}, waitForTicks: async () => {}, stopDigging: () => {},
    pathfinder: { goto: async () => {}, setGoal: () => {}, bestHarvestTool: (block) => bot.inventory.items().find((i) => block.harvestTools?.[i.type]) },
    recipesFor: (id, _metadata, _count, table) => Recipe.find(id).filter((r) => (!r.requiresTable || table) && r.delta.every((d) => d.count >= 0 || (inventory[registry.items[d.id].name] || 0) >= -d.count)),
    craft: async (recipe, count, table) => {
      assert.ok(!recipe.requiresTable || table);
      for (const d of recipe.delta) inventory[registry.items[d.id].name] = (inventory[registry.items[d.id].name] || 0) + d.count * count;
      assert.ok(Object.values(inventory).every((n) => n >= 0));
    },
    placeBlock: async (below, face) => { assert.ok(inventory.crafting_table); inventory.crafting_table--; put('crafting_table', below.position.plus(face)); },
    dig: async (block) => { blocks.delete(String(block.position)); const name = block.name === 'stone' ? 'cobblestone' : block.name; inventory[name] = (inventory[name] || 0) + 1; },
  };
  const skills = createSkills(bot), targets = { oak_log: 16, cobblestone: 2 };
  for (let i = 0; i < 30 && (inventory.cobblestone || 0) < 2; i++) {
    const currentTargets = inventory.wooden_pickaxe ? { cobblestone: 2 } : { wooden_pickaxe: 1 };
    const options = skills.candidates({ plan: { targets: currentTargets, reserveTargets: targets } });
    const option = options.find((o) => o.skill === 'craft' || o.skill === 'build_place') || options.find((o) => o.skill === 'gather_mine');
    assert.ok(option, 'a productive preparation or harvest option must exist');
    performed.push(option.key);
    const outcome = await option.fn();
    assert.notEqual(outcome?.status, 'blocked', JSON.stringify(outcome));
    assert.ok(inventory.oak_log >= 16, 'standing stock is reserved throughout preparation');
  }
  assert.ok(inventory.wooden_pickaxe >= 1, JSON.stringify(performed));
  assert.equal(inventoryCounts(bot).cobblestone, 2, JSON.stringify(performed));
  assert.ok(performed.includes('craft_oak_planks'));
  assert.ok(performed.includes('craft_stick'));
  assert.ok(performed.includes('place_table'));
});

test('Plan stages execute through real registry, persist review evidence, and feed reviewed memory back locally', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mc-flow-'));
  const experience = openExperience({ path: path.join(dataDir, 'experience.db') });
  const bot = { username: 'Tester', entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' }, inventory: { items: () => [], slots: [] },
    health: 20, food: 20, time: { timeOfDay: 1000 }, entities: {}, players: {}, registry: {},
    pathfinder: { setGoal: () => {} }, clearControlStates: () => {}, stopDigging: () => {}, deactivateItem: () => {},
    chat: () => {}, whisper: () => {}, off: () => {}, waitForTicks: async () => {} };
  const skills = { candidates: () => [], goNear: async (p) => { bot.entity.position = new Vec3(p.x, p.y, p.z); } };
  const actions = createActionRegistry(bot, { skills });
  let plans = 0, decisions = 0, reviews = 0;
  const reviewer = createReviewer({ store: experience, config: { debounceMs: 10000 }, review: async (episode) => {
    reviews++;
    const evidence = episode.evidence.at(-1);
    return { memories: [{ goal: 'Reach destination', conditions: { dimension: 'overworld' }, advice: 'Approach the destination using a verified navigation operation.',
      evidenceIds: [evidence.id], executionAction: evidence.action, executionArgs: evidence.args, verification: 'verified' }] };
  } });
  const config = { name: 'helper', role: 'helper', duties: [], goals: ['Reach destination'], owners: [],
    account: { username: 'Tester' }, server: { host: 'fixture', port: 25565, version: '1.16.5' }, worldId: 'flow-fixture',
    dataDir, actions: { allow: ['*'], deny: [] }, planIntervalMs: 1 };
  const agent = createAgent({ config, bot, skills, actions, experience, reviewer,
    world: { nearest: () => [], summary: () => [], note: () => {}, searchNotes: () => [], stats: () => ({}) }, log: () => {},
    models: {
      plan: async () => { plans++; return { result: { objective: 'Reach destination', targets: {}, steps: [
        { id: 'approach', description: 'First waypoint', operations: [{ action: 'move', args: { position: { x: 8, y: 64, z: 0 } } }] },
        { id: 'arrive', description: 'Final waypoint', operations: [{ action: 'move', args: { position: { x: 12, y: 64, z: 0 } } }] },
      ] } }; },
      decide: async (_state, options) => { decisions++; return { selected: options.find((o) => o.operation?.action === 'move') }; },
    } });
  t.after(async () => {
    agent.stop(); await reviewer.stop(); experience.close();
    assert.ok(path.resolve(dataDir).startsWith(path.resolve(tmpdir()) + path.sep));
    rmSync(dataDir, { recursive: true, force: true });
  });
  agent.request('Reach destination', 'api');
  await agent.step(); await agent.step();
  assert.equal(bot.entity.position.x, 12);
  assert.equal(agent.status().request, null);
  assert.equal(plans, 1);
  assert.equal(decisions, 2);
  assert.equal(experience.stats().events, 2);
  await reviewer.flush();
  assert.equal(reviews, 2);
  assert.equal(experience.stats().queue.done, 2);
  assert.ok(agent.observation().applicableExperience.some((m) => m.verification === 'verified'));
});
