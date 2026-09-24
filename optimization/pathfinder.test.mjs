import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('node_modules/mineflayer-pathfinder/index.js','utf8');
function functionSource(name){const start=source.indexOf(`  function ${name} (`),open=source.indexOf('{',start);let depth=1,end=open+1;for(;depth;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}return source.slice(start,end);}
function context(){return vm.createContext({navigationEpoch:0,returningPos:{x:928,y:61,z:-1141},stopPathing:false,path:[],digging:false,placing:true,pathUpdated:true,astarContext:{},stateGoal:{},bot:{emit(){},clearControlStates(){}},lockEquipItem:{release(){}},lockPlaceBlock:{release(){}},lockUseBlock:{release(){}},stateMovements:{clearCollisionIndex(){}},fullStop(){}});}
test('canceling a goal clears an old bridge return target',()=>{const c=context();vm.runInContext(functionSource('resetPath')+`;resetPath('goal_updated')`,c);assert.equal(c.returningPos,null);assert.equal(c.navigationEpoch,1);});
test('normal block updates retain the active bridge return target',()=>{const c=context();vm.runInContext(functionSource('resetPath')+`;resetPath('block_updated',false)`,c);assert.equal(c.returningPos.y,61);assert.equal(c.navigationEpoch,0);});
test('stop clears the old return target and goal',()=>{const c=context();vm.runInContext(functionSource('stop')+';stop()',c);assert.equal(c.returningPos,null);assert.equal(c.stateGoal,null);});
test('a delayed placement cannot restore a canceled return target',()=>{const c=context();c.placementEpoch=0;c.navigationEpoch=1;c.returningPos=null;c.bot.pathfinder={LOSWhenPlacingBlocks:true};c.placingBlock={returnPos:{clone(){throw Error('stale placement used');}}};const line=source.split('\n').find(x=>x.includes('placementEpoch === navigationEpoch'));assert.ok(line);vm.runInContext(line,c);assert.equal(c.returningPos,null);});
