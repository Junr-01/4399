import { mkdirSync, writeFileSync } from 'node:fs';
import { access, link, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const gameRootMarker = '.43gg-root';

function withTools(instructions, tools) {
  const startMarker = '<!-- 43gg:tools:start -->';
  const endMarker = '<!-- 43gg:tools:end -->';
  const section = `${startMarker}\n${tools.trimEnd()}\n${endMarker}`;
  const start = instructions.indexOf(startMarker);
  const end = instructions.indexOf(endMarker, start + startMarker.length);
  if (start >= 0 && end >= 0) {
    return instructions.slice(0, start) + section + instructions.slice(end + endMarker.length);
  }
  const gap = !instructions || instructions.endsWith('\n\n') ? '' : instructions.endsWith('\n') ? '\n' : '\n\n';
  return instructions + gap + section + '\n';
}

export function createGameWorkspace(game, directory, { includeTools = false } = {}) {
  const legacyInstructions = directory === undefined ? join(homedir(), '.4399', game, 'AGENTS.md') : null;
  directory ??= join(homedir(), '.43gg', game);
  const prompts = new URL(`../docs/${game}-prompts/`, import.meta.url);
  const readPrompt = name => readFile(new URL(name, prompts), 'utf8');
  let pending;

  async function initializeWorkspace() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, gameRootMarker), '', { flag: 'a', mode: 0o600 });
    const target = join(directory, 'AGENTS.md');
    let existing;
    try {
      if (includeTools) existing = await readFile(target, 'utf8');
      else {
        await access(target);
        return;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    let instructions = existing;
    if (instructions === undefined && legacyInstructions) {
      try {
        instructions = (await readFile(legacyInstructions, 'utf8'))
          .replaceAll(/^# 4399(?= )/gm, '# 43gg')
          .replaceAll('<!-- 4399:tools:', '<!-- 43gg:tools:');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (instructions === undefined) {
      const [role, rule] = await Promise.all(['role.md', 'rule.md'].map(readPrompt));
      instructions = `${role.trimEnd()}\n\n${rule.trimEnd()}\n`;
    }
    if (includeTools) instructions = withTools(instructions, await readPrompt('tools.md'));
    if (instructions === existing) return;

    const staging = await mkdtemp(join(directory, '.instructions-'));
    try {
      const source = join(staging, 'AGENTS.md');
      await writeFile(source, instructions, { mode: 0o600 });
      if (existing === undefined) await link(source, target);
      else await rename(source, target);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  function initialize() {
    pending ??= initializeWorkspace().finally(() => { pending = undefined; });
    return pending;
  }

  function prepare(id, instructions) {
    const cwd = join(directory, id);
    mkdirSync(cwd, { mode: 0o700 });
    writeFileSync(join(cwd, 'AGENTS.md'), instructions, { mode: 0o600 });
    return cwd;
  }

  return { initialize, prepare };
}
