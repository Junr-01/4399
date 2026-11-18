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

function exchangeGain(board, move, after, replies) {
  const taken = value[board[move.to].type];
  const gain = taken - Math.max(0, ...replies.map(reply => captureGain(after, reply)));
  if (gain > 0 || !replies.length) return gain;
  const { side, type } = board[move.from];
  const prior = new Map(legalMoves(board, side, { onlyCaptures: true }).map(capture =>
    [board[capture.to].id, captureGain(board, capture)]));
  return Math.min(taken, ...replies.map(reply => {
    const position = movedBoard(after, reply);
    let followup = 0;
    for (const capture of legalMoves(position, side, { onlyCaptures: true })) {
      const target = position[capture.to];
      // An unrelated king or pawn capture after an even exchange is idle (26.8).
      if (taken === value[type] && capture.to !== reply.to && ['k', 'p'].includes(position[capture.from].type)) continue;
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
  const defender = opposite(side);
  const existingTargets = new Set(legalMoves(board, defender, { onlyCaptures: true }).map(({ to }) => board[to].id));
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
    // A legal recapture is not a defence if it lets the attacker mate in one.
    const safeReplies = replies.filter(reply => !checkingMoves(movedBoard(next, reply), side)
      .some(check => !legalMoves(check.board, defender).length));
    const exchange = exchangeGain(board, move, next, safeReplies);
    if (exchange <= 0 || matingChecks(next, target.side, mateCache).length) continue;
    // Taking with a pinned piece can uncover a different, more valuable piece.
    // Exchange gain already accounts for recaptures on the original square.
    if (legalMoves(next, defender, { onlyCaptures: true }).some(reply => reply.to !== move.to
      && !existingTargets.has(next[reply.to].id) && captureGain(next, reply) > exchange)) continue;
    const counters = forcingGains(next, target.side, forcingCache, mateCache);
    const counter = maxGain(counters);
    const gain = Math.min(exchange, value[target.type] - counter);
    const threat = threats.get(target.id) ?? {
      target, gain: -Infinity, grossGain: 0, attackers: [], unrooted: false, joint: true, kingOrPawnOnly: true,
    };
    if (gain > threat.gain) {
      threat.gain = gain;
      const bestCounters = [...counters].filter(([, { score }]) => score === counter);
      threat.counterTargets = new Set(bestCounters.flatMap(([, { targets }]) => targets.map(piece => piece.id)));
      threat.counterChecks = bestCounters.flatMap(([line]) => {
        const [from, to] = line.split(':').map(Number);
        return [line, ...checkLines(movedBoard(next, { from, to }), side).map(moveKey)];
      });
    }
    threat.grossGain = Math.max(threat.grossGain, exchange);
    threat.attackers.push(attacker.id);
    threat.kingOrPawnOnly &&= attacker.type === 'k' || attacker.type === 'p';
    threat.unrooted ||= !replies.length;
    threat.joint &&= cannonScreen(board, move, side) >= 0 || (attacker.type === 'p'
      && checkLines(next, defender).some(({ from }) => from !== move.to));
    threats.set(target.id, threat);
  }
  return threats;
}

function cannonScreen(board, move, side) {
  if (board[move.from]?.type !== 'c' || !board[move.to]) return -1;
  return board.findIndex((piece, point) => piece?.side === side && point !== move.from
    && touchesLine({ from: point, to: point }, moveKey(move)));
}

function guardsScreen(board, withoutMover, { target, attackers }) {
  const to = board.findIndex(piece => piece?.id === target.id);
  return attackers.some(id => {
    const from = board.findIndex(piece => piece?.id === id);
    const screen = cannonScreen(board, { from, to }, opposite(target.side));
    if (screen < 0) return false;
    const counter = legalMoves(withoutMover, target.side, { capture: screen }).find(move => move.from === to);
    if (!counter || captureGain(withoutMover, counter) <= 0) return false;
    return !legalMoves(board, target.side, { capture: screen }).some(move => move.from === to)
      || captureGain(board, counter) <= 0;
  });
}

function brokeOwnSupport(beforeCheck, afterReply, check, { target, attackers }) {
  const side = opposite(target.side);
  const supported = beforeCheck.findIndex(piece => piece?.id === target.id);
  const exposed = afterReply.findIndex(piece => piece?.id === target.id);
  if (supported < 0 || exposed < 0) return false;
  const supportedByChecker = new Set(legalMoves(beforeCheck, side, { capture: supported })
    .filter(capture => legalMoves(movedBoard(beforeCheck, capture), target.side, { capture: supported })
      .some(reply => reply.from === check.from))
    .map(capture => beforeCheck[capture.from].id));
  return legalMoves(afterReply, side, { capture: exposed }).some(capture => {
    const attacker = afterReply[capture.from].id;
    return attackers.includes(attacker) && supportedByChecker.has(attacker)
      && !legalMoves(movedBoard(afterReply, capture), target.side, { capture: exposed })
        .some(reply => reply.from === check.to);
  });
}

function hasPawnEscort(before, after, move, target) {
  return legalMoves(before, target.side, { capture: move.from }).some(attack => {
    // Protection matters if an opposing piece could take the pawn except for
    // the escort. Check that the same escort also covers its new square.
    const hunter = before[attack.from];
    if (hunter.id === target.id || after[attack.from]?.id !== hunter.id || captureGain(before, attack) > 0) return false;
    const escorts = new Set(legalMoves(movedBoard(before, attack), move.side, { capture: move.from })
      .map(({ from }) => before[from].id));
    const challenged = movedBoard(after, { from: attack.from, to: move.to });
    return legalMoves(challenged, move.side, { capture: move.to }).some(({ from }) => escorts.has(after[from].id));
  });
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

function exposedAfterMovingGuard(before, after, move, mateCache) {
  const defender = opposite(move.side);
  const lost = [];
  for (const reply of legalMoves(after, defender, { onlyCaptures: true })) {
    if (reply.to === move.to || before[reply.to]?.id !== after[reply.to].id
      || !legalMoves(before, defender, { capture: reply.to }).some(candidate => candidate.from === reply.from)) continue;
    const cost = captureGain(after, reply);
    if (cost <= 0) continue;
    const exchanged = movedBoard(after, reply);
    if (!matingChecks(exchanged, move.side, mateCache).length
      && matingChecks(movedBoard(before, reply), move.side, mateCache).some(line => line.startsWith(move.from + ':'))) {
      lost.push({ board: exchanged, cost });
    }
  }
  return lost;
}

function forcingGains(board, side, cache, mateCache) {
  const defender = opposite(side);

  function bestCapture(position, before, priorCaptures, lost) {
    let best = { score: 0, targets: [] };
    for (const move of legalMoves(position, side, { onlyCaptures: true })) {
      const target = position[move.to];
      if (target.type === 'p' && !crossed(target, move.to)) continue;
      if (lost?.type === 'p' && target.type !== 'r') continue;
      const score = captureGain(position, move);
      const prior = priorCaptures.get(moveKey(move));
      if (prior && before[move.from]?.id === position[move.from].id && before[move.to]?.id === target.id
        && score <= captureGain(before, prior) && (lost || safeReciprocalExchange(before, prior, mateCache))) continue;
      if (score <= 0 || score < best.score) continue;
      const after = movedBoard(position, move);
      // A pawn cleaning up after an allied check is idle unless it gives a discovered check (26.8).
      if (position[move.from].type === 'p' && !checkLines(after, defender).some(({ from }) => from !== move.to)) continue;
      if (matingChecks(after, defender, mateCache).length) continue;
      best = { score, targets: score > best.score ? [target] : [...best.targets, target] };
    }
    return best;
  }

  function gainFromCheck(position, check, remaining) {
    if (safeReciprocalExchange(position, check.move, mateCache)) return null;
    const target = position[check.move.to];
    const taken = target && (target.type !== 'p' || crossed(target, check.move.to)) ? value[target.type] : 0;
    const replies = legalMoves(check.board, defender);
    if (!replies.length || matingChecks(check.board, defender, mateCache).length) return null;
    const priorCaptures = new Map(legalMoves(position, side, { onlyCaptures: true }).map(move => [moveKey(move), move]));
    let score = Infinity;
    const targets = new Map(taken ? [[target.id, target]] : []);
    for (const reply of replies) {
      const lost = check.board[reply.to];
      const after = movedBoard(check.board, reply);
      // A capture that was available anyway cannot pay for a new sacrifice.
      let best = bestCapture(after, position, priorCaptures, lost);
      if (remaining > 0) {
        for (const proof of gains(after, remaining - 1).values()) {
          // A checking pawn sacrifice counts only when it wins a rook (26.7).
          if (proof.score > best.score && (lost?.type !== 'p' || proof.targets.some(piece => piece.type === 'r'))) best = proof;
        }
      }
      score = Math.min(score, taken - (value[lost?.type] ?? 0) + best.score);
      if (score <= 0) return null;
      for (const piece of best.targets) targets.set(piece.id, piece);
    }
    const joint = cannonScreen(position, check.move, side) >= 0
      || checkLines(check.board, defender).some(({ from }) => from !== check.move.to);
    return { score, targets: [...targets.values()], joint };
  }

  function gains(position, remaining) {
    // The recorded targets follow individual pieces, including pieces of the same type.
    const key = `${side}:${remaining}:${position.map(piece => piece?.id).join(',')}`;
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
    const last = moves[index - 1];
    let boardWithoutMover;
    let withoutMover;
    for (const threat of current.values()) {
      const { target, gain, grossGain, attackers, unrooted, joint, kingOrPawnOnly } = threat;
      const prior = previous.get(target.id);
      const moverAttacks = attackers.includes(piece.id);
      if (last?.check && !moverAttacks
        && brokeOwnSupport(frames[index - 1].board, after.board, last, threat)) continue;
      if (piece.type === 'k' && target.type === 'p' && !moverAttacks
        && (gain <= 0 || matingChecks(before.board, target.side, mates).length)) {
        const capture = before.board.findIndex(other => other?.id === target.id);
        const oldAttackers = new Set(legalMoves(before.board, move.side, { capture })
          .map(({ from }) => before.board[from].id));
        if (attackers.every(id => oldAttackers.has(id))) continue;
      }
      if (target.type === 'c' && !moverAttacks) {
        const capture = after.board.findIndex(other => other?.id === target.id);
        // Adding a screen for a safe cannon exchange is an offer to trade,
        // even if an existing attack on that square could also use the screen.
        if (legalMoves(after.board, move.side, { capture }).some(exchange =>
          cannonScreen(after.board, exchange, move.side) === move.to
            && safeReciprocalExchange(after.board, exchange, mates))) continue;
      }
      const joinsChase = prior && moverAttacks && !prior.attackers.includes(piece.id);
      if (!joinsChase && prior?.grossGain >= grossGain && prior.gain >= gain) {
        if (gain <= 0 || piece.type === 'k' || moverAttacks) continue;
        // A different piece may sustain the same capture by denying a reply.
        if (!withoutMover) {
          boardWithoutMover = after.board.slice();
          boardWithoutMover[move.to] = null;
          withoutMover = captureThreats(boardWithoutMover, move.side, mates, forcing);
        }
        const unsupported = withoutMover.get(target.id);
        if (!(unsupported?.grossGain >= grossGain && unsupported.gain >= gain)
          || (joint && guardsScreen(after.board, boardWithoutMover, threat))) {
          targets.push({ id: target.id, type: target.type, unrooted, joint: true });
        }
        continue;
      }
      // An existing capture becomes a chase if this move cuts its tactical
      // defence. Improvements unrelated to the piece's move leave it unchanged.
      const escapesCounter = prior?.counterTargets.has(piece.id) && !threat.counterTargets.has(piece.id);
      if (!joinsChase && prior?.grossGain >= grossGain && !escapesCounter
        && !prior.counterChecks.some(line => touchesLine(move, line))) continue;
      const escortedPawn = !joint && kingOrPawnOnly && piece.type === 'p' && moverAttacks
        && hasPawnEscort(before.board, after.board, move, target);
      if (!joint && kingOrPawnOnly && !escortedPawn) continue;
      if (target.type === 'p' && last && before.board[last.to]?.id === target.id && !crossed(target, last.from)) continue;
      targets.push({ id: target.id, type: target.type, unrooted, joint: joint || escortedPawn });
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
    const exposed = newGains.size ? exposedAfterMovingGuard(before.board, after.board, move, mates) : [];
    for (const [check, proof] of newGains) {
      // Moving a guard to set a threat is idle if the opponent can take the
      // formerly protected piece first and the threat only breaks even (26.5).
      if (exposed.some(({ board, cost }) => cost >= (forcingGains(board, move.side, forcing, mates).get(check)?.score ?? 0))) continue;
      const earlier = previousGains.get(check);
      const improved = proof.score > Math.max(availableGain, earlier?.score ?? 0);
      // A forced reply can expose a new target even if an unrelated capture
      // already offered the same material gain.
      const restoresOldCapture = proof.targets.some(({ id }) => previous.has(id) && !current.has(id));
      const newTargets = restoresOldCapture ? [] : proof.targets.filter(({ id }) => !previous.has(id) && !current.has(id)
        && !earlier?.targets.some(target => target.id === id));
      if (improved && !proof.targets.length && !targets.length) targets.push({ type: null, unrooted: true, joint: proof.joint });
      for (const target of improved ? proof.targets : newTargets) {
        if (!targets.some(({ id }) => id === target.id)) {
          targets.push({ id: target.id, type: target.type, unrooted: true, joint: proof.joint });
        }
      }
    }
    return { kind: targets.length ? 'chase' : 'quiet', targets };
  };
}
