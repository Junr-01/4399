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

for (const playedPlies of [0, 60]) {
  test(`figure 12 requires black to vary from a cannon chase after ${playedPlies / 2} prior rounds`, () => {
    const game = createXiangqi({ placement: '3k2P2/P3a4/6rc1/8R/9/9/9/E3E4/4A4/4KA3', playedPlies });
    const cycle = [['i7', 'h7'], ['h8', 'i8'], ['h7', 'i7'], ['i8', 'h8']];
    assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'black', reason: 'perpetual-chase', remaining: 2 });
    assert.deepEqual(play(game, cycle).result, { winner: 'red', reason: 'failure-to-vary' });
  });
}

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

test('figure 23 requires red to vary when the opposing cannon would lose a rook by capturing', () => {
  const game = createXiangqi({ placement: '2eakr3/4a4/4e4/9/9/9/1r7/1c3A2E/2R1A2H1/1R3K3', playedPlies: 60 });
  const cycle = [['c2', 'c3'], ['b3', 'b2'], ['c3', 'c2'], ['b2', 'b3']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
  assert.deepEqual(play(game, cycle.slice(0, 3)).result, { winner: 'black', reason: 'failure-to-vary' });
});

test('figure 24 allows a draw when a pawn-for-horse offer alternates with a chase', () => {
  const game = createXiangqi({ placement: '2P1kh3/4r4/9/9/p3p3R/9/4P4/4E4/9/2EAKA3', playedPlies: 60 });
  const cycle = [['i6', 'i10'], ['e9', 'f9'], ['i10', 'i6'], ['f9', 'e9']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('figure 16 still requires red to vary when successive checks create a new rook capture', () => {
  const game = createXiangqi({ placement: '3a1k3/4a4/3ce4/P2rp2R1/6e2/9/9/5C3/4A4/4KA3', playedPlies: 60 });
  const cycle = [['h7', 'h10'], ['f10', 'f9'], ['h10', 'h7'], ['f9', 'f10']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 21 requires black to vary when a safe exchange does not cover a new sacrifice', () => {
  const game = createXiangqi({ placement: '2e1ka3/1c2aR1c1/4e4/p1p4hp/4hH3/2P1C4/P5PrP/2H1EC3/9/3AKAE2', playedPlies: 60 });
  const cycle = [['f9', 'f7'], ['b9', 'b7'], ['f7', 'f9'], ['b7', 'b9']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'black', reason: 'perpetual-chase', remaining: 2 });
});

test('figure 5 allows a draw when a rook check alternates with a move adding no capture', () => {
  const game = createXiangqi({ placement: '2R2a3/4k4/3a5/9/8p/9/1p1rph3/3CE4/4A4/2E1KA3', playedPlies: 60 });
  const cycle = [['c10', 'c5'], ['e9', 'e10'], ['c5', 'c10'], ['e10', 'e9']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

for (const [figure, placement, cycle] of [
  [32, '2e1kc3/4a4/4ea3/4P1H2/9/2E6/9/4Eh3/5K3/9', [['g7', 'h9'], ['f10', 'f9'], ['h9', 'g7'], ['f9', 'f10']]],
  [33, '2e1k4/1H1ca4/5a3/5P3/9/9/p8/5A3/4A1h2/3K5', [['b9', 'c7'], ['d9', 'd10'], ['c7', 'b9'], ['d10', 'd9']]],
]) {
  test(`reference figure ${figure} allows a draw after an even exchange and a separate king or pawn capture`, () => {
    const game = createXiangqi({ placement, playedPlies: 60 });
    assert.equal(play(game, cycle, 3).adjudication.side, null);
    assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
  });
}

for (const [figure, placement, cycle, side] of [
  [39, '4kae2/4arHC1/4e1R2/4h4/2p3pc1/9/4P3P/4E4/4A4/2EAK4',
    [['g8', 'g7'], ['e7', 'f5'], ['g7', 'g8'], ['f5', 'e7']], 'black'],
  [49, '3akae2/3ch1C2/4e2C1/pH6R/1r1h2p2/9/P1p1P1P1P/1c2E4/5H3/2EAKA3',
    [['b7', 'c9'], ['b6', 'c6'], ['c9', 'b7'], ['c6', 'b6']], 'red'],
  [50, '3akae2/3ch1C2/4e2C1/pH6R/1r1h2p2/9/P1p1P1P1P/4E4/9/2EAKA3',
    [['b7', 'c9'], ['b6', 'c6'], ['c9', 'b7'], ['c6', 'b6']], 'red'],
]) {
  test(`reference figure ${figure} counts moves by a piece that sustains a joint chase`, () => {
    const game = createXiangqi({ placement, playedPlies: 60 });
    assert.deepEqual(play(game, cycle, 3).adjudication, { side, reason: 'perpetual-chase', remaining: 2 });
  });
}

test('reference figure 45 counts a cannon joining an existing chase of the same elephant', () => {
  const game = createXiangqi({ placement: '3a1kC2/4ac2h/4e3r/p2P1R2p/4p1e2/9/P3PH2P/4E4/4A4/2EAK4', playedPlies: 60 });
  const cycle = [['g10', 'i10'], ['i9', 'g8'], ['i10', 'g10'], ['g8', 'i9']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('figure 28 requires black to vary against a cycle mixing solo and joint chases', () => {
  const game = createXiangqi({ placement: 'CR1akae1r/9/2h1e1h2/2p5p/6p2/2P6/r3P1P1P/4CcH2/9/2EAK1ER1', playedPlies: 60 });
  for (const horse of ['e9', 'e7']) {
    const cycle = [['b10', 'c10'], ['c8', horse], ['c10', 'b10'], [horse, 'c8']];
    assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'black', reason: 'perpetual-chase', remaining: 2 });
    game.undoTo(0);
  }
});

test('reference figure 4 allows a draw when a new cannon screen invites a safe exchange', () => {
  const game = createXiangqi({ placement: '1reakaer1/9/1Ch1c1h1c/p1p1p2Cp/6p2/9/P1P1P1P1P/2H1E1H2/9/1R1AKAER1', playedPlies: 60 });
  const cycle = [['b8', 'b7'], ['c8', 'a9'], ['b7', 'b8'], ['a9', 'c8']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 27 still requires a change when trading separate rooks would break even', () => {
  const game = createXiangqi({ placement: '2ea1k3/4a4/4e4/R2C1rp1p/2p6/6P2/9/3AE4/2r1A4/3HK1E2', playedPlies: 60 });
  const cycle = [['d7', 'c7'], ['c2', 'd2'], ['c7', 'd7'], ['d2', 'c2']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('reference figure 11 distinguishes a discovered cannon check from a pawn chasing alone', () => {
  const game = createXiangqi({ placement: '3k4C/4a4/4e3e/p8/5P2P/4c4/5p3/4EA3/4A4/4K1E2', playedPlies: 60 });
  const cycle = [['e1', 'f1'], ['e5', 'f5'], ['f1', 'e1'], ['f5', 'e5']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 34 counts a rook escaping a counterattack while sustaining a chase', () => {
  const game = createXiangqi({ placement: '3k1ae2/4a4/4e4/2p4R1/6p2/3r5/6P1P/4EA3/2C1K4/6E1c', playedPlies: 60 });
  const cycle = [['h7', 'h1'], ['i1', 'i3'], ['h1', 'h7'], ['i3', 'i1']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('reference figure 22 does not credit a chase to a reply when the opponent broke its own support', () => {
  const game = createXiangqi({ placement: '3a1k3/4a4/5c3/2p1C4/4r4/5R3/2P1P4/6H2/4A4/2c1KA3', playedPlies: 60 });
  const cycle = [['f5', 'e5'], ['f8', 'b8'], ['e5', 'f5'], ['b8', 'f8']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 35 counts the cannon chase made viable by defusing mate', () => {
  const game = createXiangqi({ placement: '2eak4/4a4/r1h1e4/p1R2H3/2p6/5r3/P1c3P2/4E3H/R8/2EAKA3', playedPlies: 60 });
  const cycle = [['f7', 'd6'], ['f5', 'd5'], ['d6', 'f7'], ['d5', 'f5']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 7 allows a draw when the only follow-up is a pawn capture', () => {
  const game = createXiangqi({ placement: '3a1k3/3Pa4/e8/7R1/9/2P6/c1php4/3AE4/4A4/4K1E2', playedPlies: 60 });
  const cycle = [['h7', 'h10'], ['f10', 'f9'], ['h10', 'h7'], ['f9', 'f10']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 25 counts a rook capture when either recapture allows immediate mate', () => {
  const game = createXiangqi({ placement: '2ea1ke2/4a2r1/4c1h2/p7p/2p2rpc1/4R4/P1PR4P/2H1C1H2/4A4/2EK1AE2', playedPlies: 60 });
  const cycle = [['e3', 'f3'], ['f10', 'e10'], ['f3', 'e3'], ['e10', 'f10']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
});

test('reference figure 30 does not credit an incidental pawn capture to defensive king moves', () => {
  const game = createXiangqi({ placement: '2e2R3/5P3/e3k3h/5hp2/2P6/9/1pp6/3CE4/4A4/4KAE1r', playedPlies: 60 });
  const cycle = [['f10', 'g10'], ['e8', 'f8'], ['g10', 'f10'], ['f8', 'e8']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-mate-threat', remaining: 2 });
});

test('reference figure 28 allows a draw when the threatened gain only offsets a lost piece', () => {
  const game = createXiangqi({ placement: '3a1k3/h1H1a4/2r6/9/9/2P5p/9/7R1/4A4/3AK4', playedPlies: 60 });
  const cycle = [['h3', 'f3'], ['e9', 'f8'], ['f3', 'h3'], ['f8', 'e9']];
  assert.equal(play(game, cycle, 3).adjudication.side, null);
  assert.deepEqual(play(game, cycle).result, { winner: null, reason: 'repetition' });
});

test('reference figure 16 treats a rook-escorted pawn as a joint chase', () => {
  const game = createXiangqi({ placement: '4k4/9/3ae4/4PR3/4r4/9/5p3/4EA3/9/2E1K4', playedPlies: 60 });
  const cycle = [['e7', 'd7'], ['e6', 'd6'], ['d7', 'e7'], ['d6', 'e6']];
  assert.deepEqual(play(game, cycle, 3).adjudication, { side: 'red', reason: 'perpetual-chase', remaining: 2 });
  assert.deepEqual(play(game, cycle.slice(0, 3)).result, { winner: 'black', reason: 'failure-to-vary' });
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
