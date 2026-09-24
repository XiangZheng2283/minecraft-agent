// Mouse directions are held over time; turns have speed and acceleration limits.
export const MAX_TURN_DEGREES=45; // Legacy audit limit; not a requested turn size.
export const TURN_STEP_DEGREES=9;
export const MOUSE_RATE=240*Math.PI/180;
export const MOUSE_ACCEL=960*Math.PI/180;
export function angleDelta(a,b){return Math.atan2(Math.sin(a-b),Math.cos(a-b));}
export function turnStep(from,to,maxDegrees=TURN_STEP_DEGREES){const dy=angleDelta(to.yaw,from.yaw),dp=to.pitch-from.pitch,d=Math.hypot(dy,dp),k=Math.min(1,maxDegrees*Math.PI/180/(d||1));return {yaw:from.yaw+dy*k,pitch:from.pitch+dp*k};}
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function mouseAxis(error,velocity,dt){if(Math.abs(error)<.003&&Math.abs(velocity)<.05)return {delta:0,velocity:0};const desired=clamp(error*12,-MOUSE_RATE,MOUSE_RATE),v=velocity+clamp(desired-velocity,-MOUSE_ACCEL*dt,MOUSE_ACCEL*dt);let delta=v*dt;if(Math.sign(delta)===Math.sign(error)&&Math.abs(delta)>Math.abs(error))return {delta:error,velocity:0};return {delta,velocity:v};}
export function walkingKeys(yaw,dx,dz){const n=Math.hypot(dx,dz)||1,f=(-Math.sin(yaw)*dx-Math.cos(yaw)*dz)/n,r=(Math.cos(yaw)*dx-Math.sin(yaw)*dz)/n;return {forward:f>.383,back:f<-.383,right:r>.383,left:r<-.383};}
export function lookAhead(p,path){let q=path[0]||p,total=0,prev=p;for(const n of path){if(n.toBreak?.length||n.toPlace?.length)break;total+=Math.hypot(n.x-prev.x,n.z-prev.z);q=n;prev=n;if(total>=5)break;}return {yaw:Math.atan2(p.x-q.x,p.z-q.z),pitch:0};}
export function endSafeAim(bot,target,before){if(bot.game?.dimension!=='the_end'||bot.game?.difficulty==='peaceful')return target;const turning=Math.abs(angleDelta(target.yaw,before.yaw))>.2;let desired=turning?{yaw:before.pitch>-.6?before.yaw:target.yaw,pitch:-.75}:target;const eye=bot.entity.position?.offset(0,1.62,0);if(eye&&desired.pitch>-.6){const cp=Math.cos(desired.pitch),view={x:-Math.sin(desired.yaw)*cp,y:Math.sin(desired.pitch),z:-Math.cos(desired.yaw)*cp};for(const e of Object.values(bot.entities||{})){if(e.name!=='enderman')continue;const d=e.position.offset(0,2.55,0).minus(eye),distance=Math.hypot(d.x,d.y,d.z);if(distance>64||distance<.1)continue;const dot=(d.x*view.x+d.y*view.y+d.z*view.z)/distance;if(dot>1-.05/distance&&!bot.world?.raycast(eye,d.scaled(1/distance),distance)){desired={yaw:desired.yaw,pitch:-.75};break;}}}return desired;}
export function installCameraControl(bot,log=()=>{}){
 const original=bot.look.bind(bot),control=bot.setControlState.bind(bot);let target=null,resolve=null,walk=null,drive=false,vy=0,vp=0,last=performance.now(),held={x:0,y:0},remainderYaw=0,remainderPitch=0;
 bot.on('forcedMove',()=>{remainderYaw=remainderPitch=0;});
 const settle=()=>{resolve?.();resolve=null;};
 bot.preparePlacementAim=point=>{const d=point.minus(bot.entity.position.offset(0,1.62,0)),h=Math.hypot(d.x,d.z),yaw=h<.03?bot.entity.yaw:Math.atan2(-d.x,-d.z),pitch=Math.atan2(d.y,h);bot.look(yaw,pitch);return Math.hypot(angleDelta(yaw,bot.entity.yaw),pitch-bot.entity.pitch)<.06;};
 const endWalk=()=>{if(walk){for(const key of ['forward','back','left','right','sprint'])control(key,false);}walk=null;drive=false;};
 function movement(){if(!walk)return;const k=drive?walkingKeys(bot.entity.yaw,walk.dx,walk.dz):{forward:false,back:false,left:false,right:false};for(const [key,value] of Object.entries(k))control(key,value);}
 bot.setControlState=(key,value)=>{if(value&&!walk&&target&&['forward','back','left','right'].includes(key)&&Math.abs(angleDelta(target.yaw,bot.entity.yaw))>.08)return control(key,false);if(key==='forward'&&walk&&performance.now()-walk.at<120){drive=value;movement();return;}if(key==='sprint'&&value&&walk){const k=walkingKeys(bot.entity.yaw,walk.dx,walk.dz);value=k.forward&&!k.back;}return control(key,value);};
 bot.steerWalk=({dx,dz,path})=>{settle();walk={dx,dz,at:performance.now()};held={x:0,y:0};target=lookAhead(bot.entity.position,path);if(bot.game?.dimension==='the_end')target.pitch=-.4;};
 bot.look=(yaw,pitch)=>{settle();endWalk();held={x:0,y:0};target={yaw,pitch:clamp(pitch,-Math.PI/2,Math.PI/2)};return new Promise(r=>{resolve=r;});};
 bot.lookAt=async(point)=>{const d=point.minus(bot.entity.position.offset(0,bot.entity.eyeHeight||1.62,0)),h=Math.hypot(d.x,d.z);await bot.look(h<.03?bot.entity.yaw:Math.atan2(-d.x,-d.z),Math.atan2(d.y,h));};
 const mouse={press(direction){settle();endWalk();target=null;held={x:direction==='left'?1:direction==='right'?-1:0,y:direction==='up'?1:direction==='down'?-1:0};log('mouse_input',{direction,state:'pressed'});},release(){held={x:0,y:0};log('mouse_input',{state:'released'});},async hold(direction,ms){this.press(direction);await new Promise(r=>setTimeout(r,ms));this.release();}};bot.mouseControl=mouse;
 const timer=setInterval(()=>{if(!bot.entity)return;const now=performance.now(),dt=Math.min(.05,(now-last)/1000);last=now;const before={yaw:bot.entity.yaw,pitch:bot.entity.pitch};let a,b;if(target){const aim=endSafeAim(bot,target,before);a=mouseAxis(angleDelta(aim.yaw,before.yaw),vy,dt);b=mouseAxis(aim.pitch-before.pitch,vp,dt);}else{const next=(v,h)=>v+clamp(h*MOUSE_RATE-v,-MOUSE_ACCEL*dt,MOUSE_ACCEL*dt);a={velocity:next(vy,held.x)};b={velocity:next(vp,held.y)};a.delta=a.velocity*dt;b.delta=b.velocity*dt;}vy=a.velocity;vp=b.velocity;
  if(Math.abs(a.delta)+Math.abs(b.delta)>.00001){remainderYaw+=a.delta;remainderPitch+=b.delta;original(before.yaw+remainderYaw,clamp(before.pitch+remainderPitch,-Math.PI/2,Math.PI/2),true);remainderYaw-=angleDelta(bot.entity.yaw,before.yaw);remainderPitch-=bot.entity.pitch-before.pitch;log('camera_turn',{degrees:Math.hypot(angleDelta(bot.entity.yaw,before.yaw),bot.entity.pitch-before.pitch)*180/Math.PI,dtMs:dt*1000,mode:walk?'walk-lookahead':'mouse',yaw:bot.entity.yaw,pitch:bot.entity.pitch});}
  if(walk&&now-walk.at<120)movement();
  if(target&&!walk&&Math.hypot(angleDelta(target.yaw,bot.entity.yaw),target.pitch-bot.entity.pitch)<.0045){target=null;vy=vp=0;remainderYaw=remainderPitch=0;settle();}
 },20);
 bot.on('end',()=>{clearInterval(timer);settle();});return {mouse,cancel(){target=null;walk=null;held={x:0,y:0};vy=vp=0;settle();}};
}
