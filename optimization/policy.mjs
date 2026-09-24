export function reachedWaypoint(p,w,dimension='overworld'){
 if(!p||!w)return false;const horizontal=Math.hypot(p.x-w.x,p.z-w.z);
 return horizontal<3&&(dimension==='overworld'&&w.y>=60||Math.abs(p.y-w.y)<3);
}
export function failureCooldown(key,dimension){
 if(dimension==='the_end')return 1500;
 if(/^(waypoint|detour_|swim_|row_|recover_boat|place_boat|place_table|enter_portal|portal_descent)/.test(key))return 3000;
 return 12000;
}
export function planTrigger({plan,dimension,previousDimension,errors,arrived,now,lastPlanAt,stage,previousStage,noUseful=false}){
 if(!plan)return 'initial';
 if(noUseful&&now-lastPlanAt>5000)return 'no useful actions';
 if(dimension!==previousDimension)return 'dimension changed';
 if(stage!==previousStage)return 'inventory milestone changed';
 if(errors>=2&&now-lastPlanAt>8000)return 'repeated failure';
 if(arrived&&now-lastPlanAt>5000)return 'waypoint reached';
 if(now-lastPlanAt>120000)return 'periodic review';
 return null;
}
export function stageFor(state){
 if(state.won)return 'complete';if(state.dragonKilled)return 'exit';
 if(state.dimension==='the_end')return 'combat';if(state.travelStarted)return 'travel';
 const i=state.inventory||{},beds=Object.entries(i).filter(([n])=>n.endsWith('_bed')).reduce((n,[,c])=>n+c,0),blocks=(i.cobblestone||0)+(i.dirt||0);
 if(beds>=8&&i.stone_pickaxe&&i.stone_axe&&(i.obsidian||0)>=12&&blocks>=12&&(i.oak_boat||state.vehicle?.name==='boat'))return 'travel';
 // Once outside the village, the existing journey continues even after placing a boat or blocks.
 if(state.position&&Math.hypot(state.position.x-205,state.position.z-195)>180&&beds>=6)return 'travel';
 return 'prepare';
}
export function selectUsefulOptions(options,{unsafe=false,arrived=false}={}){
 if(unsafe){const escape=options.filter(o=>o.key.startsWith('escape_'));if(escape.length)return escape;}
 if(arrived)options=options.filter(o=>!['waypoint','row_boat'].includes(o.key));
 const useful=options.filter(o=>!['wait','wait_dragon'].includes(o.key));
 return useful.length?useful:options;
}

export function preparationNeeds(i,travelling=false,needBoat=true){
 const beds=Object.entries(i).filter(([n])=>n.endsWith('_bed')).reduce((n,[,c])=>n+c,0);
 return {beds:Math.max(0,8-beds),stone_pickaxe:i.stone_pickaxe?0:1,stone_axe:i.stone_axe?0:1,oak_boat:i.oak_boat||!needBoat?0:1,obsidian:Math.max(0,12-(i.obsidian||0)),navigationBlocks:Math.max(0,(travelling?4:12)-(i.dirt||0)-(i.cobblestone||0)),cobblestoneForTools:Math.max(0,(i.stone_pickaxe?0:3)+(i.stone_axe?0:3)-(i.cobblestone||0))};
}
export function woodNeeded(i){
 if(i.stone_pickaxe&&i.stone_axe&&i.oak_boat)return 0;
 const logs=Object.entries(i).filter(([n])=>n.endsWith('_log')).reduce((a,[,v])=>a+4*v,0),planks=Object.entries(i).filter(([n])=>n.endsWith('_planks')).reduce((a,[,v])=>a+v,0);
 const toolSticks=(i.stone_pickaxe?0:2)+(i.stone_axe?0:2)+(!i.wooden_pickaxe&&!i.stone_pickaxe?2:0);
 const required=(i.oak_boat?0:5)+(i.crafting_table?0:4)+(!i.wooden_pickaxe&&!i.stone_pickaxe?3:0)+Math.ceil(Math.max(0,toolSticks-(i.stick||0))/4)*2;
 return Math.max(0,required-logs-planks);
}

export function craftNeeded(name,i,nearTable=false){
 if(name==='wooden_pickaxe')return !i.wooden_pickaxe&&!i.stone_pickaxe;
 if(name==='crafting_table')return !i.crafting_table&&!nearTable&&(!i.stone_pickaxe||!i.stone_axe||!i.oak_boat);
 if(name==='stick')return (i.stick||0)<(i.stone_pickaxe?0:2)+(i.stone_axe?0:2)+(!i.wooden_pickaxe&&!i.stone_pickaxe?2:0);
 if(name.endsWith('_planks'))return woodNeeded({...i,...(nearTable?{crafting_table:1}:{})})>0||Object.entries(i).some(([n,c])=>n.endsWith('_log')&&c>0)&&(!i.oak_boat||!i.stone_pickaxe||!i.stone_axe);
 return !i[name];
}
