// chess.js 1.4.0, BSD-2-Clause. The vendored runtime keeps plugin launch self-contained.
import { Chess } from './vendor/chess.js/chess.mjs';
import { isLockedPawnPosition } from './chess-dead-position.mjs';

const colors = { w: 'white', b: 'black' };
const otherColor = side => side === 'white' ? 'black' : 'white';

function coordinates({ from, to, promotion }) {
  return promotion ? { from, to, promotion } : { from, to };
}

// chess.js omits the en passant target from FEN unless the capture is legal.
const positionKey = fen => fen.split(' ').slice(0, 4).join(' ');

export function createChess(fen) {
  const chess = new Chess(fen);
  const moves = [];
  const positions = new Map([[positionKey(chess.fen()), 1]]);

  function outcome(side, check, hasMoves, fen, board) {
    if (!hasMoves) return check
      ? { winner: otherColor(side), reason: 'checkmate' }
      : { winner: null, reason: 'stalemate' };
    if (chess.isInsufficientMaterial() || (!check && isLockedPawnPosition(board, fen.split(' ')[3]))) {
      return { winner: null, reason: 'dead-position' };
    }
    if (positions.get(positionKey(fen)) >= 3) return { winner: null, reason: 'repetition' };
    if (chess.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty-move' };
    return null;
  }

  function snapshot() {
    const side = colors[chess.turn()];
    const check = chess.isCheck();
    const legal = chess.moves({ verbose: true }).map(coordinates);
    const fen = chess.fen();
    const board = chess.board().flat();
    const result = outcome(side, check, legal.length > 0, fen, board);
    return {
      board: board.map(piece => !piece ? null : piece.color === 'w' ? piece.type.toUpperCase() : piece.type),
      side, check, fen, legal: result ? [] : legal, result, moves: moves.slice(),
    };
  }

  function play(input) {
    const { legal, result } = snapshot();
    const move = legal.find(entry => entry.from === input.from && entry.to === input.to && entry.promotion === input.promotion);
    if (result || !move) return false;
    const played = chess.move(move);
    moves.push({ ...move, side: colors[played.color], san: played.san });
    const key = positionKey(played.after);
    positions.set(key, (positions.get(key) ?? 0) + 1);
    return true;
  }

  function undoTo(index) {
    if (!Number.isInteger(index) || index < 0 || index > moves.length) {
      throw new RangeError('Invalid chess history index');
    }
    while (moves.length > index) {
      const key = positionKey(chess.fen());
      const count = positions.get(key);
      if (count === 1) positions.delete(key);
      else positions.set(key, count - 1);
      chess.undo();
      moves.pop();
    }
  }

  return { snapshot, play, undoTo };
}
