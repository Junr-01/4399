import { adjudicate } from './xiangqi-adjudication.mjs';
import { initialPlacement, parseBoard } from '../app/xiangqi-position.mjs';
import { inCheck, legalMoves, movedBoard, opposite, positionKey } from './xiangqi-board.mjs';

function frame(board, side, quietPlies) {
  const check = inCheck(board, side);
  const legal = legalMoves(board, side);
  let result = null;
  if (!legal.length) result = { winner: opposite(side), reason: check ? 'checkmate' : 'stalemate' };
  // Advisors and elephants stay in their own half, and these positions leave
  // each king an exit inside its palace. Neither side can win.
  else if (board.every(piece => !piece || ['k', 'a', 'e'].includes(piece.type))) {
    result = { winner: null, reason: 'insufficient-material' };
  }
  return { board, side, legal, check, result, quietPlies, key: positionKey(board, side), pending: null };
}

export function createXiangqi({ placement = initialPlacement, side = 'red', playedPlies = 0 } = {}) {
  const frames = [frame(parseBoard(placement), side, 0)];
  const moves = [];
  const current = () => frames.at(-1);

  function canClaimDraw(side) {
    const position = current();
    if (position.result || side !== position.side || position.quietPlies < 120) return false;
    const checks = moves.slice(-position.quietPlies).filter(move => move.side === side && move.check).length;
    return position.quietPlies - Math.max(0, checks - 10) >= 120;
  }

  function claimDraw(side) {
    if (!canClaimDraw(side)) return false;
    current().result = { winner: null, reason: 'no-capture' };
    return true;
  }

  function snapshot() {
    const { board, side, legal, check, result, pending } = current();
    const adjudication = !result && pending ? { side: pending.side, reason: pending.reason,
      remaining: pending.side ? pending.remaining : Math.ceil(pending.remaining / 2),
      ...(pending.requiresQuiet && !pending.quiet ? { requiresQuiet: true } : {}) } : null;
    return { board, side, legal: result ? [] : legal, check, result, moves: moves.slice(), adjudication,
      canClaimDraw: canClaimDraw(side) };
  }

  function play(move) {
    const before = current();
    if (before.result || !before.legal.some(legal => legal.from === move.from && legal.to === move.to)) return false;
    const captured = before.board[move.to];
    const next = frame(movedBoard(before.board, move), opposite(before.side), captured ? 0 : before.quietPlies + 1);
    moves.push({ from: move.from, to: move.to, side: before.side, captured, check: next.check });
    frames.push(next);
    try {
      if (!next.result) Object.assign(next, adjudicate(moves, frames, playedPlies));
    } catch (error) {
      moves.pop();
      frames.pop();
      throw error;
    }
    return true;
  }

  function undoTo(length) {
    if (!Number.isInteger(length) || length < 0 || length >= moves.length) return false;
    moves.length = length;
    frames.length = length + 1;
    return true;
  }

  return { snapshot, play, undoTo, claimDraw };
}
