import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [{ id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }];
const config = { side: 'black', model: 'example', effort: 'high' };
const chooseMove = (position, from, to) => ({ move: position.legal.find(entry => entry.from === from && entry.to === to).id });

async function game(t, choose) {
  const server = await startServer(0, { codex: {
    catalog: async () => models,
    openMatch: (options, game) => ({ move: (position, signal) => choose(position, signal, options, game), dispose() {} }),
    close() {},
  } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));

  async function request(path, body, status = 200) {
    const response = await fetch(origin + '/api/chess' + path, body === undefined ? {} : {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    return response.json();
  }

  const read = id => request('/matches/' + id);
  async function settled(id) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const state = await read(id);
      if (!state.thinking) return state;
      await delay(5);
    }
    assert.fail('AI turn did not settle');
  }

  return {
    request, read, settled,
    start: (options = config) => request('/matches', options, 201),
    act: (state, action, fields, status) => request('/matches/' + state.id, { action, revision: state.revision, ...fields }, status),
  };
}

test('black keeps the AI opening when taking back a turn after an invalid reply and retry', async t => {
  const replies = [];
  const { request, start, act, settled } = await game(t, (position, _, options, game) => {
    assert.equal(game, 'chess');
    assert.equal(options.model, 'example');
    assert.equal(options.effort, 'high');
    assert.equal(position.aiSide, 'white');
    replies.push(position);
    if (replies.length === 1) {
      assert.match(position.fen, / w KQkq - 0 1$/);
      assert.equal(position.legal.length, 20);
      return chooseMove(position, 'e2', 'e4');
    }
    return replies.length === 2 ? { move: -1 } : chooseMove(position, 'g1', 'f3');
  });
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, effort: 'max' }, 400);
  const startState = await start();
  assert.equal(startState.humanSide, 'black');
  assert.deepEqual(startState.legal, []);
  const opened = await settled(startState.id);
  assert.deepEqual(opened.lastMove, { from: 'e2', to: 'e4', side: 'white', san: 'e4' });
  assert.equal(opened.canUndo, false);
  await act(opened, 'move', { from: 'e7', to: 'e4' }, 400);
  await act(opened, 'move', { from: 'e7', to: 'e5' });
  const failed = await settled(opened.id);
  assert.match(failed.error, /无效着法/);
  assert.equal(failed.lastMove.san, 'e5');
  await act(failed, 'retry');
  const answered = await settled(opened.id);
  assert.deepEqual(replies[1], replies[2]);
  assert.equal(answered.lastMove.san, 'Nf3');
  const undone = await act(failed, 'undo');
  assert.equal(undone.canUndo, false);
  assert.deepEqual(undone.lastMove, opened.lastMove);
  assert.deepEqual(undone.board, opened.board);
  await act(failed, 'undo', {}, 409);
});

test('undo and pause cancel a pending reply, and confirming a new game releases the old one', async t => {
  const first = Promise.withResolvers();
  const late = Promise.withResolvers();
  let turns = 0;
  const { request, read, start, act, settled } = await game(t, (position, signal) => {
    if (++turns === 1) {
      first.resolve(signal);
      return late.promise;
    }
    assert.match(position.fen, / b KQkq - 0 1$/);
    return chooseMove(position, 'd7', 'd5');
  });
  const original = await start({ ...config, side: 'white' });
  const pending = await act(original, 'move', { from: 'e2', to: 'e4' });
  const signal = await first.promise;
  const undone = await act(pending, 'undo');
  assert.equal(signal.aborted, true);
  assert.deepEqual(undone.board, original.board);
  late.resolve({ move: 0 });
  await act(undone, 'move', { from: 'd2', to: 'd4' });
  const answered = await settled(original.id);
  assert.equal(answered.lastMove.san, 'd5');
  const paused = await act(answered, 'pause');
  assert.deepEqual(paused.legal, []);
  assert.equal((await act(paused, 'resume')).paused, false);

  const current = await act(await read(original.id), 'pause');
  const replacement = await start({ ...config, side: 'white', effort: 'low', replace: current.id });
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.config.effort, 'low');
  assert.equal(replacement.lastMove, null);
  await request('/matches/' + original.id, undefined, 404);
});

test('a reply arriving after pause and replacement cannot change either game', async t => {
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  const { request, read, start, act } = await game(t, (_, signal) => {
    started.resolve(signal);
    return late.promise;
  });
  const original = await start({ ...config, side: 'white' });
  const pending = await act(original, 'move', { from: 'e2', to: 'e4' });
  const signal = await started.promise;
  const paused = await act(pending, 'pause');
  assert.equal(signal.aborted, true);
  assert.equal(paused.lastMove.san, 'e4');
  const replacement = await start({ ...config, side: 'white', replace: paused.id });
  late.resolve({ move: 0 });
  await request('/matches/' + original.id, undefined, 404);
  assert.deepEqual(await read(replacement.id), replacement);
});
