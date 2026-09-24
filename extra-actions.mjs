import {supportedBreathMargin} from './breath-safety.mjs';
import {droppedItem} from './item-observation.mjs';
import {endCombatActions,setDragonSensor,preciseHead,observedDragon} from './end-combat.mjs';
let dragonSensor=null;
export function updateDragonSensor(data){dragonSensor=data;setDragonSensor(data);}
function observedHead(dragon){return dragonSensor?.headCenter&&Date.now()-dragonSensor.time<1000?new Vec3(dragonSensor.headCenter.x,dragonSensor.headCenter.y,dragonSensor.headCenter.z):dragon.position.offset(Math.sin(dragon.yaw)*6.5,-.5,Math.cos(dragon.yaw)*6.5);}
import {Vec3} from 'vec3';
import {preparationNeeds,woodNeeded} from './optimization/policy.mjs';
export function extraActions(bot,add,{go,tool,item,place,bounded,inv}){
 if(bot.game.dimension==='the_end'){endCombatActions(bot,add,{go,bounded,item});return;}
 const p=bot.entity.position;const items=inv();
 const water=bot.findBlock({matching:b=>b.name==='water'&&b.getProperties().level===0,maxDistance:24});
 if(item('bucket')&&water)add('fill_bucket','Fill empty bucket at nearby water source '+water.position,async()=>{await go(water.position,3);await bot.equip(item('bucket'),'hand');await bot.lookAt(water.position.offset(.5,.1,.5),true);bot.activateItem();await bot.waitForTicks(5);bot.deactivateItem();});
 const furnace=bot.findBlock({matching:bot.registry.blocksByName.furnace.id,maxDistance:24});
 if(!furnace&&item('furnace'))add('place_furnace','Place carried furnace beside player',()=>place('furnace'));
 if(furnace&&bot.game.difficulty!=='peaceful'){
  if(item('iron_ore'))add('smelt_iron','Put carried iron ore and fuel into furnace at '+furnace.position,async()=>{await go(furnace.position,3);const f=await bot.openFurnace(furnace);try{const ore=item('iron_ore');const fuel=item('coal')||item('charcoal')||item('oak_planks');if(fuel&&!f.fuelItem())await f.putFuel(fuel.type,null,Math.min(fuel.count,Math.ceil(ore.count/(fuel.name==='oak_planks'?1.5:8))));if(!f.inputItem())await f.putInput(ore.type,null,ore.count);}finally{f.close();}});
  add('take_iron','Check furnace and take any finished iron ingots at '+furnace.position,async()=>{await go(furnace.position,3);const f=await bot.openFurnace(furnace);try{if(f.outputItem())await f.takeOutput();else throw new Error('No finished output yet');}finally{f.close();}});
 }
 const needs=preparationNeeds(items);
 const usefulDrop=e=>{const n=droppedItem(e)?.name;if(!n)return false;if(n.endsWith('_bed'))return needs.beds>0;if(n.endsWith('_boat'))return !items.oak_boat;if(n.endsWith('_log')||n.endsWith('_planks'))return woodNeeded(items)>0;if(['dirt','cobblestone'].includes(n))return needs.navigationBlocks>0||needs.cobblestoneForTools>0;return ['obsidian','stone_pickaxe','stone_axe'].includes(n)&&!items[n];};
 for(const e of Object.values(bot.entities).filter(e=>e.name==='item'&&e.position.distanceTo(p)<8&&usefulDrop(e)).slice(0,3))add('collect_'+e.id,'Walk to collect dropped '+droppedItem(e)?.name+' at '+e.position,()=>go(e.position,.8,4000));
 // Offer one safe downward mining step only where the loaded column has a landing.
 if(Math.hypot(p.x-1015,p.z+1221)<4&&p.y>35&&p.y<80){
  const below=bot.blockAt(p.floored().offset(0,-1,0));
  const column=Array.from({length:7},(_,i)=>bot.blockAt(p.floored().offset(0,-2-i,0)));
  const landing=column.find(b=>b&&(b.boundingBox==='block'||b.name==='end_portal'||b.name==='water'||b.name==='lava'));
  if(below?.diggable&&below.boundingBox==='block'&&landing&&landing.name!=='lava'&&p.y-landing.position.y<=7)add('portal_descent','Mine the one block underfoot above the verified portal. The loaded column has a safe landing at '+landing.position,async()=>{bot.pathfinder.setGoal(null);const start=bot.entity.position.clone();const center=below.position.offset(.5,1,.5);if(Math.hypot(start.x-center.x,start.z-center.z)>.15){await go(center,0,3000);}await tool(below);await bot.dig(below,true);await bot.waitForTicks(16);if(bot.game.dimension!=='the_end'&&bot.entity.position.y>start.y-.4)throw new Error('Descent did not lower the player; recenter before retry');return 'Mined one descent block';});
 }
 const portal=bot.findBlock({matching:bot.registry.blocksByName.end_portal.id,maxDistance:48});
 if(portal)add('enter_portal','Step into active End portal at '+portal.position,async()=>{await bounded(bot.pathfinder.goto(new (await import('mineflayer-pathfinder')).default.goals.GoalBlock(portal.position.x,portal.position.y,portal.position.z)),20000);});
 if(bot.game.dimension!=='the_end'){
  const carriedBed=bot.inventory.items().find(i=>i.name.endsWith('_bed'));
  if(bot.game.difficulty!=='peaceful'&&carriedBed&&!bot.entity.isInWater)add('place_sleep_bed','Place one carried bed on clear dry ground to sleep and set respawn',async()=>{
   const origin=bot.entity.position.floored();
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])for(const [sx,sz] of [[1,0],[-1,0],[0,1],[0,-1]]){
    const foot=origin.offset(dx,0,dz),head=foot.offset(sx,0,sz),ref=bot.blockAt(foot.offset(0,-1,0));
    if(!['air','grass','tall_grass'].includes(bot.blockAt(foot)?.name)||!['air','grass','tall_grass'].includes(bot.blockAt(head)?.name)||ref?.boundingBox!=='block'||bot.blockAt(head.offset(0,-1,0))?.boundingBox!=='block')continue;
    await bot.equip(carriedBed,'hand');await bot.look(Math.atan2(-sx,-sz),0,true);await bot.waitForTicks(2);await bot._placeBlockWithOptions(ref,new Vec3(0,1,0),{forceLook:'ignore',swingArm:'right'});return;
   }throw new Error('No dry two-block bed site nearby');
  });return;
 }

}

export function battleObservation(bot){
 const d=observedDragon(bot);if(!d)return null;
 const phase=d.metadata[15],head=observedHead(d);
 const bed=bot.findBlock({matching:b=>b.name.endsWith('_bed'),maxDistance:64});
 return {health:d.metadata[8],headSensor:dragonSensor?.headCenter&&Date.now()-dragonSensor.time<1000?'server hitbox center':'client estimate',breathClouds:Object.values(bot.entities).filter(e=>e.name==='area_effect_cloud').map(e=>({position:e.position,metadata:e.metadata,distance:e.position.distanceTo(bot.entity.position),safeAtCurrentHeight:supportedBreathMargin(bot,bot.entity.position,[e])===Infinity})),phase,phaseName:['circling','strafing','approaching_perch','landing','taking_off','breathing_fire','perched_scanning','perched_attacking','charging','dying','hovering'][phase],body:d.position,headEstimate:head,headEstimateCaution:dragonSensor?.headCenter&&Date.now()-dragonSensor.time<1000?'Read-only server sensor, refreshed every 50 ms':'Approximation; landing pitch and delayed body motion can change actual head position.',bed:bed?{position:bed.position,properties:bed.getProperties(),headDistanceEstimate:head.distanceTo(bed.position.offset(.5,.5,.5))}:null,playerPosition:bot.entity.position};
}
