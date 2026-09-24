// General survival skills. Each skill offers concrete, bounded candidate actions; JEV chooses one per step.
import pf from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { planRecipeStep, recipeInputs } from './recipe-planner.mjs';

const { goals } = pf;
const HOSTILE = new Set(['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'creeper', 'spider', 'cave_spider', 'witch', 'enderman', 'slime', 'phantom', 'pillager', 'vindicator', 'zombie_villager', 'blaze', 'ghast', 'magma_cube', 'wither_skeleton', 'piglin_brute', 'hoglin', 'zoglin', 'silverfish', 'endermite', 'guardian']);
// Items whose usual source is a block that drops something else first.
const SMELTED_FROM = { iron_ingot: 'iron_ore', gold_ingot: 'gold_ore', charcoal: 'oak_log', glass: 'sand', stone: 'cobblestone', smooth_stone: 'stone', brick: 'clay_ball', cooked_beef: 'beef', cooked_porkchop: 'porkchop', cooked_chicken: 'chicken', cooked_mutton: 'mutton' };
const FUELS = ['coal', 'charcoal', 'oak_planks', 'birch_planks', 'spruce_planks', 'oak_log', 'birch_log', 'spruce_log', 'stick'];

const fmt = (p) => `${Math.floor(p.x)} ${Math.floor(p.y)} ${Math.floor(p.z)}`;

export function inventoryCounts(bot) {
  const out = {};
  for (const i of bot.inventory.items()) out[i.name] = (out[i.name] || 0) + i.count;
  return out;
}

// minecraft-data 1.16.5 lists each block as dropping itself, so the common exceptions are spelled out here.
const DROPPED_BY = {
  cobblestone: ['stone', 'cobblestone'], coal: ['coal_ore'], diamond: ['diamond_ore'], emerald: ['emerald_ore'], redstone: ['redstone_ore'],
  lapis_lazuli: ['lapis_ore'], quartz: ['nether_quartz_ore'], gold_nugget: ['nether_gold_ore'], flint: ['gravel'], clay_ball: ['clay'],
  wheat_seeds: ['grass', 'tall_grass'], glowstone_dust: ['glowstone'], snowball: ['snow_block', 'snow'], dirt: ['dirt', 'grass_block'],
  cobbled_deepslate: [], sweet_berries: ['sweet_berry_bush'], apple: ['oak_leaves', 'dark_oak_leaves'], stick: ['dead_bush'],
  potato: ['potatoes'], carrot: ['carrots'], beetroot: ['beetroots'], wheat: ['wheat'], nether_wart: ['nether_wart'],
};
const CROPS = new Set(['potatoes', 'carrots', 'beetroots', 'wheat', 'nether_wart', 'sweet_berry_bush']);
const UNSAFE_FOODS = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish']);

function abortError() { const error = new Error('Action cancelled'); error.name = 'AbortError'; return error; }
function checkSignal(signal) { if (signal?.aborted) throw abortError(); }

function canHarvest(bot, block) {
  if (!block.harvestTools || !Object.keys(block.harvestTools).length) return true;
  const tool = bot.pathfinder.bestHarvestTool(block);
  return !!(tool && block.harvestTools[tool.type]);
}

function mature(bot, block) {
  if (!CROPS.has(block.name)) return true;
  const age = block.getProperties?.().age;
  const maxAge = bot.registry.blocksByName[block.name]?.states?.find((s) => s.name === 'age')?.num_values;
  return Number.isFinite(age) && Number.isFinite(maxAge) && age >= maxAge - 1;
}

// Blocks that yield the item when mined.
export function blockSources(registry, itemName) {
  if (!registry.itemsByName[itemName]) return [];
  const names = DROPPED_BY[itemName] || (registry.blocksByName[itemName] ? [itemName] : []);
  return names.filter((n) => registry.blocksByName[n]);
}

export function createSkills(bot, { world, owners = [], timeouts = {}, now = Date.now } = {}) {
  const T = { move: 30000, dig: 20000, ...timeouts };
  const dim = () => bot.game.dimension;
  const item = (name) => bot.inventory.items().find((i) => i.name === name);
  const furnaceLastEmpty = new Map();
  const pendingSmelts = new Set();
  const chestCheckedAt = new Map();
  // Timeout/cancellation ends our wait, not necessarily the native operation.
  const pendingWork = new Set();

  async function bounded(operation, ms, label, signal) {
    checkSignal(signal);
    let timer, onAbort;
    const cleanupMovement = () => { bot.pathfinder.setGoal(null); bot.clearControlStates(); bot.stopDigging?.(); };
    const work = Promise.resolve().then(() => { checkSignal(signal); return typeof operation === 'function' ? operation() : operation; });
    pendingWork.add(work);
    work.then(() => pendingWork.delete(work), () => pendingWork.delete(work));
    try {
      const result = await Promise.race([
        work,
        new Promise((_, reject) => { timer = setTimeout(() => { cleanupMovement(); const error = new Error(label + ' timed out'); error.code = 'SKILL_TIMEOUT'; reject(error); }, ms); }),
        ...(signal ? [new Promise((_, reject) => { onAbort = () => { cleanupMovement(); reject(abortError()); }; signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort(); })] : []),
      ]);
      checkSignal(signal);
      return result;
    } finally { clearTimeout(timer); if (onAbort) signal.removeEventListener('abort', onAbort); }
  }
  async function openBounded(operation, label, signal) {
    let abandoned = false, opened = null;
    const pending = Promise.resolve().then(() => { checkSignal(signal); return operation(); });
    pending.then((window) => { opened = window; if (abandoned) window?.close?.(); }).catch(() => {});
    try { return await bounded(pending, T.move, label, signal); }
    catch (error) { abandoned = true; opened?.close?.(); throw error; }
  }
  const goNear = async (pos, range = 2, signal) => {
    checkSignal(signal);
    if (bot.entity.position.distanceTo(new Vec3(pos.x + 0.5, pos.y, pos.z + 0.5)) <= range + 0.5) return;
    try { await bounded(() => bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, range)), T.move, 'Move', signal); } finally { bot.pathfinder.setGoal(null); }
  };

  async function mine(block, { signal } = {}) {
    await goNear(block.position, 3, signal);
    checkSignal(signal);
    const current = bot.blockAt(block.position);
    if (!current || current.name !== block.name) throw new Error(`${block.name} at ${fmt(block.position)} is no longer there`);
    if (!mature(bot, current)) throw new Error(`${current.name} is not mature yet`);
    const tool = bot.pathfinder.bestHarvestTool(current);
    if (current.harvestTools && Object.keys(current.harvestTools).length && !(tool && current.harvestTools[tool.type])) return {
      status: 'blocked', summary: `Cannot harvest ${current.name}`, reason: 'missing_harvest_tool',
      missing: Object.keys(current.harvestTools).map((id) => bot.registry.items?.[Number(id)]?.name).filter(Boolean),
    };
    if (tool) await bounded(() => bot.equip(tool, 'hand'), T.move, 'Equip mining tool', signal);
    checkSignal(signal);
    const before = inventoryCounts(bot);
    await bounded(() => bot.dig(current, true), T.dig, 'Dig', signal);
    await bounded(() => bot.waitForTicks(8), 3000, 'Drop spawn', signal);
    let pickupFailure = null;
    try { await collectDrops(8, 8000, current.position, { signal }); }
    catch (error) { if (signal?.aborted) throw error; pickupFailure = error.message; }
    const gainedEntries = Object.entries(inventoryCounts(bot)).filter(([n, c]) => c > (before[n] || 0));
    const gained = gainedEntries.map(([n, c]) => `${c - (before[n] || 0)} ${n}`);
    const expected = new Set([current.name, ...Object.entries(DROPPED_BY)
      .filter(([, sources]) => sources.includes(current.name)).map(([itemName]) => itemName)]);
    const relevantGain = gainedEntries.some(([itemName]) => expected.has(itemName));
    const afterBlock = bot.blockAt(current.position);
    const removed = !!afterBlock && afterBlock.name !== current.name;
    return {
      status: relevantGain && removed ? 'success' : removed ? 'partial' : 'unconfirmed',
      summary: `Mined ${current.name}` + (gained.length ? `, picked up ${gained.join(', ')}` : ', drop not picked up yet'),
      reason: relevantGain ? undefined : pickupFailure || (removed ? 'expected_drop_not_collected' : 'block_not_confirmed_removed'),
      evidence: { blockRemoved: removed, gained, expectedDropGained: relevantGain },
    };
  }

  const isDrop = (e) => e?.name === 'item' || e?.displayName === 'Item';
  async function collectDrops(radius = 12, ms = 12000, around = null, { signal } = {}) {
    checkSignal(signal);
    const from = around || bot.entity.position;
    const drops = Object.values(bot.entities).filter((e) => isDrop(e) && e.position.distanceTo(from) <= radius).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 4);
    if (!drops.length) return 'Dropped items are no longer nearby';
    const before = inventoryCounts(bot);
    let approached = 0, vanished = 0;
    try {
      for (const d of drops) {
        checkSignal(signal);
        if (d.isValid === false) { vanished++; continue; }
        try { await bounded(() => bot.pathfinder.goto(new goals.GoalNear(Math.floor(d.position.x), Math.floor(d.position.y), Math.floor(d.position.z), 0)), Math.max(1, ms / drops.length), 'Pickup', signal); }
        catch (error) { throw new Error(`Pickup path failed: ${error.message}`, { cause: error }); }
        approached++;
        await bounded(() => bot.waitForTicks(4), 2000, 'Pickup wait', signal);
      }
    } finally { bot.pathfinder.setGoal(null); }
    const gained = Object.entries(inventoryCounts(bot)).filter(([n, c]) => c > (before[n] || 0)).map(([n, c]) => `${c - (before[n] || 0)} ${n}`);
    if (gained.length) return `Picked up ${gained.join(', ')}`;
    if (!approached) return `Dropped items disappeared before pickup (${vanished})`;
    return `Approached ${approached} dropped item stack(s); pickup unconfirmed`;
  }

  const nearbyTable = () => bot.findBlock({ matching: bot.registry.blocksByName.crafting_table.id, maxDistance: 24 });

  async function craft(name, count = 1, { signal, recipe: requestedRecipe, targets = {} } = {}) {
    checkSignal(signal);
    if (!bot.registry.itemsByName[name] || !Number.isSafeInteger(count) || count < 1) return {
      status: 'blocked', summary: `Cannot craft ${name}`, reason: 'invalid_craft_request', missing: [name],
    };
    const table = nearbyTable();
    const id = bot.registry.itemsByName[name].id;
    const recipes = requestedRecipe ? [requestedRecipe] : bot.recipesFor(id, null, 1, table);
    let choice = null;
    for (const recipe of recipes) {
      if (recipe.requiresTable && !table) continue;
      const inputs = recipeInputs(recipe, bot.registry);
      if (!inputs.size) continue;
      const inv = inventoryCounts(bot);
      const affordable = Math.min(...[...inputs].map(([ingredient, quantity]) =>
        Math.floor(Math.max(0, (inv[ingredient] || 0) - (targets[ingredient] || 0)) / quantity)));
      if (affordable < 1) continue;
      const desired = Math.ceil(count / recipe.result.count);
      const times = Math.min(desired, affordable);
      if (!choice || times * recipe.result.count > choice.times * choice.recipe.result.count) choice = { recipe, times };
    }
    if (!choice) {
      const next = planRecipeStep({ registry: bot.registry, name, count, inventory: inventoryCounts(bot), targets,
        hasTable: Boolean(table) });
      return {
        status: 'blocked', summary: `Cannot craft ${name} from carried items`,
        reason: next.kind === 'place' ? 'crafting_table_not_placed' : 'missing_recipe_or_materials',
        missing: next.missing || (next.name ? [{ name: next.name, count: next.count || 1 }] : []),
      };
    }
    const { recipe, times } = choice;
    if (recipe.requiresTable) await goNear(table.position, 3, signal);
    const before = inventoryCounts(bot)[name] || 0;
    await bounded(() => bot.craft(recipe, times, recipe.requiresTable ? table : null), T.move, 'Craft', signal);
    const gained = (inventoryCounts(bot)[name] || 0) - before;
    return {
      status: gained >= count ? 'success' : gained > 0 ? 'partial' : 'unconfirmed',
      summary: gained > 0 ? `Crafted ${name} x${gained}` : `Craft ${name} produced no confirmed inventory gain`,
      reason: gained >= count ? undefined : gained > 0 ? 'less_than_requested' : 'inventory_gain_unconfirmed',
      missing: gained >= count ? undefined : [{ name, count: Math.max(0, count - gained) }],
      evidence: { requested: count, batches: times, expected: times * recipe.result.count, gained },
    };
  }

  async function placeNear(name, { signal } = {}) {
    checkSignal(signal);
    const it = item(name);
    if (!it) throw new Error('No ' + name + ' in inventory');
    const base = bot.entity.position.floored();
    const failures = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      checkSignal(signal);
      const target = base.offset(dx, 0, dz), below = bot.blockAt(target.offset(0, -1, 0)), at = bot.blockAt(target);
      if (below && below.boundingBox === 'block' && at && at.name === 'air') {
        if (!item(name)) throw new Error(`No ${name} remains in inventory`);
        try {
          await bounded(() => bot.equip(item(name), 'hand'), T.move, 'Equip for placement', signal);
          checkSignal(signal);
          if (bot.blockAt(target)?.name !== 'air') { failures.push(`${fmt(target)} changed`); continue; }
          await bounded(() => bot.placeBlock(below, new Vec3(0, 1, 0)), T.move, 'Place block', signal);
          await bounded(() => bot.waitForTicks(2), 2000, 'Placement confirmation', signal);
          const observed = bot.blockAt(target)?.name;
          if (observed !== name) return { status: 'unconfirmed', summary: `Placement of ${name} at ${fmt(target)} not confirmed`,
            reason: 'block_change_unconfirmed', evidence: { expected: name, observed, position: target } };
          world?.record({ kind: 'block', name, dim: dim(), ...target });
          return { status: 'success', summary: `Placed ${name} at ${fmt(target)}`, evidence: { expected: name, observed, position: target } };
        } catch (error) {
          if (signal?.aborted || error.code === 'SKILL_TIMEOUT') throw error;
          failures.push(`${fmt(target)}: ${error.message}`);
        }
      }
    }
    throw new Error(failures.length ? `Could not place ${name}: ${failures.join('; ')}` : `No free spot to place ${name}`);
  }

  function ownerEntity() {
    for (const name of owners) { const p = bot.players[name]; if (p?.entity) return { name, entity: p.entity }; }
    return null;
  }

  // Candidate generation. `ctx` carries the current plan and pending owner request.
  function candidates(ctx = {}) {
    const out = [];
    const add = (skill, key, description, fn) => { if (!out.some((o) => o.key === key)) out.push({ skill, key, description, fn }); };
    const p = bot.entity.position, inv = inventoryCounts(bot), plan = ctx.plan || {};
    const reserves = { ...(plan.reserveTargets || {}) };
    for (const [name, count] of Object.entries(plan.targets || {})) reserves[name] = Math.max(reserves[name] || 0, count);
    const hostiles = Object.values(bot.entities).filter((e) => HOSTILE.has(e.name) && e.position.distanceTo(p) < 16).sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));

    // Survival
    const foods = bot.inventory.items().filter((i) => bot.registry.foodsByName?.[i.name] && !UNSAFE_FOODS.has(i.name));
    if (foods.length && (bot.food < 18 || (bot.health < 14 && bot.food < 20))) add('eat', 'eat', `Eat ${foods[0].name} (food ${bot.food}/20, health ${Math.round(bot.health)}/20)`, async ({ signal } = {}) => { await bounded(() => bot.equip(foods[0], 'hand'), T.move, 'Equip food', signal); await bounded(() => bot.consume(), T.move, 'Eat', signal); return 'Ate ' + foods[0].name; });
    if (hostiles.length) {
      const h = hostiles[0], d = h.position.distanceTo(p).toFixed(1);
      const weapon = bot.inventory.items().find((i) => /_sword$|_axe$/.test(i.name));
      if (h.position.distanceTo(p) < 6) add('combat_attack', 'attack_' + h.id, `Attack the ${h.name} ${d} blocks away${weapon ? ' with ' + weapon.name : ' bare-handed'}`, async ({ signal } = {}) => {
        if (weapon) await bounded(() => bot.equip(weapon, 'hand'), T.move, 'Equip weapon', signal);
        for (let i = 0; i < 6 && h.isValid && h.position.distanceTo(bot.entity.position) < 6; i++) { checkSignal(signal); await bounded(() => bot.lookAt(h.position.offset(0, h.height * 0.8, 0), true), 3000, 'Look at hostile', signal); bot.attack(h); await bounded(() => bot.waitForTicks(12), 3000, 'Combat wait', signal); }
        return h.isValid ? `Hit the ${h.name}` : `Defeated the ${h.name}`;
      });
      add('combat_flee', 'flee_' + h.id, `Run 16 blocks away from the ${h.name} ${d} blocks away`, async ({ signal } = {}) => {
        const away = p.minus(h.position).normalize().scaled(16).plus(p);
        try { await bounded(() => bot.pathfinder.goto(new goals.GoalXZ(Math.floor(away.x), Math.floor(away.z))), 12000, 'Flee', signal); } finally { bot.pathfinder.setGoal(null); }
        return 'Moved away from the ' + h.name;
      });
    }
    const night = bot.time.timeOfDay > 12541 && bot.time.timeOfDay < 23458;
    if (night && dim() === 'overworld') {
      const bed = bot.findBlock({ matching: (b) => b.name.endsWith('_bed'), maxDistance: 32 });
      if (bed) add('sleep', 'sleep', `Sleep in the ${bed.name} at ${fmt(bed.position)} to skip the night`, async ({ signal } = {}) => {
        await goNear(bed.position, 2, signal);
        await bounded(() => bot.sleep(bed), T.move, 'Sleep', signal);
        let onWake;
        try { await bounded(() => new Promise((resolve) => { onWake = resolve; bot.once('wake', onWake); }), 120000, 'Wake', signal); }
        finally { if (onWake) { bot.removeListener('wake', onWake); onWake(); } if (signal?.aborted) bot.wake?.().catch?.(() => {}); }
        return 'Slept through the night';
      });
    }

    // Owner
    const owner = ownerEntity();
    if (owner) {
      const d = owner.entity.position.distanceTo(p);
      if (d > 4) add('owner_follow', 'come_to_owner', `Walk to owner ${owner.name} (${d.toFixed(0)} blocks away)`, async ({ signal } = {}) => { try { await bounded(() => bot.pathfinder.goto(new goals.GoalFollow(owner.entity, 2)), T.move, 'Follow', signal); } finally { bot.pathfinder.setGoal(null); } return 'Reached ' + owner.name; });
      if (ctx.request?.deliveryRequired && !ctx.request.deliveryPending && d < 32) {
        const give = (plan.deliveryTargets?.length ? plan.deliveryTargets : Object.keys(plan.targets || {}))
          .filter((n) => !ctx.request.deliveryDropped?.includes(n)
            && (plan.deliveryAmounts?.[n] ?? plan.targets[n] ?? 0) > 0
            && inv[n] >= (plan.targets[n] || 1));
        for (const n of give.slice(0, 2)) {
          const amount = Math.min(inv[n], plan.deliveryAmounts?.[n] ?? plan.additionalTargets?.[n] ?? plan.targets[n] ?? inv[n]);
          add('owner_give', 'give_' + n, `Drop ${amount} ${n} near owner ${owner.name}; wait for receipt confirmation`, async ({ signal } = {}) => {
          try { await bounded(() => bot.pathfinder.goto(new goals.GoalFollow(owner.entity, 2)), T.move, 'Follow', signal); } finally { bot.pathfinder.setGoal(null); }
          await bounded(() => bot.lookAt(owner.entity.position.offset(0, 1.5, 0)), 3000, 'Face owner', signal);
          checkSignal(signal);
          const held = item(n);
          if (!held) throw new Error(`${n} is no longer in inventory`);
          await bounded(() => bot.toss(held.type, null, amount), T.move, 'Drop for owner', signal);
          return `Dropped ${amount} ${n} near ${owner.name}; awaiting owner receipt confirmation`;
        });
        }
      }
    }

    // Gathering toward plan targets
    const wanted = Object.entries(plan.targets || {}).filter(([n, c]) => (inv[n] || 0) < c).map(([n]) => n);
    const wantedSet = new Set(wanted);
    const offerDependency = (name, count, purpose) => {
      const step = planRecipeStep({ registry: bot.registry, name, count, inventory: inv,
        targets: reserves, hasTable: Boolean(nearbyTable()) });
      if (step.kind === 'craft') add('craft', 'craft_' + step.name,
        `Craft ${step.name} x${step.count * step.recipe.result.count} toward ${purpose}`,
        ({ signal } = {}) => craft(step.name, step.count * step.recipe.result.count,
          { signal, recipe: step.recipe, targets: reserves }));
      else if (step.kind === 'place') add('build_place', 'place_table',
        `Place crafting table to prepare ${purpose}`, (args) => placeNear('crafting_table', args));
      else if (step.kind === 'missing') for (const missing of step.missing) {
        if (!wantedSet.has(missing.name) && wanted.length < 32) { wantedSet.add(missing.name); wanted.push(missing.name); }
      }
      return step;
    };
    for (const name of wanted) {
      if (!bot.registry.itemsByName[name]) continue;
      const sources = blockSources(bot.registry, SMELTED_FROM[name] || name);
      const ids = sources.map((s) => bot.registry.blocksByName[s]?.id).filter((x) => x !== undefined);
      const loaded = ids.length ? bot.findBlocks({ matching: ids, maxDistance: 48, count: 8 }).map((q) => bot.blockAt(q)).filter(Boolean).sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p)) : [];
      const matureBlocks = loaded.filter((b) => mature(bot, b));
      const harvestable = matureBlocks.filter((b) => canHarvest(bot, b));
      // Several candidates, so one unreachable block (cooled down after failing) does not hide the rest.
      for (const b of harvestable.filter((b) => !ctx.isCooling?.('mine_' + b.position)).slice(0, 3)) add('gather_mine', 'mine_' + b.position, `Mine ${b.name} at ${fmt(b.position)} (${b.position.distanceTo(p).toFixed(0)} blocks, ${Math.round(b.position.y - p.y)} above feet) toward ${name}`, (args) => mine(b, args));
      if (matureBlocks.length && !harvestable.length) {
        const requiredIds = Object.keys(matureBlocks[0].harvestTools || {});
        const tools = requiredIds.map((id) => bot.registry.items?.[Number(id)]?.name).filter(Boolean);
        const tool = tools.find((toolName) => bot.registry.itemsByName[toolName] &&
          planRecipeStep({ registry: bot.registry, name: toolName, inventory: inv, targets: reserves,
            hasTable: Boolean(nearbyTable()) }).kind !== 'missing');
        if (tool) offerDependency(tool, 1, `harvesting ${matureBlocks[0].name} for ${name}`);
        else if (tools[0]) offerDependency(tools[0], 1, `harvesting ${matureBlocks[0].name} for ${name}`);
        add('gather_blocked', 'blocked_' + name,
          `Cannot harvest ${matureBlocks[0].name} for ${name}: need ${tools.join(' or ') || 'a suitable tool'}`,
          async () => ({ status: 'blocked', summary: `Cannot harvest ${matureBlocks[0].name} for ${name}`,
            reason: 'missing_harvest_tool', missing: tools }));
      }
      if (!loaded.length && world) {
        for (const src of sources.slice(0, 3)) {
          const known = world.nearest({ dim: dim(), x: p.x, y: p.y, z: p.z, name: src, limit: 1, radius: 256 })[0];
          if (known) { add('travel_known', 'goto_' + src, `Travel to remembered ${src} at ${known.x} ${known.y} ${known.z} (${known.distance.toFixed(0)} blocks) toward ${name}`, async ({ signal } = {}) => { await goNear(known, 3, signal); return 'Arrived near ' + src; }); break; }
        }
      }
      if (plan.targets?.[name] > (inv[name] || 0)) offerDependency(name, plan.targets[name] - (inv[name] || 0), name);
      if (SMELTED_FROM[name]) {
        const furnace = bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 24 });
        if (furnace) {
          const key = String(furnace.position) + ':' + name;
          const fuel = FUELS.find((f) => inv[f]);
          if (inv[SMELTED_FROM[name]]) add('smelt', 'smelt_' + name, `Load ${SMELTED_FROM[name]} into furnace at ${fmt(furnace.position)}; leave existing input and fuel intact`, async ({ signal } = {}) => {
            await goNear(furnace.position, 3, signal);
            const f = await openBounded(() => bot.openFurnace(furnace), 'Open furnace', signal);
            try {
              checkSignal(signal);
              if (f.outputItem()?.name === name) { await bounded(() => f.takeOutput(), T.move, 'Take furnace output', signal); return `Collected ${name} from furnace`; }
              if (!f.inputItem() && item(SMELTED_FROM[name])) await bounded(() => f.putInput(item(SMELTED_FROM[name]).type, null, Math.min(item(SMELTED_FROM[name]).count, plan.targets[name] - (inv[name] || 0))), T.move, 'Load furnace input', signal);
              if (!f.fuelItem() && fuel && item(fuel)) await bounded(() => f.putFuel(item(fuel).type, null, Math.min(item(fuel).count, 8)), T.move, 'Load furnace fuel', signal);
              pendingSmelts.add(key);
              return f.inputItem() ? `Furnace has ${SMELTED_FROM[name]} input; awaiting ${name}` : `Furnace checked for ${name}`;
            } finally { f.close(); }
          });
          if (!inv[SMELTED_FROM[name]] || pendingSmelts.has(key)) {
            if (now() - (furnaceLastEmpty.get(key) ?? -Infinity) >= 5000) add('smelt_collect', 'smelt_collect_' + name, `Check furnace output and collect ${name} at ${fmt(furnace.position)}`, async ({ signal } = {}) => {
              await goNear(furnace.position, 3, signal);
              const f = await openBounded(() => bot.openFurnace(furnace), 'Open furnace', signal);
              try {
                checkSignal(signal);
                const output = f.outputItem();
                if (output?.name === name) {
                  await bounded(() => f.takeOutput(), T.move, 'Take furnace output', signal);
                  furnaceLastEmpty.delete(key);
                  return `Collected ${output.count} ${name} from furnace`;
                }
                  furnaceLastEmpty.set(key, now());
                return output ? `Furnace holds ${output.name}; ${name} not ready` : `${name} is not ready in the furnace`;
              } finally { f.close(); }
            });
          }
        }
      }
    }

    // Workstations
    if (!nearbyTable() && inv.crafting_table > (reserves.crafting_table || 0))
      add('build_place', 'place_table', 'Place the carried crafting table next to the player', (args) => placeNear('crafting_table', args));
    if (inv.furnace && !bot.findBlock({ matching: bot.registry.blocksByName.furnace.id, maxDistance: 24 })) add('build_place', 'place_furnace', 'Place the carried furnace next to the player', (args) => placeNear('furnace', args));

    // Drops, chests, travel, exploration
    const drops = Object.values(bot.entities).filter((e) => isDrop(e) && e.position.distanceTo(p) <= 12);
    if (drops.length) add('gather_pickup', 'pickup', `Try to pick up ${drops.length} dropped item stack(s) within 12 blocks`, (args) => collectDrops(12, 12000, null, args));
    const chestIds = ['chest', 'barrel', 'trapped_chest'].map((n) => bot.registry.blocksByName[n].id);
    const visibleChests = bot.findBlocks({ matching: chestIds, maxDistance: 24, count: 16 })
      .map((position) => bot.blockAt(position)).filter((b) => b && chestIds.includes(b.type))
      .sort((a, b) => a.position.distanceTo(p) - b.position.distanceTo(p));
    if (!visibleChests.length) {
      const fallback = bot.findBlock({ matching: chestIds, maxDistance: 24 });
      if (fallback) visibleChests.push(fallback);
    }
    const foodNeed = bot.food < 18 && !foods.length;
    const targetSignature = JSON.stringify({ targets: Object.entries(plan.targets || {}).sort(([a], [b]) => a.localeCompare(b)), foodNeed });
    const chest = visibleChests.find((b) => {
      const checkKey = `${b.position}|${targetSignature}`;
      return (!ctx.checkedChests?.has(checkKey) || now() - (chestCheckedAt.get(checkKey) ?? -Infinity) >= 60000)
        && !ctx.isCooling?.(`chest_${b.position}|${targetSignature}`);
    });
    const chestCheckKey = chest && `${chest.position}|${targetSignature}`;
    const chestActionKey = chest && `chest_${chest.position}|${targetSignature}`;
    if (chest) add('storage_inspect', chestActionKey, `Open the ${chest.name} at ${fmt(chest.position)} and take needed targets or safe food`, async ({ signal } = {}) => {
      await goNear(chest.position, 3, signal);
      const c = await openBounded(() => bot.openContainer(chest), 'Open chest', signal);
      try {
        checkSignal(signal);
        const before = c.containerItems().map((i) => `${i.count} ${i.name}`);
        const withdrawals = [];
        for (const i of c.containerItems()) {
          checkSignal(signal);
          const targetNeed = Math.max(0, (plan.targets?.[i.name] || 0) - (inventoryCounts(bot)[i.name] || 0));
          const safeFoodNeed = foodNeed && bot.registry.foodsByName?.[i.name] && !UNSAFE_FOODS.has(i.name) ? 4 : 0;
          const count = Math.min(i.count, Math.max(targetNeed, safeFoodNeed));
          if (count > 0) { await bounded(() => c.withdraw(i.type, null, count), T.move, 'Withdraw from chest', signal); withdrawals.push(`${count} ${i.name}`); }
        }
        const after = c.containerItems().map((i) => `${i.count} ${i.name}`);
        world?.record({ kind: 'block', name: chest.name, dim: dim(), ...chest.position, data: { contents: after } });
        world?.note({ kind: 'chest', text: `${chest.name} at ${fmt(chest.position)} now holds: ${after.join(', ') || 'nothing'}`, dim: dim(), ...chest.position });
        ctx.checkedChests?.add(chestCheckKey);
        chestCheckedAt.set(chestCheckKey, now());
        return `Chest had ${before.join(', ') || 'nothing'}; withdrew ${withdrawals.join(', ') || 'nothing'}`;
      } finally { c.close(); }
    });
    if (plan.waypoint) {
      const w = new Vec3(plan.waypoint.x, plan.waypoint.y, plan.waypoint.z), d = w.distanceTo(p);
      if (d > 3) add('travel_waypoint', 'waypoint', `Travel toward the planner waypoint ${fmt(w)} (${d.toFixed(0)} blocks, at most 48 per step)`, async ({ signal } = {}) => {
        const step = d > 48 ? p.plus(w.minus(p).normalize().scaled(48)) : w;
        try { await bounded(() => bot.pathfinder.goto(d > 48 ? new goals.GoalXZ(Math.floor(step.x), Math.floor(step.z)) : new goals.GoalNear(w.x, w.y, w.z, 2)), T.move, 'Travel', signal); } finally { bot.pathfinder.setGoal(null); }
        return 'Moved toward waypoint';
      });
    }
    for (const [label, dx, dz] of [['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0]]) add('explore', 'explore_' + label, `Explore 32 blocks ${label} to discover new resources`, async ({ signal } = {}) => {
      try { await bounded(() => bot.pathfinder.goto(new goals.GoalXZ(Math.floor(p.x + dx * 32), Math.floor(p.z + dz * 32))), T.move, 'Explore', signal); } finally { bot.pathfinder.setGoal(null); }
      return 'Explored ' + label;
    });
    add('wait', 'wait', 'Wait two seconds and observe', async ({ signal } = {}) => { await bounded(() => bot.waitForTicks(40), 5000, 'Wait', signal); return 'Waited'; });
    return out;
  }

  return { candidates, craft, mine, goNear, collectDrops, placeNear, bounded, get pending() { return pendingWork.size > 0; } };
}

export const SKILL_NAMES = ['eat', 'combat_attack', 'combat_flee', 'sleep', 'owner_follow', 'owner_give', 'gather_mine', 'gather_blocked', 'gather_pickup', 'travel_known', 'travel_waypoint', 'craft', 'smelt', 'smelt_collect', 'build_place', 'storage_inspect', 'explore', 'wait'];
