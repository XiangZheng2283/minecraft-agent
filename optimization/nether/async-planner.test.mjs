import test from 'node:test';
import assert from 'node:assert/strict';
import {asyncPlanner} from '../../async-planner.mjs';
test('Actions can continue while one planner request is pending',async()=>{
 let resolve, calls=0, applied=0, step=0;
 const p=asyncPlanner({getState:()=>({stage:'prepare',steps:step}),plan:()=>{calls++;return new Promise(r=>resolve=r);},onPlan:()=>applied++});
 const first=p.refresh();await Promise.resolve();
 step++;assert.equal(p.refresh(true),first);assert.equal(calls,1);assert.equal(applied,0);
 resolve({result:{objective:'Continue'}});await first;assert.equal(applied,1);
});
test('Discard old stage plans and request the new stage immediately',async()=>{
 let stage='prepare',resolve,applied=0,calls=0;
 const p=asyncPlanner({getState:()=>({stage}),plan:()=>{calls++;return new Promise(r=>resolve=r);},onPlan:()=>applied++});
 const first=p.refresh();await Promise.resolve();stage='nether';resolve({});await first;assert.equal(applied,0);
 const next=p.refresh();await Promise.resolve();assert.equal(calls,2);resolve({});await next;assert.equal(applied,1);
});
test('Planner failures do not reject the action loop or erase the current plan',async()=>{
 let applied=0,logged=0;
 const p=asyncPlanner({getState:()=>({stage:'combat'}),plan:async()=>{throw Error('network');},onPlan:()=>applied++,log:t=>{if(t==='plan_error')logged++;}});
 await p.refresh();assert.equal(applied,0);assert.equal(logged,1);
});
