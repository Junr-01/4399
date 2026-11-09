import { randomUUID } from 'node:crypto';

const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
const expiry = 60 * 60 * 1000;

class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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

function cancelTurn(match) {
  const current = match.turn;
  match.turn = null;
  current?.abort();
}

function scheduleTurn(match) {
  if (match.paused || match.result || match.turn || nextColor(match) === match.humanColor) return;
  const turn = new AbortController();
  match.turn = turn;
  match.error = null;
  const position = { size: match.config.size, aiColor: nextColor(match), moves: [...match.moves] };
  match.task = match.task.then(async () => {
    if (turn.signal.aborted) return;
    try {
      const move = await match.opponent.move(position, turn.signal);
      if (match.turn !== turn) return;
      if (!playable(match, move?.row, move?.col)) {
        match.error = 'AI 返回了无效落点。';
        return;
      }
      place(match, move.row, move.col);
    } catch {
      if (match.turn === turn) match.error = 'AI 落子失败，请重试。';
    } finally {
      if (match.turn === turn) match.turn = null;
    }
  });
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

async function readInput(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new GameError(415, '需要 JSON 请求。');
  }
  let data = '';
  request.setEncoding('utf8');
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    data += chunk;
    if (data.length > 4096) throw new GameError(413, '请求过大。');
  }
  try {
    const input = JSON.parse(data);
    if (input && typeof input === 'object' && !Array.isArray(input)) return input;
  } catch { /* Return a single validation error for malformed JSON. */ }
  throw new GameError(400, '无效请求。');
}

export function createGomokuApi(codex) {
  const matches = new Map();

  function remove(id) {
    const match = matches.get(id);
    if (!match) return;
    cancelTurn(match);
    match.opponent.dispose();
    matches.delete(id);
  }

  function getMatch(id) {
    const match = matches.get(id);
    if (!match || Date.now() - match.lastSeen > expiry) {
      remove(id);
      throw new GameError(404, '本局已结束，请重新开始。');
    }
    match.lastSeen = Date.now();
    return match;
  }

  async function catalog() {
    try { return await codex.catalog(); }
    catch (error) { throw new GameError(503, error.userMessage ?? '无法读取 Codex 模型。请检查本机 Codex 的登录及连接，再重试。'); }
  }

  async function start({ size, model, effort, first, replace }) {
    if (![9, 13, 15].includes(size) || !['you', 'ai', 'random'].includes(first)) {
      throw new GameError(400, '棋盘尺寸或先手无效。');
    }
    const available = (await catalog()).find(entry => entry.id === model);
    if (!available?.efforts.includes(effort)) throw new GameError(400, '请重新选择可用的模型和思考强度。');
    for (const [id, match] of matches) if (Date.now() - match.lastSeen > expiry) remove(id);
    if (replace !== undefined) {
      const old = getMatch(replace);
      if (!old.paused) throw new GameError(409, '请先暂停当前对局。');
      remove(replace);
    }
    if (matches.size >= 32) throw new GameError(409, '对局数量过多，请关闭闲置对局后再试。');
    const config = { size, model, modelName: available.name, effort, first };
    const humanFirst = first === 'you' || (first === 'random' && Math.random() < 0.5);
    const match = {
      id: randomUUID(), config, lastSeen: Date.now(),
      humanColor: humanFirst ? 'black' : 'white',
      board: Array.from({ length: size }, () => Array(size).fill(null)),
      moves: [], winning: [], result: null, paused: false,
      turn: null, error: null, task: Promise.resolve(), opponent: codex.openMatch(config),
    };
    matches.set(match.id, match);
    scheduleTurn(match);
    return snapshot(match);
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
    return snapshot(match);
  }

  async function handle(request, response, path) {
    const method = request.method;
    const host = '127.0.0.1:' + request.socket.localPort;
    let status = 200;
    let output;
    try {
      if (request.headers.host !== host || (method !== 'GET' && request.headers.origin !== 'http://' + host)) {
        throw new GameError(403, '请从本地 4399 页面访问。');
      }
      const matchRoute = /^\/api\/gomoku\/matches\/([\da-f-]+)$/.exec(path);
      if (method === 'GET' && path === '/api/gomoku/models') {
        output = { models: await catalog() };
      } else if (method === 'POST' && path === '/api/gomoku/matches') {
        output = await start(await readInput(request));
        status = 201;
      } else if (matchRoute && method === 'GET') {
        output = snapshot(getMatch(matchRoute[1]));
      } else if (matchRoute && method === 'POST') {
        const input = await readInput(request);
        output = act(getMatch(matchRoute[1]), input);
      } else if (matchRoute && method === 'DELETE') {
        remove(matchRoute[1]);
        status = 204;
      } else {
        throw new GameError(404, '接口不存在。');
      }
    } catch (error) {
      status = error instanceof GameError ? error.status : 500;
      output = { error: error instanceof GameError ? error.message : '游戏服务暂时无法处理请求。' };
    }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(status === 204 ? undefined : JSON.stringify(output));
  }

  function close() {
    for (const id of matches.keys()) remove(id);
    codex.close();
  }

  return { handle, close };
}
