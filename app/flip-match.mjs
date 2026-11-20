import { effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { createResultDialog, gameToolbar, matchFeedback, matchLayout, matchPlayer, matchResult } from './match-ui.mjs';
import { createMatchSession } from './match-session.mjs';

export function mountFlipMatch(main, { id, title, subtitle, setupNote, previewBoard, renderBoard, sideLabel, resultDetail }) {
  const showResult = createResultDialog(main);
  const firstOptions = { human: '我先翻', ai: 'AI 先翻', random: '随机' };
  const disabled = when => when ? 'disabled' : '';
  const draft = { model: '', effort: '', first: 'human' };
  let selected;
  const session = createMatchSession(id, draft, render, () => {
    selected = undefined;
  });

  function picker(name, label, options) {
    const { busy } = session.state;
    return `<label class="setup-field"><span>${label}</span><span class="select-wrap">
      <select name="${name}" ${disabled(busy || !options.length)}>
        ${options.length ? options.map(([value, text]) => `<option value="${html(value)}" ${draft[name] === value ? 'selected' : ''}>${html(text)}</option>`).join('')
          : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
      </select></span></label>`;
  }

  function boardView(preview = false) {
    const { match, busy, error } = session.state;
    const board = match?.board ?? previewBoard;
    const legal = preview || busy || error ? [] : match.legal;
    return renderBoard(board, legal, preview ? null : match.last, preview ? undefined : selected, preview);
  }

  function setupView() {
    const { models, match, busy, error, actionError } = session.state;
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
          <p class="field-note">${setupNote}</p>
        </div>
        <button class="start-match" type="submit" ${disabled(busy || !model)}>开始对局 <span aria-hidden="true">→</span></button>
        ${match ? `<button class="resume-match" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
        ${error || actionError ? `<p class="match-error" role="alert">${html(error || actionError)}</p>
          <button class="match-button" type="button" data-action="catalog" ${disabled(busy)}>${model ? '刷新模型列表' : '重试'}</button>` : ''}
      </form>
    </section>`;
  }

  function player(who) {
    const { match } = session.state;
    const color = match.sides?.[who];
    const mark = `<span class="player-mark ${color ?? 'unassigned'}" aria-hidden="true"></span>`;
    const side = color ? sideLabel(match, color) : '待定阵营';
    return matchPlayer(who === 'human' ? '你' : 'AI', side, mark, !match.result && match.turn === who);
  }

  function turnStatus() {
    const { match, error } = session.state;
    if (error) return '对局暂未更新';
    if (match.turn === 'ai') return match.thinking ? 'AI 正在思考' : '轮到 AI';
    if (!match.sides) return '轮到你翻棋';
    return selected === undefined ? '轮到你行动' : '选择落点';
  }

  function playView(result) {
    const { match, busy, error, actionError } = session.state;
    return matchLayout({
      opponent: player('ai'),
      player: player('human'),
      board: boardView(),
      status: result?.status ?? turnStatus(),
      notice: matchFeedback(error, match.error, busy, actionError),
    });
  }

  function render(focus) {
    const { match, busy, setup: opening } = session.state;
    const result = match?.result ? matchResult(match.result.winner, 'human', resultDetail(match.result)) : null;
    main.innerHTML = `<div class="${id}-shell ${opening ? '' : 'playing'}">
      ${gameToolbar(opening ? null : match, busy)}
      ${opening ? `<div class="flip-heading"><h1 tabindex="-1">${title}${subtitle ? ` <span>${subtitle}</span>` : ''}</h1></div>${setupView()}` : playView(result)}
    </div>`;
    if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
    showResult(match, result, busy);
  }

  main.addEventListener('change', ({ target }) => {
    if (session.state.busy || !['model', 'effort', 'first'].includes(target.name)) return;
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
      const id = Number(point);
      const next = match.legal.find(entry => entry.to === id
        && (entry.action === 'flip' || entry.from === selected));
      if (next) session.act(next.action, next, '.match-status');
      else {
        selected = selected === id ? undefined : id;
        render(`[data-point="${id}"]`);
      }
    } else if (action === 'catalog') session.loadModels('[name="model"]');
    else if (action) session.act(action, undefined, ['undo', 'retry', 'refresh'].includes(action)
      ? '.match-status' : `[data-action="${action}"]`);
  });

  main.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || selected === undefined || session.state.busy) return;
    const point = selected;
    selected = undefined;
    render(`[data-point="${point}"]`);
  });

  session.loadModels();
}
