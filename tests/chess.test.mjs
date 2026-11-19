import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startServer } from '../scripts/server.mjs';

const models = [{ id: 'example', name: 'Example', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true }];
const config = { side: 'black', model: 'example', effort: 'high' };

async function game(t, choose) {
  const directory = await mkdtemp(join(tmpdir(), '4399-chess-test-'));
  const chessDirectory = join(directory, 'chess');
  const server = await startServer(0, { chessDirectory, codex: {
    catalog: async () => models,
    openMatch: (config, game, options) => ({ move: (input, signal) => choose(input, signal, config, game, options), dispose() {} }),
    close() {},
  } });
  const origin = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });

  async function request(path, body, status = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/api/chess' + path, {
      method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const output = response.status === 204 ? null : await response.json();
    assert.equal(response.status, status, JSON.stringify(output));
    return output;
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
    request, read, settled, chessDirectory,
    start: (options = config) => request('/matches', options, 201),
    act: (state, action, fields, status) => request('/matches/' + state.id, { action, revision: state.revision, ...fields }, status),
  };
}

const position = input => input.callTool('get_position', {});
const movePiece = (input, from, to, promotion) => input.callTool('move_piece', promotion === undefined
  ? { from, to } : { from, to, promotion });
const play = (act, state, from, to, status) => act(state, 'move', { from, to }, status);

test('shows a committed AI move before handing the turn to the player', { timeout: 5000 }, async t => {
  const committed = Promise.withResolvers();
  const finish = Promise.withResolvers();
  t.after(() => finish.resolve());
  const { request, start, act, settled, read } = await game(t, async (input, _, options, game, workspace) => {
    try {
      assert.equal(game, 'chess');
      assert.equal(options.model, 'example');
      assert.equal(options.effort, 'high');
      assert.deepEqual(workspace.dynamicTools.map(tool => tool.name), ['get_position', 'move_piece']);
      assert.equal(input.text, '我已落子');
      const before = position(input);
      assert.deepEqual(Object.keys(before).sort(), ['check', 'fen', 'lastMove', 'legal', 'moveCommitted']);
      assert.match(before.fen, / b KQkq - 0 1$/);
      assert.equal(before.check, false);
      assert.deepEqual(before.lastMove, { from: 'e2', to: 'e4', side: 'white', san: 'e4' });
      assert.equal(before.moveCommitted, false);
      assert.equal(before.legal.length, 20);
      assert.throws(() => input.callTool('get_position', { side: 'black' }), /无需参数/);
      assert.throws(() => input.callTool('get_position', []), /无需参数/);
      assert.throws(() => input.callTool('get_position', false), /无需参数/);
      assert.throws(() => input.callTool('get_position', null), /无需参数/);
      assert.throws(() => movePiece(input, 'e9', 'e5'), /坐标/);
      assert.throws(() => input.callTool('move_piece', { from: 'e7', to: 'e5', extra: true }), /只接受/);
      assert.throws(() => movePiece(input, 'e4', 'e5'), /己方棋子/);
      assert.throws(() => movePiece(input, 'e7', 'e3'), /合法着法/);
      assert.throws(() => movePiece(input, 'e7', 'e5', 'q'), /无需升变/);
      assert.equal(movePiece(input, 'e7', 'e5'), '走棋成功。');
      assert.throws(() => movePiece(input, 'g8', 'f6'), /本回合已走棋/);
      const after = position(input);
      assert.equal(after.moveCommitted, true);
      assert.match(after.fen, / w KQkq - 0 2$/);
      assert.deepEqual(after.lastMove, { from: 'e7', to: 'e5', side: 'black', san: 'e5' });
      assert.deepEqual(after.legal, []);
      committed.resolve();
    } catch (error) {
      committed.resolve(error);
      throw error;
    }
    await finish.promise;
  });
  assert.deepEqual((await request('/models')).models, models);
  await request('/matches', { ...config, effort: 'max' }, 400);
  const opening = await start({ ...config, side: 'white' });
  await play(act, opening, 'e2', 'e5', 400);
  const pending = await play(act, opening, 'e2', 'e4');
  assert.equal(pending.aiTurn, true);
  const failure = await committed.promise;
  if (failure) throw failure;
  const held = await read(opening.id);
  assert.equal(held.thinking, true);
  assert.equal(held.aiTurn, true);
  assert.equal(held.side, 'white');
  assert.equal(held.lastMove.san, 'e5');
  assert.deepEqual(held.legal, []);
  await play(act, held, 'g1', 'f3', 409);
  finish.resolve();
  const next = await settled(opening.id);
  assert.equal(next.aiTurn, false);
  assert.equal(next.lastMove.san, 'e5');
  assert(next.legal.some(move => move.from === 'g1' && move.to === 'f3'));
});

test('retries within one AI turn, retains a committed move, and keeps the white opening when black undoes', async t => {
  const attempts = [];
  const { start, act, settled } = await game(t, input => {
    const observed = position(input);
    attempts.push({ text: input.text, observed });
    switch (attempts.length) {
      case 1: return movePiece(input, 'e2', 'e4');
      case 2: return; // Completed without moving.
      case 3: throw new DOMException('Timed out before moving', 'TimeoutError');
      case 4:
        movePiece(input, 'g1', 'f3');
        throw new Error('Connection lost after moving');
      case 5: throw new DOMException('Timed out after moving', 'TimeoutError');
    }
  });
  const startState = await start();
  assert.equal(startState.aiTurn, true);
  assert.equal(startState.humanSide, 'black');
  assert.deepEqual(startState.legal, []);
  const opened = await settled(startState.id);
  assert.deepEqual(opened.lastMove, { from: 'e2', to: 'e4', side: 'white', san: 'e4' });
  assert.equal(opened.canUndo, false);
  const pending = await play(act, opened, 'e7', 'e5');
  const failed = await settled(opened.id);
  assert.equal(failed.aiTurn, true);
  assert.match(failed.error, /请重试/);
  assert.equal(failed.lastMove.san, 'Nf3');
  assert.equal(attempts.length, 5);
  assert.equal(attempts[0].text, '棋局开始');
  assert.match(attempts[0].observed.fen, / w KQkq - 0 1$/);
  assert.equal(attempts[1].text, '我已落子');
  assert.deepEqual(attempts.slice(1, 4).map(attempt => attempt.observed.moveCommitted), [false, false, false]);
  assert(attempts.slice(2, 4).every(attempt => attempt.text === '请查看当前局面，然后走一着。'));
  assert.equal(attempts[4].observed.moveCommitted, true);
  assert.deepEqual(attempts[4].observed.legal, []);
  await play(act, failed, 'b8', 'c6', 409);
  await act(failed, 'retry');
  const answered = await settled(opened.id);
  assert.equal(attempts.length, 6);
  assert.match(attempts[5].text, /已经成功走棋/);
  assert.deepEqual(attempts[4], attempts[5]);
  assert.equal(answered.aiTurn, false);
  assert.equal(answered.error, null);
  assert.deepEqual(answered.lastMove, failed.lastMove);
  const undone = await act(pending, 'undo');
  assert.equal(undone.canUndo, false);
  assert.deepEqual(undone.lastMove, opened.lastMove);
  assert.deepEqual(undone.board, opened.board);
  await act(pending, 'undo', {}, 409);
});

test('undo invalidates an in-flight tool request and replay sends the new position', { timeout: 5000 }, async t => {
  const first = Promise.withResolvers();
  const endAttempt = Promise.withResolvers();
  t.after(() => endAttempt.resolve());
  const seen = [];
  let turns = 0;
  const { start, act, settled } = await game(t, (input, signal) => {
    seen.push({ text: input.text, position: position(input) });
    if (++turns === 1) {
      first.resolve({ input, signal });
      return endAttempt.promise;
    }
    return movePiece(input, 'd7', 'd5');
  });
  const original = await start({ ...config, side: 'white' });
  const pending = await play(act, original, 'e2', 'e4');
  const { input, signal } = await first.promise;
  const undone = await act(pending, 'undo');
  assert.equal(signal.aborted, true);
  assert.deepEqual(undone.board, original.board);
  assert.throws(() => movePiece(input, 'e7', 'e5'), /AI 请求已失效/);
  assert.throws(() => position(input), /AI 请求已失效/);
  endAttempt.resolve();
  await play(act, undone, 'd2', 'd4');
  const answered = await settled(original.id);
  assert.equal(answered.lastMove.san, 'd5');
  assert.deepEqual(seen.map(turn => turn.text), ['我已落子', '我悔棋了，已经重新落子']);
  assert.deepEqual(seen.map(turn => turn.position.lastMove.san), ['e4', 'd4']);
});

test('a tool call arriving after pause and replacement cannot change either game', { timeout: 5000 }, async t => {
  const started = Promise.withResolvers();
  const late = Promise.withResolvers();
  t.after(() => late.resolve());
  const { request, read, start, act } = await game(t, (input, signal) => {
    started.resolve({ input, signal });
    return late.promise;
  });
  const original = await start({ ...config, side: 'white' });
  const pending = await play(act, original, 'e2', 'e4');
  const { input, signal } = await started.promise;
  const paused = await act(pending, 'pause');
  assert.equal(signal.aborted, true);
  assert.equal(paused.lastMove.san, 'e4');
  const replacement = await start({ ...config, side: 'white', replace: paused.id });
  assert.notEqual(replacement.id, original.id);
  assert.equal(replacement.lastMove, null);
  assert.throws(() => movePiece(input, 'e7', 'e5'), /AI 请求已失效/);
  late.resolve();
  await request('/matches/' + original.id, undefined, 404);
  assert.deepEqual(await read(replacement.id), replacement);
});

test('the AI sees all promotion choices and must specify its chosen piece', async t => {
  const aiMoves = [['a2', 'a4'], ['a4', 'b5'], ['b5', 'a6'], ['a6', 'a7']];
  let choices;
  const { start, act, settled } = await game(t, input => {
    if (aiMoves.length) return movePiece(input, ...aiMoves.shift());
    choices = position(input).legal.filter(move => move.from === 'a7' && move.to === 'b8');
    assert.throws(() => movePiece(input, 'a7', 'b8'), /必须指定升变棋子/);
    assert.throws(() => movePiece(input, 'a7', 'b8', 'k'), /q、r、b 或 n/);
    return movePiece(input, 'a7', 'b8', 'n');
  });
  const started = await start();
  let current = await settled(started.id);
  for (const [from, to] of [['b7', 'b5'], ['a7', 'a6'], ['b8', 'c6'], ['a8', 'b8']]) {
    await play(act, current, from, to);
    current = await settled(started.id);
  }
  assert.deepEqual(choices.map(move => move.promotion).sort(), ['b', 'n', 'q', 'r']);
  assert.deepEqual(current.lastMove, { from: 'a7', to: 'b8', side: 'white', san: 'axb8=N', promotion: 'n' });
  assert.equal(current.board[1], 'N');
});

test('a paused AI checkmate retains its move and waits for the resumed turn to finish', { timeout: 5000 }, async t => {
  const matingMove = Promise.withResolvers();
  const cancelled = Promise.withResolvers();
  t.after(() => cancelled.resolve());
  let recovered;
  const { start, act, read, settled } = await game(t, (input, signal) => {
    const state = position(input);
    if (state.moveCommitted) {
      recovered = state;
      return;
    }
    if (state.lastMove.san === 'f3') return movePiece(input, 'e7', 'e5');
    movePiece(input, 'd8', 'h4');
    matingMove.resolve({ input, signal });
    return cancelled.promise;
  });
  const opening = await start({ ...config, side: 'white' });
  await play(act, opening, 'f2', 'f3');
  const beforeMate = await settled(opening.id);
  const pending = await play(act, beforeMate, 'g2', 'g4');
  const { input, signal } = await matingMove.promise;
  const held = await read(opening.id);
  assert.equal(held.aiTurn, true);
  assert.equal(held.lastMove.san, 'Qh4#');
  assert.equal(held.check, true);
  assert.equal(held.result, null);
  const paused = await act(pending, 'pause');
  assert.equal(paused.paused, true);
  assert.equal(paused.aiTurn, true);
  assert.equal(paused.result, null);
  assert.equal(signal.aborted, true);
  assert.throws(() => position(input), /AI 请求已失效/);
  cancelled.resolve();
  await act(paused, 'resume');
  const result = await settled(opening.id);
  assert.equal(result.aiTurn, false);
  assert.equal(recovered.moveCommitted, true);
  assert.equal(recovered.check, true);
  assert.deepEqual(recovered.legal, []);
  assert.deepEqual(recovered.lastMove, result.lastMove);
  assert.deepEqual(result.result, { winner: 'black', reason: 'checkmate' });
  const undone = await act(result, 'undo');
  assert.equal(undone.result, null);
  assert.deepEqual(undone.board, beforeMate.board);
  assert.deepEqual(undone.legal, beforeMate.legal);
});

test('match directories carry the actual side and survive closing or replacing a game', async t => {
  const { request, start, act, settled, chessDirectory } = await game(t, input => movePiece(input, 'd2', 'd4'));
  await request('/models');
  assert.equal(await readFile(join(chessDirectory, '.4399-root'), 'utf8'), '');
  const shared = join(chessDirectory, 'AGENTS.md');
  const instructions = await readFile(shared, 'utf8');
  for (const name of ['role.md', 'rule.md', 'tools.md']) {
    const source = await readFile(new URL(`../docs/chess-prompts/${name}`, import.meta.url), 'utf8');
    assert(instructions.includes(source.trimEnd()));
  }
  const withLocalNote = instructions + '\n本地补充。\n';
  await writeFile(shared, withLocalNote);
  await request('/models');
  assert.equal(await readFile(shared, 'utf8'), withLocalNote);

  const white = await start({ ...config, side: 'white' });
  const paused = await act(white, 'pause');
  const black = await start({ ...config, replace: paused.id });
  const blackOpened = await settled(black.id);
  assert.equal(blackOpened.lastMove.san, 'd4');
  await request('/matches/' + black.id, undefined, 204, 'DELETE');
  const random = await start({ ...config, side: 'random' });
  const instructionsFor = id => readFile(join(chessDirectory, id, 'AGENTS.md'), 'utf8');
  assert.match(await instructionsFor(white.id), /对手（人类玩家）执白先走，你执黑后走。/);
  assert.match(await instructionsFor(black.id), /你执白先走，对手（人类玩家）执黑后走。/);
  assert.equal(await instructionsFor(random.id), await instructionsFor(random.humanSide === 'white' ? white.id : black.id));
});
