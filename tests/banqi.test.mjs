import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [{ id: 'example', name: 'Example', efforts: ['low'], defaultEffort: 'low' }];
const config = { first: 'human', model: 'example', effort: 'low' };
const reveal = (callTool, to) => callTool('play_action', { action: 'flip', to });
const position = callTool => callTool('get_position', {});

async function setup(t, move, random = () => 0.999) {
  const directory = await mkdtemp(join(tmpdir(), '43gg-banqi-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = await startServer(0, { banqiDirectory: directory, banqiRandom: random, codex: {
    catalog: async () => models,
    openMatch: (config, name, workspace) => ({ move: (input, signal) => move(input, signal, name, workspace), dispose() {} }),
    close() {},
  } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;

  async function request(path, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/api/banqi' + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, expected);
    if (expected !== 204) return response.json();
  }

  const read = id => request('/matches/' + id);
  return {
    directory, request, read,
    async start(options = {}) {
      const { id } = await request('/reservations', {}, 201);
      return request('/matches', { ...config, ...options, id }, 201);
    },
    act: (state, action, fields, status) => request('/matches/' + state.id, { action, revision: state.revision, ...fields }, status),
    async settled(id) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const match = await read(id);
        if (!match.thinking) return match;
        await delay(5);
      }
      assert.fail('AI turn did not settle');
    },
  };
}

test('Banqi exposes masked positions through the web and tools, then waits for Codex to finish before handing off', { timeout: 5000 }, async t => {
  const called = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  const api = await setup(t, async (input, _, name, workspace) => {
    called.resolve({ ...input, name, workspace });
    await finish.promise;
  });
  assert.deepEqual(await api.request('/models'), { models });
  await api.request('/matches', { ...config, first: 'red' }, 400);
  const opening = await api.start({ first: 'ai' });
  const { callTool, text, name, workspace } = await called.promise;
  assert.equal(name, 'banqi');
  assert.equal(text, '棋局开始');
  assert.equal(workspace.cwd, join(api.directory, opening.id));
  assert.deepEqual(workspace.dynamicTools.map(tool => tool.name), ['get_position', 'play_action']);
  assert.match(await readFile(join(api.directory, 'AGENTS.md'), 'utf8'), /# 角色[\s\S]+# 暗棋规则[\s\S]+# 对弈工具/);
  const perMatchPath = join(workspace.cwd, 'AGENTS.md');
  assert.match(await readFile(perMatchPath, 'utf8'), /你先翻棋/);

  const visible = position(callTool);
  const masked = Array(32).fill('dark');
  assert.deepEqual(opening.board, masked);
  assert.deepEqual(visible.board, masked);
  assert.equal(visible.sides, null);
  assert.deepEqual(visible.legal, masked.map((_, to) => ({ action: 'flip', to })));
  assert.equal(visible.moveCommitted, false);
  assert.throws(() => callTool('get_position', { reveal: true }), /无需参数/);
  assert.throws(() => callTool('play_action', { action: 'flip', from: 0, to: 0 }), /只需/);
  assert.throws(() => reveal(callTool, 32), /0 到 31/);
  assert.equal(reveal(callTool, 0), '行动成功。');
  assert.throws(() => reveal(callTool, 31), /已行动/);

  const pending = await api.read(opening.id);
  assert.equal(pending.turn, 'ai');
  assert.equal(pending.thinking, true);
  assert.deepEqual(pending.legal, []);
  assert.deepEqual(pending.last.piece, { color: 'red', type: 'general' });
  await api.act(pending, 'flip', { to: 1 }, 409);
  assert.equal(position(callTool).moveCommitted, true);
  assert.deepEqual(position(callTool).legal, []);
  finish.resolve();

  const after = await api.settled(opening.id);
  assert.equal(after.turn, 'human');
  assert.deepEqual(after.sides, { ai: 'red', human: 'black' });
  assert.equal(after.canUndo, false);
  assert.equal(after.legal.length, 31);
  await api.request('/matches/' + opening.id, undefined, 204, 'DELETE');
  await api.request('/matches/' + opening.id, undefined, 404);
  assert.match(await readFile(perMatchPath, 'utf8'), /你先翻棋/);
});

test('undo restores a Banqi capture and cancels late AI calls, including across pause and resume', { timeout: 5000 }, async t => {
  const started = Array.from({ length: 3 }, () => Promise.withResolvers());
  const held = started.map(() => Promise.withResolvers());
  t.after(() => held.forEach(gate => gate.resolve()));
  let attempts = 0;
  const api = await setup(t, async ({ callTool, text }, signal) => {
    const { last } = position(callTool);
    if (last.action === 'flip') return reveal(callTool, last.to === 9 ? 25 : 24);
    const index = attempts++;
    started[index].resolve({ callTool, text, signal });
    await held[index].promise;
  });

  const opening = await api.start();
  await api.act(opening, 'flip', { to: 9 });
  const firstReply = await api.settled(opening.id);
  assert.deepEqual(firstReply.sides, { human: 'red', ai: 'black' });
  await api.act(firstReply, 'flip', { to: 11 });
  const revealed = await api.settled(opening.id);
  assert.equal(revealed.canUndo, false);
  await api.act(revealed, 'undo', {}, 409);
  await api.act(revealed, 'move', { from: 9, to: 24 }, 400);
  const capture = { from: 9, to: 25 };
  const pending = await api.act(revealed, 'move', capture);
  const first = await started[0].promise;
  assert.deepEqual(pending.last.target, { color: 'black', type: 'cannon' });
  assert.equal(pending.canUndo, true);
  const undone = await api.act(pending, 'undo');
  assert.equal(first.signal.aborted, true);
  assert.throws(() => reveal(first.callTool, 31), /失效/);
  assert.deepEqual(undone.board, revealed.board);
  held[0].resolve();

  const replay = await api.act(undone, 'move', capture);
  const second = await started[1].promise;
  assert.equal(second.text, '我悔棋了，已经重新落子');
  const paused = await api.act(replay, 'pause');
  assert.equal(paused.paused, true);
  assert.equal(second.signal.aborted, true);
  assert.throws(() => position(second.callTool), /失效/);
  held[1].resolve();

  await api.act(paused, 'resume');
  const third = await started[2].promise;
  assert.equal(third.callTool('play_action', { action: 'move', from: 24, to: 25 }), '行动成功。');
  held[2].resolve();
  const reply = await api.settled(opening.id);
  assert.deepEqual(reply.last.target, { color: 'red', type: 'cannon' });
  const restored = await api.act(reply, 'undo');
  assert.deepEqual(restored.board, revealed.board);
  assert.deepEqual(restored.last, revealed.last);
});

test('a stale undo returns the still-pending AI turn without hiding its just-revealed piece', { timeout: 5000 }, async t => {
  const started = Promise.withResolvers();
  const finished = Promise.withResolvers();
  t.after(() => finished.resolve());
  const api = await setup(t, async ({ callTool }) => {
    const { last } = position(callTool);
    if (last.action === 'flip') return reveal(callTool, 25);
    started.resolve(callTool);
    await finished.promise;
  });

  const opening = await api.start();
  await api.act(opening, 'flip', { to: 9 });
  const ready = await api.settled(opening.id);
  const pending = await api.act(ready, 'move', { from: 9, to: 25 });
  assert.equal(pending.canUndo, true);
  reveal(await started.promise, 31);

  const { snapshot } = await api.act(pending, 'undo', {}, 409);
  assert.equal(snapshot.canUndo, false);
  assert.equal(snapshot.thinking, true);
  assert.equal(snapshot.turn, 'ai');
  assert.deepEqual(snapshot.board[31], { color: 'black', type: 'soldier' });
  finished.resolve();
  const after = await api.settled(opening.id);
  assert.equal(after.turn, 'human');
  assert.deepEqual(after.board, snapshot.board);
});

test('failed Codex attempts and a manual retry preserve a committed reveal', async t => {
  const attempts = [];
  const api = await setup(t, ({ callTool }) => {
    attempts.push(position(callTool));
    if (attempts.length === 2) reveal(callTool, 0);
    if (attempts.length <= 4) throw new Error('interrupted');
  });
  const opening = await api.start({ first: 'ai' });
  const failed = await api.settled(opening.id);
  assert.match(failed.error, /重试/);
  assert.equal(failed.turn, 'ai');
  assert.equal(failed.ply, 1);
  assert.deepEqual(failed.legal, []);
  assert.deepEqual(attempts.map(view => view.moveCommitted), [false, false, true, true]);
  await api.act(failed, 'retry');
  const recovered = await api.settled(opening.id);
  assert.equal(recovered.turn, 'human');
  assert.equal(recovered.error, null);
  assert.deepEqual(recovered.board, failed.board);
  assert.deepEqual(attempts[4], attempts[3]);
});
