import {Vec3} from 'vec3';
import {droppedItem} from './item-observation.mjs';
import {reserveItemSpace} from './nether-supplies.mjs';
export function nightActions(bot,add,{go,item}){
 if(bot.game.dimension!=='overworld'||bot.time.timeOfDay<12541||bot.time.timeOfDay>23458)return false;
 const bed=bot.findBlock({matching:b=>b.name.endsWith('_bed')&&!b.getProperties().occupied,maxDistance:40});
 if(bed){add('sleep_night','Sleep in the nearby bed to cross the night safely',async()=>{await go(bed.position,2,10000);bot.clearControlStates();if(bot.time.timeOfDay<12541||bot.time.timeOfDay>23458)return 'Daylight has started';await bot.sleep(bed);for(let n=0;n<180&&bot.isSleeping;n++)await bot.waitForTicks(1);await bot.waitForTicks(20);return 'Night sleep ended';});return true;}
 const carried=bot.inventory.items().find(i=>i.name.endsWith('_bed'));if(!carried)return false;
 const p=new Vec3(Math.floor(bot.entity.position.x),Math.ceil(bot.entity.position.y-.05),Math.floor(bot.entity.position.z));for(const [dx,dz] of [[2,0],[-3,0],[0,2],[0,-2]]){const q=p.offset(dx,0,dz),head=q.offset(1,0,0);if([q,head].every(v=>bot.blockAt(v)?.boundingBox==='empty'&&bot.blockAt(v.offset(0,1,0))?.boundingBox==='empty'&&bot.blockAt(v.offset(0,-1,0))?.boundingBox==='block')){add('place_night_bed','Place a carried bed on checked ground for the night',async()=>{bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.equip(carried,'hand');await bot.look(Math.PI*1.5,0);await bot.waitForTicks(3);await bot._placeBlockWithOptions(bot.blockAt(q.offset(0,-1,0)),new Vec3(0,1,0),{forceLook:'ignore',swingArm:'right'});await bot.waitForTicks(4);if(!bot.blockAt(q)?.name.endsWith('_bed'))throw Error('Night bed placement was not confirmed');bot.temporaryNightBed=q;});return true;}}
 const material=bot.inventory.items().find(i=>['netherrack','cobblestone','dirt'].includes(i.name)&&i.count>=3);
 if(material&&bot.blockAt(p.offset(0,-1,0))?.boundingBox==='block')for(const dx of [1,-1]){
  const cells=[1,2,3].flatMap(n=>[p.offset(dx*n,0,0),p.offset(dx*n,1,0)]);
  const unsafe=cells.some(q=>{const b=bot.blockAt(q);return !b||b.name.endsWith('_bed')||['lava','water','fire'].includes(b.name)||b.boundingBox!=='empty'&&!b.diggable||[[1,0,0],[-1,0,0],[0,1,0],[0,0,1],[0,0,-1]].some(d=>bot.blockAt(q.offset(...d))?.name==='lava');});
  if(unsafe)continue;
  add('prepare_night_bed','Clear a small bed space and extend the solid floor before night travel',async()=>{
   bot.pathfinder.setGoal(null);bot.clearControlStates();
   for(let n=1;n<=3;n++){
    const q=p.offset(dx*n,0,0);
    for(const h of [1,0]){const b=bot.blockAt(q.offset(0,h,0));if(b.boundingBox!=='empty'){const tool=bot.pathfinder.bestHarvestTool(b);if(tool)await bot.equip(tool,'hand');await bot.dig(b,true);}}
    if(bot.blockAt(q.offset(0,-1,0))?.boundingBox!=='block'){const ref=bot.blockAt(q.offset(-dx,-1,0));await bot.equip(material,'hand');await bot.placeBlock(ref,new Vec3(dx,0,0));await bot.waitForTicks(2);}
   }
  });return true;
 }
 return false;
}
export function recoverNightBed(bot,add,{mine,go}){
 if(!bot.temporaryNightBed||bot.time.timeOfDay>12000)return false;
 const q=bot.temporaryNightBed,block=bot.blockAt(q),drop=()=>Object.values(bot.entities).find(e=>e.name==='item'&&droppedItem(e)?.name.endsWith('_bed')&&e.position.distanceTo(q)<5);
 if(!block?.name.endsWith('_bed')&&!drop()){bot.temporaryNightBed=null;return false;}
 add('recover_night_bed','Recover the bed after sleeping and confirm it is in inventory',async()=>{
  const name=block?.name.endsWith('_bed')?block.name:droppedItem(drop())?.name;
  if(!name)return 'Bed drop no longer visible';
  const count=()=>bot.inventory.items().filter(i=>i.name.endsWith('_bed')).reduce((n,i)=>n+i.count,0),before=count();
  await reserveItemSpace(bot,name);
  if(bot.blockAt(q)?.name.endsWith('_bed'))await mine(q);
  if(count()<=before){const e=drop();if(e){await go(e.position,.6,10000);await bot.waitForTicks(8);}}
  if(count()<=before)throw Error('Night bed pickup not confirmed');
  bot.temporaryNightBed=null;return 'Confirmed night bed pickup';
 });return true;
}
