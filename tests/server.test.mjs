import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, identity } from '../scripts/server.mjs';
import { games } from '../app/games.mjs';

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
  for (const route of ['/app.mjs', '/games.mjs', '/selection.mjs', '/match-session.mjs', '/flip-match.mjs',
    '/shared/junqi-board.mjs', '/shared/xiangqi-position.mjs']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const { id } of games) {
    const response = await fetch(`${base}/assets/covers/${id}.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), bytes.readUInt32BE(20), `${id} cover should be square`);
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
  assert.equal(health.app, '43gg');
  assert.equal(health.id, identity);
  assert.equal(health.pid, process.pid);
});

test('does not expose repo files or allow writes', async () => {
  for (const route of ['/.git/config', '/plugin.json', '/%2e%2e%2fplugin.json', '/assets/%2e%2e%2fplugin.json',
    '/scripts/server.mjs', '/shared/%2e%2e%2fscripts%2fserver.mjs', '/missing.html']) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  assert.equal((await fetch(`${base}/%ZZ`)).status, 400);
  const response = await fetch(base, { method: 'POST', body: 'unexpected' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('every listed game has a page, an entry module and a match route', async () => {
  for (const { id, href } of games) {
    const page = await fetch(base + href);
    assert.equal(page.status, 200, id);
    assert.ok((await page.text()).includes(`type="module" src="/${id}.mjs"`), id);
    const entry = await fetch(`${base}/${id}.mjs`);
    assert.equal(entry.status, 200, id);
    assert.match(entry.headers.get('content-type'), /javascript/);
    const match = await fetch(`${base}/api/${id}/matches/00000000-0000-0000-0000-000000000000`);
    assert.equal(match.status, 404, id);
    assert.match((await match.json()).error, /本局已结束/);
  }
});
