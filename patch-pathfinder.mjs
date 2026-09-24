// Repair canceled path cleanup in the installed pathfinder. No game state is changed.
import fs from 'node:fs';
const file='node_modules/mineflayer-pathfinder/index.js';let s=fs.readFileSync(file,'utf8');
if(!s.includes('let navigationEpoch = 0')){
 const edits=[
  ['  let returningPos = null','  let returningPos = null\n  let navigationEpoch = 0 // Invalidate delayed placement callbacks after cancellation.'],
  ['  function resetPath (reason, clearStates = true) {','  function resetPath (reason, clearStates = true) {\n    if (clearStates) { navigationEpoch++; returningPos = null }'],
  ['  function stop () {','  function stop () {\n    navigationEpoch++\n    returningPos = null'],
  ["        bot.equip(block, 'hand')","        const placementEpoch = navigationEpoch\n        bot.equip(block, 'hand')"],
  ['if (bot.pathfinder.LOSWhenPlacingBlocks && placingBlock.returnPos) returningPos = placingBlock.returnPos.clone()', 'if (placementEpoch === navigationEpoch && bot.pathfinder.LOSWhenPlacingBlocks && placingBlock?.returnPos) returningPos = placingBlock.returnPos.clone()']
 ];
 for(const [from,to] of edits){if(!s.includes(from))throw Error('Pathfinder source changed; review the cancellation patch before applying it');s=s.replace(from,to);}
 fs.writeFileSync(file,s);console.log('Patched pathfinder cancellation and delayed return-target cleanup.');
}
// Keep route steering separate from continuous mouse aim.
s=fs.readFileSync(file,'utf8');if(!s.includes('bot.steerWalk({ dx, dz, path })')){const from='    bot.look(Math.atan2(-dx, -dz), 0)';if(!s.includes(from))throw Error('Pathfinder walking source changed');s=s.replace(from,'    if (bot.steerWalk) bot.steerWalk({ dx, dz, path })\n    else bot.look(Math.atan2(-dx, -dz), 0)');fs.writeFileSync(file,s);}
const physicsFile='node_modules/mineflayer-pathfinder/lib/physics.js';let phys=fs.readFileSync(physicsFile,'utf8');if(!phys.includes('state.control.left = state.control.right')){phys=phys.replace('      state.control.forward = true','      state.control.back = state.control.left = state.control.right = false\n      state.control.forward = true');fs.writeFileSync(physicsFile,phys);}

// A continuous camera must finish aiming before the pillar jump starts.
s=fs.readFileSync(file,'utf8');if(!s.includes('preparePlacementAim')){
 const from="      if (placingBlock.jump) {\n        bot.setControlState('jump', true)\n        canPlace = placingBlock.y + 1 < bot.entity.position.y";
 const to="      if (placingBlock.jump) {\n        if (bot.preparePlacementAim && !bot.preparePlacementAim(new Vec3(placingBlock.x + .5, placingBlock.y + 1, placingBlock.z + .5))) { bot.setControlState('jump', false); return }\n        bot.setControlState('jump', true)\n        canPlace = placingBlock.y + 2.02 < bot.entity.position.y";
 if(!s.includes(from))throw Error('Pillar placement source changed');fs.writeFileSync(file,s.replace(from,to));
}
// Stop through normal controls. Recentring entity.position can put the player inside a low ceiling.
s=fs.readFileSync(file,'utf8');if(!s.includes('Normal control stop; never rewrite player position')){const start=s.indexOf('  function fullStop () {'),end=s.indexOf('\n  function moveToEdge',start);if(start<0||end<0)throw Error('fullStop source changed');s=s.slice(0,start)+'  function fullStop () {\n    // Normal control stop; never rewrite player position or velocity.\n    bot.clearControlStates()\n  }\n'+s.slice(end);fs.writeFileSync(file,s);}
// Preserve useful partial paths and reject an empty failed search.
const gotoFile='node_modules/mineflayer-pathfinder/lib/goto.js';let go=fs.readFileSync(gotoFile,'utf8');
if(!go.includes('Empty path did not reach the goal')){
 const from="if (results.path.length === 0) {\n        cleanup()\n      } else if (results.status === 'noPath') {";
 if(!go.includes(from))throw Error('Pathfinder goto source changed');
 go=go.replace(from,"if (results.status === 'noPath') {").replace("results.status === 'timeout')", "results.status === 'timeout' && results.path.length === 0)").replace("cleanup(error('Timeout', 'Took to long to decide path to goal!'))\n      }", "cleanup(error('Timeout', 'Took to long to decide path to goal!'))\n      } else if (results.path.length === 0 && results.status === 'success') {\n        if (goal.isEnd(bot.entity.position.floored())) cleanup()\n        else cleanup(error('NoPath', 'Empty path did not reach the goal'))\n      }");
 fs.writeFileSync(gotoFile,go);
}
s=fs.readFileSync(file,'utf8');if(!s.includes('A usable partial path ended.')){
 const from='          stateGoal = null\n        }\n        fullStop()\n        return\n      }\n      // not done yet';
 const to='          stateGoal = null\n        } else {\n          // A usable partial path ended. Continue the search from this position.\n          pathUpdated = false\n        }\n        fullStop()\n        return\n      }\n      // not done yet';
 if(!s.includes(from))throw Error('Partial path completion source changed');fs.writeFileSync(file,s.replace(from,to));
}
