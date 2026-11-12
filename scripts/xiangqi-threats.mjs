import { checkLines, inCheck, legalMoves, movedBoard, opposite, positionKey } from './xiangqi-board.mjs';

const value = { r: 10, h: 5, c: 5, a: 1, e: 1, p: 1 };
const mateCheckLimit = 4;
const gainCheckLimit = 2;
const crossed = (piece, point) => piece.side === 'red' ? point < 45 : point >= 45;
const moveKey = ({ from, to }) => from + ':' + to;
const maxGain = gains => Math.max(0, ...Array.from(gains.values(), ({ score }) => score));

function touchesLine(move, line) {
  const [from, to] = line.split(':').map(Number);
  const row = point => Math.floor(point / 9);
  const column = point => point % 9;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return [move.from, move.to].some(point => {
    if (point < lo || point > hi) return false;
    return point === from || point === to
      || (row(from) === row(to) && row(from) === row(point))
      || (column(from) === column(to) && column(from) === column(point));
  });
}

function captureGain(board, move) {
  const captured = board[move.to];
  return value[captured.type] - recaptureGain(movedBoard(board, move), captured.side, move.to);
}

function recaptureGain(board, side, point) {
  let best = 0;
  for (const recapture of legalMoves(board, side, { capture: point })) {
    best = Math.max(best, captureGain(board, recapture));
  }
  return best;
}

function exchangeGain(board, move, replies) {
  const gain = captureGain(board, move);
  if (gain > 0 || !replies.length) return gain;
  const { side, type } = board[move.from];
  const taken = value[board[move.to].type];
  const prior = new Map(legalMoves(board, side, { onlyCaptures: true }).map(capture =>
    [board[capture.to].id, captureGain(board, capture)]));
  const after = movedBoard(board, move);
  return Math.min(taken, ...replies.map(reply => {
    const position = movedBoard(after, reply);
    let followup = 0;
    for (const capture of legalMoves(position, side, { onlyCaptures: true })) {
      const target = position[capture.to];
      if (target.type === 'p' && !crossed(target, capture.to)) continue;
      const extra = captureGain(position, capture);
      if (capture.to === reply.to || extra > (prior.get(target.id) ?? 0)) followup = Math.max(followup, extra);
    }
    return taken - value[type] + followup;
  }));
}

function safeReciprocalExchange(board, move, mateCache) {
  const attacker = board[move.from];
  const target = board[move.to];
  if (!target || attacker.type !== target.type) return false;
  const exchange = legalMoves(board, target.side, { capture: move.from }).find(reply => reply.from === move.to);
  return exchange && captureGain(board, exchange) >= 0
    && !matingChecks(movedBoard(board, exchange), attacker.side, mateCache).length;
}

function captureThreats(board, side, mateCache, forcingCache) {
  const threats = new Map();
  for (const move of legalMoves(board, side, { onlyCaptures: true })) {
    const attacker = board[move.from];
    const target = board[move.to];
    if (target.type === 'p' && !crossed(target, move.to)) continue;
    if (safeReciprocalExchange(board, move, mateCache)) continue;
    const next = movedBoard(board, move);
    const replies = legalMoves(next, target.side, { capture: move.to });
    // A pawn exchange does not count as a material gain, except a checking pawn
    // sacrifice for a rook. An undefended piece can still be a chase target.
    if (replies.length && (attacker.type === 'p' || target.type === 'p')
      && !(target.type === 'r' && inCheck(next, target.side))) continue;
    const exchange = exchangeGain(board, move, replies);
    if (exchange <= 0 || matingChecks(next, target.side, mateCache).length) continue;
    const counters = forcingGains(next, target.side, forcingCache, mateCache);
    const counter = maxGain(counters);
    const gain = Math.min(exchange, value[target.type] - counter);
    const threat = threats.get(target.id) ?? {
      target, gain: -Infinity, grossGain: 0, attackers: [], unrooted: false, joint: true,
    };
    if (gain > threat.gain) {
      threat.gain = gain;
      threat.counterChecks = [...counters].flatMap(([line, { score }]) => {
        if (score !== counter) return [];
        const [from, to] = line.split(':').map(Number);
        return [line, ...checkLines(movedBoard(next, { from, to }), side).map(moveKey)];
      });
    }
    threat.grossGain = Math.max(threat.grossGain, exchange);
    threat.attackers.push(attacker.id);
    threat.unrooted ||= !replies.length;
    threat.joint &&= cannonScreen(board, move, side);
    threats.set(target.id, threat);
  }
  return threats;
}

function cannonScreen(board, move, side) {
  if (board[move.from]?.type !== 'c' || !board[move.to]) return false;
  return board.some((piece, point) => piece?.side === side && point !== move.from
    && touchesLine({ from: point, to: point }, moveKey(move)));
}

function checkingMoves(board, side) {
  return legalMoves(board, side).map(move => ({ move, board: movedBoard(board, move) }))
    .filter(position => inCheck(position.board, opposite(side)));
}

function matingChecks(board, side, cache) {
  const key = positionKey(board, side);
  if (cache.has(key)) return cache.get(key);
  const defender = opposite(side);
  const memo = new Map();

  function forcedMate(checkedBoard, remaining) {
    const key = positionKey(checkedBoard, defender) + remaining;
    if (memo.has(key)) return memo.get(key);
    const replies = legalMoves(checkedBoard, defender);
    const wins = !replies.length || (remaining > 0 && replies.every(reply =>
      checkingMoves(movedBoard(checkedBoard, reply), side).some(check => forcedMate(check.board, remaining - 1))));
    memo.set(key, wins);
    return wins;
  }

  const checks = checkingMoves(board, side).filter(check => forcedMate(check.board, mateCheckLimit - 1))
    .map(({ move }) => moveKey(move));
  cache.set(key, checks);
  return checks;
}

function forcingGains(board, side, cache, mateCache) {
  const defender = opposite(side);

  function bestCapture(position) {
    let best = { score: 0, targets: [] };
    for (const move of legalMoves(position, side, { onlyCaptures: true })) {
      const target = position[move.to];
      if (target.type === 'p' && !crossed(target, move.to)) continue;
      const score = captureGain(position, move);
      if (score > 0 && score >= best.score && !matingChecks(movedBoard(position, move), defender, mateCache).length) {
        best = { score, targets: score > best.score ? [target] : [...best.targets, target] };
      }
    }
    return best;
  }

  function gainFromCheck(position, check, remaining) {
    if (safeReciprocalExchange(position, check.move, mateCache)) return null;
    const target = position[check.move.to];
    const taken = target && (target.type !== 'p' || crossed(target, check.move.to)) ? value[target.type] : 0;
    const replies = legalMoves(check.board, defender);
    if (!replies.length || matingChecks(check.board, defender, mateCache).length) return null;
    let score = Infinity;
    let targets;
    for (const reply of replies) {
      const lost = value[check.board[reply.to]?.type] ?? 0;
      const after = movedBoard(check.board, reply);
      let best = bestCapture(after);
      if (remaining > 0) {
        for (const proof of gains(after, remaining - 1).values()) {
          if (proof.score > best.score) best = proof;
        }
      }
      score = Math.min(score, taken - lost + best.score);
      if (score <= 0) return null;
      targets = targets ? targets.filter(piece => best.targets.some(other => other.id === piece.id)) : best.targets;
    }
    const joint = cannonScreen(position, check.move, side)
      || checkLines(check.board, defender).some(({ from }) => from !== check.move.to);
    return { score, targets: taken ? [target, ...targets] : targets, joint };
  }

  function gains(position, remaining) {
    const key = positionKey(position, side) + remaining;
    if (cache.has(key)) return cache.get(key);
    const result = new Map();
    for (const check of checkingMoves(position, side)) {
      const proof = gainFromCheck(position, check, remaining);
      if (proof) result.set(moveKey(check.move), proof);
    }
    cache.set(key, result);
    return result;
  }

  return gains(board, gainCheckLimit - 1);
}

export function classifyMoves(moves, frames) {
  const captures = new WeakMap();
  const mates = new Map();
  const forcing = new Map();

  function threats(frame, side) {
    const bySide = captures.get(frame) ?? new Map();
    if (!bySide.has(side)) bySide.set(side, captureThreats(frame.board, side, mates, forcing));
    captures.set(frame, bySide);
    return bySide.get(side);
  }

  return index => {
    const move = moves[index];
    if (move.check) return { kind: 'check', targets: [] };
    const before = frames[index];
    const after = frames[index + 1];
    const piece = before.board[move.from];
    if (piece.type === 'k' && before.check) return { kind: 'quiet', targets: [] };
    const mateBefore = matingChecks(before.board, move.side, mates);
    if (matingChecks(after.board, move.side, mates).some(check => !mateBefore.includes(check))) {
      return { kind: 'mate', targets: [] };
    }
    const previous = threats(before, move.side);
    const current = threats(after, move.side);
    const targets = [];
    for (const threat of current.values()) {
      const { target, gain, grossGain, attackers, unrooted, joint } = threat;
      const prior = previous.get(target.id);
      if (prior?.grossGain >= grossGain && prior.gain >= gain) continue;
      // An existing capture becomes a chase if this move cuts its tactical
      // defence. Improvements unrelated to the piece's move leave it unchanged.
      if (prior?.grossGain >= grossGain && !prior.counterChecks.some(line => touchesLine(move, line))) continue;
      if (!joint && attackers.length === 1 && attackers[0] === piece.id && ['k', 'p'].includes(piece.type)) continue;
      const last = moves[index - 1];
      if (target.type === 'p' && last && before.board[last.to]?.id === target.id && !crossed(target, last.from)) continue;
      targets.push({ id: target.id, type: target.type, unrooted, joint });
    }
    if (targets.length && targets.every(({ type }) => type === 'a' || type === 'e')) {
      const attackers = before.board.filter(piece => piece?.side === move.side && 'rhcp'.includes(piece.type));
      const enemy = opposite(move.side);
      if (attackers.length === 1 && matingChecks(before.board, enemy, mates).length
        && !matingChecks(after.board, enemy, mates).length) return { kind: 'quiet', targets: [] };
    }
    const previousGains = forcingGains(before.board, move.side, forcing, mates);
    const newGains = forcingGains(after.board, move.side, forcing, mates);
    const availableGain = Math.max(0, ...[...previous.values(), ...current.values()].map(threat => threat.grossGain));
    for (const [check, proof] of newGains) {
      if (proof.score <= Math.max(availableGain, previousGains.get(check)?.score ?? 0)) continue;
      if (!proof.targets.length && !targets.length) targets.push({ type: null, unrooted: true, joint: proof.joint });
      for (const target of proof.targets) {
        if (!targets.some(({ id }) => id === target.id)) {
          targets.push({ id: target.id, type: target.type, unrooted: true, joint: proof.joint });
        }
      }
    }
    return { kind: targets.length ? 'chase' : 'quiet', targets };
  };
}
