import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const options = {
  timeout: 5000, skip: process.platform === 'win32' && 'The fake CLI uses a POSIX executable script',
};
const model = { model: 'example', effort: 'low' };

async function playOpening(t, game, config, tool, move, successMessage) {
  const directory = await mkdtemp(join(tmpdir(), '43gg-app-server-test-'));
  const workspace = join(directory, game);
  const executable = join(directory, 'codex.mjs');
  const trace = join(directory, 'opening.jsonl');
  const fixture = new URL('./fixtures/opening-codex.mjs', import.meta.url);
  const previous = process.env.CODEX_BIN;
  let server;
  t.after(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(executable, `#!${process.execPath}
import { runOpening } from ${JSON.stringify(fixture.href)};
runOpening(${JSON.stringify({ tool, move, trace })});
`, { mode: 0o700 });
  process.env.CODEX_BIN = executable;
  server = await startServer(0, { [game + 'Directory']: workspace });
  const origin = 'http://127.0.0.1:' + server.address().port;

  async function request(path, body, status = body === undefined ? 200 : 201) {
    const response = await fetch(`${origin}/api/${game}${path}`, {
      signal: t.signal,
      ...(body === undefined ? {} : {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  }

  const { id } = await request('/reservations', {});
  const opening = await request('/matches', { ...config, ...model, id });
  assert.equal(opening.thinking, true);
  const path = '/matches/' + id;
  let after = await request(path);
  while (after.thinking) {
    await delay(5, undefined, { signal: t.signal });
    after = await request(path);
  }

  const calls = (await readFile(trace, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1, 'the opening should complete on its first attempt');
  const [exchange] = calls;
  assert.equal(after.error, null);
  assert.equal(after.revision, opening.revision + 1);
  assert.equal(exchange.thread.cwd, join(workspace, id));
  const tools = exchange.thread.dynamicTools;
  assert.deepEqual(tools.map(({ name }) => name).sort(), ['get_position', tool]);
  assert.deepEqual(tools.find(({ name }) => name === 'get_position').inputSchema, {
    type: 'object', properties: {}, additionalProperties: false,
  });
  assert.deepEqual(exchange.turn.input, [{ type: 'text', text: '棋局开始' }]);
  assert.equal(exchange.position.success, true);
  assert.equal(exchange.position.contentItems[0].type, 'inputText');
  const position = JSON.parse(exchange.position.contentItems[0].text);
  assert.equal(position.moveCommitted, false);
  assert.deepEqual(exchange.move, {
    success: true, contentItems: [{ type: 'inputText', text: successMessage }],
  });
  const play = action => request(path, { ...action, revision: after.revision }, 200);
  return { opening, position, after, play, schema: tools.find(({ name }) => name === tool).inputSchema };
}

test('chess opens through App Server with algebraic move coordinates', options, async t => {
  const move = { from: 'e2', to: 'e4' };
  const { position, after, play, schema } = await playOpening(t, 'chess', { side: 'black' }, 'move_piece', move, '走棋成功。');
  assert.deepEqual(schema.required, ['from', 'to']);
  for (const key of ['from', 'to']) {
    const { type, pattern } = schema.properties[key];
    assert.equal(type, 'string');
    assert.match(move[key], new RegExp(pattern));
    assert.doesNotMatch('e9', new RegExp(pattern));
  }
  assert.equal(position.fen, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  assert.equal(position.lastMove, null);
  assert(position.legal.some(({ from, to }) => from === move.from && to === move.to));
  assert.deepEqual(after.lastMove, { ...move, side: 'white', san: 'e4' });
  assert.equal(after.aiTurn, false);
  assert.equal(after.side, 'black');
  assert(after.legal.some(({ from, to }) => from === 'e7' && to === 'e5'));
  const reply = await play({ action: 'move', from: 'e7', to: 'e5' });
  assert.deepEqual(reply.lastMove, { from: 'e7', to: 'e5', side: 'black', san: 'e5' });
});

for (const { game, size, camps } of [
  { game: 'junqi', size: 60, camps: [11, 13, 17, 21, 23, 36, 38, 42, 46, 48] },
  { game: 'banqi', size: 32, camps: [] },
]) {
  test(`${game} opens through App Server without exposing hidden pieces`, options, async t => {
    const move = { action: 'flip', to: 0 };
    const { opening, position, after, play, schema } = await playOpening(t, game, { first: 'ai' }, 'play_action', move, '行动成功。');
    assert.deepEqual(schema.required, ['action', 'to']);
    assert.deepEqual(schema.properties.action.enum, ['flip', 'move']);
    assert.deepEqual(schema.properties.to, { type: 'integer', minimum: 0, maximum: size - 1 });
    const masked = Array.from({ length: size }, (_, point) => camps.includes(point) ? null : 'dark');
    assert.deepEqual(position.board, masked);
    assert.deepEqual(opening.board, masked);
    assert.equal(position.last, null);
    assert.deepEqual(position.legal, masked.flatMap((cell, to) => cell === 'dark' ? [{ action: 'flip', to }] : []));
    assert.equal(after.ply, 1);
    assert.equal(typeof after.board[0].type, 'string');
    assert.deepEqual(after.board.slice(1), masked.slice(1));
    assert.deepEqual(after.last, { ...move, player: 'ai', piece: after.board[0] });
    assert.equal(after.turn, 'human');
    assert(after.legal.some(action => action.action === 'flip' && action.to === 1));
    const reply = await play({ action: 'flip', to: 1 });
    assert.equal(reply.ply, 2);
    assert.deepEqual(reply.last, { action: 'flip', to: 1, player: 'human', piece: reply.board[1] });
  });
}
