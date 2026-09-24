import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { expandEnv, loadAgent, actionAllowed } from './config.mjs';
import { openWorld } from './world-db.mjs';
import { parseCommand, isOwner } from './commands.mjs';
import { createModels, parsePlan } from './models.mjs';
import { createAgent } from './agent.mjs';
import { blockSources } from './skills.mjs';
import { speedrunEnv } from './main.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mcagent-'));

function writeAgent(dir, name, json) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'agent.json'), JSON.stringify(json));
}

test('config expands env, applies defaults and validates', () => {
  assert.equal(expandEnv('${A:-x}-${B}', { B: 'b' }), 'x-b');
  const dir = tmp();
  writeAgent(dir, 'bob', { account: { username: '${U:-Bobby}' }, owners: ['Alex'], models: { decision: { model: 'jev-9' } }, server: { port: '${P:-25570}' } });
  const c = loadAgent('bob', { dir, env: { DECISION_API_KEY: 'k', PLANNER_MODEL: 'm1' } });
  assert.equal(c.account.username, 'Bobby');
  assert.equal(c.server.port, 25570);
  assert.equal(c.models.decision.model, 'jev-9');
  assert.equal(c.models.decision.apiKey, 'k');
  assert.equal(c.models.planner.model, 'm1');
  assert.equal(c.dataDir, path.join(dir, 'bob', 'data'));
  writeAgent(dir, 'bad', { account: { username: 'x' } });
  assert.throws(() => loadAgent('bad', { dir, env: {} }), /username/);
});

test('action allow/deny lists support prefix wildcards', () => {
  const c = { actions: { allow: ['gather_*', 'eat'], deny: ['gather_pickup'] } };
  assert.ok(actionAllowed(c, 'gather_mine'));
  assert.ok(actionAllowed(c, 'eat'));
  assert.ok(!actionAllowed(c, 'gather_pickup'));
  assert.ok(!actionAllowed(c, 'explore'));
});

test('world db: nearest by R-tree, gone marking, summary, notes', () => {
  const w = openWorld(path.join(tmp(), 'w.db'));
  w.recordMany([
    { name: 'iron_ore', dim: 'overworld', x: 10, y: 20, z: 10 },
    { name: 'iron_ore', dim: 'overworld', x: 100, y: 20, z: 100 },
    { name: 'coal_ore', dim: 'overworld', x: 3, y: 60, z: 3 },
    { name: 'iron_ore', dim: 'the_nether', x: 1, y: 20, z: 1 },
  ]);
  w.record({ name: 'iron_ore', dim: 'overworld', x: 10.7, y: 20.2, z: 10.1 }); // same block, updated not duplicated
  assert.equal(w.nearest({ dim: 'overworld', x: 0, y: 64, z: 0, name: 'iron_ore' }).length, 1); // the far one is 148 blocks away
  const near = w.nearest({ dim: 'overworld', x: 0, y: 64, z: 0, name: 'iron_ore', radius: 200 });
  assert.equal(near.length, 2);
  assert.deepEqual([near[0].x, near[0].z], [10, 10]);
  assert.equal(w.nearest({ dim: 'overworld', x: 0, y: 64, z: 0, name: '%_ore', radius: 70 }).length, 2);
  assert.equal(w.markGone({ dim: 'overworld', x: 10, y: 20, z: 10 }), 1);
  assert.equal(w.nearest({ dim: 'overworld', x: 0, y: 64, z: 0, name: 'iron_ore', radius: 200 })[0].x, 100);
  assert.deepEqual(w.summary({ dim: 'overworld', x: 0, y: 64, z: 0, radius: 200 }).map((s) => s.name), ['coal_ore', 'iron_ore']);
  w.note({ kind: 'chest', text: 'chest at 5 64 5 holds: 12 bread, 3 iron_ingot' });
  w.note({ kind: 'owner', text: 'Steve: 家在河边' });
  assert.equal(w.searchNotes('bread')[0].kind, 'chest');
  assert.equal(w.searchNotes('河边')[0].kind, 'owner');
  assert.deepEqual(w.stats(), { places: 3, gone: 1, notes: 2 });
  w.close();
});

test('chat commands', () => {
  assert.deepEqual(parseCommand('!goal get 10 oak logs', 'Helper'), { cmd: 'goal', arg: 'get 10 oak logs' });
  assert.deepEqual(parseCommand('helper, 帮我挖铁', 'Helper'), { cmd: 'goal', arg: '帮我挖铁' });
  assert.deepEqual(parseCommand('!where iron ore', 'Helper'), { cmd: 'where', arg: 'iron ore' });
  assert.deepEqual(parseCommand('!received', 'Helper'), { cmd: 'received' });
  assert.equal(parseCommand('helperbot hi', 'Helper'), null);
  assert.equal(parseCommand('hello', 'Helper'), null);
  assert.ok(isOwner(['Steve'], 'steve'));
  assert.ok(!isOwner([], 'Steve'));
});

test('parsePlan tolerates fences and normalises fields', () => {
  const p = parsePlan('```json\n{"objective":"Get wood","targets":{"oak_log":8},"waypoint":{"x":1.4,"y":64,"z":"a"}}\n```');
  assert.equal(p.objective, 'Get wood');
  assert.equal(p.waypoint, null);
  assert.deepEqual(p.prefer, []);
  assert.throws(() => parsePlan('{"targets":{}}'), /objective/);
});

const config = { name: 'bob', role: 'helper', duties: [], goals: [], owners: ['Steve'], account: { username: 'Bob' }, server: { version: '1.16.5' }, actions: { allow: ['*'], deny: ['explore'] }, planIntervalMs: 60000,
  models: { planner: { baseUrl: 'http://p/v1', model: 'planner', apiKey: 'k' }, decision: { baseUrl: 'http://d', model: 'jev', apiKey: 'k' } } };

test('planner runs tool calls, then JEV chooses from offered actions', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    const reply = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
    if (url === 'http://p/v1/chat/completions') {
      if (body.messages.length === 2) return reply({ choices: [{ message: { content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'query_world', arguments: '{"name":"oak_log"}' } }] } }] });
      assert.equal(body.messages.at(-1).role, 'tool');
      assert.match(body.messages.at(-1).content, /"x":5/);
      return reply({ choices: [{ message: { content: '{"objective":"Collect logs","targets":{"oak_log":4}}' } }] });
    }
    assert.equal(url, 'http://d/v1/systemone');
    assert.deepEqual(Object.keys(body.questions.action.criteria), ['a0', 'a1']);
    return reply({ answers: { action: { choice: 'a1' } } });
  };
  const models = createModels(config, { fetchImpl, tools: { query_world: () => [{ name: 'oak_log', x: 5, y: 64, z: 5 }] } });
  const plan = await models.plan({});
  assert.equal(plan.result.objective, 'Collect logs');
  assert.equal(plan.toolCalls[0].tool, 'query_world');
  const d = await models.decide({}, [{ description: 'first' }, { description: 'second' }]);
  assert.equal(d.selected.description, 'second');
});

function fakeBot() {
  const bot = new EventEmitter();
  Object.assign(bot, { username: 'Bob', entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' }, health: 20, food: 20, time: { timeOfDay: 1000 }, players: {}, entities: {},
    inventory: { items: () => [{ name: 'oak_log', count: 4 }] }, said: [], chat(t) { this.said.push(t); }, whisper(to, t) { this.said.push(to + ':' + t); }, waitForTicks: async () => {} });
  return bot;
}

test('agent loop: plans, filters denied skills, acts, finishes owner request, obeys owners only', async () => {
  const dir = tmp(), world = openWorld(path.join(dir, 'w.db'));
  world.record({ name: 'oak_log', dim: 'overworld', x: 5, y: 64, z: 5 });
  const bot = fakeBot(), events = [], ran = [], offered = [];
  const skills = { candidates: () => [
    { skill: 'explore', key: 'explore_n', description: 'Explore north', fn: async () => ran.push('explore') },
    { skill: 'gather_mine', key: 'mine', description: 'Mine oak_log', fn: async () => { ran.push('mine'); return 'Mined'; } },
  ] };
  const added = [];
  const knowledge = { add: (d) => added.push(d), search: async () => [{ source: 'recipe', title: 'Planks', text: 'oak_log -> 4 planks', via: 'keyword' }], stats: () => ({}) };
  const models = {
    plan: async (state) => { assert.ok(state.knownNearby.some((k) => k.name === 'oak_log')); return { result: { objective: 'Get logs', targets: { oak_log: 4 }, prefer: [] }, toolCalls: [] }; },
    decide: async (state, opts) => { offered.push(opts.map((o) => o.key)); return { selected: opts[0] }; },
  };
  const agent = createAgent({ config: { ...config, dataDir: dir }, bot, world, knowledge, skills, models, log: (type, data) => events.push({ type, ...data }) });
  agent.onChat('Mallory', '!goal dig a hole');
  assert.equal(agent.ctx.request, null);
  agent.onChat('Steve', 'bob, collect 4 logs');
  assert.equal(agent.ctx.request.text, 'collect 4 logs');
  assert.equal(await agent.step(), 'acted');
  assert.deepEqual(offered[0], ['mine']);
  assert.deepEqual(ran, ['mine']);
  assert.ok(events.some((e) => e.type === 'request_done'));
  assert.equal(agent.ctx.request, null);
  assert.equal(added[0].source, 'experience');
  assert.ok(added[0].tags.includes('shared'));
  assert.doesNotMatch(added[0].text, /collect 4 logs/);
  const recall = await agent.recall('planks');
  assert.equal(recall.at(-1).source, 'recipe');
  assert.equal(agent.queryWorld({ name: 'oak_log' })[0].x, 5);
  agent.onChat('Steve', '!stop');
  assert.equal(agent.status().paused, true);
  world.close();
});

test('failed actions are cooled down and recorded as experience', async () => {
  const dir = tmp(), world = openWorld(path.join(dir, 'w.db'));
  const bot = fakeBot(), added = [], offered = [];
  const skills = { candidates: () => [{ skill: 'craft', key: 'craft_x', description: 'Craft x', fn: async () => { throw new Error('No recipe'); } }, { skill: 'wait', key: 'wait', description: 'Wait', fn: async () => 'ok' }] };
  const models = { plan: async () => ({ result: { objective: 'o', targets: {}, prefer: ['craft'] }, toolCalls: [] }), decide: async (s, opts) => { offered.push(opts.map((o) => o.key)); return { selected: opts[0] }; } };
  const agent = createAgent({ config: { ...config, actions: { allow: ['*'], deny: [] }, dataDir: dir }, bot, world, knowledge: { add: (d) => added.push(d) }, skills, models, log: () => {} });
  await agent.step();
  await agent.step();
  assert.deepEqual(offered, [['craft_x', 'wait'], ['wait']]);
  assert.match(added[0].text, /craft failed/);
  assert.doesNotMatch(added[0].text, /No recipe/);
  assert.ok(added[0].tags.includes('shared'));
  assert.equal(world.searchNotes('recipe')[0].kind, 'failure');
  world.close();
});

test('block sources come from minecraft-data drops', async () => {
  const registry = (await import('prismarine-registry')).default('1.16.5');
  assert.ok(blockSources(registry, 'cobblestone').includes('stone'));
  assert.ok(blockSources(registry, 'coal').includes('coal_ore'));
  assert.ok(blockSources(registry, 'oak_log').includes('oak_log'));
});

test('speedrun mode maps agent config to the existing runtime environment', () => {
  const env = speedrunEnv({ name: 'speedrun', account: { username: 'JevAstra' }, server: { port: 25576 }, api: { port: 3078 }, models: config.models }, { NATIVE_VIEW: '1', NATIVE_MIRROR_BOT: 'helper' });
  assert.equal(env.MC_USERNAME, 'JevAstra');
  assert.equal(env.DECISION_MODEL, 'jev');
  assert.equal(env.NATIVE_VIEW, '0');
  assert.equal(env.STATUS_PORT, '3078');
});
