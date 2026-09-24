import test from 'node:test';import assert from 'node:assert/strict';import {Vec3} from 'vec3';import {findCraftingTables} from '../crafting-access.mjs';
function bot(position,table){return {entity:{position},registry:{blocksByName:{crafting_table:{id:1}}},findBlock:({maxDistance})=>maxDistance>=32?table:null};}
test('table across both X and Y section edges is available for crafting',()=>{const table={position:new Vec3(208,64,209)},b=bot(new Vec3(207.5,63,209.5),table);assert.equal(findCraftingTables(b).near,table);});
test('distant table remains an approach target, not a crafting target',()=>{const table={position:new Vec3(220,64,209)},b=bot(new Vec3(207.5,63,209.5),table);assert.equal(findCraftingTables(b).near,null);assert.equal(findCraftingTables(b).remote,table);});
