import { effortName, effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { lines, points } from './junqi-board.mjs';

const main = document.querySelector('#junqi');
const api = '/api/junqi';
const firstOptions = { human: '我先翻', ai: 'AI 先翻', random: '随机' };
const colorNames = { red: '红方', blue: '蓝方' };
const pieceNames = {
  commander: '司令', general: '军长', division: '师长', brigade: '旅长', regiment: '团长',
  battalion: '营长', company: '连长', platoon: '排长', engineer: '工兵',
  bomb: '炸弹', mine: '地雷', flag: '军旗',
};
const reasons = {
  flag: '夺旗', 'no-action': '败方无着可走', 'quiet-limit': '连续 30 着无翻棋或棋子离场',
};
const disabled = when => when ? 'disabled' : '';
const previewBoard = points.map(({ camp }) => camp ? null : 'dark');

const segment = ({ a, b }) => `M${a.x} ${a.y}L${b.x} ${b.y}`;
const rails = lines.filter(line => line.type === 'rail').map(segment).join('');
const roads = lines.filter(line => line.type === 'road').map(segment).join('');
const boardArt = `<svg class="board-lines" viewBox="0 0 400 539" aria-hidden="true">
  <path class="roads" d="${roads}"/>
  <path class="rail-edge" d="${rails}"/><path class="rail-bed" d="${rails}"/><path class="rail-ties" d="${rails}"/>
  ${points.map(({ x, y, camp, base }) => camp
    ? `<ellipse class="camp-site" cx="${x}" cy="${y}" rx="17" ry="13"/>`
    : `<rect class="${base ? 'base-site' : 'station'}" x="${x - 28}" y="${y - 13}" width="56" height="26" rx="${base ? 4 : 3}"/>`).join('')}
</svg>`;

const draft = { model: '', effort: '', first: 'human' };
let models = [];
let match;
let selected;
let busy = false;
let error = '';
let poll;
let requestEpoch = 0;
let pendingMatch;
let leaving = false;

const isSetup = () => !match || match.paused;

async function request(path, data) {
  const response = await fetch(api + path, data === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const json = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
  if (!response.ok || !json) {
    throw Object.assign(new Error(json?.error ?? '游戏服务未返回有效数据，请重试。'), { status: response.status, snapshot: json?.snapshot });
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
    const { model, effort, first } = updated.config;
    Object.assign(draft, { model, effort, first });
    selectModel(models, draft);
  }
  match = updated;
  selected = undefined;
  if (previous !== isSetup()) window.scrollTo(0, 0);
}

function showError(failure) {
  if (failure.status === 404) {
    match = null;
    selected = undefined;
  }
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
    if (failure.snapshot) applyMatch(failure.snapshot);
    throw failure;
  }
}

function boardView(preview = false) {
  const cells = match?.board ?? previewBoard;
  const legal = preview || busy ? [] : match.legal;
  const flips = new Set(legal.filter(action => action.action === 'flip').map(action => action.to));
  const origins = new Set(legal.filter(action => action.action === 'move').map(action => action.from));
  const targets = new Set(legal.filter(action => action.from === selected && action.action === 'move').map(action => action.to));
  const last = preview ? null : match.last;
  return `<div class="junqi-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="军棋棋盘"'}>
    <div class="board-plot">${boardArt}
      ${points.map(({ id, x, y, row, col, camp, base }) => {
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
        const label = `${target ? piece ? '攻击 ' : '移动至 ' : ''}${row + 1} 行 ${col + 1} 列 ${description}`;
        const classes = ['board-point', (last?.to === id || last?.from === id) && 'last',
          target && 'target', id === selected && !preview && 'selected'].filter(Boolean).join(' ');
        const style = `style="--x:${x / 4}%;--y:${y / 539 * 100}%"`;
        return flips.has(id) || origin || target
          ? `<button class="${classes}" type="button" ${style} data-point="${id}" aria-label="${label}" ${origin ? `aria-pressed="${id === selected}"` : ''}>${tile}</button>`
          : `<span class="${classes}" ${style} ${preview ? '' : `role="img" aria-label="${label}"`}>${tile}</span>`;
      }).join('')}
    </div>
  </div>`;
}

function picker(name, label, options) {
  return `<label class="setup-field"><span>${label}</span><span class="select-wrap">
    <select name="${name}" ${disabled(busy || !options.length)}>
      ${options.length ? options.map(([value, text]) => `<option value="${html(value)}" ${draft[name] === value ? 'selected' : ''}>${html(text)}</option>`).join('')
        : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
    </select></span></label>`;
}

function notice(message, action, label) {
  return message ? `<p class="match-error" role="alert">${html(message)}</p>
    <div class="error-actions"><button type="button" data-action="${action}" ${disabled(busy)}>${label}</button></div>` : '';
}

function setupView() {
  const model = models.find(item => item.id === draft.model);
  return `<section class="setup-stage">${boardView(true)}
    <form class="setup-sheet" aria-labelledby="setup-heading">
      <h2 id="setup-heading">对局设置</h2>
      <div class="setup-fields">
        ${picker('model', '对手模型', models.map(item => [item.id, item.name]))}
        ${picker('effort', '思考强度', (model?.efforts ?? []).map(effort => [effort, effortOption(effort)]))}
        <fieldset ${disabled(busy)}><legend>先手</legend><div class="first-choices">${Object.entries(firstOptions).map(([value, label]) =>
          `<label><input type="radio" name="first" value="${value}" ${draft.first === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}
        </div></fieldset>
      </div>
      <button class="start-match" type="submit" ${disabled(busy || !model)}>开始对局 <span aria-hidden="true">→</span></button>
      ${match ? `<button class="resume-match" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
      ${notice(error, 'catalog', model ? '刷新模型列表' : '重试')}
    </form>
  </section>`;
}

function player(who) {
  const color = match.sides?.[who];
  const last = match.flips[who];
  return `<div class="junqi-player ${!match.result && match.turn === who ? 'active' : ''}">
    <span class="player-mark ${color ?? last ?? ''} ${color ? '' : 'unassigned'}" aria-hidden="true"></span>
    <div class="player-name"><strong>${who === 'human' ? '你' : 'AI'}</strong>
      <span>${color ? colorNames[color] : last ? `上次翻到${colorNames[last][0]}色` : '待定阵营'}</span></div>
    ${color ? `<span class="mine-count">地雷 <b>${match.mines[color]}</b> / 3</span>` : ''}
  </div>`;
}

function turnStatus() {
  if (match.result) {
    const { winner, reason } = match.result;
    const result = winner === 'human' ? '你赢了' : winner === 'ai' ? 'AI 获胜' : '和棋';
    const detail = reason === 'elimination' ? `${winner ? '败方' : '双方'}可移动棋子全灭` : reasons[reason];
    return `${result} · ${detail}`;
  }
  if (match.turn === 'ai') return match.thinking ? 'AI 正在思考' : '轮到 AI';
  if (!match.sides) return '轮到你翻棋';
  return selected === undefined ? '轮到你' : '选择落点';
}

function recentAction() {
  const last = match.last;
  if (!last) return '同一方连续两次翻到同色，确定阵营';
  const who = last.player === 'human' ? '你' : 'AI';
  const { color, type } = last.piece;
  const point = id => `${points[id].row + 1}行${points[id].col + 1}列`;
  const action = last.action === 'flip' ? `翻开${colorNames[color]}${pieceNames[type]}（${point(last.to)}）`
    : `${pieceNames[type]} ${point(last.from)} → ${point(last.to)}`;
  return `${who} ${action}`;
}

function matchView() {
  return `<section class="match-layout">
    ${player('ai')}${boardView()}${player('human')}
    <div class="match-footer">
      <div class="match-status" role="status">
        <p><span class="status-dot ${match.thinking ? 'thinking' : ''}" aria-hidden="true"></span>${turnStatus()}</p>
        <span>${recentAction()}</span>
      </div>
      <div class="match-actions">
        <button type="button" data-action="undo" ${disabled(busy || !match.canUndo)}><span aria-hidden="true">↶</span> 悔棋</button>
        <button type="button" data-action="pause" ${disabled(busy)}><span aria-hidden="true">↻</span> 重新开始</button>
      </div>
    </div>
    ${error ? notice(error, 'refresh', '刷新棋局') : notice(match.error, 'retry', '重试')}
  </section>`;
}

function render(focus) {
  const opening = isSetup();
  const meta = opening ? '' : `<span class="match-meta">${html(match.config.modelName)} · ${html(effortName(match.config.effort))}</span>`;
  main.innerHTML = `<div class="junqi-shell ${opening ? '' : 'playing'}">
    <div class="junqi-heading"><h1 tabindex="-1">军棋 <span>翻棋</span></h1>${meta}</div>
    ${opening ? setupView() : matchView()}
  </div>`;
  if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
}

main.addEventListener('change', ({ target }) => {
  if (busy || !['model', 'effort', 'first'].includes(target.name)) return;
  draft[target.name] = target.value;
  if (target.name === 'model') {
    selectModel(models, draft);
    render('[name="model"]');
  }
});

function releaseMatch(id) {
  if (id) fetch(api + '/matches/' + id, { method: 'DELETE', keepalive: true }).catch(() => {});
}

async function startMatch() {
  const { id } = await request('/reservations', {});
  if (leaving) {
    releaseMatch(id);
    return;
  }

  pendingMatch = id;
  try {
    applyMatch(await request('/matches', { ...draft, id, replace: match?.id }));
  } catch (failure) {
    releaseMatch(id);
    throw failure;
  } finally {
    pendingMatch = undefined;
  }
}

main.addEventListener('submit', event => {
  event.preventDefault();
  if (!models.some(model => model.id === draft.model)) return;
  perform(startMatch);
});

main.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || busy) return;
  const { point, action } = button.dataset;
  if (point !== undefined) {
    const id = Number(point);
    const next = match.legal.find(entry => entry.to === id
      && (entry.action === 'flip' || entry.from === selected));
    if (next) perform(() => update(next.action, next));
    else {
      selected = selected === id ? undefined : id;
      render(`[data-point="${id}"]`);
    }
  } else if (action === 'catalog') perform(loadModels, '[name="model"]');
  else if (action) perform(() => update(action), `[data-action="${action}"]`);
});

main.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || selected === undefined || busy) return;
  const point = selected;
  selected = undefined;
  render(`[data-point="${point}"]`);
});

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  leaving = true;
  releaseMatch(pendingMatch);
  releaseMatch(match?.id);
});

perform(loadModels);
