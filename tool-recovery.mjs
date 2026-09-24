import {Vec3} from 'vec3';import {placeAt} from './nether-route.mjs';
export function toolRecovery(bot,add,{go,mine,inventory}){
 const i=inventory();if(i.iron_pickaxe||i.stone_pickaxe||i.wooden_pickaxe)return false;const p=bot.entity.position,planks=Object.entries(i).filter(([n])=>n.endsWith('_planks')).reduce((s,[,v])=>s+v,0),logs=bot.inventory.items().find(q=>q.name.endsWith('_log')),table=bot.findBlock({matching:bot.registry.blocksByName.crafting_table.id,maxDistance:24});
 const craft=(name,count=1,t=null)=>{const recipe=bot.recipesFor(bot.registry.itemsByName[name].id,null,count,t)[0];if(recipe)add('recover_craft_'+name,'Craft '+name+' to replace the missing pickaxe',()=>bot.craft(recipe,count,t));};
 if(table&&table.position.distanceTo(p)>4)add('recover_table','Approach the existing crafting table to replace the pickaxe',()=>go(table.position,2));
 if(planks<6&&logs)craft(logs.name.replace('_log','_planks'));
 if(planks<6&&!logs)for(const q of bot.findBlocks({matching:b=>b.name.endsWith('_log'),maxDistance:32,count:2}))add('recover_log_'+q,'Collect one log for pickaxe recovery at '+q,()=>mine(q));
 if((i.stick||0)<2)craft('stick');
 if(!table&&!i.crafting_table)craft('crafting_table');
 if(!table&&i.crafting_table){const q=p.floored();for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){const at=q.offset(x,0,z);if(bot.blockAt(at)?.name==='air'&&bot.blockAt(at.offset(0,-1,0))?.boundingBox==='block'){add('recover_place_table','Place a table for pickaxe recovery',()=>placeAt(bot,at,'crafting_table',go));break;}}}
 if(table&&table.position.distanceTo(p)<=4)craft((i.iron_ingot||0)>=3?'iron_pickaxe':'stone_pickaxe',1,table);
 return true;
}
