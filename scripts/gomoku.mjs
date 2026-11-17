import { cancelTurn, createMatchApi, GameError, runTurnTask } from './game-api.mjs';
import { createGomokuWorkspace } from './gomoku-workspace.mjs';

const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
const maxAttempts = 4;
const gomokuTools = [
  {
    type: 'function', name: 'get_position',
    description: '每回合先查看当前五子棋棋盘。board 按行排列，black 与 white 表示棋子，null 表示空点。以本次返回为准。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function', name: 'place_stone',
    description: '在空交叉点落一子。row 和 col 从左上角 0 开始。失败时按原因改选，成功后结束本回合。',
    inputSchema: {
      type: 'object', properties: { row: { type: 'integer' }, col: { type: 'integer' } },
      required: ['row', 'col'], additionalProperties: false,
    },
  },
];

function nextColor(match) {
  return match.moves.length % 2 === 0 ? 'black' : 'white';
}

function moveError(match, row, col) {
  const inBounds = value => Number.isInteger(value) && value >= 0 && value < match.config.size;
  if (!inBounds(row) || !inBounds(col)) return '行列必须是棋盘范围内的整数。';
  if (match.board[row][col] !== null) return '该交叉点已有棋子。';
}

function place(match, row, col) {
  const color = nextColor(match);
  match.moves.push({ row, col, color });
  match.board[row][col] = color;
  for (const [dr, dc] of directions) {
    const line = [{ row, col }];
    for (const sign of [-1, 1]) {
      let r = row + sign * dr;
      let c = col + sign * dc;
      while (match.board[r]?.[c] === color) {
        line.push({ row: r, col: c });
        r += sign * dr;
        c += sign * dc;
      }
    }
    if (line.length >= 5) {
      match.winning = line;
      match.result = color;
      return;
    }
  }
  if (match.moves.length === match.config.size ** 2) match.result = 'draw';
}

function snapshot(match) {
  return {
    id: match.id, config: match.config, humanColor: match.humanColor,
    moves: match.moves, result: match.aiTurn ? null : match.result,
    winning: match.aiTurn ? [] : match.winning,
    paused: match.paused, thinking: Boolean(match.turn), error: match.error,
    canUndo: match.moves.some(move => move.color === match.humanColor),
  };
}

function callTurnTool(match, turn, name, args) {
  if (name === 'get_position') return {
    size: match.config.size,
    board: match.board.map(row => [...row]),
    aiColor: turn.color,
    lastMove: match.moves.at(-1) ?? null,
  };
  if (name !== 'place_stone') throw new GameError(400, '未知的五子棋工具。');
  if (turn.placed) throw new GameError(409, '本回合已落子。');
  const error = moveError(match, args?.row, args?.col);
  if (error) throw new GameError(400, error);
  place(match, args.row, args.col);
  turn.placed = true;
  return '落子成功。请结束本回合。';
}

async function playAiTurn(match, turn, message, signal) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal.throwIfAborted();
    let active = true;
    try {
      await match.opponent.move({
        text: message,
        callTool(name, args) {
          if (!active || signal.aborted) throw new GameError(409, '本次 AI 请求已失效。');
          return callTurnTool(match, turn, name, args);
        },
      }, signal);
      signal.throwIfAborted();
      if (!turn.placed) throw new Error('AI 回合结束时尚未落子。');
      match.aiTurn = null;
      return;
    } catch (error) {
      if (signal.aborted || attempt === maxAttempts - 1) throw error;
    } finally {
      active = false;
    }
    message = recoveryMessage(turn);
  }
}

function recoveryMessage(turn) {
  return turn.placed ? '你本回合已经成功落子。请确认当前局面，然后结束本回合。'
    : '请查看当前局面，然后落子。';
}

function scheduleTurn(match) {
  if (match.paused || match.turn) return;
  const existing = match.aiTurn;
  if (!existing && (match.result || nextColor(match) === match.humanColor)) return;
  const turn = existing ?? { color: nextColor(match), placed: false };
  const message = existing ? recoveryMessage(turn) : match.undoPending ? '我悔棋了，已经重新落子'
    : match.moves.length ? '我已落子' : '棋局开始';
  match.aiTurn = turn;
  match.undoPending = false;
  runTurnTask(match, signal => playAiTurn(match, turn, message, signal), 'AI 回合未能完成，请重试。');
}

function undo(match) {
  const last = match.moves.findLastIndex(move => move.color === match.humanColor);
  if (last < 0) throw new GameError(409, '当前没有可撤回的落子。');
  cancelTurn(match);
  match.aiTurn = null;
  match.undoPending = true;
  for (const move of match.moves.splice(last)) match.board[move.row][move.col] = null;
  match.result = null;
  match.winning = [];
  match.error = null;
}

function act(match, input) {
  if (input.action === 'pause') {
    match.paused = true;
    cancelTurn(match);
  } else if (input.action === 'resume') {
    match.paused = false;
    scheduleTurn(match);
  } else {
    if (match.paused) throw new GameError(409, '请先返回当前对局。');
    switch (input.action) {
      case 'move':
        if (match.turn || match.aiTurn || match.result || nextColor(match) !== match.humanColor) {
          throw new GameError(409, '当前不能落子。');
        }
        if (moveError(match, input.row, input.col)) throw new GameError(400, '请选择空交叉点。');
        place(match, input.row, input.col);
        scheduleTurn(match);
        break;
      case 'undo':
        undo(match);
        break;
      case 'retry':
        if (!match.error) throw new GameError(409, '当前没有失败的落子请求。');
        scheduleTurn(match);
        break;
      default:
        throw new GameError(400, '未知的对局操作。');
    }
  }
}


export function createGomokuApi(codex, directory) {
  const workspace = createGomokuWorkspace(directory);
  return createMatchApi('gomoku', codex, {
    initialize: workspace.initialize,
    prepare(config, id, state) {
      return { cwd: workspace.prepare(config, id, state), dynamicTools: gomokuTools };
    },
    configure({ size, model, effort, first }) {
      if (![9, 13, 15].includes(size) || !['you', 'ai', 'random'].includes(first)) {
        throw new GameError(400, '棋盘尺寸或先手无效。');
      }
      return { size, model, effort, first };
    },
    create({ size, first }) {
      const humanFirst = first === 'you' || (first === 'random' && Math.random() < 0.5);
      return {
        humanColor: humanFirst ? 'black' : 'white',
        board: Array.from({ length: size }, () => Array(size).fill(null)),
        moves: [], winning: [], result: null, aiTurn: null, undoPending: false,
      };
    },
    act, scheduleTurn, snapshot,
  });
}
