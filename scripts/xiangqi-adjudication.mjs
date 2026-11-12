import { opposite } from './xiangqi-board.mjs';
import { classifyMoves } from './xiangqi-threats.mjs';

const sides = ['red', 'black'];
const sameMove = (left, right) => left.from === right.from && left.to === right.to;
const loss = (side, reason) => ({ result: { winner: opposite(side), reason }, pending: null });

function repeatedCycle(moves, frames) {
  const end = moves.length;
  const limit = frames[end].quietPlies;
  for (let period = 4; period * 3 <= limit; period += 2) {
    const start = end - 3 * period;
    if (frames[start + period].key !== frames[end].key) continue;
    const cycle = moves.slice(end - period);
    const entry = frames[start].key !== frames[end].key;
    // Article 23.2 counts a noncapture that enters the first repeating position.
    // quietPlies excludes a capture from the candidate sequence.
    if (entry && frames[start + 1].key !== frames[end - period + 1].key) continue;
    const offset = Number(entry);
    const sameCycle = moves.slice(start + offset, end - period)
      .every((move, index) => sameMove(move, cycle[(index + offset) % period]));
    if (sameCycle) return { cycle, entry: entry ? start : null, start: end - period };
  }
  return null;
}

function alternatingAttacks(moves, frames, classify) {
  const end = moves.length;
  if (frames[end].quietPlies < 18) return null;
  for (const side of sides) {
    const indices = Array.from({ length: 9 }, (_, i) => end - 18 + 2 * i)
      .map(index => index + Number(moves[index].side !== side));
    const sequence = indices.map(index => moves[index]);
    const points = new Set();
    const repeated = new Set();
    for (const move of sequence) {
      if (points.has(move.to)) repeated.add(move.to);
      points.add(move.to);
    }
    if (repeated.size < 3) continue;
    const kinds = indices.map(index => classify(index).kind);
    if (kinds.includes('quiet') || new Set(kinds).size < 2) continue;
    // Reference figure 8 changes the order and distances of the attacks
    // during the nine rounds. The opposing replies need not repeat either.
    return { side, reason: 'alternating-threats', requiresQuiet: true, remaining: 2,
      attacks: sequence, varied: false, quiet: false };
  }
  return null;
}

function profile(kinds) {
  const attacks = new Set(kinds.map(({ kind }) => kind));
  const chase = kinds.filter(({ kind }) => kind === 'chase');
  const allChasesTarget = test => chase.length > 0 && chase.every(({ targets }) => targets.some(test));
  const requiresChange = !attacks.has('quiet');
  const severe = attacks.has('mate') && !attacks.has('chase')
    || allChasesTarget(target => target.type === 'r' || target.unrooted);
  const chaseOnly = attacks.size === 1 && chase.length > 0;
  const chaseRook = joint => chaseOnly && allChasesTarget(target => target.type === 'r' && target.joint === joint);
  const chaseUnrooted = joint => chaseOnly && allChasesTarget(target => target.unrooted && target.joint === joint);
  const reason = attacks.has('mate') ? 'perpetual-mate-threat' : 'perpetual-chase';
  return { requiresChange, severe, chaseRook, chaseUnrooted, reason };
}

function obligatedSide(red, black) {
  if (red.requiresChange !== black.requiresChange) return red.requiresChange ? 'red' : 'black';
  if (!red.requiresChange) return null;
  if (red.severe !== black.severe) return red.severe ? 'red' : 'black';
  const soloAgainstJoint = (solo, joint) => solo.chaseRook(false) && joint.chaseRook(true)
    || solo.chaseUnrooted(false) && joint.chaseUnrooted(true);
  const redMustVary = soloAgainstJoint(red, black);
  const blackMustVary = soloAgainstJoint(black, red);
  if (redMustVary !== blackMustVary) return redMustVary ? 'red' : 'black';
  return null;
}

function continueCycle(pending, move) {
  if (!sameMove(move, pending.cycle[pending.next])) return null;
  const remaining = pending.remaining - Number(!pending.side || pending.side === move.side);
  if (!remaining) {
    return pending.side ? loss(pending.side, 'failure-to-vary')
      : { pending: null, result: { winner: null, reason: 'repetition' } };
  }
  return { pending: { ...pending, next: (pending.next + 1) % pending.cycle.length, remaining }, result: null };
}

function continueAlternation(pending, move, classify, index) {
  if (move.side !== pending.side) return { pending, result: null };
  const varied = pending.varied || !pending.attacks.some(attack => sameMove(move, attack));
  const quiet = pending.quiet || classify(index).kind === 'quiet';
  if (varied && quiet) return null;
  if (pending.remaining === 1) return loss(pending.side, 'failure-to-vary');
  return { pending: { ...pending, varied, quiet, remaining: 1 }, result: null };
}

export function adjudicate(moves, frames, playedPlies) {
  const previous = frames.at(-2).pending;
  const classify = classifyMoves(moves, frames);
  if (previous?.requiresQuiet) return continueAlternation(previous, moves.at(-1), classify, moves.length - 1);
  if (previous) return continueCycle(previous, moves.at(-1));
  const repetition = repeatedCycle(moves, frames);
  if (!repetition) {
    const pending = alternatingAttacks(moves, frames, classify);
    return pending ? { pending, result: null } : null;
  }
  const { cycle, entry, start } = repetition;
  const indices = cycle.map((_, index) => start + index);
  if (entry !== null) indices.unshift(entry);
  const checkers = sides.filter(side => indices.filter(index => moves[index].side === side)
    .every(index => moves[index].check));
  if (checkers.length === 1) return loss(checkers[0], 'perpetual-check');
  const styles = Object.fromEntries(sides.map(side => [side,
    profile(indices.filter(index => moves[index].side === side).map(classify)),
  ]));
  const required = obligatedSide(styles.red, styles.black);
  const side = required ?? (playedPlies + moves.length <= 50 ? 'red' : null);
  const reason = required ? styles[required].reason : 'repetition';
  return { pending: { side, reason, cycle, next: 0, remaining: side ? 2 : 4 }, result: null };
}
