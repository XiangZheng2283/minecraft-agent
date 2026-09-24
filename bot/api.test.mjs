import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApiHandler } from './api.mjs';

async function request(handler, method, url, body) {
  const req = new EventEmitter(); Object.assign(req, { method, url, setEncoding: () => {} });
  let status, value;
  const pending = handler(req, { writeHead: (n) => { status = n; }, end: (text) => { value = JSON.parse(text); } });
  if (body !== undefined) req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
  req.emit('end'); await pending;
  return { status, value };
}

test('local HTTP inputs cannot expand model queries or goals without bounds', async () => {
  let calls = 0;
  const handler = createApiHandler({ config: { name: 'helper' }, recall: async () => { calls++; return []; }, request: () => { calls++; return { accepted: true }; } });
  for (const url of ['/knowledge?q=wood&limit=-1', '/knowledge?q=wood&limit=999999', '/knowledge?q=' + 'x'.repeat(513)])
    assert.equal((await request(handler, 'GET', url)).status, 400);
  assert.equal((await request(handler, 'POST', '/goal', { text: 'x'.repeat(4001) })).status, 400);
  assert.equal((await request(handler, 'POST', '/goal', { text: {} })).status, 400);
  assert.equal((await request(handler, 'POST', '/goal', 'x'.repeat(16001))).status, 413);
  assert.equal(calls, 0);
  assert.equal((await request(handler, 'GET', '/knowledge?q=wood&limit=3')).status, 200);
  assert.equal((await request(handler, 'POST', '/goal', { text: 'collect wood' })).status, 200);
  assert.equal(calls, 2);
});

test('internal API exceptions do not expose raw server error text', async () => {
  const handler = createApiHandler({ status: () => { throw new Error('private internal details'); } });
  assert.deepEqual(await request(handler, 'GET', '/status'), { status: 500, value: { error: 'Internal request error' } });
});
