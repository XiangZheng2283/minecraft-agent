import recipeFactory from 'prismarine-recipe';

const recipeCache = new Map();

function recipeLookup(registry) {
  const version = registry.version?.minecraftVersion;
  if (!version) return () => [];
  if (!recipeCache.has(version)) recipeCache.set(version, recipeFactory(version).Recipe);
  return (id) => recipeCache.get(version).find(id) || [];
}

export function recipeInputs(recipe, registry) {
  const required = new Map();
  for (const entry of recipe.delta || []) {
    if (entry.count >= 0 || entry.id < 0) continue;
    const name = registry.items?.[entry.id]?.name;
    if (name) required.set(name, (required.get(name) || 0) - entry.count);
  }
  return required;
}

// Return one useful next step, recalculated after each inventory change. The
// search never treats missing raw materials as if they were already carried.
export function planRecipeStep({ registry, name, count = 1, inventory = {}, targets = {},
  hasTable = false, recipesForItem = recipeLookup(registry), maxDepth = 12, maxNodes = 256 } = {}) {
  const wanted = Math.max(1, Math.ceil(count));
  let visited = 0;
  const stock = (itemName) => Math.max(0, (inventory[itemName] || 0) - (targets[itemName] || 0));
  const missing = (itemName, amount = 1, reason = 'missing_material') => ({
    kind: 'missing', name: itemName, reason, missing: [{ name: itemName, count: Math.max(1, amount) }],
  });

  function resolve(itemName, amount, stack) {
    if (++visited > maxNodes || stack.length >= maxDepth) return missing(itemName, amount, 'search_limit');
    if (stack.includes(itemName)) return missing(itemName, amount, 'recipe_cycle');
    const available = stock(itemName);
    if (available >= amount) return { kind: 'satisfied' };
    const id = registry.itemsByName?.[itemName]?.id;
    if (id === undefined) return missing(itemName, amount - available, 'unknown_item');
    const recipes = (recipesForItem(id) || []).slice(0, 64);
    if (!recipes.length) return missing(itemName, amount - available);
    const nextStack = [...stack, itemName];
    let best = null;
    let bestRank = Infinity;
    for (const recipe of recipes) {
      const output = recipe.result?.count;
      if (!Number.isSafeInteger(output) || output <= 0) continue;
      const inputs = recipeInputs(recipe, registry);
      if (!inputs.size) continue;
      let candidate = null;
      if (recipe.requiresTable && !hasTable) {
        if (itemName === 'crafting_table') continue;
        if (stock('crafting_table') >= 1) candidate = { kind: 'place', name: 'crafting_table' };
        else candidate = resolve('crafting_table', 1, nextStack);
      }
      if (!candidate || candidate.kind === 'satisfied') {
        for (const [ingredient, quantity] of inputs) {
          if (stock(ingredient) >= quantity) continue;
          candidate = resolve(ingredient, quantity, nextStack);
          if (candidate.kind !== 'satisfied') break;
        }
      }
      if (!candidate || candidate.kind === 'satisfied') {
        const desired = Math.ceil((amount - available) / output);
        const affordable = Math.min(...[...inputs].map(([ingredient, quantity]) => Math.floor(stock(ingredient) / quantity)));
        candidate = { kind: 'craft', name: itemName, count: Math.max(1, Math.min(desired, affordable)), recipe };
      }
      const rank = candidate.kind === 'missing' ? 1000 + candidate.missing.reduce((n, m) => n + m.count, 0)
        : candidate.kind === 'craft' && candidate.name === itemName ? 0 : 1;
      if (rank < bestRank) { best = candidate; bestRank = rank; }
      if (rank === 0) break;
    }
    return best || missing(itemName, amount - available, 'no_valid_recipe');
  }

  return resolve(name, wanted, []);
}
