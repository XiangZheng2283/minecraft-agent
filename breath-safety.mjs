import {Vec3} from 'vec3';
export function breathMargin(p,clouds){return clouds.reduce((m,c)=>Math.min(m,Math.hypot(p.x-c.position.x,p.z-c.position.z)-Number(c.metadata?.[7]||5)-1),Infinity);}
export function breathEscapeRoutes(bot,p,clouds){
 const routes=[];
 for(let i=0;i<16;i++){
  const angle=i*Math.PI/8,dx=Math.cos(angle),dz=Math.sin(angle);let y=Math.floor(p.y),length=0,exposure=0,entersCloud=false,end=p;
  for(let dist=.5;dist<=12;dist+=.5){
   const q=new Vec3(p.x+dx*dist,y,p.z+dz*dist).floored();let floor=null;
   for(const dy of [0,1,-1,-2]){const feet=q.offset(0,dy,0),below=bot.blockAt(feet.offset(0,-1,0));if(below?.boundingBox==='block'&&bot.blockAt(feet)?.boundingBox==='empty'&&bot.blockAt(feet.offset(0,1,0))?.boundingBox==='empty'){floor=feet;break;}}
   if(!floor)break;const height=floor.y;let clear=true;for(const ox of [-.31,.31])for(const oz of [-.31,.31])for(const oy of [.05,1.65]){const b=bot.blockAt(new Vec3(p.x+dx*dist+ox,height+oy,p.z+dz*dist+oz));if(!b||b.boundingBox==='block')clear=false;}if(!clear||height-Math.floor(p.y)>Math.ceil(dist))break;y=floor.y;end=new Vec3(p.x+dx*dist,y,p.z+dz*dist);length=dist;
   const margin=breathMargin(end,clouds);exposure+=Math.max(0,1-margin)*.5;
   for(const c of clouds)if(breathMargin(p,[c])>0&&breathMargin(end,[c])<0)entersCloud=true;
  }
  if((length>=4||length>=1.5&&breathMargin(end,clouds)>breathMargin(p,clouds)+1)&&!entersCloud)routes.push({dx,dz,length,exposure,margin:breathMargin(end,clouds),end});
 }
 // Prefer paths that exit all clouds, then the least time in breath.
 return routes.sort((a,b)=>(b.margin>2)-(a.margin>2)||a.exposure-b.exposure||b.margin-a.margin);
}
// Unknown blocks cannot be used as steps. Keep a buffer around existing clouds.
export function breathStepCost(block,clouds,bot){if(!block?.position)return 100;const p=block.position.offset(.5,0,.5);return (bot?supportedBreathMargin(bot,p,clouds):breathMargin(p,clouds))<3?100:0;}
// Vanilla AreaEffectCloud uses its 0.5-block-high bounding box for victims.
// Only use vertical clearance on a verified floor, never during a jump.
export function supportedBreathMargin(bot,p,clouds){
 const same=bot.entity?.position&&p.distanceTo(bot.entity.position)<.1;
 if(same&&bot.entity.onGround===false)return breathMargin(p,clouds);
 const q=p.offset(0,-.05,0).floored(),b=bot.blockAt(q),top=q.y+(b?.shapes?.length?Math.max(...b.shapes.map(s=>s[4])):1);
 if(b?.boundingBox!=='block'||Math.abs(p.y-top)>.12)return breathMargin(p,clouds);
 return breathMargin(p,clouds.filter(c=>p.y<c.position.y+.65&&p.y+1.8>c.position.y-.05));
}
