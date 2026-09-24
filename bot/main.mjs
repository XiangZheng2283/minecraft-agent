// Wires one agent: config -> mineflayer bot -> world memory, shared knowledge, skills, models, chat and HTTP API.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import { loadAgent } from './config.mjs';
import { openWorld } from './world-db.mjs';
import { installObserver } from './observer.mjs';
import { createSkills } from './skills.mjs';
import { ACTION_CATALOG, createActionRegistry } from './actions.mjs';
import { createModels } from './models.mjs';
import { openExperience } from './experience.mjs';
import { createReviewer } from './reviewer.mjs';
import { createAgent } from './agent.mjs';
import { startApi } from './api.mjs';

const { pathfinder, Movements } = pf;
export const KNOWLEDGE_DB = process.env.KNOWLEDGE_DB || 'data/knowledge/knowledge.db';

// The dragon speedrun keeps its tuned, route-specific runtime; the agent config only supplies identity and models.
export function speedrunEnv(config, env = process.env) {
  const { planner, decision } = config.models;
  return {
    ...env,
    MC_USERNAME: config.account.username, MC_PORT: String(config.server.port), RUN_ID: env.RUN_ID || config.name,
    PLANNER_BASE_URL: planner.baseUrl, PLANNER_MODEL: planner.model, ...(planner.apiKey ? { PLANNER_API_KEY: planner.apiKey } : {}),
    DECISION_BASE_URL: decision.baseUrl, DECISION_MODEL: decision.model, ...(decision.apiKey ? { DECISION_API_KEY: decision.apiKey } : {}),
    NATIVE_VIEW: env.NATIVE_MIRROR_BOT && env.NATIVE_MIRROR_BOT !== config.name ? '0' : env.NATIVE_VIEW || '0',
    ...(config.api.port ? { STATUS_PORT: String(config.api.port) } : {}),
  };
}

export function botConnectionOptions(config) {
  return {
    host: config.server.host, port: config.server.port, version: config.server.version,
    username: config.account.username, auth: config.account.auth, checkTimeoutInterval: 120000,
    ...(config.account.auth === 'microsoft' ? { profilesFolder: path.join(config.dataDir, 'auth') } : {}),
  };
}

export function createConfiguredBot(config, createBot = mineflayer.createBot) {
  return createBot(botConnectionOptions(config));
}

// With the native view on, the agent acts only while the native client shows the game:
// it starts after the client has loaded and joined, pauses when the client drops, and resumes once it rejoins.
// An owner pause is left alone. WAIT_NATIVE=0 turns this off.
export function gateOnNativeView(bot, agent, mirror, log) {
  let started = false, pausedByNative = false;
  const ready = () => {
    if (!started) { started = true; log('native_ready', {}); agent.start(); return; }
    if (pausedByNative) { pausedByNative = false; log('native_ready', { resumed: true }); agent.resume('native-view'); }
  };
  bot.on('nativeViewReady', ready);
  bot.on('nativeViewLost', ({ reason } = {}) => {
    log('native_lost', { reason });
    if (started && !agent.status().paused) { pausedByNative = true; agent.pause('native-view'); }
  });
  if (mirror.ready) ready();
  else { log('native_wait', {}); console.log('Waiting for the native client to load and join before acting'); }
}

export async function runAgent(name) {
  const config = loadAgent(name);
  if (config.mode === 'dragon-speedrun') {
    const child = spawn(process.execPath, [config.script || 'nether-agent.mjs'], { stdio: 'inherit', env: speedrunEnv(config) });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  fs.mkdirSync(config.dataDir, { recursive: true });
  const logFile = path.join(config.dataDir, 'events.jsonl');
  const log = (type, data = {}) => {
    fs.appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), type, ...data }) + '\n');
    if (/error|failed|ready|request|plan$|done/.test(type)) console.log(type, JSON.stringify(data).slice(0, 300));
  };

  const world = openWorld(path.join(config.dataDir, 'world.db'));
  let knowledge = null;
  try {
    const { openKnowledge } = await import('./knowledge.mjs');
    knowledge = openKnowledge({ path: KNOWLEDGE_DB, log });
    const recipes = knowledge.ingestRecipes(config.server.version), chunks = knowledge.ingestMarkdown('data/knowledge');
    log('knowledge_ready', { recipes, chunks, ...knowledge.stats() });
  } catch (e) { log('knowledge_error', { error: e.message }); }

  const bot = createConfiguredBot(config);
  bot.loadPlugin(pathfinder);
  let nativeMirror = null;
  if (process.env.NATIVE_VIEW === '1' && (!process.env.NATIVE_MIRROR_BOT || process.env.NATIVE_MIRROR_BOT === config.name)) {
    const { installNativeMirror } = await import('../native-mirror.mjs');
    nativeMirror = installNativeMirror(bot);
    log('native_mirror', { bot: config.name });
  }

  const tools = {};
  const models = createModels(config, { tools, actionCatalog: ACTION_CATALOG });
  const skills = createSkills(bot, { world, owners: config.owners });
  const actions = createActionRegistry(bot, { skills, world, timeouts: { action: config.actionTimeoutMs } });
  const experience = openExperience({ path: path.join(config.dataDir, 'experience.db') });
  const reviewer = createReviewer({ store: experience, review: config.models.reviewer?.apiKey ? models.review : null, config: config.review || {}, log: (message) => log('review_event', { message }) });
  const agent = createAgent({ config, bot, world, knowledge, skills, actions, experience, reviewer, models, log });
  Object.assign(tools, agent.tools);
  reviewer.kick().catch((error) => log('review_error', { error: error.message }));

  bot.once('spawn', () => {
    bot.pathfinder.setMovements(new Movements(bot));
    installObserver(bot, world, { ...config.observe, log });
    log('spawned', { username: bot.username, position: bot.entity.position, dimension: bot.game.dimension });
    if (nativeMirror && process.env.WAIT_NATIVE !== '0') gateOnNativeView(bot, agent, nativeMirror, log);
    else agent.start();
  });
  bot.on('kicked', (reason) => log('kicked', { reason: String(reason) }));
  bot.on('error', (e) => log('bot_error', { error: e.message }));
  bot.on('end', async (reason) => { log('disconnected', { reason }); await reviewer.stop(); experience.close(); world.close(); knowledge?.close(); process.exit(1); });
  const api = startApi(config.api.port, agent, { log });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { agent.stop(); api?.close(); bot.quit(); });
  return agent;
}
