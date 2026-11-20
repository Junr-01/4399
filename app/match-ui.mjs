import { escapeHtml } from './game-models.mjs';

export function gameToolbar(match, busy) {
  return `<header class="game-toolbar">
    <a href="/">← 游戏馆</a>
    ${match ? `<div class="game-actions">
      <button class="match-button" type="button" data-action="undo" ${busy || !match.canUndo ? 'disabled' : ''}>悔棋</button>
      <button class="match-button" type="button" data-action="pause" ${busy ? 'disabled' : ''}>重新开始</button>
    </div>` : ''}
  </header>`;
}

export function matchPlayer(label, side, marker, active) {
  return `<div class="match-player ${active ? 'is-active' : ''}">
    ${marker}<strong>${label}</strong><span>${side}</span>
  </div>`;
}

export function matchLayout({ opponent, player, board, status, notice = '' }) {
  return `<section class="match-view">
    <div class="match-top">
      ${opponent}
      <p class="match-status" role="status" tabindex="-1">${status}</p>
    </div>
    ${notice}
    ${board}
    ${player}
  </section>`;
}

export function matchResult(winner, human, detail) {
  const title = winner ? (winner === human ? '你获胜' : 'AI 获胜') : '和棋';
  return { title, detail, status: detail ? `${title} · ${detail}` : title };
}

export function matchFeedback(error, aiError, busy, actionError) {
  const message = error || aiError;
  if (!message && !actionError) return '';
  return `<div class="match-feedback">
    <p role="alert">${escapeHtml(message || actionError)}</p>
    ${message ? `<button class="match-button" type="button" data-action="${error ? 'refresh' : 'retry'}" ${busy ? 'disabled' : ''}>${error ? '刷新棋局' : '重试'}</button>` : ''}
  </div>`;
}

export function createResultDialog(main) {
  let shownFor;
  return (match, result, busy) => {
    if (!result) {
      shownFor = undefined;
      return;
    }
    if (busy || match.paused || shownFor === match.id) return;
    shownFor = match.id;

    const dialog = document.createElement('dialog');
    dialog.className = 'result-dialog';
    dialog.setAttribute('aria-labelledby', 'result-title');
    if (result.detail) dialog.setAttribute('aria-describedby', 'result-detail');
    dialog.innerHTML = `<h2 id="result-title">${result.title}</h2>
      ${result.detail ? `<p id="result-detail">${result.detail}</p>` : ''}
      <div class="game-actions">
        <button class="match-button" type="button" data-view-board autofocus>查看棋盘</button>
        <button class="match-button result-replay" type="button" data-action="pause">再来一局</button>
      </div>`;
    dialog.querySelector('[data-view-board]').addEventListener('click', event => {
      event.stopPropagation();
      dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (!dialog.isConnected) return;
      dialog.remove();
      main.querySelector('.match-status')?.focus({ preventScroll: true });
    });
    main.append(dialog);
    dialog.showModal();
  };
}
