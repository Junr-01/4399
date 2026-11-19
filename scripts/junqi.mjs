import { randomInt } from 'node:crypto';
import { cancelTurn, createMatchApi, GameError, runToolTurn } from './game-api.mjs';
import { createGameWorkspace } from './game-workspace.mjs';
import { createJunqi } from './junqi-rules.mjs';
import { points } from '../app/junqi-board.mjs';

const lastPoint = points.length - 1;
const point = { type: 'integer', minimum: 0, maximum: lastPoint };
const actionFields = { action: { type: 'string', enum: ['flip', 'move'] }, from: point, to: point };
const junqiTools = [
  {
    type: 'function', name: 'get_position', description: '查看当前军棋公开局面。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function', name: 'play_action', description: '在当前军棋局面翻棋或走棋。',
    inputSchema: {
      type: 'object', properties: actionFields,
      required: ['action', 'to'], additionalProperties: false,
    },
  },
];

function advanceRevision(match, afterReply = false) {
  match.beforeReply = afterReply ? match.revision : null;
  match.revision++;
}

function snapshot(match) {
  const { board, turn, sides, flips, mines, quiet, last, moves, legal, result, canUndo } = match.game.snapshot();
  const aiTurn = Boolean(match.aiTurn);
  return {
    id: match.id, config: match.config, board, turn: aiTurn ? 'ai' : turn,
    sides, flips, mines, quiet, last, ply: moves.length, result: aiTurn ? null : result,
    legal: !match.paused && !aiTurn && turn === 'human' ? legal : [],
    canUndo: !match.paused && canUndo,
    revision: match.revision, paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function validPoint(value) {
  return Number.isInteger(value) && value >= 0 && value <= lastPoint;
}

function callTurnTool(match, turn, name, args = {}) {
  const isObject = args && typeof args === 'object' && !Array.isArray(args);
  if (name === 'get_position') {
    if (!isObject || Object.keys(args).length) throw new GameError(400, '查看局面无需参数。');
    const { board, sides, flips, mines, quiet, last, legal } = match.game.snapshot();
    return { board, sides, flips, mines, quiet, last, moveCommitted: turn.moveCommitted, legal: turn.moveCommitted ? [] : legal };
  }
  if (name !== 'play_action') throw new GameError(400, '未知的军棋工具。');
  if (turn.moveCommitted) throw new GameError(409, '本回合已行动。');
  if (!isObject || Object.keys(args).some(key => !Object.hasOwn(actionFields, key))) {
    throw new GameError(400, '请提供行动类型和点位。');
  }
  const { action, from, to } = args;
  if (action !== 'flip' && action !== 'move') throw new GameError(400, '行动必须是 flip（翻棋）或 move（走棋）。');
  if (action === 'flip' && Object.hasOwn(args, 'from')) throw new GameError(400, '翻棋只需提供目标点位。');
  if (!validPoint(to) || (action === 'move' && !validPoint(from))) {
    throw new GameError(400, `点位必须是 0 到 ${lastPoint} 的整数。`);
  }
  const state = match.game.snapshot();
  if (state.turn !== 'ai' || state.result) throw new GameError(409, '当前不能由 AI 行动。');
  if (action === 'move' && !state.sides) throw new GameError(400, '阵营未确定时只能翻棋。');
  if (!match.game.play({ action, from, to })) {
    throw new GameError(400, action === 'flip' ? '指定点位必须有未翻开的暗子。' : '请选择合法走法。');
  }
  turn.moveCommitted = true;
  advanceRevision(match, true);
  return '行动成功。';
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { turn, moves, result } = match.game.snapshot();
  if (!match.aiTurn && (result || turn !== 'ai')) return;
  const aiTurn = match.aiTurn ?? { moveCommitted: false };
  runToolTurn(match, aiTurn, {
    opening: moves.length === 0,
    callTool: (name, args) => callTurnTool(match, aiTurn, name, args),
    recoveryMessage: () => aiTurn.moveCommitted ? '你本回合已经成功行动。请确认当前局面，然后结束本回合。'
      : '请查看当前局面，然后翻棋或走棋。',
  });
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
      match.aiTurn = null;
      match.undoPending = true;
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
      if (match.aiTurn || result || turn !== 'human') throw conflict('当前不能行动。');
      if (!match.game.play(input)) throw new GameError(400, '请选择合法行动。');
      advanceRevision(match);
      scheduleTurn(match);
      break;
    }
    default:
      throw new GameError(400, '未知的对局操作。');
  }
}

export function createJunqiApi(codex, directory, random = () => randomInt(2 ** 32) / (2 ** 32)) {
  const workspace = createGameWorkspace('junqi', directory, { includeTools: true });
  return createMatchApi('junqi', codex, {
    reserveId: true,
    initialize: workspace.initialize,
    prepare(_, id, { firstPlayer }) {
      const first = firstPlayer === 'ai' ? '你先翻棋。' : '对手（人类玩家）先翻棋。';
      return { cwd: workspace.prepare(id, `# 先手\n\n${first}\n`), dynamicTools: junqiTools };
    },
    configure({ first, model, effort }) {
      if (!['human', 'ai', 'random'].includes(first)) throw new GameError(400, '请选择先翻棋的一方。');
      return { first, model, effort };
    },
    create({ first }) {
      const firstPlayer = first === 'random' ? (random() < 0.5 ? 'human' : 'ai') : first;
      return {
        firstPlayer, game: createJunqi({ first: firstPlayer, random }),
        revision: 0, beforeReply: null, aiTurn: null, undoPending: false,
      };
    },
    act, scheduleTurn, snapshot,
  });
}
