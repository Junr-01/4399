import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [{ id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }];
const config = { first: 'human', model: 'example', effort: 'high' };
const answer = (callTool, action, to, from) =>
  callTool('play_action', { action, to, ...(from === undefined ? {} : { from }) });

async function game(t, choose, { random, catalog = async () => models } = {}) {
  const disposed = [];
  const directory = await mkdtemp(join(tmpdir(), '4399-junqi-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await startServer(0, { junqiDirectory: directory, junqiRandom: random, codex: {
    catalog,
    openMatch(options, name, workspace) {
      return {
        move: (input, signal) => choose(input, signal, options, name, workspace),
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
    request, read, settled, disposed, directory,
    reserve: () => request('/reservations', {}, 201).then(({ id }) => id),
    start: async (options = config) => {
      const { id } = await request('/reservations', {}, 201);
      return request('/matches', { ...options, id }, 201);
    },
    act: (state, action, fields, status) => request('/matches/' + state.id, { action, revision: state.revision, ...fields }, status),
    remove: id => request('/matches/' + id, undefined, 204, 'DELETE'),
  };
}

test('the opening uses a per-match workspace and tools, with exactly one action before handoff', async t => {
  const seen = Promise.withResolvers();
  const finish = Promise.withResolvers();
  const { request, start, read, settled, act, remove, disposed, directory } = await game(t, async ({ text, callTool }, _, options, name, workspace) => {
    seen.resolve({ text, options, name, workspace, callTool });
    await finish.promise;
  }, { random: () => 0.1 });
  t.after(() => finish.resolve());
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, first: 'red' }, 400);
  await request('/matches', { ...config, effort: 'max' }, 400);
  const opening = await start({ ...config, first: 'ai' });
  const { options, name, text, workspace, callTool } = await Promise.race([
    seen.promise, delay(1000, undefined, { ref: false }).then(() => assert.fail('AI did not expose its tools')),
  ]);
  const position = callTool('get_position', {});
  assert.throws(() => callTool('get_position', null), /无需参数/);
  assert.throws(() => callTool('play_action', { action: 'flip', to: 60 }), /0 到 59/);
  assert.throws(() => callTool('play_action', { action: 'flip', from: 1, to: 0 }), /只需/);
  assert.throws(() => callTool('play_action', { action: 'move', from: 0, to: 1 }), /翻棋/);
  assert.throws(() => callTool('play_action', { action: 'flip', to: 11 }), /暗子/);
  assert.equal(answer(callTool, 'flip', 0), '行动成功。');
  assert.throws(() => answer(callTool, 'flip', 1), /已行动/);
  const committed = callTool('get_position', {});
  assert.equal(name, 'junqi');
  assert.equal(text, '棋局开始');
  assert.equal(workspace.cwd, join(directory, opening.id));
  assert.deepEqual(workspace.dynamicTools.map(tool => tool.name), ['get_position', 'play_action']);
  assert.match(await readFile(join(directory, 'AGENTS.md'), 'utf8'), /# 角色[\s\S]+# 军棋规则[\s\S]+# 对弈工具/);
  assert.match(await readFile(join(workspace.cwd, 'AGENTS.md'), 'utf8'), /你先翻棋/);
  assert.deepEqual(options, { ...config, first: 'ai', modelName: 'Example' });
  assert.equal(position.board.filter(cell => cell === 'dark').length, 50);
  assert.deepEqual(position.legal[0], { action: 'flip', to: 0 });
  assert.equal(position.legal.length, 50);
  assert.ok(position.legal.every(({ action, to }) => action === 'flip' && position.board[to] === 'dark'));
  assert.equal(position.moveCommitted, false);
  assert.equal(committed.moveCommitted, true);
  assert.deepEqual(committed.legal, []);

  const pending = await read(opening.id);
  assert.equal(pending.thinking, true);
  assert.equal(pending.turn, 'ai');
  assert.deepEqual(pending.legal, []);
  assert.deepEqual(pending.board, committed.board);
  assert.deepEqual(pending.last, committed.last);
  await act(pending, 'flip', { to: 1 }, 409);
  finish.resolve();
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
  assert.match(await readFile(join(workspace.cwd, 'AGENTS.md'), 'utf8'), /你先翻棋/);
});

test('different dark layouts are identical to the browser and AI before they are revealed', async t => {
  const observations = [];
  let value = 0.1;
  const { start, settled } = await game(t, ({ callTool }) => {
    observations.push(callTool('get_position', {}));
    answer(callTool, 'flip', 0);
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

function openingReply(callTool) {
  const { sides } = callTool('get_position', {});
  return sides ? answer(callTool, 'move', 21, 15) : answer(callTool, 'flip', 15);
}

test('undo can follow a committed AI move but cannot reverse a concurrent reveal', async t => {
  let replyWithFlip = false;
  const messages = [];
  const api = await game(t, ({ text, callTool }) => {
    messages.push(text);
    const { last } = callTool('get_position', {});
    if (last.action === 'flip') return openingReply(callTool);
    return replyWithFlip ? answer(callTool, 'flip', 1) : answer(callTool, 'move', 17, 21);
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
  assert.deepEqual(messages, ['我已落子', '我已落子', '我已落子', '我悔棋了，已经重新落子']);
});

test('undo and pause invalidate old tools while resuming and replacing use current state', async t => {
  const started = Array.from({ length: 3 }, () => Promise.withResolvers());
  const hold = started.map(() => Promise.withResolvers());
  let attempt = 0;
  let modelAvailable = false;
  const positions = [];
  const api = await game(t, async ({ callTool }, signal) => {
    const state = callTool('get_position', {});
    if (state.last.action === 'flip') return openingReply(callTool);
    const index = attempt++;
    positions.push(state);
    started[index].resolve({ callTool, signal });
    await hold[index].promise;
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
  assert.equal(first.signal.aborted, true);
  assert.throws(() => answer(first.callTool, 'flip', 1), /失效/);
  hold[0].resolve();
  assert.deepEqual(await api.read(assigned.id), undone);

  const another = await api.act(undone, 'move', { from: 6, to: 11 });
  const second = await started[1].promise;
  const paused = await api.act(another, 'pause');
  assert.equal(second.signal.aborted, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.thinking, false);
  assert.throws(() => answer(second.callTool, 'flip', 1), /失效/);
  hold[1].resolve();

  const resumed = await api.act(paused, 'resume');
  const third = await started[2].promise;
  assert.deepEqual(positions[1], positions[2]);
  await api.act(resumed, 'pause');
  const replacement = await api.start({ ...config, effort: 'low', replace: assigned.id });
  assert.equal(third.signal.aborted, true);
  assert.throws(() => answer(third.callTool, 'flip', 1), /失效/);
  assert.deepEqual(api.disposed, ['junqi']);
  assert.notEqual(replacement.id, assigned.id);
  assert.equal(replacement.board.filter(cell => cell === 'dark').length, 50);
  assert.equal(replacement.config.effort, 'low');
  hold[2].resolve();
  await api.request('/matches/' + assigned.id, undefined, 404);
  assert.deepEqual(await api.read(replacement.id), replacement);
  await api.remove(replacement.id);
  assert.deepEqual(api.disposed, ['junqi', 'junqi']);
});

test('three automatic retries keep a successful reveal through errors and a later manual retry', async t => {
  const attempts = [];
  const revived = Promise.withResolvers();
  const api = await game(t, async ({ callTool, text }) => {
    const position = callTool('get_position', {});
    attempts.push({ position, text, callTool });
    switch (attempts.length) {
      case 1:
        return; // A turn that ends without acting must be retried.
      case 2:
        answer(callTool, 'flip', 0);
        break;
      case 5:
        await revived.promise;
        return;
    }
    throw new Error('Codex unavailable');
  }, { random: () => 0.5 });

  const opening = await api.start({ ...config, first: 'ai' });
  const failed = await api.settled(opening.id);
  assert.match(failed.error, /重试/);
  assert.equal(failed.turn, 'ai');
  assert.deepEqual(failed.legal, []);
  assert.equal(failed.ply, 1);
  assert.deepEqual(attempts.map(({ position }) => position.moveCommitted), [false, false, true, true]);
  assert.equal(attempts[0].text, '棋局开始');
  assert.match(attempts[1].text, /翻棋或走棋/);
  assert.match(attempts[2].text, /已经成功行动/);
  assert.throws(() => answer(attempts[0].callTool, 'flip', 1), /失效/);
  await api.act(failed, 'flip', { to: 1 }, 409);
  const retrying = await api.act(failed, 'retry');
  assert.equal(retrying.thinking, true);
  revived.resolve();
  const finished = await api.settled(opening.id);
  assert.equal(finished.turn, 'human');
  assert.equal(finished.error, null);
  assert.equal(finished.ply, 1);
  assert.deepEqual(finished.board, failed.board);
  assert.deepEqual(attempts[4].position, attempts[3].position);
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
