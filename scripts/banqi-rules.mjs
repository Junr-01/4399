const columns = 8;
const rows = 4;
export const banqiSize = columns * rows;
const inventory = { general: 1, advisor: 2, elephant: 2, chariot: 2, horse: 2, cannon: 2, soldier: 5 };
const ranks = Object.keys(inventory);
const otherPlayer = player => player === 'human' ? 'ai' : 'human';
const otherColor = color => color === 'red' ? 'black' : 'red';
const publicPiece = ({ color, type }) => ({ color, type });
const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];
const rays = Array.from({ length: banqiSize }, (_, from) => directions.map(([dr, dc]) => {
  const line = [];
  for (let row = Math.floor(from / columns) + dr, col = from % columns + dc;
    row >= 0 && row < rows && col >= 0 && col < columns; row += dr, col += dc) {
    line.push(row * columns + col);
  }
  return line;
}));

function deal(random) {
  const board = ['red', 'black'].flatMap(color => Object.entries(inventory).flatMap(([type, count]) =>
    Array.from({ length: count }, () => ({ color, type, open: false }))));
  for (let index = board.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [board[index], board[swap]] = [board[swap], board[index]];
  }
  return board;
}

function legalActions({ board, turn, sides, result }) {
  if (result) return [];
  const color = sides?.[turn];
  return board.flatMap((piece, from) => {
    if (!piece) return [];
    if (!piece.open) return [{ action: 'flip', to: from }];
    if (piece.color !== color) return [];
    return destinations(board, from).map(to => ({ action: 'move', from, to }));
  });
}

function destinations(board, from) {
  const mover = board[from];
  const enemy = target => target?.open && target.color !== mover.color;
  const targets = [];
  for (const ray of rays[from]) {
    if (!ray.length) continue;
    const adjacent = ray[0];
    if (!board[adjacent]) targets.push(adjacent);
    if (mover.type === 'cannon') {
      const [, target] = ray.filter(to => board[to]);
      if (enemy(board[target])) targets.push(target);
    } else if (enemy(board[adjacent]) && canCapture(mover.type, board[adjacent].type)) {
      targets.push(adjacent);
    }
  }
  return targets;
}

function canCapture(mover, target) {
  if (mover === 'general' && target === 'soldier') return false;
  if (mover === 'soldier' && target === 'general') return true;
  return ranks.indexOf(mover) <= ranks.indexOf(target);
}

function positionKey({ board, turn }) {
  return turn + board.map(piece => !piece ? '..' : !piece.open ? '??' : piece.color[0] + ranks.indexOf(piece.type)).join('');
}

function repeatedCycle(state, history) {
  if (state.quiet < 6) return false;
  const keys = history.slice(-state.quiet).map(entry => positionKey(entry.state));
  keys.push(positionKey(state));
  const end = keys.length - 1;
  for (let period = 2; period * 3 <= end; period += 2) {
    const start = end - period * 3;
    // Each step in the first two loops must match its counterpart in the following loop.
    if (keys.slice(start, end - period + 1).every((key, offset) => key === keys[start + offset + period])) return true;
  }
  return false;
}

function finish(state, history) {
  const { board, turn, sides, quiet } = state;
  const winner = otherPlayer(turn);
  if (!board.some(piece => piece?.color === sides[turn])) return { winner, reason: 'elimination' };
  if (!legalActions(state).length) return { winner, reason: 'no-action' };
  if (quiet >= 60) return { winner: null, reason: 'quiet-limit' };
  if (repeatedCycle(state, history)) return { winner: null, reason: 'repetition' };
  return null;
}

export function createBanqi({ first = 'human', random = Math.random, position } = {}) {
  const initial = structuredClone(position);
  let state = { turn: first, sides: null, quiet: 0, result: null, ...initial, board: initial?.board ?? deal(random) };
  const history = [];

  function undoIndex() {
    const index = history.findLastIndex(entry => entry.action.player === 'human');
    return index >= 0 && history.slice(index).every(entry => entry.action.action === 'move') ? index : -1;
  }

  function snapshot() {
    const { board, turn, sides, quiet, result } = state;
    const moves = structuredClone(history.map(entry => entry.action));
    return {
      board: board.map(piece => !piece ? null : piece.open ? publicPiece(piece) : 'dark'),
      turn, sides: sides && { ...sides }, quiet, result: result && { ...result },
      legal: legalActions(state), moves, last: moves.at(-1) ?? null, canUndo: undoIndex() >= 0,
    };
  }

  function play(input) {
    const action = legalActions(state).find(item => item.action === input.action && item.from === input.from && item.to === input.to);
    if (!action) return false;
    const { turn: player } = state;
    const turn = otherPlayer(player);
    const board = state.board.slice();
    const target = board[action.to];
    const piece = action.action === 'flip' ? { ...target, open: true } : board[action.from];
    board[action.to] = piece;
    const record = { ...action, player, piece: publicPiece(piece) };
    if (action.action === 'move') {
      board[action.from] = null;
      if (target) record.target = publicPiece(target);
    }
    const sides = state.sides ?? { [player]: piece.color, [turn]: otherColor(piece.color) };
    history.push({ state, action: record });
    state = { board, turn, sides, quiet: target ? 0 : state.quiet + 1, result: null };
    state.result = finish(state, history);
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
