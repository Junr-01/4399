import { randomUUID } from 'node:crypto';

const expiry = 60 * 60 * 1000;
const reservationExpiry = 2 * 60 * 1000;

export class GameError extends Error {
  constructor(status, message, snapshot) {
    super(message);
    this.status = status;
    this.snapshot = snapshot;
  }
}

export function cancelTurn(match) {
  const current = match.turn;
  match.turn = null;
  current?.abort();
}

export function runTurn(match, position, apply, failureMessage) {
  const turn = new AbortController();
  match.turn = turn;
  match.error = null;
  match.task = match.task.then(async () => {
    if (turn.signal.aborted) return;
    try {
      const move = await match.opponent.move(position, turn.signal);
      if (match.turn === turn) apply(move);
    } catch {
      if (match.turn === turn) match.error = failureMessage;
    } finally {
      if (match.turn === turn) match.turn = null;
    }
  });
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

export function createMatchApi(name, codex, { configure, create, snapshot, scheduleTurn, act, reserveId = false }) {
  const matches = new Map();
  const reservations = new Map();
  const prefix = '/api/' + name;

  function remove(id) {
    reservations.delete(id);
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

  function reserve() {
    const now = Date.now();
    for (const [id, expires] of reservations) if (expires <= now) reservations.delete(id);
    if (reservations.size >= 32) throw new GameError(409, '待开局数量过多，请稍后重试。');
    const id = randomUUID();
    reservations.set(id, now + reservationExpiry);
    return { id };
  }

  async function start(input) {
    const options = configure(input);
    const model = (await catalog()).find(entry => entry.id === options.model);
    if (!model?.efforts.includes(options.effort)) throw new GameError(400, '请重新选择可用的模型和思考强度。');
    for (const [id, match] of matches) if (Date.now() - match.lastSeen > expiry) remove(id);
    const old = input.replace === undefined ? null : getMatch(input.replace);
    if (old && !old.paused) throw new GameError(409, '请先暂停当前对局。');
    if (!old && matches.size >= 32) throw new GameError(409, '对局数量过多，请关闭闲置对局后再试。');

    let id;
    if (reserveId) {
      id = input.id;
      if (!(reservations.get(id) > Date.now())) throw new GameError(404, '本次开局已关闭，请重新开始。');
      reservations.delete(id);
    } else id = randomUUID();

    const config = { ...options, modelName: model.name };
    const match = {
      ...create(config), id, config, lastSeen: Date.now(), paused: false,
      turn: null, error: null, task: Promise.resolve(), opponent: codex.openMatch(config, name),
    };
    if (old) remove(old.id);
    matches.set(match.id, match);
    scheduleTurn(match);
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
      const matchRoute = path.slice(prefix.length).match(/^\/matches\/([\da-f-]+)$/);
      if (method === 'GET' && path === prefix + '/models') {
        output = { models: await catalog() };
      } else if (reserveId && method === 'POST' && path === prefix + '/reservations') {
        output = reserve();
        status = 201;
      } else if (method === 'POST' && path === prefix + '/matches') {
        output = await start(await readInput(request));
        status = 201;
      } else if (matchRoute && method === 'GET') {
        output = snapshot(getMatch(matchRoute[1]));
      } else if (matchRoute && method === 'POST') {
        const input = await readInput(request);
        const match = getMatch(matchRoute[1]);
        act(match, input);
        output = snapshot(match);
      } else if (matchRoute && method === 'DELETE') {
        remove(matchRoute[1]);
        status = 204;
      } else {
        throw new GameError(404, '接口不存在。');
      }
    } catch (error) {
      status = error instanceof GameError ? error.status : 500;
      output = error instanceof GameError
        ? { error: error.message, snapshot: error.snapshot }
        : { error: '游戏服务暂时无法处理请求。' };
    }
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(status === 204 ? undefined : JSON.stringify(output));
  }

  function close() {
    reservations.clear();
    for (const id of matches.keys()) remove(id);
  }

  return { handle, close };
}
