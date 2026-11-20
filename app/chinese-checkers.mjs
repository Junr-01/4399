import { points, seatColors, seatsFor } from '/shared/chinese-checkers-board.mjs';
import { effortOption, escapeHtml, selectModel } from './game-models.mjs';
import { createMatchSession } from './match-session.mjs';
import { createResultDialog, gameToolbar, matchFeedback } from './match-ui.mjs';

const main = document.querySelector('#chinese-checkers');
const showResult = createResultDialog(main);
const draft = { playerCount: 2, model: '', effort: '' };
const reasons = { goal: '10 枚棋子全部进入目标营地', blocked: '与堵住目标营地的棋子交换后获胜', 'no-moves': '所有席位均无合法着法' };
const playerCounts = [2, 3, 4, 5, 6];
const boardWidth = 500;
const boardHeight = 550;
const gridStep = 36;
const gridHeight = gridStep * Math.sqrt(3) / 2;
const position = (column, row) => [boardWidth / 2 + column * gridStep, boardHeight / 2 + row * gridHeight];
const centers = points.map(({ q, r }) => position(q + r / 2, r));
const campTips = [[0, 8], [-6, 4], [-6, -4], [0, -8], [6, -4], [6, 4]];
const campCorners = [
  [[2, 4], [-2, 4]], [[-2, 4], [-4, 0]], [[-4, 0], [-2, -4]],
  [[-2, -4], [2, -4]], [[2, -4], [4, 0]], [[4, 0], [2, 4]],
];
const star = campTips.flatMap((tip, seat) => [tip, campCorners[seat][1]]);
const polygon = corners => corners.map(([column, row]) => position(column, row).join(',')).join(' ');
const campShapes = campTips.map(([column, row], seat) => polygon([
  [column, row], ...campCorners[seat].map(([x, y]) => [column + (x - column) * .84, row + (y - row) * .84]),
]));
const disabled = when => when ? 'disabled' : '';

let selected;
const session = createMatchSession('chinese-checkers', draft, render, () => { selected = undefined; },
  { releaseOnHistoryNavigation: true });

function seatName(seats, seat) {
  return seat === 0 ? '你' : `AI ${seats.indexOf(seat)}`;
}

function drawBoard(cells, last) {
  const path = last ? last.path.map(point => centers[point].join(',')).join(' ') : '';
  return `<svg class="checkers-board-art" viewBox="0 0 ${boardWidth} ${boardHeight}" aria-hidden="true">
    <polygon class="board-star" points="${polygon(star)}"/>
    ${campShapes.map((shape, seat) => `<polygon class="board-camp seat-${seat}" points="${shape}"/>`).join('')}
    ${last ? `<polyline class="move-path-outline" points="${path}"/><polyline class="move-path${last.swap ? ' is-swap' : ''}" points="${path}"/>` : ''}
  </svg>${cells}`;
}

function boardView(preview = false) {
  const { match, busy, error } = session.state;
  const seats = preview ? seatsFor(draft.playerCount) : match.seats;
  const last = preview ? null : match.lastMove;
  const legal = preview || busy || error ? [] : match.legal;
  const origins = new Set(legal.map(({ from }) => from));
  const targets = new Set(legal.filter(({ from }) => from === selected).map(({ to }) => to));
  const trail = new Set(last?.path.slice(1, -1));
  const cells = points.map(({ id, camp }) => {
    const seat = preview ? (seats.includes(camp) ? camp : null) : match.board[id];
    const [x, y] = centers[id];
    const origin = origins.has(id);
    const target = targets.has(id);
    const piece = seat !== null;
    const start = id === last?.from;
    const end = id === last?.to;
    const via = trail.has(id);
    const classes = ['checkers-hole', piece && `peg seat-${seat}`, start && 'recent-start', end && 'recent-end',
      via && 'recent-via', id === selected && 'chosen', target && 'destination'].filter(Boolean).join(' ');
    const attrs = `class="${classes}" style="--x:${x / boardWidth * 100}%;--y:${y / boardHeight * 100}%"`;
    const occupant = piece ? `${seatName(seats, seat)}的${seatColors[seat]}色棋子` : '空孔';
    const label = `${target ? '移至' : ''}孔位 ${id}，${occupant}${start ? '，最近一步起点' : end ? '，最近一步落点' : via ? '，最近一步经过' : ''}`;
    if (origin || target) {
      return `<button ${attrs} type="button" data-point="${id}" aria-label="${label}" ${origin ? `aria-pressed="${id === selected}"` : ''}></button>`;
    }
    const readable = !preview && (piece || start || end || via);
    return `<span ${attrs} ${readable ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}></span>`;
  }).join('');
  return `<div class="checkers-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="中国跳棋棋盘"'}>${drawBoard(cells, last)}</div>`;
}

function picker(name, label, options) {
  const { busy } = session.state;
  return `<label class="checkers-field"><span>${label}</span><select name="${name}" ${disabled(busy || !options.length)}>
    ${options.length ? options.map(([value, description]) => `<option value="${escapeHtml(value)}" ${draft[name] === value ? 'selected' : ''}>${escapeHtml(description)}</option>`).join('')
      : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
  </select></label>`;
}

function setupView() {
  const { models, match, busy, error, actionError } = session.state;
  const model = models.find(item => item.id === draft.model);
  const note = draft.playerCount === 5 ? '5 人局使用入门布局，你对面的营地开局留空。' : '你先走，其余席位由 AI 执棋。';
  return `<section class="checkers-setup">${boardView(true)}
    <form class="checkers-form" aria-labelledby="setup-title">
      <h2 id="setup-title">对局设置</h2>
      <fieldset ${disabled(busy)}><legend>玩家人数</legend><div class="count-options">${playerCounts.map(count =>
        `<label><input type="radio" name="playerCount" value="${count}" ${draft.playerCount === count ? 'checked' : ''}><span>${count} 人</span></label>`).join('')}
      </div><p class="checkers-note">${note}</p></fieldset>
      <div class="checkers-models">
        ${picker('model', 'AI 模型', models.map(item => [item.id, item.name]))}
        ${picker('effort', '思考强度', (model?.efforts ?? []).map(effort => [effort, effortOption(effort)]))}
      </div>
      <button class="checkers-start" type="submit" ${disabled(busy || !model)}>开始对局 <span aria-hidden="true">→</span></button>
      ${match ? `<button class="checkers-return" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
      ${error || actionError ? `<p class="checkers-error" role="alert">${escapeHtml(error || actionError)}</p>
        <button class="match-button" type="button" data-action="catalog">${model ? '刷新模型列表' : '重试'}</button>` : ''}
    </form>
  </section>`;
}

function resultView(match) {
  if (!match?.result) return null;
  const { winner, reason } = match.result;
  const title = winner === null ? '和棋' : winner === 0 ? '你获胜' : `${seatName(match.seats, winner)} 获胜`;
  return { title, detail: reasons[reason] };
}

function playView(result) {
  const { match, busy, error, actionError } = session.state;
  const { seats, side, aiTurn, thinking } = match;
  const activeName = seatName(seats, side);
  const status = result ? result.title : error ? '对局暂未更新'
    : thinking ? `${activeName} 正在思考` : aiTurn ? `等待 ${activeName} 继续` : '轮到你走棋';
  const players = seats.map(seat => {
    const active = side === seat && !result;
    const label = seatName(seats, seat);
    return `<li class="checkers-seat seat-${seat}" ${active ? 'aria-current="true"' : ''}>
      <span class="seat-dot" aria-hidden="true"></span><span>${label}<span class="visually-hidden">，${seatColors[seat]}色</span></span>
    </li>`;
  }).join('');
  return `<section class="match-view">
    <p class="match-status" role="status" tabindex="-1">${status}</p>
    ${matchFeedback(error, match.error, busy, actionError)}
    ${boardView()}
    <ul class="checkers-seats" aria-label="席位">${players}</ul>
  </section>`;
}

function render(focus) {
  const { match, busy, setup } = session.state;
  const result = resultView(match);
  main.innerHTML = `<div class="checkers-shell ${setup ? 'checkers-config' : 'checkers-playing'}">
    ${gameToolbar(setup ? null : match, busy)}
    ${setup ? `<h1 tabindex="-1">中国跳棋</h1>${setupView()}` : playView(result)}
  </div>`;
  if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
  showResult(match, result, busy);
}

main.addEventListener('change', ({ target }) => {
  if (session.state.busy || !Object.hasOwn(draft, target.name)) return;
  draft[target.name] = target.name === 'playerCount' ? Number(target.value) : target.value;
  if (target.name === 'model') selectModel(session.state.models, draft);
  if (target.name !== 'effort') {
    render(target.name === 'model' ? '[name="model"]' : `[name="playerCount"][value="${draft.playerCount}"]`);
  }
});

main.addEventListener('submit', event => {
  event.preventDefault();
  session.start();
});

main.addEventListener('click', event => {
  const { match, busy } = session.state;
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  const { point, action } = button.dataset;
  if (point !== undefined) {
    const to = Number(point);
    const move = match.legal.find(move => move.from === selected && move.to === to);
    if (move) session.act('move', move, '.match-status');
    else {
      selected = selected === to ? undefined : to;
      render(`[data-point="${point}"]`);
    }
  } else if (action === 'catalog') session.loadModels('[name="model"]');
  else if (action) session.act(action, undefined, `[data-action="${action}"]`);
});

session.loadModels();
