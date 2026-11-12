import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createXiangqi } from '../scripts/xiangqi-rules.mjs';

const at = square => (10 - Number(square.slice(1))) * 9 + square.charCodeAt(0) - 97;
const move = (from, to) => ({ from: at(from), to: at(to) });

test('starts with 32 pieces and 44 legal red moves on the standard board', () => {
  const game = createXiangqi();
  const state = game.snapshot();
  assert.equal(state.board.length, 90);
  assert.equal(state.board.filter(Boolean).length, 32);
  assert.equal(state.side, 'red');
  assert.equal(state.legal.length, 44);
  assert.ok(state.legal.some(legal => legal.from === at('h3') && legal.to === at('e3')));
  assert.equal(game.play(move('e1', 'e2')), true);
  assert.equal(game.snapshot().side, 'black');
  assert.equal(game.snapshot().board[at('e2')].type, 'k');
});

function play(game, sequence, repeats = 1) {
  for (let cycle = 0; cycle < repeats; cycle++) {
    for (const [from, to] of sequence) assert.equal(game.play(move(from, to)), true, `${from}-${to}`);
  }
  return game.snapshot();
}

const quietCycle = [['b1', 'c3'], ['b10', 'c8'], ['c3', 'b1'], ['c8', 'b10']];

// Figures and reference figures transcribe chapters 8 and 9 of 《象棋竞赛规则（2020版）》.
test('figure 6 adjudicates a unilateral perpetual check after three cycles', () => {
  const game = createXiangqi({ placement: '2e6/4k4/9/9/9/9/9/9/2p6/3K1REc1' });
  const cycle = [['f1', 'e1'], ['e9', 'f9'], ['e1', 'f1'], ['f9', 'e9']];
  assert.equal(play(game, cycle, 2).result, null);
  assert.deepEqual(play(game, cycle).result, { winner: 'black', reason: 'perpetual-check' });
  game.undoTo(8);
  assert.equal(game.snapshot().result, null);
});

test('red must deviate from an otherwise allowed repetition in the first 25 rounds', () => {
  const game = createXiangqi();
  const pending = play(game, quietCycle, 3);
  assert.equal(pending.result, null);
  assert.equal(pending.adjudication.side, 'red');
  assert.equal(pending.adjudication.remaining, 2);
  assert.deepEqual(play(game, quietCycle.slice(0, 3)).result, { winner: 'black', reason: 'failure-to-vary' });
  game.undoTo(12);
  assert.equal(play(game, [['h1', 'g3']]).adjudication, null);
});

test('an allowed repetition after the first 25 rounds draws if neither side varies', () => {
  const game = createXiangqi({ playedPlies: 50 });
  assert.equal(play(game, quietCycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, quietCycle).result, { winner: null, reason: 'repetition' });
});

test('figure 7 requires the side repeatedly threatening mate to vary', () => {
  const game = createXiangqi({ placement: '2eak1c2/4aRH1r/4e4/9/9/9/3pp4/2h1E4/9/2E1K3C', playedPlies: 50 });
  const cycle = [['i1', 'h1'], ['i9', 'h9'], ['h1', 'i1'], ['h9', 'i9']];
  const pending = play(game, cycle, 3);
  assert.deepEqual(pending.adjudication, { side: 'red', reason: 'perpetual-mate-threat', remaining: 2 });
  assert.deepEqual(play(game, cycle.slice(0, 3)).result, { winner: 'black', reason: 'failure-to-vary' });
});

test('a rook repeatedly chasing an unprotected horse must vary', () => {
  const game = createXiangqi({ placement: '4k4/9/2h6/9/9/1R7/9/9/9/3K5', playedPlies: 50 });
  const cycle = [['b5', 'c5'], ['c8', 'b6'], ['c5', 'b5'], ['b6', 'c8']];
  const pending = play(game, cycle, 3);
  assert.deepEqual(pending.adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

function position(board) {
  return board.map(piece => piece ? piece.side[0] + piece.type : '..').join('');
}

test('natural move count permits a draw claim after 60 capture-free rounds and rewinds on undo', () => {
  const game = createXiangqi();
  const seen = new Set([position(game.snapshot().board)]);
  for (let ply = 0; ply < 120; ply++) {
    const { board, legal } = game.snapshot();
    const next = legal.find(({ from, to }) => {
      if (board[to]) return false;
      const moved = board.slice();
      moved[to] = moved[from];
      moved[from] = null;
      const key = position(moved);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    assert.ok(next, `quiet move ${ply + 1}`);
    assert.equal(game.play(next), true);
  }
  assert.equal(game.claimDraw('black'), false);
  const beforeCapture = game.snapshot();
  const capture = beforeCapture.legal.find(({ to }) => beforeCapture.board[to]);
  assert.ok(capture);
  assert.equal(game.play(capture), true);
  assert.equal(game.snapshot().canClaimDraw, false);
  assert.equal(game.undoTo(120), true);
  assert.equal(game.claimDraw('red'), true);
  assert.deepEqual(game.snapshot().result, { winner: null, reason: 'no-capture' });
  assert.equal(game.undoTo(118), true);
  assert.equal(game.claimDraw('red'), false);
  assert.equal(game.snapshot().result, null);
});

test('the applicant can count at most ten checks toward natural move count', () => {
  const game = createXiangqi({ placement: '4k4/9/8r/9/9/2R6/8p/P8/9/3K5' });
  const seen = new Set([position(game.snapshot().board)]);
  let checks = 0;
  let seed = 1;
  for (let ply = 0; ply < 122; ply++) {
    const { board, legal, side } = game.snapshot();
    const quiet = legal.filter(({ to }) => !board[to]);
    // A repeatable walk visits distinct positions and interleaves checks with quiet moves.
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    const offset = seed % quiet.length;
    const preferCheck = side === 'red' && ply % 6 === 0 && checks < 12;
    let choice;
    for (const move of quiet.slice(offset).concat(quiet.slice(0, offset))) {
      assert.equal(game.play(move), true);
      const state = game.snapshot();
      const key = position(state.board);
      assert.equal(game.undoTo(ply), true);
      if (seen.has(key) || state.result || (side === 'red' && checks === 12 && state.check)) continue;
      const candidate = { move, key, check: state.check };
      choice ??= candidate;
      if (candidate.check === preferCheck) {
        choice = candidate;
        break;
      }
    }
    assert.ok(choice);
    assert.equal(game.play(choice.move), true);
    seen.add(choice.key);
    if (side === 'red' && choice.check) checks++;
    if (ply === 119) {
      assert.equal(checks, 12);
      assert.equal(game.claimDraw('red'), false);
    }
  }
  assert.equal(game.claimDraw('red'), true);
});

test('article 23.4 requires a quiet deviation after nine rounds of alternating attacks at three points', () => {
  const game = createXiangqi({ placement: '4k4/9/1hh6/8p/1R7/9/9/9/9/3K5', playedPlies: 50 });
  for (let rank = 7; rank >= 5; rank--) {
    const state = play(game, [['b6', 'e6'], ['e10', 'f10'], ['e6', 'c6'], ['f10', 'e10'],
      ['c6', 'b6'], ['i' + rank, 'i' + (rank - 1)]]);
    if (rank > 5) assert.equal(state.adjudication, null);
  }
  assert.deepEqual(game.snapshot().adjudication, {
    side: 'red', reason: 'alternating-threats', remaining: 2, requiresQuiet: true,
  });
  assert.deepEqual(play(game, [['b6', 'e6'], ['e10', 'f10'], ['e6', 'c6']]).result,
    { winner: 'black', reason: 'failure-to-vary' });
  game.undoTo(18);
  assert.equal(play(game, [['b6', 'd6']]).adjudication, null);
});

test('a side with no legal reply loses, with separate reasons for checkmate and stalemate', () => {
  const stalemate = createXiangqi({ placement: '4k4/3R5/5R3/9/9/9/9/9/9/3K5' });
  assert.deepEqual(play(stalemate, [['f8', 'f9']]).result, { winner: 'red', reason: 'stalemate' });
  const mate = createXiangqi({ placement: '4k4/5R3/3R5/9/9/9/9/9/9/3K5' });
  assert.deepEqual(play(mate, [['d8', 'd10']]).result, { winner: 'red', reason: 'checkmate' });
  assert.equal(mate.undoTo(0), true);
  assert.equal(mate.snapshot().result, null);
});

test('blocked horses and elephants, a screened cannon and facing kings restrict legal targets', () => {
  const game = createXiangqi({ placement: '4k4/9/9/4p4/9/9/4R4/1PH1C4/3P5/2E1K4' });
  const legal = game.snapshot().legal;
  const can = (from, to) => legal.some(legal => legal.from === at(from) && legal.to === at(to));
  assert.equal(can('c3', 'a4'), false);
  assert.equal(can('c3', 'b5'), true);
  assert.equal(can('c1', 'e3'), false);
  assert.equal(can('c1', 'a3'), true);
  assert.equal(can('e3', 'e7'), true);
  assert.equal(can('e3', 'e5'), false);
  assert.equal(can('e1', 'd2'), false);
  const facing = createXiangqi({ placement: '4k4/9/9/9/4R4/9/9/9/9/4K4' });
  assert.equal(facing.play(move('e6', 'd6')), false);
});

test('figure 4 counts a cannon-for-horse exchange that wins a pawn as a chase', () => {
  const game = createXiangqi({ placement: '4k4/4a4/4ea2e/5H3/2h5C/4p2p1/5h3/5A3/4A4/2E2K3', playedPlies: 50 });
  const cycle = [['f7', 'd6'], ['i8', 'g6'], ['d6', 'f7'], ['g6', 'i8']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 9 requires black to vary when red alternates a chase and an exchange', () => {
  const game = createXiangqi({ placement: 'r1e1kae2/4a4/2h6/p3p2Rp/2p1P4/6H2/P1P5P/2H1C4/3RA4/1cEAK1c1r', playedPlies: 50 });
  const cycle = [['g5', 'h3'], ['i1', 'h1'], ['h3', 'g5'], ['h1', 'i1']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'black', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 3 permits a draw when both sides persist in comparable prohibited chases', () => {
  const game = createXiangqi({ placement: '5a3/5k3/4P4/p7p/9/8P/P8/4E4/2hRA2r1/2EAK4', playedPlies: 50 });
  const cycle = [['e3', 'g1'], ['h2', 'g2'], ['g1', 'e3'], ['g2', 'h2']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('figure 8 distinguishes a check-and-chase cycle from a chase-and-idle cycle', () => {
  const game = createXiangqi({ placement: '3a3R1/3Hck3/3ae4/P4r3/2e6/8p/2p5h/C3EA2E/4A4/4K4', playedPlies: 50 });
  const cycle = [['h10', 'h4'], ['f9', 'f10'], ['h4', 'h10'], ['f10', 'f9']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 18 treats an incidental attack on an elephant from a defensive square as quiet', () => {
  const game = createXiangqi({ placement: '3k1a3/4a4/e3e4/9/9/4R4/4h4/3Ar4/3KA4/9', playedPlies: 50 });
  const cycle = [['e5', 'd5'], ['d10', 'e10'], ['d5', 'e5'], ['e10', 'd10']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 8 requires a deviation even when nine rounds do not follow a fixed period', () => {
  const game = createXiangqi({ placement: '2R6/3ka4/3a5/9/9/4p4/8c/4E1r2/4A4/3A1KE2' });
  const sequence = [
    ['c10', 'c9'], ['d9', 'd10'], ['c9', 'c10'], ['d10', 'd9'], ['c10', 'i10'], ['i4', 'h4'],
    ['i10', 'h10'], ['h4', 'i4'], ['h10', 'i10'], ['i4', 'h4'], ['i10', 'h10'], ['h4', 'i4'],
    ['h10', 'h4'], ['i4', 'i1'], ['h4', 'h1'], ['i1', 'i4'], ['h1', 'h4'], ['i4', 'i1'],
  ];
  assert.deepEqual(play(game, sequence).adjudication, {
    side: 'red', reason: 'alternating-threats', remaining: 2, requiresQuiet: true,
  });
});

test('reference figure 14 requires a lone horse to vary against a rook and cannon jointly chasing a rook', () => {
  const game = createXiangqi({ placement: 'r1eakae2/9/2h1c4/p3p3p/2p3Ph1/3R5/P1PCP3P/H3C3H/4A4/R1EAK1c1r', playedPlies: 50 });
  const cycle = [['i3', 'g2'], ['i1', 'h1'], ['g2', 'i3'], ['h1', 'i1']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 13 allows a cycle of checks and safe cannon exchanges', () => {
  const game = createXiangqi({ placement: '3k1ae2/4a4/4c4/4R3p/3PC4/4r4/8P/9/9/5K3', playedPlies: 50 });
  const cycle = [['e7', 'd7'], ['d10', 'e10'], ['d7', 'e7'], ['e10', 'd10']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('article 23.2 includes an outside first move unless it was a capture', () => {
  const entry = [['c9', 'e9'], ['e10', 'f10'], ['e9', 'f9'], ['f10', 'e10']];
  const cycle = [['f9', 'e9'], ...entry.slice(1)];
  const game = createXiangqi({ placement: '4k4/2R6/9/9/9/9/9/9/9/3K5' });
  play(game, entry);
  assert.deepEqual(play(game, cycle, 2).result, { winner: 'black', reason: 'perpetual-check' });

  const capture = createXiangqi({ placement: '4k4/2R1p4/9/9/9/9/9/9/9/3K5' });
  play(capture, entry);
  assert.equal(play(capture, cycle, 2).result, null);
  assert.deepEqual(play(capture, cycle.slice(0, 1)).result, { winner: 'black', reason: 'perpetual-check' });
});
