import { games } from './games.mjs';
import { wrapIndex, cardOffset } from './selection.mjs';

const track = document.querySelector('#game-track');
const dots = document.querySelector('#game-dots');
const dialog = document.querySelector('#game-dialog');
const status = document.querySelector('#selection-status');
let selected = 0;
let gesture = null;
let suppressClickUntil = 0;

function createCard(game, index) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'game-card';
  card.dataset.index = index;
  card.style.setProperty('--cover-bg', game.background);
  card.style.setProperty('--cover-ink', game.ink);
  // All displayed markup comes from the bundled game catalogue.
  card.innerHTML = `
    <div class="cover">
      <div class="cover-title"><h2>${game.name}</h2><span>${game.englishName}</span></div>
      <img class="cover-art" src="/assets/covers/${game.id}.svg" alt="" draggable="false">
      <div class="cover-bottom"><span>PLAY A LITTLE</span><em>${game.category}</em></div>
    </div>`;
  return card;
}

const cards = games.map((game, index) => {
  const card = createCard(game, index);
  track.append(card);
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.className = 'dot';
  dot.dataset.index = index;
  dot.setAttribute('aria-label', `选择${game.name}`);
  dots.append(dot);
  return card;
});
const dotButtons = [...dots.children];

function selectGame(index) {
  const focusFollowsSelection = document.activeElement?.classList.contains('game-card');
  selected = wrapIndex(index, games.length);
  cards.forEach((card, cardIndex) => {
    const offset = cardOffset(cardIndex, selected, games.length);
    const previous = Number(card.style.getPropertyValue('--offset'));
    const active = cardIndex === selected;
    card.classList.toggle('is-repositioning', Math.abs(previous - offset) > 1);
    card.style.setProperty('--offset', offset);
    card.style.zIndex = games.length - Math.abs(offset);
    card.classList.toggle('is-selected', active);
    card.tabIndex = active ? 0 : -1;
    card.setAttribute('aria-label', `${active ? '进入' : '选择'}${games[cardIndex].name}`);
    dotButtons[cardIndex].classList.toggle('is-selected', active);
    for (const element of [card, dotButtons[cardIndex]]) {
      if (active) element.setAttribute('aria-current', 'true');
      else element.removeAttribute('aria-current');
    }
  });
  status.textContent = `${games[selected].name}，${selected + 1} / ${games.length}`;
  if (focusFollowsSelection) cards[selected].focus({ preventScroll: true });
}

function openGame() {
  const game = games[selected];
  if (game.href) {
    location.assign(game.href);
    return;
  }
  document.querySelector('#game-dialog-title').textContent = `${game.name}正在准备中`;
  dialog.showModal();
}

document.querySelector('#previous-game').addEventListener('click', () => selectGame(selected - 1));
document.querySelector('#next-game').addEventListener('click', () => selectGame(selected + 1));
dots.addEventListener('click', (event) => {
  const dot = event.target.closest('button[data-index]');
  if (dot) selectGame(Number(dot.dataset.index));
});
track.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) return;
  const card = event.target.closest('button[data-index]');
  if (!card) return;
  const index = Number(card.dataset.index);
  if (index === selected) openGame();
  else selectGame(index);
});

document.addEventListener('keydown', (event) => {
  if (dialog.open || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const key = event.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'a', 'd'].includes(key)) {
    event.preventDefault();
    selectGame(selected + (['arrowleft', 'a'].includes(key) ? -1 : 1));
  } else if (key === 'enter' && !event.target.closest('button')) {
    event.preventDefault();
    openGame();
  }
});

track.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
});
document.addEventListener('pointerup', (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  gesture = null;
  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
    suppressClickUntil = performance.now() + 300;
    selectGame(selected + (dx < 0 ? 1 : -1));
  }
});
document.addEventListener('pointercancel', () => { gesture = null; });
dialog.addEventListener('close', () => cards[selected].focus({ preventScroll: true }));
selectGame(0);
