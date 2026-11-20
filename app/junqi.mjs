import { mountFlipMatch } from './flip-match.mjs';
import { lines, points } from '../shared/junqi-board.mjs';

const colorNames = { red: '红方', blue: '蓝方' };
const pieceNames = {
  commander: '司令', general: '军长', division: '师长', brigade: '旅长', regiment: '团长',
  battalion: '营长', company: '连长', platoon: '排长', engineer: '工兵',
  bomb: '炸弹', mine: '地雷', flag: '军旗',
};
const reasons = {
  flag: '夺旗', 'no-action': '败方无着可走', 'quiet-limit': '连续 30 着无翻棋或棋子离场',
};
const previewBoard = points.map(({ camp }) => camp ? null : 'dark');

const plot = points.map(point => ({
  ...point,
  x: 40 + point.col * 80,
  y: 26 + point.row * 41 + (point.row >= 6 ? 36 : 0),
}));
const segment = ({ a, b }) => `M${plot[a.id].x} ${plot[a.id].y}L${plot[b.id].x} ${plot[b.id].y}`;
const rails = lines.filter(line => line.type === 'rail').map(segment).join('');
const roads = lines.filter(line => line.type === 'road').map(segment).join('');
const boardArt = `<svg class="board-lines" viewBox="0 0 400 539" aria-hidden="true">
  <path class="roads" d="${roads}"/>
  <path class="rail-edge" d="${rails}"/><path class="rail-bed" d="${rails}"/><path class="rail-ties" d="${rails}"/>
  ${plot.map(({ x, y, camp, base }) => camp
    ? `<ellipse class="camp-site" cx="${x}" cy="${y}" rx="17" ry="13"/>`
    : `<rect class="${base ? 'base-site' : 'station'}" x="${x - 28}" y="${y - 13}" width="56" height="26" rx="${base ? 4 : 3}"/>`).join('')}
</svg>`;

function renderBoard(cells, legal, last, selected, preview) {
  const flips = new Set(legal.filter(action => action.action === 'flip').map(action => action.to));
  const origins = new Set(legal.filter(action => action.action === 'move').map(action => action.from));
  const targets = new Set(legal.filter(action => action.from === selected && action.action === 'move').map(action => action.to));
  return `<div class="junqi-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="军棋棋盘"'}>
    <div class="board-plot">${boardArt}
      ${plot.map(({ id, x, y, row, col, camp, base }) => {
        const piece = cells[id];
        const dark = piece === 'dark';
        const target = targets.has(id);
        const origin = origins.has(id);
        const tile = dark ? '<span class="tile back"><span class="back-mark">?</span></span>'
          : piece ? `<span class="tile ${piece.color}${piece.type === 'flag' ? ' flag' : ''}">${pieceNames[piece.type]}</span>`
            : camp || base ? `<span class="site-name">${camp ? '行营' : '大本营'}</span>` : '';
        const description = dark ? flips.has(id) ? '翻开暗子' : '暗子'
          : piece ? `${colorNames[piece.color]}${pieceNames[piece.type]}`
            : camp ? '行营' : base ? '大本营' : '空位';
        const from = last?.from === id;
        const to = last?.to === id;
        const recent = from ? ' 最近一步起点' : to ? (last.action === 'flip' ? ' 最近翻开' : ' 最近一步落点') : '';
        const label = `${target ? piece ? '攻击 ' : '移动至 ' : ''}${row + 1} 行 ${col + 1} 列 ${description}${recent}`;
        const classes = ['board-point', from && 'last-from', to && 'last-to',
          target && 'target', id === selected && !preview && 'selected'].filter(Boolean).join(' ');
        const style = `style="--x:${x / 4}%;--y:${y / 539 * 100}%"`;
        return flips.has(id) || origin || target
          ? `<button class="${classes}" type="button" ${style} data-point="${id}" aria-label="${label}" ${origin ? `aria-pressed="${id === selected}"` : ''}>${tile}</button>`
          : `<span class="${classes}" ${style} ${preview ? '' : `role="img" aria-label="${label}"`}>${tile}</span>`;
      }).join('')}
    </div>
  </div>`;
}

mountFlipMatch(document.querySelector('#junqi'), {
  id: 'junqi',
  title: '军棋',
  subtitle: '翻棋',
  setupNote: '同一方连续两次翻到同色，确定阵营',
  previewBoard,
  renderBoard,
  sideLabel: (match, color) => `${colorNames[color]} · 余雷 ${match.mines[color]}`,
  resultDetail: ({ winner, reason }) => reason === 'elimination' ? `${winner ? '败方' : '双方'}可移动棋子全灭` : reasons[reason],
});
