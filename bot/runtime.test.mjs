import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createAgent } from './agent.mjs';
import { parsePlan, plannerSystemPrompt } from './models.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const baseConfig = { name: 'helper', role: 'helper', duties: [], goals: ['Maintain 16 oak logs'], owners: ['Steve'], account: { username: 'Bob' }, server: { version: '1.16.5' }, actions: { allow: ['*'], deny: [] }, planIntervalMs: 60000 };

function fixture({ models, skills, actions = null, experience = null, reviewer = null, knowledge = null, world: suppliedWorld = null, inventory = { oak_log: 4 }, config = {}, now = Date.now } = {}) {
  const bot = new EventEmitter();
  const items = () => Object.entries(inventory).filter(([, count]) => count > 0).map(([name, count]) => ({ name, count }));
  Object.assign(bot, { username: 'Bob', entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' }, health: 20, food: 20, time: { timeOfDay: 1000 }, players: {}, entities: {}, inventory: { items }, said: [], chat(t) { this.said.push(t); }, whisper(to, t) { this.said.push(to + ':' + t); }, waitForTicks: async () => {} });
  const world = suppliedWorld || { nearest: () => [], summary: () => [], searchNotes: () => [], note: () => {}, stats: () => ({}) };
  const events = [], executed = [];
  const defaultSkills = { candidates: () => [{ skill: 'gather_mine', key: 'mine', description: 'Mine', fn: async () => { executed.push('mine'); return 'Mined'; } }] };
  const agent = createAgent({ config: { ...baseConfig, ...config, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mc-runtime-')) }, bot, world, knowledge, skills: skills || defaultSkills, actions, experience, reviewer, models: models || { plan: async () => ({ result: { objective: 'Wood', targets: { oak_log: 4 } } }), decide: async (_, opts) => ({ selected: opts[0] }) }, now, log: (type, data) => events.push({ type, ...data }) });
  return { agent, bot, inventory, events, executed };
}

test('decision released after pause or stop does not launch an action', async () => {
  for (const control of ['pause', 'stop']) {
    const gate = deferred(), entered = deferred();
    const f = fixture({ models: { plan: async () => ({ result: { objective: 'Wood', targets: {} } }), decide: async (_, opts) => { entered.resolve(); await gate.promise; return { selected: opts[0] }; } } });
    const running = f.agent.step(); await entered.promise;
    f.agent[control]('Steve'); gate.resolve(); await running;
    assert.deepEqual(f.executed, [], control);
    assert.equal(f.events.some((e) => e.type === 'action_start'), false, control);
    if (control === 'pause') { f.agent.resume('Steve'); assert.equal(await f.agent.step(), 'acted'); assert.equal(f.executed.length, 1); }
    else { assert.equal(f.agent.resume('Steve').stopped, true); assert.equal(await f.agent.step(), 'interrupted'); }
  }
});

test('a paused in-flight planner settles without starting decisions and resume replans', async () => {
  const entered = deferred(), never = deferred(); let plans = 0, decisions = 0;
  const f = fixture({ models: { plan: async () => { plans++; if (plans === 1) { entered.resolve(); return never.promise; } return { result: { objective: 'fresh', targets: {} } }; }, decide: async (_, opts) => { decisions++; return { selected: opts[0] }; } } });
  const running = f.agent.step(); await entered.promise;
  f.agent.pause('Steve');
  assert.equal(await running, 'interrupted');
  assert.equal(decisions, 0);
  f.agent.resume('Steve'); await f.agent.step();
  assert.equal(f.agent.ctx.plan.objective, 'fresh');
  assert.equal(decisions, 1);
});

test('a discarded plan cannot generate an action for a replacement owner request', async () => {
  const oldPlan = deferred(), entered = deferred(), planned = [];
  const f = fixture({ models: { plan: async (state) => { planned.push(state.ownerRequest?.text); if (planned.length === 1) { entered.resolve(); return oldPlan.promise; } return { result: { objective: 'Diamond', targets: { diamond: 1 } } }; }, decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('get wood', 'Steve');
  const running = f.agent.step(); await entered.promise;
  f.agent.request('get diamond', 'Steve'); oldPlan.resolve({ result: { objective: 'Wood', targets: { oak_log: 4 } } });
  await running; await f.agent.step();
  assert.equal(f.agent.ctx.plan?.objective, 'Diamond');
  assert.deepEqual(planned, ['get wood', 'get diamond']);
  assert.equal(f.events.some((e) => e.type === 'action_start' && e.description === 'Mine wood'), false);
});

test('normal progress does not trigger a fixed interval replan', async () => {
  let time = 0, plans = 0;
  const actions = [];
  const f = fixture({ now: () => time, config: { planIntervalMs: 1 }, skills: { candidates: (ctx) => [{ skill: 'gather_mine', key: ctx.plan.objective, description: ctx.plan.objective, fn: async () => { actions.push(ctx.plan.objective); return 'progress'; } }] }, models: { plan: async () => { plans++; return { result: { objective: 'old', targets: {} } }; }, decide: async (_, opts) => ({ selected: opts[0] }) } });
  await f.agent.step();
  assert.deepEqual(actions, ['old']);
  time = 2;
  await f.agent.step();
  assert.deepEqual(actions, ['old', 'old']);
  assert.equal(plans, 1);
});

test('a newly adopted plan aborts an action still running under the old plan', async () => {
  const started = deferred(); let plans = 0;
  const f = fixture({ skills: { candidates: () => [{ skill: 'sleep', key: 'long', description: 'Long action', fn: async ({ signal }) => { started.resolve(signal); return new Promise(() => {}); } }] }, models: { plan: async () => ({ result: { objective: ++plans === 1 ? 'old' : 'new', targets: {} } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  const running = f.agent.step(); const signal = await started.promise;
  await f.agent.replan('external refresh');
  assert.equal(signal.aborted, true);
  assert.equal(await running, 'interrupted');
  assert.equal(f.agent.ctx.plan.objective, 'new');
  assert.equal(f.events.some((event) => event.type === 'action_done'), false);
});

test('planner failure keeps the current request pending for retry', async () => {
  let attempts = 0;
  const f = fixture({ models: { plan: async () => { if (++attempts === 1) throw new Error('temporary planner failure'); return { result: { objective: 'Find diamond', targets: { diamond: 1 } } }; }, decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('find a diamond', 'Steve');
  assert.equal(await f.agent.step(), 'waiting for plan');
  assert.equal(f.agent.ctx.request.text, 'find a diamond');
  assert.equal(f.events.some((event) => event.type === 'plan_error'), true);
  await f.agent.step();
  assert.equal(f.agent.ctx.plan.objective, 'Find diamond');
});

test('old action completion does not finish a replacement request', async () => {
  const action = deferred(), started = deferred();
  const f = fixture({ skills: { candidates: () => [{ skill: 'gather_mine', key: 'mine', description: 'Mine wood', fn: async () => { started.resolve(); return action.promise; } }] }, models: { plan: async (state) => ({ result: { objective: state.ownerRequest?.text || 'standing', targets: { oak_log: 4 } } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('collect wood', 'Steve');
  const running = f.agent.step(); await started.promise;
  f.agent.request('get diamonds', 'Steve'); action.resolve('Mined'); await running;
  assert.equal(f.agent.ctx.request.text, 'get diamonds');
  assert.equal(f.events.filter((e) => e.type === 'request_done').length, 0);
  assert.equal(f.bot.said.some((s) => s.includes('Done: get diamonds')), false);
});

test('knowledge write failure does not turn a completed action into a failed action', async () => {
  const f = fixture({ knowledge: { add: () => { throw new Error('database unavailable'); } } });
  f.agent.request('collect wood', 'Steve');
  assert.equal(await f.agent.step(), 'acted');
  assert.equal(f.agent.ctx.request, null);
  assert.equal(f.events.some((event) => event.type === 'request_done'), true);
  assert.equal(f.events.some((event) => event.type === 'action_failed'), false);
  assert.equal(f.events.some((event) => event.type === 'knowledge_error'), true);
});

test('empty options yield to timers and stop exits the loop', async () => {
  let calls = 0;
  const f = fixture({ skills: { candidates: () => { calls++; return []; } } });
  f.agent.start();
  await new Promise((resolve) => setTimeout(resolve, 30));
  f.agent.stop();
  assert.ok(calls < 100, `busy loop generated ${calls} candidate scans`);
});

test('incremental targets use the request inventory baseline once, while absolute targets stay absolute', async () => {
  const inv = { oak_log: 14 }; let call = 0;
  const f = fixture({ inventory: inv, models: { plan: async () => ({ result: ++call === 1 ? { objective: 'Add logs', targets: {}, additionalTargets: { oak_log: 2 } } : { objective: 'Keep two logs', targets: { oak_log: 2 } } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('collect two more logs', 'Steve'); await f.agent.replan('initial');
  assert.equal(f.agent.ctx.plan.targets.oak_log, 16);
  inv.oak_log = 15; await f.agent.replan('interval');
  assert.equal(f.agent.ctx.plan.targets.oak_log, 2);
  assert.match(plannerSystemPrompt(baseConfig), /additionalTargets/);
  assert.match(plannerSystemPrompt(baseConfig), /14 oak_log.*16/);
  assert.throws(() => parsePlan('{"objective":"bad","targets":{"oak_log":-1}}'), /target/i);
  assert.throws(() => parsePlan('{"objective":"bad","additionalTargets":{"oak_log":"two"}}'), /target/i);
});

test('delivery plan with intermediate targets identifies final items explicitly', async () => {
  const f = fixture({ models: { plan: async () => ({ result: { objective: 'Deliver iron', targets: { iron_ore: 2, iron_ingot: 2 }, deliveryRequired: true } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('give me iron ingots', 'Steve');
  assert.equal(await f.agent.step(), 'waiting for plan');
  assert.match(f.events.find((event) => event.type === 'plan_error').error, /deliveryTargets/);
  assert.equal(f.agent.ctx.request.text, 'give me iron ingots');
});

test('replanning a relative request uses its first inventory snapshot', async () => {
  const inv = { oak_log: 14 };
  const f = fixture({ inventory: inv, models: { plan: async () => ({ result: { objective: 'Two more', targets: {}, additionalTargets: { oak_log: 2 } } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('two more oak logs', 'Steve'); await f.agent.replan('initial');
  assert.equal(f.agent.ctx.plan.targets.oak_log, 16);
  inv.oak_log = 15; await f.agent.replan('interval');
  assert.equal(f.agent.ctx.plan.targets.oak_log, 16);
});

test('delivery request remains pending until owner confirms after a give action', async () => {
  const f = fixture({ skills: { candidates: () => [{ skill: 'owner_give', key: 'give_oak_log', description: 'Drop logs for Steve', fn: async () => 'Dropped logs for owner; awaiting confirmation' }] } });
  f.agent.request('give me 4 logs', 'Steve'); await f.agent.step();
  assert.equal(f.agent.ctx.request?.text, 'give me 4 logs');
  assert.equal(f.events.some((e) => e.type === 'request_done'), false);
  assert.equal(f.agent.confirmDelivery('Mallory').confirmed, false);
  assert.equal(f.agent.confirmDelivery('Steve').confirmed, true);
  assert.equal(f.agent.ctx.request, null);
});

test('multi-item delivery waits for every target before accepting receipt', async () => {
  const dropped = [];
  const f = fixture({ inventory: { oak_log: 4, cobblestone: 2 }, skills: { candidates: (ctx) => ['oak_log', 'cobblestone'].filter((name) => !ctx.request.deliveryDropped.includes(name)).map((name) => ({ skill: 'owner_give', key: 'give_' + name, description: 'Drop ' + name, fn: async () => { dropped.push(name); return 'Dropped ' + name; } })) }, models: { plan: async () => ({ result: { objective: 'Give two items', targets: { oak_log: 4, cobblestone: 2 }, deliveryTargets: ['oak_log', 'cobblestone'], deliveryRequired: true } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('give me logs and cobblestone', 'Steve');
  await f.agent.step();
  assert.deepEqual(dropped, ['oak_log']);
  assert.equal(f.agent.ctx.request.deliveryPending, false);
  assert.equal(f.agent.confirmDelivery('Steve').confirmed, false);
  await f.agent.step();
  assert.deepEqual(dropped, ['oak_log', 'cobblestone']);
  assert.equal(f.agent.ctx.request.deliveryPending, true);
  assert.equal(f.agent.confirmDelivery('Steve').confirmed, true);
});

test('pausing aborts an already running action and ignores its late result', async () => {
  const late = deferred(), started = deferred();
  const f = fixture({ inventory: { oak_log: 3 }, skills: { candidates: () => [{ skill: 'sleep', key: 'sleep', description: 'Sleep', fn: async ({ signal }) => { started.resolve(signal); return late.promise; } }] } });
  const running = f.agent.step(); const signal = await started.promise;
  f.agent.pause('Steve');
  assert.equal(signal.aborted, true);
  await running; late.resolve('Slept'); await tick();
  assert.equal(f.events.some((e) => e.type === 'action_done'), false);
});

test('a hung action times out, aborts its signal and does not claim success', async () => {
  const started = deferred();
  const f = fixture({ inventory: { oak_log: 3 }, config: { actionTimeoutMs: 25 }, skills: { candidates: () => [{ skill: 'sleep', key: 'sleep', description: 'Sleep', fn: async ({ signal }) => { started.resolve(signal); return new Promise(() => {}); } }] } });
  const running = f.agent.step(); const signal = await started.promise;
  assert.equal(await running, 'acted');
  assert.equal(signal.aborted, true);
  assert.equal(f.events.some((e) => e.type === 'action_done'), false);
  assert.equal(f.events.some((e) => e.type === 'action_failed' && /timed out/i.test(e.error)), true);
});

test('status shows actual logged-in username and flags a config mismatch', () => {
  const f = fixture({ config: { account: { username: 'test_bot_1' } } });
  f.bot.entity = null;
  assert.equal(f.agent.status().player, null);
  assert.equal(f.agent.status().loginMatchesConfigured, false);
  f.bot.entity = { position: { x: 0, y: 64, z: 0 } };
  f.bot.username = 'OtherName';
  assert.equal(f.agent.status().player, 'OtherName');
  assert.equal(f.agent.status().configuredPlayer, 'test_bot_1');
  assert.equal(f.agent.status().loginMatchesConfigured, false);
  f.bot.username = 'test_bot_1';
  assert.equal(f.agent.status().loginMatchesConfigured, true);
});

test('stage operation is offered and its successful receipt advances an otherwise targetless request', async () => {
  const seen = [];
  const operation = { action: 'move', args: { x: 5, y: 64, z: 5 } };
  const f = fixture({ skills: { candidates: () => [] }, actions: { candidates: (ctx) => { seen.push(ctx.plan.operations); return [{ skill: 'move', key: 'op_move', description: 'Move', operation, fn: async () => ({ status: 'success', summary: 'At destination' }) }]; } }, models: { plan: async () => ({ result: { objective: 'Go', targets: {}, steps: [{ id: 'travel', description: 'Travel', operations: [operation] }] } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('go there', 'Steve');
  await f.agent.step();
  assert.deepEqual(seen[0], [operation]);
  assert.equal(f.agent.ctx.request, null);
  assert.equal(f.events.some((e) => e.type === 'stage_done' && e.stageId === 'travel'), true);
});

test('blocked result is recorded as blockage and cannot complete a stage', async () => {
  const records = [], queued = [];
  const operation = { action: 'dig', args: { x: 1, y: 64, z: 1 } };
  const f = fixture({ skills: { candidates: () => [] }, actions: { candidates: () => [{ skill: 'dig', key: 'op_dig', description: 'Dig', operation, fn: async () => ({ status: 'blocked', reason: 'Need pickaxe', missing: ['pickaxe'] }) }] }, experience: { record: (e) => { records.push(e); return records.length; }, enqueue: (e) => queued.push(e), retrieve: () => [], stats: () => ({ pending: queued.length }) }, models: { plan: async () => ({ result: { objective: 'Mine', targets: {}, steps: [{ id: 'mine', description: 'Mine', operations: [operation] }] } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('mine', 'Steve');
  await f.agent.step();
  assert.equal(f.agent.ctx.request?.text, 'mine');
  assert.equal(f.events.some((e) => e.type === 'action_done'), false);
  assert.equal(f.events.some((e) => e.type === 'action_blocked'), true);
  assert.equal(records[0].result.status, 'blocked');
  assert.ok(queued.length > 0);
});

test('legacy blocked string does not complete an already stocked request', async () => {
  const f = fixture({ skills: { candidates: () => [{ skill: 'gather_mine', key: 'mine', description: 'Mine', fn: async () => 'gather_blocked: no pickaxe' }] } });
  f.agent.request('get wood', 'Steve');
  await f.agent.step();
  assert.equal(f.agent.ctx.request?.text, 'get wood');
  assert.equal(f.events.some((event) => event.type === 'action_done'), false);
});

test('stage targets are projected to legacy skills without exposing future targets', async () => {
  const seen = [];
  const f = fixture({ inventory: {}, skills: { candidates: (ctx) => { seen.push(ctx.plan.targets); return [{ skill: 'gather_mine', key: 'wood', description: 'Wood', fn: async () => 'Mined' }]; } }, models: { plan: async () => ({ result: { objective: 'Tools', targets: { wooden_pickaxe: 1 }, steps: [{ id: 'wood', description: 'Wood', targets: { oak_log: 1 } }, { id: 'pick', description: 'Pick', targets: { wooden_pickaxe: 1 } }] } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  await f.agent.step();
  assert.deepEqual(seen[0], { oak_log: 1 });
});

test('pending game operation waits locally without another JEV call', async () => {
  let decisions = 0;
  const f = fixture({ actions: { pending: true, candidates: () => [] }, models: { plan: async () => ({ result: { objective: 'Wait', targets: {} } }), decide: async () => { decisions++; throw new Error('should not call JEV'); } } });
  assert.equal(await f.agent.step(), 'operation pending');
  assert.equal(await f.agent.step(), 'operation pending');
  assert.equal(decisions, 0);
});

test('action evidence uses scoped world and exact matching memory feedback', async () => {
  const records = [], usages = [], operation = { action: 'dig', args: { position: { x: 1, y: 64, z: 1 }, block: 'stone' } };
  const memories = [
    { id: 11, executionAction: 'dig', executionArgs: operation.args, advice: 'Use a pickaxe' },
    { id: 12, executionAction: 'dig', executionArgs: { position: { x: 2, y: 64, z: 2 }, block: 'stone' }, advice: 'Other block' },
  ];
  const f = fixture({ config: { server: { host: 'example.test', port: 25570, version: '1.16.5' } }, skills: { candidates: () => [] }, actions: { candidates: () => [{ skill: 'gather_mine', key: 'dig', description: 'Dig', operation, fn: async () => ({ status: 'success', summary: 'Dug', evidence: { changed: true } }) }] }, experience: { retrieve: () => memories, record: (event) => { records.push(event); return 1; }, enqueue: () => {}, recordUsage: (id, result) => usages.push({ id, result }), stats: () => ({}) }, models: { plan: async () => ({ result: { objective: 'Dig', targets: {}, steps: [{ id: 'dig', description: 'Dig', operations: [operation] }] } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('dig', 'Steve'); await f.agent.step();
  assert.equal(records[0].world, 'example.test:25570:overworld');
  assert.deepEqual(usages.map((usage) => usage.id), [11]);
});

test('satisfied standing stock goal idles without repeated Plan or JEV calls', async () => {
  let plans = 0, decisions = 0;
  const f = fixture({ models: { plan: async () => { plans++; return { result: { objective: 'Keep four logs', targets: { oak_log: 4 } } }; }, decide: async (_, opts) => { decisions++; return { selected: opts[0] }; } } });
  for (let i = 0; i < 5; i++) assert.equal(await f.agent.step(), 'goal satisfied');
  assert.equal(plans, 1);
  assert.equal(decisions, 0);
  f.inventory.oak_log = 3;
  assert.equal(await f.agent.step(), 'acted');
  assert.equal(plans, 1);
  assert.equal(decisions, 1);
});

test('planner world tool bounds local query parameters', async () => {
  let input;
  const world = { nearest: (args) => { input = args; return []; }, summary: () => [], searchNotes: () => [], note: () => {}, stats: () => ({}) };
  const f = fixture({ world });
  f.agent.queryWorld({ name: 'x'.repeat(500), kind: 'invalid', radius: -5, limit: -10 });
  assert.equal(input.name.length, 80);
  assert.equal(input.kind, null);
  assert.equal(input.radius, 1);
  assert.equal(input.limit, 1);
});

test('cancelled action preserves unconfirmed evidence under its original request', async () => {
  const started = deferred(), records = [], episodes = [];
  const f = fixture({ inventory: { oak_log: 3 }, skills: { candidates: () => [{ skill: 'gather_mine', key: 'mine', description: 'Mine', fn: async () => { started.resolve(); return new Promise(() => {}); } }] }, experience: { record: (event) => { records.push(event); return records.length; }, enqueue: (episode) => episodes.push(episode), retrieve: () => [], stats: () => ({}) }, models: { plan: async (state) => ({ result: { objective: state.ownerRequest?.text || 'idle', targets: { oak_log: 4 } } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('old request', 'Steve');
  const running = f.agent.step(); await started.promise;
  f.agent.request('new request', 'Steve');
  await running;
  assert.equal(records.length, 1);
  assert.equal(records[0].goal, 'old request');
  assert.equal(records[0].result.status, 'unconfirmed');
  assert.equal(episodes[0].goal, 'old request');
});

test('portal transition reviews each stage against its evidence world', async () => {
  const recorded = [], queued = [];
  const portal = { action: 'portal', args: { position: { x: 0, y: 64, z: 0 } } };
  const observe = { action: 'observe', args: { kind: 'inventory' } };
  const f = fixture({ skills: { candidates: () => [] }, actions: { candidates: (ctx) => ctx.plan.operations.map((operation) => ({ skill: operation.action, key: operation.action, description: operation.action, operation, fn: async () => {
    if (operation.action === 'portal') f.bot.game.dimension = 'the_nether';
    return { status: 'success', summary: operation.action, evidence: { changed: true } };
  } })) }, experience: { record: (event) => { recorded.push(event); return recorded.length; }, enqueue: (episode) => queued.push(episode), retrieve: () => [], stats: () => ({}) }, models: { plan: async () => ({ result: { objective: 'Visit Nether', targets: {}, steps: [{ id: 'travel', description: 'Enter portal', operations: [portal] }, { id: 'inspect', description: 'Inspect', operations: [observe] }] } }), decide: async (_, opts) => ({ selected: opts[0] }) } });
  f.agent.request('visit nether', 'Steve');
  await f.agent.step(); await f.agent.step();
  assert.deepEqual(recorded.map((event) => event.world), ['local:25565:overworld', 'local:25565:the_nether']);
  assert.deepEqual(queued.filter((episode) => episode.reason === 'stage_complete').map((episode) => episode.world), ['local:25565:overworld', 'local:25565:the_nether']);
});
