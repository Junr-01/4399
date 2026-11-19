import { mountFlipMatch } from './flip-match.mjs';

const columns = 8;
const previewBoard = Array(4 * columns).fill('dark');
const colorNames = { red: '红方', black: '黑方' };
const pieceNames = {
  red: { general: '帥', advisor: '仕', elephant: '相', chariot: '車', horse: '馬', cannon: '炮', soldier: '兵' },
  black: { general: '將', advisor: '士', elephant: '象', chariot: '車', horse: '馬', cannon: '砲', soldier: '卒' },
};
const reasons = {
  elimination: '败方棋子全被吃',
  'no-action': '败方无着可走',
  'quiet-limit': '连续 60 着未吃子或翻棋',
  repetition: '相同盘面连续循环三次',
};

function renderBoard(board, legal, last, selected, preview) {
  const flips = new Set();
  const origins = new Set();
  const targets = new Set();
  for (const { action, from, to } of legal) {
    if (action === 'flip') flips.add(to);
    else {
      origins.add(from);
      if (from === selected) targets.add(to);
    }
  }

  const squares = board.map((piece, id) => {
    const dark = piece === 'dark';
    const target = targets.has(id);
    const tile = dark ? '<span class="banqi-piece back" aria-hidden="true"></span>'
      : piece ? `<span class="banqi-piece ${piece.color}" aria-hidden="true">${pieceNames[piece.color][piece.type]}</span>` : '';
    const from = last?.from === id;
    const to = last?.to === id;
    const classes = ['banqi-square', from && 'last-from', to && 'last-to', target && (piece ? 'capture' : 'target'),
      id === selected && 'selected'].filter(Boolean).join(' ');
    const row = Math.floor(id / columns) + 1;
    const col = id % columns + 1;
    const description = dark ? flips.has(id) ? '翻开暗子' : '暗子'
      : piece ? `${colorNames[piece.color]}${pieceNames[piece.color][piece.type]}` : '空位';
    const action = target ? piece ? '吃子，' : '移动至，' : '';
    const recent = from ? '，最近一步起点' : to ? last.action === 'flip' ? '，最近翻开' : '，最近一步落点' : '';
    const label = `${action}${row} 行 ${col} 列，${description}${recent}`;
    return flips.has(id) || origins.has(id) || target
      ? `<button type="button" class="${classes}" data-point="${id}" aria-label="${label}" ${origins.has(id) ? `aria-pressed="${id === selected}"` : ''}>${tile}</button>`
      : `<span class="${classes}" ${preview ? '' : `role="img" aria-label="${label}"`}>${tile}</span>`;
  }).join('');
  return `<div class="banqi-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="暗棋棋盘"'}><div class="banqi-grid">${squares}</div></div>`;
}

mountFlipMatch(document.querySelector('#banqi'), {
  id: 'banqi',
  title: '暗棋',
  setupNote: '先翻方执第一枚棋子的颜色',
  previewBoard,
  renderBoard,
  sideLabel: (_, color) => colorNames[color],
  resultDetail: ({ reason }) => reasons[reason],
});
