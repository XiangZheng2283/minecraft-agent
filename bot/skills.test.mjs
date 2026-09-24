import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import registryFactory from 'prismarine-registry';
import { EventEmitter } from 'node:events';
import { blockSources, createSkills } from './skills.mjs';
import recipeFactory from 'prismarine-recipe';

const registry = registryFactory('1.16.5');
const Recipe = recipeFactory('1.16.5').Recipe;

function harness({ blocks = [], items = [], entities = {}, findBlock = () => null, pathfinder = {}, openContainer, openFurnace, placeBlock } = {}) {
  let inventory = items;
  const byPos = new Map(blocks.map((b) => [String(b.position), b]));
  const bot = {
    registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) },
    health: 20, food: 20, time: { timeOfDay: 0 }, entities, players: {},
    inventory: { items: () => inventory },
    findBlock: (args) => findBlock(args),
    findBlocks: ({ matching }) => blocks.filter((b) => matching.includes(b.type)).map((b) => b.position),
    blockAt: (pos) => byPos.get(String(pos)) || null,
    recipesFor: () => [],
    pathfinder: { bestHarvestTool: () => null, goto: async () => {}, setGoal: () => {}, ...pathfinder },
    clearControlStates: () => {}, waitForTicks: async () => {}, equip: async () => {},
    openContainer, openFurnace, placeBlock,
  };
  return { bot, skills: createSkills(bot), setInventory: (value) => { inventory = value; } };
}

function block(name, x, age) {
  const b = registry.blocksByName[name];
  return { name, type: b.id, position: new Vec3(x, 64, 0), harvestTools: b.harvestTools,
    getProperties: () => age === undefined ? {} : { age } };
}

function options(skills, targets, ctx = {}) { return skills.candidates({ plan: { targets }, ...ctx }); }

test('crop sources include mature potatoes and search beyond four infeasible targets', () => {
  assert.deepEqual(blockSources(registry, 'potato'), ['potatoes']);
  const { skills } = harness({ blocks: [block('potatoes', 2, 7), block('potatoes', 3, 2)] });
  const targetNames = ['diamond', 'emerald', 'redstone', 'lapis_lazuli', 'potato'];
  const targets = Object.fromEntries(targetNames.map((name) => [name, 1]));
  const mines = options(skills, targets).filter((o) => o.skill === 'gather_mine');
  assert.deepEqual(mines.map((o) => o.key), ['mine_(2, 64, 0)']);
});

test('mining candidate uses the same harvest tool requirement as execution', () => {
  const stone = block('stone', 2);
  let tool = null;
  const { skills } = harness({ blocks: [stone], pathfinder: { bestHarvestTool: () => tool } });
  assert.equal(options(skills, { cobblestone: 1 }).filter((o) => o.skill === 'gather_mine').length, 0);
  tool = { type: Number(Object.keys(stone.harvestTools)[0]), name: 'wooden_pickaxe' };
  assert.equal(options(skills, { cobblestone: 1 }).filter((o) => o.skill === 'gather_mine').length, 1);
});

test('missing harvest tool is explained and a craftable tool is offered when possible', async () => {
  const stone = block('stone', 2);
  const { skills, setInventory } = harness({ blocks: [stone], items: [{ name: 'oak_log', count: 1 }] });
  const blocked = options(skills, { cobblestone: 1 });
  assert.match(blocked.find((o) => o.skill === 'gather_blocked').description, /wooden_pickaxe|stone_pickaxe/);
  assert.equal((await blocked.find((o) => o.skill === 'gather_blocked').fn()).status, 'blocked');
  assert.ok(blocked.some((o) => o.key === 'craft_oak_planks'));
  setInventory([{ name: 'oak_planks', count: 4 }]);
  assert.ok(options(skills, { cobblestone: 1 }).some((o) => o.key === 'craft_crafting_table'));
});

test('craft dependency candidates form the real wood to pickaxe chain', () => {
  const { skills, setInventory, bot } = harness({ items: [{ name: 'oak_log', count: 1 }] });
  const next = () => options(skills, { wooden_pickaxe: 1 }).filter((o) => o.skill === 'craft' || o.key === 'place_table');
  assert.ok(next().some((o) => o.key === 'craft_oak_planks'));
  setInventory([{ name: 'oak_planks', count: 4 }]);
  assert.ok(next().some((o) => o.key === 'craft_crafting_table'));
  setInventory([{ name: 'crafting_table', count: 1 }]);
  assert.ok(next().some((o) => o.key === 'place_table'));
  bot.findBlock = ({ matching }) => matching === registry.blocksByName.crafting_table.id ? block('crafting_table', 1) : null;
  setInventory([{ name: 'oak_planks', count: 3 }]);
  assert.ok(next().some((o) => o.key === 'craft_stick'));
  setInventory([{ name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }]);
  assert.ok(next().some((o) => o.key === 'craft_wooden_pickaxe'));
});

test('craft caps batches by real inputs and verifies gained output', async () => {
  const { bot, skills, setInventory } = harness({ items: [{ name: 'oak_log', count: 1 }] });
  bot.recipesFor = (id) => Recipe.find(id);
  const calls = [];
  bot.craft = async (recipe, times) => { calls.push(times); setInventory([{ name: 'oak_planks', count: 4 }]); };
  const result = await skills.craft('oak_planks', 12);
  assert.deepEqual(calls, [1]);
  assert.equal(result.status, 'partial');
  assert.equal(result.evidence.gained, 4);
  bot.craft = async () => {};
  assert.equal((await skills.craft('stick', 4)).status, 'unconfirmed');
});

test('craft cancellation stops before issuing work', async () => {
  const { bot, skills } = harness({ items: [{ name: 'oak_log', count: 1 }] });
  bot.recipesFor = (id) => Recipe.find(id);
  let called = false;
  bot.craft = async () => { called = true; };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(skills.craft('oak_planks', 4, { signal: controller.signal }), /cancelled/);
  assert.equal(called, false);
});

test('candidate crafting preserves stock reserved for another target', () => {
  const { skills } = harness({ items: [{ name: 'oak_log', count: 1 }] });
  const craft = options(skills, { oak_log: 1, wooden_pickaxe: 1 }).filter((o) => o.skill === 'craft');
  assert.equal(craft.length, 0);
});

test('mining reports blocked, partial and verified pickup as distinct results', async () => {
  const stone = block('stone', 2);
  let tool = null, removed = false, setInventory;
  const h = harness({ blocks: [stone], pathfinder: { bestHarvestTool: () => tool } });
  const { bot, skills } = h;
  setInventory = h.setInventory;
  bot.dig = async () => { removed = true; };
  bot.blockAt = () => removed ? { name: 'air' } : stone;
  assert.equal((await skills.mine(stone)).status, 'blocked');
  tool = { type: Number(Object.keys(stone.harvestTools)[0]), name: 'wooden_pickaxe' };
  assert.equal((await skills.mine(stone)).status, 'partial');
  removed = false;
  bot.dig = async () => { removed = true; setInventory([{ name: 'cobblestone', count: 1 }]); };
  const result = await skills.mine(stone);
  assert.equal(result.status, 'success');
  assert.deepEqual(result.evidence.gained, ['1 cobblestone']);
  removed = false;
  setInventory([]);
  bot.dig = async () => { setInventory([{ name: 'potato', count: 1 }]); };
  assert.equal((await skills.mine(stone)).status, 'unconfirmed');
});

test('chest remains retryable after withdraw failure, and rechecks for a changed target', async () => {
  const chest = block('chest', 1);
  const checkedChests = new Set();
  let fail = true, closes = 0, withdrawals = 0;
  const { skills } = harness({ findBlock: ({ matching }) => Array.isArray(matching) ? chest : null,
    openContainer: async () => ({ containerItems: () => [{ name: 'bread', type: registry.itemsByName.bread.id, count: 2 }],
      withdraw: async () => { withdrawals++; if (fail) throw new Error('inventory full'); }, close: () => { closes++; } }) });
  const chestOption = (targets) => options(skills, targets, { checkedChests }).find((o) => o.skill === 'storage_inspect');
  await assert.rejects(chestOption({ bread: 2 }).fn(), /inventory full/);
  assert.ok(chestOption({ bread: 2 }), 'failed withdraw can retry');
  fail = false;
  await chestOption({ bread: 2 }).fn();
  assert.equal(withdrawals, 2);
  assert.equal(chestOption({ bread: 2 }), undefined);
  assert.ok(chestOption({ potato: 1 }), 'new target reopens chest');
  assert.equal(closes, 2);
});

test('chest withdraws only the remaining target deficit and safe food when hungry', async () => {
  const chest = block('chest', 1);
  const taken = [];
  const checkedChests = new Set();
  const { bot, skills, setInventory } = harness({ items: [{ name: 'bread', count: 1 }],
    findBlock: ({ matching }) => Array.isArray(matching) ? chest : null,
    openContainer: async () => ({ containerItems: () => [
      { name: 'bread', type: registry.itemsByName.bread.id, count: 8 },
      { name: 'rotten_flesh', type: registry.itemsByName.rotten_flesh.id, count: 8 }],
    withdraw: async (type, meta, count) => { taken.push({ type, count }); }, close: () => {} }) });
  await options(skills, { bread: 3 }, { checkedChests }).find((o) => o.skill === 'storage_inspect').fn();
  assert.deepEqual(taken, [{ type: registry.itemsByName.bread.id, count: 2 }]);
  taken.length = 0;
  bot.food = 12;
  setInventory([]);
  await options(skills, { bread: 3 }, { checkedChests }).find((o) => o.skill === 'storage_inspect').fn();
  assert.deepEqual(taken, [{ type: registry.itemsByName.bread.id, count: 4 }]);
});

test('after checking an empty nearby chest, the agent can inspect the next chest', async () => {
  const first = block('chest', 1), second = block('chest', 4);
  const checkedChests = new Set();
  const { skills } = harness({ blocks: [first, second], findBlock: () => first,
    openContainer: async (chest) => ({ containerItems: () => chest.position.x === 1 ? [] : [{ name: 'bread', type: registry.itemsByName.bread.id, count: 1 }],
      withdraw: async () => {}, close: () => {} }) });
  const option = () => options(skills, { bread: 1 }, { checkedChests }).find((o) => o.skill === 'storage_inspect');
  assert.match(option().description, /at 1 64 0/);
  await option().fn();
  assert.match(option().description, /at 4 64 0/);
});

test('a checked chest becomes inspectable again after its observation expires', async () => {
  const chest = block('chest', 1), checkedChests = new Set();
  let time = 100000;
  const { bot } = harness({ findBlock: () => chest,
    openContainer: async () => ({ containerItems: () => [], close: () => {} }) });
  const skills = createSkills(bot, { now: () => time });
  const option = () => options(skills, { bread: 1 }, { checkedChests }).find((o) => o.skill === 'storage_inspect');
  await option().fn();
  assert.equal(option(), undefined);
  time += 60001;
  assert.ok(option());
});

test('drop scan avoids deprecated objectType and reports path failure and inventory truthfully', async () => {
  const ordinary = { name: 'cow', displayName: 'Cow', position: new Vec3(2, 64, 0),
    get objectType() { throw new Error('deprecated objectType accessed'); } };
  const drop = { name: 'item', displayName: 'Item', position: new Vec3(1, 64, 0), isValid: true };
  let fail = true, gainOnMove = false, setInventory;
  const h = harness({ entities: { ordinary, drop }, pathfinder: { goto: async () => { if (fail) throw new Error('no path'); if (gainOnMove) setInventory([{ name: 'potato', count: 1 }]); } } });
  const { skills } = h;
  setInventory = h.setInventory;
  const pickup = options(skills, {}).find((o) => o.skill === 'gather_pickup');
  await assert.rejects(pickup.fn(), /no path/);
  fail = false;
  assert.match(await pickup.fn(), /attempt|not picked|unconfirmed/i);
  gainOnMove = true;
  assert.match(await pickup.fn(), /picked up.*potato/i);
  drop.isValid = false;
  assert.match(await pickup.fn(), /disappear|gone|no longer/i);
});

test('smelting output can be reclaimed after inventory input was deposited', async () => {
  const furnace = block('furnace', 1);
  const input = { name: 'iron_ore', type: registry.itemsByName.iron_ore.id, count: 2 };
  const fuel = { name: 'coal', type: registry.itemsByName.coal.id, count: 2 };
  let inventory = [input, fuel], output = null, putInput = 0, taken = 0;
  const { bot, skills, setInventory } = harness({ items: inventory,
    findBlock: ({ matching }) => matching === registry.blocksByName.furnace.id ? furnace : null,
    openFurnace: async () => ({ inputItem: () => putInput ? input : null, fuelItem: () => fuel,
      outputItem: () => output, putFuel: async () => {}, putInput: async () => { putInput++; inventory = [fuel]; setInventory(inventory); },
      takeOutput: async () => { taken++; output = null; inventory = [fuel, { name: 'iron_ingot', count: taken }]; setInventory(inventory); }, close: () => {} }) });
  const first = options(skills, { iron_ingot: 2 }).find((o) => o.skill === 'smelt');
  assert.ok(first);
  await first.fn();
  assert.equal(putInput, 1);
  output = { name: 'iron_ingot', count: 1 };
  const second = options(skills, { iron_ingot: 2 }).find((o) => /smelt/.test(o.skill) && /collect|take|output/i.test(o.description));
  assert.ok(second, 'output can be claimed without raw input in inventory');
  await second.fn();
  assert.equal(taken, 1);
  assert.equal(putInput, 1);
});

test('placement tries a second valid location after server rejects the first', async () => {
  const attempts = [], records = [];
  let placedAt;
  const { bot, skills } = harness({ items: [{ name: 'crafting_table', count: 1 }],
    placeBlock: async (below) => { attempts.push(String(below.position)); if (attempts.length === 1) throw new Error('server rejected placement'); placedAt = String(below.position.offset(0, 1, 0)); } });
  bot.blockAt = (pos) => pos.y === 63
    ? { name: 'dirt', boundingBox: 'block', position: pos }
    : { name: String(pos) === placedAt ? 'crafting_table' : 'air', position: pos };
  const withWorld = createSkills(bot, { world: { record: (event) => records.push(event) } });
  assert.equal((await withWorld.placeNear('crafting_table')).status, 'success');
  assert.equal(attempts.length, 2);
  assert.equal(records.length, 1);
});

test('unconfirmed workstation placement does not record a fictitious world block or place twice', async () => {
  const records = [];
  let attempts = 0;
  const { bot } = harness({ items: [{ name: 'crafting_table', count: 1 }], placeBlock: async () => { attempts++; } });
  bot.blockAt = (p) => ({ name: p.y === 63 ? 'dirt' : 'air', boundingBox: p.y === 63 ? 'block' : 'empty', position: p });
  const skills = createSkills(bot, { world: { record: (event) => records.push(event) } });
  assert.equal((await skills.placeNear('crafting_table')).status, 'unconfirmed');
  assert.equal(records.length, 0);
  assert.equal(attempts, 1);
});

test('delivery offers only outstanding target items and tosses the requested amount', async () => {
  const tossed = [];
  const wood = { name: 'oak_log', type: registry.itemsByName.oak_log.id, count: 14 };
  const stone = { name: 'cobblestone', type: registry.itemsByName.cobblestone.id, count: 2 };
  const { bot, skills } = harness({ items: [wood, stone] });
  bot.players.Steve = { entity: { position: new Vec3(1, 64, 0) } };
  bot.lookAt = async () => {};
  bot.toss = async (type, metadata, count) => { tossed.push({ type, count }); };
  const ctx = { request: { deliveryRequired: true, deliveryPending: false, deliveryDropped: ['oak_log'] },
    plan: { targets: { oak_log: 14, cobblestone: 2 }, deliveryTargets: ['oak_log', 'cobblestone'], deliveryAmounts: { oak_log: 2, cobblestone: 2 } } };
  const skillsWithOwner = createSkills(bot, { owners: ['Steve'] });
  const give = skillsWithOwner.candidates(ctx).filter((o) => o.skill === 'owner_give');
  assert.deepEqual(give.map((o) => o.key), ['give_cobblestone']);
  assert.match(give[0].description, /Drop 2 cobblestone/);
  await give[0].fn();
  assert.deepEqual(tossed, [{ type: stone.type, count: 2 }]);
  assert.match(await give[0].fn(), /awaiting owner receipt confirmation/);
});

test('abort stops pathing and closes a container that opens after cancellation', async () => {
  let resolveOpen, closed = 0, goalClears = 0;
  const chest = block('chest', 1);
  const { bot, skills } = harness({ findBlock: ({ matching }) => Array.isArray(matching) ? chest : null,
    openContainer: () => new Promise((resolve) => { resolveOpen = resolve; }),
    pathfinder: { goto: () => new Promise(() => {}), setGoal: (goal) => { if (!goal) goalClears++; } } });
  const movement = new AbortController();
  const going = skills.goNear(new Vec3(20, 64, 0), 2, movement.signal);
  movement.abort();
  await assert.rejects(going, /cancelled/i);
  assert.ok(goalClears > 0);
  const container = new AbortController();
  const inspecting = options(skills, {}, { checkedChests: new Set() }).find((o) => o.skill === 'storage_inspect').fn({ signal: container.signal });
  await new Promise((resolve) => setImmediate(resolve));
  container.abort();
  await assert.rejects(inspecting, /cancelled/i);
  resolveOpen({ close: () => { closed++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
});

test('sleep wait is cancellable and removes its wake listener', async () => {
  const bed = block('red_bed', 1);
  const { bot } = harness({ findBlock: ({ matching }) => typeof matching === 'function' ? bed : null });
  const events = new EventEmitter();
  bot.once = events.once.bind(events);
  bot.removeListener = events.removeListener.bind(events);
  bot.sleep = async () => {};
  let wakeCalls = 0;
  bot.wake = async () => { wakeCalls++; };
  bot.time.timeOfDay = 13000;
  const skills = createSkills(bot);
  const controller = new AbortController();
  const sleeping = options(skills, {}).find((o) => o.skill === 'sleep').fn({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.listenerCount('wake'), 1);
  controller.abort();
  await assert.rejects(sleeping, /cancelled/i);
  assert.equal(events.listenerCount('wake'), 0);
  assert.equal(wakeCalls, 1);
});

test('movement timeout clears its goal even when goto never settles', async () => {
  let clears = 0;
  const { bot } = harness({ pathfinder: { goto: () => new Promise(() => {}), setGoal: (goal) => { if (!goal) clears++; } } });
  const skills = createSkills(bot, { timeouts: { move: 5 } });
  await assert.rejects(skills.goNear(new Vec3(20, 64, 0)), /timed out/);
  assert.ok(clears > 0);
});

test('timed out native work stays pending until its original promise settles', async () => {
  const { skills } = harness();
  let finish;
  const work = skills.bounded(() => new Promise((resolve) => { finish = resolve; }), 5, 'Craft');
  await assert.rejects(work, /timed out/);
  assert.equal(skills.pending, true);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(skills.pending, false);
});

test('cancelled native work remains pending until rejection without an unhandled rejection', async () => {
  const { skills } = harness();
  const controller = new AbortController();
  let fail;
  const work = skills.bounded(() => new Promise((_, reject) => { fail = reject; }), 1000, 'Craft', controller.signal);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(work, /cancelled/);
  assert.equal(skills.pending, true);
  fail(new Error('native cancellation completed'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(skills.pending, false);
});
