import {supportedBreathMargin,breathEscapeRoutes} from './breath-safety.mjs';
// A travel safety control, like collision avoidance. It uses ordinary movement keys.
export function installBreathReflex(bot,log=()=>{}){let escape=null;const blocked=new Map();
 bot.on('physicsTick',()=>{if(!bot.entity||bot.game.dimension!=='the_end'||bot.health<=0)return;const p=bot.entity.position,clouds=Object.values(bot.entities).filter(e=>e.name==='area_effect_cloud'),margin=supportedBreathMargin(bot,p,clouds);
 if(!escape&&margin<2){const route=breathEscapeRoutes(bot,p,clouds).find(r=>(blocked.get(r.dx+","+r.dz)||0)<Date.now());if(!route)return;escape={...route,start:p.clone(),at:Date.now(),last:p.clone(),lastProgress:Date.now()};bot.breathReflexActive=true;bot.pathfinder.setGoal(null);bot.stopDigging();bot.deactivateItem();log('breath_reflex_start',{position:p,route,health:bot.health});}
 if(!escape)return;const moved=Math.hypot(p.x-escape.start.x,p.z-escape.start.z);
 if(p.distanceTo(escape.last)>.3){escape.last=p.clone();escape.lastProgress=Date.now();}const stalled=Date.now()-escape.lastProgress>900;if(stalled)blocked.set(escape.dx+','+escape.dz,Date.now()+6000);
 if(stalled||margin>4&&moved>4||moved>escape.length-.5||Date.now()-escape.at>4500){log('breath_reflex_end',{position:p,health:bot.health,margin,moved});escape=null;bot.breathReflexActive=false;bot.clearControlStates();return;}
 bot.steerWalk({dx:escape.dx,dz:escape.dz,path:[p.offset(escape.dx*8,0,escape.dz*8)]});bot.setControlState('forward',true);bot.setControlState('sprint',true);bot.setControlState('jump',true);
 });
}
