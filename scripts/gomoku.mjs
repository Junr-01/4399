import { cancelTurn, createMatchApi, GameError, runTurn } from './game-api.mjs';

const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];

function nextColor(match) {
  return match.moves.length % 2 === 0 ? 'black' : 'white';
}

function playable(match, row, col) {
  const inBounds = value => Number.isInteger(value) && value >= 0 && value < match.config.size;
  return inBounds(row) && inBounds(col) && match.board[row][col] === null;
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
    moves: match.moves, result: match.result, winning: match.winning,
    paused: match.paused, thinking: Boolean(match.turn), error: match.error,
    canUndo: match.moves.some(move => move.color === match.humanColor),
  };
}

function scheduleTurn(match) {
  if (match.paused || match.result || match.turn || nextColor(match) === match.humanColor) return;
  const position = { size: match.config.size, aiColor: nextColor(match), moves: [...match.moves] };
  runTurn(match, position, move => {
    if (!playable(match, move?.row, move?.col)) match.error = 'AI 返回了无效落点。';
    else place(match, move.row, move.col);
  }, 'AI 落子失败，请重试。');
}

function undo(match) {
  const last = match.moves.findLastIndex(move => move.color === match.humanColor);
  if (last < 0) throw new GameError(409, '当前没有可撤回的落子。');
  cancelTurn(match);
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
        if (match.result || nextColor(match) !== match.humanColor) {
          throw new GameError(409, '当前不能落子。');
        }
        if (!playable(match, input.row, input.col)) throw new GameError(400, '请选择空交叉点。');
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


export function createGomokuApi(codex) {
  return createMatchApi('gomoku', codex, {
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
        moves: [], winning: [], result: null,
      };
    },
    act, scheduleTurn, snapshot,
  });
}
