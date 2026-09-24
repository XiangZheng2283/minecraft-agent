// All requested turns use short physical look updates. No forced instant turns.
export const MAX_TURN_DEGREES=45;
export const TURN_STEP_DEGREES=9;
export function angleDelta(a,b){return Math.atan2(Math.sin(a-b),Math.cos(a-b));}
export function turnStep(from,to,maxDegrees=TURN_STEP_DEGREES){const dy=angleDelta(to.yaw,from.yaw),dp=to.pitch-from.pitch,d=Math.hypot(dy,dp),k=Math.min(1,maxDegrees*Math.PI/180/(d||1));return {yaw:from.yaw+dy*k,pitch:from.pitch+dp*k};}
export function installCameraControl(bot,log=()=>{}){
 const original=bot.look.bind(bot),control=bot.setControlState.bind(bot);let target=null,resolve=null,timer=null,forward=false;
 bot.setControlState=(key,value)=>{if(key==='forward'){forward=value;if(value&&target&&Math.abs(angleDelta(target.yaw,bot.entity.yaw))>Math.PI/9)value=false;}return control(key,value);};
 bot.look=(yaw,pitch)=>{if(resolve)resolve();target={yaw,pitch:Math.max(-Math.PI/2,Math.min(Math.PI/2,pitch))};return new Promise(r=>{resolve=r;});};
 timer=setInterval(()=>{if(!target||!bot.entity)return;const before={yaw:bot.entity.yaw,pitch:bot.entity.pitch},next=turnStep(before,target);original(next.yaw,next.pitch,true);if(forward)control('forward',Math.abs(angleDelta(target.yaw,bot.entity.yaw))<=Math.PI/9);const actual=Math.hypot(angleDelta(bot.entity.yaw,before.yaw),bot.entity.pitch-before.pitch)*180/Math.PI;log('camera_turn',{degrees:actual,maxDegrees:MAX_TURN_DEGREES});if(Math.hypot(angleDelta(target.yaw,bot.entity.yaw),target.pitch-bot.entity.pitch)<.004){target=null;resolve?.();resolve=null;}},50);
 bot.on('end',()=>{clearInterval(timer);resolve?.();});return {cancel(){target=null;resolve?.();resolve=null;}};
}
