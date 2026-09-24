import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels, parsePlan } from './models.mjs';
import { loadAgent } from './config.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const config = { name: 'bob', role: 'helper', duties: [], goals: [], account: { username: 'Bob' }, server: { version: '1.16.5' }, models: {
  planner: { baseUrl: 'http://p', model: 'plan', apiKey: 'test' }, decision: { baseUrl: 'http://d', model: 'jev', apiKey: 'test' }, reviewer: { baseUrl: 'http://r', model: 'review', apiKey: 'test' },
} };
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => JSON.stringify(data) });

test('planner stages validate shape and reviewer config survives resolution', () => {
  const plan = parsePlan(JSON.stringify({ objective: 'Build', steps: [{ id: 'wood', description: 'Get wood', targets: { oak_log: 2 } }] }));
  assert.equal(plan.steps[0].id, 'wood');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-model-'));
  fs.mkdirSync(path.join(dir, 'bob'));
  fs.writeFileSync(path.join(dir, 'bob', 'agent.json'), JSON.stringify({ account: { username: 'Bobby' }, models: { reviewer: { baseUrl: 'http://r', model: 'audit', apiKeyEnv: 'REVIEWER_API_KEY' } } }));
  assert.equal(loadAgent('bob', { dir, env: { REVIEWER_API_KEY: 'secret' } }).models.reviewer.apiKey, 'secret');
  fs.writeFileSync(path.join(dir, 'bob', 'agent.json'), JSON.stringify({ account: { username: 'Bobby' }, models: { reviewer: { apiKey: 'literal-in-config' } } }));
  assert.equal(loadAgent('bob', { dir, env: {} }).models.reviewer.apiKey, undefined);
  assert.throws(() => parsePlan('{"objective":"Move","operations":[{"action":"move","args":{"x":1}}]}'), /argument|position/i);
  assert.throws(() => parsePlan('{"objective":"Move","steps":[{"id":"a","description":"Go","operations":[{"action":"unknown","args":{}}]}]}'), /action/i);
});

test('temporary HTTP failure retries a bounded number of times and tracks unknown usage', async () => {
  let requests = 0;
  const models = createModels(config, { fetchImpl: async () => ++requests === 1 ? response(429, { error: { message: 'slow down' } }) : response(200, { choices: [{ message: { content: '{"objective":"Get wood","targets":{"oak_log":2}}' } }] }), maxToolRounds: 0, retryDelay: async () => {} });
  assert.equal((await models.plan({})).result.objective, 'Get wood');
  assert.equal(requests, 2);
  assert.equal(models.stats().planner.requests, 2);
  assert.equal(models.stats().planner.retries, 1);
  assert.equal(models.stats().planner.usageUnknown, 2);
});

test('permanent HTTP failures make one request and reviewer has an independent endpoint', async () => {
  const urls = [];
  const models = createModels(config, { fetchImpl: async (url) => { urls.push(url); return response(401, { error: { message: 'bad key' } }); }, retryDelay: async () => {} });
  await assert.rejects(models.plan({}), /401/);
  assert.deepEqual(urls, ['http://p/v1/chat/completions']);
  await assert.rejects(models.review({}), /401/);
  assert.equal(urls.at(-1), 'http://r/v1/chat/completions');
});

test('planner refuses oversized tool batches before invoking tools', async () => {
  let invoked = 0, requests = 0;
  const calls = Array.from({ length: 9 }, (_, i) => ({ id: `call-${i}`, function: { name: 'query_world', arguments: '{}' } }));
  const models = createModels(config, { fetchImpl: async () => { requests++; return response(200, { choices: [{ message: { tool_calls: calls } }] }); }, tools: { query_world: () => { invoked++; return []; } } });
  await assert.rejects(models.plan({}), /tool call limit/i);
  assert.equal(requests, 1);
  assert.equal(invoked, 0);
});

test('GPT-6 Luna planner tool calls use the supported Chat Completions effort', async () => {
  const requests = [];
  const luna = { ...config, models: { ...config.models, planner: { ...config.models.planner, model: 'gpt-6-luna' } } };
  const models = createModels(luna, { fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return response(200, { choices: [{ message: { content: '{"objective":"Gather logs","targets":{"oak_log":2}}' } }] });
  } });
  await models.plan({});
  assert.equal(requests[0].reasoning_effort, 'none');
  assert.equal(requests[0].tool_choice, 'auto');
  assert.ok(Array.isArray(requests[0].tools));
});

test('inherited object properties are not callable planner tools', async () => {
  let requests = 0;
  const models = createModels(config, { fetchImpl: async () => {
    requests++;
    return requests === 1 ? response(200, { choices: [{ message: { tool_calls: [{ id: 't', function: { name: 'toString', arguments: '{}' } }] } }] })
      : response(200, { choices: [{ message: { content: '{"objective":"Wait"}' } }] });
  }, tools: {} });
  const result = await models.plan({});
  assert.equal(result.toolCalls[0].tool, 'toString');
  assert.equal(requests, 2);
});
