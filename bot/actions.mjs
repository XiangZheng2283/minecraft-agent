// Parameterized gameplay adapters. Model output is data, never executable code.
import { Vec3 } from 'vec3';

const definition = (skill, description, args = {}) => ({ skill, description, args });
export const ACTION_CATALOG = Object.freeze({
  observe: definition('observe', 'Read inventory, equipment, entities, blocks or recipes', { kind: 'inventory|entities|block|recipes', position: 'optional xyz', item: 'optional item id' }),
  move: definition('travel_waypoint', 'Navigate near a position', { position: 'xyz', range: '0..4 optional' }),
  follow: definition('owner_follow', 'Approach a visible entity', { entityId: 'integer', range: '1..4 optional' }),
  stop: definition('wait', 'Stop movement and item use'),
  look: definition('look', 'Look at a position', { position: 'xyz' }),
  control: definition('travel_control', 'Hold a movement control for bounded ticks', { control: 'forward|back|left|right|jump|sprint|sneak', ticks: '1..40' }),
  mount: definition('travel_vehicle', 'Mount a visible vehicle', { entityId: 'integer' }),
  dismount: definition('travel_vehicle', 'Leave the current vehicle'),
  vehicle: definition('travel_vehicle', 'Steer a mounted vehicle for bounded ticks', { sideways: '-1..1', forward: '-1..1', ticks: '1..40' }),
  dig: definition('gather_mine', 'Mine a named block at a position', { position: 'xyz', block: 'expected block name' }),
  place: definition('build_place', 'Place an item against a specific block face', { item: 'item id', reference: 'xyz', face: 'axis unit xyz' }),
  activate_block: definition('interact_block', 'Use a block; optionally hold an item', { position: 'xyz', item: 'optional item id' }),
  activate_entity: definition('interact_entity', 'Interact with an entity; feeding/shearing uses held item', { entityId: 'integer', item: 'optional item id' }),
  equip: definition('equip', 'Equip an inventory item in an equipment slot', { item: 'item id', slot: 'hand|off-hand|head|torso|legs|feet' }),
  unequip: definition('equip', 'Clear an equipment slot', { slot: 'hand|off-hand|head|torso|legs|feet' }),
  use: definition('use_item', 'Use held item for bounded ticks; supports shield/bow', { item: 'item id', ticks: '1..40', offhand: 'optional boolean' }),
  toss: definition('owner_give', 'Drop an exact quantity of an inventory item', { item: 'item id', count: '1..64' }),
  pickup: definition('gather_pickup', 'Collect nearby drops', { radius: '1..12 optional' }),
  craft: definition('craft', 'Craft a quantity using existing skills', { item: 'item id', count: '1..64' }),
  container: definition('storage_inspect', 'Inspect, withdraw or deposit at a container', { position: 'xyz', mode: 'inspect|withdraw|deposit', item: 'required for transfer', count: '1..64 for transfer' }),
  inventory_move: definition('inventory_manage', 'Move a stack within player storage/hotbar slots', { fromSlot: '9..44', toSlot: '9..44' }),
  smelt: definition('smelt', 'Inspect furnace, load input/fuel or collect output', { position: 'xyz', mode: 'inspect|input|fuel|collect', item: 'required for load', count: '1..64 for load' }),
  brew: definition('brew', 'Inspect or transfer items into/out of brewing slots', { position: 'xyz', mode: 'inspect|put|take', slot: '0..4 for transfer', item: 'for put', count: '1..64 for put' }),
  attack: definition('combat_attack', 'One bounded melee attack; damage may be unconfirmed', { entityId: 'integer', item: 'optional weapon' }),
  eat: definition('eat', 'Consume an explicitly named safe food', { item: 'food item id' }),
  sleep: definition('sleep', 'Sleep in a named nearby bed', { position: 'xyz' }),
  wake: definition('sleep', 'Wake from sleep'),
  fish: definition('fish', 'Fish once with a carried fishing rod'),
  trade: definition('trade', 'Inspect villager offers or execute one offer', { entityId: 'integer', index: 'optional 0..255', count: '1..64 optional' }),
  enchant: definition('enchant', 'Enchant a carried item at a table', { position: 'xyz', item: 'item id', choice: '0..2' }),
  anvil: definition('anvil', 'Rename or combine carried items at an anvil', { position: 'xyz', item: 'item id', secondItem: 'optional item id', name: 'optional max 35 chars' }),
  portal: definition('travel_portal', 'Enter an existing portal and verify dimension change', { position: 'xyz' }),
});

const ITEM = /^[a-z0-9_]{1,80}$/;
const SLOTS = ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'];
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
function integer(v, min, max, field) { if (!Number.isSafeInteger(v) || v < min || v > max) throw new TypeError(`Invalid ${field}: expected integer ${min}..${max}`); }
function position(p, field) { if (!p || !['x', 'y', 'z'].every((k) => finite(p[k])) || Math.abs(p.x) > 30000000 || Math.abs(p.z) > 30000000 || Math.abs(p.y) > 2048) throw new TypeError(`Invalid ${field} position`); }
function name(v, field) { if (typeof v !== 'string' || !ITEM.test(v)) throw new TypeError(`Invalid ${field}`); }
function oneOf(v, list, field) { if (!list.includes(v)) throw new TypeError(`Invalid ${field}: ${list.join('|')}`); }

export function validateOperation(operation) {
  if (!operation || !Object.hasOwn(ACTION_CATALOG, operation.action)) throw new TypeError('Unknown game action');
  const { action } = operation, a = operation.args ?? {};
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new TypeError('Invalid action args');
  const fields = ACTION_CATALOG[action].args;
  for (const key of Object.keys(a)) if (!Object.hasOwn(fields, key)) throw new TypeError(`Unknown ${action} argument: ${key}`);
  for (const field of ['position', 'reference']) if (a[field] !== undefined) position(a[field], field);
  if (['move', 'look', 'dig', 'activate_block', 'container', 'smelt', 'brew', 'sleep', 'enchant', 'anvil', 'portal'].includes(action)) position(a.position, 'position');
  if (a.item !== undefined) name(a.item, 'item');
  if (['place', 'equip', 'use', 'toss', 'craft', 'eat', 'enchant', 'anvil'].includes(action)) name(a.item, 'item');
  if (a.count !== undefined) integer(a.count, 1, 64, 'count');
  if (['toss', 'craft'].includes(action)) integer(a.count, 1, 64, 'count');
  if (a.entityId !== undefined || ['follow', 'mount', 'activate_entity', 'attack', 'trade'].includes(action)) integer(a.entityId, 0, 2147483647, 'entityId');
  if (a.range !== undefined && (!finite(a.range) || a.range < 0 || a.range > 4)) throw new TypeError('Invalid range');
  if (a.radius !== undefined && (!finite(a.radius) || a.radius < 1 || a.radius > 12)) throw new TypeError('Invalid radius');
  if (['control', 'vehicle', 'use'].includes(action)) integer(a.ticks, 1, 40, 'ticks');
  if (action === 'control') oneOf(a.control, ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'], 'control');
  if (action === 'vehicle') for (const k of ['sideways', 'forward']) if (!finite(a[k]) || Math.abs(a[k]) > 1) throw new TypeError(`Invalid ${k}`);
  if (action === 'dig') name(a.block, 'block');
  if (action === 'place') {
    position(a.reference, 'reference'); position(a.face, 'face');
    if (!['x', 'y', 'z'].every((k) => Number.isInteger(a.face[k])) || Math.abs(a.face.x) + Math.abs(a.face.y) + Math.abs(a.face.z) !== 1) throw new TypeError('Invalid face: expected axis unit vector');
  }
  if (['equip', 'unequip'].includes(action)) oneOf(a.slot, SLOTS, 'slot');
  if (a.offhand !== undefined && typeof a.offhand !== 'boolean') throw new TypeError('Invalid offhand');
  if (action === 'inventory_move') { integer(a.fromSlot, 9, 44, 'fromSlot'); integer(a.toSlot, 9, 44, 'toSlot'); }
  if (action === 'container') {
    oneOf(a.mode, ['inspect', 'withdraw', 'deposit'], 'mode');
    if (a.mode !== 'inspect') { name(a.item, 'item'); integer(a.count, 1, 64, 'count'); }
    else if (a.item !== undefined || a.count !== undefined) throw new TypeError('Inspect has no transfer arguments');
  }
  if (action === 'smelt') {
    oneOf(a.mode, ['inspect', 'input', 'fuel', 'collect'], 'mode');
    if (['input', 'fuel'].includes(a.mode)) { name(a.item, 'item'); integer(a.count, 1, 64, 'count'); }
    else if (a.item !== undefined || a.count !== undefined) throw new TypeError('Furnace inspect/collect has no load arguments');
  }
  if (action === 'brew') {
    oneOf(a.mode, ['inspect', 'put', 'take'], 'mode');
    if (a.mode !== 'inspect') integer(a.slot, 0, 4, 'slot');
    else if (a.slot !== undefined) throw new TypeError('Brewing inspect has no slot');
    if (a.mode === 'put') { name(a.item, 'item'); integer(a.count, 1, 64, 'count'); }
    else if (a.item !== undefined || a.count !== undefined) throw new TypeError('Brewing inspect/take has no input item');
  }
  if (action === 'trade' && a.index !== undefined) integer(a.index, 0, 255, 'index');
  if (action === 'trade' && a.index === undefined && a.count !== undefined) throw new TypeError('Trade count requires an offer index');
  if (action === 'enchant') integer(a.choice, 0, 2, 'choice');
  if (action === 'anvil') {
    if (a.secondItem !== undefined) name(a.secondItem, 'secondItem');
    if (a.name !== undefined && (typeof a.name !== 'string' || !a.name.length || a.name.length > 35 || /[\x00-\x1f]/.test(a.name))) throw new TypeError('Invalid anvil name');
    if (!a.secondItem && !a.name) throw new TypeError('Anvil requires secondItem or name');
  }
  if (action === 'observe') { oneOf(a.kind ?? 'inventory', ['inventory', 'entities', 'block', 'recipes'], 'kind'); if (a.kind === 'block') position(a.position, 'position'); if (a.kind === 'recipes') name(a.item, 'item'); }
  return { action, args: JSON.parse(JSON.stringify(a)) };
}

const result = (status, summary, extra = {}) => ({ status, summary, ...extra });
const blocked = (reason, summary, extra = {}) => result('blocked', summary, { reason, ...extra });
const vec = (p) => new Vec3(p.x, p.y, p.z);
const counts = (bot) => { const out = {}; for (const i of bot.inventory.items()) out[i.name] = (out[i.name] || 0) + i.count; return out; };
const brief = (i) => i && ({ name: i.name, count: i.count, type: i.type, slot: i.slot });
const itemState = (i) => JSON.stringify(i && ({ name: i.name, type: i.type, metadata: i.metadata, nbt: i.nbt, enchants: i.enchants, displayName: i.displayName }));
const snapshot = (bot) => ({ inventory: counts(bot), position: bot.entity?.position && { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }, dimension: bot.game?.dimension, food: bot.food });

export function createActionRegistry(bot, { skills, world, timeouts = {} } = {}) {
  let inFlight = null;
  const maxMs = timeouts.action ?? 30000;
  const check = (signal) => { if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Action cancelled'); };
  const clean = () => { bot.pathfinder?.setGoal(null); bot.clearControlStates?.(); bot.stopDigging?.(); bot.deactivateItem?.(); };
  const held = (n) => bot.inventory.items().find((i) => i.name === n);
  const requireApi = (key) => { if (typeof bot[key] !== 'function') { const e = new Error(`Game API ${key} is unavailable`); e.code = 'UNSUPPORTED'; throw e; } };
  const requireItem = (n, count = 1) => { const item = held(n); if (!item || (counts(bot)[n] || 0) < count) { const e = new Error(`Need ${count} ${n}`); e.code = 'MISSING_ITEM'; throw e; } return item; };
  const blockAt = (p, expected) => { const b = bot.blockAt(vec(p).floored()); if (!b || (expected && b.name !== expected)) { const e = new Error(`Expected ${expected || 'loaded block'} at ${vec(p)}`); e.code = 'STALE_TARGET'; throw e; } return b; };
  const entityAt = (id) => { const e = bot.entities[id]; if (!e || e.isValid === false) { const error = new Error(`Entity ${id} is not visible`); error.code = 'STALE_TARGET'; throw error; } return e; };
  const near = async (p, range, signal) => { check(signal); await skills.goNear(vec(p), range, signal); check(signal); };
  const ticks = async (n, signal) => { check(signal); await bot.waitForTicks(n); check(signal); };
  const equip = async (n, slot, signal) => { requireApi('equip'); check(signal); await bot.equip(requireItem(n), slot); check(signal); };
  async function withWindow(api, target, signal, fn) {
    requireApi(api); check(signal);
    let observed, closing;
    const close = (window) => {
      if (!window) return Promise.resolve();
      if (!closing) closing = Promise.resolve().then(() =>
        typeof window.close === 'function' ? window.close() : bot.closeWindow?.(window));
      return closing;
    };
    const onOpen = (window) => { observed = window; if (signal?.aborted) void close(window).catch(() => {}); };
    const onAbort = () => { if (observed) void close(observed).catch(() => {}); };
    bot.on?.('windowOpen', onOpen);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const window = await bot[api](target);
      observed = window;
      try { check(signal); return await fn(window); }
      finally { await close(window); }
    } catch (error) {
      if (observed) await close(observed).catch(() => {});
      throw error;
    } finally {
      bot.off?.('windowOpen', onOpen);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  function delta(before, name, wanted, direction = 1) {
    const actual = ((counts(bot)[name] || 0) - (before[name] || 0)) * direction;
    return result(actual >= wanted ? 'success' : actual > 0 ? 'partial' : 'unconfirmed', `${name}: observed ${actual}/${wanted}`, { evidence: { item: name, expected: wanted, observed: actual } });
  }
  async function execute(action, a, signal) {
    check(signal);
    const before = counts(bot);
    switch (action) {
      case 'observe': {
        if (!a.kind || a.kind === 'inventory') return result('success', 'Observed inventory and equipment', { evidence: { ...snapshot(bot), equipment: SLOTS.map((slot) => ({ slot, item: brief(bot.inventory.slots?.[bot.getEquipmentDestSlot?.(slot)]) })) } });
        if (a.kind === 'entities') return result('success', 'Observed nearby entities', { evidence: Object.values(bot.entities).filter((e) => e.position && e.position.distanceTo(bot.entity.position) <= 32).slice(0, 32).map((e) => ({ id: e.id, name: e.name, position: e.position })) });
        if (a.kind === 'block') { const b = blockAt(a.position); return result('success', 'Observed block', { evidence: { name: b.name, position: b.position, properties: b.getProperties?.() } }); }
        const id = bot.registry.itemsByName[a.item]?.id;
        if (id === undefined) return blocked('unknown_item', `Unknown item ${a.item}`);
        requireApi('recipesAll');
        return result('success', `Recipes for ${a.item}`, { evidence: bot.recipesAll(id, null, true).slice(0, 16).map((r) => ({ result: r.result, delta: r.delta, requiresTable: r.requiresTable })) });
      }
      case 'move': case 'follow': {
        const p = action === 'move' ? a.position : entityAt(a.entityId).position;
        await near(p, a.range ?? 2, signal);
        const target = action === 'follow' ? entityAt(a.entityId).position : vec(p);
        return result(bot.entity.position.distanceTo(target) <= (a.range ?? 2) + 1 ? 'success' : 'unconfirmed', 'Navigation completed', { evidence: snapshot(bot).position });
      }
      case 'stop': clean(); return result('success', 'Stopped local controls');
      case 'look': requireApi('lookAt'); await bot.lookAt(vec(a.position), true); check(signal); return result('success', 'Orientation updated');
      case 'control': {
        requireApi('setControlState');
        const start = bot.entity.position.clone();
        try { bot.setControlState(a.control, true); await ticks(a.ticks, signal); }
        finally { bot.setControlState(a.control, false); }
        return result('success', 'Completed bounded control input', { evidence: { control: a.control, ticks: a.ticks, distance: bot.entity.position.distanceTo(start) } });
      }
      case 'mount': {
        requireApi('mount'); const e = entityAt(a.entityId); await near(e.position, 2, signal); bot.mount(entityAt(a.entityId)); await ticks(4, signal);
        return result(bot.vehicle?.id === e.id ? 'success' : 'unconfirmed', 'Mount request completed');
      }
      case 'dismount': requireApi('dismount'); bot.dismount(); await ticks(4, signal); return result(!bot.vehicle ? 'success' : 'unconfirmed', 'Dismount request completed');
      case 'vehicle': {
        requireApi('moveVehicle'); if (!bot.vehicle) return blocked('not_mounted', 'No mounted vehicle');
        try { bot.moveVehicle(a.sideways, a.forward); await ticks(a.ticks, signal); }
        finally { bot.moveVehicle(0, 0); }
        return result('success', 'Completed bounded vehicle input');
      }
      case 'dig': return skills.mine(blockAt(a.position, a.block), { signal });
      case 'craft': return skills.craft(a.item, a.count, { signal });
      case 'pickup': {
        const summary = await skills.collectDrops(a.radius ?? 12, 12000, null, { signal });
        const gained = Object.entries(counts(bot)).some(([n, c]) => c > (before[n] || 0));
        return result(gained ? 'success' : 'unconfirmed', typeof summary === 'string' ? summary : summary.summary);
      }
      case 'place': {
        requireApi('placeBlock'); requireItem(a.item); let base = blockAt(a.reference);
        const target = base.position.plus(vec(a.face));
        const empty = bot.blockAt(target);
        if (!empty || !['air', 'cave_air', 'void_air', 'water', 'lava'].includes(empty.name)) return blocked('occupied', 'Placement position is not replaceable');
        await near(base.position, 3, signal); base = blockAt(a.reference, base.name);
        await equip(a.item, 'hand', signal); check(signal); await bot.placeBlock(base, vec(a.face)); await ticks(2, signal);
        const placed = bot.blockAt(target);
        const expected = a.item.endsWith('_seeds') ? ({ wheat_seeds: 'wheat', beetroot_seeds: 'beetroots' }[a.item]) : ({ potato: 'potatoes', carrot: 'carrots' }[a.item] || a.item);
        const success = placed?.name === expected;
        if (success) world?.record?.({ kind: 'block', name: placed.name, dim: bot.game.dimension, ...target });
        return result(success ? 'success' : 'unconfirmed', `Placement ${success ? 'verified' : 'not confirmed'}`, { evidence: { expected, observed: placed?.name, position: target } });
      }
      case 'activate_block': case 'activate_entity': {
        const api = action === 'activate_block' ? 'activateBlock' : 'activateEntity'; requireApi(api);
        const target = action === 'activate_block' ? blockAt(a.position) : entityAt(a.entityId);
        await near(target.position, 3, signal); if (a.item) await equip(a.item, 'hand', signal);
        const current = action === 'activate_block' ? blockAt(a.position, target.name) : entityAt(a.entityId);
        const old = action === 'activate_block' ? JSON.stringify(current.getProperties?.()) : null;
        check(signal); await bot[api](current); await ticks(4, signal);
        const changed = action === 'activate_block' && JSON.stringify(bot.blockAt(target.position)?.getProperties?.()) !== old;
        const consumed = a.item && (counts(bot)[a.item] || 0) < (before[a.item] || 0);
        return result(changed || consumed ? 'success' : 'unconfirmed', 'Interaction sent; only observed changes are confirmed', { evidence: { blockChanged: !!changed, itemConsumed: !!consumed } });
      }
      case 'equip': await equip(a.item, a.slot, signal); return result(bot.inventory.slots?.[bot.getEquipmentDestSlot?.(a.slot)]?.name === a.item ? 'success' : 'unconfirmed', `Equipment slot ${a.slot} checked`);
      case 'unequip': requireApi('unequip'); await bot.unequip(a.slot); check(signal); return result(!bot.inventory.slots?.[bot.getEquipmentDestSlot?.(a.slot)] ? 'success' : 'unconfirmed', `Equipment slot ${a.slot} checked`);
      case 'use': {
        requireApi('activateItem'); await equip(a.item, a.offhand ? 'off-hand' : 'hand', signal);
        try { bot.activateItem(!!a.offhand); await ticks(a.ticks, signal); }
        finally { bot.deactivateItem?.(); }
        return result('unconfirmed', 'Item use completed; gameplay effect requires observation');
      }
      case 'toss': { requireApi('toss'); const i = requireItem(a.item, a.count); await bot.toss(i.type, i.metadata ?? null, a.count); check(signal); return delta(before, a.item, a.count, -1); }
      case 'inventory_move': {
        requireApi('moveSlotItem'); const i = bot.inventory.slots[a.fromSlot];
        if (!i) return blocked('empty_slot', 'Source slot is empty');
        if (a.fromSlot === a.toSlot) return result('success', 'Item already occupies destination');
        if (bot.inventory.slots[a.toSlot]) return blocked('occupied', 'Destination slot must be empty');
        await bot.moveSlotItem(a.fromSlot, a.toSlot); check(signal);
        return result(bot.inventory.slots[a.toSlot]?.type === i.type && !bot.inventory.slots[a.fromSlot] ? 'success' : 'unconfirmed', 'Inventory transfer checked');
      }
      case 'container': {
        requireApi('openContainer'); const b = blockAt(a.position); await near(b.position, 3, signal);
        if (!['chest', 'trapped_chest', 'ender_chest', 'barrel', 'dispenser', 'dropper', 'hopper'].includes(b.name)
          && !b.name.endsWith('shulker_box')) return blocked('wrong_station', 'Target is not a supported container');
        const outcome = await withWindow('openContainer', blockAt(a.position, b.name), signal, async (w) => {
          if (a.mode === 'inspect') return result('success', 'Observed container', { evidence: w.containerItems().map(brief) });
          const source = a.mode === 'withdraw' ? w.containerItems() : bot.inventory.items();
          const i = source.find((v) => v.name === a.item);
          if (!i || source.filter((v) => v.name === a.item).reduce((sum, v) => sum + v.count, 0) < a.count) return blocked('missing_item', `Source lacks ${a.count} ${a.item}`);
          check(signal); await w[a.mode](i.type, i.metadata ?? null, a.count); check(signal);
          return { verify: { name: a.item, count: a.count, direction: a.mode === 'withdraw' ? 1 : -1 } };
        });
        return outcome.verify ? delta(before, outcome.verify.name, outcome.verify.count, outcome.verify.direction) : outcome;
      }
      case 'smelt': {
        requireApi('openFurnace'); const b = blockAt(a.position);
        if (!['furnace', 'blast_furnace', 'smoker'].includes(b.name)) return blocked('wrong_station', 'Target is not a furnace');
        await near(b.position, 3, signal);
        const outcome = await withWindow('openFurnace', blockAt(a.position, b.name), signal, async (w) => {
          if (a.mode === 'inspect') return result('success', 'Observed furnace', { evidence: { input: brief(w.inputItem()), fuel: brief(w.fuelItem()), output: brief(w.outputItem()), progress: w.progress } });
          if (a.mode === 'collect') { const i = w.outputItem(); if (!i) return blocked('not_ready', 'Furnace output is not ready'); await w.takeOutput(); check(signal); return { verify: { name: i.name, count: i.count, direction: 1 } }; }
          const occupied = a.mode === 'input' ? w.inputItem() : w.fuelItem();
          if (occupied && occupied.name !== a.item) return blocked('occupied', 'Furnace slot holds a different item');
          const i = requireItem(a.item, a.count); check(signal); await w[a.mode === 'input' ? 'putInput' : 'putFuel'](i.type, i.metadata ?? null, a.count); check(signal);
          return { verify: { name: a.item, count: a.count, direction: -1 } };
        });
        return outcome.verify ? delta(before, outcome.verify.name, outcome.verify.count, outcome.verify.direction) : outcome;
      }
      case 'brew': {
        requireApi('openBlock'); const b = blockAt(a.position, 'brewing_stand'); await near(b.position, 3, signal);
        const outcome = await withWindow('openBlock', blockAt(a.position, 'brewing_stand'), signal, async (w) => {
          if (!/brewing/.test(w.type || '')) return blocked('wrong_window', 'Expected brewing stand window');
          if (a.mode === 'inspect') return result('success', 'Observed brewing stand slots', { evidence: w.slots.slice(0, 5).map(brief) });
          if (a.mode === 'take') { requireApi('putAway'); const i = w.slots[a.slot]; if (!i) return blocked('empty_slot', 'Brewing slot is empty'); await bot.putAway(a.slot); check(signal); return { verify: { name: i.name, count: i.count, direction: 1 } }; }
          if (a.slot === 4 && a.item !== 'blaze_powder') return blocked('wrong_brewing_item', 'Brewing fuel slot requires blaze_powder');
          if (a.slot <= 2 && !['glass_bottle', 'potion', 'splash_potion', 'lingering_potion'].includes(a.item))
            return blocked('wrong_brewing_item', 'Brewing bottle slot requires a bottle or potion');
          requireApi('transfer'); const i = requireItem(a.item, a.count);
          if (w.slots[a.slot] && w.slots[a.slot].name !== a.item) return blocked('occupied', 'Brewing slot holds a different item');
          await bot.transfer({ window: w, itemType: i.type, metadata: i.metadata ?? null, count: a.count, sourceStart: w.inventoryStart, sourceEnd: w.inventoryEnd, destStart: a.slot, destEnd: a.slot + 1 }); check(signal);
          return { verify: { name: a.item, count: a.count, direction: -1 } };
        });
        return outcome.verify ? delta(before, outcome.verify.name, outcome.verify.count, outcome.verify.direction) : outcome;
      }
      case 'attack': {
        requireApi('attack'); const e = entityAt(a.entityId);
        if (e.position.distanceTo(bot.entity.position) > 3.5) return blocked('out_of_reach', 'Target is outside melee reach');
        if (a.item) await equip(a.item, 'hand', signal);
        bot.attack(entityAt(a.entityId)); await ticks(6, signal);
        return result('unconfirmed', 'Attack sent; damage not confirmed', { evidence: { targetVisible: e.isValid !== false } });
      }
      case 'eat': {
        requireApi('consume'); if (!bot.registry.foodsByName?.[a.item] || ['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish'].includes(a.item)) return blocked('unsafe_food', 'Item is not a supported safe food');
        const food = bot.food; await equip(a.item, 'hand', signal); await bot.consume(); check(signal);
        return result(bot.food > food || (counts(bot)[a.item] || 0) < (before[a.item] || 0) ? 'success' : 'unconfirmed', 'Food consumption checked');
      }
      case 'sleep': {
        requireApi('sleep'); const bed = blockAt(a.position);
        if (!bed.name.endsWith('_bed')) return blocked('wrong_station', 'Target is not a bed');
        await near(bed.position, 2, signal); await bot.sleep(blockAt(a.position, bed.name)); check(signal);
        return result(bot.isSleeping ? 'success' : 'unconfirmed', 'Sleep state checked');
      }
      case 'wake': requireApi('wake'); await bot.wake(); check(signal); return result(!bot.isSleeping ? 'success' : 'unconfirmed', 'Wake state checked');
      case 'fish': requireApi('fish'); await equip('fishing_rod', 'hand', signal); await bot.fish(); check(signal); return result(Object.entries(counts(bot)).some(([n, c]) => c > (before[n] || 0)) ? 'success' : 'unconfirmed', 'Fishing completed; inventory checked');
      case 'trade': {
        requireApi('openVillager'); const e = entityAt(a.entityId); await near(e.position, 3, signal);
        const outcome = await withWindow('openVillager', entityAt(a.entityId), signal, async (w) => {
          if (a.index === undefined) return result('success', 'Observed trade offers', { evidence: (w.trades || []).slice(0, 32).map((t, index) => ({ index, input: brief(t.inputItem1), second: brief(t.inputItem2), output: brief(t.outputItem), disabled: t.tradeDisabled })) });
          requireApi('trade'); const t = w.trades?.[a.index];
          if (!t || t.tradeDisabled) return blocked('trade_unavailable', 'Trade is unavailable');
          const count = a.count ?? 1;
          if (Number.isFinite(t.maximumNbTradeUses) && Number.isFinite(t.nbTradeUses)
            && count > t.maximumNbTradeUses - t.nbTradeUses) return blocked('trade_unavailable', 'Requested trade count exceeds remaining uses');
          requireItem(t.inputItem1.name, (t.realPrice ?? t.inputItem1.count) * count);
          if (t.inputItem2?.count) requireItem(t.inputItem2.name, t.inputItem2.count * count);
          await bot.trade(w, a.index, count); check(signal);
          return t.outputItem ? { verify: { name: t.outputItem.name, count: t.outputItem.count * count, direction: 1 } } : result('unconfirmed', 'Trade output unknown');
        });
        return outcome.verify ? delta(before, outcome.verify.name, outcome.verify.count, outcome.verify.direction) : outcome;
      }
      case 'enchant': {
        requireApi('openEnchantmentTable'); const b = blockAt(a.position, 'enchanting_table');
        const original = requireItem(a.item), originalState = itemState(original);
        requireItem('lapis_lazuli', a.choice + 1);
        await near(b.position, 3, signal);
        const output = await withWindow('openEnchantmentTable', blockAt(a.position, 'enchanting_table'), signal, async (w) => {
          const current = requireItem(a.item);
          if (itemState(current) !== originalState) { const error = new Error('Enchantment item changed before use'); error.code = 'STALE_TARGET'; throw error; }
          await w.putTargetItem(current); check(signal); await w.putLapis(requireItem('lapis_lazuli', a.choice + 1)); check(signal);
          const enchanted = await w.enchant(a.choice); check(signal); await w.takeTargetItem(); check(signal);
          return enchanted;
        });
        const outputState = itemState(output);
        const carried = bot.inventory.items().some((i) => i.type === original.type && itemState(i) === outputState);
        const changed = output && outputState !== originalState && carried;
        return result(changed ? 'success' : 'unconfirmed', changed ? 'Enchanted item observed in inventory' : 'Enchantment outcome not confirmed',
          { evidence: { output: brief(output), itemChanged: outputState !== originalState, carried } });
      }
      case 'anvil': {
        requireApi('openAnvil'); const b = blockAt(a.position);
        if (!b.name.endsWith('anvil')) return blocked('wrong_station', 'Target is not an anvil');
        const first = requireItem(a.item), second = a.secondItem ? bot.inventory.items().find((i) => i.name === a.secondItem && i !== first) : null;
        if (a.secondItem && !second) return blocked('missing_item', 'Need a separate second anvil item');
        const priorStates = new Set(bot.inventory.items().filter((i) => i.type === first.type).map(itemState));
        await near(b.position, 3, signal);
        await withWindow('openAnvil', blockAt(a.position, b.name), signal, async (w) => {
          const currentFirst = requireItem(a.item);
          const currentSecond = second && bot.inventory.items().find((i) => i.name === a.secondItem && i !== currentFirst);
          if (itemState(currentFirst) !== itemState(first) || (second && (!currentSecond || itemState(currentSecond) !== itemState(second)))) {
            const error = new Error('Anvil items changed before use'); error.code = 'STALE_TARGET'; throw error;
          }
          if (currentSecond) await w.combine(currentFirst, currentSecond, a.name); else await w.rename(currentFirst, a.name);
          check(signal);
        });
        const changed = bot.inventory.items().some((i) => i.type === first.type && !priorStates.has(itemState(i)));
        return result(changed ? 'success' : 'unconfirmed', changed ? 'Changed anvil output observed in inventory' : 'Anvil output not confirmed',
          { evidence: { outputItemChanged: changed } });
      }
      case 'portal': {
        const b = blockAt(a.position);
        if (!['nether_portal', 'end_portal', 'end_gateway'].includes(b.name)) return blocked('wrong_target', 'Target is not an existing portal');
        const dimension = bot.game.dimension; await near(b.position, 0, signal);
        for (let i = 0; i < 20 && bot.game.dimension === dimension; i++) await ticks(5, signal);
        return result(bot.game.dimension !== dimension ? 'success' : 'unconfirmed', 'Portal dimension change checked', { evidence: { before: dimension, after: bot.game.dimension } });
      }
      default: return blocked('unsupported', 'Action is not implemented');
    }
  }

  async function run(operation, candidateDimension, { signal } = {}) {
    if (signal?.aborted) return result('cancelled', 'Action cancelled before execution');
    if (candidateDimension !== bot.game.dimension) return blocked('stale_dimension', 'World dimension changed after selecting action');
    if ((inFlight || skills?.pending) && !['observe', 'stop'].includes(operation.action)) return blocked('operation_in_flight', 'Previous game operation has not settled; observe or stop before retrying');
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer, abortListener;
    const before = snapshot(bot);
    const work = Promise.resolve().then(() => execute(operation.action, operation.args, combined));
    const mutating = !['observe', 'stop'].includes(operation.action);
    if (mutating) inFlight = work;
    work.then(() => { if (inFlight === work) inFlight = null; }, () => { if (inFlight === work) inFlight = null; });
    const aborted = new Promise((_, reject) => {
      abortListener = () => { clean(); reject(combined.reason || new Error('Action cancelled')); };
      combined.addEventListener('abort', abortListener, { once: true });
      if (combined.aborted) abortListener();
    });
    timer = setTimeout(() => { const error = new Error('Game operation timed out; final state is unknown'); error.code = 'OP_TIMEOUT'; controller.abort(error); }, maxMs);
    try {
      const value = await Promise.race([work, aborted]);
      const normalized = value && typeof value === 'object' && value.status ? value : result('unconfirmed', String(value ?? 'Operation returned no verification'));
      return { ...normalized, evidence: { before, after: snapshot(bot), detail: normalized.evidence } };
    } catch (error) {
      if (error.code === 'OP_TIMEOUT') return result('unconfirmed', error.message, { reason: 'timeout', retryable: false });
      if (combined.aborted) return result('cancelled', 'Action cancelled; pending game operations remain guarded', { reason: 'cancelled' });
      if (['UNSUPPORTED', 'MISSING_ITEM', 'STALE_TARGET'].includes(error.code)) return blocked(error.code === 'UNSUPPORTED' ? 'unsupported' : error.code.toLowerCase(), error.message);
      return result('failed', error.message, { reason: error.code || 'game_error' });
    } finally { clearTimeout(timer); combined.removeEventListener('abort', abortListener); }
  }
  function candidates(ctx = {}) {
    const operations = Array.isArray(ctx.plan?.operations) ? ctx.plan.operations.slice(0, 24) : [];
    return operations.map((input) => {
      try {
        const operation = validateOperation(input), spec = ACTION_CATALOG[operation.action];
        const dimension = bot.game.dimension;
        return { skill: spec.skill, key: 'op_' + operation.action + '_' + JSON.stringify(operation.args), description: spec.description + ': ' + JSON.stringify(operation.args), operation,
          fn: (options) => run(operation, dimension, options) };
      } catch (error) { return { skill: 'gather_blocked', key: 'op_invalid_' + String(input?.action).slice(0, 80), description: error.message, fn: async () => blocked('invalid_operation', error.message) }; }
    });
  }
  return { candidates, describe: () => Object.entries(ACTION_CATALOG).map(([action, spec]) => ({ action, ...spec })), get pending() { return !!inFlight || !!skills?.pending; } };
}
