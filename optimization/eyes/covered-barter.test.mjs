import test from 'node:test';import assert from 'node:assert/strict';import {Vec3} from 'vec3';import {approachBarter} from '../../covered-barter.mjs';
test('A reachable piglin can trade without placing a wall through its body',async()=>{
 let cleared=0;const bot={entity:{position:new Vec3(-129.5,91,38.5)},inventory:{items:()=>[{name:'netherrack',count:32}]},blockAt:q=>({name:q.y<91?'netherrack':'air',boundingBox:q.y<91?'block':'empty',diggable:false}),setControlState(){},async waitForTicks(){},clearControlStates:()=>cleared++};
 const ready=await approachBarter(bot,{position:new Vec3(-130.5,90,39.5)});
 assert.equal(ready,true);assert.ok(cleared>0);
});

test('Short normal pickup requires gold armor and no nearby hostile mob',async()=>{const {safeNearbyPickup}=await import('../../covered-barter.mjs');const bot={world:{raycast:()=>null},entity:{position:new Vec3(0,84,0)},inventory:{slots:{6:{name:'golden_chestplate'}}},entities:{}},drop={position:new Vec3(2,83,0)};assert.equal(safeNearbyPickup(bot,drop),true);bot.entities[1]={name:'piglin_brute',position:new Vec3(12,83,0),metadata:{8:50}};assert.equal(safeNearbyPickup(bot,drop),false);bot.entities={};bot.inventory.slots={};assert.equal(safeNearbyPickup(bot,drop),false);});

test('A brute on a distant lower floor does not block a short pickup, but a flying blaze does',async()=>{const {safeNearbyPickup}=await import('../../covered-barter.mjs');const bot={world:{raycast:()=>null},entity:{position:new Vec3(0,88,0)},inventory:{slots:{6:{name:'golden_chestplate'}}},entities:{1:{name:'piglin_brute',position:new Vec3(0,69,0),metadata:{8:50}}}},drop={position:new Vec3(2,90.5,1)};assert.equal(safeNearbyPickup(bot,drop),true);bot.entities[1].name='blaze';assert.equal(safeNearbyPickup(bot,drop),false);});

test('A wall-separated brute does not block a short pickup, but an exposed brute does',async()=>{const {safeNearbyPickup}=await import('../../covered-barter.mjs');let wall=true;const bot={world:{raycast:()=>wall?{}:null},entity:{position:new Vec3(0,71,0)},inventory:{slots:{6:{name:'golden_chestplate'}}},entities:{1:{name:'piglin_brute',position:new Vec3(14,71,0),metadata:{8:50}}}},drop={position:new Vec3(2,71,0)};assert.equal(safeNearbyPickup(bot,drop),true);wall=false;assert.equal(safeNearbyPickup(bot,drop),false);});
