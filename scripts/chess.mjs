import { cancelTurn, createMatchApi, GameError, runTurn } from './game-api.mjs';
import { createChess } from './chess-rules.mjs';

function advanceRevision(match, afterReply = false) {
  match.revision++;
  match.beforeReply = afterReply ? match.revision - 1 : null;
}

function snapshot(match) {
  const { board, side, check, result, legal, moves } = match.game.snapshot();
  const humanTurn = !match.paused && !result && side === match.humanSide;
  return {
    id: match.id, config: match.config, humanSide: match.humanSide,
    board, side, check, result, legal: humanTurn ? legal : [], lastMove: moves.at(-1) ?? null,
    canUndo: moves.some(move => move.side === match.humanSide),
    revision: match.revision, paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { fen, side, result, legal, moves } = match.game.snapshot();
  if (result || side === match.humanSide) return;
  const position = {
    fen, aiSide: side,
    recentMoves: moves.slice(-8),
    legal: legal.map((move, id) => ({ ...move, id })),
  };
  const revision = match.revision;
  runTurn(match, position, reply => {
    if (revision !== match.revision) return;
    const move = Number.isInteger(reply?.move) ? legal[reply.move] : null;
    if (!move || !match.game.play(move)) {
      match.error = 'AI 返回了无效着法。';
      return;
    }
    advanceRevision(match, true);
  }, 'AI 走棋失败，请重试。');
}

function act(match, input) {
  const { action, revision } = input;
  const canFollowReply = action === 'pause' || action === 'undo';
  if (!Number.isInteger(revision) || (revision !== match.revision
    && !(canFollowReply && revision === match.beforeReply))) {
    throw new GameError(409, '棋局状态已更新，请刷新后再操作。');
  }
  if (action === 'pause' || action === 'resume') {
    const paused = action === 'pause';
    if (paused === match.paused) return;
    match.paused = paused;
    advanceRevision(match);
    if (paused) cancelTurn(match);
    else scheduleTurn(match);
    return;
  }
  if (match.paused) throw new GameError(409, '请先返回当前对局。');

  const { side, result, moves } = match.game.snapshot();
  switch (action) {
    case 'undo': {
      const index = moves.findLastIndex(move => move.side === match.humanSide);
      if (index < 0) throw new GameError(409, '当前没有可撤回的着法。');
      cancelTurn(match);
      match.game.undoTo(index);
      match.error = null;
      advanceRevision(match);
      break;
    }
    case 'retry':
      if (!match.error) throw new GameError(409, '当前没有失败的走棋请求。');
      scheduleTurn(match);
      break;
    case 'move':
      if (result || side !== match.humanSide) throw new GameError(409, '当前不能走棋。');
      if (!match.game.play(input)) throw new GameError(400, '请选择合法着法。');
      advanceRevision(match);
      scheduleTurn(match);
      break;
    default:
      throw new GameError(400, '未知的对局操作。');
  }
}

export function createChessApi(codex) {
  return createMatchApi('chess', codex, {
    configure({ side, model, effort }) {
      if (!['white', 'black', 'random'].includes(side)) throw new GameError(400, '请选择执白、执黑或随机。');
      return { side, model, effort };
    },
    create({ side }) {
      const humanSide = side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : side;
      return { game: createChess(), humanSide, revision: 0, beforeReply: null };
    },
    act, scheduleTurn, snapshot,
  });
}
