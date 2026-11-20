import { join } from 'node:path';
import { camps, opposite, points, seatColors, seatsFor } from '../shared/chinese-checkers-board.mjs';
import { createMatchApi, GameError, recordAiMove, runToolTurn } from './game-api.mjs';
import { createGameWorkspace } from './game-workspace.mjs';
import { createChineseCheckers } from './chinese-checkers-rules.mjs';

const name = 'chinese-checkers';
const hole = { type: 'integer', minimum: 0, maximum: points.length - 1 };
const tools = [
  {
    type: 'function', name: 'get_position', description: '查看当前中国跳棋局面。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function', name: 'move_piece', description: '在当前中国跳棋局面走棋。',
    inputSchema: {
      type: 'object', properties: { from: hole, to: hole },
      required: ['from', 'to'], additionalProperties: false,
    },
  },
];

const rows = points.filter((point, index) => point.r !== points[index - 1]?.r);
const validHole = id => Number.isInteger(id) && id >= 0 && id < points.length;
const player = (seat, index) => (index === 0 ? '真人' : 'AI ' + index) + '（' + seatColors[seat] + '方）';

function snapshot(match) {
  const state = match.game.snapshot();
  const humanTurn = !match.paused && !match.aiTurn && state.side === 0 && !state.result;
  return {
    ...state,
    side: match.aiTurn?.side ?? state.side,
    result: match.aiTurn ? null : state.result,
    legal: humanTurn ? state.legal : [],
    aiTurn: Boolean(match.aiTurn),
  };
}

function toolBoard(board) {
  return rows.map(({ id, q, r }, index) => ({
    id, q, r, cells: board.slice(id, rows[index + 1]?.id).map(seat => seat ?? '.').join(''),
  }));
}

function playMove(game, { from, to }) {
  if (!validHole(from) || !validHole(to)) throw new GameError(400, '起点和终点必须是 0 到 120 的点号。');
  if (!game.play({ from, to })) throw new GameError(400, '请选择当前行棋方的合法走法。');
}

function callTurnTool(match, turn, tool, args) {
  if (tool === 'get_position') {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) {
      throw new GameError(400, '查看局面无需参数。');
    }
    const { board, side, lastMove, legal } = match.game.snapshot();
    return {
      board: toolBoard(board), side, lastMove, moveCommitted: turn.moveCommitted,
      legal: turn.moveCommitted ? [] : legal,
    };
  }
  if (tool !== 'move_piece') throw new GameError(400, '未知的中国跳棋工具。');
  if (turn.moveCommitted) throw new GameError(409, '本回合已走棋。');
  if (!args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => key !== 'from' && key !== 'to')) {
    throw new GameError(400, '走棋只接受起点和终点。');
  }
  if (match.game.snapshot().side !== turn.side) throw new GameError(409, '当前未轮到你的席位走棋。');
  playMove(match.game, args);
  recordAiMove(match, turn);
  return '走棋成功。';
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const { side, result } = match.game.snapshot();
  if (!match.aiTurn && (result || side === 0)) return;
  const turn = match.aiTurn ?? { side, moveCommitted: false };
  runToolTurn(match, turn, {
    opponent: match.opponent.seats.get(turn.side),
    turnMessage: '轮到你走棋',
    callTool: (tool, args) => callTurnTool(match, turn, tool, args),
    recoveryMessage: () => turn.moveCommitted ? '你本回合已经成功走棋。请确认当前局面，然后结束本回合。'
      : '请查看当前局面，然后走一着。',
    onComplete: scheduleTurn,
  });
}

function play(match, input) {
  if (input.action !== 'move') throw new GameError(400, '未知的对局操作。');
  const { side, result } = match.game.snapshot();
  if (match.aiTurn || result || side !== 0) throw new GameError(409, '当前不能走棋。');
  playMove(match.game, input);
}

function undo(match) {
  if (!match.game.undo()) throw new GameError(409, '当前没有可撤回的着法。');
}

export function createChineseCheckersApi(codex, directory) {
  const workspace = createGameWorkspace(name, directory, { includeTools: true });
  return createMatchApi(name, codex, {
    reserveId: true,
    initialize: workspace.initialize,
    prepare(_, id, { seats }) {
      const roster = seats.map((seat, index) => '- 席位 ' + seat + ' ' + player(seat, index)).join('\n');
      workspace.prepare(id, '# 本局顺序\n\n真人从席位 0 先走，按以下顺序轮转。\n\n' + roster + '\n');
      return seats.slice(1).map((seat, index) => {
        const instructions = '# 我的席位\n\n你是 ' + player(seat, index + 1) + '，席位号为 ' + seat + '。\n\n'
          + '你的起始营地孔位为 ' + camps[seat].join('、') + '，目标营地孔位为 '
          + camps[opposite(seat)].join('、') + '。\n';
        const cwd = workspace.prepare(join(id, 'seat-' + seat), instructions);
        return [seat, { cwd, dynamicTools: tools }];
      });
    },
    openOpponent(config, options) {
      const seats = new Map(options.map(([seat, setting]) => [seat, codex.openMatch(config, name, setting)]));
      return {
        seats,
        dispose() {
          for (const opponent of seats.values()) opponent.dispose();
        },
      };
    },
    configure({ playerCount, model, effort }) {
      if (!Number.isInteger(playerCount) || !seatsFor(playerCount)) throw new GameError(400, '请选择 2 到 6 人。');
      return { playerCount, model, effort };
    },
    create({ playerCount }) {
      const seats = seatsFor(playerCount);
      return { seats, game: createChineseCheckers(seats) };
    },
    play, undo, scheduleTurn, snapshot,
  });
}
