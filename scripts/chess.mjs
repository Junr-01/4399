import { cancelTurn, createMatchApi, GameError, runToolTurn } from './game-api.mjs';
import { createGameWorkspace } from './game-workspace.mjs';
import { createChess } from './chess-rules.mjs';

const squarePattern = /^[a-h][1-8]$/;
const square = { type: 'string', pattern: squarePattern.source };
const promotions = ['q', 'r', 'b', 'n'];
const moveFields = { from: square, to: square, promotion: { type: 'string', enum: promotions } };
const chessTools = [
  {
    type: 'function', name: 'get_position', description: '查看当前国际象棋局面。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function', name: 'move_piece', description: '在当前国际象棋局面落子',
    inputSchema: {
      type: 'object', properties: moveFields,
      required: ['from', 'to'], additionalProperties: false,
    },
  },
];

function advanceRevision(match, afterReply = false) {
  match.revision++;
  match.beforeReply = afterReply ? match.revision - 1 : null;
}

function snapshot(match) {
  const { board, side, check, result, legal, moves } = match.game.snapshot();
  const aiTurn = Boolean(match.aiTurn);
  const humanTurn = !match.paused && !aiTurn && !result && side === match.humanSide;
  return {
    id: match.id, config: match.config, humanSide: match.humanSide,
    board, side, check, result: aiTurn ? null : result, legal: humanTurn ? legal : [], lastMove: moves.at(-1) ?? null,
    canUndo: moves.some(move => move.side === match.humanSide),
    revision: match.revision, aiTurn, paused: match.paused, thinking: Boolean(match.turn), error: match.error,
  };
}

function rejectionReason({ board, side, check, legal }, { from, to, promotion }) {
  const file = 'abcdefgh'.indexOf(from[0]);
  const rank = Number(from[1]);
  const origin = board[(8 - rank) * 8 + file];
  if (!origin || (origin === origin.toUpperCase()) !== (side === 'white')) return '起点必须有己方棋子。';
  const candidate = legal.find(move => move.from === from && move.to === to);
  if (candidate) return promotion === undefined ? '兵升变时必须指定升变棋子。' : '这步无需升变。';
  return check ? '当前被将军，请选择能解将的合法着法。' : '请选择合法着法。';
}

function callTurnTool(match, turn, name, args = {}) {
  if (name === 'get_position') {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) {
      throw new GameError(400, '查看局面无需参数。');
    }
    const { fen, check, moves, legal } = match.game.snapshot();
    return {
      fen, check, lastMove: moves.at(-1) ?? null, moveCommitted: turn.moveCommitted,
      legal: turn.moveCommitted ? [] : legal,
    };
  }
  if (name !== 'move_piece') throw new GameError(400, '未知的国际象棋工具。');
  if (turn.moveCommitted) throw new GameError(409, '本回合已走棋。');
  if (Object.keys(args ?? {}).some(key => !Object.hasOwn(moveFields, key))) {
    throw new GameError(400, '走棋只接受起点、终点和升变棋子。');
  }
  const { from, to, promotion } = args ?? {};
  if (![from, to].every(value => typeof value === 'string' && squarePattern.test(value))) {
    throw new GameError(400, '起点和终点必须使用 a1 到 h8 的棋盘坐标。');
  }
  if (promotion !== undefined && !promotions.includes(promotion)) {
    throw new GameError(400, '升变棋子必须是 q、r、b 或 n。');
  }
  const state = match.game.snapshot();
  if (state.side !== turn.side) throw new GameError(409, '当前未轮到 AI 走棋。');
  const move = { from, to, promotion };
  if (!match.game.play(move)) throw new GameError(400, rejectionReason(state, move));
  turn.moveCommitted = true;
  advanceRevision(match, true);
  return '走棋成功。';
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { side, result, moves } = match.game.snapshot();
  if (!match.aiTurn && (result || side === match.humanSide)) return;
  const turn = match.aiTurn ?? { side, moveCommitted: false };
  runToolTurn(match, turn, {
    opening: moves.length === 0,
    callTool: (name, args) => callTurnTool(match, turn, name, args),
    recoveryMessage: () => turn.moveCommitted ? '你本回合已经成功走棋。请确认当前局面，然后结束本回合。'
      : '请查看当前局面，然后走一着。',
  });
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
      match.aiTurn = null;
      match.undoPending = true;
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
      if (match.aiTurn || result || side !== match.humanSide) throw new GameError(409, '当前不能走棋。');
      if (!match.game.play(input)) throw new GameError(400, '请选择合法着法。');
      advanceRevision(match);
      scheduleTurn(match);
      break;
    default:
      throw new GameError(400, '未知的对局操作。');
  }
}

export function createChessApi(codex, directory) {
  const workspace = createGameWorkspace('chess', directory, { includeTools: true });
  return createMatchApi('chess', codex, {
    initialize: workspace.initialize,
    prepare(_, id, { humanSide }) {
      const first = humanSide === 'white' ? '对手（人类玩家）执白先走，你执黑后走。'
        : '你执白先走，对手（人类玩家）执黑后走。';
      return { cwd: workspace.prepare(id, `# 先手\n\n${first}\n`), dynamicTools: chessTools };
    },
    configure({ side, model, effort }) {
      if (!['white', 'black', 'random'].includes(side)) throw new GameError(400, '请选择执白、执黑或随机。');
      return { side, model, effort };
    },
    create({ side }) {
      const humanSide = side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : side;
      return { game: createChess(), humanSide, revision: 0, beforeReply: null, aiTurn: null, undoPending: false };
    },
    act, scheduleTurn, snapshot,
  });
}
