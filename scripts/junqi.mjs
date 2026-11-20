import { createFlipGameApi } from './flip-game-api.mjs';
import { createJunqi } from './junqi-rules.mjs';
import { points } from '../shared/junqi-board.mjs';

const game = {
  name: 'junqi', title: '军棋', size: points.length, createGame: createJunqi,
  positionDetails: ({ flips, mines }) => ({ flips, mines }),
};

export function createJunqiApi(codex, directory, random) {
  return createFlipGameApi(game, codex, directory, random);
}
