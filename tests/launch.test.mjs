import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identity } from '../scripts/server.mjs';

const run = promisify(execFile);

test('launch replaces an older service from the same installation', { timeout: 10_000 }, async t => {
  const old = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createServer } from 'node:http';
    const server = createServer((req, res) => {
      if (req.url !== '/health') {
        res.writeHead(404).end('Not found');
        return;
      }
      res.end(JSON.stringify({ app: '4399', id: ${JSON.stringify(identity)}, version: '0.1.0', pid: process.pid }));
    });
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => old.kill());
  const lines = createInterface({ input: old.stdout });
  const [port] = await once(lines, 'line');
  const options = { env: { ...process.env, PORT: port }, timeout: 6000 };
  t.after(() => run(process.execPath, ['scripts/stop.mjs'], options));
  const { stdout } = await run(process.execPath, ['scripts/launch.mjs'], options);
  const launch = JSON.parse(stdout);
  assert.equal(launch.reused, false);
  assert.notEqual(launch.pid, old.pid);
  const response = await fetch(launch.url + 'gomoku.html');
  assert.equal(response.status, 200);
  const second = await run(process.execPath, ['scripts/launch.mjs'], options);
  assert.equal(JSON.parse(second.stdout).pid, launch.pid);
});
