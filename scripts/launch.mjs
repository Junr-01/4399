import { spawn } from 'node:child_process';
import { mkdir, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { root, identity } from './server.mjs';
import { liveService, url } from './service.mjs';

try {
  let health = await liveService();
  const reused = Boolean(health);
  if (!health) {
    const runtime = join(tmpdir(), '4399');
    await mkdir(runtime, { recursive: true, mode: 0o700 });
    const logPath = join(runtime, `${identity}.log`);
    const log = await open(logPath, 'a', 0o600);
    const child = spawn(process.execPath, [join(root, 'scripts/server.mjs')], {
      cwd: root,
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    });
    let spawnError;
    child.once('error', (error) => { spawnError = error; });
    child.unref();
    await log.close();
    for (let attempt = 0; attempt < 40; attempt++) {
      if (spawnError) throw spawnError;
      await setTimeout(75);
      health = await liveService();
      if (health) break;
    }
    if (!health) throw new Error(`服务未就绪，请查看 ${logPath}`);
  }
  console.log(JSON.stringify({ url: `${url}/`, pid: health.pid, reused }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
