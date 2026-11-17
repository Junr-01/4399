import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gomokuRootMarker } from './gomoku-workspace.mjs';

const xiangqiInstructions = `你是 4399 中国象棋的人机对手，按中国象棋协会《象棋竞赛规则（2020版）》对弈。红方先走。
每回合以最新输入为准。board 是 90 个点的数组，按黑上红下逐行排列，每行 9 点。大写是红方，小写是黑方，null 表示空点。k 为将帅，a 为士仕，e 为象相，h 为马，r 为车，c 为炮，p 为卒兵。from 和 to 是数组中的点号。
从 legal 列表为 aiSide 选一着，优先将死、解将或取得子力优势。若 adjudication 要求你变着，选择能打破循环的着法，并遵循其中的闲着要求。
直接返回所选着法的编号，格式为 {"move":整数}。无需调用工具。`;

const chessInstructions = `你是 4399 国际象棋的人机对手。使用标准国际象棋规则，白方先走。三次重复或双方各 50 着未动兵也未吃子时自动判和。
fen 是当前完整局面，aiSide 是你的棋色。以最新输入为准，玩家可能已经悔棋。recentMoves 是近期棋谱，legal 是本回合可用着法。from、to 使用 a1 到 h8 坐标。升变字段 q、r、b、n 分别表示后、车、象、马。
评估合法着法并为你的棋色选一着。只返回该着的编号，格式为 {"move":整数}。无需调用工具。`;

const junqiInstructions = `你是 4399 军棋翻棋的人机对手。每回合以最新公开局面为准，玩家可能已经悔棋。board 按从上到下、从左到右排列，共 12 行，每行 5 点，编号从 0 到 59。null 是空点，"dark" 是暗子，明子用 color 和 type 表示。sides 是双方阵营，flips 是双方各自上次翻到的颜色，mines 是各色剩余地雷数，quiet 是连续无翻棋和无棋子离场的着数，recentMoves 是最近的公开行动。
未定阵营时只能翻暗子。某一方连续两次翻到同色就执该色，若翻完仍未定色，最后翻棋方执最后翻出的颜色。随后每着可翻暗子或走己方明子。公路一格，铁路可直行多格，工兵可沿畅通铁路转弯，棋子会挡路，行营内棋子免受攻击，大本营可进出。
普通棋子按 commander（司令）、general（军长）、division（师长）、brigade（旅长）、regiment（团长）、battalion（营长）、company（连长）、platoon（排长）、engineer（工兵）从强到弱，强者留在交战点，同级同归于尽。bomb（炸弹）碰子同归于尽，工兵挖 mine（地雷）并留下，只有工兵和炸弹可以排雷。军旗和地雷不能移动。
敌方三雷清除后可夺取已翻开的 flag（军旗），夺旗即胜，即使炸弹夺旗。对方可移动棋子全灭或无合法行动也胜，双方同时全灭或连续 30 着未翻棋、无棋子离场则和棋。
从 legal 中选择一着，翻棋含 to，走棋含 from 和 to。只返回该着的编号，格式为 {"move":整数}。无需调用工具。`;

const instructions = { xiangqi: xiangqiInstructions, chess: chessInstructions, junqi: junqiInstructions };
const staleToolRequest = '本次 AI 请求已失效。';

function toolResponse(id, success, text) {
  return { id, result: { success, contentItems: [{ type: 'inputText', text }] } };
}

function outputSchema(position) {
  return {
    type: 'object', properties: { move: { type: 'integer', minimum: 0, maximum: position.legal.length - 1 } },
    required: ['move'], additionalProperties: false,
  };
}

function unavailable(message) {
  return Object.assign(new Error(message), { userMessage: message });
}

function startClient(cwd) {
  const child = spawn(process.env.CODEX_BIN || 'codex', [
    'app-server', '--listen', 'stdio://',
    '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'hooks',
    '--disable', 'plugins', '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
    '-c', 'mcp_servers={}', '-c', 'web_search="disabled"',
    '-c', `project_root_markers=${JSON.stringify(['.git', gomokuRootMarker])}`,
  ], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  const listeners = new Set();
  const toolHandlers = new Map();
  const ended = new AbortController();
  let nextId = 0;

  function fail(error) {
    if (ended.signal.aborted) return;
    ended.abort(error);
    for (const finish of pending.values()) finish(error);
  }

  child.on('error', (error) => fail(unavailable(error.code === 'ENOENT'
    ? '找不到 Codex CLI。请安装 Codex CLI，或用 CODEX_BIN 指定它的位置。'
    : '无法启动 Codex。')));
  child.stdin.on('error', () => {
    fail(new Error('与 Codex 的连接已断开。'));
    child.kill();
  });
  child.once('close', () => {
    fail(new Error('与 Codex 的连接已断开。'));
    rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  function notify(message) {
    if (!ended.signal.aborted) child.stdin.write(JSON.stringify(message) + '\n');
  }

  createInterface({ input: child.stdout }).on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.method && message.id !== undefined) {
      if (message.method === 'item/tool/call') {
        const handler = toolHandlers.get(message.params?.threadId);
        notify(handler ? handler(message) : toolResponse(message.id, false, staleToolRequest));
      } else notify({ id: message.id, error: { code: -32601, message: '4399 does not handle this server request.' } });
    } else if (message.method) {
      for (const listen of listeners) listen(message);
    } else {
      pending.get(message.id)?.(message.error ? new Error(message.error.message) : null, message.result);
    }
  });

  function request(method, params, onResult) {
    return new Promise((resolve, reject) => {
      ended.signal.throwIfAborted();
      const id = ++nextId;
      const timeout = setTimeout(() => finish(new Error('Codex 连接超时，请重试。')), 12_000);
      function finish(error, result) {
        clearTimeout(timeout);
        pending.delete(id);
        if (error) reject(error);
        else {
          onResult?.(result);
          resolve(result);
        }
      }
      pending.set(id, finish);
      notify({ id, method, params });
    });
  }

  return { request, notify, listeners, toolHandlers, ended: ended.signal, close: () => child.kill() };
}

async function playTurn(client, threadId, config, input, signal, usesTools) {
  const { promise, resolve } = Promise.withResolvers();
  let turnId;
  let completed = false;
  let interrupted = false;
  let finalText;

  function interrupt() {
    if (!turnId || completed || interrupted) return;
    interrupted = true;
    client.request('turn/interrupt', { threadId, turnId }).catch(() => {});
  }

  function identifyTurn(id) {
    turnId ??= id;
    if (signal.aborted) interrupt();
  }

  const listen = ({ method, params }) => {
    if (params?.threadId !== threadId) return;
    if (method === 'turn/started') identifyTurn(params.turn.id);
    if (!turnId) return;
    if (method === 'item/completed' && params.turnId === turnId && params.item.type === 'agentMessage') {
      finalText = params.item.text;
    }
    if (method === 'turn/completed' && params.turn.id === turnId) {
      completed = true;
      resolve(params.turn.status);
    }
  };
  const handleTool = ({ id, params }) => {
    if (!turnId || params.turnId !== turnId || completed || signal.aborted) return toolResponse(id, false, staleToolRequest);
    try {
      const output = input.callTool(params.tool, params.arguments);
      return toolResponse(id, true, typeof output === 'string' ? output : JSON.stringify(output));
    } catch (error) {
      return toolResponse(id, false, error.message || '工具请求失败。');
    }
  };
  const abort = () => {
    interrupt();
    resolve('cancelled');
  };
  client.listeners.add(listen);
  if (usesTools) client.toolHandlers.set(threadId, handleTool);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await client.request('turn/start', {
      threadId,
      model: config.model,
      effort: config.effort,
      input: [{ type: 'text', text: usesTools ? input.text : JSON.stringify(input) }],
      outputSchema: usesTools ? undefined : outputSchema(input),
    }, result => identifyTurn(result?.turn?.id));
    if (!turnId) throw new Error('Codex 未返回回合 ID。');
    const status = await promise;
    signal.throwIfAborted();
    if (status !== 'completed') throw new Error('AI 未能完成落子。');
    if (!usesTools) return JSON.parse(finalText);
  } catch (error) {
    interrupt();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    client.listeners.delete(listen);
    if (usesTools) client.toolHandlers.delete(threadId);
  }
}

export function createCodexOpponent(version) {
  let connection;
  let closed = false;

  function connect() {
    if (closed) throw new Error('游戏服务已关闭。');
    if (connection) return connection;
    const startup = (async () => {
      const cwd = await mkdtemp(join(tmpdir(), '4399-codex-'));
      const client = startClient(cwd);
      client.ended.addEventListener('abort', clearConnection, { once: true });
      try {
        await client.request('initialize', {
          clientInfo: { name: '4399', version }, capabilities: { experimentalApi: true },
        });
        client.notify({ method: 'initialized' });
        return client;
      } catch (error) {
        client.close();
        throw error;
      }
    })();
    function clearConnection() {
      if (connection === startup) connection = undefined;
    }
    connection = startup;
    startup.catch(clearConnection);
    return startup;
  }

  async function catalog() {
    const client = await connect();
    const { account, requiresOpenaiAuth } = await client.request('account/read', { refreshToken: false });
    if (requiresOpenaiAuth && !account) throw unavailable('请先运行 codex login 登录，再重试。');
    const models = [];
    let cursor;
    do {
      const page = await client.request('model/list', { limit: 50, cursor });
      for (const item of page.data) {
        const efforts = item.supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort);
        if (!efforts.length) continue;
        models.push({
          id: item.model,
          name: item.displayName,
          efforts,
          defaultEffort: efforts.includes(item.defaultReasoningEffort) ? item.defaultReasoningEffort : efforts[0],
          isDefault: item.isDefault,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    if (!models.length) throw unavailable('当前 Codex 登录没有可选模型。');
    return models;
  }

  function openMatch(config, game, { cwd, dynamicTools } = {}) {
    let session;

    function dispose() {
      if (!session) return;
      const { client, threadId } = session;
      session = undefined;
      client.request('thread/unsubscribe', { threadId }).catch(() => {});
    }

    async function move(input, cancel) {
      const client = await connect();
      const signal = AbortSignal.any([cancel, client.ended, AbortSignal.timeout(90_000)]);
      try {
        signal.throwIfAborted();
        if (session?.client !== client) {
          const { thread } = await client.request('thread/start', {
            model: config.model, ephemeral: true, sandbox: 'read-only',
            approvalPolicy: 'never', developerInstructions: instructions[game],
            cwd, dynamicTools,
          });
          session = { client, threadId: thread.id };
        }
        return await playTurn(client, session.threadId, config, input, signal, Boolean(dynamicTools));
      } catch (error) {
        dispose();
        throw error;
      }
    }

    return { move, dispose };
  }

  function close() {
    closed = true;
    connection?.then(client => client.close(), () => {});
  }

  return { catalog, openMatch, close };
}
