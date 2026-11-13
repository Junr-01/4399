import { effortName, effortOption, escapeHtml as html, selectModel } from './game-models.mjs';

const main = document.querySelector('#chess');
const api = '/api/chess';
const colors = { white: '白方', black: '黑方' };
const choices = { white: '执白', black: '执黑', random: '随机' };
const pieces = { k: '王', q: '后', r: '车', b: '象', n: '马', p: '兵' };
const reasons = {
  checkmate: '将死', stalemate: '逼和', repetition: '三次重复局面',
  'fifty-move': '50 着规则', 'dead-position': '死局',
};
const opposite = side => side === 'white' ? 'black' : 'white';
const sideOf = piece => piece === piece.toUpperCase() ? 'white' : 'black';
const marker = side => `<span class="side-mark ${side}" aria-hidden="true"></span>`;
const glyph = (type, side) => `<svg class="chess-piece ${side}" viewBox="0 0 48 48" aria-hidden="true"><use href="#piece-${type}"/></svg>`;
const disabled = when => when ? 'disabled' : '';

const files = 'abcdefgh';
const squares = Array.from({ length: 64 }, (_, index) => files[index % 8] + (8 - Math.floor(index / 8)));
const previewBoard = Array.from(['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'].join(''))
  .map(piece => piece === '.' ? null : piece);

const draft = { model: '', effort: '', side: 'white' };
let models = [];
let match;
let selected;
let promotion;
let busy = false;
let error = '';
let poll;
let requestEpoch = 0;

const isSetup = () => !match || match.paused;

async function request(path, data) {
  const response = await fetch(api + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok || !json) {
    throw Object.assign(new Error(json?.error ?? '游戏服务未返回有效数据，请重试。'), { status: response.status });
  }
  return json;
}

async function loadModels() {
  ({ models } = await request('/models'));
  selectModel(models, draft);
}

function applyMatch(updated) {
  const previous = isSetup();
  if (updated.paused && !match?.paused) {
    const { model, effort, side } = updated.config;
    Object.assign(draft, { model, effort, side });
    selectModel(models, draft);
  }
  match = updated;
  selected = undefined;
  promotion = undefined;
  if (previous !== isSetup()) window.scrollTo(0, 0);
}

function showError(failure) {
  if (failure.status === 404) match = null;
  error = failure instanceof TypeError ? '无法连接本地游戏服务，请重试。' : failure.message;
}

function watchTurn() {
  clearTimeout(poll);
  if (isSetup() || busy || error || !match.thinking) return;
  const epoch = requestEpoch;
  const id = match.id;
  poll = setTimeout(async () => {
    try {
      const updated = await request('/matches/' + id);
      if (epoch !== requestEpoch) return;
      applyMatch(updated);
    } catch (failure) {
      if (epoch !== requestEpoch) return;
      showError(failure);
    }
    if (!match?.thinking || error) render();
    watchTurn();
  }, 400);
}

async function perform(work, focus) {
  if (busy) return;
  const previous = isSetup();
  busy = true;
  error = '';
  requestEpoch++;
  clearTimeout(poll);
  render();
  try { await work(); }
  catch (failure) { showError(failure); }
  finally {
    busy = false;
    render(previous !== isSetup() ? 'h1' : focus);
    watchTurn();
  }
}

async function update(action, fields) {
  const path = '/matches/' + match.id;
  try {
    applyMatch(await request(path, action === 'refresh' ? undefined : { action, revision: match.revision, ...fields }));
  } catch (failure) {
    if (failure.status === 409) applyMatch(await request(path));
    throw failure;
  }
}

function board(preview = false) {
  const flipped = !preview && match?.humanSide === 'black';
  const cells = (preview ? match?.board ?? previewBoard : match.board);
  const coordinates = flipped ? squares.slice().reverse() : squares;
  const legal = preview || busy ? [] : match.legal;
  const targets = new Set(legal.filter(move => move.from === selected).map(move => move.to));
  const origins = new Set(legal.map(move => move.from));
  const selectedPiece = cells[squares.indexOf(selected)]?.toLowerCase();
  const last = preview ? null : match.lastMove;
  const cellsView = coordinates.map((square, index) => {
    const piece = cells[flipped ? 63 - index : index];
    const target = targets.has(square);
    const selectable = origins.has(square);
    const capture = target && (piece || (selectedPiece === 'p' && square[0] !== selected[0]));
    const checked = !preview && match.check && piece === (match.side === 'white' ? 'K' : 'k');
    const classes = ['chess-square', (Math.floor(index / 8) + index) % 2 && 'dark',
      (square === last?.from || square === last?.to) && 'last', square === selected && !preview && 'selected',
      target && 'target', capture && 'capture',
      checked && 'in-check'].filter(Boolean).join(' ');
    const label = piece ? `${colors[sideOf(piece)]}${pieces[piece.toLowerCase()]} ${square}` : `移至 ${square}`;
    const contents = piece ? glyph(piece.toLowerCase(), sideOf(piece)) : '';
    return target || selectable
      ? `<button class="${classes}" type="button" data-square="${square}" aria-label="${label}" ${selectable ? `aria-pressed="${square === selected}"` : ''}>${contents}</button>`
      : `<span class="${classes}" ${!preview && piece ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${contents}</span>`;
  }).join('');
  const labels = (name, chars) => `<div class="chess-coords ${name}" aria-hidden="true">${Array.from(chars, char => `<span>${char}</span>`).join('')}</div>`;
  return `<div class="chess-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="国际象棋棋盘"'}>
    <div class="chess-squares">${cellsView}</div>
    ${labels('files', flipped ? 'hgfedcba' : files)}${labels('ranks', flipped ? '12345678' : '87654321')}
  </div>`;
}

function picker(name, label, options) {
  return `<label class="select-field"><span>${label}</span><span class="select-wrap"><select name="${name}" ${disabled(busy || !options.length)}>
    ${options.length ? options.map(([value, text]) =>
      `<option value="${html(value)}" ${draft[name] === value ? 'selected' : ''}>${html(text)}</option>`).join('')
      : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
  </select></span></label>`;
}

function setupView() {
  const model = models.find(item => item.id === draft.model);
  return `<section class="overlay">${board(true)}<form class="setup-form" aria-labelledby="setup-title">
    <h2 id="setup-title">对局设置</h2>
    <div class="model-fields">
      ${picker('model', '对手模型', models.map(item => [item.id, item.name]))}
      ${picker('effort', '思考强度', (model?.efforts ?? []).map(effort => [effort, effortOption(effort)]))}
    </div>
    <fieldset ${disabled(busy)}><legend>执棋</legend><div class="side-choices">${Object.entries(choices).map(([side, label]) =>
      `<label><input type="radio" name="side" value="${side}" ${draft.side === side ? 'checked' : ''}><span>${marker(side)}${label}</span></label>`).join('')}
    </div><p class="field-note">白方先行</p></fieldset>
    <div class="setup-actions">
      <button class="primary" type="submit" ${disabled(busy || !model)}>开始对局 <span aria-hidden="true">→</span></button>
      ${match ? `<button class="return-match" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
    </div>
    ${error ? `<p class="match-error" role="alert">${html(error)}</p>
      <div class="error-actions"><button class="secondary" type="button" data-action="catalog">${model ? '刷新模型列表' : '重试'}</button></div>` : ''}
  </form></section>`;
}

function player(side, label) {
  const active = !match.result && match.side === side;
  return `<div class="player ${active ? 'active' : ''}">${marker(side)}${label}<span>${colors[side]}</span>
    ${active ? '<i class="turn-dot" aria-hidden="true"></i>' : ''}</div>`;
}

function turnStatus() {
  if (match.result) {
    const { winner, reason } = match.result;
    return `${winner ? winner === match.humanSide ? '你赢了' : 'AI 获胜' : '和棋'} · ${reasons[reason]}`;
  }
  const status = match.side === match.humanSide ? '轮到你走棋' : match.thinking ? 'AI 正在思考' : '轮到 AI';
  return match.check ? `${status} · ${colors[match.side]}被将军` : status;
}

function playView() {
  const last = match.lastMove;
  const notice = error || match.error;
  return `<section>
    <div class="players">${player(opposite(match.humanSide), 'AI')}${player(match.humanSide, '你')}</div>
    ${board()}
    <div class="match-controls">
      <div class="status-line"><p class="turn-status" role="status">${turnStatus()}</p>
        ${last ? `<p class="move-summary">上一着 ${last.from} → ${last.to}${last.promotion ? ` · 升变为${pieces[last.promotion]}` : ''}</p>` : ''}</div>
      <div class="play-actions">
        <button class="secondary" type="button" data-action="undo" ${disabled(busy || !match.canUndo)}>↶ 悔棋</button>
        <button class="secondary" type="button" data-action="pause" ${disabled(busy)}>↻ 重新开始</button>
      </div>
    </div>
    ${notice ? `<p class="match-error" role="alert">${html(notice)}</p>
      <div class="error-actions"><button class="secondary" type="button" data-action="${error ? 'refresh' : 'retry'}">${error ? '刷新棋局' : '重试'}</button></div>` : ''}
  </section>`;
}

function promotionDialog() {
  const buttons = promotion.map(({ promotion: type }) =>
    `<button class="secondary promotion-choice" type="button" data-promote="${type}">${glyph(type, match.humanSide)}${pieces[type]}</button>`).join('');
  return `<dialog class="promotion-dialog" aria-labelledby="promotion-title">
    <h2 id="promotion-title">选择升变棋子</h2><div class="promotion-options">${buttons}</div>
    <button class="return-match" type="button" data-action="cancel">返回棋盘</button>
  </dialog>`;
}

function render(focus) {
  const meta = isSetup() ? '' : `<span class="match-model">${html(match.config.modelName)} · ${html(effortName(match.config.effort))}</span>`;
  main.innerHTML = `<div class="game-shell ${isSetup() ? 'setup-shell' : 'playing'}">
    <div class="game-heading"><h1 tabindex="-1">国际象棋</h1>${meta}</div>
    ${isSetup() ? setupView() : playView()}${promotion ? promotionDialog() : ''}
  </div>`;
  if (promotion) {
    const dialog = main.querySelector('dialog');
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancelPromotion();
    });
    dialog.showModal();
  } else if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
}

function cancelPromotion() {
  const destination = promotion[0].to;
  promotion = undefined;
  render(`[data-square="${destination}"]`);
}

main.addEventListener('change', ({ target }) => {
  if (busy || !['model', 'effort', 'side'].includes(target.name)) return;
  draft[target.name] = target.value;
  if (target.name === 'model') {
    selectModel(models, draft);
    render('[name="model"]');
  }
});

main.addEventListener('submit', event => {
  event.preventDefault();
  if (!models.some(model => model.id === draft.model)) return;
  perform(async () => applyMatch(await request('/matches', { ...draft, replace: match?.id })));
});

function play(move) {
  promotion = undefined;
  perform(() => update('move', move));
}

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  const { square, action, promote } = button.dataset;
  if (square) {
    const moves = match.legal.filter(move => move.from === selected && move.to === square);
    if (moves.length === 1) play(moves[0]);
    else if (moves.length) {
      promotion = ['q', 'r', 'b', 'n'].map(type => moves.find(move => move.promotion === type)).filter(Boolean);
      render();
    } else {
      selected = selected === square ? undefined : square;
      render(`[data-square="${square}"]`);
    }
  } else if (promote && promotion) play(promotion.find(move => move.promotion === promote));
  else if (action === 'cancel') cancelPromotion();
  else if (action === 'catalog') perform(loadModels, '[name="model"]');
  else if (action) perform(() => update(action), `[data-action="${action}"]`);
});

window.addEventListener('pagehide', event => {
  if (match && !event.persisted) fetch(api + '/matches/' + match.id, { method: 'DELETE', keepalive: true }).catch(() => {});
});

perform(loadModels);
