import { createFlipGameApi } from './flip-game-api.mjs';
import { createBanqi, banqiSize } from './banqi-rules.mjs';

const game = { name: 'banqi', title: '暗棋', size: banqiSize, createGame: createBanqi };

export function createBanqiApi(codex, directory, random) {
  return createFlipGameApi(game, codex, directory, random);
}
