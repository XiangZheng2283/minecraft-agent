import {Vec3} from 'vec3';
const bounds=f=>({x0:f.x,x1:f.x+4,z0:f.z-2,z1:f.z+2,y:f.y-1});
const outside=(p,b)=>Math.max(0,b.x0-p.x,p.x-b.x1)+Math.max(0,b.z0-p.z,p.z-b.z1);
export function fortressStepCost(bot,block,fortress){
 if(!bot.fortressCombatActive||bot.game.dimension!=='the_nether')return 0;
 const b=bounds(fortress),q=block.position,p=bot.entity.position.floored();
 return q.y<b.y||q.y>b.y+1||outside(q,b)>outside(p,b)?100:0;
}
export function fortressApproachPoint(bot,entity,fortress,reach=2.8){
 if(!fortress)return null;const b=bounds(fortress),points=[];
 for(let x=b.x0;x<=b.x1;x++)for(let z=b.z0;z<=b.z1;z++){
  const q=new Vec3(x,b.y,z),feet=bot.blockAt(q),head=bot.blockAt(q.offset(0,1,0)),floor=bot.blockAt(q.offset(0,-1,0));
  if(feet?.boundingBox!=='empty'||head?.boundingBox!=='empty'||floor?.boundingBox!=='block'||['lava','fire','water'].includes(feet.name))continue;
  if(q.offset(.5,0,.5).distanceTo(entity.position)<=reach)points.push(q);
 }
 points.sort((a,b)=>a.offset(.5,0,.5).distanceTo(bot.entity.position)-b.offset(.5,0,.5).distanceTo(bot.entity.position));return points[0]||null;
}
