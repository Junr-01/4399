// Only list playable games with a setup page.
export const games = Object.freeze([
  { id: 'gomoku', name: '五子棋', englishName: 'GOMOKU', category: '经典棋类', background: '#e5edcf', ink: '#39492d', href: '/gomoku.html' },
  { id: 'chess', name: '国际象棋', englishName: 'CHESS', category: '策略棋类', background: '#e2e8ed', ink: '#405162', href: '/chess.html' },
  { id: 'xiangqi', name: '中国象棋', englishName: 'XIANGQI', category: '经典棋类', background: '#f2e4d7', ink: '#8e5740', href: '/xiangqi.html' },
  { id: 'junqi', name: '军棋', englishName: 'JUNQI', category: '策略棋类', background: '#ebe7d9', ink: '#545d43', href: '/junqi.html' },
  { id: 'banqi', name: '暗棋', englishName: 'BANQI', category: '经典棋类', background: '#f0e1d4', ink: '#744d3e', href: '/banqi.html', cover: 'banqi.png' },
]);
