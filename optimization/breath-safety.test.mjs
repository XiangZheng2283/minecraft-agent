import test from 'node:test';import assert from 'node:assert/strict';import {Vec3} from 'vec3';import {breathEscapeRoutes,breathMargin} from '../breath-safety.mjs';
const p=new Vec3(-6.597,60,.5),cloud=(x,r)=>({position:new Vec3(x,60,.5),metadata:{7:r}}),clouds=[cloud(-.5268,4.1067),cloud(-6.597,3)];
const floor={blockAt:q=>({boundingBox:q.y<60?'block':'empty'})};
test('logged two-cloud failure cannot escape east into the older cloud',()=>{const routes=breathEscapeRoutes(floor,p,clouds);assert.ok(routes.length);for(const r of routes){assert.ok(r.dx<.95);assert.ok(r.margin>3);for(let d=.5;d<=r.length;d+=.5)assert.ok(breathMargin(p.offset(r.dx*d,0,r.dz*d),[clouds[0]])>=0);}});
test('blocked west paths select a clear side path without crossing another cloud',()=>{const bot={blockAt:q=>({boundingBox:q.y<60||q.x< -8?'block':'empty'})};const routes=breathEscapeRoutes(bot,p,clouds);assert.ok(routes.length);assert.ok(routes.every(r=>Math.abs(r.dz)>.5));});
test('escape paths stop before unsupported ground',()=>{const bot={blockAt:q=>({boundingBox:q.y<60&&q.x> -10?'block':'empty'})};const routes=breathEscapeRoutes(bot,p,clouds);assert.ok(routes.every(r=>r.end.x>=-10));});
test('cloud safety uses horizontal radius, including jumping players',()=>{assert.ok(breathMargin(p.offset(0,1.2,0),[clouds[1]])<0);});

test('return path excludes the older cloud even when both endpoints are safe',async()=>{const {breathStepCost}=await import('../breath-safety.mjs');const c={position:new Vec3(-.45,64,10.42),metadata:{7:5.8}};assert.equal(breathStepCost({position:new Vec3(-1,64,10)},[c]),100);assert.equal(breathStepCost({position:new Vec3(12,64,10)},[c]),0);assert.equal(breathStepCost({},[c]),100);});
