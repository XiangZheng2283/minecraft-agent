import {Vec3} from 'vec3';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
// Water-only client prediction. Vanilla 1.16 uses .9 horizontal drag and .04
// forward acceleration. Speed is capped below the vanilla .4 blocks/tick.
export function installBoat(bot){
 let target=null,velocity=new Vec3(0,0,0),turn=0,blocked=false,timer,predicted=null,predictedYaw=0;
 function clear(q){for(let x=Math.floor(q.x-.69);x<=Math.floor(q.x+.69);x++)for(let z=Math.floor(q.z-.69);z<=Math.floor(q.z+.69);z++)for(let y=Math.floor(q.y);y<=Math.floor(q.y+.57);y++){const b=bot.blockAt(new Vec3(x,y,z));if(!b||b.boundingBox==='block')return false;}return true;}
 function surface(q){for(let y=Math.floor(q.y)+1;y>=Math.floor(q.y)-1;y--){const b=bot.blockAt(new Vec3(Math.floor(q.x),y,Math.floor(q.z)));if(b?.name==='water'&&b.getProperties().level===0)return y+1;}return null;}
 function tick(){
  const boat=bot.vehicle;if(!boat||boat.name!=='boat')return;
  const old=bot.entity.position.clone(),p=predicted.clone(),water=surface(p);if(water===null){blocked=true;velocity.scale(0);return;}
  let yaw=predictedYaw,forward=false,left=false,right=false;
  if(target){const desired=Math.atan2(-(target.x-p.x),target.z-p.z),difference=angle(desired-yaw);left=difference<-.04;right=difference>.04;forward=Math.abs(difference)<.55&&Math.hypot(target.x-p.x,target.z-p.z)>2;}
  turn=turn*.9+(left?-1:0)+(right?1:0);yaw+=turn*Math.PI/180;
  velocity.x*=.9;velocity.z*=.9;let thrust=forward?.04:(left!==right?.005:0);velocity.x-=Math.sin(yaw)*thrust;velocity.z+=Math.cos(yaw)*thrust;
  const speed=Math.hypot(velocity.x,velocity.z);if(speed>.30){velocity.x*=.30/speed;velocity.z*=.30/speed;}
  velocity.y-=.04;const buoyancy=Math.max(0,(water-p.y)/.5625);if(buoyancy>0)velocity.y=(velocity.y+buoyancy*.06153846016296973)*.75;
  const next=p.plus(velocity);if(!clear(next)||surface(next)===null){velocity.x=0;velocity.z=0;next.x=p.x;next.z=p.z;blocked=forward;}
  if(!clear(next)){velocity.y=0;next.y=p.y;}
  predicted=next.clone();predictedYaw=yaw;boat.position.set(next.x,next.y,next.z);boat.yaw=Math.PI-yaw;bot.entity.position.set(next.x,next.y-.45,next.z);bot.entity.yaw=boat.yaw;bot.entity.pitch=0;bot.entity.velocity.set(0,0,0);
  bot._client.write('steer_boat',{leftPaddle:forward||right,rightPaddle:forward||left});
  bot._client.write('vehicle_move',{x:next.x,y:next.y,z:next.z,yaw:yaw*180/Math.PI,pitch:0});bot.emit('move',old);
 }
 bot.on('mount',()=>{if(bot.vehicle?.name==='boat'){bot.pathfinder?.setGoal(null);bot.clearControlStates();bot.physicsEnabled=false;clearInterval(timer);predicted=bot.vehicle.position.clone();predictedYaw=Math.PI-(bot.vehicle.yaw||0);velocity=new Vec3(0,0,0);turn=0;timer=setInterval(tick,50);}});
 bot._client.on('set_passengers',({entityId,passengers})=>{if(bot.vehicle?.id===entityId&&!passengers.includes(bot.entity.id)){const old=bot.vehicle;bot.vehicle=null;bot.entity.vehicle=null;bot.emit('dismount',old);}});
 bot._client.on('vehicle_move',p=>{if(bot.vehicle){predicted=new Vec3(p.x,p.y,p.z);predictedYaw=p.yaw*Math.PI/180;velocity=new Vec3(0,0,0);}});
 bot.on('dismount',()=>{clearInterval(timer);target=null;bot.physicsEnabled=true;});bot.on('end',()=>clearInterval(timer));
 function placementSite(waypoint){
  const p=bot.entity.position,w=waypoint||{x:1015,z:-1221},dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz)||1;
  const sites=bot.findBlocks({matching:b=>b.name==='water'&&b.getProperties().level===0,maxDistance:4,count:100}).filter(q=>Math.hypot(q.x+.5-p.x,q.z+.5-p.z)>2&&bot.blockAt(q.offset(0,1,0))?.name==='air'&&clear(q.offset(.5,.7,.5))).filter(q=>{const eye=p.offset(0,1.62,0),target=q.offset(.5,.99,.5),v=target.minus(eye),length=v.norm();if(length>4.5)return false;for(let t=.1;t<length-.15;t+=.1){const b=bot.blockAt(eye.plus(v.scaled(t/length)));if(!b||b.boundingBox==='block')return false;}return true;});
  return sites.map(q=>{let best=0;for(const a of [0,-Math.PI/3,Math.PI/3]){const ux=dx/d*Math.cos(a)-dz/d*Math.sin(a),uz=dx/d*Math.sin(a)+dz/d*Math.cos(a);let length=0;for(let n=1;n<=10;n++){const b=bot.blockAt(new Vec3(Math.floor(q.x+.5+ux*n),q.y,Math.floor(q.z+.5+uz*n)));if(b?.name!=='water'||bot.blockAt(b.position.offset(0,1,0))?.boundingBox==='block')break;length=n;}best=Math.max(best,length);}return {q,score:best};}).filter(s=>s.score>=6).sort((a,b)=>b.score-a.score||a.q.distanceTo(p)-b.q.distanceTo(p))[0]?.q;
 }
 function routes(waypoint){
  const p=bot.vehicle?.position||bot.entity.position,w=waypoint||{x:1015,z:-1221},dx=w.x-p.x,dz=w.z-p.z,d=Math.hypot(dx,dz)||1;
  return [0,-60,60,-120,120,180].map(degrees=>{const a=degrees*Math.PI/180,ux=dx/d*Math.cos(a)-dz/d*Math.sin(a),uz=dx/d*Math.sin(a)+dz/d*Math.cos(a);let distance=0;for(let n=.5;n<=96;n+=.5){const q=p.offset(ux*n,0,uz*n);if(!clear(q)||surface(q)===null)break;distance=n;}return {degrees,distance,target:{x:p.x+ux*Math.min(degrees===0?92:32,distance-1,degrees===0?d:Infinity),z:p.z+uz*Math.min(degrees===0?92:32,distance-1,degrees===0?d:Infinity)}};});
 }
 return {
  routes,placementSite,
  async drive(waypoint,ms=8000){if(!bot.vehicle)throw Error('Not in boat');const start=bot.vehicle.position.clone();target=waypoint;blocked=false;try{for(let t=0;t<ms;t+=100){await sleep(100);if(!bot.vehicle)throw Error('Boat lost');if(blocked)throw Error('Boat reached shore or an obstacle: dismount and continue on land');if(Math.hypot(bot.vehicle.position.x-waypoint.x,bot.vehicle.position.z-waypoint.z)<3)break;}const moved=start.distanceTo(bot.vehicle.position);if(moved<.5&&Math.hypot(bot.vehicle.position.x-waypoint.x,bot.vehicle.position.z-waypoint.z)>3)throw Error('Boat did not move: choose a detour or dismount');return 'Rowed '+moved.toFixed(1)+' blocks';}finally{target=null;}},
  async dismount(){bot.dismount();await sleep(400);if(bot.vehicle)throw Error('Dismount not confirmed');},
  async place(waypoint){const it=bot.inventory.items().find(i=>i.name.endsWith('_boat'));if(!it)throw Error('No boat');const waterPos=placementSite(waypoint);const water=waterPos&&bot.blockAt(waterPos);if(!water)throw Error('No reachable water');await bot.equip(it,'hand');await bot.lookAt(water.position.offset(.5,.99,.5),true);await bot.waitForTicks(3);bot.activateItem();await sleep(800);const boat=Object.values(bot.entities).filter(e=>e.name==='boat'&&e.position.distanceTo(bot.entity.position)<5).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];if(!boat)throw Error('Boat placement not confirmed');bot.mount(boat);await sleep(500);if(!bot.vehicle)throw Error('Boat mount not confirmed');return 'Placed and boarded boat';}
 };
}
