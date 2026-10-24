import { setTimeout } from 'node:timers/promises';
import { liveService } from './service.mjs';

try {
  const health = await liveService();
  if (!health) console.log('4399 服务未启动。');
  else {
    process.kill(health.pid, 'SIGTERM');
    let stopped = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await setTimeout(50);
      const current = await liveService();
      if (!current || current.pid !== health.pid) {
        stopped = true;
        break;
      }
    }
    if (!stopped) throw new Error('4399 服务尚未退出，请稍后重试。');
    console.log('4399 服务已停止。');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
