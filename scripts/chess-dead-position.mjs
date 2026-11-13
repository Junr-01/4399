// A sufficient test for a locked pawn position with only kings, bishops and pawns.
// Overestimate where the mobile pieces can go with the pawns fixed. If neither
// side can ever give check or change the pawn structure, neither can mate.
const diagonals = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const neighbors = [...diagonals, [-1, 0], [1, 0], [0, -1], [0, 1]];
const colors = ['w', 'b'];
const enemy = color => color === 'w' ? 'b' : 'w';

function offset(square, dr, dc) {
  const row = (square >> 3) + dr;
  const col = (square % 8) + dc;
  return row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : -1;
}

function reach(start, directions, blocked) {
  // Bishops can reach the same connected component by successive unit diagonals.
  const squares = new Set(start);
  for (const square of squares) {
    for (const [dr, dc] of directions) {
      const next = offset(square, dr, dc);
      if (next >= 0 && !blocked(next)) squares.add(next);
    }
  }
  return squares;
}

export function isLockedPawnPosition(board, enPassant) {
  const pawns = new Map();
  const kings = { w: [], b: [] };
  const bishops = { w: [], b: [] };
  for (const [square, piece] of board.entries()) {
    if (!piece) continue;
    const { type, color } = piece;
    if (type === 'p') pawns.set(square, color);
    else if (type === 'k') kings[color].push(square);
    else if (type === 'b') bishops[color].push(square);
    else return false;
  }
  if (!pawns.size || enPassant !== '-') return false;

  const attacks = { w: new Set(), b: new Set() };
  for (const [square, color] of pawns) {
    const forward = color === 'w' ? -1 : 1;
    if (!pawns.has(offset(square, forward, 0))) return false;
    for (const dc of [-1, 1]) {
      const target = offset(square, forward, dc);
      if (target < 0) continue;
      if (pawns.get(target) === enemy(color)) return false;
      attacks[color].add(target);
    }
  }

  const bishopReach = Object.fromEntries(colors.map(color =>
    [color, reach(bishops[color], diagonals, square => pawns.has(square))]));
  if ([...bishopReach.w].some(square => bishopReach.b.has(square))) return false;

  for (const color of colors) {
    const opposite = enemy(color);
    const canEnter = square => !attacks[opposite].has(square);
    const kingReach = reach(kings[color], neighbors, square => pawns.has(square) || !canEnter(square));
    for (const square of kingReach) {
      if (bishopReach[opposite].has(square)) return false;
      for (const [dr, dc] of neighbors) {
        const target = offset(square, dr, dc);
        if (pawns.get(target) === opposite && canEnter(target)) return false;
      }
    }
    if ([...attacks[opposite]].some(square => bishopReach[color].has(square))) return false;
    for (const [square, owner] of pawns) {
      if (owner !== opposite) continue;
      if (diagonals.some(([dr, dc]) => bishopReach[color].has(offset(square, dr, dc)))) return false;
    }
  }
  return true;
}
