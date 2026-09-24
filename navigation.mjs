import {climbColumn} from './column-travel.mjs';
import {Vec3} from 'vec3';
import pf from 'mineflayer-pathfinder';
export function boundedWaypoint(p,target,maxDistance=28){const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);return d>maxDistance?new Vec3(Math.round(p.x+dx/d*maxDistance),p.y,Math.round(p.z+dz/d*maxDistance)):target;}
export async function approachEndCover(bot,target,bounded){
 if(bot.entity.position.x>65){const p=bot.entity.position.floored(),open=b=>b?.boundingBox==='empty';const sky=[2,3,4,5,6,7,8].every(y=>open(bot.blockAt(p.offset(0,y,0))));const walkable=[[1,0],[-1,0],[0,1],[0,-1]].some(([x,z])=>bot.blockAt(p.offset(x,-1,z))?.boundingBox==='block'&&open(bot.blockAt(p.offset(x,0,z)))&&open(bot.blockAt(p.offset(x,1,z))));if(!sky||!walkable){bot.columnLimit=1;try{return await climbColumn(bot,p.y+1);}finally{bot.columnLimit=null;}}}
 const location=bot.entity.position;
 if(target.x===-1&&target.z===0&&Math.hypot(location.x,location.z)<30){let around=null;if(location.x>0)around=new Vec3(-6,location.y,location.z<0?-8:8);else if(location.x<-3&&Math.abs(location.z)>3)around=new Vec3(-6,location.y,0);if(around){const before=bot.entity.position.clone();try{await bounded(bot.pathfinder.goto(new pf.goals.GoalXZ(around.x,around.z)),10000);}finally{bot.pathfinder.setGoal(null);bot.clearControlStates();}if(bot.entity.position.distanceTo(before)<.2&&Math.hypot(bot.entity.position.x-around.x-.5,bot.entity.position.z-around.z-.5)>2)throw Error('Fountain approach stopped without movement');return 'Approached the fountain from its west side';}}
 const start=bot.entity.position.clone(),next=boundedWaypoint(start,target),partial=next!==target;
 try{await bounded(bot.pathfinder.goto(partial?new pf.goals.GoalXZ(next.x,next.z):new pf.goals.GoalBlock(target.x,target.y,target.z)),12000);}
 catch(e){if(bot.entity.position.distanceTo(start)<3)throw e;return 'Made progress toward cover; next short segment is available';}
 finally{bot.pathfinder.setGoal(null);}
 const p=bot.entity.position,arrived=partial?Math.hypot(p.x-next.x,p.z-next.z)<3:p.distanceTo(target.offset(.5,0,.5))<1;if(!arrived){if(p.distanceTo(start)<.2)throw Error('Approach stopped without movement');return 'Approach interrupted before the waypoint; moved '+p.distanceTo(start).toFixed(1)+' blocks';}
 return partial?'Reached next approach segment':'Reached cover';
}
export function currentWaypoint(state,plan,route){if(state.travelStarted&&state.dimension==='overworld')return route[state.routeIndex]||{x:1015,y:35,z:-1221};const w=plan?.waypoint;if(!state.travelStarted&&w&&route[0]&&w.x===route[0].x&&w.z===route[0].z)return null;return w;}
