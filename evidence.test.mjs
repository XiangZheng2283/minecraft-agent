import {test} from 'node:test';import assert from 'node:assert/strict';import {dragonKillAward,gameWon,dragonDeathState} from './evidence.mjs';
test('only a completed dragon kill criterion proves the kill',()=>{assert.equal(dragonKillAward({progressMapping:[{key:'minecraft:end/kill_dragon',value:[{criterionProgress:null}]}]}),false);assert.equal(dragonKillAward({progressMapping:[{key:'minecraft:end/root',value:[{criterionProgress:123}]}]}),false);assert.equal(dragonKillAward({progressMapping:[{key:'minecraft:end/kill_dragon',value:[{criterionProgress:[0,123]}]}]}),true);});
test('a dimension change is not a win',()=>{assert.equal(gameWon({reason:'change_game_mode'}),false);assert.equal(gameWon({reason:'win_game'}),true);});
test('Java 1.16.5 sends the numeric end-credit event',()=>{assert.equal(gameWon({reason:4,gameMode:1}),true);assert.equal(gameWon({reason:3,gameMode:1}),false);});

test("dragon death needs both zero health and dying phase",()=>{assert.equal(dragonDeathState({health:0,phase:9}),true);assert.equal(dragonDeathState({health:0,phase:3}),false);assert.equal(dragonDeathState({health:1,phase:9}),false);assert.equal(dragonDeathState(null),false);});
