// Feeds the world database from what the bot has loaded: no save-file reads, only normal client state.
export const WATCHED = [
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore', 'nether_gold_ore', 'nether_quartz_ore', 'ancient_debris',
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'anvil', 'enchanting_table', 'brewing_stand',
  'nether_portal', 'end_portal_frame', 'end_portal', 'obsidian', 'spawner', 'bell',
  'white_bed', 'red_bed', 'blue_bed', 'green_bed', 'yellow_bed', 'black_bed', 'brown_bed', 'cyan_bed', 'gray_bed', 'light_blue_bed', 'light_gray_bed', 'lime_bed', 'magenta_bed', 'orange_bed', 'pink_bed', 'purple_bed',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'crimson_stem', 'warped_stem',
  'wheat', 'carrots', 'potatoes', 'sugar_cane', 'pumpkin', 'melon', 'sweet_berry_bush', 'lava', 'water',
];
// Fluids and logs are common; only their sources (level 0) and a bounded sample are worth keeping.
const SAMPLED = new Set(['lava', 'water', 'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'crimson_stem', 'warped_stem']);

export function installObserver(bot, world, { radius = 24, intervalMs = 3000, log = () => {} } = {}) {
  const ids = new Set(WATCHED.map((n) => bot.registry.blocksByName[n]?.id).filter((id) => id !== undefined));
  const dim = () => bot.game.dimension;
  let scanning = false;

  function scan() {
    if (scanning || !bot.entity) return;
    scanning = true;
    try {
      const found = bot.findBlocks({ matching: (b) => ids.has(b.type), maxDistance: radius, count: 600 });
      const perName = new Map(), items = [];
      for (const p of found) {
        const b = bot.blockAt(p);
        if (!b) continue;
        if ((b.name === 'water' || b.name === 'lava') && b.metadata !== 0) continue;
        const n = (perName.get(b.name) || 0) + 1;
        perName.set(b.name, n);
        if (SAMPLED.has(b.name) && n > 12) continue;
        items.push({ kind: 'block', name: b.name, dim: dim(), x: p.x, y: p.y, z: p.z });
      }
      if (items.length) world.recordMany(items);
    } catch (e) { log('observer_error', { error: e.message }); } finally { scanning = false; }
  }

  // A watched block that turns into something else (mined, burned, looted bed) is marked gone.
  const onUpdate = (oldBlock, newBlock) => {
    if (!oldBlock || !newBlock || oldBlock.type === newBlock.type || !ids.has(oldBlock.type)) return;
    world.markGone({ dim: dim(), ...oldBlock.position });
    if (ids.has(newBlock.type)) world.record({ kind: 'block', name: newBlock.name, dim: dim(), ...newBlock.position });
  };
  bot.on('blockUpdate', onUpdate);

  const onDeath = () => { const p = bot.entity?.position; if (p) world.note({ kind: 'death', text: `Died at ${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)} in ${dim()}`, dim: dim(), ...p }); };
  bot.on('death', onDeath);
  const onSpawn = () => { const p = bot.entity?.position; if (p) world.record({ kind: 'landmark', name: 'spawn_point', dim: dim(), x: p.x, y: p.y, z: p.z }); };
  bot.once('spawn', onSpawn);

  const timer = setInterval(scan, intervalMs);
  return { scan, close() { clearInterval(timer); bot.off('blockUpdate', onUpdate); bot.off('death', onDeath); } };
}
