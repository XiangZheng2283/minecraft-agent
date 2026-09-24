import {defenseActions,visibleThreat} from './hostile-defense.mjs';
import {Vec3} from 'vec3';import {coveredWalk,openShaftWindow,coveredDescent,coveredRise,fillShaftBlock,mobSupportHeight} from './covered-shaft.mjs';
export async function approachBarter(bot,e,log=()=>{}){
 const p=bot.entity.position;
 if((bot.coveredMaterialShortage||!bot.inventory.items().some(i=>['netherrack','dirt','blackstone','polished_blackstone_bricks','cracked_polished_blackstone_bricks','basalt','polished_basalt'].includes(i.name)))&&e.position.distanceTo(p)>3.15&&safeNearbyPickup(bot,{position:p}))return null;
 if(p.y>=60&&p.y<=100&&p.x>-145&&p.x<-100&&p.z>30&&p.z<60){
  const reach=bot.barterNeedsCloser===e.id?2.4:3.15;if(bot.barterNeedsCloser===e.id&&e.position.distanceTo(p)>reach&&safeNearbyPickup(bot,e))return null;
  if(e.position.distanceTo(p)<=reach){if(!await prepareBarterFloor(bot,e,log))return false;const d=e.position.minus(p),dx=Math.abs(d.x)>=Math.abs(d.z)?Math.sign(d.x):0,dz=dx?0:Math.sign(d.z);if(dx||dz)await openShaftWindow(bot,dx,dz);bot.clearControlStates();return true;}
  const horizontal=Math.hypot(e.position.x-p.x,e.position.z-p.z);
  if(horizontal<2.5&&Math.abs(p.y-(mobSupportHeight(bot,e)+1))>.2){const target=mobSupportHeight(bot,e)+1;if(p.y>target)await coveredDescent(bot,target,log);else await coveredRise(bot,target,log);return false;}
  if(e.position.distanceTo(p)>reach){await coveredWalk(bot,new Vec3(Math.floor(e.position.x),Math.floor(p.y),Math.floor(e.position.z)),log);return false;}
  const d=e.position.minus(p),dx=Math.abs(d.x)>=Math.abs(d.z)?Math.sign(d.x):0,dz=dx?0:Math.sign(d.z);await openShaftWindow(bot,dx,dz);bot.clearControlStates();return true;
 }
 return null;
}
export function safeNearbyPickup(bot,e){const p=bot.entity.position;if(e.position.distanceTo(p)>4||Math.abs(e.position.y-p.y)>3)return false;if(![5,6,7,8].some(n=>bot.inventory.slots[n]?.name?.startsWith('golden_')))return false;return !Object.values(bot.entities).some(m=>m.position.distanceTo(p)<24&&visibleThreat(bot,m)&&(Math.abs(m.position.y-p.y)<=6||['ghast','blaze'].includes(m.name))&&((['piglin_brute','hoglin','blaze','wither_skeleton','skeleton','ghast','magma_cube'].includes(m.name)&&(m.metadata?.[8]??1)>0)||(['piglin','zombified_piglin'].includes(m.name)&&((m.metadata?.[14]||0)&4))));}
export async function approachCoveredDrop(bot,e,log=()=>{}){
 const p=bot.entity.position;
 if(bot.game.dimension!=='the_nether'||p.y<60||p.y>100||p.x<-145||p.x>-100||p.z<30||p.z>60)return null;
 if(safeNearbyPickup(bot,e))return null;
 const q=e.position.floored(),horizontal=Math.hypot(e.position.x-p.x,e.position.z-p.z);
 if(horizontal>1.1){await coveredWalk(bot,new Vec3(q.x,Math.floor(p.y),q.z),log);return false;}
 if(p.y>e.position.y+.7){await coveredDescent(bot,Math.ceil(e.position.y),log);return false;}
 if(p.y<e.position.y-.2){await coveredRise(bot,Math.ceil(e.position.y),log);return false;}
 await bot.waitForTicks(6);return true;
}

// A trade takes six seconds. Do not hide newly approaching enemies during that wait.
export async function waitForBarter(bot,ticks,log=()=>{}){
 bot.setControlState('sneak',true);
 for(let n=0;n<ticks;n++){
  const p=bot.entity.position;
  const brute=Object.values(bot.entities).filter(e=>e.name==='piglin_brute'&&(e.metadata?.[8]??0)>0&&e.position.distanceTo(p)<7&&Math.abs(e.position.y-p.y)<3).sort((a,b)=>a.position.distanceTo(p)-b.position.distanceTo(p))[0];
  if(brute){
   bot.pathfinder.setGoal(null);bot.clearControlStates();bot.barterThreatId=brute.id;
   if(bot.inventory.slots[45]?.name==='shield')bot.activateItem(true);
   await bot.lookAt(brute.position.offset(0,1.4,0));
   log('barter_threat_interrupt',{entity:brute.id,position:brute.position,health:bot.health});
   return false;
  }
  await bot.waitForTicks(1);
 }
 return true;
}

export function barterDefenseActions(bot,add,log=()=>{}){
 const e=bot.entities[bot.barterThreatId]||bot.entities[bot.navigationThreat];
 if(e&&e.name!=='piglin_brute')return false;
 if(!e||(e.metadata?.[8]??0)<=0||e.position.distanceTo(bot.entity.position)>14){bot.barterThreatId=null;return false;}
 let offered=false;
 defenseActions(bot,(key,description,fn)=>{if(key==='defend_'+e.id){add(key,description,fn);offered=true;}},{item:n=>bot.inventory.items().find(i=>i.name===n),log});
 return offered;
}

export async function prepareBarterFloor(bot,e,log=()=>{}){
 const p=bot.entity.position,level=mobSupportHeight(bot,e),floorY=level-1;
 if(p.y<level+.9){await coveredRise(bot,level+1,log);return false;}
 if(p.y>level+1.1){await coveredDescent(bot,level+1,log);return false;}
 const eye=p.offset(0,1.62,0),base=e.position.floored(),blocks=[];
 for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){
  const q=new Vec3(base.x+dx,floorY,base.z+dz),b=bot.blockAt(q);
  if(q.offset(.5,.5,.5).distanceTo(eye)>4.4||b?.boundingBox==='block')continue;
  if(!b||!['air','cave_air'].includes(b.name))throw Error('Unsafe barter catch-floor cell at '+q);
  blocks.push(q);
 }
 blocks.sort((a,b)=>a.distanceTo(p)-b.distanceTo(p));
 let placed=0;
 for(const q of blocks){if(placed>=4)break;const supported=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]].some(d=>bot.blockAt(q.offset(...d))?.boundingBox==='block');if(!supported)continue;await fillShaftBlock(bot,q);placed++;}
 if(placed){log('barter_catch_floor',{placed,level:floorY,health:bot.health});return false;}
 if(blocks.length)throw Error('Barter catch floor needs a supported building position');
 return true;
}
