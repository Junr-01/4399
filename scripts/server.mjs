import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCodexOpponent } from './codex-opponent.mjs';
import { createGomokuApi } from './gomoku.mjs';
import { createXiangqiApi } from './xiangqi.mjs';
import { createChessApi } from './chess.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const identity = createHash('sha256').update(root).digest('hex').slice(0, 16);
export const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

export function configuredPort() {
  const value = process.env.PORT ?? '4399';
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error('PORT 必须是 1–65535 的整数。');
  }
  return Number(value);
}

export function createGameServer({ codex = createCodexOpponent(version) } = {}) {
  const gomoku = createGomokuApi(codex);
  const xiangqi = createXiangqiApi(codex);
  const chess = createChessApi(codex);
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; object-src 'none'");
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      send(400, 'Invalid path');
      return;
    }
    if (pathname.startsWith('/api/gomoku/')) return gomoku.handle(request, response, pathname);
    if (pathname.startsWith('/api/xiangqi/')) return xiangqi.handle(request, response, pathname);
    if (pathname.startsWith('/api/chess/')) return chess.handle(request, response, pathname);
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'Method not allowed');
      return;
    }
    if (pathname === '/health') {
      send(200, JSON.stringify({ app: '4399', id: identity, version, pid: process.pid }), 'application/json; charset=utf-8');
      return;
    }
    if (pathname.split('/').some((part) => part.startsWith('.')) || pathname.includes('\0') || pathname.includes('\\')) {
      send(404, 'Not found');
      return;
    }
    const assetRequest = pathname.startsWith('/assets/');
    const base = join(root, assetRequest ? 'assets' : 'app');
    const assetPath = assetRequest ? pathname.slice('/assets/'.length) : pathname.slice(1);
    const filename = assetPath || 'index.html';
    const type = mimeTypes[extname(filename)];
    if (!type) {
      send(404, 'Not found');
      return;
    }
    try {
      const actualPath = await realpath(join(base, filename));
      const inside = relative(await realpath(base), actualPath);
      if (inside.startsWith('..') || isAbsolute(inside)) {
        send(404, 'Not found');
        return;
      }
      send(200, await readFile(actualPath), type);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) send(404, 'Not found');
      else {
        console.error(error);
        send(500, 'Unable to load game library');
      }
    }
  });
  server.once('close', () => {
    gomoku.close();
    xiangqi.close();
    chess.close();
    codex.close();
  });
  return server;
}

export async function startServer(port = configuredPort(), options) {
  const server = createGameServer(options);
  await new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveStart);
  });
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const server = await startServer();
    console.log(`4399 · http://127.0.0.1:${server.address().port}/`);
    const stop = () => {
      server.close();
      server.closeIdleConnections();
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    console.error(error.code === 'EADDRINUSE' ? '4399 服务端口被占用，请先关闭旧服务，或通过 PORT 指定空闲端口。' : error.message);
    process.exitCode = 1;
  }
}
