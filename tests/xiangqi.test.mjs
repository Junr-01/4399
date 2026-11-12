import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [
  { id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true },
];
const config = { side: 'red', model: 'example', effort: 'high' };
const at = square => (10 - Number(square.slice(1))) * 9 + square.charCodeAt(0) - 97;

async function game(t, choose) {
  const codex = {
    catalog: async () => models,
    openMatch: (config, game) => ({
      move: (position, signal) => choose(position, signal, config, game),
      dispose() {},
    }),
    close() {},
  };
  const server = await startServer(0, { codex });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  async function request(path, body, status = 200) {
    const response = await fetch(origin + '/api/xiangqi' + path, body === undefined ? {} : {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const state = await response.json();
    assert.equal(response.status, status, JSON.stringify(state));
    return state;
  }
  async function settled(path) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await request(path);
      if (!state.thinking) return state;
      await delay(5);
    }
    assert.fail('AI turn did not settle');
  }
  return { origin, request, settled };
}

function play(request, path, state, from, to, status = 200) {
  return request(path, { action: 'move', revision: state.revision, from: at(from), to: at(to) }, status);
}

test('starts a standard red opening and gives AI only numbered legal replies', async t => {
  const { request, settled } = await game(t, (position, _, selected, game) => {
    assert.equal(game, 'xiangqi');
    assert.equal(selected.effort, 'high');
    assert.equal(position.aiSide, 'black');
    assert.equal(position.board[at('e3')], 'C');
    assert.equal(position.board[at('h3')], null);
    return { move: position.legal.find(entry => entry.from === at('b10') && entry.to === at('c8')).id };
  });
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, side: 'white' }, 400);
  await request('/matches', { ...config, effort: 'max' }, 400);
  const start = await request('/matches', config, 201);
  assert.equal(start.humanSide, 'red');
  assert.equal(start.board.filter(Boolean).length, 32);
  assert.equal(start.legal.length, 44);
  const path = '/matches/' + start.id;
  await play(request, path, start, 'h3', 'e8', 400);
  await play(request, path, start, 'h3', 'e3');
  const next = await settled(path);
  assert.equal(next.board[at('c8')].type, 'h');
  assert.equal(next.board[at('c8')].side, 'black');
  assert.equal(next.legal.length > 0, true);
  await play(request, path, start, 'b1', 'c3', 409);
});

test('black starts after the AI opening and can retry and undo a capture', async t => {
  let turns = 0;
  const { request, settled } = await game(t, position => {
    const turn = ++turns;
    if (turn === 2) return { move: -1 };
    const [from, to] = turn === 1 ? ['h3', 'e3'] : ['e3', 'e7'];
    return { move: position.legal.find(entry => entry.from === at(from) && entry.to === at(to)).id };
  });
  const start = await request('/matches', { ...config, side: 'black' }, 201);
  assert.equal(start.humanSide, 'black');
  assert.equal(start.thinking, true);
  assert.deepEqual(start.legal, []);
  const path = '/matches/' + start.id;
  const opening = await settled(path);
  assert.equal(opening.canUndo, false);
  await play(request, path, opening, 'h8', 'e8');
  const failed = await settled(path);
  assert.match(failed.error, /无效着法/);
  assert.equal(failed.board[at('e7')].type, 'p');
  await request(path, { action: 'retry', revision: failed.revision });
  const capture = await settled(path);
  assert.equal(capture.check, true);
  assert.equal(capture.lastMove.captured.type, 'p');
  const undo = await request(path, { action: 'undo', revision: failed.revision });
  assert.equal(undo.canUndo, false);
  assert.equal(undo.lastMove.side, 'red');
  assert.deepEqual(undo.board, opening.board);
});

test('pause and undo discard late replies and reopening uses the latest board', async t => {
  const first = Promise.withResolvers();
  const late = Promise.withResolvers();
  let turns = 0;
  const { request, settled } = await game(t, (position, signal) => {
    if (++turns === 1) {
      first.resolve(signal);
      return late.promise;
    }
    assert.equal(position.board[at('c3')], 'H');
    assert.equal(position.board[at('e3')], null);
    return { move: position.legal.find(entry => entry.from === at('b10') && entry.to === at('c8')).id };
  });
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  const played = await play(request, path, start, 'h3', 'e3');
  const signal = await first.promise;
  const paused = await request(path, { action: 'pause', revision: played.revision });
  assert.equal(paused.paused, true);
  assert.equal(signal.aborted, true);
  const resumed = await request(path, { action: 'resume', revision: paused.revision });
  assert.equal(resumed.paused, false);
  const undo = await request(path, { action: 'undo', revision: resumed.revision });
  await play(request, path, undo, 'b1', 'c3');
  late.resolve({ move: 0 });
  const final = await settled(path);
  assert.equal(final.lastMove.to, at('c8'));
  const pause = await request(path, { action: 'pause', revision: final.revision });
  const replacement = await request('/matches', { ...config, effort: 'low', replace: pause.id }, 201);
  assert.notEqual(replacement.id, pause.id);
  assert.equal(replacement.config.effort, 'low');
  await request(path, undefined, 404);
});

test('the same undo request cannot take back a second round', async t => {
  const { request, settled } = await game(t, position => ({ move: position.legal[0].id }));
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  await play(request, path, start, 'h3', 'e3');
  const first = await settled(path);
  const { from, to } = first.legal[0];
  await request(path, { action: 'move', from, to, revision: first.revision });
  const second = await settled(path);
  const undo = { action: 'undo', revision: second.revision };
  const restored = await request(path, undo);
  assert.deepEqual(restored.board, first.board);
  assert.equal(restored.canUndo, true);
  await request(path, undo, 409);
  assert.deepEqual((await request(path)).board, first.board);
});
