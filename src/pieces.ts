// パッチワークの全33枚のパッチ。cost=ボタン, time=時間, income=ボタン収入
export interface PieceDef {
  id: number;
  cost: number;
  time: number;
  income: number;
  cells: [number, number][];
  color: string;
}

const RAW: [number, number, number, string[]][] = [
  [2, 1, 0, ['##']], // 開始時ニュートラルトークンの直前に置く 2マスのパッチ
  [2, 2, 0, ['###']],
  [3, 3, 1, ['####']],
  [7, 1, 1, ['#####']],
  [6, 5, 2, ['##', '##']],
  [2, 2, 0, ['## ', '###']],
  [10, 5, 3, ['##  ', '####']],
  [7, 4, 2, [' ## ', '####']],
  [4, 2, 0, ['### ', ' ###']],
  [8, 6, 3, [' ##', ' ##', '## ']],
  [1, 2, 0, ['# #', '###']],
  [1, 5, 1, ['#  #', '####']],
  [3, 6, 2, ['# #', '###', ' # ']],
  [2, 2, 0, ['###', ' # ']],
  [5, 5, 2, ['###', ' # ', ' # ']],
  [7, 2, 2, ['###', ' # ', ' # ', ' # ']],
  [0, 3, 1, [' # ', '###', ' # ', ' # ']],
  [4, 2, 1, ['# ', '# ', '##']],
  [4, 6, 2, ['# ', '# ', '##']],
  [10, 3, 2, ['# ', '# ', '# ', '##']],
  [3, 4, 1, ['# ', '# ', '##', '# ']],
  [5, 4, 2, [' # ', '###', ' # ']],
  [1, 4, 1, [' # ', ' # ', '###', ' # ', ' # ']],
  [5, 3, 1, [' ## ', '####', ' ## ']],
  [2, 3, 0, ['# #', '###', '# #']],
  [3, 1, 0, [' #', '##']],
  [1, 3, 0, [' #', '##']],
  [3, 2, 1, [' #', '##', '# ']],
  [7, 6, 3, [' #', '##', '# ']],
  [2, 3, 1, [' #', ' #', '##', '# ']],
  [1, 2, 0, ['   #', '####', '#   ']],
  [2, 1, 0, ['  # ', '####', ' #  ']],
  [10, 4, 3, ['  #', ' ##', '## ']],
];

const COLORS = [
  '#c94c4c', '#e0874a', '#e6b84a', '#9cbf4a', '#4f9e5c', '#3f8f8a', '#4a86c4', '#5a64b8',
  '#8a5ab8', '#b85a9c', '#d47a8f', '#a8763e', '#6f8f3a', '#2f6f7a', '#7c94c9', '#c98f6a',
];

export const PIECES: PieceDef[] = RAW.map(([cost, time, income, rows], id) => {
  const cells: [number, number][] = [];
  rows.forEach((r, y) => [...r].forEach((c, x) => c === '#' && cells.push([x, y])));
  return { id, cost, time, income, cells, color: COLORS[(id * 7) % COLORS.length] };
});

export const LEATHER_ID = 100;
export const LEATHER_COLOR = '#7a4a2a';

export function normalize(cells: [number, number][]): [number, number][] {
  const mx = Math.min(...cells.map((c) => c[0]));
  const my = Math.min(...cells.map((c) => c[1]));
  return cells
    .map(([x, y]) => [x - mx, y - my] as [number, number])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** rot: 0-3 (90度単位), flip: 左右反転 */
export function transform(cells: [number, number][], rot: number, flip: boolean): [number, number][] {
  let out = cells.map(([x, y]) => [flip ? -x : x, y] as [number, number]);
  for (let i = 0; i < rot; i++) out = out.map(([x, y]) => [-y, x] as [number, number]);
  return normalize(out);
}

const key = (cells: [number, number][]) => cells.map((c) => c.join(',')).join(';');

export function orientations(cells: [number, number][]): [number, number][][] {
  const seen = new Map<string, [number, number][]>();
  for (const flip of [false, true])
    for (let r = 0; r < 4; r++) {
      const t = transform(cells, r, flip);
      seen.set(key(t), t);
    }
  return [...seen.values()];
}

export function isOrientationOf(piece: [number, number][], placed: [number, number][]): boolean {
  const k = key(normalize(placed));
  return orientations(piece).some((o) => key(o) === k);
}
