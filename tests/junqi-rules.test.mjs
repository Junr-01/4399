import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJunqi } from '../scripts/junqi-rules.mjs';

const flip = to => ({ action: 'flip', to });
const move = (from, to) => ({ action: 'move', from, to });

test('deals 50 dark pieces, leaves the ten camps empty, and opens one piece at a time', () => {
  const game = createJunqi({ random: () => 0.5 });
  const opening = game.snapshot();
  assert.deepEqual(opening.board.flatMap((cell, id) => cell === null ? [id] : []),
    [11, 13, 17, 21, 23, 36, 38, 42, 46, 48]);
  assert.equal(opening.board.filter(cell => cell === 'dark').length, 50);
  assert.deepEqual(opening.mines, { red: 3, blue: 3 });
  assert.equal(opening.legal.length, 50);
  assert.ok(opening.legal.every(action => action.action === 'flip'));
  assert.equal(game.play(flip(11)), false);
  assert.equal(game.play(move(0, 1)), false);

  const roster = { red: {}, blue: {} };
  for (const { to } of opening.legal) {
    assert.equal(game.play(flip(to)), true);
    const { piece } = game.snapshot().last;
    roster[piece.color][piece.type] = (roster[piece.color][piece.type] ?? 0) + 1;
  }
  const army = {
    commander: 1, general: 1, division: 2, brigade: 2, regiment: 2, battalion: 2,
    company: 3, platoon: 3, engineer: 3, bomb: 2, mine: 3, flag: 1,
  };
  assert.deepEqual(roster, { red: army, blue: army });
});

const red = (type, open = true) => ({ color: 'red', type, open });
const blue = (type, open = true) => ({ color: 'blue', type, open });
const sides = { human: 'red', ai: 'blue' };
function position(entries, options = {}) {
  const board = Array(60).fill(null);
  for (const [id, piece] of entries) board[id] = piece;
  return createJunqi({ position: { board, sides, ...options } });
}

test('each flipper compares their own prior color and the opponent acts next', () => {
  const game = position([[0, red('engineer', false)], [1, blue('engineer', false)],
    [2, blue('flag', false)], [3, blue('general', false)], [4, red('flag', false)]], { sides: null });
  for (const to of [0, 1, 2]) {
    assert.equal(game.play(flip(to)), true);
    assert.equal(game.snapshot().sides, null);
  }
  assert.equal(game.play(flip(3)), true);
  assert.deepEqual(game.snapshot().sides, { human: 'red', ai: 'blue' });
  assert.equal(game.snapshot().turn, 'human');
  assert.equal(game.snapshot().canUndo, false);
});

test('when all pieces have been revealed without a pair, the last flipper takes that color', () => {
  const game = position([[0, red('engineer', false)], [1, red('flag', false)],
    [2, blue('engineer', false)], [3, blue('flag', false)]], { sides: null });
  for (const to of [0, 1, 2, 3]) assert.equal(game.play(flip(to)), true);
  assert.deepEqual(game.snapshot().sides, sides);
  assert.equal(game.snapshot().turn, 'human');
});

test('only engineers turn on rails, dark pieces block travel, and occupied camps are safe', () => {
  const rail = type => position([[5, red(type)], [15, blue('battalion', false)],
    [11, blue('general')], [58, blue('flag')]]);
  const regular = rail('commander');
  const engineer = rail('engineer');
  assert.ok(regular.snapshot().legal.some(action => action.from === 5 && action.to === 9));
  for (const to of [14, 11, 15, 20]) assert.equal(regular.play(move(5, to)), false);
  for (const to of [11, 15, 41]) assert.equal(engineer.play(move(5, to)), false);
  assert.equal(engineer.play(move(5, 14)), true);
  assert.equal(engineer.snapshot().board[14].type, 'engineer');

  const base = position([[0, red('company')], [59, blue('company')]]);
  assert.equal(base.play(move(0, 1)), true);
  assert.equal(base.play(move(59, 58)), true);
  assert.equal(base.play(move(1, 0)), true);
  const camp = position([[11, red('company')], [59, blue('company')]]);
  assert.equal(camp.play(move(11, 5)), true);
});

test('combat resolves higher, lower and equal ranks and bombs symmetrically', () => {
  for (const [attacker, defender, survivor] of [
    ['division', 'regiment', red('division')], ['regiment', 'division', blue('division')],
    ['division', 'division', null], ['bomb', 'commander', null], ['commander', 'bomb', null],
  ]) {
    const game = position([[0, red(attacker)], [1, blue(defender)], [4, red('company')], [59, blue('company')]]);
    assert.equal(game.play(move(0, 1)), true);
    const state = game.snapshot();
    assert.equal(state.board[0], null);
    assert.deepEqual(state.board[1], survivor && { color: survivor.color, type: survivor.type });
    assert.equal(state.quiet, 0);
  }
});

test('three mixed mine removals unlock a revealed flag even with dark pieces remaining', () => {
  const game = position([
    [0, red('company')], [1, blue('flag')], [2, red('bomb')], [3, blue('mine')],
    [5, red('engineer')], [6, blue('mine')], [8, red('engineer')], [9, blue('mine')],
    [10, red('bomb', false)], [55, blue('company')], [56, blue('engineer', false)],
  ]);
  assert.equal(game.play(move(0, 1)), false);
  for (const action of [move(5, 6), move(55, 50), move(2, 3), move(50, 55)]) {
    assert.equal(game.play(action), true);
  }
  const beforeClear = game.snapshot();
  assert.deepEqual(beforeClear.mines, { red: 0, blue: 1 });
  assert.equal(game.play(move(8, 9)), true);
  assert.equal(game.play(move(55, 50)), true);
  assert.deepEqual(game.snapshot().mines, { red: 0, blue: 0 });
  assert.equal(game.undo(), true);
  assert.deepEqual(game.snapshot(), beforeClear);
  assert.equal(game.play(move(8, 9)), true);
  assert.equal(game.play(move(55, 50)), true);
  assert.equal(game.play(move(0, 1)), true);
  assert.deepEqual(game.snapshot().result, { winner: 'human', reason: 'flag' });
  assert.equal(game.snapshot().board[10], 'dark');
  assert.equal(game.undo(), true);
  assert.equal(game.snapshot().result, null);
  assert.equal(game.snapshot().board[1].type, 'flag');
});

test('a bomb capturing the flag wins before checking elimination', () => {
  const game = position([[0, red('bomb')], [1, blue('flag')], [59, blue('general')]]);
  assert.equal(game.play(move(0, 1)), true);
  assert.deepEqual(game.snapshot().result, { winner: 'human', reason: 'flag' });
  assert.equal(game.snapshot().board[1], null);
});

test('elimination counts unrevealed movable pieces and simultaneous elimination draws', () => {
  const combat = [[0, red('bomb')], [1, blue('general')]];
  const both = position(combat);
  assert.equal(both.play(move(0, 1)), true);
  assert.deepEqual(both.snapshot().result, { winner: null, reason: 'elimination' });
  const withDark = position([...combat, [2, red('company', false)], [3, blue('flag', false)]]);
  assert.equal(withDark.play(move(0, 1)), true);
  assert.deepEqual(withDark.snapshot().result, { winner: 'human', reason: 'elimination' });
});

test('the next player loses only if they have neither a move nor a flip', () => {
  const combat = [[54, red('division')], [0, blue('commander')], [1, blue('flag')], [5, blue('mine')]];
  const blocked = position(combat);
  assert.equal(blocked.play(move(54, 59)), true);
  assert.deepEqual(blocked.snapshot().result, { winner: 'human', reason: 'no-action' });
  const withDark = position([...combat, [2, red('general', false)]]);
  assert.equal(withDark.play(move(54, 59)), true);
  assert.equal(withDark.snapshot().result, null);
  assert.deepEqual(withDark.snapshot().legal, [flip(2)]);
});

test('the 30th quiet ply draws, while a reveal or removal resets the count', () => {
  const pieces = [[0, red('company')], [59, blue('company')]];
  const draw = position(pieces, { quiet: 28 });
  assert.equal(draw.play(move(0, 1)), true);
  assert.equal(draw.snapshot().quiet, 29);
  assert.equal(draw.snapshot().result, null);
  assert.equal(draw.play(move(59, 58)), true);
  assert.deepEqual(draw.snapshot().result, { winner: null, reason: 'quiet-limit' });
  assert.equal(draw.undo(), true);
  assert.equal(draw.snapshot().quiet, 28);
  const capture = position([...pieces, [1, blue('platoon')]], { quiet: 29 });
  assert.equal(capture.play(move(0, 1)), true);
  assert.equal(capture.snapshot().quiet, 0);
  const reveal = position([...pieces, [1, blue('platoon', false)]], { quiet: 29 });
  assert.equal(reveal.play(flip(1)), true);
  assert.equal(reveal.snapshot().quiet, 0);
  assert.equal(reveal.undo(), false);
});
