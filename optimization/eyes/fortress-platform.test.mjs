import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Vec3} from 'vec3';
import {fortressApproachPoint,fortressStepCost} from '../../fortress-platform.mjs';
const terrain=new Map(JSON.parse(fs.readFileSync(new URL('./fortress-fresh-blocks.json',import.meta.url))).map(b=>[[b.x,b.y,b.z].join(','),b.name]));
const fortress={x:48,y:77,z:-104};
const bot={fortressCombatActive:true,game:{dimension:'the_nether'},entity:{position:new Vec3(50.5,77,-103.5)},blockAt(q){const name=terrain.get([q.x,q.y,q.z].join(','));return name?{name,boundingBox:name==='air'?'empty':'block',position:q}:null;}};
test('Natural first balcony gives a supported approach to a local blaze',()=>{
 const e={position:new Vec3(51.5,76,-105.5)},q=fortressApproachPoint(bot,e,fortress);
 assert.ok(q);assert.equal(q.y,76);assert.equal(bot.blockAt(q.offset(0,-1,0)).name,'nether_bricks');
 assert.equal(fortressStepCost(bot,{position:q},fortress),0);
});
test('A blaze across the natural gap cannot draw the player onto a bridge',()=>{
 assert.equal(fortressApproachPoint(bot,{position:new Vec3(59.5,76,-108.5)},fortress),null);
 assert.equal(fortressStepCost(bot,{position:new Vec3(54,76,-104)},fortress),100);
 assert.equal(fortressStepCost(bot,{position:new Vec3(51,67,-104)},fortress),100);
});
