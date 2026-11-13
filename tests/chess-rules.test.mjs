import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChess } from '../scripts/chess-rules.mjs';

const move = (from, to, promotion) => promotion ? { from, to, promotion } : { from, to };

test('standard opening has 32 pieces and only 20 legal white moves', () => {
  const game = createChess();
  const start = game.snapshot();
  assert.equal(start.board.filter(Boolean).length, 32);
  assert.equal(start.side, 'white');
  assert.equal(start.legal.length, 20);
  assert.equal(game.play(move('e2', 'e5')), false);
  assert.equal(game.play(move('e2', 'e4')), true);
  assert.equal(game.snapshot().side, 'black');
  assert.equal(game.snapshot().board[36], 'P');
});

test('third occurrence includes the starting position and is removed by undo', () => {
  const game = createChess();
  const cycle = [move('g1', 'f3'), move('g8', 'f6'), move('f3', 'g1'), move('f6', 'g8')];
  for (const step of [...cycle, ...cycle.slice(0, 3)]) assert.equal(game.play(step), true);
  assert.equal(game.snapshot().result, null);
  assert.equal(game.play(cycle[3]), true);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'repetition' });
  assert.equal(game.play(move('e2', 'e4')), false);
  game.undoTo(7);
  assert.equal(game.snapshot().result, null);
  assert.equal(game.play(cycle[3]), true);
  assert.equal(game.snapshot().result.reason, 'repetition');
});

test('judges the FIDE arbiter manual’s locked pawn position a draw', () => {
  // 2026 FIDE Arbiters’ Manual, Article 1.5, after h5.
  const game = createChess('8/2b1k3/7p/p1p1p1pP/PpP1P1P1/1P1BK3/8/8 b - - 0 1');
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'dead-position' });
  const open = createChess('8/2b1k3/7p/p1p1p1p1/PpP1P1P1/1P1BK3/8/8 b - - 0 1');
  assert.equal(open.snapshot().result, null);
});

test('ends at 100 half-moves, while pawn moves and captures reset the clock', () => {
  const fen = '4k3/7p/8/8/8/8/P7/R3K3 w - -';
  const game = createChess(fen + ' 98 1');
  assert.equal(game.play(move('a1', 'b1')), true);
  assert.equal(game.snapshot().result, null);
  assert.equal(game.play(move('e8', 'e7')), true);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'fifty-move' });
  game.undoTo(1);
  assert.equal(game.snapshot().result, null);
  assert.equal(game.play(move('h7', 'h6')), true);
  assert.match(game.snapshot().fen, / - 0 2$/);
  const capture = createChess('4k3/8/8/8/8/8/p7/R3K3 w - - 99 1');
  assert.equal(capture.play(move('a1', 'a2')), true);
  assert.equal(capture.snapshot().result, null);
});

test('checkmate takes precedence over 100 half-moves and double knights can mate', () => {
  const game = createChess('8/k1K5/8/8/N7/2N5/8/8 w - - 97 1');
  for (const step of [move('c3', 'b5'), move('a7', 'a8'), move('a4', 'b6')]) {
    assert.equal(game.play(step), true);
  }
  assert.deepEqual(game.snapshot().result, { winner: 'white', reason: 'checkmate' });
});

test('distinguishes stalemate from positions with insufficient mating material', () => {
  assert.equal(createChess('k7/8/1QK5/8/8/8/8/8 b - - 0 1').snapshot().result.reason, 'stalemate');
  for (const fen of [
    'k7/8/8/8/8/8/8/4K3 w - - 0 1',
    'k7/8/8/8/8/8/8/2B1K3 w - - 0 1',
    'k7/8/8/8/8/8/8/2N1K3 w - - 0 1',
    'k7/8/8/8/5b2/8/8/2B1K3 w - - 0 1',
  ]) assert.equal(createChess(fen).snapshot().result.reason, 'dead-position');
});

test('a capture giving check can still leave a dead position', () => {
  const game = createChess('4k3/3n4/8/8/6B1/8/8/4K3 w - - 0 1');
  assert.equal(game.play(move('g4', 'd7')), true);
  assert.equal(game.snapshot().check, true);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'dead-position' });
});

test('includes castling rights in repetition and restores them when undoing a castle', () => {
  const fen = '4k1n1/8/8/8/8/8/8/4K2R w K - 0 1';
  const game = createChess(fen);
  const cycle = [move('h1', 'h2'), move('g8', 'f6'), move('h2', 'h1'), move('f6', 'g8')];
  for (const step of [...cycle, ...cycle]) assert.equal(game.play(step), true);
  assert.equal(game.snapshot().result, null);
  game.undoTo(0);
  assert.equal(game.play(move('e1', 'g1')), true);
  assert.deepEqual(game.snapshot().board.slice(60), [null, 'R', 'K', null]);
  game.undoTo(0);
  assert.equal(game.snapshot().fen, fen);
  assert.deepEqual(game.snapshot().legal.find(entry => entry.to === 'g1' && entry.from === 'e1'), move('e1', 'g1'));

  const attacked = createChess('k4r2/8/8/8/8/8/8/4K2R w K - 0 1');
  assert.equal(attacked.play(move('e1', 'g1')), false);
});

test('requires a legal en passant capture to distinguish otherwise repeated positions', () => {
  const cycle = [move('g1', 'f3'), move('g8', 'f6'), move('f3', 'g1'), move('f6', 'g8')];
  for (const [fen, canCapture] of [
    ['4k1n1/8/8/3pP3/8/8/8/4K1N1 w - d6 0 2', true],
    ['k3r1n1/8/8/3pP3/8/8/8/4K1N1 w - d6 0 2', false],
  ]) {
    const game = createChess(fen);
    assert.equal(game.play(move('e5', 'd6')), canCapture);
    if (canCapture) {
      assert.equal(game.snapshot().board[27], null);
      assert.equal(game.snapshot().board[19], 'P');
      game.undoTo(0);
      assert.equal(game.snapshot().fen, fen);
    }
    for (const step of [...cycle, ...cycle]) assert.equal(game.play(step), true);
    assert.equal(game.snapshot().result?.reason, canCapture ? undefined : 'repetition');
  }
});

test('requires one of four promotion choices and restores the pawn on undo', () => {
  const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  const game = createChess(fen);
  assert.deepEqual(game.snapshot().legal.filter(step => step.from === 'a7').map(step => step.promotion).sort(), ['b', 'n', 'q', 'r']);
  assert.equal(game.play(move('a7', 'a8')), false);
  assert.equal(game.play(move('a7', 'a8', 'k')), false);
  for (const type of ['q', 'r', 'b', 'n']) {
    assert.equal(game.play(move('a7', 'a8', type)), true);
    assert.equal(game.snapshot().board[0], type.toUpperCase());
    game.undoTo(0);
    assert.equal(game.snapshot().fen, fen);
  }
});
