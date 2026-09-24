import {meleeWeapon,meleeCooldown} from './melee-weapon.mjs';
import {visibleThreat,threats} from './hostile-defense.mjs';
import {Vec3} from 'vec3';import {climbColumn,centerColumn,descendColumn} from './column-travel.mjs';import {tunnelTool} from './mining-tools.mjs';
const sides=[[1,0],[-1,0],[0,1],[0,-1]];
function neutralBastionObstruction(bot){const p=bot.entity.position;return bot.game.dimension==='the_nether'&&p.x>-150&&p.x<-90&&p.z>20&&p.z<70&&p.y>60&&p.y<100&&!threats(bot).length&&!Object.values(bot.entities).some(e=>['piglin_brute','hoglin','wither_skeleton'].includes(e.name)&&(e.metadata?.[8]??0)>0&&e.position.distanceTo(p)<5)&&Object.values(bot.entities).some(e=>['piglin','zombified_piglin'].includes(e.name)&&!((e.metadata?.[14]||0)&4)&&Math.abs(e.position.y-p.y)<2&&e.position.distanceTo(p)<4);}

export function shaftMeleePoint(bot,e){const eye=bot.entity.position.offset(0,1.62,0),half=(e.width||.6)/2,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),q=new Vec3(clamp(eye.x,e.position.x-half,e.position.x+half),clamp(eye.y,e.position.y,e.position.y+(e.height||1.95)),clamp(eye.z,e.position.z-half,e.position.z+half));return eye.distanceTo(q)<=3?q:null;}
export function mobSupportHeight(bot,e){const q=e.position.floored();for(let n=1;n<=4;n++){const b=bot.blockAt(q.offset(0,-n,0));if(b?.boundingBox==='block')return q.y-n+1;}return Math.floor(e.position.y);}
const empty=b=>b?.boundingBox==='empty'&&!['lava','fire','water'].includes(b.name);
async function fill(bot,q){let b=bot.blockAt(q);if(b?.boundingBox==='block')return;if(!empty(b)&&b?.name!=='lava')throw Error('Unsafe shaft boundary at '+q+': '+b?.name);const item=['cobblestone','netherrack','dirt','blackstone','polished_blackstone_bricks','cracked_polished_blackstone_bricks','basalt','polished_basalt'].map(n=>bot.inventory.items().find(i=>i.name===n&&(n!=='cobblestone'||i.count>48))).find(Boolean);if(!item){bot.coveredMaterialShortage=true;throw Error('No shaft lining material');}let ref,face;for(const d of [[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]){const r=bot.blockAt(q.offset(...d));if(r?.boundingBox==='block'){ref=r;face=new Vec3(-d[0],-d[1],-d[2]);break;}}if(!ref)throw Error('Shaft lining has no support at '+q);bot.deactivateItem();await bot.equip(item,'hand');bot.setControlState('sneak',true);await bot.waitForTicks(2);try{await bot.placeBlock(ref,face);}catch(e){throw Error(e.message+'; support '+ref.name+' at '+ref.position+'; player '+bot.entity.position+'; nearby entities '+JSON.stringify(Object.values(bot.entities).filter(e=>e.position.distanceTo(q.offset(.5,.5,.5))<2).map(e=>({id:e.id,name:e.name,position:e.position}))));}finally{bot.setControlState('sneak',false);}await bot.waitForTicks(2);if(bot.blockAt(q)?.boundingBox!=='block')throw Error('Shaft lining not confirmed');}
export function protectedPiglinWindow(bot,q){const top=bot.blockAt(q.offset(0,1,0));if(!top?.shapes?.some(a=>a[0]===0&&a[1]===0&&a[2]===0&&a[3]===1&&a[4]===1&&a[5]===1))return false;return Object.values(bot.entities).some(e=>['piglin','zombified_piglin'].includes(e.name)&&e.metadata?.[16]!==true&&!((e.metadata?.[14]||0)&4)&&e.position.y<q.y+1&&e.position.y+(e.height||1.95)>q.y&&e.position.x+.3>q.x&&e.position.x-.3<q.x+1&&e.position.z+.3>q.z&&e.position.z-.3<q.z+1);}
export async function sealWall(bot,q){const top=q.offset(0,1,0),supported=bot.blockAt(top)?.boundingBox==='block'||[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(d=>bot.blockAt(top.offset(...d))?.boundingBox==='block');if(supported){await fill(bot,top);if(!protectedPiglinWindow(bot,q))await fill(bot,q);}else{await fill(bot,q.offset(0,-1,0));await fill(bot,q);await fill(bot,top);}}
export async function coveredDescent(bot,bottom,log=()=>{}){
 if(neutralBastionObstruction(bot)){await centerColumn(bot);bot.allowColumnFill=true;try{return await descendColumn(bot,Math.max(bottom,Math.floor(bot.entity.position.y)-2),log);}finally{bot.allowColumnFill=false;}}
 bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.waitForTicks(3);await centerColumn(bot);let steps=0;const began=Date.now();
 try{while(bot.entity.position.y>bottom+.1&&steps<2&&Date.now()-began<14000){const p=bot.entity.position.floored();if(!bot.entity.onGround)throw Error('Shaft descent requires a solid floor');
 // Seal the player and the next landing before opening the floor.
 for(const [x,z] of sides){const top=p.offset(x,1,z),supported=bot.blockAt(top)?.boundingBox==='block'||[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(d=>bot.blockAt(top.offset(...d))?.boundingBox==='block');for(const y of (supported?[1,0,-1]:[-1,0,1])){const q=p.offset(x,y,z);if(y===-1&&protectedPiglinWindow(bot,q)){log('covered_piglin_window',{position:q});continue;}await fill(bot,q);}}
 if(empty(bot.blockAt(p.offset(0,2,0)))){await fill(bot,p.offset(1,2,0));await fill(bot,p.offset(0,2,0));}
 await fill(bot,p.offset(0,-2,0));const nearBrute=Object.values(bot.entities).find(e=>e.name==='piglin_brute'&&e.metadata?.[8]>0&&Math.hypot(e.position.x-p.x-.5,e.position.z-p.z-.5)<2.8&&e.position.y>p.y-3.8&&e.position.y<p.y+.8);if(nearBrute){bot.shaftGuardId=nearBrute.id;bot.shaftCombatBase ??= Math.floor(p.y);throw Error('Brute below the shaft; defeat it before descending');}const floor=bot.blockAt(p.offset(0,-1,0));if(!floor?.diggable)throw Error('Shaft floor cannot be mined');const tool=tunnelTool(bot,floor);if(!tool)throw Error('Shaft descent needs a pickaxe');await bot.equip(tool,'hand');await bot.dig(floor,true);await bot.waitForTicks(10);if(Math.abs(bot.entity.position.y-p.y+1)>.1)throw Error('Shaft landing not confirmed');steps++;log('covered_shaft_step',{position:bot.entity.position});}
 }finally{bot.clearControlStates();}return 'Descended '+steps+' protected shaft blocks';
}
export async function openShaftWindow(bot,dx,dz,levels=[-1,0]){const base=bot.entity.position.floored();await fill(bot,base.offset(0,-1,0));await centerColumn(bot);const p=bot.entity.position.floored();for(const y of levels){const block=bot.blockAt(p.offset(dx,y,dz));if(block?.diggable&&block.boundingBox==='block'){const tool=tunnelTool(bot,block);if(tool)await bot.equip(tool,'hand');await bot.dig(block,true);}}bot.clearControlStates();}
export function shaftDefenseActions(bot,add,log=()=>{}){
 const p=bot.entity.position;if(bot.game.dimension!=='the_nether'||p.x < -140||p.x > -110||p.z < 32||p.z > 50||(p.y<83||p.y>96))return false;
 const enemies=Object.values(bot.entities).filter(e=>e.name==='piglin_brute'&&e.metadata?.[8]>0&&e.position.y>=p.y-4&&(e.position.distanceTo(p)<3.8||e.id===bot.shaftGuardId&&Math.hypot(e.position.x-p.x,e.position.z-p.z)<3.5));
 if(!enemies.length){if(bot.shaftCombatBase&&p.y>bot.shaftCombatBase){add('shaft_return','Return to the protected corridor after combat',()=>coveredDescent(bot,bot.shaftCombatBase,log));return true;}bot.shaftCombatBase=null;bot.shaftGuardId=null;return false;}
 add('shaft_defense','Stay inside the covered shaft. Open a low window and attack nearby brutes from at least three blocks above their floor',async()=>{
  bot.pathfinder.setGoal(null);bot.clearControlStates();const closeEnemies=enemies.filter(e=>Math.hypot(e.position.x-p.x,e.position.z-p.z)<1.8);const highest=closeEnemies.length?Math.max(...closeEnemies.map(e=>mobSupportHeight(bot,e))):-Infinity;if(p.y-highest<2.8){bot.shaftCombatBase ??= Math.floor(p.y);bot.shaftGuardId=enemies.sort((a,b)=>b.position.y-a.position.y)[0].id;bot.columnLimit=1;try{return await climbColumn(bot,Math.max(p.y+1,Math.ceil(highest)+3),log);}finally{bot.columnLimit=null;}}for(let n=0;n<8;n++){
   const enemy=Object.values(bot.entities).filter(e=>e.name==='piglin_brute'&&e.metadata?.[8]>0&&e.position.distanceTo(bot.entity.position)<3.8).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];
   if(!enemy){await bot.waitForTicks(20);break;}
   if(Math.hypot(enemy.position.x-bot.entity.position.x,enemy.position.z-bot.entity.position.z)<1.8&&bot.entity.position.y-mobSupportHeight(bot,enemy)<2.6){bot.columnLimit=1;try{return await climbColumn(bot,bot.entity.position.floored().y+1,log);}finally{bot.columnLimit=null;}}
   const d=enemy.position.minus(bot.entity.position),dx=Math.abs(d.x)>=Math.abs(d.z)?Math.sign(d.x):0,dz=dx?0:Math.sign(d.z);await openShaftWindow(bot,dx,dz,[-3,-2,-1,0]);if(Math.abs(d.x)>1&&Math.abs(d.z)>1)await openShaftWindow(bot,dx?0:Math.sign(d.x),dz?0:Math.sign(d.z),[-3,-2,-1,0]);if(!shaftMeleePoint(bot,enemy)){await bot.waitForTicks(20);continue;}bot.setControlState('sneak',true);const weapon=meleeWeapon(bot);if(!weapon)throw Error('No sword for shaft defense');await bot.equip(weapon,'hand');const aim=shaftMeleePoint(bot,enemy);if(aim)await bot.lookAt(aim);if(shaftMeleePoint(bot,enemy)){bot.attack(enemy);log('shaft_attack',{entity:enemy.id,health:bot.health,targetHealth:enemy.metadata?.[8]});}await bot.waitForTicks(meleeCooldown(weapon));if(bot.health<12)break;
  }bot.clearControlStates();
 });return true;
}
export async function coveredWalk(bot,target,log=()=>{}){
 bot.pathfinder.setGoal(null);bot.clearControlStates();await centerColumn(bot);
 const p=bot.entity.position.floored();if(p.y!==target.y)throw Error('Covered corridor must keep its floor height');
 const dx=Math.abs(target.x-p.x)>=Math.abs(target.z-p.z)?Math.sign(target.x-p.x):0,dz=dx?0:Math.sign(target.z-p.z);if(!dx&&!dz)return 'Reached covered corridor position';
 bot.pathfinder.setGoal(null);bot.clearControlStates();
 // Keep the current cell closed while the next cell gets a floor, roof and walls.
 const next=p.offset(dx,0,dz);
 const neutralNear=Object.values(bot.entities).some(e=>['piglin','zombified_piglin'].includes(e.name)&&!((e.metadata?.[14]||0)&4)&&Math.abs(e.position.y-p.y)<2&&e.position.distanceTo(bot.entity.position)<4);
 if((neutralNear||bot.coveredMaterialShortage)&&!threats(bot).length){const {tunnelStep}=await import('./tunnel-travel.mjs');log('covered_route_open_step',{reason:neutralNear?'neutral mob blocks wall placement':'lining material shortage',position:bot.entity.position});return tunnelStep(bot,next,log,1);}
 for(const [x,z] of sides)await sealWall(bot,p.offset(x,0,z));
 await fill(bot,next.offset(0,-1,0));await fill(bot,next.offset(0,2,0));await fill(bot,next.offset(dx,2,dz));
 for(const [x,z] of sides.filter(([x,z])=>x!==-dx||z!==-dz))await sealWall(bot,next.offset(x,0,z));
 const {tunnelStep}=await import('./tunnel-travel.mjs');bot.coveredTravelActive=true;try{return await tunnelStep(bot,next,log,1);}finally{bot.coveredTravelActive=false;}
}

export async function coveredRise(bot,top,log=()=>{}){
 if(neutralBastionObstruction(bot))return climbColumn(bot,Math.min(top,Math.floor(bot.entity.position.y)+2),log);
 bot.pathfinder.setGoal(null);bot.clearControlStates();await centerColumn(bot);
 let steps=0;while(bot.entity.position.y<top-.1&&steps<2){const p=bot.entity.position.floored();for(const [x,z] of sides)await sealWall(bot,p.offset(x,0,z));for(const [x,z] of sides)for(const y of [2,3])await fill(bot,p.offset(x,y,z));await fill(bot,p.offset(0,3,0));bot.columnLimit=1;try{await climbColumn(bot,p.y+1,log);}finally{bot.columnLimit=null;}steps++;}return 'Raised the covered fighting position by '+steps+' blocks';
}

export {fill as fillShaftBlock};
