import { cancelTurn, createMatchApi, GameError, runToolTurn } from './game-api.mjs';
import { createGameWorkspace } from './game-workspace.mjs';
import { moveRejectionReason } from './xiangqi-board.mjs';
import { createXiangqi } from './xiangqi-rules.mjs';

const point = { type: 'integer', minimum: 0, maximum: 89 };
const xiangqiTools = [
  {
    type: 'function', name: 'get_position',
    description: '查看当前象棋局面。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function', name: 'move_piece',
    description: '在当前象棋局面落子',
    inputSchema: {
      type: 'object', properties: { from: point, to: point }, required: ['from', 'to'], additionalProperties: false,
    },
  },
];

function advanceRevision(match, afterReply = false) {
  match.revision++;
  match.beforeReply = afterReply ? match.revision - 1 : null;
}

function snapshot(match) {
  const { board, side, legal, check, result, moves, adjudication, canClaimDraw } = match.game.snapshot();
  const aiTurn = Boolean(match.aiTurn);
  const humanTurn = !match.paused && !aiTurn && !result && side === match.humanSide;
  return {
    id: match.id, config: match.config, humanSide: match.humanSide,
    board, side, check, result: aiTurn ? null : result, adjudication, revision: match.revision,
    lastMove: moves.at(-1) ?? null, legal: humanTurn ? legal : [],
    canClaimDraw: humanTurn && canClaimDraw,
    canUndo: moves.some(move => move.side === match.humanSide),
    aiTurn, paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function callTurnTool(match, turn, name, args) {
  if (name === 'get_position') {
    const { board, legal, moves, check, adjudication } = match.game.snapshot();
    const last = moves.at(-1);
    return {
      board: board.map(piece => piece && (piece.side === 'red' ? piece.type.toUpperCase() : piece.type)),
      check, lastMove: last ? { from: last.from, to: last.to, side: last.side } : null,
      adjudication, moveCommitted: turn.moveCommitted, legal: turn.moveCommitted ? [] : legal,
    };
  }
  if (name !== 'move_piece') throw new GameError(400, '未知的中国象棋工具。');
  if (turn.moveCommitted) throw new GameError(409, '本回合已走棋。');
  const { from, to } = args ?? {};
  if (![from, to].every(value => Number.isInteger(value) && value >= point.minimum && value <= point.maximum)) {
    throw new GameError(400, '起点和终点必须是棋盘范围内的整数。');
  }
  const { board, side } = match.game.snapshot();
  if (side !== turn.side) throw new GameError(409, '当前未轮到 AI 走棋。');
  if (!match.game.play({ from, to })) throw new GameError(400, moveRejectionReason(board, side, { from, to }));
  turn.moveCommitted = true;
  advanceRevision(match, true);
  return '走棋成功。';
}

function recoveryMessage(turn) {
  return turn.moveCommitted ? '你本回合已经成功走棋。请确认当前局面，然后结束本回合。'
    : '请查看当前局面，然后走一着。';
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { side, moves, result } = match.game.snapshot();
  const existing = match.aiTurn;
  if (!existing && (result || side === match.humanSide)) return;
  const turn = existing ?? { side, moveCommitted: false };
  runToolTurn(match, turn, {
    opening: moves.length === 0,
    callTool: (name, args) => callTurnTool(match, turn, name, args),
    recoveryMessage: () => recoveryMessage(turn),
  });
}

function undo(match, moves) {
  const index = moves.findLastIndex(move => move.side === match.humanSide);
  if (index < 0) throw new GameError(409, '当前没有可撤回的着法。');
  cancelTurn(match);
  match.aiTurn = null;
  match.undoPending = true;
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
      if (match.aiTurn || state.result || state.side !== match.humanSide) {
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

export function createXiangqiApi(codex, directory) {
  const workspace = createGameWorkspace('xiangqi', directory, { includeTools: true });
  return createMatchApi('xiangqi', codex, {
    initialize: workspace.initialize,
    prepare(_, id, { humanSide }) {
      const first = humanSide === 'red' ? '对手（人类玩家）执红先走，你执黑后走。'
        : '你执红先走，对手（人类玩家）执黑后走。';
      const cwd = workspace.prepare(id, `# 先手\n\n${first}\n`);
      return { cwd, dynamicTools: xiangqiTools };
    },
    configure({ side, model, effort }) {
      if (!['red', 'black', 'random'].includes(side)) throw new GameError(400, '请选择执红、执黑或随机。');
      return { side, model, effort };
    },
    create({ side }) {
      const humanSide = side === 'random' ? (Math.random() < 0.5 ? 'red' : 'black') : side;
      return { game: createXiangqi(), humanSide, revision: 0, beforeReply: null, aiTurn: null, undoPending: false };
    },
    act, scheduleTurn, snapshot,
  });
}
