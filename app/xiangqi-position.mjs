export const initialPlacement = 'rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR';
const rows = 10;
const columns = 9;

export function parseBoard(placement) {
  const ranks = placement.split('/');
  if (ranks.length !== rows) throw new Error('象棋局面需要十行。');
  return ranks.flatMap((rank, row) => {
    const squares = [...rank].flatMap(char => {
      if (/^[1-9]$/.test(char)) return Array(Number(char)).fill(null);
      if (!/^[rheakcp]$/i.test(char)) throw new Error('无效的象棋棋子。');
      return [{ type: char.toLowerCase(), side: char === char.toUpperCase() ? 'red' : 'black' }];
    });
    if (squares.length !== columns) throw new Error('象棋局面每行需要九个点。');
    return squares.map((piece, col) => piece && { ...piece, id: row * columns + col });
  });
}
