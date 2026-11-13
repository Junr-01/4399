import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [{ id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }];
const config = { first: 'human', model: 'example', effort: 'high' };
const answer = (position, action, to, from) => ({
  move: position.legal.find(entry => entry.action === action && entry.to === to && entry.from === from).id,
});

async function game(t, choose, { random, catalog = async () => models } = {}) {
  const disposed = [];
  const server = await startServer(0, { junqiRandom: random, codex: {
    catalog,
    openMatch(options, name) {
      return {
        move: (position, signal) => choose(position, signal, options, name),
        dispose: () => disposed.push(name),
      };
    },
    close() {},
  } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));

  async function request(path, body, status = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/api/junqi' + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, status);
    if (status !== 204) return response.json();
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
    request, read, settled, disposed,
    reserve: () => request('/reservations', {}, 201).then(({ id }) => id),
    start: async (options = config) => {
      const { id } = await request('/reservations', {}, 201);
      return request('/matches', { ...options, id }, 201);
    },
    act: (state, action, fields, status) => request('/matches/' + state.id, { action, revision: state.revision, ...fields }, status),
    remove: id => request('/matches/' + id, undefined, 204, 'DELETE'),
  };
}

test('the API validates settings and sends the selected model a numbered, public opening', async t => {
  const seen = Promise.withResolvers();
  const { request, start, settled, act, remove, disposed } = await game(t, (position, _, options, name) => {
    seen.resolve({ position, options, name });
    return answer(position, 'flip', 0);
  });
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, first: 'red' }, 400);
  await request('/matches', { ...config, effort: 'max' }, 400);
  const opening = await start({ ...config, first: 'ai' });
  assert.equal(opening.thinking, true);
  assert.deepEqual(opening.legal, []);
  assert.equal(opening.board.filter(cell => cell === 'dark').length, 50);

  const { position, options, name } = await seen.promise;
  assert.equal(name, 'junqi');
  assert.deepEqual(options, { ...config, first: 'ai', modelName: 'Example' });
  assert.deepEqual(position.board, opening.board);
  assert.deepEqual(position.legal[0], { action: 'flip', to: 0, id: 0 });
  assert.equal(position.legal.length, 50);
  assert.ok(position.legal.every(({ action, to, id }) =>
    action === 'flip' && Number.isInteger(id) && position.board[to] === 'dark'));
  const after = await settled(opening.id);
  assert.equal(after.turn, 'human');
  assert.deepEqual(after.last.piece, after.board[0]);
  assert.deepEqual(after.legal[0], { action: 'flip', to: 1 });
  assert.equal(after.canUndo, false);
  await act(after, 'flip', { to: 0 }, 400);
  await act(after, 'undo', {}, 409);
  await remove(opening.id);
  assert.deepEqual(disposed, ['junqi']);
  await request('/matches/' + opening.id, undefined, 404);
});

test('different dark layouts are identical to the browser and AI before they are revealed', async t => {
  const observations = [];
  let value = 0.1;
  const { start, settled } = await game(t, position => {
    observations.push(position);
    return answer(position, 'flip', 0);
  }, { random: () => value });
  const first = await start({ ...config, first: 'ai' });
  const firstReply = await settled(first.id);
  value = 0.8;
  const second = await start({ ...config, first: 'ai' });
  const secondReply = await settled(second.id);
  assert.deepEqual({ ...first, id: '' }, { ...second, id: '' });
  assert.deepEqual(observations[0], observations[1]);
  assert.notDeepEqual(firstReply.board[0], secondReply.board[0]);
  assert.equal(firstReply.board[1], 'dark');
  assert.equal(secondReply.board[1], 'dark');
});

async function assignSides(api) {
  const opening = await api.start();
  await api.act(opening, 'flip', { to: 0 });
  const afterTwo = await api.settled(opening.id);
  assert.equal(afterTwo.canUndo, false);
  await api.act(afterTwo, 'undo', {}, 409);
  await api.act(afterTwo, 'flip', { to: 6 });
  const assigned = await api.settled(opening.id);
  assert.deepEqual(assigned.sides, { human: 'blue', ai: 'red' });
  assert.deepEqual(assigned.legal.find(action => action.from === 6 && action.to === 11),
    { action: 'move', from: 6, to: 11 });
  return assigned;
}

function openingReply(position) {
  return position.recentMoves.length === 1 ? answer(position, 'flip', 15) : answer(position, 'move', 21, 15);
}

test('undo uses the actual AI reply when a move or flip wins the race', async t => {
  let replyWithFlip = false;
  const api = await game(t, position => {
    if (position.recentMoves.length < 5) return openingReply(position);
    return replyWithFlip ? answer(position, 'flip', 1) : answer(position, 'move', 17, 21);
  }, { random: () => 0.5 });

  const assigned = await assignSides(api);
  const pending = await api.act(assigned, 'move', { from: 6, to: 11 });
  assert.equal((await api.settled(assigned.id)).canUndo, true);
  const undone = await api.act(pending, 'undo');
  assert.deepEqual({ ...undone, revision: assigned.revision }, assigned);
  const duplicate = await api.act(pending, 'undo', {}, 409);
  assert.deepEqual(duplicate.snapshot, undone);

  replyWithFlip = true;
  const next = await api.act(undone, 'move', { from: 6, to: 11 });
  const revealed = await api.settled(assigned.id);
  assert.equal(revealed.canUndo, false);
  const refused = await api.act(next, 'undo', {}, 409);
  assert.deepEqual(refused.snapshot, revealed);
  assert.deepEqual(refused.snapshot.board[1], { color: 'red', type: 'flag' });
});

test('pending undo and pause cancel replies; resume, retry, replacement and close use the current state', async t => {
  const started = [Promise.withResolvers(), Promise.withResolvers(), Promise.withResolvers()];
  const late = started.map(() => Promise.withResolvers());
  const positions = [];
  let attempts = 0;
  let modelAvailable = false;
  const api = await game(t, (position, signal) => {
    if (position.recentMoves.length < 5) return openingReply(position);
    const attempt = attempts++;
    positions.push(position);
    if (attempt < 2) {
      started[attempt].resolve(signal);
      return late[attempt].promise;
    }
    if (attempt === 2) throw new Error('timed out');
    if (attempt === 3) return { move: -1 };
    started[2].resolve(signal);
    return late[2].promise;
  }, { random: () => 0.5, catalog: async () => {
    if (!modelAvailable) throw new Error('unavailable');
    return models;
  } });

  assert.match((await api.request('/models', undefined, 503)).error, /重试/);
  modelAvailable = true;
  const assigned = await assignSides(api);
  const pending = await api.act(assigned, 'move', { from: 6, to: 11 });
  const first = await started[0].promise;
  const undone = await api.act(pending, 'undo');
  assert.equal(first.aborted, true);
  late[0].resolve({ move: 0 });
  assert.deepEqual(await api.read(assigned.id), undone);

  const another = await api.act(undone, 'move', { from: 6, to: 11 });
  const second = await started[1].promise;
  const paused = await api.act(another, 'pause');
  assert.equal(second.aborted, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.thinking, false);
  late[1].resolve({ move: 0 });
  await api.act(paused, 'resume');

  const failed = await api.settled(assigned.id);
  assert.match(failed.error, /失败/);
  assert.deepEqual(failed.board, paused.board);
  await api.act(failed, 'retry');
  const invalid = await api.settled(assigned.id);
  assert.match(invalid.error, /无效行动/);
  assert.deepEqual(positions[2], positions[3]);
  const retrying = await api.act(invalid, 'retry');
  const third = await started[2].promise;
  await api.act(retrying, 'pause');
  const replacement = await api.start({ ...config, effort: 'low', replace: assigned.id });
  assert.equal(third.aborted, true);
  assert.deepEqual(api.disposed, ['junqi']);
  assert.notEqual(replacement.id, assigned.id);
  assert.equal(replacement.board.filter(cell => cell === 'dark').length, 50);
  assert.equal(replacement.config.effort, 'low');
  late[2].resolve({ move: 0 });
  await api.request('/matches/' + assigned.id, undefined, 404);
  assert.deepEqual(await api.read(replacement.id), replacement);
  await api.remove(replacement.id);
  assert.deepEqual(api.disposed, ['junqi', 'junqi']);
});


test('closing a page during a pending opening prevents the AI session from starting', async t => {
  const loadingCatalog = Promise.withResolvers();
  const releaseCatalog = Promise.withResolvers();
  const api = await game(t, () => assert.fail('a released opening must not start an AI turn'), {
    catalog: async () => {
      loadingCatalog.resolve();
      return releaseCatalog.promise;
    },
  });
  const id = await api.reserve();
  const pending = api.request('/matches', { ...config, first: 'ai', id }, 404);
  await loadingCatalog.promise;
  await api.remove(id);
  releaseCatalog.resolve(models);
  assert.match((await pending).error, /重新开始/);
  await api.request('/matches/' + id, undefined, 404);
  assert.deepEqual(api.disposed, []);
});
