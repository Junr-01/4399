import { effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { createResultDialog, gameToolbar, matchFeedback, matchLayout, matchPlayer, matchResult } from './match-ui.mjs';
import { createMatchSession } from './match-session.mjs';

const main = document.querySelector('#chess');
const showResult = createResultDialog(main);
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
let selected;
let promotion;
const session = createMatchSession('chess', draft, render, () => {
  selected = undefined;
  promotion = undefined;
});

function board(preview = false) {
  const { match, busy, error } = session.state;
  const flipped = !preview && match?.humanSide === 'black';
  const cells = (preview ? match?.board ?? previewBoard : match.board);
  const coordinates = flipped ? squares.slice().reverse() : squares;
  const legal = preview || busy || error ? [] : match.legal;
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
    const from = square === last?.from;
    const to = square === last?.to;
    const classes = ['chess-square', (Math.floor(index / 8) + index) % 2 && 'dark',
      from && 'last-from', to && 'last-to', square === selected && !preview && 'selected',
      target && 'target', capture && 'capture',
      checked && 'in-check'].filter(Boolean).join(' ');
    const location = piece ? `${colors[sideOf(piece)]}${pieces[piece.toLowerCase()]} ${square}` : target ? `移至 ${square}` : square;
    const label = location + (from ? ' 最近一步起点' : to ? ' 最近一步落点' : '');
    const contents = piece ? glyph(piece.toLowerCase(), sideOf(piece)) : '';
    return target || selectable
      ? `<button class="${classes}" type="button" data-square="${square}" aria-label="${label}" ${selectable ? `aria-pressed="${square === selected}"` : ''}>${contents}</button>`
      : `<span class="${classes}" ${!preview && (piece || from || to) ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${contents}</span>`;
  }).join('');
  const labels = (name, chars) => `<div class="chess-coords ${name}" aria-hidden="true">${Array.from(chars, char => `<span>${char}</span>`).join('')}</div>`;
  return `<div class="chess-board" ${preview ? 'aria-hidden="true"' : 'role="group" aria-label="国际象棋棋盘"'}>
    <div class="chess-squares">${cellsView}</div>
    ${labels('files', flipped ? 'hgfedcba' : files)}${labels('ranks', flipped ? '12345678' : '87654321')}
  </div>`;
}

function picker(name, label, options) {
  const { busy } = session.state;
  return `<label class="select-field"><span>${label}</span><span class="select-wrap"><select name="${name}" ${disabled(busy || !options.length)}>
    ${options.length ? options.map(([value, text]) =>
      `<option value="${html(value)}" ${draft[name] === value ? 'selected' : ''}>${html(text)}</option>`).join('')
      : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
  </select></span></label>`;
}

function setupView() {
  const { models, match, busy, error, actionError } = session.state;
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
    ${error || actionError ? `<p class="match-error" role="alert">${html(error || actionError)}</p>
      <div class="error-actions"><button class="secondary" type="button" data-action="catalog">${model ? '刷新模型列表' : '重试'}</button></div>` : ''}
  </form></section>`;
}

function playView(result) {
  const { match, busy, error, actionError } = session.state;
  const { humanSide, side, check, aiTurn, thinking } = match;
  const aiSide = opposite(humanSide);
  const humanTurn = !aiTurn && humanSide === side;
  const turn = error ? '对局暂未更新' : thinking ? 'AI 正在思考' : humanTurn ? '轮到你走棋' : '轮到 AI';
  return matchLayout({
    opponent: matchPlayer('AI', colors[aiSide], marker(aiSide), !result && !humanTurn),
    player: matchPlayer('你', colors[humanSide], marker(humanSide), !result && humanTurn),
    board: board(),
    status: result?.status ?? (check ? `${turn} · ${colors[side]}被将军` : turn),
    notice: matchFeedback(error, match.error, busy, actionError),
  });
}

function promotionDialog() {
  const { match } = session.state;
  const buttons = promotion.map(({ promotion: type }) =>
    `<button class="secondary promotion-choice" type="button" data-promote="${type}">${glyph(type, match.humanSide)}${pieces[type]}</button>`).join('');
  return `<dialog class="promotion-dialog" aria-labelledby="promotion-title">
    <h2 id="promotion-title">选择升变棋子</h2><div class="promotion-options">${buttons}</div>
    <button class="return-match" type="button" data-action="cancel">返回棋盘</button>
  </dialog>`;
}

function render(focus) {
  const { match, busy, setup } = session.state;
  const result = match?.result ? matchResult(match.result.winner, match.humanSide, reasons[match.result.reason]) : null;
  main.innerHTML = `<div class="game-shell ${setup ? 'setup-shell' : 'playing'}">
    ${gameToolbar(setup ? null : match, busy)}
    ${setup ? `<div class="game-heading"><h1 tabindex="-1">国际象棋</h1></div>${setupView()}` : playView(result)}
    ${promotion ? promotionDialog() : ''}
  </div>`;
  if (promotion) {
    const dialog = main.querySelector('.promotion-dialog');
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      cancelPromotion();
    });
    dialog.showModal();
  } else {
    if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
    showResult(match, result, busy);
  }
}

function cancelPromotion() {
  const destination = promotion[0].to;
  promotion = undefined;
  render(`[data-square="${destination}"]`);
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

function play(move) {
  promotion = undefined;
  session.act('move', move);
}

main.addEventListener('click', event => {
  const { match, busy } = session.state;
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
  else if (action === 'catalog') session.loadModels('[name="model"]');
  else if (action) session.act(action, undefined, `[data-action="${action}"]`);
});

session.loadModels();
