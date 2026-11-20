import { effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { createResultDialog, gameToolbar, matchFeedback, matchLayout, matchPlayer, matchResult } from './match-ui.mjs';
import { createMatchSession } from './match-session.mjs';

const main = document.querySelector('#gomoku');
const showResult = createResultDialog(main);
const colors = { black: '黑方', white: '白方' };
const draft = { size: 15, first: 'you', model: '', effort: '' };
const session = createMatchSession('gomoku', draft, render);

const disabled = value => value ? 'disabled' : '';
const opposite = color => color === 'black' ? 'white' : 'black';

function stone(color, last = false) {
  return `<span aria-hidden="true" class="stone ${color}${last ? ' last' : ''}"></span>`;
}

function choices(key, label, options) {
  const { busy } = session.state;
  const buttons = options.map(([value, text]) => `
    <button data-config="${key}" data-value="${value}" aria-pressed="${draft[key] === value}" ${disabled(busy)}>${text}</button>`);
  return `<fieldset><legend>${label}</legend><div class="choices">${buttons.join('')}</div></fieldset>`;
}

function picker(key, label, options) {
  const { busy } = session.state;
  const items = options.map(([value, text]) => `<option value="${html(value)}" ${draft[key] === value ? 'selected' : ''}>${html(text)}</option>`);
  return `<label class="select-field"><span>${label}</span><span class="select-wrap">
    <select data-config="${key}" ${disabled(busy || !options.length)}>${items.join('') || '<option>—</option>'}</select>
  </span></label>`;
}

function board(size, preview) {
  const { match, busy, error } = session.state;
  const edge = 50 / size;
  const lines = Array.from({ length: size }, (_, index) => {
    const point = edge + index * 100 / size;
    return `<path d="M ${point} ${edge} V ${100 - edge} M ${edge} ${point} H ${100 - edge}"/>`;
  });
  const grid = `<svg class="grid-lines" viewBox="0 0 100 100" aria-hidden="true">${lines.join('')}</svg>`;
  if (preview) return `<div class="board preview" aria-hidden="true">${grid}</div>`;

  const cells = new Map(match.moves.map((move, index) => [move.row * size + move.col, { ...move, index }]));
  const winning = new Set(match.winning.map(point => point.row * size + point.col));
  const middle = (size - 1) / 2;
  const star = size === 9 ? 2 : 3;
  const locked = busy || match.thinking || match.result || match.error || error;
  const points = Array.from({ length: size ** 2 }, (_, index) => {
    const row = Math.floor(index / size);
    const col = index % size;
    const move = cells.get(index);
    const isStar = row === middle && col === middle
      || [star, size - 1 - star].includes(row) && [star, size - 1 - star].includes(col);
    const last = move?.index === match.moves.length - 1;
    const label = String.fromCharCode(65 + col) + (size - row)
      + (move ? (move.color === 'black' ? ' 黑棋' : ' 白棋') : '') + (last ? ' 最近一步' : '');
    const classes = ['intersection', isStar && 'star', winning.has(index) && 'winning'].filter(Boolean);
    return `<button class="${classes.join(' ')}" data-row="${row}" data-col="${col}" aria-label="${label}" ${disabled(locked || move)}>
      ${move ? stone(move.color, last) : '<span class="ghost"></span>'}
    </button>`;
  });
  const human = match.humanColor === 'black' ? '#35402f' : '#fff';
  return `<div class="board" style="--size:${size};--human:${human}" role="group" aria-label="五子棋棋盘">
    ${grid}<div class="intersections">${points.join('')}</div>
  </div>`;
}

function setupView() {
  const { models, match, busy, error, actionError } = session.state;
  const model = models.find(item => item.id === draft.model);
  const currentEfforts = model?.efforts ?? [];
  return `<div class="setup-stage">
    ${board(draft.size, true)}
    <section class="setup-sheet" aria-labelledby="setup-title">
      <h2 id="setup-title">对局配置</h2>
      ${choices('size', '棋盘尺寸', [[9, '9 × 9'], [13, '13 × 13'], [15, '15 × 15']])}
      ${picker('model', '对手模型', models.map(item => [item.id, item.name]))}
      ${picker('effort', '思考强度', currentEfforts.map(value => [value, effortOption(value)]))}
      ${choices('first', '先手', [['you', '我先下'], ['ai', 'AI 先下'], ['random', '随机']])}
      <p class="match-error" role="status">${html(error || actionError)}</p>
      ${error && !models.length
        ? '<button class="primary" data-action="catalog">重试加载模型</button>'
        : `<button class="primary" data-action="start" ${disabled(busy || !model)}>${busy ? (model ? '请稍候' : '正在加载模型') : '开始对局'}<span aria-hidden="true">→</span></button>`}
      ${error && models.length ? '<button class="return-match" data-action="catalog">刷新模型列表</button>' : ''}
      ${match ? `<button class="return-match" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
    </section>
  </div>`;
}

function playView(result) {
  const { match, busy, error, actionError } = session.state;
  const { humanColor, thinking, config } = match;
  const aiColor = opposite(humanColor);
  const message = error || match.error;
  return matchLayout({
    opponent: matchPlayer('AI', colors[aiColor], stone(aiColor), thinking),
    player: matchPlayer('你', colors[humanColor], stone(humanColor), !thinking && !result && !message),
    board: board(config.size, false),
    status: result?.status ?? (message ? '对局暂未更新' : thinking ? 'AI 正在思考' : '轮到你落子'),
    notice: matchFeedback(error, match.error, busy, actionError),
  });
}

function render(focus) {
  const { match, busy, setup } = session.state;
  const result = match?.result ? (match.result === 'draw'
    ? matchResult(null, match.humanColor, '棋盘已满')
    : matchResult(match.result, match.humanColor, '五子连珠')) : null;
  main.innerHTML = `<div class="game-table ${setup ? '' : 'playing'}">
    ${gameToolbar(setup ? null : match, busy)}
    ${setup ? `<div class="table-heading"><h1 tabindex="-1">五子棋</h1></div>${setupView()}` : playView(result)}
  </div>`;
  if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
  showResult(match, result, busy);
}

main.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-config]');
  if (!select || session.state.busy) return;
  const key = select.dataset.config;
  draft[key] = select.value;
  selectModel(session.state.models, draft);
  render();
  main.querySelector(`select[data-config="${key}"]`).focus({ preventScroll: true });
});

main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled || session.state.busy) return;
  const { config: key, value, action, row, col } = button.dataset;
  if (key) {
    draft[key] = key === 'size' ? Number(value) : value;
    render();
    main.querySelector(`button[data-config="${key}"][data-value="${value}"]`).focus({ preventScroll: true });
    return;
  }
  if (action === 'catalog') return session.loadModels();
  if (action === 'start') return session.start();
  if (row !== undefined) session.act('move', { row: Number(row), col: Number(col) });
  else if (action) session.act(action);
});

session.loadModels();
