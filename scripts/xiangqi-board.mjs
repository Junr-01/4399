export const opposite = side => side === 'red' ? 'black' : 'red';
const rows = 10;
const columns = 9;
const rowOf = point => Math.floor(point / columns);
const colOf = point => point % columns;
const forward = side => side === 'red' ? -1 : 1;
const crossedRiver = (side, row) => side === 'red' ? row < 5 : row >= 5;
const inPalace = (side, row, col) => col >= 3 && col <= 5 && (side === 'red' ? row >= 7 : row <= 2);

export function movedBoard(board, { from, to }) {
  const next = board.slice();
  next[to] = next[from];
  next[from] = null;
  return next;
}

function canReach(board, from, to, attack = false) {
  if (from === to) return false;
  const { type, side } = board[from];
  const target = board[to];
  if (target?.side === side) return false;
  const row = rowOf(from);
  const col = colOf(from);
  const destRow = rowOf(to);
  const destCol = colOf(to);
  const dr = destRow - row;
  const dc = destCol - col;
  const height = Math.abs(dr);
  const width = Math.abs(dc);

  if (type === 'k' && !(attack && target?.type === 'k' && !dc)) {
    return height + width === 1 && inPalace(side, destRow, destCol);
  }
  if (type === 'a') return height === 1 && width === 1 && inPalace(side, destRow, destCol);
  if (type === 'e') {
    return height === 2 && width === 2 && !crossedRiver(side, destRow)
      && !board[(row + dr / 2) * columns + col + dc / 2];
  }
  if (type === 'h') {
    if (height * width !== 2) return false;
    const leg = height === 2 ? from + Math.sign(dr) * columns : from + Math.sign(dc);
    return !board[leg];
  }
  if (type === 'p') return (dr === forward(side) && !dc) || (!dr && width === 1 && crossedRiver(side, row));
  if (dr && dc) return false;

  const step = Math.sign(dr) * columns + Math.sign(dc);
  const screens = type === 'c' && target ? 1 : 0;
  let occupied = 0;
  for (let point = from + step; point !== to; point += step) {
    if (board[point] && ++occupied > screens) return false;
  }
  return occupied === screens;
}

export function inCheck(board, side) {
  const king = board.findIndex(piece => piece?.side === side && piece.type === 'k');
  if (king < 0) return true;
  return board.some((piece, from) => piece && piece.side !== side && canReach(board, from, king, true));
}

export function checkLines(board, side) {
  const king = board.findIndex(piece => piece?.side === side && piece.type === 'k');
  if (king < 0) return [];
  return board.flatMap((piece, from) =>
    piece && piece.side !== side && canReach(board, from, king, true) ? [{ from, to: king }] : []);
}

const orthogonal = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const diagonal = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const offsets = {
  k: orthogonal,
  a: diagonal,
  e: diagonal.map(([row, col]) => [2 * row, 2 * col]),
  h: diagonal.flatMap(([row, col]) => [[2 * row, col], [row, 2 * col]]),
  p: orthogonal,
};

function targets(from, type) {
  const row = rowOf(from);
  const col = colOf(from);
  const points = offsets[type]?.map(([dr, dc]) => [row + dr, col + dc]) ?? [
    ...Array.from({ length: rows }, (_, r) => [r, col]),
    ...Array.from({ length: columns }, (_, c) => [row, c]),
  ];
  return points.filter(([r, c]) => r >= 0 && r < rows && c >= 0 && c < columns)
    .map(([r, c]) => r * columns + c);
}

const destinations = Object.fromEntries(Object.keys(offsets).concat('r', 'c').map(type =>
  [type, Array.from({ length: rows * columns }, (_, from) => targets(from, type))],
));

export function legalMoves(board, side, { capture, onlyCaptures = false } = {}) {
  const moves = [];
  for (let from = 0; from < board.length; from++) {
    const piece = board[from];
    if (piece?.side !== side) continue;
    const points = capture === undefined ? destinations[piece.type][from] : [capture];
    for (const to of points) {
      if (board[to]?.type === 'k' || ((onlyCaptures || capture !== undefined) && !board[to])) continue;
      if (!canReach(board, from, to)) continue;
      const move = { from, to };
      if (!inCheck(movedBoard(board, move), side)) moves.push(move);
    }
  }
  return moves;
}

export function positionKey(board, side) {
  return side + board.map(piece => !piece ? '.' : piece.side === 'red' ? piece.type.toUpperCase() : piece.type).join('');
}
