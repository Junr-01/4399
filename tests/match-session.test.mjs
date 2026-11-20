import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMatchSession } from '../app/match-session.mjs';

const api = '/api/gomoku';
const id = 'match-1';
const matchPath = api + '/matches/' + id;
const draft = { model: 'example', effort: 'low' };
const models = [{ id: 'example', efforts: ['low'], defaultEffort: 'low' }];
const snapshot = (revision, thinking, moves = []) => ({
  id, revision, thinking, moves, paused: false, config: draft,
});

async function setup(t, sessionOptions, ...responses) {
  const reload = t.mock.fn();
  const page = Object.assign(new EventTarget(), { scrollTo() {}, location: { reload } });
  globalThis.window = page;
  globalThis.document = { activeElement: null };
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });

  const fetch = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  responses.unshift(Response.json({ models }));
  const renders = [];
  const session = createMatchSession('gomoku', { ...draft }, () => renders.push(session.state.match),
    undefined, sessionOptions);
  await session.loadModels();

  const requests = () => fetch.mock.calls.map(({ arguments: [path, options] }) => ({
    path, method: options?.method ?? 'GET',
    ...(options?.body === undefined ? {} : { body: JSON.parse(options.body) }),
    ...(options?.keepalive ? { keepalive: true } : {}),
  }));
  return { session, page, requests, renders, reload };
}

test('the page renders the next AI even when the previous move is already visible', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const finishing = { ...snapshot(2, true), side: 1 };
  const next = { ...finishing, side: 2 };
  const { session, page, renders } = await setup(t, undefined, Response.json({ id }), Response.json(finishing),
    Response.json(next), new Response(null, { status: 204 }));
  await session.start();
  assert.deepEqual(renders.at(-1), finishing);

  t.mock.timers.tick(400);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(renders.at(-1), next);
  page.dispatchEvent(new Event('pagehide'));
});

test('a poll started before undo cannot overwrite the newer board', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const late = Promise.withResolvers();
  const moving = snapshot(1, true, [{ row: 4, col: 4, color: 'black' }]);
  const stale = snapshot(2, false, [...moving.moves, { row: 4, col: 5, color: 'white' }]);
  const restored = snapshot(3, false);
  const { session, requests } = await setup(t, undefined, Response.json({ id }), Response.json(moving),
    late.promise, Response.json(restored));
  await session.start();

  t.mock.timers.tick(400);
  assert.deepEqual(requests().at(-1), { path: matchPath, method: 'GET' });
  await session.act('undo');
  assert.deepEqual(session.state.match, restored);

  late.resolve(Response.json(stale));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(session.state.match, restored);
  assert.equal(session.state.error, '');
});

test('an action conflict shows the reason and adopts the updated board without another request', async t => {
  const original = snapshot(4, false);
  const current = snapshot(5, false, [{ row: 4, col: 4, color: 'black' }]);
  const error = '棋局状态已更新，请重新操作。';
  const { session, requests } = await setup(t, undefined, Response.json({ id }), Response.json(original),
    Response.json({ error, snapshot: current }, { status: 409 }));
  await session.start();
  const requestCount = requests().length;

  await session.act('move', { row: 2, col: 3 });

  assert.deepEqual(requests().slice(requestCount), [{
    path: matchPath, method: 'POST', body: { action: 'move', revision: original.revision, row: 2, col: 3 },
  }]);
  assert.deepEqual(session.state.match, current);
  assert.equal(session.state.actionError, error);
  assert.equal(session.state.error, '');
});

test('leaving during reservation releases the returned ID without starting a match', async t => {
  const reservation = Promise.withResolvers();
  const { session, page, requests } = await setup(t, undefined, reservation.promise, new Response(null, { status: 204 }));
  const starting = session.start();
  assert.deepEqual(requests().at(-1), { path: api + '/reservations', method: 'POST', body: {} });
  const requestCount = requests().length;

  page.dispatchEvent(new Event('pagehide'));
  reservation.resolve(Response.json({ id }));
  await starting;

  assert.deepEqual(requests().slice(requestCount), [{ path: matchPath, method: 'DELETE', keepalive: true }]);
  assert.equal(session.state.match, null);
});

test('leaving while match creation is pending releases the reservation and ignores a late match', async t => {
  const creation = Promise.withResolvers();
  const { session, page, requests } = await setup(t, undefined, Response.json({ id }), creation.promise,
    new Response(null, { status: 204 }));
  const starting = session.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests().at(-1), { path: api + '/matches', method: 'POST', body: { ...draft, id } });
  const requestCount = requests().length;

  page.dispatchEvent(new Event('pagehide'));
  creation.resolve(Response.json(snapshot(0, true)));
  await starting;

  assert.deepEqual(requests().slice(requestCount), [{ path: matchPath, method: 'DELETE', keepalive: true }]);
  assert.equal(session.state.match, null);
});

test('a match that releases on history navigation stops AI work and reloads on browser back', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { session, page, requests, reload } = await setup(t, { releaseOnHistoryNavigation: true },
    Response.json({ id }), Response.json(snapshot(0, true)), new Response(null, { status: 204 }));
  await session.start();
  page.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.deepEqual(requests().at(-1), { path: matchPath, method: 'DELETE', keepalive: true });
  page.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  assert.equal(reload.mock.callCount(), 1);
});
