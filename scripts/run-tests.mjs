// Only *.test.mjs are unit tests. setup-*-test.mjs scripts prepare live worlds
// and must never be discovered by the default offline test command.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
function collect(directory, recurse) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory() && recurse) collect(filename, true);
    else if (entry.isFile() && entry.name.endsWith('.test.mjs')) files.push(filename);
  }
}
collect(root, false);
collect(path.join(root, 'bot'), true);
collect(path.join(root, 'optimization'), true);
const run = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files.sort()], { cwd: root, stdio: 'inherit' });
if (run.error) throw run.error;
process.exitCode = run.status ?? 1;
