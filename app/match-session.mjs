import { selectModel } from './game-models.mjs';

export function createMatchSession(id, draft, render, onSnapshot) {
  const api = '/api/' + id;
  const state = {
    models: [], match: null, busy: false, error: '', actionError: '',
    get setup() { return !this.match || this.match.paused; },
  };
  let poll;
  let epoch = 0;
  let pendingId;
  let leaving = false;

  async function request(path, data) {
    const response = await fetch(api + path, data === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : null;
    if (!response.ok || !body) {
      throw Object.assign(new Error(body?.error ?? '游戏服务未返回有效数据，请重试。'), {
        status: response.status, snapshot: body?.snapshot,
      });
    }
    return body;
  }

  function applySnapshot(match) {
    const wasSetup = state.setup;
    if (match?.paused && !state.match?.paused) {
      for (const key of Object.keys(draft)) draft[key] = match.config[key];
      selectModel(state.models, draft);
    }
    state.match = match;
    onSnapshot?.();
    if (wasSetup !== state.setup) window.scrollTo(0, 0);
  }

  function showError(failure) {
    if (failure.status === 404) applySnapshot(null);
    state.error = failure instanceof TypeError ? '无法连接本地游戏服务，请重试。' : failure.message;
  }

  function watchTurn() {
    clearTimeout(poll);
    if (leaving || state.setup || state.busy || state.error || !state.match.thinking) return;
    const currentEpoch = epoch;
    const previous = state.match;
    poll = setTimeout(async () => {
      try {
        const updated = await request('/matches/' + previous.id);
        if (epoch !== currentEpoch) return;
        applySnapshot(updated);
      } catch (failure) {
        if (epoch !== currentEpoch) return;
        showError(failure);
      }
      if (!state.match?.thinking || state.match.revision !== previous.revision || state.error) {
        const active = document.activeElement;
        const action = active?.closest('.game-toolbar button')?.dataset.action;
        render(state.setup ? 'h1' : action ? `.game-toolbar button[data-action="${action}"]:enabled, .match-status`
          : active?.matches('.match-status') ? '.match-status' : undefined);
      }
      watchTurn();
    }, 400);
  }

  async function perform(work, focus) {
    if (state.busy || leaving) return;
    const wasSetup = state.setup;
    state.busy = true;
    state.error = '';
    state.actionError = '';
    epoch++;
    clearTimeout(poll);
    render();
    try { await work(); }
    catch (failure) { if (!leaving) showError(failure); }
    finally {
      state.busy = false;
      if (!leaving) {
        render(wasSetup === state.setup ? focus : state.setup ? 'h1' : '.match-status');
        watchTurn();
      }
    }
  }

  function loadModels(focus) {
    return perform(async () => {
      ({ models: state.models } = await request('/models'));
      selectModel(state.models, draft);
    }, focus);
  }

  function release(matchId) {
    if (matchId) fetch(api + '/matches/' + matchId, { method: 'DELETE', keepalive: true }).catch(() => {});
  }

  function start() {
    if (!state.models.some(model => model.id === draft.model)) return;
    return perform(async () => {
      try {
        ({ id: pendingId } = await request('/reservations', {}));
        if (leaving) {
          release(pendingId);
          return;
        }
        const match = await request('/matches', { ...draft, id: pendingId, replace: state.match?.id });
        if (!leaving) applySnapshot(match);
      } catch (failure) {
        if (!leaving) release(pendingId);
        throw failure;
      } finally {
        pendingId = undefined;
      }
    });
  }

  function act(action, fields, focus) {
    if (!state.match) return;
    return perform(async () => {
      const path = '/matches/' + state.match.id;
      try {
        const updated = await request(path, action === 'refresh' ? undefined : {
          ...fields, action, revision: state.match.revision,
        });
        if (!leaving) applySnapshot(updated);
      } catch (failure) {
        if (failure.status !== 409 || action === 'refresh') throw failure;
        if (leaving) return;
        const snapshot = failure.snapshot ?? await request(path);
        if (leaving) return;
        applySnapshot(snapshot);
        state.actionError = failure.message;
      }
    }, focus);
  }

  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    leaving = true;
    epoch++;
    clearTimeout(poll);
    release(pendingId);
    release(state.match?.id);
  });

  return { state, loadModels, start, act };
}
