import { configuredPort, identity } from './server.mjs';
import { setTimeout as delay } from 'node:timers/promises';

export const url = `http://127.0.0.1:${configuredPort()}`;

// Only reuse or stop this exact installed copy of the plugin.
export async function liveService() {
  let response;
  try {
    response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(800) });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return null;
    throw new Error(`${url} 无法连接：${error.message}`);
  }
  let health;
  try { health = await response.json(); } catch { /* An unrelated listener may not return JSON. */ }
  if (!response.ok || health?.app !== '4399' || health.id !== identity || !Number.isInteger(health.pid) || health.pid <= 0) {
    throw new Error(`${url} 已被其他服务或另一份 4399 占用，请先处理端口冲突。`);
  }
  return health;
}

export async function stopService(health) {
  try { process.kill(health.pid, 'SIGTERM'); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(50);
    const current = await liveService();
    if (!current || current.pid !== health.pid) return;
  }
  throw new Error('4399 服务尚未退出，请稍后重试。');
}
