import { camps, opposite, points } from '../shared/chinese-checkers-board.mjs';

const directions = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
const pointIdByCoordinate = new Map(points.map(({ id, q, r }) => [`${q},${r}`, id]));
const routes = points.map(({ q, r }) => directions.map(([dq, dr]) => ({
  neighbor: pointIdByCoordinate.get(`${q + dq},${r + dr}`),
  beyond: pointIdByCoordinate.get(`${q + 2 * dq},${r + 2 * dr}`),
})).filter(({ neighbor }) => neighbor !== undefined));

function movesFrom(board, from, side, seats) {
  const goal = opposite(side);
  const leavesGoal = (position, to) => points[position].camp === goal && points[to].camp !== goal;
  const canStop = to => {
    const { camp } = points[to];
    return camp === side || camp === goal || !seats.includes(camp);
  };
  const moves = [];
  for (const { neighbor: to } of routes[from]) {
    if (board[to] === null && canStop(to) && !leavesGoal(from, to)) {
      moves.push({ from, to, path: [from, to], swap: false });
    }
  }

  // Only the selected piece moves. Its original hole stays vacant during the chain.
  const jumpPaths = new Map([[from, [from]]]);
  for (const [position, path] of jumpPaths) {
    for (const { neighbor, beyond: to } of routes[position]) {
      if (neighbor === from || board[neighbor] === null || board[to] !== null || jumpPaths.has(to) || leavesGoal(position, to)) continue;
      const next = [...path, to];
      jumpPaths.set(to, next);
      if (canStop(to)) moves.push({ from, to, path: next, swap: false });
    }
  }
  return moves;
}

function distance(from, to) {
  const dq = points[from].q - points[to].q;
  const dr = points[from].r - points[to].r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

function legalMoves(board, side, seats) {
  const moves = points.flatMap(({ id: from }) => board[from] === side ? movesFrom(board, from, side, seats) : []);
  const goal = opposite(side);
  const remaining = camps[goal].filter(id => board[id] !== side);
  if (remaining.length !== 1 || board[remaining[0]] !== goal) return moves;

  const [blocker] = remaining;
  const finalPiece = points.find(({ id, camp }) => camp !== goal && board[id] === side);
  if (!finalPiece) return moves;
  const { id: from } = finalPiece;
  const remainingDistance = distance(from, blocker);
  if (moves.some(move => move.from === from && distance(move.to, blocker) < remainingDistance)) return moves;
  moves.push({ from, to: blocker, path: [from, blocker], swap: true });
  return moves;
}

export function createChineseCheckers(seats, { board: initialBoard, side: first = seats[0] } = {}) {
  const human = seats[0];
  const history = [];
  let board = initialBoard?.slice() ?? points.map(({ camp }) => seats.includes(camp) ? camp : null);
  let side = first;
  let legal = [];
  let lastMove = null;
  let result = null;

  function startTurn(fromIndex) {
    for (let offset = 0; offset < seats.length; offset += 1) {
      side = seats[(fromIndex + offset) % seats.length];
      legal = legalMoves(board, side, seats);
      if (legal.length > 0) return;
    }
    result = { winner: null, reason: 'no-moves' };
  }

  function play(input) {
    const move = input && legal.find(({ from, to }) => from === input.from && to === input.to);
    if (!move) return false;
    if (side === human) history.push({ board: [...board], lastMove });
    board[move.from] = move.swap ? board[move.to] : null;
    board[move.to] = side;
    lastMove = { ...move, side };
    if (camps[opposite(side)].every(id => board[id] === side)) {
      result = { winner: side, reason: move.swap ? 'blocked' : 'goal' };
      legal = [];
    } else {
      startTurn(seats.indexOf(side) + 1);
    }
    return true;
  }

  function undo() {
    const previous = history.pop();
    if (!previous) return false;
    board = previous.board;
    lastMove = previous.lastMove;
    result = null;
    startTurn(0);
    return true;
  }

  function snapshot() {
    return {
      seats: [...seats], board: [...board], side, result: result && { ...result },
      legal: legal.map(({ from, to }) => ({ from, to })),
      lastMove: lastMove && { ...lastMove, path: [...lastMove.path] },
      canUndo: history.length > 0,
    };
  }

  startTurn(seats.indexOf(first));
  return { snapshot, play, undo };
}
