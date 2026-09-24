import {centerColumn} from './column-travel.mjs';
import fs from 'node:fs';import {Vec3} from 'vec3';
export const route=JSON.parse(fs.readFileSync(process.env.ROUTE_CONFIG||'optimization/nether/config.json'));
export const vec=q=>new Vec3(q.x,q.y,q.z);
export const bedCount=i=>Object.entries(i).filter(([n])=>n.endsWith('_bed')).reduce((s,[,n])=>s+n,0);
export const navigationMaterials=['cobblestone','dirt','netherrack','mossy_cobblestone','stone_bricks','mossy_stone_bricks','basalt','diorite'];
export const navigationCount=i=>navigationMaterials.reduce((n,k)=>n+(i[k]||0),0);
export function kitNeeds(i){if(route.requiresEyes)return {crafting_table:i.crafting_table?0:1,beds:Math.max(0,8-bedCount(i)),pickaxe:i.iron_pickaxe?0:1,weapon:i.stone_sword||i.iron_sword?0:1,shield:i.shield?0:1,flint_and_steel:i.flint_and_steel||i.fire_charge?0:1,obsidian:Math.max(0,route.obsidianNeeded-(i.obsidian||0)),food:Math.max(0,8-(i.bread||0)-(i.golden_carrot||0)),navigationBlocks:Math.max(0,32-(i.cobblestone||0)-(i.dirt||0))};return {beds:Math.max(0,8-bedCount(i)),pickaxe:i.iron_pickaxe||i.stone_pickaxe?0:1,flint_and_steel:i.flint_and_steel?0:1,obsidian:Math.max(0,(route.kit?.obsidian||18)-(i.obsidian||0)),navigationBlocks:Math.max(0,(route.kit?.navigationBlocks||32)-navigationCount(i))};}
export function fullFrame(spec){const o=vec(spec),v=spec.axis==='x'?new Vec3(1,0,0):new Vec3(0,0,1),out=[];for(let y=0;y<=4;y++)for(let x=0;x<=3;x++)if(y===0||y===4||x===0||x===3)out.push(o.plus(v.scaled(x)).offset(0,y,0));return out;}
export function essentialFrame(spec){return fullFrame(spec).filter(p=>{const d=p.minus(vec(spec)),x=spec.axis==='x'?d.x:d.z;return !((d.y===0||d.y===4)&&(x===0||x===3));});}
export function portalInterior(spec){return vec(spec).offset(spec.axis==='x'?1:0,1,spec.axis==='z'?1:0);}
export function solid(b){return b?.boundingBox==='block';}
export async function placeAt(bot,p,name,go){
 if(bot.blockAt(p)?.name===name)return;
 const target=bot.blockAt(p);if(!target)throw Error('Placement chunk not loaded');
 if(!['air','cave_air','fire','grass','tall_grass','vine'].includes(target.name))throw Error('Placement blocked by '+target.name+' at '+p);
 const faces=[new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)];
 const refs=faces.map(face=>({face,ref:bot.blockAt(p.minus(face))})).filter(q=>solid(q.ref));if(!refs.length)throw Error('No support at '+p);
 const eye=()=>bot.entity.position.offset(0,1.62,0);if(p.offset(.5,.5,.5).distanceTo(eye())>4.4)await go(p,3,10000);
 const overlaps=()=>Math.abs(bot.entity.position.x-(p.x+.5))<.8&&Math.abs(bot.entity.position.z-(p.z+.5))<.8&&p.y>=bot.entity.position.y&&p.y<bot.entity.position.y+1.8;
 if(overlaps())await centerColumn(bot);
 if(overlaps()){
  const base=bot.entity.position.floored(),candidates=[];
  for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++){const q=base.offset(dx,0,dz),at=q.offset(.5,0,.5);if(Math.abs(at.x-p.x-.5)<.8&&Math.abs(at.z-p.z-.5)<.8)continue;if(at.offset(0,1.62,0).distanceTo(p.offset(.5,.5,.5))>4.4)continue;if(solid(bot.blockAt(q.offset(0,-1,0)))&&['air','cave_air'].includes(bot.blockAt(q)?.name)&&['air','cave_air'].includes(bot.blockAt(q.offset(0,1,0))?.name))candidates.push(q);}
  candidates.sort((a,b)=>a.distanceTo(bot.entity.position)-b.distanceTo(bot.entity.position));
  if(!candidates.length)throw Error('No clear standing position for placement');await go(candidates[0],0,8000);
 }
 if(overlaps())throw Error('Player still occupies placement site');
 const it=bot.inventory.items().find(i=>i.name===name);if(!it)throw Error('Missing '+name);bot.pathfinder.setGoal(null);bot.clearControlStates();await bot.equip(it,'hand');await bot.placeBlock(refs[0].ref,refs[0].face);await bot.waitForTicks(2);if(bot.blockAt(p)?.name!==name)throw Error('Placement not confirmed');
}
export function portalActions(bot,add,spec,{go,bounded,item,segment},prefix){
 const frame=fullFrame(spec),p=bot.entity.position,inside=portalInterior(spec);
 if(p.distanceTo(inside)>5){add(prefix+'_approach','Walk to the surveyed '+prefix+' portal site '+inside,()=>segment&&Math.hypot(p.x-inside.x,p.z-inside.z)>28?segment(inside):go(inside,3,15000));return;}
 const essential=essentialFrame(spec);const material=q=>!essential.some(e=>e.equals(q))?(navigationMaterials.find(n=>item(n))||'cobblestone'):'obsidian';const missing=frame.filter(q=>material(q)!=='obsidian'?!solid(bot.blockAt(q)):bot.blockAt(q)?.name!=='obsidian');
 for(const q of missing){const b=bot.blockAt(q);if(!b)continue;if(b.name==='crying_obsidian'){add(prefix+'_remove_crying','Mine the crying obsidian at '+q+'; it cannot activate a portal',async()=>{await go(q,3);bot.pathfinder.setGoal(null);await bot.equip(item('iron_pickaxe'),'hand');await bot.dig(bot.blockAt(q),true);});return;}
 if(solid(b)){add(prefix+'_clear_'+q,'Clear '+b.name+' from portal frame at '+q,async()=>{await go(q,3);bot.pathfinder.setGoal(null);const target=bot.blockAt(q),tool=bot.pathfinder.bestHarvestTool(target);if(tool)await bot.equip(tool,'hand');await bot.dig(target,true);});return;}
 const faces=[new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)];if(faces.some(f=>solid(bot.blockAt(q.minus(f))))){add(prefix+'_place_'+q,'Place one '+material(q)+' portal frame block at '+q,()=>placeAt(bot,q,material(q),go));if(prefix==='entry')break;}
 }
 if(missing.length)return;
 for(let y=0;y<3;y++)for(let u=0;u<2;u++){const q=inside.offset(spec.axis==='x'?u:0,y,spec.axis==='z'?u:0),b=bot.blockAt(q);if(b&&!['air','cave_air','nether_portal','fire'].includes(b.name)){add(prefix+'_clear_inside_'+q,'Clear '+b.name+' inside the portal frame at '+q,async()=>{await go(q,3);bot.pathfinder.setGoal(null);const pick=item('iron_pickaxe')||item('stone_pickaxe');if(pick)await bot.equip(pick,'hand');await bot.dig(bot.blockAt(q),true);});return;}}
 if(bot.blockAt(inside)?.name!=='nether_portal'){add(prefix+'_ignite','Use flint and steel to light the completed portal',async()=>{const base=bot.blockAt(inside.offset(0,-1,0));await bot.equip(item('flint_and_steel')||item('fire_charge'),'hand');await bot.activateBlock(base,new Vec3(0,1,0),new Vec3(.5,1,.5));await bot.waitForTicks(5);if(bot.blockAt(inside)?.name!=='nether_portal')throw Error('Portal ignition failed');});return;}
 add(prefix+'_enter','Walk into the active portal and wait for the dimension change',async()=>{const d=bot.game.dimension;await go(inside,0,10000);bot.pathfinder.setGoal(null);bot.clearControlStates();for(let n=0;n<140&&bot.game.dimension===d;n++)await bot.waitForTicks(1);if(bot.game.dimension===d)throw Error('Portal did not transfer player');return 'Changed dimension to '+bot.game.dimension;});
}
