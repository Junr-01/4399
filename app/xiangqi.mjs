import { effortName, effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { initialPlacement, parseBoard } from './xiangqi-position.mjs';

const main = document.querySelector('#xiangqi');
const api = '/api/xiangqi';
const previewBoard = parseBoard(initialPlacement);
const names = { red: '红方', black: '黑方' };
const sides = { red: '执红', black: '执黑', random: '随机' };
const glyphs = {
  red: { k: '帥', a: '仕', e: '相', h: '馬', r: '車', c: '炮', p: '兵' },
  black: { k: '將', a: '士', e: '象', h: '馬', r: '車', c: '砲', p: '卒' },
};
const draft = { model: '', effort: '', side: 'red' };
let models = [];
let match;
let selected = null;
let busy = false;
let error = '';
let poll;
let requestEpoch = 0;

const isSetup = () => !match || match.paused;
const marker = side => `<span class="side-mark ${side}" aria-hidden="true"></span>`;
const disabled = when => when ? 'disabled' : '';

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

function showError(failure) {
  if (failure.status === 404) match = null;
  error = failure instanceof TypeError ? '无法连接本地游戏服务，请重试。' : failure.message;
}

function applyMatch(updated) {
  const previous = isSetup();
  const resumed = match?.paused;
  match = updated;
  selected = null;
  if (match.paused && !resumed) {
    const { model, effort, side } = match.config;
    Object.assign(draft, { model, effort, side });
    selectModel(models, draft);
  }
  if (previous !== isSetup()) window.scrollTo(0, 0);
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

async function perform(work) {
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
    render(previous !== isSetup() ? 'h1' : undefined);
    watchTurn();
  }
}

const lines = [
  ...Array.from({ length: 10 }, (_, row) => `<span class="rank" style="top:${row / 9 * 100}%"></span>`),
  ...Array.from({ length: 9 }, (_, col) => `<span class="file ${col === 0 || col === 8 ? 'edge' : ''}" style="left:${col / 8 * 100}%"></span>`),
  ...[0, 7].map(row => `<div class="palace" style="top:${row / 9 * 100}%"></div>`),
].join('');

function board(preview = false) {
  const flipped = !preview && match.humanSide === 'black';
  const grid = preview ? previewBoard : match.board;
  const legal = preview || busy || error ? [] : match.legal;
  const origins = new Set(legal.map(move => move.from));
  const targets = new Set(legal.filter(move => move.from === selected).map(move => move.to));
  const cells = grid.map((cell, index) => {
    const target = targets.has(index);
    if (!cell && !target) return '';
    const display = flipped ? 89 - index : index;
    const style = `left:${display % 9 / 8 * 100}%;top:${Math.floor(display / 9) / 9 * 100}%`;
    const last = !preview && match.lastMove?.to === index;
    const checked = !preview && match.check && cell?.type === 'k' && cell.side === match.side;
    const classes = ['point', cell?.side, target && (cell ? 'capture' : 'destination'),
      last && 'last', !preview && selected === index && 'selected', checked && 'in-check'].filter(Boolean).join(' ');
    const symbol = cell ? glyphs[cell.side][cell.type] : '';
    const coords = String.fromCharCode(97 + index % 9) + (10 - Math.floor(index / 9));
    const label = target ? (cell ? `吃${names[cell.side]}${symbol} ${coords}` : `移至 ${coords}`)
      : `${names[cell.side]}${symbol} ${coords}`;
    if (origins.has(index) || target) {
      return `<button class="${classes}" style="${style}" type="button" data-point="${index}" aria-label="${label}"
        ${target ? '' : `aria-pressed="${selected === index}"`}>${symbol}</button>`;
    }
    return `<span class="${classes}" style="${style}" role="img" aria-label="${label}">${symbol}</span>`;
  }).join('');
  const top = flipped ? '一二三四五六七八九' : '123456789';
  const bottom = flipped ? '987654321' : '九八七六五四三二一';
  const labels = (where, numbers) => `<div class="files-labels ${where}" aria-hidden="true">${Array.from(numbers, (label, col) =>
    `<span style="left:${col / 8 * 100}%">${label}</span>`).join('')}</div>`;
  return `<div class="xiangqi-board ${preview ? 'preview' : ''}" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="中国象棋棋盘"'}>
    <div class="board-plane"><div aria-hidden="true">${lines}${labels('top', top)}${labels('bottom', bottom)}
      <div class="river"><span>楚河</span><span>漢界</span></div></div>${cells}
    </div>
  </div>`;
}

function picker(key, label, choices) {
  const options = choices.map(([value, text]) =>
    `<option value="${html(value)}" ${draft[key] === value ? 'selected' : ''}>${html(text)}</option>`).join('');
  return `<label class="select-field"><span>${label}</span><span class="select-wrap">
    <select name="${key}" ${disabled(busy || !choices.length)}>${options || '<option>—</option>'}</select>
  </span></label>`;
}

function setupView() {
  const model = models.find(entry => entry.id === draft.model);
  const efforts = model?.efforts.map(value => [value, effortOption(value)]) ?? [];
  return `<section class="setup-layout overlay">
    ${board(true)}
    <form class="setup-form" aria-labelledby="setup-title">
      <h2 id="setup-title">对局设置</h2>
      <div class="model-fields">
        ${picker('model', '对手模型', models.map(entry => [entry.id, entry.name]))}
        ${picker('effort', '思考强度', efforts)}
      </div>
      <fieldset><legend>执棋</legend><div class="side-choices">
        ${Object.entries(sides).map(([side, label]) =>
          `<label><input type="radio" name="side" value="${side}" ${disabled(busy)} ${draft.side === side ? 'checked' : ''}><span>${marker(side)}${label}</span></label>`).join('')}
      </div><p class="field-note">红方先行</p></fieldset>
      <p class="match-notice" role="status">${html(error)}</p>
      <div class="setup-actions">
        ${error && !model ? `<button class="primary" type="button" data-action="catalog" ${disabled(busy)}>重试加载模型</button>`
          : `<button class="primary" type="submit" ${disabled(busy || !model)}>${busy ? (model ? '请稍候' : '正在加载模型') : '开始对局'} <span aria-hidden="true">→</span></button>`}
        ${error && model ? `<button class="return-match" type="button" data-action="catalog" ${disabled(busy)}>刷新模型列表</button>` : ''}
        ${match ? `<button class="return-match" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
      </div>
    </form>
  </section>`;
}

const reasons = {
  checkmate: '将死', stalemate: '困毙', 'perpetual-check': '单方长将',
  'failure-to-vary': '应变着而未变', repetition: '重复局面',
  'insufficient-material': '双方均无取胜可能', 'no-capture': '自然限着',
  'perpetual-mate-threat': '长杀', 'perpetual-chase': '长捉', 'alternating-threats': '循环进攻',
};

function playView() {
  const { humanSide, side, result, thinking, check, adjudication } = match;
  const humanTurn = humanSide === side;
  const opponent = humanSide === 'red' ? 'black' : 'red';
  const winText = result?.winner ? (result.winner === humanSide ? '你赢了' : 'AI 获胜') : '和棋';
  const status = result ? `${winText} · ${reasons[result.reason]}`
    : match.error ? 'AI 走棋失败' : thinking ? 'AI 正在思考' : humanTurn ? '轮到你走棋' : '等待 AI';
  let ruleNotice = '';
  if (!result && adjudication) {
    ruleNotice = adjudication.side
      ? `${reasons[adjudication.reason]} · ${names[adjudication.side]}须在 ${adjudication.remaining} 回合内变着`
      : `双方继续重复 ${adjudication.remaining} 回合将判和`;
    if (adjudication.requiresQuiet) ruleNotice += '，其中一着须为闲';
  }
  return `<section class="match-layout">
    <div class="players">
      <div class="player ${!result && !humanTurn ? 'active' : ''}">${marker(opponent)}AI <span>${names[opponent]}</span></div>
      <div class="player ${!result && humanTurn ? 'active' : ''}">${marker(humanSide)}你 <span>${names[humanSide]}</span></div>
    </div>
    ${board()}
    <div class="match-controls">
      <p class="turn-status" role="status">${status}${!result && check ? ` · ${names[side]}被将军` : ''}</p>
      <div class="play-actions">
        ${match.canClaimDraw ? `<button class="secondary" data-action="claim-draw" ${disabled(busy)}>申请和棋</button>` : ''}
        ${error || match.error ? `<button class="secondary" data-action="${error ? 'refresh' : 'retry'}" ${disabled(busy)}>重试</button>` : ''}
        <button class="secondary" data-action="undo" ${disabled(busy || !match.canUndo)}>↶ 悔棋</button>
        <button class="secondary" data-action="pause" ${disabled(busy)}>↻ 重新开始</button>
      </div>
    </div>
    <p class="match-notice" role="status">${ruleNotice}</p>
    <p class="match-notice" role="status">${html(error || match.error || '')}</p>
  </section>`;
}

function render(focus) {
  const setup = isSetup();
  const meta = setup ? '' : `<span class="match-model">${html(match.config.modelName)} · ${html(effortName(match.config.effort))}</span>`;
  main.innerHTML = `<div class="game-shell ${setup ? 'setup-shell' : 'playing'}">
    <div class="game-heading"><h1 tabindex="-1">中国象棋</h1>${meta}</div>${setup ? setupView() : playView()}
  </div>`;
  if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
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

function act(action, fields = {}) {
  const path = '/matches/' + match.id;
  perform(async () => {
    const input = action === 'refresh' ? undefined : { action, revision: match.revision, ...fields };
    applyMatch(await request(path, input));
  });
}

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  const { point, action } = button.dataset;
  if (point !== undefined) {
    const to = Number(point);
    if (match.legal.some(move => move.from === selected && move.to === to)) {
      act('move', { from: selected, to });
    } else {
      selected = selected === to ? null : to;
      render(`[data-point="${to}"]`);
    }
    return;
  }
  if (action === 'catalog') perform(loadModels);
  else if (action) act(action);
});

window.addEventListener('pagehide', event => {
  if (match && !event.persisted) fetch(api + '/matches/' + match.id, { method: 'DELETE', keepalive: true }).catch(() => {});
});

perform(loadModels);
