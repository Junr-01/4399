import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBanqi } from '../scripts/banqi-rules.mjs';

const piece = (color, type, open = true) => ({ color, type, open });
function position(cells, options) {
  const board = Array(32).fill(null);
  for (const [index, cell] of Object.entries(cells)) board[index] = cell;
  return createBanqi({ position: { board, sides: { human: 'red', ai: 'black' }, ...options } });
}

const flip = (game, to) => game.play({ action: 'flip', to });
const move = (game, from, to) => game.play({ action: 'move', from, to });

test('32 pieces start concealed and the opening reveal assigns the revealer its color', () => {
  const game = createBanqi({ first: 'ai', random: () => 0.5 });
  const initial = game.snapshot();
  assert.equal(initial.sides, null);
  assert.equal(initial.turn, 'ai');
  assert.deepEqual(initial.board, Array(32).fill('dark'));
  assert.deepEqual(initial.legal, Array.from({ length: 32 }, (_, to) => ({ action: 'flip', to })));
  assert.equal(flip(game, 7), true);
  const { board, sides, turn, last, canUndo } = game.snapshot();
  assert.equal(sides.ai, board[7].color);
  assert.equal(sides.human, board[7].color === 'red' ? 'black' : 'red');
  assert.equal(turn, 'human');
  assert.deepEqual(last, { action: 'flip', to: 7, player: 'ai', piece: board[7] });
  assert.equal(canUndo, false);
  const inventory = { general: 1, advisor: 2, elephant: 2, chariot: 2, horse: 2, cannon: 2, soldier: 5 };
  for (const to of initial.legal.map(action => action.to).filter(to => to !== 7)) assert.equal(flip(game, to), true);
  const revealed = game.snapshot().board;
  for (const color of ['red', 'black']) {
    const counts = revealed.filter(cell => cell.color === color).reduce((all, cell) => {
      all[cell.type] = (all[cell.type] ?? 0) + 1;
      return all;
    }, {});
    assert.deepEqual(counts, inventory);
  }
});

test('walks orthogonally, captures downward or equally, and applies the soldier-general exception', () => {
  const game = position({
    0: piece('red', 'general'), 1: piece('black', 'soldier'), 8: piece('black', 'advisor'),
    3: piece('red', 'soldier'), 4: piece('black', 'general'), 11: piece('black', 'soldier'),
    30: piece('red', 'horse'), 29: piece('black', 'chariot'), 22: piece('black', 'cannon'),
    13: piece('red', 'advisor'), 14: piece('black', 'advisor'),
  });
  const targets = from => game.snapshot().legal.filter(action => action.from === from).map(action => action.to).sort((a, b) => a - b);
  assert.deepEqual(targets(0), [8]);
  assert.deepEqual(targets(3), [2, 4, 11]);
  assert.deepEqual(targets(30), [22, 31]);
  assert.deepEqual(targets(13), [5, 12, 14, 21]);
  assert.equal(move(game, 0, 1), false);
  assert.equal(move(game, 3, 4), true);
  assert.equal(game.snapshot().board[3], null);
  assert.deepEqual(game.snapshot().board[4], { color: 'red', type: 'soldier' });
  assert.equal(game.snapshot().result, null);
});

test('a cannon walks one square or captures a revealed enemy over exactly one screen', () => {
  const game = position({
    10: piece('red', 'cannon'), 8: piece('black', 'soldier'), 11: piece('red', 'soldier', false),
    13: piece('black', 'general'), 14: piece('black', 'advisor'), 2: piece('black', 'soldier'),
    18: piece('black', 'soldier'), 26: piece('black', 'horse', false),
    25: piece('red', 'cannon'), 27: piece('black', 'elephant'),
  });
  const { legal } = game.snapshot();
  assert.deepEqual(legal.filter(action => action.from === 10), [9, 13].map(to => ({ action: 'move', from: 10, to })));
  for (const to of [2, 8, 11, 12, 14, 18, 26]) assert.equal(move(game, 10, to), false);
  assert.ok(legal.some(action => action.from === 25 && action.to === 27));
  assert.equal(move(game, 10, 13), true);
  assert.equal(game.snapshot().board[11], 'dark');
  assert.deepEqual(game.snapshot().last.target, { color: 'black', type: 'general' });
  assert.deepEqual(game.snapshot().board[13], { color: 'red', type: 'cannon' });
});

test('a side with no material or no legal action loses, even with a quiet limit reached', () => {
  const elimination = position({ 0: piece('red', 'soldier'), 1: piece('black', 'general'), 2: piece('red', 'horse', false) });
  assert.equal(move(elimination, 0, 1), true);
  assert.deepEqual(elimination.snapshot().result, { winner: 'human', reason: 'elimination' });
  assert.deepEqual(elimination.snapshot().legal, []);
  assert.equal(flip(elimination, 2), false);
  assert.equal(elimination.undo(), true);
  assert.equal(elimination.snapshot().result, null);
  assert.deepEqual(elimination.snapshot().board[1], { color: 'black', type: 'general' });

  const blocked = position({ 0: piece('black', 'soldier'), 1: piece('red', 'chariot'), 9: piece('red', 'horse') }, { quiet: 59 });
  assert.equal(move(blocked, 9, 8), true);
  assert.deepEqual(blocked.snapshot().result, { winner: 'human', reason: 'no-action' });
});

test('the 60th quiet ply draws, and a capture or reveal resets the count', () => {
  const cells = { 0: piece('red', 'chariot'), 1: piece('black', 'horse'), 31: piece('black', 'advisor', false) };
  const quiet = position(cells, { quiet: 59 });
  assert.equal(move(quiet, 0, 8), true);
  assert.deepEqual(quiet.snapshot().result, { winner: null, reason: 'quiet-limit' });
  for (const play of [game => flip(game, 31), game => move(game, 0, 1)]) {
    const progress = position(cells, { quiet: 59 });
    assert.equal(play(progress), true);
    assert.equal(progress.snapshot().quiet, 0);
    assert.equal(progress.snapshot().result, null);
  }
});

test('only three complete consecutive cycles draw, and undo restores the repetition history', () => {
  const game = position({ 0: piece('red', 'soldier'), 31: piece('black', 'soldier'), 27: piece('red', 'advisor', false) });
  const cycle = [[0, 1], [31, 30], [1, 0], [30, 31]];
  function repeat(times) {
    for (let index = 0; index < times; index++) {
      for (const [from, to] of cycle) assert.equal(move(game, from, to), true);
    }
  }
  repeat(2);
  assert.equal(game.snapshot().result, null);
  repeat(1);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'repetition' });
  assert.equal(game.undo(), true);
  assert.equal(game.snapshot().quiet, 10);
  assert.equal(game.snapshot().result, null);
  assert.equal(move(game, 1, 0), true);
  assert.equal(move(game, 30, 31), true);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'repetition' });
});

test('a player or AI reveal prevents undo through that action', () => {
  const game = position({ 0: piece('red', 'soldier'), 31: piece('black', 'soldier'), 27: piece('red', 'advisor', false) });
  assert.equal(move(game, 0, 1), true);
  assert.equal(game.snapshot().canUndo, true);
  assert.equal(flip(game, 27), true);
  assert.equal(game.snapshot().canUndo, false);
  assert.equal(game.undo(), false);
});

test('revisiting one position through different cycles does not draw', () => {
  const game = position({ 0: piece('red', 'soldier'), 31: piece('black', 'soldier') });
  const firstCycle = [[0, 1], [31, 30], [1, 0], [30, 31]];
  const otherCycle = [[0, 8], [31, 23], [8, 0], [23, 31]];
  for (const [from, to] of [...firstCycle, ...firstCycle, ...otherCycle, ...firstCycle]) {
    assert.equal(move(game, from, to), true);
  }
  assert.equal(game.snapshot().result, null);
});
