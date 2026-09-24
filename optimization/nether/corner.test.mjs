import test from 'node:test';import assert from 'node:assert/strict';import {installCornerSafety} from '../../corner-safety.mjs';
function available(solid){const moves={getBlock:(node,x,y,z)=>({physical:solid.some(q=>q.join()===`${node.x+x},${node.y+y},${node.z+z}`)}),getMoveDiagonal:(_n,_d,out)=>out.push('diagonal')};installCornerSafety(moves);const out=[];moves.getMoveDiagonal({x:-6,y:64,z:-3},{x:1,z:1},out);return out;}
test('the recorded fountain corner does not permit a diagonal through its solid side',()=>assert.deepEqual(available([[-6,64,-2]]),[]));
test('a clear diagonal remains available',()=>assert.deepEqual(available([]),['diagonal']));
test('a real upward step still uses the standard jump checks',()=>assert.deepEqual(available([[-5,64,-2]]),['diagonal']));
