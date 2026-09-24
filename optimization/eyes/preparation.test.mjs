import test from 'node:test';import assert from 'node:assert/strict';import {plankName} from '../../eyes-preparation.mjs';
test('village stripped logs use the same plank recipe as natural logs',()=>{for(const wood of ['oak','spruce','birch','jungle','acacia','dark_oak'])for(const prefix of ['','stripped_'])assert.equal(plankName(prefix+wood+'_log'),wood+'_planks');});
