// Axes avoid sword sweep damage to neutral mobs beside the intended target.
export function meleeWeapon(bot,item=n=>bot.inventory.items().find(i=>i.name===n)){
 const names=bot.game?.dimension==='the_nether'?['diamond_axe','iron_axe','stone_axe','wooden_axe','golden_axe','iron_pickaxe','stone_pickaxe','wooden_pickaxe']:['iron_sword','stone_sword','iron_axe','stone_axe'];
 return names.map(item).find(Boolean);
}
export const meleeCooldown=weapon=>weapon?.name.endsWith('_axe')?23:15;
