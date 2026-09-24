// Starts one or more agents from agents/<name>/agent.json.
//   node run-agent.mjs <name> [<name> ...]     start the named agents
//   node run-agent.mjs --all                   start every enabled agent
//   node run-agent.mjs --list                  list agents
// Each bot runs in its own child process so a crash or a long action in one never stalls the others.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgent, listAgents } from './bot/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

if (!args.length || args.includes('--help')) {
  console.log('Usage: node run-agent.mjs <agent> [...] | --all | --list');
  process.exit(args.length ? 0 : 1);
}
if (args.includes('--list')) {
  for (const name of listAgents()) {
    try { const c = loadAgent(name); console.log(`${name.padEnd(20)} ${c.enabled ? 'enabled ' : 'disabled'} ${c.mode.padEnd(16)} ${c.account.username}@${c.server.host}:${c.server.port}  api:${c.api.port || '-'}  ${c.role}`); }
    catch (e) { console.log(`${name.padEnd(20)} INVALID  ${e.message}`); }
  }
  process.exit(0);
}

const names = args.includes('--all') ? listAgents().filter((n) => loadAgent(n).enabled) : args.filter((a) => !a.startsWith('--'));
if (names.length === 1 && process.env.AGENT_CHILD !== '0') {
  await import('./bot/main.mjs').then((m) => m.runAgent(names[0]));
} else {
  const children = names.map((name) => {
    const child = spawn(process.execPath, [path.join(here, 'run-agent.mjs'), name], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    const prefix = (stream, out) => stream.on('data', (d) => out.write(d.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}\n`).join('')));
    prefix(child.stdout, process.stdout); prefix(child.stderr, process.stderr);
    child.on('exit', (code) => console.log(`[${name}] exited with code ${code}`));
    return child;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const c of children) c.kill(); process.exit(0); });
}
