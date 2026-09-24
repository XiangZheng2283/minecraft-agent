import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { gateOnNativeView } from './main.mjs';

function fakeAgent() {
  const calls = [];let paused = false;
  return { calls, start: () => calls.push('start'), pause: (from) => { paused = true; calls.push('pause:' + from); }, resume: (from) => { paused = false; calls.push('resume:' + from); }, status: () => ({ paused }), setPaused: (p) => { paused = p; } };
}

test('agent waits for the native view, pauses when it drops and resumes when it rejoins', () => {
  const bot = new EventEmitter(), agent = fakeAgent(), events = [];
  gateOnNativeView(bot, agent, { ready: false }, (type) => events.push(type));
  assert.deepEqual(agent.calls, []);
  bot.emit('nativeViewReady');
  assert.deepEqual(agent.calls, ['start']);
  bot.emit('nativeViewLost', { reason: 'ECONNRESET' });
  assert.deepEqual(agent.calls, ['start', 'pause:native-view']);
  bot.emit('nativeViewReady');
  assert.deepEqual(agent.calls, ['start', 'pause:native-view', 'resume:native-view']);
  assert.deepEqual(events, ['native_wait', 'native_ready', 'native_lost', 'native_ready']);
});

test('native gate starts at once when the view is already ready and keeps an owner pause', () => {
  const bot = new EventEmitter(), agent = fakeAgent();
  gateOnNativeView(bot, agent, { ready: true }, () => {});
  assert.deepEqual(agent.calls, ['start']);
  agent.setPaused(true);
  bot.emit('nativeViewLost', {});
  bot.emit('nativeViewReady');
  assert.deepEqual(agent.calls, ['start']);
});
