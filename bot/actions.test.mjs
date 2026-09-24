import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { EventEmitter } from 'node:events';
import { createActionRegistry, ACTION_CATALOG, validateOperation } from './actions.mjs';

function fixture() {
  let items = [{ name: 'oak_log', type: 1, count: 8 }, { name: 'bread', type: 2, count: 2 }];
  const slots = [];
  const blocks = new Map();
  const bot = {
    registry: { itemsByName: { oak_log: { id: 1 }, bread: { id: 2 }, dirt: { id: 3 } }, foodsByName: { bread: {} } },
    inventory: { items: () => items, slots }, game: { dimension: 'overworld' },
    entity: { position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 }, entities: {}, food: 14,
    pathfinder: { setGoal: () => {} }, clearControlStates: () => {}, stopDigging: () => {}, deactivateItem: () => {},
    waitForTicks: async () => {}, blockAt: (p) => blocks.get(String(p)),
    getEquipmentDestSlot: (slot) => ({ hand: 36, head: 5, 'off-hand': 45 }[slot]),
    equip: async (item, slot) => { slots[bot.getEquipmentDestSlot(slot)] = item; if (slot === 'hand') bot.heldItem = item; },
  };
  const events = new EventEmitter();
  bot.on = events.on.bind(events); bot.off = events.off.bind(events); bot.emit = events.emit.bind(events);
  const skills = { goNear: async (p) => { bot.entity.position = new Vec3(p.x, p.y, p.z); } };
  const registry = createActionRegistry(bot, { skills, timeouts: { action: 100 } });
  const run = (action, args = {}, opts = {}) => registry.candidates({ plan: { operations: [{ action, args }] } })[0].fn(opts);
  return { bot, registry, run, blocks, setItems: (v) => { items = v; } };
}

test('catalog exposes typed gameplay operations and rejects unknown or unsafe inputs', () => {
  assert.ok(Object.keys(ACTION_CATALOG).length >= 25);
  assert.throws(() => validateOperation({ action: '__proto__', args: {} }), /Unknown/);
  assert.throws(() => validateOperation({ action: 'move', args: { position: { x: Infinity, y: 64, z: 0 } } }), /position/);
  assert.throws(() => validateOperation({ action: 'toss', args: { item: 'oak_log', count: -1 } }), /count/);
  assert.throws(() => validateOperation({ action: 'control', args: { control: 'forward', ticks: 10000 } }), /ticks/);
  assert.throws(() => validateOperation({ action: 'place', args: { item: 'dirt', reference: { x: 0, y: 63, z: 0 }, face: { x: 1, y: 1, z: 0 } } }), /face/);
  assert.throws(() => validateOperation({ action: 'dig', args: { position: { x: 0, y: 64, z: 0 } } }), /block/);
  assert.throws(() => validateOperation({ action: 'container', args: { position: { x: 0, y: 64, z: 0 }, mode: 'inspect', count: 1 } }), /Inspect/);
  assert.throws(() => validateOperation({ action: 'brew', args: { position: { x: 0, y: 64, z: 0 }, mode: 'inspect', slot: 100 } }), /slot/);
  assert.throws(() => validateOperation({ action: 'trade', args: { entityId: 1, count: 2 } }), /index/);
});

test('navigation verifies position and refuses stale dimension candidates', async () => {
  const { bot, registry, run } = fixture();
  assert.equal((await run('move', { position: { x: 4, y: 64, z: 2 } })).status, 'success');
  const candidate = registry.candidates({ plan: { operations: [{ action: 'move', args: { position: { x: 8, y: 64, z: 0 } } }] } })[0];
  bot.game.dimension = 'the_nether';
  assert.equal((await candidate.fn()).status, 'blocked');
});

test('equipment verifies actual destination slot and rejects missing carried items', async () => {
  const { bot, run } = fixture();
  assert.equal((await run('equip', { item: 'oak_log', slot: 'hand' })).status, 'success');
  bot.equip = async () => {};
  assert.equal((await run('equip', { item: 'bread', slot: 'head' })).status, 'unconfirmed');
  assert.equal((await run('equip', { item: 'dirt', slot: 'hand' })).status, 'blocked');
});

test('container transfer validates quantity, verifies inventory and closes window', async () => {
  const { bot, run, blocks, setItems } = fixture();
  const position = new Vec3(1, 64, 0);
  blocks.set(String(position), { name: 'chest', position });
  let closed = 0, transfers = 0;
  bot.openContainer = async () => ({ containerItems: () => [{ name: 'oak_log', type: 1, count: 3 }],
    withdraw: async (_id, _meta, count) => { transfers++; setItems([{ name: 'oak_log', type: 1, count: 8 + count }]); },
    close: () => { closed++; } });
  const result = await run('container', { position, mode: 'withdraw', item: 'oak_log', count: 2 });
  assert.equal(result.status, 'success');
  assert.equal(transfers, 1);
  assert.equal(closed, 1);
  assert.equal((await run('container', { position, mode: 'withdraw', item: 'oak_log', count: 4 })).status, 'blocked');
  assert.equal(transfers, 1);
  assert.equal(closed, 2);
});

test('an unacknowledged block placement is not reported as successful', async () => {
  const { bot, run, blocks, setItems } = fixture();
  setItems([{ name: 'dirt', type: 3, count: 2 }]);
  blocks.set('(1, 63, 0)', { name: 'stone', boundingBox: 'block', position: new Vec3(1, 63, 0) });
  blocks.set('(1, 64, 0)', { name: 'air', position: new Vec3(1, 64, 0) });
  bot.placeBlock = async () => {};
  assert.equal((await run('place', { item: 'dirt', reference: { x: 1, y: 63, z: 0 }, face: { x: 0, y: 1, z: 0 } })).status, 'unconfirmed');
});

test('unsupported API and no observable effect remain explicit', async () => {
  const { bot, run } = fixture();
  assert.equal((await run('fish')).reason, 'unsupported');
  bot.activateEntity = async () => {};
  bot.entities[7] = { id: 7, name: 'cow', position: new Vec3(1, 64, 0) };
  assert.equal((await run('activate_entity', { entityId: 7 })).status, 'unconfirmed');
});

test('aborted late opening window closes without performing a transfer', async () => {
  const { bot, run, blocks } = fixture();
  blocks.set('(1, 64, 0)', { name: 'chest', position: new Vec3(1, 64, 0) });
  let resolveOpen, closed = 0, transfers = 0;
  bot.openContainer = () => new Promise((resolve) => { resolveOpen = resolve; });
  const controller = new AbortController();
  const pending = run('container', { position: { x: 1, y: 64, z: 0 }, mode: 'withdraw', item: 'oak_log', count: 1 }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  const blocked = await run('move', { position: { x: 2, y: 64, z: 0 } });
  assert.equal(blocked.reason, 'operation_in_flight');
  resolveOpen({ containerItems: () => [], withdraw: async () => { transfers++; }, close: () => { closed++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
  assert.equal(transfers, 0);
});

test('craft can produce an item absent from inventory', async () => {
  const { bot, setItems } = fixture();
  const skills = { goNear: async () => {}, craft: async () => { setItems([{ name: 'oak_log', type: 1, count: 7 }, { name: 'crafting_table', count: 1 }]); return { status: 'success', summary: 'Crafted table' }; } };
  bot.registry.itemsByName.crafting_table = { id: 4 };
  const registry = createActionRegistry(bot, { skills });
  const candidate = registry.candidates({ plan: { operations: [{ action: 'craft', args: { item: 'crafting_table', count: 1 } }] } })[0];
  assert.equal((await candidate.fn()).status, 'success');
});

test('container verifies the player inventory after the window closes', async () => {
  const { bot, run, blocks, setItems } = fixture();
  blocks.set('(1, 64, 0)', { name: 'chest', position: new Vec3(1, 64, 0) });
  bot.openContainer = async () => ({ containerItems: () => [{ name: 'oak_log', type: 1, count: 2 }],
    withdraw: async () => {}, close: () => setItems([{ name: 'oak_log', type: 1, count: 9 }, { name: 'bread', type: 2, count: 2 }]) });
  assert.equal((await run('container', { position: { x: 1, y: 64, z: 0 }, mode: 'withdraw', item: 'oak_log', count: 1 })).status, 'success');
});

test('anvil does not claim success when input leaves inventory without output', async () => {
  const { bot, run, blocks, setItems } = fixture();
  blocks.set('(1, 64, 0)', { name: 'anvil', position: new Vec3(1, 64, 0) });
  bot.openAnvil = async () => ({ rename: async () => setItems([{ name: 'bread', type: 2, count: 2 }]), close: () => {} });
  assert.equal((await run('anvil', { position: { x: 1, y: 64, z: 0 }, item: 'oak_log', name: 'named log' })).status, 'unconfirmed');
});

test('enchantment requires a changed item rather than pre-existing NBT', async () => {
  const { bot, run, blocks } = fixture();
  blocks.set('(1, 64, 0)', { name: 'enchanting_table', position: new Vec3(1, 64, 0) });
  const existing = { name: 'oak_log', type: 1, count: 1, nbt: { old: true } };
  bot.inventory.items = () => [existing, { name: 'lapis_lazuli', count: 3 }];
  bot.openEnchantmentTable = async () => ({ putTargetItem: async () => {}, putLapis: async () => {},
    enchant: async () => ({ ...existing }), takeTargetItem: async () => {}, close: () => {} });
  assert.equal((await run('enchant', { position: { x: 1, y: 64, z: 0 }, item: 'oak_log', choice: 0 })).status, 'unconfirmed');
});

test('an opened window is closed on cancellation even if the open API never resolves', async () => {
  const { bot, run, blocks } = fixture();
  blocks.set('(1, 64, 0)', { name: 'chest', position: new Vec3(1, 64, 0) });
  bot.openContainer = () => new Promise(() => {});
  let closed = 0;
  const controller = new AbortController();
  const pending = run('container', { position: { x: 1, y: 64, z: 0 }, mode: 'inspect' }, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  bot.emit('windowOpen', { close: () => { closed++; } });
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, 1);
});

test('furnace load and collection validate inventory after closing', async () => {
  const { bot, run, blocks, setItems } = fixture();
  blocks.set('(1, 64, 0)', { name: 'furnace', position: new Vec3(1, 64, 0) });
  bot.openFurnace = async () => ({ inputItem: () => null, fuelItem: () => null, outputItem: () => null,
    putInput: async () => {}, close: () => setItems([{ name: 'oak_log', type: 1, count: 7 }, { name: 'bread', type: 2, count: 2 }]) });
  assert.equal((await run('smelt', { position: { x: 1, y: 64, z: 0 }, mode: 'input', item: 'oak_log', count: 1 })).status, 'success');
  bot.openFurnace = async () => ({ inputItem: () => null, fuelItem: () => null,
    outputItem: () => ({ name: 'charcoal', count: 2 }), takeOutput: async () => {},
    close: () => setItems([{ name: 'oak_log', type: 1, count: 7 }, { name: 'charcoal', count: 2 }]) });
  assert.equal((await run('smelt', { position: { x: 1, y: 64, z: 0 }, mode: 'collect' })).status, 'success');
});

test('brewing transfer uses the selected slot and verifies after close', async () => {
  const { bot, run, blocks, setItems } = fixture();
  blocks.set('(1, 64, 0)', { name: 'brewing_stand', position: new Vec3(1, 64, 0) });
  setItems([{ name: 'nether_wart', type: 9, count: 1 }, { name: 'bread', type: 2, count: 2 }]);
  let options;
  bot.transfer = async (o) => { options = o; };
  bot.openBlock = async () => ({ type: 'minecraft:brewing_stand', slots: Array(5).fill(null), inventoryStart: 5, inventoryEnd: 41,
    close: () => setItems([{ name: 'bread', type: 2, count: 2 }]) });
  assert.equal((await run('brew', { position: { x: 1, y: 64, z: 0 }, mode: 'put', slot: 3, item: 'nether_wart', count: 1 })).status, 'success');
  assert.deepEqual([options.destStart, options.destEnd], [3, 4]);
});

test('trade blocks missing materials and reports partial output', async () => {
  const { bot, run, setItems } = fixture();
  bot.entities[7] = { id: 7, name: 'villager', position: new Vec3(1, 64, 0) };
  let traded = 0, emeralds = 0;
  bot.trade = async () => { traded++; emeralds++; };
  const offer = { inputItem1: { name: 'oak_log', count: 5 }, outputItem: { name: 'emerald', count: 1 } };
  bot.openVillager = async () => ({ trades: [offer], close: () => {
    if (traded) setItems([{ name: 'oak_log', type: 1, count: 12 }, { name: 'emerald', count: emeralds }]);
  } });
  assert.equal((await run('trade', { entityId: 7, index: 0, count: 2 })).status, 'blocked');
  assert.equal(traded, 0);
  assert.equal((await run('trade', { entityId: 7, index: 0, count: 1 })).status, 'success');
  assert.equal(traded, 1);
  assert.equal((await run('trade', { entityId: 7, index: 0, count: 2 })).status, 'partial');
});

test('trade checks adjusted villager price before sending an offer', async () => {
  const { bot, run } = fixture();
  bot.entities[7] = { id: 7, name: 'villager', position: new Vec3(1, 64, 0) };
  bot.openVillager = async () => ({ trades: [{ inputItem1: { name: 'oak_log', count: 5 }, realPrice: 10,
    outputItem: { name: 'emerald', count: 1 } }], close: () => {} });
  let traded = false;
  bot.trade = async () => { traded = true; };
  assert.equal((await run('trade', { entityId: 7, index: 0, count: 1 })).status, 'blocked');
  assert.equal(traded, false);
});

test('brewing refuses an item in an incompatible slot before transferring', async () => {
  const { bot, run, blocks } = fixture();
  blocks.set('(1, 64, 0)', { name: 'brewing_stand', position: new Vec3(1, 64, 0) });
  bot.openBlock = async () => ({ type: 'minecraft:brewing_stand', slots: Array(5).fill(null), close: () => {} });
  let transferred = false;
  bot.transfer = async () => { transferred = true; };
  assert.equal((await run('brew', { position: { x: 1, y: 64, z: 0 }, mode: 'put', slot: 4, item: 'oak_log', count: 1 })).status, 'blocked');
  assert.equal(transferred, false);
});

test('portal remains unconfirmed without a dimension change', async () => {
  const { run, blocks } = fixture();
  blocks.set('(1, 64, 0)', { name: 'nether_portal', position: new Vec3(1, 64, 0) });
  assert.equal((await run('portal', { position: { x: 1, y: 64, z: 0 } })).status, 'unconfirmed');
});

test('cancelled control clears movement and timeout keeps unsettled operations locked', async () => {
  const { bot, registry } = fixture();
  let clears = 0;
  bot.clearControlStates = () => { clears++; };
  bot.setControlState = () => {};
  bot.waitForTicks = () => new Promise(() => {});
  const candidate = registry.candidates({ plan: { operations: [{ action: 'control', args: { control: 'forward', ticks: 2 } }] } })[0];
  const controller = new AbortController();
  const pending = candidate.fn({ signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  assert.equal((await pending).status, 'cancelled');
  assert.ok(clears > 0);
  assert.equal((await candidate.fn()).reason, 'operation_in_flight');
});

test('enchantment and anvil confirm changed items only after they return to inventory', async () => {
  const { bot, run, blocks, setItems } = fixture();
  const old = { name: 'oak_log', type: 1, count: 1, nbt: { value: 'old' } };
  const enchanted = { name: 'oak_log', type: 1, count: 1, nbt: { value: 'enchanted' } };
  setItems([old, { name: 'lapis_lazuli', type: 8, count: 3 }]);
  blocks.set('(1, 64, 0)', { name: 'enchanting_table', position: new Vec3(1, 64, 0) });
  bot.openEnchantmentTable = async () => ({ putTargetItem: async () => {}, putLapis: async () => {},
    enchant: async () => enchanted, takeTargetItem: async () => {}, close: () => setItems([enchanted]) });
  assert.equal((await run('enchant', { position: { x: 1, y: 64, z: 0 }, item: 'oak_log', choice: 0 })).status, 'success');
  blocks.set('(1, 64, 0)', { name: 'anvil', position: new Vec3(1, 64, 0) });
  const renamed = { name: 'oak_log', type: 1, count: 1, nbt: { value: 'renamed' } };
  bot.openAnvil = async () => ({ rename: async () => {}, close: () => setItems([renamed]) });
  assert.equal((await run('anvil', { position: { x: 1, y: 64, z: 0 }, item: 'oak_log', name: 'renamed' })).status, 'success');
});

test('target changed while travelling is blocked before block activation', async () => {
  const { bot, run, blocks } = fixture();
  const position = new Vec3(1, 64, 0);
  blocks.set(String(position), { name: 'lever', position });
  bot.activateBlock = async () => { throw new Error('stale target was activated'); };
  let read = 0;
  bot.blockAt = () => ++read === 1 ? { name: 'lever', position } : { name: 'air', position };
  assert.equal((await run('activate_block', { position: { x: 1, y: 64, z: 0 } })).reason, 'stale_target');
});

test('an action timeout retains the lock until the underlying movement settles', async () => {
  const { bot } = fixture();
  const registry = createActionRegistry(bot, { skills: { goNear: () => new Promise(() => {}) }, timeouts: { action: 5 } });
  const candidate = registry.candidates({ plan: { operations: [{ action: 'move', args: { position: { x: 2, y: 64, z: 0 } } }] } })[0];
  const first = await candidate.fn();
  assert.equal(first.reason, 'timeout');
  assert.equal((await candidate.fn()).reason, 'operation_in_flight');
});

test('an unsettled skill keeps the action lock after its wrapper rejects', async () => {
  const { bot } = fixture();
  let skillPending = false;
  const skills = { get pending() { return skillPending; },
    craft: async () => { skillPending = true; throw new Error('skill wrapper timed out'); },
    goNear: async (p) => { bot.entity.position = p; } };
  const registry = createActionRegistry(bot, { skills });
  const run = (action, args = {}) => registry.candidates({ plan: { operations: [{ action, args }] } })[0].fn();
  assert.equal((await run('craft', { item: 'crafting_table', count: 1 })).status, 'failed');
  assert.equal(registry.pending, true);
  assert.equal((await run('move', { position: { x: 2, y: 64, z: 0 } })).reason, 'operation_in_flight');
  assert.equal((await run('observe', { kind: 'inventory' })).status, 'success');
  assert.equal((await run('stop')).status, 'success');
  assert.equal(registry.pending, true, 'stop does not claim to finish the underlying craft');
  skillPending = false;
  assert.equal(registry.pending, false);
  assert.equal((await run('move', { position: { x: 2, y: 64, z: 0 } })).status, 'success');
});

test('observation modes, follow and look return bounded local evidence', async () => {
  const { bot, run, blocks } = fixture();
  const position = new Vec3(2, 64, 0);
  blocks.set(String(position), { name: 'stone', position, getProperties: () => ({}) });
  bot.entities[3] = { id: 3, name: 'cow', position };
  bot.recipesAll = () => [{ result: { id: 1, count: 4 }, delta: [], requiresTable: false }];
  let looked = false;
  bot.lookAt = async () => { looked = true; };
  assert.equal((await run('observe', { kind: 'inventory' })).status, 'success');
  assert.equal((await run('observe', { kind: 'entities' })).evidence.detail[0].name, 'cow');
  assert.equal((await run('observe', { kind: 'block', position })).evidence.detail.name, 'stone');
  assert.equal((await run('observe', { kind: 'recipes', item: 'oak_log' })).evidence.detail.length, 1);
  assert.equal((await run('follow', { entityId: 3 })).status, 'success');
  assert.equal((await run('look', { position })).status, 'success');
  assert.equal(looked, true);
});

test('vehicle, item use, toss and inventory slot branches report observed state', async () => {
  const { bot, run, setItems } = fixture();
  bot.entities[4] = { id: 4, name: 'boat', position: new Vec3(1, 64, 0) };
  bot.mount = (e) => { bot.vehicle = e; };
  bot.dismount = () => { bot.vehicle = null; };
  const steering = [];
  bot.moveVehicle = (...args) => steering.push(args);
  assert.equal((await run('mount', { entityId: 4 })).status, 'success');
  assert.equal((await run('vehicle', { sideways: 0.5, forward: 1, ticks: 2 })).status, 'success');
  assert.deepEqual(steering.at(-1), [0, 0]);
  assert.equal((await run('dismount')).status, 'success');
  bot.activateItem = () => {};
  assert.equal((await run('use', { item: 'oak_log', ticks: 1 })).status, 'unconfirmed');
  bot.toss = async () => setItems([{ name: 'oak_log', type: 1, count: 7 }, { name: 'bread', type: 2, count: 2 }]);
  assert.equal((await run('toss', { item: 'oak_log', count: 1 })).status, 'success');
  bot.inventory.slots[9] = { name: 'oak_log', type: 1, count: 1 };
  bot.moveSlotItem = async (from, to) => { bot.inventory.slots[to] = bot.inventory.slots[from]; bot.inventory.slots[from] = null; };
  assert.equal((await run('inventory_move', { fromSlot: 9, toSlot: 10 })).status, 'success');
  bot.unequip = async (slot) => { bot.inventory.slots[bot.getEquipmentDestSlot(slot)] = null; };
  assert.equal((await run('unequip', { slot: 'hand' })).status, 'success');
});

test('dig, pickup, attack, food, sleep, wake and fishing keep distinct receipts', async () => {
  const { bot, run, blocks, setItems } = fixture();
  const p = new Vec3(1, 64, 0);
  blocks.set(String(p), { name: 'dirt', position: p });
  // Dig in the registry requires the concrete skill; unsupported skill calls fail explicitly.
  assert.equal((await run('dig', { position: p, block: 'stone' })).status, 'blocked');
  bot.entities[5] = { id: 5, name: 'cow', position: p, isValid: true };
  bot.attack = (e) => { e.isValid = false; };
  assert.equal((await run('attack', { entityId: 5 })).status, 'unconfirmed');
  bot.consume = async () => { bot.food = 18; };
  assert.equal((await run('eat', { item: 'bread' })).status, 'success');
  blocks.set(String(p), { name: 'red_bed', position: p });
  bot.sleep = async () => { bot.isSleeping = true; };
  bot.wake = async () => { bot.isSleeping = false; };
  assert.equal((await run('sleep', { position: p })).status, 'success');
  assert.equal((await run('wake')).status, 'success');
  bot.fish = async () => setItems([{ name: 'oak_log', type: 1, count: 8 }, { name: 'bread', type: 2, count: 2 }, { name: 'cod', count: 1 }]);
  setItems([{ name: 'oak_log', type: 1, count: 8 }, { name: 'fishing_rod', type: 9, count: 1 }]);
  assert.equal((await run('fish')).status, 'success');
});

test('dig and pickup use concrete skill receipts and observed inventory gains', async () => {
  const { bot, blocks, setItems } = fixture();
  const p = new Vec3(1, 64, 0);
  blocks.set(String(p), { name: 'dirt', position: p });
  const skills = { goNear: async () => {}, mine: async () => ({ status: 'partial', summary: 'Block removed; drop pending' }),
    collectDrops: async () => { setItems([{ name: 'oak_log', type: 1, count: 8 }, { name: 'bread', type: 2, count: 2 }, { name: 'dirt', type: 3, count: 1 }]); return 'Picked up dirt'; } };
  const registry = createActionRegistry(bot, { skills });
  const run = (action, args) => registry.candidates({ plan: { operations: [{ action, args }] } })[0].fn();
  assert.equal((await run('dig', { position: p, block: 'dirt' })).status, 'partial');
  assert.equal((await run('pickup', { radius: 4 })).status, 'success');
  assert.equal((await run('pickup', { radius: 4 })).status, 'unconfirmed');
});

test('normal control and stop clear the exact control state', async () => {
  const { bot, run } = fixture();
  const states = [];
  bot.setControlState = (control, active) => states.push([control, active]);
  assert.equal((await run('control', { control: 'forward', ticks: 2 })).status, 'success');
  assert.deepEqual(states, [['forward', true], ['forward', false]]);
  assert.equal((await run('stop')).status, 'success');
});

test('anvil rejects a changed item after opening and closes the window', async () => {
  const { bot, run, blocks, setItems } = fixture();
  blocks.set('(1, 64, 0)', { name: 'anvil', position: new Vec3(1, 64, 0) });
  let closed = 0, renamed = false;
  bot.openAnvil = async () => {
    setItems([{ name: 'oak_log', type: 1, count: 1, nbt: { changed: true } }]);
    return { rename: async () => { renamed = true; }, close: () => { closed++; } };
  };
  assert.equal((await run('anvil', { position: { x: 1, y: 64, z: 0 }, item: 'oak_log', name: 'new' })).reason, 'stale_target');
  assert.equal(renamed, false);
  assert.equal(closed, 1);
});
