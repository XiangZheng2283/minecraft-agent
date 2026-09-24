import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadAgent } from './config.mjs';
import { createConfiguredBot } from './main.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentsDir = path.join(root, 'agents');
const launchScript = path.join(root, 'start-agent.ps1');
const pwsh = process.platform === 'win32'
  ? [process.env.PWSH_PATH, 'pwsh', 'powershell.exe'].filter(Boolean).find((candidate) =>
      spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0)
  : null;
const powershellAvailable = Boolean(pwsh);

function runLauncher(usernameEnv = {}) {
  // PowerShell's function lookup takes precedence over node.exe. Calls are
  // intercepted, so this executes the real launcher without starting a bot.
  const script = `
$ErrorActionPreference = 'Stop'
$global:agentNodeCalls = [System.Collections.Generic.List[object]]::new()
function node {
  $global:agentNodeCalls.Add([pscustomobject]@{
    args = @($args)
    helperUsername = $env:HELPER_USERNAME
    mcUsername = $env:MC_USERNAME
    owner = $env:HELPER_OWNER
    runId = $env:RUN_ID
  })
}
& $env:AGENT_LAUNCH_SCRIPT
ConvertTo-Json -InputObject $global:agentNodeCalls.ToArray() -Compress -Depth 5
`;
  const env = { ...process.env, AGENT_LAUNCH_SCRIPT: launchScript };
  delete env.HELPER_USERNAME;
  delete env.MC_USERNAME;
  Object.assign(env, usernameEnv);
  const result = spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(result.stdout.trim());
  assert.equal(calls.length, 1, 'general helper must not run the nether snapshot tool');
  assert.deepEqual(calls[0].args, ['run-agent.mjs', 'helper']);
  return calls[0];
}

test('connection options use the resolved account name for the selected agent', () => {
  const helper = loadAgent('helper', { dir: agentsDir, env: { MC_USERNAME: 'Ignored' } });
  const miner = loadAgent('miner', { dir: agentsDir, env: { MC_USERNAME: 'Ignored' } });
  const calls = [];
  const createBot = (options) => { calls.push(options); return { username: options.username }; };
  assert.equal(createConfiguredBot(helper, createBot).username, 'Helper');
  assert.equal(createConfiguredBot(miner, createBot).username, 'Miner');
  assert.deepEqual(calls.map(({ username }) => username), ['Helper', 'Miner']);
  assert.equal(calls[0].auth, 'offline');
  assert.equal(calls[1].auth, 'offline');
  const microsoft = { ...helper, account: { username: 'ProfileName', auth: 'microsoft' } };
  assert.equal(createConfiguredBot(microsoft, createBot).username, 'ProfileName');
  assert.equal(calls[2].profilesFolder, path.join(helper.dataDir, 'auth'));
});

test('helper launcher passes selected identity to config, while direct Node uses only HELPER_USERNAME', { skip: !powershellAvailable }, () => {
  const cases = [
    [{}, 'test_bot_1', 'Helper'],
    [{ MC_USERNAME: 'test_bot_1' }, 'test_bot_1', 'Helper'],
    [{ MC_USERNAME: 'OtherName' }, 'OtherName', 'Helper'],
    [{ HELPER_USERNAME: 'HelperSpecific' }, 'HelperSpecific', 'HelperSpecific'],
    [{ MC_USERNAME: 'OtherName', HELPER_USERNAME: 'HelperSpecific' }, 'HelperSpecific', 'HelperSpecific'],
  ];
  for (const [input, launchedName, directName] of cases) {
    const call = runLauncher(input);
    assert.equal(call.helperUsername, launchedName);
    assert.equal(call.mcUsername, input.MC_USERNAME ?? null);
    assert.equal(call.owner, 'command2283');
    assert.equal(call.runId, 'test_bot_1');
    const config = loadAgent('helper', { dir: agentsDir, env: { HELPER_USERNAME: call.helperUsername } });
    assert.equal(config.account.username, launchedName);
    let createBotCalls = 0;
    const fakeBot = createConfiguredBot(config, (options) => {
      createBotCalls++;
      assert.equal(options.username, launchedName);
      assert.equal(options.auth, 'offline');
      assert.equal(options.port, 25565);
      return { username: options.username };
    });
    assert.equal(createBotCalls, 1);
    assert.equal(fakeBot.username, launchedName);
    assert.equal(loadAgent('helper', { dir: agentsDir, env: input }).account.username, directName);
    assert.equal(loadAgent('miner', { dir: agentsDir, env: { ...input, HELPER_USERNAME: call.helperUsername } }).account.username, 'Miner');
  }
});

test('offline login validates the selected launcher identity before creating a bot', { skip: !powershellAvailable }, () => {
  for (const input of [{ MC_USERNAME: 'bad name' }, { MC_USERNAME: 'a'.repeat(17) }, { HELPER_USERNAME: '' }]) {
    const call = runLauncher(input);
    assert.throws(() => loadAgent('helper', { dir: agentsDir, env: { HELPER_USERNAME: call.helperUsername } }), /account.username/);
  }
});
