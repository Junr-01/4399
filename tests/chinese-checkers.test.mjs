import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const model = { id: 'example', name: 'Example', efforts: ['low'], defaultEffort: 'low' };
const config = { playerCount: 6, model: 'example', effort: 'low' };

async function game(t, move) {
  const directory = await mkdtemp(join(tmpdir(), '43gg-chinese-checkers-test-'));
  const gameDirectory = join(directory, 'chinese-checkers');
  const opened = [];
  const disposed = [];
  const server = await startServer(0, { 'chinese-checkersDirectory': gameDirectory, codex: {
    catalog: async () => [model],
    openMatch: (config, game, options) => {
      opened.push({ config, game, options });
      return { move: (input, signal) => move(input, signal, options), dispose: () => disposed.push(options.cwd) };
    },
    close() {},
  } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  async function request(path, body, status = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/api/chinese-checkers' + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const output = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, JSON.stringify(output));
    return output;
  }
  const read = id => request('/matches/' + id);
  return {
    request, read, opened, disposed, gameDirectory,
    async start(options = config, replace) {
      const { id } = await request('/reservations', {}, 201);
      return request('/matches', { ...options, id, replace }, 201);
    },
    async settled(id) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const state = await read(id);
        if (!state.thinking) return state;
        await delay(5);
      }
      assert.fail('AI turns did not settle');
    },
    act: (state, action, fields, status) => request('/matches/' + state.id, { ...fields, action, revision: state.revision }, status),
  };
}

const position = input => input.callTool('get_position', {});
const movePiece = (input, move) => input.callTool('move_piece', move);

test('opens a six-seat match and hands each AI a separate turn and live board', { timeout: 8000 }, async t => {
  const committed = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  const observed = [];
  const { request, start, act, read, settled, opened, disposed, gameDirectory } = await game(t, async (input, _, { cwd }) => {
    const before = position(input);
    const moved = before.legal[0];
    const result = movePiece(input, moved);
    const after = position(input);
    observed.push({ cwd, before, after, result });
    if (before.side === 1) {
      committed.resolve();
      await finish.promise;
    }
  });

  assert.deepEqual((await request('/models')).models, [model]);
  for (const playerCount of [1, 7, 2.5, '3', null]) {
    await request('/matches', { ...config, playerCount }, 400);
  }
  const initial = await start();
  assert.deepEqual(initial.seats, [0, 1, 2, 3, 4, 5]);
  assert.equal(initial.board.filter(piece => piece !== null).length, 60);
  assert.equal(initial.side, 0);
  assert.equal(initial.canUndo, false);
  const humanMove = initial.legal[0];
  await act(initial, 'move', { from: humanMove.from, to: humanMove.from }, 400);
  const pending = await act(initial, 'move', humanMove);
  await committed.promise;
  const held = await read(initial.id);
  assert.equal(held.lastMove.side, 1);
  assert.equal(held.side, 1);
  assert.equal(held.thinking, true);
  assert.deepEqual(held.legal, []);
  await act(held, 'move', initial.legal[1], 409);
  assert.equal(observed.length, 1);
  finish.resolve();

  const next = await settled(initial.id);
  assert.equal(next.error, null);
  assert.equal(next.side, 0);
  assert.equal(next.aiTurn, false);
  assert.equal(next.lastMove.side, 5);
  assert.equal(next.canUndo, true);
  assert.ok(next.legal.length);
  assert.deepEqual(observed.map(entry => entry.before.side), [1, 2, 3, 4, 5]);
  assert.deepEqual(observed.map(entry => entry.before.lastMove.side), [0, 1, 2, 3, 4]);
  for (const [index, entry] of observed.entries()) {
    assert.equal(entry.result, '走棋成功。');
    assert.equal(entry.before.moveCommitted, false);
    assert.equal(entry.after.moveCommitted, true);
    assert.deepEqual(entry.after.legal, []);
    assert.equal(entry.after.lastMove.side, index + 1);
    assert.equal(entry.before.board.length, 17);
    assert.equal(entry.before.board[0].cells, '3');
    assert.equal(entry.before.board[16].cells, '0');
    assert.equal(dirname(entry.cwd), join(gameDirectory, initial.id));
    assert.match(await readFile(join(entry.cwd, 'AGENTS.md'), 'utf8'), new RegExp('AI ' + (index + 1)));
  }
  assert.equal(new Set(observed.map(entry => entry.cwd)).size, 5);
  assert.equal(opened.length, 5);
  for (const item of opened) {
    assert.equal(item.game, 'chinese-checkers');
    assert.equal(item.config.model, model.id);
    assert.deepEqual(item.options.dynamicTools.map(tool => tool.name), ['get_position', 'move_piece']);
  }
  assert.match(await readFile(join(gameDirectory, 'AGENTS.md'), 'utf8'), /get_position/);
  const undone = await act(pending, 'undo');
  assert.deepEqual(undone.board, initial.board);
  assert.equal(undone.lastMove, null);
  await request('/matches/' + initial.id, undefined, 204, 'DELETE');
  assert.deepEqual(disposed, observed.map(entry => entry.cwd));
  assert.match(await readFile(join(observed[0].cwd, 'AGENTS.md'), 'utf8'), /AI 1/);
});

test('retries the same AI seat after a committed move and keeps later seats waiting', { timeout: 5000 }, async t => {
  const attempts = [];
  const { start, act, settled } = await game(t, (input, _, { cwd }) => {
    const view = position(input);
    const attempt = { cwd, view, text: input.text };
    attempts.push(attempt);
    if (!view.moveCommitted) {
      const rejected = (tool, args) => {
        try { input.callTool(tool, args); } catch (error) { return error.message; }
      };
      attempt.rejections = [
        rejected('get_position', { extra: true }),
        rejected('move_piece', { from: 0, to: 121 }),
        rejected('move_piece', { ...view.legal[0], extra: true }),
        rejected('move_piece', { from: view.legal[0].from, to: view.legal[0].from }),
      ];
      movePiece(input, view.legal[0]);
      attempt.duplicate = rejected('move_piece', view.legal[0]);
    }
    if (attempts.length <= 4) throw new Error('Connection lost after moving');
  });

  const initial = await start({ ...config, playerCount: 3 });
  await act(initial, 'move', initial.legal[0]);
  const failed = await settled(initial.id);
  assert.match(failed.error, /请重试/);
  assert.equal(failed.side, 2);
  assert.equal(failed.aiTurn, true);
  assert.deepEqual(failed.legal, []);
  assert.equal(failed.lastMove.side, 2);
  assert.equal(attempts.length, 4);
  await act(failed, 'move', initial.legal[1], 409);

  await act(failed, 'retry');
  const settledState = await settled(initial.id);
  assert.equal(settledState.error, null);
  assert.equal(settledState.side, 0);
  assert.deepEqual(attempts.map(attempt => attempt.view.moveCommitted), [false, true, true, true, true, false]);
  assert.equal(new Set(attempts.slice(0, 5).map(attempt => attempt.cwd)).size, 1);
  assert.notEqual(attempts[5].cwd, attempts[0].cwd);
  for (const attempt of attempts.slice(1, 5)) {
    assert.match(attempt.text, /已经成功走棋/);
    assert.deepEqual(attempt.view.lastMove, failed.lastMove);
    assert.deepEqual(attempt.view.legal, []);
  }
  assert.deepEqual(attempts[0].rejections, ['查看局面无需参数。', '起点和终点必须是 0 到 120 的点号。',
    '走棋只接受起点和终点。', '请选择当前行棋方的合法走法。']);
  assert.equal(attempts[0].duplicate, '本回合已走棋。');
  assert.equal(settledState.lastMove.side, 4);
});

test('undo restores the human opening and invalidates a later AI already in flight', { timeout: 5000 }, async t => {
  const pending = Promise.withResolvers();
  const release = Promise.withResolvers();
  const invalidated = Promise.withResolvers();
  t.after(() => release.resolve());
  let restarted = false;
  const { start, act, read, settled } = await game(t, async input => {
    const view = position(input);
    if (view.side === 4 && !restarted) {
      pending.resolve();
      await release.promise;
      try {
        movePiece(input, view.legal[0]);
        invalidated.resolve(null);
      } catch (error) { invalidated.resolve(error.message); }
    } else movePiece(input, view.legal[0]);
  });

  const initial = await start({ ...config, playerCount: 3 });
  const original = initial.legal[0];
  await act(initial, 'move', original);
  await pending.promise;
  const beforeUndo = await read(initial.id);
  assert.equal(beforeUndo.side, 4);
  assert.equal(beforeUndo.lastMove.side, 2);
  const undone = await act(beforeUndo, 'undo');
  assert.equal(undone.side, 0);
  assert.equal(undone.thinking, false);
  assert.equal(undone.canUndo, false);
  assert.equal(undone.lastMove, null);
  assert.deepEqual(undone.board, initial.board);
  assert.deepEqual(undone.legal, initial.legal);
  restarted = true;
  release.resolve();
  assert.match(await invalidated.promise, /已失效/);
  await act(undone, 'move', initial.legal[1]);
  const next = await settled(initial.id);
  assert.equal(next.side, 0);
  assert.equal(next.error, null);
  assert.equal(next.lastMove.side, 4);

});

test('pause preserves the five-player setup and replacing releases every old opponent', async t => {
  const { start, act, request, opened, disposed, read } = await game(t, input => movePiece(input, position(input).legal[0]));
  const options = { ...config, playerCount: 5 };
  const initial = await start(options);
  assert.equal(initial.board[0], null);
  assert.deepEqual(initial.seats, [0, 1, 2, 4, 5]);
  const paused = await act(initial, 'pause');
  assert.equal(paused.paused, true);
  assert.equal(paused.config.playerCount, 5);
  assert.deepEqual(paused.legal, []);
  const resumed = await act(paused, 'resume');
  assert.equal(resumed.paused, false);
  assert.deepEqual(resumed.legal, initial.legal);

  await act(resumed, 'pause');
  const next = await start(options, initial.id);
  assert.notEqual(next.id, initial.id);
  assert.deepEqual(next.config, initial.config);
  assert.deepEqual(next.board, initial.board);
  assert.deepEqual(disposed, opened.slice(0, 4).map(entry => entry.options.cwd));
  await request('/matches/' + initial.id, undefined, 404);
  assert.equal((await read(next.id)).side, 0);
});

test('replays a full game and reveals the AI win only after the final turn finishes', { timeout: 8000 }, async t => {
  const replay = [
    [115, 102], [3, 16], [120, 104], [0, 14], [116, 103], [4, 17], [117, 106], [5, 18],
    [111, 89], [6, 26], [112, 90], [7, 29], [113, 91], [8, 30], [114, 94], [9, 31],
    [102, 77], [14, 37], [103, 78], [16, 41], [104, 79], [17, 42], [106, 83], [18, 43],
    [89, 66], [26, 47], [78, 38], [29, 52], [90, 69], [30, 53], [91, 68], [31, 54],
    [94, 73], [42, 82], [77, 56], [41, 62], [66, 27], [52, 93], [79, 58], [53, 94],
    [69, 26], [43, 64], [68, 25], [54, 95], [38, 15], [82, 105], [26, 6], [93, 113],
    [27, 7], [105, 116], [15, 4], [1, 8], [119, 112], [2, 5], [7, 2], [5, 16],
    [118, 115], [8, 28], [115, 104], [16, 39], [112, 92], [28, 67], [104, 81], [113, 118],
    [92, 53], [37, 48], [56, 37], [48, 68], [81, 70], [39, 50], [83, 72], [62, 106],
    [72, 54], [94, 114], [70, 60], [106, 120], [60, 39], [64, 83], [73, 63], [47, 57],
    [63, 42], [57, 78], [53, 30], [67, 90], [42, 17], [68, 89], [30, 1], [78, 103],
    [17, 8], [90, 119], [58, 48], [103, 112], [25, 26], [50, 60], [37, 0], [60, 70],
    [48, 38], [70, 81], [39, 3], [83, 94], [54, 43], [95, 93], [26, 14], [81, 117],
    [38, 27], [94, 106], [43, 31], [89, 102], [27, 15], [102, 111], [14, 5], [93, 105],
    [15, 7], [106, 115], [7, 9], [105, 113],
  ];
  const finalMove = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  let aiIndex = 1;
  const { start, act, read, settled } = await game(t, async input => {
    const [from, to] = replay[aiIndex];
    movePiece(input, { from, to });
    aiIndex += 2;
    if (aiIndex > replay.length) {
      finalMove.resolve();
      await finish.promise;
    }
  });

  let state = await start({ ...config, playerCount: 2 });
  for (let index = 0; index < replay.length; index += 2) {
    const [from, to] = replay[index];
    state = await act(state, 'move', { from, to });
    if (index + 2 === replay.length) break;
    state = await settled(state.id);
    assert.equal(state.error, null);
    assert.equal(state.result, null);
  }

  await finalMove.promise;
  const held = await read(state.id);
  assert.equal(held.thinking, true);
  assert.equal(held.result, null);
  assert.equal(held.lastMove.to, 113);
  assert.deepEqual(held.board.slice(111), Array(10).fill(3));
  finish.resolve();
  const finished = await settled(state.id);
  assert.deepEqual(finished.result, { winner: 3, reason: 'goal' });
  assert.deepEqual(finished.legal, []);
  assert.deepEqual(finished.lastMove, held.lastMove);
  const paused = await act(finished, 'pause');
  assert.deepEqual(paused.result, finished.result);
  const restarted = await start(paused.config, paused.id);
  assert.equal(restarted.result, null);
  assert.equal(restarted.config.playerCount, 2);
  assert.equal(restarted.canUndo, false);
});
