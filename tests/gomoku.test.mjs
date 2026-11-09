import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [
  { id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true },
];
const config = { size: 9, model: 'example', effort: 'high', first: 'you' };

async function game(t, move) {
  const codex = {
    catalog: async () => models,
    openMatch: config => ({ move: (position, signal) => move(position, signal, config), dispose() {} }),
    close() {},
  };
  const server = await startServer(0, { codex });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });

  async function request(path, body, status = 200) {
    const response = await fetch(origin + '/api/gomoku' + path, body === undefined ? {} : {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    return response.json();
  }

  async function settled(id) {
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const state = await request('/matches/' + id);
      if (!state.thinking) return state;
      await delay(5);
    }
    assert.fail('AI turn did not settle');
  }

  return { origin, request, settled };
}

test('starts from the available model catalog and rejects unsupported settings and cross-origin writes', async t => {
  const { origin, request } = await game(t, () => assert.fail('should not start a turn'));
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, effort: 'medium' }, 400);
  await request('/matches', { ...config, size: 19 }, 400);
  const crossOrigin = await fetch(origin + '/api/gomoku/matches', {
    method: 'POST',
    headers: { Origin: 'http://example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  assert.equal(crossOrigin.status, 403);
  const state = await request('/matches', config, 201);
  assert.equal(state.config.effort, 'high');
  assert.equal(state.humanColor, 'black');
  assert.deepEqual(state.moves, []);
});

test('undo cancels a pending response and the next turn receives only the updated position', async t => {
  const entered = Promise.withResolvers();
  const late = Promise.withResolvers();
  let turns = 0;
  const { request, settled } = await game(t, (position, signal, selected) => {
    assert.equal(selected.effort, 'high');
    if (++turns === 1) {
      entered.resolve(signal);
      return late.promise;
    }
    assert.deepEqual(position, { size: 9, aiColor: 'white', moves: [{ row: 5, col: 5, color: 'black' }] });
    return { row: 5, col: 4 };
  });
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const signal = await entered.promise;
  assert.deepEqual((await request(path, { action: 'undo' })).moves, []);
  assert.equal(signal.aborted, true);
  await request(path, { action: 'move', row: 5, col: 5 });
  late.resolve({ row: 4, col: 5 });
  assert.deepEqual((await settled(id)).moves, [
    { row: 5, col: 5, color: 'black' },
    { row: 5, col: 4, color: 'white' },
  ]);
  assert.deepEqual((await request(path, { action: 'undo' })).moves, []);
});

test('keeps an AI opening, rejects an occupied reply, and allows retry with the same board', async t => {
  let turn = 0;
  const { request, settled } = await game(t, position => {
    turn++;
    if (turn === 1) return { row: 4, col: 4 };
    assert.equal(position.moves.length, 2);
    return turn === 2 ? { row: 4, col: 4 } : { row: 3, col: 4 };
  });
  const { id } = await request('/matches', { ...config, first: 'ai' }, 201);
  const path = '/matches/' + id;
  assert.equal((await settled(id)).canUndo, false);
  await request(path, { action: 'move', row: 4, col: 4 }, 400);
  await request(path, { action: 'move', row: 4, col: 5 });
  const failed = await settled(id);
  assert.match(failed.error, /无效落点/);
  assert.equal(failed.moves.length, 2);
  await request(path, { action: 'retry' });
  assert.equal((await settled(id)).moves.length, 3);
  assert.deepEqual((await request(path, { action: 'undo' })).moves, [{ row: 4, col: 4, color: 'black' }]);
});

test('pausing preserves the match and replacing it discards the old AI reply', async t => {
  const entered = Promise.withResolvers();
  const late = Promise.withResolvers();
  const { request } = await game(t, (_, signal) => {
    entered.resolve(signal);
    return late.promise;
  });
  const old = await request('/matches', config, 201);
  const path = '/matches/' + old.id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const signal = await entered.promise;
  const paused = await request(path, { action: 'pause' });
  assert.equal(paused.paused, true);
  assert.equal(paused.moves.length, 1);
  assert.equal(signal.aborted, true);
  const next = await request('/matches', { ...config, size: 13, effort: 'low', replace: old.id }, 201);
  late.resolve({ row: 4, col: 5 });
  await request(path, undefined, 404);
  assert.deepEqual((await request('/matches/' + next.id)).moves, []);
  assert.equal(next.config.size, 13);
  assert.equal(next.config.effort, 'low');
});

test('detects five in a row and undo reopens a finished match', async t => {
  let turn = 0;
  const { request, settled } = await game(t, () => ({ row: 0, col: turn++ * 2 }));
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  for (let col = 0; col < 4; col++) {
    await request(path, { action: 'move', row: 4, col });
    await settled(id);
  }
  const won = await request(path, { action: 'move', row: 4, col: 4 });
  assert.equal(won.result, 'black');
  assert.equal(won.winning.length, 5);
  assert.equal(won.thinking, false);
  await request(path, { action: 'move', row: 5, col: 5 }, 409);
  const reopened = await request(path, { action: 'undo' });
  assert.equal(reopened.result, null);
  assert.equal(reopened.moves.length, 8);
});
