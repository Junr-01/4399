// Add an internal href when a game is implemented. Until then its entry is explicit.
export const games = Object.freeze([
  { id: 'gomoku', name: '五子棋', englishName: 'GOMOKU', category: '经典棋类', background: '#e5edcf', ink: '#39492d', href: '/gomoku.html' },
  { id: 'chess', name: '国际象棋', englishName: 'CHESS', category: '策略棋类', background: '#e2e8ed', ink: '#405162', href: '/chess.html' },
  { id: 'xiangqi', name: '中国象棋', englishName: 'XIANGQI', category: '经典棋类', background: '#f2e4d7', ink: '#8e5740', href: '/xiangqi.html' },
  { id: 'junqi', name: '军棋', englishName: 'JUNQI', category: '策略棋类', background: '#ebe7d9', ink: '#545d43', href: '/junqi.html' },
  { id: '2048', name: '2048', englishName: 'MERGE & MATCH', category: '数字益智', background: '#eee7d6', ink: '#80704c', href: null },
  { id: 'snake', name: '贪吃蛇', englishName: 'SNAKE', category: '休闲街机', background: '#deeadf', ink: '#3b6b50', href: null },
]);
