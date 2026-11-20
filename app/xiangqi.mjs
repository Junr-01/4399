import { effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { createResultDialog, gameToolbar, matchFeedback, matchLayout, matchPlayer, matchResult } from './match-ui.mjs';
import { createMatchSession } from './match-session.mjs';
import { initialPlacement, parseBoard } from '../shared/xiangqi-position.mjs';

const main = document.querySelector('#xiangqi');
const showResult = createResultDialog(main);
const previewBoard = parseBoard(initialPlacement);
const names = { red: '红方', black: '黑方' };
const sides = { red: '执红', black: '执黑', random: '随机' };
const glyphs = {
  red: { k: '帥', a: '仕', e: '相', h: '馬', r: '車', c: '炮', p: '兵' },
  black: { k: '將', a: '士', e: '象', h: '馬', r: '車', c: '砲', p: '卒' },
};
const draft = { model: '', effort: '', side: 'red' };
let selected = null;
const session = createMatchSession('xiangqi', draft, render, () => {
  selected = null;
});
const marker = side => `<span class="side-mark ${side}" aria-hidden="true"></span>`;
const disabled = when => when ? 'disabled' : '';

const lines = [
  ...Array.from({ length: 10 }, (_, row) => `<span class="rank" style="top:${row / 9 * 100}%"></span>`),
  ...Array.from({ length: 9 }, (_, col) => `<span class="file ${col === 0 || col === 8 ? 'edge' : ''}" style="left:${col / 8 * 100}%"></span>`),
  ...[0, 7].map(row => `<div class="palace" style="top:${row / 9 * 100}%"></div>`),
].join('');

function board(preview = false) {
  const { match, busy, error } = session.state;
  const flipped = !preview && match.humanSide === 'black';
  const grid = preview ? previewBoard : match.board;
  const legal = preview || busy || error ? [] : match.legal;
  const origins = new Set(legal.map(move => move.from));
  const targets = new Set(legal.filter(move => move.from === selected).map(move => move.to));
  const last = preview ? null : match.lastMove;
  const cells = grid.map((cell, index) => {
    const target = targets.has(index);
    const from = last?.from === index;
    const to = last?.to === index;
    if (!cell && !target && !from && !to) return '';
    const display = flipped ? 89 - index : index;
    const style = `left:${display % 9 / 8 * 100}%;top:${Math.floor(display / 9) / 9 * 100}%`;
    const checked = !preview && match.check && cell?.type === 'k' && cell.side === match.side;
    const classes = ['point', cell?.side, target && (cell ? 'capture' : 'destination'),
      !cell && 'empty', from && 'last-from', to && 'last-to',
      !preview && selected === index && 'selected', checked && 'in-check'].filter(Boolean).join(' ');
    const symbol = cell ? glyphs[cell.side][cell.type] : '';
    const coords = String.fromCharCode(97 + index % 9) + (10 - Math.floor(index / 9));
    const location = cell ? `${target ? '吃' : ''}${names[cell.side]}${symbol} ${coords}` : target ? `移至 ${coords}` : coords;
    const label = location + (from ? ' 最近一步起点' : to ? ' 最近一步落点' : '');
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
  return `<div class="xiangqi-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="中国象棋棋盘"'}>
    <div class="board-plane"><div aria-hidden="true">${lines}${labels('top', top)}${labels('bottom', bottom)}
      <div class="river"><span>楚河</span><span>漢界</span></div></div>${cells}
    </div>
  </div>`;
}

function picker(key, label, choices) {
  const { busy } = session.state;
  const options = choices.map(([value, text]) =>
    `<option value="${html(value)}" ${draft[key] === value ? 'selected' : ''}>${html(text)}</option>`).join('');
  return `<label class="select-field"><span>${label}</span><span class="select-wrap">
    <select name="${key}" ${disabled(busy || !choices.length)}>${options || '<option>—</option>'}</select>
  </span></label>`;
}

function setupView() {
  const { models, match, busy, error, actionError } = session.state;
  const model = models.find(entry => entry.id === draft.model);
  const efforts = model?.efforts.map(value => [value, effortOption(value)]) ?? [];
  return `<section class="overlay">
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
      <p class="match-notice" role="status">${html(error || actionError)}</p>
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

function playView(result) {
  const { match, busy, error, actionError } = session.state;
  const { humanSide, side, aiTurn, thinking, check, adjudication } = match;
  const humanTurn = !aiTurn && humanSide === side;
  const opponent = humanSide === 'red' ? 'black' : 'red';
  const turn = error || match.error ? '对局暂未更新' : thinking ? 'AI 正在思考' : humanTurn ? '轮到你走棋' : '轮到 AI';
  let ruleNotice = '';
  if (!result && adjudication) {
    ruleNotice = adjudication.side
      ? `${reasons[adjudication.reason]} · ${names[adjudication.side]}须在 ${adjudication.remaining} 回合内变着`
      : `双方继续重复 ${adjudication.remaining} 回合将判和`;
    if (adjudication.requiresQuiet) ruleNotice += '，其中一着须为闲';
  }
  const claimDraw = !result && match.canClaimDraw;
  const rules = ruleNotice || claimDraw ? `<div class="match-feedback">
    ${ruleNotice ? `<p role="status">${ruleNotice}</p>` : ''}
    ${claimDraw ? `<button class="match-button" type="button" data-action="claim-draw" ${disabled(busy)}>申请和棋</button>` : ''}
  </div>` : '';
  return matchLayout({
    opponent: matchPlayer('AI', names[opponent], marker(opponent), !result && !humanTurn),
    player: matchPlayer('你', names[humanSide], marker(humanSide), !result && humanTurn),
    board: board(),
    status: result?.status ?? (check ? `${turn} · ${names[side]}被将军` : turn),
    notice: rules + matchFeedback(error, match.error, busy, actionError),
  });
}

function render(focus) {
  const { match, busy, setup } = session.state;
  const result = match?.result ? matchResult(match.result.winner, match.humanSide, reasons[match.result.reason]) : null;
  main.innerHTML = `<div class="game-shell ${setup ? 'setup-shell' : 'playing'}">
    ${gameToolbar(setup ? null : match, busy)}
    ${setup ? `<div class="game-heading"><h1 tabindex="-1">中国象棋</h1></div>${setupView()}` : playView(result)}
  </div>`;
  if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
  showResult(match, result, busy);
}

main.addEventListener('change', ({ target }) => {
  if (session.state.busy || !['model', 'effort', 'side'].includes(target.name)) return;
  draft[target.name] = target.value;
  if (target.name === 'model') {
    selectModel(session.state.models, draft);
    render('[name="model"]');
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
    if (match.legal.some(move => move.from === selected && move.to === to)) {
      session.act('move', { from: selected, to });
    } else {
      selected = selected === to ? null : to;
      render(`[data-point="${to}"]`);
    }
    return;
  }
  if (action === 'catalog') session.loadModels();
  else if (action) session.act(action);
});

session.loadModels();
