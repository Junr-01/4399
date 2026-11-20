export const seatColors = Object.freeze(['红', '琥珀', '绿', '蓝', '紫', '青']);

const layouts = {
  2: Object.freeze([0, 3]),
  3: Object.freeze([0, 2, 4]),
  4: Object.freeze([0, 1, 3, 4]),
  5: Object.freeze([0, 1, 2, 4, 5]),
  6: Object.freeze([0, 1, 2, 3, 4, 5]),
};

export function seatsFor(playerCount) {
  return Number.isInteger(playerCount) ? layouts[playerCount] : undefined;
}

export function opposite(seat) {
  return (seat + 3) % seatColors.length;
}

function createPoints() {
  const points = [];
  for (let r = -8; r <= 8; r += 1) {
    for (let q = -8; q <= 8; q += 1) {
      const s = -q - r;
      // Beyond one side of the central hexagon is that side's triangular camp.
      const camp = [r, -q, s, -r, q, -s].map((axis, seat) => axis > 4 ? seat : null)
        .filter(seat => seat !== null);
      if (camp.length <= 1) points.push(Object.freeze({ id: points.length, q, r, camp: camp[0] ?? null }));
    }
  }
  return Object.freeze(points);
}

export const points = createPoints();
export const camps = Object.freeze(seatColors.map((_, seat) => Object.freeze(
  points.filter(point => point.camp === seat).map(point => point.id),
)));
