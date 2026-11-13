export const points = Array.from({ length: 60 }, (_, id) => {
  const row = Math.floor(id / 5);
  const col = id % 5;
  const halfRow = Math.min(row, 11 - row);
  const camp = ([2, 4].includes(halfRow) && [1, 3].includes(col)) || (halfRow === 3 && col === 2);
  const base = halfRow === 0 && [1, 3].includes(col);
  return { id, row, col, camp, base, x: 40 + col * 80, y: 26 + row * 41 + (row >= 6 ? 36 : 0) };
});

function connection(a, b) {
  const rows = Math.abs(a.row - b.row);
  const cols = Math.abs(a.col - b.col);
  if (rows + cols === 1) {
    if (a.row === 5 && b.row === 6) return a.col % 2 === 0 ? 'rail' : '';
    if (!rows && [1, 5, 6, 10].includes(a.row)) return 'rail';
    if (!cols && [0, 4].includes(a.col) && a.row >= 1 && b.row <= 10) return 'rail';
    return 'road';
  }
  if (rows === 1 && cols === 1 && (a.camp || b.camp)) return 'road';
  return '';
}

export const links = points.map(() => []);
export const lines = [];
for (const a of points) {
  for (const b of points.slice(a.id + 1)) {
    const type = connection(a, b);
    if (!type) continue;
    const axis = a.row === b.row ? 'horizontal' : 'vertical';
    links[a.id].push({ to: b.id, type, axis });
    links[b.id].push({ to: a.id, type, axis });
    lines.push({ a, b, type });
  }
}
