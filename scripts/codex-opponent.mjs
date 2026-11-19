import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { gameRootMarker } from './game-workspace.mjs';

const staleToolRequest = '本次 AI 请求已失效。';

function toolResponse(id, success, text) {
  return { id, result: { success, contentItems: [{ type: 'inputText', text }] } };
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
    '-c', `project_root_markers=${JSON.stringify(['.git', gameRootMarker])}`,
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
      } else notify({ id: message.id, error: { code: -32601, message: '43gg does not handle this server request.' } });
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

async function playTurn(client, threadId, config, input, signal) {
  const { promise, resolve } = Promise.withResolvers();
  let turnId;
  let completed = false;
  let interrupted = false;

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
  client.toolHandlers.set(threadId, handleTool);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    await client.request('turn/start', {
      threadId,
      model: config.model,
      effort: config.effort,
      input: [{ type: 'text', text: input.text }],
    }, result => identifyTurn(result?.turn?.id));
    if (!turnId) throw new Error('Codex 未返回回合 ID。');
    const status = await promise;
    signal.throwIfAborted();
    if (status !== 'completed') throw new Error('AI 未能完成落子。');
  } catch (error) {
    interrupt();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    client.listeners.delete(listen);
    client.toolHandlers.delete(threadId);
  }
}

export function createCodexOpponent(version) {
  let connection;
  let closed = false;

  function connect() {
    if (closed) throw new Error('游戏服务已关闭。');
    if (connection) return connection;
    const startup = (async () => {
      const cwd = await mkdtemp(join(tmpdir(), '43gg-codex-'));
      const client = startClient(cwd);
      client.ended.addEventListener('abort', clearConnection, { once: true });
      try {
        await client.request('initialize', {
          clientInfo: { name: '43gg', version }, capabilities: { experimentalApi: true },
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

  function openMatch(config, _game, { cwd, dynamicTools }) {
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
            approvalPolicy: 'never',
            cwd, dynamicTools,
          });
          session = { client, threadId: thread.id };
        }
        return await playTurn(client, session.threadId, config, input, signal);
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
