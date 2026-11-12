import { cancelTurn, createMatchApi, GameError, runTurn } from './game-api.mjs';
import { createXiangqi } from './xiangqi-rules.mjs';

function advanceRevision(match, afterReply = false) {
  match.revision++;
  match.beforeReply = afterReply ? match.revision - 1 : null;
}

function snapshot(match) {
  const { board, side, legal, check, result, moves, adjudication, canClaimDraw } = match.game.snapshot();
  const humanTurn = !match.paused && !result && side === match.humanSide;
  return {
    id: match.id, config: match.config, humanSide: match.humanSide,
    board, side, check, result, adjudication, revision: match.revision,
    lastMove: moves.at(-1) ?? null, legal: humanTurn ? legal : [],
    canClaimDraw: humanTurn && canClaimDraw,
    canUndo: moves.some(move => move.side === match.humanSide),
    paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function scheduleTurn(match) {
  const { board, side, legal, moves, result, adjudication } = match.game.snapshot();
  if (match.paused || result || match.turn || side === match.humanSide) return;
  const position = {
    aiSide: side,
    board: board.map(piece => piece && (piece.side === 'red' ? piece.type.toUpperCase() : piece.type)),
    recentMoves: moves.slice(-8).map(({ from, to, side }) => ({ from, to, side })),
    adjudication,
    legal: legal.map((move, id) => ({ ...move, id })),
  };
  const revision = match.revision;
  runTurn(match, position, reply => {
    const move = Number.isInteger(reply?.move) ? legal[reply.move] : null;
    if (revision !== match.revision) return;
    if (!move || !match.game.play(move)) {
      match.error = 'AI 返回了无效着法。';
      return;
    }
    advanceRevision(match, true);
  }, 'AI 走棋失败，请重试。');
}

function undo(match, moves) {
  const index = moves.findLastIndex(move => move.side === match.humanSide);
  if (index < 0) throw new GameError(409, '当前没有可撤回的着法。');
  cancelTurn(match);
  match.game.undoTo(index);
  match.error = null;
  advanceRevision(match);
}

function act(match, input) {
  // Pause and undo may arrive just after the AI answers the position shown.
  const acceptsReply = input.action === 'pause' || input.action === 'undo';
  if (!Number.isInteger(input.revision) || (input.revision !== match.revision
    && !(acceptsReply && input.revision === match.beforeReply))) {
    throw new GameError(409, '棋局状态已更新，请刷新后再操作。');
  }
  if (input.action === 'pause') {
    if (match.paused) return;
    match.paused = true;
    cancelTurn(match);
    advanceRevision(match);
    return;
  }
  if (input.action === 'resume') {
    if (!match.paused) return;
    match.paused = false;
    advanceRevision(match);
    scheduleTurn(match);
    return;
  }
  if (match.paused) throw new GameError(409, '请先返回当前对局。');

  const state = match.game.snapshot();
  switch (input.action) {
    case 'undo':
      undo(match, state.moves);
      break;
    case 'retry':
      if (!match.error) throw new GameError(409, '当前没有失败的走棋请求。');
      scheduleTurn(match);
      break;
    case 'move':
    case 'claim-draw':
      if (state.result || state.side !== match.humanSide) {
        throw new GameError(409, '当前不能走棋或申请和棋。');
      }
      if (input.action === 'claim-draw') {
        if (!match.game.claimDraw(match.humanSide)) throw new GameError(409, '当前未达到自然限着条件。');
      } else if (!match.game.play(input)) {
        throw new GameError(400, '请选择合法着法。');
      }
      advanceRevision(match);
      scheduleTurn(match);
      break;
    default:
      throw new GameError(400, '未知的对局操作。');
  }
}

export function createXiangqiApi(codex) {
  return createMatchApi('xiangqi', codex, {
    configure({ side, model, effort }) {
      if (!['red', 'black', 'random'].includes(side)) throw new GameError(400, '请选择执红、执黑或随机。');
      return { side, model, effort };
    },
    create({ side }) {
      const humanSide = side === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : side;
      return { game: createXiangqi(), humanSide, revision: 0, beforeReply: null };
    },
    act, scheduleTurn, snapshot,
  });
}
