import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChineseCheckers } from '../scripts/chinese-checkers-rules.mjs';
import { camps, points, seatsFor } from '../shared/chinese-checkers-board.mjs';

test('opens a 121-hole star with ten pieces per occupied camp for every player count', () => {
  assert.equal(points.length, 121);
  assert.deepEqual(points[0], { id: 0, q: 4, r: -8, camp: 3 });
  assert.deepEqual(points[120], { id: 120, q: -4, r: 8, camp: 0 });
  assert.deepEqual(camps.map(camp => camp.length), [10, 10, 10, 10, 10, 10]);

  const layouts = [[0, 3], [0, 2, 4], [0, 1, 3, 4], [0, 1, 2, 4, 5], [0, 1, 2, 3, 4, 5]];
  for (const [offset, layout] of layouts.entries()) {
    const game = createChineseCheckers(seatsFor(offset + 2));
    const position = game.snapshot();
    assert.deepEqual(position.seats, layout);
    assert.equal(position.side, 0);
    assert.equal(position.board.filter(seat => seat !== null).length, 10 * layout.length);
    for (const [seat, camp] of camps.entries()) {
      assert.ok(camp.every(id => position.board[id] === (layout.includes(seat) ? seat : null)));
    }
  }
});

const pointAt = (q, r) => points.find(point => point.q === q && point.r === r).id;
const move = (from, to) => ({ from: pointAt(...from), to: pointAt(...to) });
const positionWith = (...pieces) => {
  const board = points.map(() => null);
  for (const [q, r, side] of pieces) board[pointAt(q, r)] = side;
  return board;
};

test('permits a step to an adjacent empty hole and passes play only to occupied seats', () => {
  const game = createChineseCheckers(seatsFor(3), { board: positionWith([0, 0, 0], [1, 0, 2], [3, -3, 4]) });
  assert.equal(game.play(move([0, 0], [1, 0])), false);
  assert.equal(game.play(move([1, 0], [2, 0])), false);
  assert.equal(game.play(move([0, -1], [0, -2])), false);
  assert.equal(game.play(move([0, 0], [0, -2])), false);
  const step = move([0, 0], [0, -1]);
  assert.ok(game.snapshot().legal.some(({ from, to }) => from === step.from && to === step.to));
  assert.equal(game.play(step), true);
  assert.equal(game.snapshot().board[step.from], null);
  assert.equal(game.snapshot().board[step.to], 0);
  assert.deepEqual(game.snapshot().lastMove, { ...step, side: 0, path: [step.from, step.to], swap: false });
  assert.equal(game.snapshot().side, 2);
  assert.equal(game.play(move([1, 0], [2, 0])), true);
  assert.equal(game.snapshot().side, 4);
  assert.equal(game.play(move([3, -3], [3, -2])), true);
  assert.equal(game.snapshot().side, 0);
});

test('allows a turn in a multi-hop and leaves both friendly and opposing jump pieces in place', () => {
  const board = positionWith([0, 0, 0], [1, 0, 3], [2, -1, 0], [-1, 0, 3], [-2, 0, 3]);
  const game = createChineseCheckers(seatsFor(2), { board });
  assert.equal(game.play(move([0, 0], [-3, 0])), false);
  assert.equal(game.play(move([0, 0], [3, -2])), false);
  const short = move([0, 0], [2, 0]);
  assert.ok(game.snapshot().legal.some(({ from, to }) => from === short.from && to === short.to));
  const long = move([0, 0], [2, -2]);
  assert.equal(game.play(long), true);
  const position = game.snapshot();
  assert.deepEqual(position.lastMove.path, [long.from, short.to, long.to]);
  assert.equal(position.board[pointAt(1, 0)], 3);
  assert.equal(position.board[pointAt(2, -1)], 0);
});

test('allows passing through another starting camp by hopping and disallows stopping there', () => {
  const board = positionWith([-2, -2, 0], [-3, -2, 2], [-4, -1, 2]);
  const game = createChineseCheckers(seatsFor(3), { board });
  assert.equal(game.play(move([-2, -2], [-2, -3])), false);
  assert.equal(game.play(move([-2, -2], [-4, -2])), false);
  assert.equal(game.play(move([-2, -2], [-4, 0])), true);
  assert.deepEqual(game.snapshot().lastMove.path, [pointAt(-2, -2), pointAt(-4, -2), pointAt(-4, 0)]);

  const vacant = createChineseCheckers(seatsFor(2), { board: positionWith([-2, -2, 0]) });
  assert.equal(vacant.play(move([-2, -2], [-2, -3])), true);
});

test('allows entering the goal even if it is a starting camp and keeps every subsequent hop inside', () => {
  const board = positionWith([2, -3, 0], [2, -4, 3], [1, -4, 3], [4, 0, 3]);
  const game = createChineseCheckers(seatsFor(2), { board });
  assert.equal(game.play(move([2, -3], [0, -3])), false);
  assert.equal(game.play(move([2, -3], [2, -5])), true);
  assert.equal(game.play(move([4, 0], [3, 0])), true);
  assert.equal(game.play(move([2, -5], [1, -4])), false);
  assert.equal(game.play(move([2, -5], [0, -3])), false);
  assert.equal(game.play(move([2, -5], [3, -5])), true);
});

function nineInGoal(goal, openHole, lastPiece) {
  const board = positionWith([...lastPiece, 0]);
  for (const id of camps[goal]) if (id !== pointAt(...openHole)) board[id] = 0;
  return board;
}

test('ends the whole match immediately when the first seat places its tenth piece in its goal', () => {
  const game = createChineseCheckers(seatsFor(6), { board: nineInGoal(3, [1, -5], [1, -4]) });
  assert.equal(game.snapshot().result, null);
  assert.equal(game.play(move([1, -4], [1, -5])), true);
  assert.deepEqual(game.snapshot().result, { winner: 0, reason: 'goal' });
  assert.deepEqual(game.snapshot().legal, []);
  assert.equal(game.play(move([1, -5], [2, -5])), false);
});

test('automatically passes a player with no route and keeps the last actual move visible', () => {
  const board = positionWith([0, 0, 0], [4, 4, 2], [3, 4, 4], [4, 3, 4], [2, 4, 4], [4, 2, 4]);
  const game = createChineseCheckers(seatsFor(3), { board });
  const step = move([0, 0], [1, 0]);
  assert.equal(game.play(step), true);
  const position = game.snapshot();
  assert.equal(position.side, 4);
  assert.equal(position.result, null);
  assert.deepEqual(position.lastMove, { ...step, side: 0, path: [step.from, step.to], swap: false });
});

test('draws when all three sides are trapped in filled camps without an eligible swap', () => {
  const board = positionWith();
  for (const [goal, side, tip, visitor] of [[3, 0, [4, -8], 2], [5, 2, [4, 4], 4], [1, 4, [-8, 4], 0]]) {
    for (const id of camps[goal]) board[id] = id === pointAt(...tip) ? visitor : side;
  }
  const position = createChineseCheckers(seatsFor(3), { board }).snapshot();
  assert.deepEqual(position.result, { winner: null, reason: 'no-moves' });
  assert.deepEqual(position.legal, []);
});

test('undo returns to before the last human move and removes every intervening AI move', () => {
  const game = createChineseCheckers(seatsFor(3), { board: positionWith([0, 0, 0], [1, 0, 2], [3, -3, 4]) });
  const opening = game.snapshot();
  assert.equal(opening.canUndo, false);
  assert.equal(game.undo(), false);
  assert.equal(game.play(move([0, 0], [0, -1])), true);
  assert.equal(game.play(move([1, 0], [2, 0])), true);
  assert.equal(game.play(move([3, -3], [3, -2])), true);
  const beforeNextRound = game.snapshot();
  assert.equal(beforeNextRound.canUndo, true);
  assert.equal(game.play(move([0, -1], [0, -2])), true);
  assert.equal(game.play(move([2, 0], [1, 0])), true);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.snapshot(), beforeNextRound);
  assert.equal(game.undo(), true);
  assert.deepEqual(game.snapshot(), opening);
});

test('wins by swapping the final piece with a blocker in its starting camp', () => {
  const board = nineInGoal(3, [1, -5], [1, -4]);
  const blocked = move([1, -4], [1, -5]);
  board[blocked.to] = 3;
  const game = createChineseCheckers(seatsFor(2), { board });
  assert.ok(game.snapshot().legal.some(entry => entry.from === blocked.from && entry.to === blocked.to));
  assert.equal(game.play(blocked), true);
  const result = game.snapshot();
  assert.equal(result.board[blocked.from], 3);
  assert.equal(result.board[blocked.to], 0);
  assert.deepEqual(result.lastMove, { ...blocked, side: 0, path: [blocked.from, blocked.to], swap: true });
  assert.deepEqual(result.result, { winner: 0, reason: 'blocked' });
  assert.equal(game.undo(), true);
  assert.deepEqual(game.snapshot().board, board);
});

test('allows swapping only when the final piece has no normal advancing move', () => {
  const blocker = [2, -6];
  const board = nineInGoal(3, blocker, [2, -2]);
  board[pointAt(...blocker)] = 3;
  board[pointAt(2, -3)] = 3;
  const game = createChineseCheckers(seatsFor(2), { board });
  assert.equal(game.play(move([2, -2], blocker)), false);
  assert.equal(game.play(move([2, -2], [2, -4])), true);
  assert.equal(game.play(move([2, -3], [3, -3])), true);
  assert.equal(game.play(move([2, -4], blocker)), true);
  assert.equal(game.snapshot().lastMove.swap, true);
});

test('does not swap with a visitor that did not start in the blocked camp', () => {
  const board = nineInGoal(3, [1, -5], [1, -4]);
  board[pointAt(1, -5)] = 2;
  const game = createChineseCheckers(seatsFor(3), { board });
  assert.equal(game.play(move([1, -4], [1, -5])), false);
  assert.equal(game.snapshot().result, null);
});

test('can win by exchanging a blocker stranded at the tip of the target camp', () => {
  const block = move([4, -4], [4, -8]);
  const board = nineInGoal(3, [4, -8], [4, -4]);
  board[block.to] = 3;
  const game = createChineseCheckers(seatsFor(2), { board });
  assert.equal(game.play(block), true);
  assert.deepEqual(game.snapshot().lastMove, { ...block, side: 0, path: [block.from, block.to], swap: true });
  assert.equal(game.snapshot().board[block.from], 3);
  assert.equal(game.snapshot().board[block.to], 0);
  assert.deepEqual(game.snapshot().result, { winner: 0, reason: 'blocked' });
});
