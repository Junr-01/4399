import { links, points } from '../app/junqi-board.mjs';

const armies = {
  commander: 1, general: 1, division: 2, brigade: 2, regiment: 2, battalion: 2,
  company: 3, platoon: 3, engineer: 3, bomb: 2, mine: 3, flag: 1,
};
const ranks = Object.keys(armies);
const colors = ['red', 'blue'];
const otherPlayer = who => who === 'human' ? 'ai' : 'human';
const otherColor = color => color === 'red' ? 'blue' : 'red';
const movable = piece => piece && piece.type !== 'flag' && piece.type !== 'mine';
const publicPiece = ({ color, type }) => ({ color, type });

function deal(random) {
  const pieces = colors.flatMap(color => Object.entries(armies).flatMap(([type, count]) =>
    Array.from({ length: count }, () => ({ color, type, open: false }))));
  for (let index = pieces.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [pieces[index], pieces[swap]] = [pieces[swap], pieces[index]];
  }
  return points.map(point => point.camp ? null : pieces.pop());
}

function mineCounts(board) {
  const mines = { red: 0, blue: 0 };
  for (const piece of board) {
    if (piece?.type === 'mine') mines[piece.color]++;
  }
  return mines;
}

function destinations(board, from, enemyMines) {
  const mover = board[from];
  const targets = new Set();

  function markTargetAndCanContinue(to) {
    const target = board[to];
    if (!target) {
      targets.add(to);
      return true;
    }
    if (target.open && target.color !== mover.color && !points[to].camp
      && (target.type !== 'flag' || enemyMines === 0)
      && (target.type !== 'mine' || mover.type === 'engineer' || mover.type === 'bomb')) {
      targets.add(to);
    }
    return false;
  }

  function followRail(at, axis, visited) {
    for (const link of links[at]) {
      if (link.type !== 'rail' || (axis && link.axis !== axis) || visited.has(link.to)) continue;
      visited.add(link.to);
      if (markTargetAndCanContinue(link.to)) followRail(link.to, axis, visited);
    }
  }

  for (const link of links[from]) {
    if (link.type === 'road') markTargetAndCanContinue(link.to);
  }
  if (mover.type === 'engineer') followRail(from, null, new Set([from]));
  else {
    followRail(from, 'horizontal', new Set([from]));
    followRail(from, 'vertical', new Set([from]));
  }
  return [...targets];
}

function legalActions({ board, sides, turn, result }) {
  if (result) return [];
  const color = sides?.[turn];
  const enemyMines = color ? mineCounts(board)[otherColor(color)] : 0;
  return board.flatMap((piece, point) => {
    if (!piece) return [];
    if (!piece.open) return [{ action: 'flip', to: point }];
    if (piece.color !== color || !movable(piece)) return [];
    return destinations(board, point, enemyMines).map(to => ({ action: 'move', from: point, to }));
  });
}

function resolveCombat(mover, target) {
  if (!target) return mover;
  if (mover.type === 'bomb' || target.type === 'bomb' || mover.type === target.type) return null;
  if (target.type === 'mine' || target.type === 'flag') return mover;
  return ranks.indexOf(mover.type) < ranks.indexOf(target.type) ? mover : target;
}

function finish(state, capturedFlag) {
  const { board, turn, sides, quiet } = state;
  if (capturedFlag) return { winner: otherPlayer(turn), reason: 'flag' };
  if (!sides) return null;
  const surviving = new Set(board.filter(movable).map(piece => piece.color));
  if (surviving.size < 2) {
    const winner = surviving.has(sides.human) ? 'human' : surviving.has(sides.ai) ? 'ai' : null;
    return { winner, reason: 'elimination' };
  }
  if (!legalActions(state).length) return { winner: otherPlayer(turn), reason: 'no-action' };
  if (quiet >= 30) return { winner: null, reason: 'quiet-limit' };
  return null;
}

export function createJunqi({ random = Math.random, first = 'human', position } = {}) {
  let state = {
    board: position?.board ?? deal(random), turn: first, sides: null, flips: { human: null, ai: null },
    quiet: 0, result: null, ...structuredClone(position),
  };
  const history = [];

  function undoIndex() {
    if (!state.sides) return -1;
    const index = history.findLastIndex(entry => entry.action.player === 'human');
    return index >= 0 && history.slice(index).every(entry => entry.action.action === 'move') ? index : -1;
  }

  function snapshot() {
    const { board, turn, sides, flips, quiet, result } = state;
    const moves = history.map(entry => entry.action);
    return {
      board: board.map(piece => !piece ? null : piece.open ? publicPiece(piece) : 'dark'),
      turn, sides: sides && { ...sides }, flips: { ...flips }, quiet, result: result && { ...result },
      mines: mineCounts(board), legal: legalActions(state), moves: structuredClone(moves),
      last: moves.length ? structuredClone(moves.at(-1)) : null, canUndo: undoIndex() >= 0,
    };
  }

  function play(input) {
    const action = legalActions(state).find(item => item.action === input.action && item.from === input.from && item.to === input.to);
    if (!action) return false;

    const { turn: player } = state;
    const turn = otherPlayer(player);
    const board = state.board.slice();
    const target = board[action.to];
    const record = { ...action, player };
    let { sides, flips } = state;
    if (action.action === 'flip') {
      board[action.to] = { ...target, open: true };
      if (!sides && (flips[player] === target.color || board.every(cell => !cell || cell.open))) {
        sides = { [player]: target.color, [turn]: otherColor(target.color) };
      }
      flips = { ...flips, [player]: target.color };
      record.piece = publicPiece(target);
    } else {
      const mover = board[action.from];
      const survivor = resolveCombat(mover, target);
      board[action.from] = null;
      board[action.to] = survivor;
      record.piece = publicPiece(mover);
      if (target) {
        record.target = publicPiece(target);
        record.survivor = survivor ? publicPiece(survivor) : null;
      }
    }

    const next = { board, turn, sides, flips, quiet: target ? 0 : state.quiet + 1, result: null };
    next.result = finish(next, action.action === 'move' && target?.type === 'flag');
    history.push({ state, action: record });
    state = next;
    return true;
  }

  function undo() {
    const index = undoIndex();
    if (index < 0) return false;
    state = history[index].state;
    history.length = index;
    return true;
  }

  return { snapshot, play, undo };
}
