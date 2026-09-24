import {droppedItem} from './item-observation.mjs';
import {Vec3} from 'vec3';
import {approachEndCover} from './navigation.mjs';
import {supportedBreathMargin,breathEscapeRoutes} from './breath-safety.mjs';
let sensor=null,lastBlast=0;
export function setDragonSensor(data){sensor=data;}
export function preciseHead(dragon){return sensor?.headCenter&&Date.now()-sensor.time<1000?new Vec3(sensor.headCenter.x,sensor.headCenter.y,sensor.headCenter.z):dragon.position.offset(Math.sin(dragon.yaw)*6.5,-.5,Math.cos(dragon.yaw)*6.5);}
export function endCombatActions(bot,add,{go,bounded,item}){
 const p=bot.entity.position,d=Object.values(bot.entities).find(e=>e.name==='ender_dragon');
 const bedrock=bot.findBlocks({matching:bot.registry.blocksByName.bedrock.id,maxDistance:128,count:180}).map(q=>bot.blockAt(q));
 const foundation=bedrock.filter(b=>b.position.x===0&&b.position.z===0).sort((a,b)=>b.position.y-a.position.y)[0];
 if(!foundation){add('approach_fountain','Travel toward the central fountain at X0 Z0',()=>approachEndCover(bot,new Vec3(0,p.y,0),bounded));return;}
 const top=foundation.position.y+2,pillar=bot.blockAt(new Vec3(0,top,0));
 if(pillar?.name!=='obsidian'){if(d&&([5,6,7].includes(d.metadata[15])||d.metadata[15]===3&&d.position.y<top+10)){add('wait_safe_setup','Wait outside the fountain while the dragon is perched; build the support after it takes off',()=>bot.waitForTicks(30));return;}const baseStand=new Vec3(-1,foundation.position.y-3,0);if(p.distanceTo(foundation.position)>5)add('approach_raised_cover','Approach the fountain to build the raised bed support',()=>approachEndCover(bot,baseStand,bounded));else add('raise_bed_column','Place two obsidian blocks above the fountain pillar for an earlier bed explosion during landing',async()=>{bot.pathfinder.setGoal(null);bot.clearControlStates();for(let y=foundation.position.y+1;y<=top;y++){const q=new Vec3(0,y,0),b=bot.blockAt(q);if(b?.boundingBox==='block')continue;if(b?.name.endsWith('_bed'))await bot.dig(b,true);if(!item('obsidian'))throw Error('No obsidian for raised cover');await bot.equip(item('obsidian'),'hand');await bot.placeBlock(bot.blockAt(q.offset(0,-1,0)),new Vec3(0,1,0));}});return;}
 const stand=new Vec3(-1,top-4,0),clouds=Object.values(bot.entities).filter(e=>e.name==='area_effect_cloud');
 const currentClouds=()=>Object.values(bot.entities).filter(e=>e.name==='area_effect_cloud');
 const unsafe=q=>supportedBreathMargin(bot,q,currentClouds())<2;
 if(unsafe(p)){
  for(const [index,route] of breathEscapeRoutes(bot,p,clouds).entries()){
   const {dx,dz,length,margin}=route;
   add('escape_'+index,`Escape all breath clouds along checked path toward (${route.end.x.toFixed(1)},${route.end.y},${route.end.z.toFixed(1)}), ${length} blocks clear; end safety margin ${margin.toFixed(1)}. Stop if blocked or a new cloud blocks the path.`,async()=>{
    const start=bot.entity.position.clone(),dimension=bot.game.dimension;let previous=start.clone(),stalled=0;
    bot.pathfinder.setGoal(null);bot.steerWalk({dx,dz,path:[start.offset(dx*12,0,dz*12)]});bot.setControlState('forward',true);bot.setControlState('sprint',true);bot.setControlState('jump',true);
    try{for(let t=0;t<100;t+=2){
     bot.steerWalk({dx,dz,path:[bot.entity.position.offset(dx*12,0,dz*12)]});bot.setControlState('forward',true);await bot.waitForTicks(2);if(bot.health<=0||bot.game.dimension!==dimension)throw new Error('Escape interrupted by death or dimension change');
     const now=bot.entity.position,moved=Math.hypot(now.x-start.x,now.z-start.z);stalled=now.distanceTo(previous)<.1?stalled+2:0;previous=now.clone();
     if(stalled>=8)throw new Error('Escape blocked; choose another checked path');
     if(moved>=4&&supportedBreathMargin(bot,now,currentClouds())>3)return `Escaped all breath, moved ${moved.toFixed(1)} blocks`;
     if(moved>=length-.8)return 'Reached checked escape path limit';
     const next=now.offset(dx*1.5,0,dz*1.5);if(currentClouds().some(c=>supportedBreathMargin(bot,now,[c])>0&&supportedBreathMargin(bot,next,[c])<0))throw new Error('New cloud blocks escape; choose another checked path');
    }}finally{bot.clearControlStates();}
   });
  }
  return;
 }
 for(const e of Object.values(bot.entities).filter(e=>e.name==='item'&&droppedItem(e)&&(/_bed$|_pickaxe$|_sword$|_helmet$|_chestplate$|_leggings$|_boots$/.test(droppedItem(e)?.name)||['obsidian','shield','bread','golden_carrot','cooked_porkchop'].includes(droppedItem(e)?.name))&&e.position.distanceTo(p)<32&&!unsafe(e.position)).sort((a,b)=>a.position.distanceTo(p)-b.position.distanceTo(p)).slice(0,4))add('recover_'+e.id,'Recover dropped equipment at '+e.position,()=>go(e.position,.7,10000));

 if(!d||d.metadata[8]<=0){const portal=bot.findBlock({matching:bot.registry.blocksByName.end_portal.id,maxDistance:128});if(portal)add('exit_portal','Enter the active exit portal after dragon death',()=>go(portal.position,0));add('wait_death',d?'Wait for dragon death animation and exit portal':'Wait for the dragon to enter observation range',()=>bot.waitForTicks(20));return;}
 const inPosition=p.distanceTo(stand.offset(.5,0,.5))<.75;
 if(inPosition&&Object.values(bot.entities).some(e=>e.name==='enderman'&&e.position.distanceTo(p)<6&&(e.metadata?.[16]===true||e.metadata?.[17]===true))&&item('water_bucket')&&bot.blockAt(p.floored())?.name!=='water'){add('water_cover','Place water at the covered position before aiming above the pillar; keep Endermen away',async()=>{bot.pathfinder.setGoal(null);bot.clearControlStates();const floor=bot.blockAt(bot.entity.position.floored().offset(0,-1,0));await bot.equip(item('water_bucket'),'hand');await bot.look(bot.entity.yaw,-Math.PI/2);bot.activateItem();await bot.waitForTicks(6);bot.deactivateItem();if(bot.blockAt(bot.entity.position.floored())?.name!=='water')throw Error('Water cover was not placed');return 'Water protects the covered position';});return;}
 const earlySupport=bot.blockAt(new Vec3(-3,top,0));
 if(bot.waitAwayForPerch&&earlySupport?.boundingBox==='block'&&[0,1,4,8].includes(d.metadata[15])){
  if(p.x>-38||Math.abs(p.z)>16){
   const spots=[];for(const [x,z] of [[-42,0],[-42,12],[-42,-12]])for(let y=80;y>=50;y--){const q=new Vec3(x,y,z);if(bot.blockAt(q.offset(0,-1,0))?.boundingBox==='block'&&bot.blockAt(q)?.boundingBox==='empty'&&bot.blockAt(q.offset(0,1,0))?.boundingBox==='empty'){if(!unsafe(q))spots.push(q);break;}}
   spots.sort((a,b)=>a.distanceTo(p)-b.distanceTo(p));for(const [n,q] of spots.slice(0,2).entries())add('perch_wait_position_'+n,'Wait away from the fountain at '+q+' to reduce dragon strafes; return when the observed landing approach begins',()=>approachEndCover(bot,q,bounded));
  }
  add('wait_dragon','Observe from outside the fountain; stop waiting as soon as the dragon starts to land or breath approaches',async()=>{for(let n=0;n<60;n++){if(unsafe(bot.entity.position)||![0,1,4,8].includes(d.metadata[15]))return 'Dragon state changed';await bot.waitForTicks(1);}});return;
 }
 const support=bot.blockAt(new Vec3(-3,top,0));
 if(support?.boundingBox!=='block'&&item('obsidian')){
  const missing=[-1,-2,-3].map(x=>new Vec3(x,top,0)).find(q=>bot.blockAt(q)?.boundingBox!=='block');
  if(missing&&p.offset(0,1.62,0).distanceTo(missing.offset(.5,.5,.5))<4.5){add('setup_bed_support','Extend the obsidian roof west of the pillar to shield the player below the bed',async()=>{await bot.equip(item('obsidian'),'hand');await bot.placeBlock(bot.blockAt(missing.offset(1,0,0)),new Vec3(-1,0,0));});return;}
 }
 if(!inPosition&&!unsafe(stand))add('take_cover',`Stand west of the pillar at (-1,${top-4},0). Keep low cover between the player and bed.`,()=>approachEndCover(bot,stand,bounded));
 const bed=bot.findBlock({matching:b=>b.name.endsWith('_bed'),maxDistance:12});
 const bedItem=bot.inventory.items().find(i=>i.name.endsWith('_bed'));
 if(inPosition&&!unsafe(p)&&support?.boundingBox==='block'&&(bed||bedItem&&[2,3,5,6,7].includes(d.metadata[15])))add('one_timed_bed',`Arm ONE bed attack. Place the bed on the west obsidian roof. Wait up to 16 seconds for the observed dragon head within 4.3 blocks of the pillow while the dragon is at least Y${top-2}, then explode once from ground cover. Abort on nearby breath.`,async()=>{
   let placed=bot.findBlock({matching:b=>b.name.endsWith('_bed'),maxDistance:12});if(placed&&placed.getProperties().facing!=='west'){await bot.dig(placed,true);placed=null;}
   if(!placed){const clearStart=Date.now();while(preciseHead(d).distanceTo(new Vec3(-2.5,top+1.5,.5))<4&&Date.now()-clearStart<5000)await bot.waitForTicks(1);const it=bot.inventory.items().find(i=>i.name.endsWith('_bed'));if(!it)throw new Error('No bed');await bot.equip(it,'hand');await bot.lookAt(new Vec3(-1.5,top+1.5,.5),true);if(bot.breathReflexActive||unsafe(bot.entity.position))throw Error('Breath interrupts bed placement');try{await bot._placeBlockWithOptions(bot.blockAt(new Vec3(-2,top,0)),new Vec3(0,1,0),{forceLook:'ignore',swingArm:'right'});}catch(e){if(!bot.blockAt(new Vec3(-2,top+1,0))?.name.endsWith('_bed'))throw e;}placed=bot.blockAt(new Vec3(-2,top+1,0));}
   await bot.lookAt(placed.position.offset(.5,.5,.5),true);
   const start=Date.now();while(Date.now()-start<16000){const dragon=Object.values(bot.entities).find(e=>e.name==='ender_dragon');if(!dragon||dragon.metadata[8]<=0)return 'Dragon defeated';if(unsafe(bot.entity.position))throw new Error('Breath entered cover; escape next');if(bot.entity.position.distanceTo(stand.offset(.5,0,.5))>1)throw new Error('Lost cover position');if(!bot.blockAt(placed.position)?.name.endsWith('_bed'))throw new Error('Bed was destroyed');const head=preciseHead(dragon),pillow=new Vec3(-2.5,top+1.5,.5);if(dragon.position.y>=top-2&&head.distanceTo(pillow)<4.3&&bot.entity.onGround&&Date.now()-lastBlast>700){const before=dragon.metadata[8];bot.emit('bedBlastAttempt',{head,body:dragon.position.clone(),phase:dragon.metadata[15],distance:head.distanceTo(pillow)});await bot.activateBlock(bot.blockAt(placed.position));lastBlast=Date.now();await bot.waitForTicks(12);return `One bed blast: dragon health ${before} -> ${dragon.metadata[8]}, head distance ${head.distanceTo(pillow).toFixed(2)}`;}await bot.waitForTicks(1);}return 'Bed armed; no valid head window yet';
 });
 add('wait_dragon','Observe dragon for at most three seconds; stop immediately if breath approaches',async()=>{for(let t=0;t<60;t++){if(unsafe(bot.entity.position))return 'Breath approaching; escape now';await bot.waitForTicks(1);}});
}
