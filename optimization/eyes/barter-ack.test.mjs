import test from 'node:test';import assert from 'node:assert/strict';import {waitForGoldDebit} from '../../nether-supplies.mjs';
test('Delayed server debit is accepted without another interaction',async()=>{let ticks=0;assert.equal(await waitForGoldDebit({waitForTicks:async()=>ticks++},5,()=>({gold_ingot:ticks>=8?4:5})),true);assert.equal(ticks,8);});
test('Rejected barter wait is bounded',async()=>{let ticks=0;assert.equal(await waitForGoldDebit({waitForTicks:async()=>ticks++},5,()=>({gold_ingot:5})),false);assert.equal(ticks,20);});
