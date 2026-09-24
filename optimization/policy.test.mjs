import {test} from 'node:test';import assert from 'node:assert/strict';import {planTrigger,reachedWaypoint,selectUsefulOptions,failureCooldown,craftNeeded,stageFor,woodNeeded} from './policy.mjs';
test('a reached waypoint does not offer repeated zero-distance travel',()=>{const p={x:10,y:63,z:10};assert.ok(reachedWaypoint(p,{x:10,y:80,z:10}));assert.deepEqual(selectUsefulOptions([{key:'row_boat'},{key:'wait'}],{arrived:true}),[{key:'wait'}]);});
test('portal waypoint requires vertical arrival',()=>assert.equal(reachedWaypoint({x:1015,y:63,z:-1221},{x:1015,y:35,z:-1221}),false));
test('breath removes unsafe waiting and combat options',()=>assert.deepEqual(selectUsefulOptions([{key:'wait'},{key:'one_timed_bed'},{key:'escape_-12_0'}],{unsafe:true}),[{key:'escape_-12_0'}]));
test('successful steps do not trigger planner calls',()=>assert.equal(planTrigger({plan:{},dimension:'overworld',previousDimension:'overworld',errors:0,arrived:false,now:40000,lastPlanAt:0,stage:'travel',previousStage:'travel'}),null));
test('new milestone triggers review',()=>assert.equal(planTrigger({plan:{},dimension:'overworld',previousDimension:'overworld',errors:0,arrived:false,now:40000,lastPlanAt:0,stage:'travel',previousStage:'prepare'}),'inventory milestone changed'));
test('navigation failure does not disable all movement for a minute',()=>assert.equal(failureCooldown('waypoint','overworld'),3000));

test('completed stone tools do not offer another wooden pick',()=>assert.equal(craftNeeded('wooden_pickaxe',{stone_pickaxe:1}),false));
test('a placed table satisfies the crafting requirement',()=>assert.equal(craftNeeded('crafting_table',{oak_planks:4},true),false));
test('stick crafting stops at the remaining tool requirement',()=>{assert.equal(craftNeeded('stick',{stone_pickaxe:1,stick:2}),false);assert.equal(craftNeeded('stick',{wooden_pickaxe:1,stick:2}),true);});
test('a plan with no useful actions receives a prompt review',()=>assert.equal(planTrigger({plan:{},dimension:'overworld',previousDimension:'overworld',errors:0,arrived:false,now:6000,lastPlanAt:0,stage:'travel',previousStage:'travel',noUseful:true}),'no useful actions'));

test('using navigation blocks does not undo a completed preparation milestone',()=>assert.equal(stageFor({travelStarted:true,dimension:'overworld',position:{x:204,z:140},inventory:{dirt:3}}),'travel'));
test('completed tools and boat do not require extra wood or a portable table',()=>assert.equal(woodNeeded({stone_pickaxe:1,stone_axe:1,oak_boat:1}),0));
