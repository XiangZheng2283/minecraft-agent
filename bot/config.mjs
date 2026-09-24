// Loads agents/<name>/agent.json. Any string may reference the environment as ${VAR} or ${VAR:-default}.
import fs from 'node:fs';
import path from 'node:path';

export const AGENTS_DIR = 'agents';

export function expandEnv(value, env = process.env) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, name, fallback) => env[name] ?? fallback ?? '');
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v, env)]));
  return value;
}

const defaults = {
  enabled: true,
  mode: 'general',
  account: { username: '', auth: 'offline' },
  server: { host: '127.0.0.1', port: 25565, version: '1.16.5' },
  role: 'General survival helper',
  duties: [],
  goals: [],
  owners: [],
  api: { port: 0 },
  models: {
    planner: { baseUrl: '${PLANNER_BASE_URL:-https://openrouter.ai/api}', model: '${PLANNER_MODEL:-openai/gpt-6-astra}', apiKeyEnv: 'PLANNER_API_KEY' },
    decision: { baseUrl: '${DECISION_BASE_URL:-https://api.typesafe.ai}', model: '${DECISION_MODEL:-jev-latest}', apiKeyEnv: 'DECISION_API_KEY' },
    reviewer: { baseUrl: '${REVIEWER_BASE_URL:-https://openrouter.ai/api}', model: '${REVIEWER_MODEL:-openai/gpt-6-sol}', apiKeyEnv: 'REVIEWER_API_KEY' },
  },
  actions: { allow: ['*'], deny: [] },
  planIntervalMs: 0,
  observe: { radius: 24, intervalMs: 3000 },
};

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  return out;
}

export function validate(config) {
  const errors = [];
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(config.name || '')) errors.push('name must be 1-32 letters, digits, _ or -');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(config.account.username) && config.account.auth === 'offline') errors.push('account.username must be a 3-16 character Minecraft name for offline auth');
  if (!['offline', 'microsoft'].includes(config.account.auth)) errors.push('account.auth must be offline or microsoft');
  if (!['general', 'dragon-speedrun'].includes(config.mode)) errors.push('mode must be general or dragon-speedrun');
  if (!Array.isArray(config.owners) || config.owners.some((o) => typeof o !== 'string')) errors.push('owners must be a list of player names');
  for (const key of ['duties', 'goals']) if (!Array.isArray(config[key])) errors.push(key + ' must be a list');
  const port = Number(config.server.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('server.port must be a TCP port');
  if (errors.length) throw new Error(`Invalid agent config "${config.name}": ` + errors.join('; '));
  return config;
}

export function resolveModel(model, env = process.env) {
  return { baseUrl: String(model.baseUrl || '').replace(/\/+$/, ''), model: model.model, apiKey: env[model.apiKeyEnv] || (model.apiKeyEnv === 'DECISION_API_KEY' ? env.TYPESAFE_API_KEY : undefined), apiKeyEnv: model.apiKeyEnv };
}

export function loadAgent(name, { dir = AGENTS_DIR, env = process.env } = {}) {
  const file = path.join(dir, name, 'agent.json');
  if (!fs.existsSync(file)) throw new Error(`No agent config at ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = expandEnv(merge(defaults, { ...raw, name: raw.name || name }), env);
  config.server.port = Number(config.server.port);
  config.api.port = Number(config.api.port) || 0;
  config.dir = path.join(dir, name);
  config.dataDir = path.join(config.dir, 'data');
  config.models = { planner: resolveModel(config.models.planner, env), decision: resolveModel(config.models.decision, env), reviewer: resolveModel(config.models.reviewer, env) };
  return validate(config);
}

export function listAgents({ dir = AGENTS_DIR } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'agent.json'))).map((d) => d.name);
}

// Skill names support "*" and prefix wildcards such as "combat_*".
export function actionAllowed(config, skill) {
  const match = (pattern) => pattern === '*' || pattern === skill || (pattern.endsWith('*') && skill.startsWith(pattern.slice(0, -1)));
  return config.actions.allow.some(match) && !config.actions.deny.some(match);
}
