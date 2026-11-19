import { effortOption, escapeHtml as html, selectModel } from './game-models.mjs';
import { createResultDialog, gameToolbar, matchFeedback, matchLayout, matchPlayer, matchResult } from './match-ui.mjs';

export function mountFlipMatch(main, { id, title, subtitle, setupNote, previewBoard, renderBoard, sideLabel, resultDetail }) {
  const api = '/api/' + id;
  const showResult = createResultDialog(main);
  const firstOptions = { human: '我先翻', ai: 'AI 先翻', random: '随机' };
  const disabled = when => when ? 'disabled' : '';
  const draft = { model: '', effort: '', first: 'human' };
  let models = [];
  let match;
  let selected;
  let busy = false;
  let error = '';
  let actionError = '';
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
      const revision = match.revision;
      try {
        const updated = await request('/matches/' + id);
        if (epoch !== requestEpoch) return;
        applyMatch(updated);
      } catch (failure) {
        if (epoch !== requestEpoch) return;
        showError(failure);
      }
      if (!match?.thinking || match.revision !== revision || error) {
        const action = document.activeElement?.closest('.game-toolbar button')?.dataset.action;
        const status = document.activeElement?.matches('.match-status');
        const fallback = '.match-status, h1';
        render(action ? `.game-toolbar button[data-action="${action}"]:enabled, ${fallback}` : status ? fallback : undefined);
      }
      watchTurn();
    }, 400);
  }

  async function perform(work, focus) {
    if (busy) return;
    const previous = isSetup();
    busy = true;
    error = '';
    actionError = '';
    requestEpoch++;
    clearTimeout(poll);
    render();
    try { await work(); }
    catch (failure) {
      if (failure.snapshot) {
        applyMatch(failure.snapshot);
        actionError = failure.message;
      } else showError(failure);
    }
    finally {
      busy = false;
      render(previous !== isSetup() ? (isSetup() ? 'h1' : '.match-status') : focus);
      watchTurn();
    }
  }

  async function update(action, fields) {
    const path = '/matches/' + match.id;
    applyMatch(await request(path, action === 'refresh' ? undefined : { action, revision: match.revision, ...fields }));
  }

  function picker(name, label, options) {
    return `<label class="setup-field"><span>${label}</span><span class="select-wrap">
      <select name="${name}" ${disabled(busy || !options.length)}>
        ${options.length ? options.map(([value, text]) => `<option value="${html(value)}" ${draft[name] === value ? 'selected' : ''}>${html(text)}</option>`).join('')
          : `<option>${busy ? '正在读取…' : '暂无可用选项'}</option>`}
      </select></span></label>`;
  }

  function boardView(preview = false) {
    const board = match?.board ?? previewBoard;
    const legal = preview || busy ? [] : match.legal;
    return renderBoard(board, legal, preview ? null : match.last, preview ? undefined : selected, preview);
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
          <p class="field-note">${setupNote}</p>
        </div>
        <button class="start-match" type="submit" ${disabled(busy || !model)}>开始对局 <span aria-hidden="true">→</span></button>
        ${match ? `<button class="resume-match" type="button" data-action="resume" ${disabled(busy)}>返回对局</button>` : ''}
        ${error ? `<p class="match-error" role="alert">${html(error)}</p>
          <button class="match-button" type="button" data-action="catalog" ${disabled(busy)}>${model ? '刷新模型列表' : '重试'}</button>` : ''}
      </form>
    </section>`;
  }

  function player(who) {
    const color = match.sides?.[who];
    const mark = `<span class="player-mark ${color ?? 'unassigned'}" aria-hidden="true"></span>`;
    const side = color ? sideLabel(match, color) : '待定阵营';
    return matchPlayer(who === 'human' ? '你' : 'AI', side, mark, !match.result && match.turn === who);
  }

  function turnStatus() {
    if (error) return '对局暂未更新';
    if (match.turn === 'ai') return match.thinking ? 'AI 正在思考' : '轮到 AI';
    if (!match.sides) return '轮到你翻棋';
    return selected === undefined ? '轮到你行动' : '选择落点';
  }

  function playView(result) {
    return matchLayout({
      opponent: player('ai'),
      player: player('human'),
      board: boardView(),
      status: result?.status ?? turnStatus(),
      notice: matchFeedback(error, match.error, busy)
        || (actionError ? `<div class="match-feedback"><p role="alert">${html(actionError)}</p></div>` : ''),
    });
  }

  function render(focus) {
    const opening = isSetup();
    const result = match?.result ? matchResult(match.result.winner, 'human', resultDetail(match.result)) : null;
    main.innerHTML = `<div class="${id}-shell ${opening ? '' : 'playing'}">
      ${gameToolbar(opening ? null : match, busy)}
      ${opening ? `<div class="flip-heading"><h1 tabindex="-1">${title}${subtitle ? ` <span>${subtitle}</span>` : ''}</h1></div>${setupView()}` : playView(result)}
    </div>`;
    if (focus) main.querySelector(focus)?.focus({ preventScroll: true });
    showResult(match, result, busy);
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
      if (next) perform(() => update(next.action, next), '.match-status');
      else {
        selected = selected === id ? undefined : id;
        render(`[data-point="${id}"]`);
      }
    } else if (action === 'catalog') perform(loadModels, '[name="model"]');
    else if (action) perform(() => update(action), ['undo', 'retry', 'refresh'].includes(action)
      ? '.match-status' : `[data-action="${action}"]`);
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
}
