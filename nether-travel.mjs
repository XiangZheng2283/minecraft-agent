import {tunnelTool} from './mining-tools.mjs';
import {droppedItem} from './item-observation.mjs';
import {coveredDescent,coveredWalk} from './covered-shaft.mjs';
import {Vec3} from 'vec3';
import {climbColumn,descendColumn} from './column-travel.mjs';
import {tunnelStep} from './tunnel-travel.mjs';
const v=(x,y,z)=>new Vec3(x,y,z);
const routes={
 entry_bastion:[['walk',v(34,49,13)],['up',v(34,118,13)],['tunnel',v(34,118,43)],['tunnel',v(-118,118,43)],['covered',v(-118,85,43)]],
 bastion_fortress:[['walk',v(-118,85,43)],['up',v(-118,118,43)],['tunnel',v(48,118,43)],['tunnel',v(48,118,-104)],['covered',v(48,77,-104)]],
 fortress_bastion:[['walk',v(48,77,-104)],['up',v(48,118,-104)],['tunnel',v(48,118,43)],['tunnel',v(-118,118,43)],['covered',v(-118,85,43)]],
 fortress_entry:[['walk',v(48,77,-104)],['up',v(48,118,-104)],['tunnel',v(48,118,-63)],['tunnel',v(34,118,-63)],['tunnel',v(34,118,13)],['down',v(34,49,13)]]
};
export function travelActions(bot,add,travel,goal,{go,mine,log}){
 if(travel.region===goal&&!travel.leg){bot.netherTransit=false;return false;}
 if(!travel.leg){travel.leg=travel.region+'_'+goal;travel.index=0;}
 if(travel.leg==='entry_bastion'&&travel.index<=1){
  const p=bot.entity.position,blocks=bot.inventory.items().filter(i=>['cobblestone','dirt','netherrack','blackstone','polished_blackstone_bricks'].includes(i.name)).reduce((n,i)=>n+(i.name==='cobblestone'?Math.max(0,i.count-48):i.count),0);
  if(p.y<118&&blocks<118-p.y+12)travel.gatherBlocks=true;
  if(travel.gatherBlocks){
   if(p.y>49.1){add('route_material_return','Descend the checked entry column to collect more building blocks',()=>descendColumn(bot,49,log));return true;}
   if(blocks<100){const q=bot.findBlocks({matching:bot.registry.blocksByName.netherrack.id,maxDistance:16,count:80}).filter(q=>q.y>=Math.floor(p.y)&&q.y<=Math.floor(p.y)+2).sort((a,b)=>a.distanceTo(p)-b.distanceTo(p))[0];if(q)add('route_material_mine','Collect up to eight nearby netherrack blocks for the 69-block entry climb; carry at least 100 building blocks',async()=>{
    bot.pathfinder.setGoal(null);bot.clearControlStates();let mined=0;
    for(let n=0;n<8;n++){
     const p=bot.entity.position,eye=p.offset(0,1.62,0);
     const target=bot.findBlocks({matching:bot.registry.blocksByName.netherrack.id,maxDistance:4,count:100}).filter(q=>q.y>=Math.floor(p.y)&&q.y<=Math.floor(p.y)+1&&q.offset(.5,.5,.5).distanceTo(eye)<4&&![[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(d=>['lava','water'].includes(bot.blockAt(q.offset(...d))?.name))).sort((a,b)=>a.distanceTo(p)-b.distanceTo(p))[0];
     if(!target)break;const block=bot.blockAt(target),tool=tunnelTool(bot,block);if(!tool)throw Error('No tool for route material');await bot.equip(tool,'hand');await bot.dig(block,true);await bot.waitForTicks(2);mined++;
    }
    if(!mined)return mine(q);
    const drop=Object.values(bot.entities).filter(e=>e.name==='item'&&droppedItem(e)?.name==='netherrack'&&e.position.distanceTo(bot.entity.position)<5).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position))[0];if(drop)await go(drop.position,.6,6000);await bot.waitForTicks(4);log('route_material_batch',{mined});return 'Mined '+mined+' route blocks and approached their drops';
   });return true;}
   travel.gatherBlocks=false;travel.index=0;
  }
 }
 if(travel.region==='fortress'&&travel.index===0){
  if(bot.columnLavaBlocked){const p=bot.entity.position.floored();if(p.x!==48||p.z!==-104){add('fortress_lava_detour','Move through cover at the current height to the known entry shaft before climbing past the lava pocket',()=>coveredWalk(bot,v(48,p.y,-104),log));return true;}bot.columnLavaBlocked=false;}
  if(bot.entity.position.y<117.9){add('fortress_safe_ascent','Climb from the current solid fortress floor to the checked roof route',()=>climbColumn(bot,118,log));return true;}
  travel.index=2;
 }
 const points=routes[travel.leg];if(!points)throw Error('Unknown checked Nether route '+travel.leg);
 while(travel.index<points.length){const [,q]=points[travel.index],p=bot.entity.position;if(p.floored().equals(q)&&p.distanceTo(q.offset(.5,0,.5))<.65)travel.index++;else break;}
 if(travel.index===points.length){travel.region=goal;travel.leg=null;travel.index=0;bot.netherTransit=false;log('nether_route_arrived',{region:goal});return false;}
 bot.netherTransit=true;const [mode,q]=points[travel.index];add('nether_route_'+travel.leg+'_'+travel.index,'Follow checked '+mode+' route toward '+goal+' at '+q+'; keep the floor solid before each move',async()=>{if(mode==='walk')return go(q,0,10000);if(mode==='covered'){const cell=bot.entity.position.floored();if(cell.x!==q.x||cell.z!==q.z)return coveredWalk(bot,v(q.x,cell.y,q.z),log);return coveredDescent(bot,q.y,log);}const p=bot.entity.position.floored();if(mode!=='down'&&(mode==='tunnel'||p.x===q.x&&p.z===q.z)&&p.y!==q.y)return p.y>q.y?descendColumn(bot,q.y,log):climbColumn(bot,q.y,log);if(mode==='up')return climbColumn(bot,q.y,log);if(mode==='down'){bot.allowColumnFill=true;try{return await descendColumn(bot,q.y,log);}finally{bot.allowColumnFill=false;}}bot.checkedStairs=mode==='stairs';try{return await tunnelStep(bot,q,log);}finally{bot.checkedStairs=false;}});return true;
}
