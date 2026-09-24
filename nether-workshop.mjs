import {Vec3} from 'vec3';
import {placeAt} from './nether-route.mjs';
export function workshopActions(bot,offer,{inventory,mine,go}){
 let offered=0;const add=(...args)=>{offered++;return offer(...args);};
 const i=inventory(),p=bot.entity.position,stone=bot.inventory.items().filter(q=>['stone_pickaxe','wooden_pickaxe'].includes(q.name)).reduce((n,q)=>n+Math.max(0,(q.name==='wooden_pickaxe'?59:131)-(q.durabilityUsed||0)),0),iron=bot.inventory.items().filter(q=>q.name==='iron_pickaxe').reduce((n,q)=>n+Math.max(0,250-(q.durabilityUsed||0)),0),need=stone<30&&iron<100;
 const availableIron=(i.iron_ingot||0)+9*(i.iron_block||0)+Math.floor((i.iron_nugget||0)/9),armorName=!i.iron_leggings&&!i.diamond_leggings&&availableIron>=7?'iron_leggings':!i.iron_helmet&&!i.diamond_helmet&&availableIron>=5?'iron_helmet':null;
 const table=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:4});
 const craft=(name,count=1,t=null)=>{const r=bot.recipesFor(bot.registry.itemsByName[name].id,null,count,t)[0];if(r)add('workshop_'+name,'Craft '+count+' '+name+' from carried supplies',()=>bot.craft(r,count,t));};
 if(i.iron_block)craft('iron_ingot');
 const needAxe=bot.game?.dimension==='the_nether'&&!bot.inventory.items().some(q=>q.name.endsWith('_axe'));
 const goldCraft=(i.gold_nugget||0)>=9&&(i.gold_nugget>=64||bot.goldBatchReady);
 if(need||armorName||goldCraft||needAxe){
  const logs=bot.inventory.items().find(q=>q.name.endsWith('_log'));const planks=Object.entries(i).filter(([n])=>n.endsWith('_planks')).reduce((n,[,v])=>n+v,0);if(logs&&planks<(!table&&!i.crafting_table?7:3))craft(logs.name.replace('_log','_planks'));
  if((need||needAxe)&&(i.stick||0)<2)craft('stick');
  if(!table&&!i.crafting_table)craft('crafting_table');
  if(!table&&i.crafting_table){for(const [x,z] of [[0,1],[0,-1],[1,0],[-1,0]]){const at=p.floored().offset(x,0,z),b=bot.blockAt(at);if(!b||['lava','bedrock'].includes(b.name))continue;add('workshop_place','Place the carried table beside the tunnel to replace worn tools',async()=>{if(b.boundingBox!=='empty'){const tool=bot.pathfinder.bestHarvestTool(b);if(tool)await bot.equip(tool,'hand');await bot.dig(b,true);}await placeAt(bot,at,'crafting_table',go);});break;}}
  if(table){if(needAxe){const axe=['iron_axe','stone_axe','wooden_axe'].find(name=>bot.recipesFor(bot.registry.itemsByName[name].id,null,1,table).length);if(axe)craft(axe,1,table);}if(goldCraft)craft('gold_ingot',Math.floor(i.gold_nugget/9),table);const ironDeficit=Math.max(0,(need?3:armorName==='iron_leggings'?7:armorName==='iron_helmet'?5:0)-(i.iron_ingot||0));if((i.iron_nugget||0)>=9&&ironDeficit)craft('iron_ingot',Math.min(ironDeficit,Math.floor(i.iron_nugget/9)),table);if(need){const replacement=['iron_pickaxe','stone_pickaxe','wooden_pickaxe'].find(name=>bot.recipesFor(bot.registry.itemsByName[name].id,null,1,table).length);if(replacement)craft(replacement,1,table);}else if(armorName)craft(armorName,1,table);}
 }else if(table&&!i.crafting_table)add('workshop_pack','Collect the crafting table before continuing the route',()=>mine(table.position));
 return offered>0;
}
