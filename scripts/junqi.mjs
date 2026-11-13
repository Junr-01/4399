import { randomInt } from 'node:crypto';
import { cancelTurn, createMatchApi, GameError, runTurn } from './game-api.mjs';
import { createJunqi } from './junqi-rules.mjs';

function advanceRevision(match, afterReply = false) {
  match.beforeReply = afterReply ? match.revision : null;
  match.revision++;
}

function snapshot(match) {
  const { board, turn, sides, flips, mines, quiet, last, moves, legal, result, canUndo } = match.game.snapshot();
  return {
    id: match.id, config: match.config, board, turn, sides, flips, mines, quiet, last, ply: moves.length, result,
    legal: !match.paused && turn === 'human' ? legal : [],
    canUndo: !match.paused && canUndo,
    revision: match.revision, paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { board, turn, sides, flips, mines, quiet, moves, legal, result } = match.game.snapshot();
  if (result || turn !== 'ai') return;
  const position = {
    board, aiSide: sides?.ai ?? null, sides, flips, mines, quiet,
    recentMoves: moves.slice(-8),
    legal: legal.map((action, id) => ({ ...action, id })),
  };
  const revision = match.revision;
  runTurn(match, position, reply => {
    if (revision !== match.revision) return;
    const action = Number.isInteger(reply?.move) ? legal[reply.move] : null;
    if (!action || !match.game.play(action)) {
      match.error = 'AI 返回了无效行动，请重试。';
      return;
    }
    advanceRevision(match, true);
  }, 'AI 行动失败，请重试。');
}

function act(match, input) {
  const { action, revision } = input;
  const canFollowReply = action === 'pause' || action === 'undo';
  const conflict = message => new GameError(409, message, snapshot(match));
  if (!Number.isInteger(revision) || (revision !== match.revision
    && !(canFollowReply && revision === match.beforeReply))) {
    throw conflict('棋局状态已更新，请重新操作。');
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
  if (match.paused) throw conflict('请先返回当前对局。');

  switch (action) {
    case 'undo':
      if (!match.game.undo()) throw conflict('当前没有可撤回的走棋。');
      cancelTurn(match);
      match.error = null;
      advanceRevision(match);
      break;
    case 'retry':
      if (!match.error) throw conflict('当前没有失败的 AI 请求。');
      scheduleTurn(match);
      break;
    case 'flip':
    case 'move': {
      const { turn, result } = match.game.snapshot();
      if (result || turn !== 'human') throw conflict('当前不能行动。');
      if (!match.game.play(input)) throw new GameError(400, '请选择合法行动。');
      advanceRevision(match);
      scheduleTurn(match);
      break;
    }
    default:
      throw new GameError(400, '未知的对局操作。');
  }
}

export function createJunqiApi(codex, random = () => randomInt(2 ** 32) / (2 ** 32)) {
  return createMatchApi('junqi', codex, {
    reserveId: true,
    configure({ first, model, effort }) {
      if (!['human', 'ai', 'random'].includes(first)) throw new GameError(400, '请选择先翻棋的一方。');
      return { first, model, effort };
    },
    create({ first }) {
      const turn = first === 'random' ? (random() < 0.5 ? 'human' : 'ai') : first;
      return { game: createJunqi({ first: turn, random }), revision: 0, beforeReply: null };
    },
    act, scheduleTurn, snapshot,
  });
}
