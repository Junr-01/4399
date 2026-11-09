const main = document.querySelector('#gomoku');
const api = '/api/gomoku';
const efforts = { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '极高', max: '最大', ultra: '超强' };
const draft = { size: 15, first: 'you', model: '', effort: '' };
let models = [];
let match = null;
let setup = true;
let busy = false;
let error = '';
let poll;
let revision = 0;

const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const disabled = value => value ? 'disabled' : '';
const opposite = color => color === 'black' ? 'white' : 'black';

async function request(path, data) {
  const response = await fetch(api + path, data === undefined ? undefined : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok || !body) {
    const failure = new Error(body?.error ?? '游戏服务未返回有效数据，请重启 4399 后重试。');
    failure.status = response.status;
    throw failure;
  }
  return body;
}

async function loadModels() {
  ({ models } = await request('/models'));
  applyModelSelection();
}

function applyModelSelection() {
  const model = models.find(item => item.id === draft.model) ?? models.find(item => item.isDefault) ?? models[0];
  draft.model = model.id;
  if (!model.efforts.includes(draft.effort)) draft.effort = model.defaultEffort;
}

function stone(color, last = false) {
  return `<span aria-hidden="true" class="stone ${color}${last ? ' last' : ''}"></span>`;
}

function choices(key, label, options) {
  const buttons = options.map(([value, text]) => `
    <button data-config="${key}" data-value="${value}" aria-pressed="${draft[key] === value}" ${disabled(busy)}>${text}</button>`);
  return `<fieldset><legend>${label}</legend><div class="choices">${buttons.join('')}</div></fieldset>`;
}

function picker(key, label, options) {
  const items = options.map(([value, text]) => `<option value="${html(value)}" ${draft[key] === value ? 'selected' : ''}>${html(text)}</option>`);
  return `<label class="select-field"><span>${label}</span><span class="select-wrap">
    <select data-config="${key}" ${disabled(busy || !options.length)}>${items.join('') || '<option>—</option>'}</select>
  </span></label>`;
}

function board(size, preview) {
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
    const label = String.fromCharCode(65 + col) + (size - row)
      + (move ? (move.color === 'black' ? ' 黑棋' : ' 白棋') : '');
    const classes = ['intersection', isStar && 'star', move && 'occupied', winning.has(index) && 'winning'].filter(Boolean);
    return `<button class="${classes.join(' ')}" data-row="${row}" data-col="${col}" aria-label="${label}" ${disabled(locked || move)}>
      ${move ? stone(move.color, move.index === match.moves.length - 1) : '<span class="ghost"></span>'}
    </button>`;
  });
  const human = match.humanColor === 'black' ? '#35402f' : '#fff';
  return `<div class="board" style="--size:${size};--human:${human}" role="group" aria-label="五子棋棋盘">
    ${grid}<div class="intersections">${points.join('')}</div>
  </div>`;
}

function setupView() {
  const model = models.find(item => item.id === draft.model);
  const currentEfforts = model?.efforts ?? [];
  return `<div class="setup-stage">
    ${board(draft.size, true)}
    <section class="setup-sheet" aria-labelledby="setup-title">
      <h2 id="setup-title">对局配置</h2>
      ${choices('size', '棋盘尺寸', [[9, '9 × 9'], [13, '13 × 13'], [15, '15 × 15']])}
      ${picker('model', '对手模型', models.map(item => [item.id, item.name]))}
      ${picker('effort', '思考强度', currentEfforts.map(value => [value, efforts[value] ? `${efforts[value]}（${value}）` : value]))}
      ${choices('first', '先手', [['you', '我先下'], ['ai', 'AI 先下'], ['random', '随机']])}
      <p class="match-error" role="status">${html(error)}</p>
      ${error && !models.length
        ? '<button class="primary" data-action="catalog">重试加载模型</button>'
        : `<button class="primary" data-action="start" ${disabled(busy || !model)}>${busy ? (model ? '请稍候' : '正在加载模型') : '开始对局'}<span aria-hidden="true">→</span></button>`}
      ${error && models.length ? '<button class="return-match" data-action="catalog">刷新模型列表</button>' : ''}
      ${match ? `<button class="return-match" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
    </section>
  </div>`;
}

function playView() {
  const status = match.result === 'draw' ? '平局'
    : match.result ? (match.result === match.humanColor ? '你赢了' : 'AI 获胜')
    : match.thinking ? 'AI 正在思考'
    : match.error ? 'AI 落子失败' : '轮到你落子';
  return `<div class="players">
    <span class="player ${!match.thinking && !match.result && !match.error ? 'active' : ''}">${stone(match.humanColor)}你</span>
    <span class="player ${match.thinking ? 'active' : ''}">AI${stone(opposite(match.humanColor))}</span>
  </div>
  ${board(match.config.size, false)}
  <div class="bottom-console">
    <p class="turn-status" role="status"><span class="status-dot ${match.thinking ? 'thinking' : ''}" aria-hidden="true"></span>${status}</p>
    <div class="play-controls">
      ${match.error || error ? `<button class="secondary" data-action="${error ? 'refresh' : 'retry'}" ${disabled(busy)}>重试</button>` : ''}
      <button class="secondary" data-action="undo" ${disabled(busy || !match.canUndo)}><span aria-hidden="true">↶</span> 悔棋</button>
      <button class="secondary" data-action="pause" ${disabled(busy)}><span aria-hidden="true">↻</span> 重新开始</button>
    </div>
  </div>
  <p class="match-error" role="status">${html(error || match.error || '')}</p>`;
}

function render() {
  const config = match?.config;
  const meta = setup ? '' : `<span class="table-meta">${config.size} × ${config.size} · ${html(config.modelName)} · ${html(efforts[config.effort] ?? config.effort)}</span>`;
  main.innerHTML = `<div class="game-table">
    <div class="table-heading"><h1>五子棋</h1>${meta}</div>
    ${setup ? setupView() : playView()}
  </div>`;
}

function watchTurn() {
  clearTimeout(poll);
  if (setup || busy || !match?.thinking || error) return;
  const version = revision;
  const id = match.id;
  poll = setTimeout(async () => {
    try {
      const updated = await request('/matches/' + id);
      if (version !== revision) return;
      applyMatch(updated);
    } catch (failure) {
      if (version !== revision) return;
      showError(failure);
    }
    if (setup || !match.thinking || error) render();
    watchTurn();
  }, 400);
}

function showError(failure) {
  if (failure.status === 404) {
    match = null;
    setup = true;
  }
  error = failure instanceof TypeError ? '无法连接本地游戏服务，请重试。' : failure.message;
}

function applyMatch(updated) {
  const viewChanged = setup !== updated.paused;
  match = updated;
  setup = match.paused;
  if (!viewChanged) return;
  if (setup) {
    const { size, first, model, effort } = match.config;
    Object.assign(draft, { size, first, model, effort });
    applyModelSelection();
  }
  window.scrollTo(0, 0);
}

async function perform(work) {
  if (busy) return;
  busy = true;
  error = '';
  revision++;
  clearTimeout(poll);
  render();
  try { await work(); }
  catch (failure) { showError(failure); }
  finally {
    busy = false;
    render();
    watchTurn();
  }
}

main.addEventListener('change', (event) => {
  const select = event.target.closest('select[data-config]');
  if (!select || busy) return;
  const key = select.dataset.config;
  draft[key] = select.value;
  applyModelSelection();
  render();
  main.querySelector(`select[data-config="${key}"]`).focus({ preventScroll: true });
});

main.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  const { config: key, value, action, row, col } = button.dataset;
  if (key) {
    draft[key] = key === 'size' ? Number(value) : value;
    render();
    main.querySelector(`button[data-config="${key}"][data-value="${value}"]`).focus({ preventScroll: true });
    return;
  }
  if (action === 'catalog') return perform(loadModels);
  if (action === 'start') return perform(async () => {
    applyMatch(await request('/matches', { ...draft, replace: match?.id }));
  });
  perform(async () => {
    const path = '/matches/' + match.id;
    if (action === 'refresh') {
      applyMatch(await request(path));
      return;
    }
    applyMatch(await request(path, row === undefined ? { action } : { action: 'move', row: Number(row), col: Number(col) }));
  });
});

window.addEventListener('pagehide', (event) => {
  if (match && !event.persisted) fetch(api + '/matches/' + match.id, { method: 'DELETE', keepalive: true }).catch(() => {});
});

perform(loadModels);
