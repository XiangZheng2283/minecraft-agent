import {Vec3} from 'vec3';
export function terrainObservation(bot){
 if(!bot.entity||bot.game.dimension!=='overworld')return null;
 const p=bot.entity.position;const samples=[];
 for(const radius of [8,24,48])for(let i=0;i<8;i++){
  const x=Math.round(p.x+Math.cos(i*Math.PI/4)*radius),z=Math.round(p.z+Math.sin(i*Math.PI/4)*radius);
  for(let y=Math.min(120,Math.max(90,Math.floor(p.y)+12));y>=45;y--){const b=bot.blockAt(new Vec3(x,y,z));if(!b)break;if(b.name==='water'||b.boundingBox==='block'&&!b.name.includes('leaves')&&!b.name.includes('log')){samples.push({x,y:y+1,z,block:b.name,water:b.name==='water',distance:Math.round(p.distanceTo(new Vec3(x,y+1,z)))});break;}}
 }
 return {underfoot:bot.blockAt(p.offset(0,-.1,0))?.name,samples,dryLand:samples.filter(s=>!s.water).sort((a,b)=>a.distance-b.distance).slice(0,5)};
}
