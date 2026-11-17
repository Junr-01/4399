import { mkdirSync, writeFileSync } from 'node:fs';
import { access, link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const gameRootMarker = '.4399-root';

export function createGameWorkspace(game, directory = join(homedir(), '.4399', game)) {
  const prompts = new URL(`../docs/${game}-prompts/`, import.meta.url);

  async function initialize() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, gameRootMarker), '', { flag: 'a', mode: 0o600 });
    const target = join(directory, 'AGENTS.md');
    try {
      await access(target);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const [role, rule] = await Promise.all(['role.md', 'rule.md'].map(name => readFile(new URL(name, prompts), 'utf8')));
    const staging = await mkdtemp(join(directory, '.instructions-'));
    try {
      const source = join(staging, 'AGENTS.md');
      await writeFile(source, `${role.trimEnd()}\n\n${rule.trimEnd()}\n`, { mode: 0o600 });
      await link(source, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  function prepare(id, instructions) {
    const cwd = join(directory, id);
    mkdirSync(cwd, { mode: 0o700 });
    writeFileSync(join(cwd, 'AGENTS.md'), instructions, { mode: 0o600 });
    return cwd;
  }

  return { initialize, prepare };
}
