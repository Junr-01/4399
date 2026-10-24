import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, identity } from '../scripts/server.mjs';

let server;
let base;
before(async () => {
  server = await startServer(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('serves the homepage, JavaScript and every cover with browser MIME types', async () => {
  const home = await fetch(base);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /和AI玩几把/);
  assert.match(html, /type="module" src="\/app.mjs"/);
  for (const route of ['/app.mjs', '/games.mjs', '/selection.mjs']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const id of ['gomoku', 'chess', 'xiangqi', '2048', 'snake']) {
    const response = await fetch(`${base}/assets/covers/${id}.svg`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.match(await response.text(), /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  }
});

test('HEAD has the same type as GET but no response body', async () => {
  const response = await fetch(`${base}/styles.css`, { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/css/);
  assert.equal(await response.text(), '');
});

test('health identifies the running installation for launch and stop', async () => {
  const response = await fetch(`${base}/health`);
  const health = await response.json();
  assert.equal(health.app, '4399');
  assert.equal(health.id, identity);
  assert.equal(health.pid, process.pid);
});

test('does not expose repo files or allow writes', async () => {
  for (const route of ['/.git/config', '/plugin.json', '/%2e%2e%2fplugin.json', '/assets/%2e%2e%2fplugin.json', '/missing.html']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
  const response = await fetch(base, { method: 'POST', body: 'unexpected' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});
