import { liveService, stopService } from './service.mjs';

try {
  const health = await liveService();
  if (!health) console.log('4399 服务未启动。');
  else {
    await stopService(health);
    console.log('4399 服务已停止。');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
