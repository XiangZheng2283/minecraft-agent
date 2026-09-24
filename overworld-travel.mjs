import fs from 'node:fs';
import {Vec3} from 'vec3';
import {climbColumn} from './column-travel.mjs';
import pf from 'mineflayer-pathfinder';
const points=JSON.parse(fs.readFileSync(new URL('./optimization/eyes/overworld-route.json',import.meta.url))).route;
export function overworldTravelActions(bot,add,{bounded,log}){
 bot.surfaceTargetHeight=null;const p=bot.entity.position;
 if(Math.hypot(p.x+1957,p.z-301)<28)return false;
 if(p.x>100&&p.y<70){add('surface_ascent','Return to the village surface through a checked column',async()=>{
  const q=bot.entity.position.floored();
  if(bot.blockAt(q)?.name==='nether_portal'){await bounded(bot.pathfinder.goto(new pf.goals.GoalBlock(145,19,99)),10000);return 'Left portal for surface ascent';}
  return climbColumn(bot,70,log);
 });return true;}
 let index=bot.surfaceRouteIndex;
 if(index===undefined){index=0;let best=Infinity;for(let n=0;n<points.length;n++){const q=points[n],d=Math.hypot(p.x-q.x,p.z-q.z);if(d<best){best=d;index=n;}}}
 while(index<points.length-1&&Math.hypot(p.x-points[index].x,p.z-points[index].z)<5)index++;
 bot.surfaceRouteIndex=index;const q=points[index];
 if(bot.blockAt(p.floored())?.name==='water'&&bot.blockAt(p.floored().offset(0,1,0))?.name==='air'&&bot.blockAt(p.floored().offset(0,-1,0))?.boundingBox==='block'){
  add('surface_shallow_water','Wade toward the surface waypoint with jump held, then check the shore again',async()=>{
   bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.lookAt(new Vec3(q.x,p.y+1.62,q.z));
   bot.setControlState('jump',true);bot.setControlState('forward',true);
   try{for(let n=0;n<30;n++){await bot.waitForTicks(1);const foot=bot.entity.position.floored();if(bot.blockAt(foot)?.name!=='water')break;const dx=Math.sign(q.x-bot.entity.position.x),dz=Math.sign(q.z-bot.entity.position.z),ahead=foot.offset(dx,0,dz);if(bot.blockAt(ahead)?.name==='lava'||![1,2].some(y=>bot.blockAt(ahead.offset(0,-y,0))?.boundingBox==='block'))break;}}
   finally{bot.clearControlStates();}return 'Checked shallow-water movement';
  });return true;
 }

 if(p.y<q.y-4.25){
  if(bot.blockAt(p.floored().offset(0,-1,0))?.boundingBox!=='block'){
   const supports=[];for(let dx=-3;dx<=3;dx++)for(let dz=-3;dz<=3;dz++){const a=p.floored().offset(dx,0,dz);if(bot.blockAt(a.offset(0,-1,0))?.boundingBox==='block'&&bot.blockAt(a)?.boundingBox==='empty'&&bot.blockAt(a.offset(0,1,0))?.boundingBox==='empty')supports.push(a);}
   supports.sort((a,b)=>a.offset(.5,0,.5).distanceTo(p)-b.offset(.5,0,.5).distanceTo(p));
   if(supports[0]){const a=supports[0];add('surface_find_support','Move to the nearby solid floor before climbing out of the ravine',()=>bounded(bot.pathfinder.goto(new pf.goals.GoalBlock(a.x,a.y,a.z)),8000));return true;}
  }
  add('surface_ravine_recovery','Climb from the ravine floor back to the surveyed surface height '+q.y,()=>climbColumn(bot,q.y,log));return true;}
 bot.surfaceTargetHeight=q.y;
 add('surveyed_surface_'+index,'Follow the surveyed surface route to '+new Vec3(q.x,q.y,q.z)+'; waypoint '+(index+1)+' of '+points.length,async()=>{
  const before=bot.entity.position.clone();try{await bounded(bot.pathfinder.goto(new pf.goals.GoalXZ(q.x,q.z)),12000);}catch(e){if(bot.entity.position.distanceTo(before)<2)throw e;}finally{bot.pathfinder.setGoal(null);bot.clearControlStates();}
  const distance=Math.hypot(bot.entity.position.x-q.x,bot.entity.position.z-q.z);if(distance>=3&&bot.entity.position.distanceTo(before)<.5)throw Error('Surface path made no progress');log('surface_progress',{index,position:bot.entity.position,distance});return distance<3?'Reached surveyed surface waypoint':'Moved toward surveyed surface waypoint';
 });return true;
}
