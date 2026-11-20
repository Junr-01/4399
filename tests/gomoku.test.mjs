import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [
  { id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true },
];
const config = { size: 9, model: 'example', effort: 'high', first: 'you' };

async function game(t, move) {
  const directory = await mkdtemp(join(tmpdir(), '43gg-gomoku-test-'));
  const gomokuDirectory = join(directory, 'gomoku');
  const codex = move && {
    catalog: async () => models,
    openMatch: config => ({ move: (position, signal) => move(position, signal, config), dispose() {} }),
    close() {},
  };
  const server = await startServer(0, { codex, gomokuDirectory });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
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

  return { origin, request, settled, gomokuDirectory };
}

test('initializes shared instructions once and keeps each match workspace', async t => {
  const { request, gomokuDirectory } = await game(t, input => input.callTool('place_stone', { row: 6, col: 6 }));
  await request('/models');
  const rootInstructions = join(gomokuDirectory, 'AGENTS.md');
  const defaults = await readFile(rootInstructions, 'utf8');
  assert.match(defaults, /五子棋职业选手[\s\S]*黑棋先下/);
  await writeFile(rootInstructions, '本地自定义指令\n');
  const first = await request('/matches', config, 201);
  await request('/matches/' + first.id, { action: 'pause' });
  const second = await request('/matches', { ...config, size: 13, first: 'random', replace: first.id }, 201);
  const firstInstructions = await readFile(join(gomokuDirectory, first.id, 'AGENTS.md'), 'utf8');
  const secondInstructions = await readFile(join(gomokuDirectory, second.id, 'AGENTS.md'), 'utf8');
  assert.match(firstInstructions, /9×9[\s\S]*对手（人类玩家）执黑先下/);
  assert.match(secondInstructions, /13×13/);
  assert.match(secondInstructions, second.humanColor === 'black' ? /对手（人类玩家）执黑先下/ : /你执黑先下/);
  assert.equal(await readFile(rootInstructions, 'utf8'), '本地自定义指令\n');
});

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

test('undo cancels a pending response and the next turn receives only the updated position', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers();
  const late = Promise.withResolvers();
  t.after(() => late.resolve());
  let turns = 0;
  const { request, settled } = await game(t, async (input, signal, selected) => {
    assert.equal(selected.effort, 'high');
    if (++turns === 1) {
      entered.resolve({ signal, callTool: input.callTool });
      await late.promise;
      return;
    }
    assert.equal(input.text, '我悔棋了，已经重新落子');
    const position = input.callTool('get_position', {});
    assert.equal(position.size, 9);
    assert.equal(position.board[4][4], null);
    assert.deepEqual(position.lastMove, { row: 5, col: 5, color: 'black' });
    input.callTool('place_stone', { row: 5, col: 4 });
  });
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const { signal, callTool } = await entered.promise;
  assert.deepEqual((await request(path, { action: 'undo' })).moves, []);
  assert.equal(signal.aborted, true);
  await request(path, { action: 'move', row: 5, col: 5 });
  assert.throws(() => callTool('place_stone', { row: 4, col: 5 }), /已失效/);
  late.resolve();
  assert.deepEqual((await settled(id)).moves, [
    { row: 5, col: 5, color: 'black' },
    { row: 5, col: 4, color: 'white' },
  ]);
  assert.deepEqual((await request(path, { action: 'undo' })).moves, []);
});

test('a versioned undo can include the just-committed AI reply only once', async t => {
  const { request, settled } = await game(t, input => {
    const { lastMove } = input.callTool('get_position', {});
    input.callTool('place_stone', { row: lastMove.row, col: lastMove.col + 1 });
  });
  const opening = await request('/matches', config, 201);
  const path = '/matches/' + opening.id;
  await request(path, { action: 'move', row: 4, col: 4, revision: opening.revision });
  const firstReply = await settled(opening.id);
  const secondMove = await request(path, { action: 'move', row: 5, col: 4, revision: firstReply.revision });
  const secondReply = await settled(opening.id);
  assert.equal(secondReply.moves.length, 4);

  const undo = { action: 'undo', revision: secondMove.revision };
  const restored = await request(path, undo);
  assert.deepEqual(restored.moves, firstReply.moves);
  const duplicate = await request(path, undo, 409);
  assert.deepEqual(duplicate.snapshot, restored);
});

test('preserves a successful AI stone across three failed retries and a manual recovery', async t => {
  let attempts = 0;
  const { request, settled } = await game(t, input => {
    const position = input.callTool('get_position', {});
    attempts++;
    if (attempts === 1) {
      assert.equal(input.text, '棋局开始');
      input.callTool('place_stone', { row: 4, col: 4 });
      throw new Error('Codex disconnected after committing the move');
    }
    if (attempts === 6) return input.callTool('place_stone', { row: 3, col: 4 });
    assert.match(input.text, /已经成功落子/);
    assert.equal(position.board[4][4], 'black');
    assert.throws(() => input.callTool('place_stone', { row: 4, col: 5 }), /本回合已落子/);
    if (attempts < 5) throw new Error('Codex failed to recover');
  });
  const { id } = await request('/matches', { ...config, first: 'ai' }, 201);
  const path = '/matches/' + id;
  const failed = await settled(id);
  assert.equal(attempts, 4);
  assert.match(failed.error, /请重试/);
  assert.deepEqual(failed.moves, [{ row: 4, col: 4, color: 'black' }]);
  await request(path, { action: 'move', row: 4, col: 5 }, 409);
  await request(path, { action: 'retry' });
  assert.equal((await settled(id)).error, null);
  assert.equal(attempts, 5);
  assert.equal((await settled(id)).canUndo, false);
  await request(path, { action: 'move', row: 4, col: 4 }, 400);
  await request(path, { action: 'move', row: 4, col: 5 });
  assert.equal((await settled(id)).moves.length, 3);
  assert.deepEqual((await request(path, { action: 'undo' })).moves, [{ row: 4, col: 4, color: 'black' }]);
});

test('recovers after a turn returns normally without placing a stone', async t => {
  const messages = [];
  const { request, settled } = await game(t, input => {
    messages.push(input.text);
    if (messages.length === 2) input.callTool('place_stone', { row: 4, col: 4 });
  });
  const { id } = await request('/matches', { ...config, first: 'ai' }, 201);
  const state = await settled(id);
  assert.deepEqual(messages, ['棋局开始', '请查看当前局面，然后落子。']);
  assert.equal(state.error, null);
  assert.deepEqual(state.moves, [{ row: 4, col: 4, color: 'black' }]);
});

test('undo during recovery withdraws the committed reply and cancels further retries', { timeout: 5000 }, async t => {
  const recovery = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  t.after(() => cancelled.resolve());
  let attempts = 0;
  const { request, settled } = await game(t, async (input, signal) => {
    attempts++;
    if (attempts === 1) {
      input.callTool('place_stone', { row: 4, col: 5 });
      throw new Error('Codex disconnected');
    }
    if (attempts === 2) {
      recovery.resolve({ signal, callTool: input.callTool });
      await cancelled.promise;
      throw new Error('Late failed attempt');
    }
    assert.equal(input.text, '我悔棋了，已经重新落子');
    input.callTool('place_stone', { row: 5, col: 5 });
  });
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const { signal, callTool } = await recovery.promise;
  assert.deepEqual((await request(path, { action: 'undo' })).moves, []);
  assert.equal(signal.aborted, true);
  assert.throws(() => callTool('place_stone', { row: 4, col: 6 }), /已失效/);
  cancelled.resolve();
  await request(path, { action: 'move', row: 5, col: 4 });
  assert.deepEqual((await settled(id)).moves, [
    { row: 5, col: 4, color: 'black' }, { row: 5, col: 5, color: 'white' },
  ]);
  assert.equal(attempts, 3);
});

test('pausing preserves the match and replacing it discards the old AI reply', { timeout: 5000 }, async t => {
  const entered = Promise.withResolvers();
  const late = Promise.withResolvers();
  t.after(() => late.resolve());
  const { request } = await game(t, async (input, signal) => {
    entered.resolve({ signal, callTool: input.callTool });
    await late.promise;
  });
  const old = await request('/matches', config, 201);
  const path = '/matches/' + old.id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const { signal, callTool } = await entered.promise;
  const paused = await request(path, { action: 'pause' });
  assert.equal(paused.paused, true);
  assert.equal(paused.moves.length, 1);
  assert.equal(signal.aborted, true);
  const next = await request('/matches', { ...config, size: 13, effort: 'low', replace: old.id }, 201);
  assert.throws(() => callTool('place_stone', { row: 4, col: 5 }), /已失效/);
  late.resolve();
  await request(path, undefined, 404);
  assert.deepEqual((await request('/matches/' + next.id)).moves, []);
  assert.equal(next.config.size, 13);
  assert.equal(next.config.effort, 'low');
});

test('resuming a paused turn keeps its stone and finishes the same AI turn', { timeout: 5000 }, async t => {
  const placed = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const { request, settled } = await game(t, async (input, signal) => {
    if (input.text === '我已落子') {
      input.callTool('place_stone', { row: 4, col: 5 });
      placed.resolve(signal);
      await release.promise;
      return;
    }
    assert.match(input.text, /已经成功落子/);
    assert.throws(() => input.callTool('place_stone', { row: 4, col: 6 }), /本回合已落子/);
  });
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 4, col: 4 });
  const signal = await placed.promise;
  const paused = await request(path, { action: 'pause' });
  assert.equal(paused.paused, true);
  assert.equal(signal.aborted, true);
  assert.equal(paused.moves.length, 2);
  release.resolve();
  await request(path, { action: 'resume' });
  const resumed = await settled(id);
  assert.equal(resumed.error, null);
  assert.deepEqual(resumed.moves, paused.moves);
  await request(path, { action: 'move', row: 4, col: 6 });
});

test('shows an AI landing before the Codex turn ends and keeps player input locked', { timeout: 5000 }, async t => {
  const placed = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  const { request, settled } = await game(t, async input => {
    try {
      assert.equal(input.text, '我已落子');
      const position = input.callTool('get_position', {});
      assert.equal(position.board[4][4], 'black');
      assert.equal(position.aiColor, 'white');
      assert.throws(() => input.callTool('place_stone', { row: -1, col: 4 }), /棋盘范围/);
      assert.throws(() => input.callTool('place_stone', { row: 4, col: 4 }), /已有棋子/);
      input.callTool('place_stone', { row: 4, col: 5 });
      assert.throws(() => input.callTool('place_stone', { row: 4, col: 6 }), /本回合已落子/);
      placed.resolve();
      await finish.promise;
    } catch (error) {
      placed.resolve(error);
      throw error;
    }
  });
  const { id } = await request('/matches', config, 201);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 4, col: 4 });
  assert.equal(await placed.promise, undefined);
  const state = await request(path);
  assert.equal(state.thinking, true);
  assert.deepEqual(state.moves.at(-1), { row: 4, col: 5, color: 'white' });
  await request(path, { action: 'move', row: 4, col: 6 }, 409);
  finish.resolve();
  assert.equal((await settled(id)).error, null);
});

test('uses App Server tools, completes without text, and interrupts an undone turn', {
  timeout: 5000, skip: process.platform === 'win32' && 'The fake CLI uses a POSIX executable script',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), '43gg-codex-fixture-'));
  const executable = join(directory, 'codex');
  await writeFile(executable, '#!' + process.execPath + '\n' + `
    const assert = require('node:assert/strict');
    const { readFileSync, writeFileSync } = require('node:fs');
    const { createInterface } = require('node:readline');
    const send = value => console.log(JSON.stringify(value));
    let turnId;
    let pendingStartId;
    const call = (id, tool, args) => send({ id, method: 'item/tool/call', params: {
      threadId: 'thread', turnId, callId: id, tool, arguments: args,
    } });
    createInterface({ input: process.stdin }).on('line', line => {
      const { id, method, params, result } = JSON.parse(line);
      const reply = result => send({ id, result });
      if (method === 'initialize') {
        assert.equal(params.capabilities?.experimentalApi, true);
        assert.ok(process.argv.some(arg => arg.includes('project_root_markers') && arg.includes('.43gg-root')));
        reply({});
      }
      if (method === 'account/read') reply({ requiresOpenaiAuth: false });
      if (method === 'model/list') reply({ data: [{ model: 'example', displayName: 'Example',
        supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
      if (method === 'thread/start') {
        assert.deepEqual(params.dynamicTools.map(tool => tool.name), ['get_position', 'place_stone']);
        assert.match(readFileSync(params.cwd + '/AGENTS.md', 'utf8'), /你执黑先下/);
        assert.match(readFileSync(params.cwd + '/../AGENTS.md', 'utf8'), /五子棋职业选手/);
        reply({ thread: { id: 'thread' } });
      }
      if (method === 'turn/start') {
        assert.equal(params.outputSchema, undefined);
        const opening = !turnId;
        turnId = opening ? 'opening-turn' : 'undone-turn';
        assert.equal(params.input[0].text, opening ? '棋局开始' : '我已落子');
        if (opening) {
          reply({ turn: { id: turnId } });
          call('view', 'get_position', {});
        } else {
          pendingStartId = id;
          send({ method: 'turn/started', params: { threadId: 'thread', turn: { id: turnId } } });
          call('place-before-undo', 'place_stone', { row: 4, col: 5 });
        }
      }
      if (id === 'view') {
        assert.equal(result.success, true);
        assert.equal(JSON.parse(result.contentItems[0].text).board[4][4], null);
        call('invalid', 'place_stone', { row: 99, col: 0 });
      }
      if (id === 'invalid') {
        assert.equal(result.success, false);
        assert.match(result.contentItems[0].text, /棋盘范围/);
        call('place', 'place_stone', { row: 4, col: 4 });
      }
      if (id === 'place') {
        assert.equal(result.success, true);
        send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: turnId, status: 'completed' } } });
      }
      if (method === 'turn/interrupt') {
        assert.equal(params.turnId, 'undone-turn');
        send({ id: pendingStartId, result: { turn: { id: turnId } } });
        reply({});
      }
      if (method === 'thread/unsubscribe') {
        reply({ status: 'unsubscribed' });
        call('late', 'place_stone', { row: 4, col: 6 });
      }
      if (id === 'late') {
        assert.equal(result.success, false);
        assert.match(result.contentItems[0].text, /已失效/);
        writeFileSync(__dirname + '/interrupted', turnId);
      }
    });\n`, { mode: 0o700 });
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const { request, settled } = await game(t);
  const { id } = await request('/matches', { ...config, first: 'ai' }, 201);
  const state = await settled(id);
  assert.equal(state.error, null);
  assert.deepEqual(state.moves, [{ row: 4, col: 4, color: 'black' }]);
  const path = '/matches/' + id;
  await request(path, { action: 'move', row: 5, col: 5 });
  while (!t.signal.aborted && (await request(path)).moves.length < 3) await delay(5);
  const undone = await request(path, { action: 'undo' });
  assert.deepEqual(undone.moves, state.moves);
  const interrupted = join(directory, 'interrupted');
  let event;
  while (!event && !t.signal.aborted) {
    try { event = await readFile(interrupted, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!event) await delay(5);
  }
  assert.equal(event, 'undone-turn');
});

test('detects five in a row and undo reopens a finished match', async t => {
  let turn = 0;
  const { request, settled } = await game(t, input => input.callTool('place_stone', { row: 0, col: turn++ * 2 }));
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

test('publishes an AI win only after recovering and completing its turn', { timeout: 5000 }, async t => {
  const recovering = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  let attempt = 0;
  const { request, settled } = await game(t, async input => {
    if (attempt < 5) {
      input.callTool('place_stone', { row: 0, col: attempt++ });
      if (attempt === 5) throw new Error('Codex disconnected after the winning move');
      return;
    }
    recovering.resolve(input.text);
    await finish.promise;
  });
  const { id } = await request('/matches', { ...config, first: 'ai' }, 201);
  const path = '/matches/' + id;
  await settled(id);
  for (let col = 0; col < 4; col++) {
    await request(path, { action: 'move', row: 4, col });
    if (col < 3) await settled(id);
  }
  assert.match(await recovering.promise, /已经成功落子/);
  const working = await request(path);
  assert.equal(working.thinking, true);
  assert.deepEqual(working.moves.at(-1), { row: 0, col: 4, color: 'black' });
  assert.equal(working.result, null);
  await request(path, { action: 'move', row: 4, col: 4 }, 409);
  finish.resolve();
  const won = await settled(id);
  assert.equal(won.result, 'black');
  assert.equal(won.winning.length, 5);
});
