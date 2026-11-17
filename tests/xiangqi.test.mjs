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
const config = { side: 'red', model: 'example', effort: 'high' };
const at = square => (10 - Number(square.slice(1))) * 9 + square.charCodeAt(0) - 97;

async function game(t, choose) {
  const directory = await mkdtemp(join(tmpdir(), '4399-xiangqi-test-'));
  const xiangqiDirectory = join(directory, 'xiangqi');
  const codex = choose && {
    catalog: async () => models,
    openMatch: (config, game, options) => ({
      move: (input, signal) => choose(input, signal, config, game, options),
      dispose() {},
    }),
    close() {},
  };
  const server = await startServer(0, { codex, xiangqiDirectory });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
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
  return { origin, request, settled, xiangqiDirectory };
}

function play(request, path, state, from, to, status = 200) {
  return request(path, { action: 'move', revision: state.revision, from: at(from), to: at(to) }, status);
}

const movePiece = (input, from, to) => input.callTool('move_piece', { from: at(from), to: at(to) });

test('reads the current position, accepts a legal AI move, and keeps the player locked until completion', { timeout: 5000 }, async t => {
  const placed = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  const { request, settled } = await game(t, async (input, _, selected, game, options) => {
    assert.equal(game, 'xiangqi');
    assert.equal(selected.effort, 'high');
    assert.deepEqual(options.dynamicTools.map(({ name }) => name), ['get_position', 'move_piece']);
    assert.equal(input.text, '我已落子');
    const position = input.callTool('get_position', {});
    assert.equal(position.aiSide, 'black');
    assert.equal(position.sideToMove, 'black');
    assert.equal(position.moveCommitted, false);
    assert.equal(position.board.length, 90);
    assert.equal(position.board[at('e3')], 'C');
    assert.equal(position.board[at('h3')], null);
    assert.deepEqual(position.lastMove, { from: at('h3'), to: at('e3'), side: 'red' });
    assert.deepEqual(position.recentMoves, [position.lastMove]);
    assert.equal(position.check, false);
    assert.equal(position.adjudication, null);
    assert(position.legal.some(({ from, to }) => from === at('b10') && to === at('c8')));
    assert.throws(() => input.callTool('move_piece', { from: 1 }), /棋盘范围/);
    assert.throws(() => input.callTool('move_piece', { from: 1, to: 2.5 }), /棋盘范围/);
    assert.throws(() => input.callTool('move_piece', { from: -1, to: 0 }), /棋盘范围/);
    assert.throws(() => input.callTool('move_piece', { from: at('c8'), to: 3 }), /己方棋子/);
    assert.throws(() => movePiece(input, 'b10', 'e6'), /不符合该棋子的走法/);
    movePiece(input, 'b10', 'c8');
    assert.throws(() => movePiece(input, 'a10', 'a9'), /本回合已走棋/);
    const committed = input.callTool('get_position', {});
    assert.equal(committed.moveCommitted, true);
    assert.equal(committed.sideToMove, 'red');
    assert.deepEqual(committed.legal, []);
    placed.resolve();
    await finish.promise;
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
  await placed.promise;
  const pending = await request(path);
  assert.equal(pending.thinking, true);
  assert.equal(pending.aiTurn, true);
  assert.equal(pending.lastMove.to, at('c8'));
  assert.deepEqual(pending.legal, []);
  await play(request, path, pending, 'b1', 'c3', 409);
  await request(path, { action: 'claim-draw', revision: pending.revision }, 409);
  finish.resolve();
  const next = await settled(path);
  assert.equal(next.aiTurn, false);
  assert.equal(next.board[at('c8')].type, 'h');
  assert.equal(next.board[at('c8')].side, 'black');
  assert.equal(next.legal.length > 0, true);
  await play(request, path, start, 'b1', 'c3', 409);
});

test('black can retry and undo an AI capture that survived four failed attempts', async t => {
  let attempts = 0;
  const { request, settled } = await game(t, input => {
    const attempt = ++attempts;
    const position = input.callTool('get_position', {});
    if (attempt === 1) {
      assert.equal(input.text, '棋局开始');
      return movePiece(input, 'h3', 'e3');
    }
    if (attempt === 2) {
      assert.equal(input.text, '我已落子');
      return;
    }
    if (attempt === 3) {
      assert.match(input.text, /查看当前局面/);
      assert.equal(position.moveCommitted, false);
      throw new DOMException('Codex took too long before moving', 'TimeoutError');
    }
    if (attempt === 4) {
      assert.match(input.text, /查看当前局面/);
      movePiece(input, 'e3', 'e7');
      throw new Error('Codex disconnected after capturing');
    }
    assert.match(input.text, /已经成功走棋/);
    assert.equal(position.moveCommitted, true);
    assert.equal(position.board[at('e7')], 'C');
    assert.deepEqual(position.legal, []);
    assert.throws(() => movePiece(input, 'b1', 'c3'), /本回合已走棋/);
    if (attempt === 5) throw new DOMException('Codex took too long to finish', 'TimeoutError');
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
  assert.equal(attempts, 5);
  assert.match(failed.error, /请重试/);
  assert.equal(failed.aiTurn, true);
  assert.equal(failed.lastMove.captured.type, 'p');
  await play(request, path, failed, 'e10', 'f10', 409);
  await request(path, { action: 'retry', revision: failed.revision });
  const capture = await settled(path);
  assert.equal(attempts, 6);
  assert.equal(capture.error, null);
  assert.equal(capture.aiTurn, false);
  assert.equal(capture.check, true);
  assert.deepEqual(capture.board, failed.board);
  const undo = await request(path, { action: 'undo', revision: failed.revision });
  assert.equal(undo.canUndo, false);
  assert.equal(undo.lastMove.side, 'red');
  assert.deepEqual(undo.board, opening.board);
});

test('tells a checked AI why an otherwise valid piece move was rejected', async t => {
  let replies = 0;
  const { request, settled } = await game(t, input => {
    if (++replies === 1) return movePiece(input, 'h8', 'e8');
    const position = input.callTool('get_position', {});
    assert.equal(position.check, true);
    assert.throws(() => movePiece(input, 'a7', 'a6'), /己方帅将仍会被将军/);
    movePiece(input, 'e8', 'd8');
  });
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  await play(request, path, start, 'h3', 'e3');
  const reply = await settled(path);
  await play(request, path, reply, 'e3', 'e7');
  const finished = await settled(path);
  assert.equal(finished.error, null);
  assert.equal(replies, 2);
  assert.equal(finished.lastMove.to, at('d8'));
});

test('pause and undo discard late replies and the next turn reads the revised position', { timeout: 5000 }, async t => {
  const first = Promise.withResolvers();
  const late = Promise.withResolvers();
  t.after(() => late.resolve());
  let turns = 0;
  const { request, settled } = await game(t, async (input, signal) => {
    if (++turns === 1) {
      first.resolve({ signal, callTool: input.callTool });
      await late.promise;
      return;
    }
    assert.equal(input.text, '我悔棋了，已经重新落子');
    const position = input.callTool('get_position', {});
    assert.equal(position.board[at('c3')], 'H');
    assert.equal(position.board[at('e3')], null);
    movePiece(input, 'b10', 'c8');
  });
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  const played = await play(request, path, start, 'h3', 'e3');
  const { signal, callTool } = await first.promise;
  const paused = await request(path, { action: 'pause', revision: played.revision });
  assert.equal(paused.paused, true);
  assert.equal(signal.aborted, true);
  const resumed = await request(path, { action: 'resume', revision: paused.revision });
  assert.equal(resumed.paused, false);
  const undo = await request(path, { action: 'undo', revision: resumed.revision });
  await play(request, path, undo, 'b1', 'c3');
  assert.throws(() => callTool('move_piece', { from: at('h8'), to: at('e8') }), /已失效/);
  late.resolve();
  const final = await settled(path);
  assert.equal(turns, 2);
  assert.equal(final.lastMove.to, at('c8'));
  const pause = await request(path, { action: 'pause', revision: final.revision });
  const replacement = await request('/matches', { ...config, effort: 'low', replace: pause.id }, 201);
  assert.notEqual(replacement.id, pause.id);
  assert.equal(replacement.config.effort, 'low');
  await request(path, undefined, 404);
});

test('the same undo request cannot take back a second round', async t => {
  const { request, settled } = await game(t, input => {
    const [move] = input.callTool('get_position', {}).legal;
    input.callTool('move_piece', move);
  });
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

test('shows the AI a pending variation and restores the adjudication on undo', async t => {
  const notices = [];
  const { request, settled } = await game(t, input => {
    const position = input.callTool('get_position', {});
    notices.push(position);
    if (position.adjudication) return movePiece(input, 'h10', 'g8');
    const from = position.board[at('b10')] ? 'b10' : 'c8';
    movePiece(input, from, from === 'b10' ? 'c8' : 'b10');
  });
  let state = await request('/matches', config, 201);
  const path = '/matches/' + state.id;
  for (let round = 0; round < 6; round++) {
    const [from, to] = round % 2 ? ['c3', 'b1'] : ['b1', 'c3'];
    await play(request, path, state, from, to);
    state = await settled(path);
    assert.equal(state.error, null);
  }
  const pending = { side: 'red', reason: 'repetition', remaining: 2 };
  assert.deepEqual(state.adjudication, pending);
  await play(request, path, state, 'b1', 'c3');
  const varied = await settled(path);
  assert.equal(varied.adjudication, null);
  assert.deepEqual(notices.at(-1).adjudication, { ...pending, remaining: 1 });
  assert.equal(notices.at(-1).recentMoves.length, 8);
  assert.deepEqual(notices.at(-1).recentMoves.at(-1), { from: at('b1'), to: at('c3'), side: 'red' });
  const rewound = await request(path, { action: 'undo', revision: varied.revision });
  assert.deepEqual(rewound.adjudication, pending);
  assert.deepEqual(rewound.board, state.board);
});

test('keeps natural move count at the player boundary through a capture, undo, and a draw claim', async t => {
  const seen = new Set();
  const key = board => board.map(piece => piece ?? '.').join('');
  const codes = board => board.map(piece => piece && (piece.side === 'red' ? piece.type.toUpperCase() : piece.type));
  function quietMove(board, legal) {
    for (const move of legal) {
      if (board[move.to]) continue;
      const after = board.slice();
      after[move.to] = after[move.from];
      after[move.from] = null;
      const next = key(after);
      if (!seen.has(next)) {
        seen.add(next);
        return move;
      }
    }
    assert.fail('Expected a new capture-free position');
  }
  let replies = 0;
  const { request, settled } = await game(t, input => {
    const { board, legal } = input.callTool('get_position', {});
    input.callTool('move_piece', ++replies <= 60 ? quietMove(board, legal) : legal[0]);
  });
  let state = await request('/matches', config, 201);
  const path = '/matches/' + state.id;
  seen.add(key(codes(state.board)));
  for (let round = 0; round < 60; round++) {
    assert.equal(state.canClaimDraw, false);
    const move = quietMove(codes(state.board), state.legal);
    await request(path, { action: 'move', revision: state.revision, ...move });
    state = await settled(path);
    assert.equal(state.error, null);
  }
  assert.equal(state.canClaimDraw, true);
  const capture = state.legal.find(({ to }) => state.board[to]);
  assert(capture);
  await request(path, { action: 'move', revision: state.revision, ...capture });
  const afterCapture = await settled(path);
  assert.equal(afterCapture.canClaimDraw, false);
  const restored = await request(path, { action: 'undo', revision: afterCapture.revision });
  assert.equal(restored.canClaimDraw, true);
  assert.deepEqual(restored.board, state.board);
  const drawn = await request(path, { action: 'claim-draw', revision: restored.revision });
  assert.deepEqual(drawn.result, { winner: null, reason: 'no-capture' });
  const beforeDraw = await request(path, { action: 'undo', revision: drawn.revision });
  assert.equal(beforeDraw.result, null);
  assert.equal(beforeDraw.canClaimDraw, false);
});

test('keeps shared instructions and records resolved colors in each workspace', async t => {
  const { origin, request, settled, xiangqiDirectory } = await game(t, input => movePiece(input, 'h3', 'e3'));
  await request('/models');
  const shared = join(xiangqiDirectory, 'AGENTS.md');
  assert.match(await readFile(shared, 'utf8'), /中国象棋职业选手[\s\S]*4399 中国象棋规则/);
  await writeFile(shared, '本地指令\n');
  const red = await request('/matches', config, 201);
  const black = await request('/matches', { ...config, side: 'black' }, 201);
  const random = await request('/matches', { ...config, side: 'random' }, 201);
  assert.equal((await settled('/matches/' + black.id)).error, null);
  assert.equal((await settled('/matches/' + random.id)).error, null);
  const readInstructions = state => readFile(join(xiangqiDirectory, state.id, 'AGENTS.md'), 'utf8');
  assert.match(await readInstructions(red), /对手（人类玩家）执红先走，你执黑后走/);
  assert.match(await readInstructions(black), /你执红先走，对手（人类玩家）执黑后走/);
  assert.equal(await readInstructions(random), await readInstructions(random.humanSide === 'red' ? red : black));
  const response = await fetch(origin + '/api/xiangqi/matches/' + black.id, { method: 'DELETE', headers: { Origin: origin } });
  assert.equal(response.status, 204);
  assert.match(await readInstructions(black), /你执红先走/);
  assert.equal(await readFile(shared, 'utf8'), '本地指令\n');
});

test('resumes a committed response from a pause without allowing a second move', { timeout: 5000 }, async t => {
  const committed = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  const { request, settled } = await game(t, async (input, signal) => {
    if (input.text === '我已落子') {
      movePiece(input, 'b10', 'c8');
      committed.resolve(signal);
      await release.promise;
      return;
    }
    assert.match(input.text, /已经成功走棋/);
    assert.throws(() => movePiece(input, 'h8', 'e8'), /本回合已走棋/);
  });
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  const played = await play(request, path, start, 'h3', 'e3');
  const signal = await committed.promise;
  const paused = await request(path, { action: 'pause', revision: played.revision });
  assert.equal(paused.paused, true);
  assert.equal(paused.aiTurn, true);
  assert.equal(paused.lastMove.to, at('c8'));
  assert.equal(signal.aborted, true);
  release.resolve();
  await request(path, { action: 'resume', revision: paused.revision });
  const resumed = await settled(path);
  assert.equal(resumed.error, null);
  assert.equal(resumed.aiTurn, false);
  assert.deepEqual(resumed.board, paused.board);
});

test('undo during recovery removes the committed move and invalidates that attempt', { timeout: 5000 }, async t => {
  const recovering = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  let attempts = 0;
  const { request, settled } = await game(t, async (input, signal) => {
    if (++attempts === 1) {
      movePiece(input, 'h8', 'e8');
      throw new Error('Codex disconnected after moving');
    }
    if (attempts === 2) {
      recovering.resolve({ input, signal });
      await finish.promise;
      throw new Error('Late recovery failure');
    }
    assert.equal(input.text, '我悔棋了，已经重新落子');
    movePiece(input, 'b10', 'c8');
  });
  const start = await request('/matches', config, 201);
  const path = '/matches/' + start.id;
  const played = await play(request, path, start, 'h3', 'e3');
  const { input, signal } = await recovering.promise;
  assert.equal((await request(path)).lastMove.to, at('e8'));
  const restored = await request(path, { action: 'undo', revision: played.revision });
  assert.deepEqual(restored.board, start.board);
  assert.equal(signal.aborted, true);
  assert.throws(() => input.callTool('get_position', {}), /已失效/);
  finish.resolve();
  await play(request, path, restored, 'b1', 'c3');
  const final = await settled(path);
  assert.equal(final.lastMove.to, at('c8'));
  assert.equal(final.error, null);
  assert.equal(attempts, 3);
});

const mateLine = [
  ['b1-a3', 'h8-h1'], ['a1-b1', 'b8-b1'], ['e1-e2', 'h1-f1'], ['e2-d2', 'f1-i1'],
  ['b3-b8', 'i1-d1'], ['b8-c8', 'b10-c8'], ['d2-d3', 'a10-a9'], ['c1-e3', 'a9-d9'],
].map(round => round.map(move => move.split('-')));

test('holds an AI checkmate until recovery completes and allows undo afterwards', { timeout: 5000 }, async t => {
  const enteredRecovery = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  let turns = 0;
  const { request, settled } = await game(t, async input => {
    if (turns === mateLine.length) {
      const position = input.callTool('get_position', {});
      assert.equal(position.moveCommitted, true);
      assert.equal(position.check, true);
      assert.deepEqual(position.legal, []);
      enteredRecovery.resolve();
      await finish.promise;
      return;
    }
    movePiece(input, ...mateLine[turns++][1]);
    if (turns === mateLine.length) throw new Error('Codex interrupted while completing the winning turn');
  });
  let state = await request('/matches', config, 201);
  const path = '/matches/' + state.id;
  for (const [[from, to]] of mateLine.slice(0, -1)) {
    await play(request, path, state, from, to);
    state = await settled(path);
    assert.equal(state.error, null);
  }
  const beforeMate = state;
  await play(request, path, state, ...mateLine.at(-1)[0]);
  await enteredRecovery.promise;
  const pending = await request(path);
  assert.equal(pending.result, null);
  assert.equal(pending.aiTurn, true);
  assert.equal(pending.lastMove.to, at('d9'));
  finish.resolve();
  const ended = await settled(path);
  assert.deepEqual(ended.result, { winner: 'black', reason: 'checkmate' });
  assert.equal(ended.aiTurn, false);
  const restored = await request(path, { action: 'undo', revision: ended.revision });
  assert.equal(restored.result, null);
  assert.deepEqual(restored.board, beforeMate.board);
});

test('a player checkmate ends the game without scheduling an AI reply', async t => {
  let turns = 0;
  const { request, settled } = await game(t, input => movePiece(input, ...mateLine[turns++][0]));
  let state = await request('/matches', { ...config, side: 'black' }, 201);
  const path = '/matches/' + state.id;
  for (const [, [from, to]] of mateLine) {
    state = await settled(path);
    assert.equal(state.error, null);
    state = await play(request, path, state, from, to);
  }
  assert.deepEqual(state.result, { winner: 'black', reason: 'checkmate' });
  assert.equal(state.aiTurn, false);
  assert.equal(state.thinking, false);
  assert.equal(turns, mateLine.length);
});

test('reuses a healthy App Server thread and rebuilds failed threads in the same workspace', {
  timeout: 5000, skip: process.platform === 'win32' && 'The fake CLI uses a POSIX executable script',
}, async t => {
  const directory = await mkdtemp(join(tmpdir(), '4399-xiangqi-codex-fixture-'));
  const executable = join(directory, 'codex');
  const trace = join(directory, 'turns.jsonl');
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(executable, '#!' + process.execPath + '\n' + String.raw`
    const assert = require('node:assert/strict');
    const { appendFileSync, readFileSync } = require('node:fs');
    const { createInterface } = require('node:readline');
    const send = message => console.log(JSON.stringify(message));
    const threads = new Map();
    let turn;
    let number = 0;
    const call = (id, tool, args) => send({ id, method: 'item/tool/call', params: { ...turn, tool, arguments: args } });
    const complete = status => send({ method: 'turn/completed', params: {
      threadId: turn.threadId, turn: { id: turn.turnId, status },
    } });
    createInterface({ input: process.stdin }).on('line', line => {
      const { id, method, params, result } = JSON.parse(line);
      const reply = result => send({ id, result });
      if (method === 'initialize') return reply({});
      if (method === 'account/read') return reply({ requiresOpenaiAuth: false });
      if (method === 'model/list') return reply({ data: [{ model: 'example', displayName: 'Example',
        supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] });
      if (method === 'thread/start') {
        assert.equal(params.ephemeral, true);
        assert.equal(params.sandbox, 'read-only');
        assert.equal(params.developerInstructions, undefined);
        assert.deepEqual(params.dynamicTools.map(({ name }) => name), ['get_position', 'move_piece']);
        assert.match(readFileSync(params.cwd + '/../AGENTS.md', 'utf8'), /中国象棋职业选手/);
        assert.match(readFileSync(params.cwd + '/AGENTS.md', 'utf8'), /# 先手/);
        const id = 'thread-' + (threads.size + 1);
        threads.set(id, params.cwd);
        return reply({ thread: { id } });
      }
      if (method === 'turn/start') {
        assert.equal(params.model, 'example');
        assert.equal(params.effort, 'high');
        assert.equal(params.outputSchema, undefined);
        turn = { threadId: params.threadId, turnId: 'turn-' + ++number };
        appendFileSync(__dirname + '/turns.jsonl', JSON.stringify({ thread: turn.threadId, cwd: threads.get(turn.threadId),
          message: params.input[0].text }) + '\n');
        reply({ turn: { id: turn.turnId } });
        return call('view', 'get_position', {});
      }
      if (method === 'thread/unsubscribe') return reply({ status: 'unsubscribed' });
      if (id === 'view') {
        assert(result.success);
        const position = JSON.parse(result.contentItems[0].text);
        assert.equal(position.board.length, 90);
        if (number === 2) return complete('failed');
        return call('move', 'move_piece', position.legal[0]);
      }
      if (id === 'move') {
        assert(result.success);
        complete('completed');
      }
    });
  `, { mode: 0o700 });
  const previous = process.env.CODEX_BIN;
  process.env.CODEX_BIN = executable;
  t.after(() => {
    if (previous === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = previous;
  });
  const { request, settled, xiangqiDirectory } = await game(t);
  let state = await request('/matches', config, 201);
  const path = '/matches/' + state.id;
  await assert.rejects(readFile(trace), { code: 'ENOENT' });
  for (const [from, to] of [['h3', 'e3'], ['b1', 'c3']]) {
    await play(request, path, state, from, to);
    state = await settled(path);
    assert.equal(state.error, null);
  }
  const other = await request('/matches', { ...config, side: 'black' }, 201);
  assert.equal((await settled('/matches/' + other.id)).error, null);
  const entries = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(entries.map(({ thread }) => thread), ['thread-1', 'thread-1', 'thread-2', 'thread-3']);
  assert.deepEqual(entries.map(({ cwd }) => cwd), [state.id, state.id, state.id, other.id].map(id => join(xiangqiDirectory, id)));
  assert.deepEqual(entries.map(({ message }) => message), ['我已落子', '我已落子', '请查看当前局面，然后走一着。', '棋局开始']);
});
