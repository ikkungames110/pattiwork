import { PIECES, LEATHER_ID, isOrientationOf } from './pieces';

export const SIZE = 9;
export const END = 53;
export const INCOME_SPACES = [5, 11, 17, 23, 29, 35, 41, 47, 53];
export const LEATHER_SPACES = [20, 26, 32, 44, 50];
export const START_BUTTONS = 5;

export interface Player {
  name: string;
  pos: number;
  buttons: number;
  income: number;
  board: number[]; // 81マス, -1=空き, それ以外は配置したパッチID
}

export interface GameState {
  players: Player[];
  circle: number[]; // circle[0] がニュートラルトークンの次（時計回り）
  top: number; // 同じマスにいる時に上に乗っているプレイヤー
  leatherLeft: number[];
  pendingLeather: number;
  pendingPlayer: number;
  bonus: number | null;
  finishOrder: number[];
  over: boolean;
  log: string[];
  seq: number;
}

export type Action =
  | { type: 'advance' }
  | { type: 'buy'; idx: number; cells: [number, number][] }
  | { type: 'leather'; x: number; y: number };

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newGame(names: [string, string], first: number): GameState {
  const rest = shuffle(PIECES.slice(1).map((p) => p.id));
  const mk = (name: string): Player => ({
    name,
    pos: 0,
    buttons: START_BUTTONS,
    income: 0,
    board: Array(SIZE * SIZE).fill(-1),
  });
  return {
    players: [mk(names[0]), mk(names[1])],
    // 2マスのパッチ(ID 0)の直後にトークンを置く → 円の最後尾に配置
    circle: [...rest, 0],
    top: first,
    leatherLeft: [...LEATHER_SPACES],
    pendingLeather: 0,
    pendingPlayer: 0,
    bonus: null,
    finishOrder: [],
    over: false,
    log: [`ゲーム開始。${names[first]} が先手です。`],
    seq: 0,
  };
}

export function currentPlayer(s: GameState): number {
  if (s.pendingLeather > 0) return s.pendingPlayer;
  const [a, b] = s.players;
  if (a.pos < b.pos) return 0;
  if (b.pos < a.pos) return 1;
  return s.top;
}

export function emptyCount(p: Player): number {
  return p.board.filter((c) => c < 0).length;
}

export function score(s: GameState, i: number): number {
  const p = s.players[i];
  return p.buttons - 2 * emptyCount(p) + (s.bonus === i ? 7 : 0);
}

export function winner(s: GameState): number {
  const d = score(s, 0) - score(s, 1);
  if (d !== 0) return d > 0 ? 0 : 1;
  return s.finishOrder[0] ?? 0; // 同点なら先にゴールした方
}

export function canFit(board: number[], cells: [number, number][]): boolean {
  return cells.every(([x, y]) => x >= 0 && y >= 0 && x < SIZE && y < SIZE && board[y * SIZE + x] < 0);
}

function has7x7(board: number[]): boolean {
  for (let oy = 0; oy <= SIZE - 7; oy++)
    for (let ox = 0; ox <= SIZE - 7; ox++) {
      let ok = true;
      for (let y = 0; y < 7 && ok; y++)
        for (let x = 0; x < 7 && ok; x++) if (board[(oy + y) * SIZE + ox + x] < 0) ok = false;
      if (ok) return true;
    }
  return false;
}

function afterPlace(s: GameState, i: number) {
  if (s.bonus === null && has7x7(s.players[i].board)) {
    s.bonus = i;
    s.log.push(`${s.players[i].name} が 7×7 を完成させ、ボーナスタイル(+7点)を獲得！`);
  }
}

function moveToken(s: GameState, i: number, steps: number) {
  const p = s.players[i];
  const from = p.pos;
  const to = Math.min(END, from + steps);
  p.pos = to;
  for (const sp of INCOME_SPACES)
    if (sp > from && sp <= to && p.income > 0) {
      p.buttons += p.income;
      s.log.push(`${p.name} がボタン収入で ${p.income} ボタン獲得。`);
    }
  for (const sp of [...s.leatherLeft])
    if (sp > from && sp <= to) {
      s.leatherLeft = s.leatherLeft.filter((x) => x !== sp);
      if (emptyCount(p) > s.pendingLeather) {
        s.pendingLeather++;
        s.pendingPlayer = i;
        s.log.push(`${p.name} が 1×1 の特殊パッチを獲得。`);
      }
    }
  const o = s.players[1 - i];
  if (o.pos === to) s.top = i;
  if (to === END && !s.finishOrder.includes(i)) s.finishOrder.push(i);
}

function checkOver(s: GameState) {
  if (s.pendingLeather === 0 && s.players.every((p) => p.pos >= END)) {
    s.over = true;
    const w = winner(s);
    s.log.push(`ゲーム終了！ ${s.players[0].name}: ${score(s, 0)}点 / ${s.players[1].name}: ${score(s, 1)}点。${s.players[w].name} の勝利！`);
  }
}

export function canAfford(s: GameState, i: number): boolean[] {
  return s.circle.slice(0, 3).map((id) => PIECES[id].cost <= s.players[i].buttons);
}

/** 不正なアクションなら例外を投げる。成功時は新しい state を返す */
export function apply(prev: GameState, by: number, a: Action): GameState {
  if (prev.over) throw new Error('ゲームは終了しています');
  if (currentPlayer(prev) !== by) throw new Error('あなたの手番ではありません');
  const s: GameState = structuredClone(prev);
  const p = s.players[by];

  if (s.pendingLeather > 0) {
    if (a.type !== 'leather') throw new Error('先に 1×1 パッチを配置してください');
    if (!canFit(p.board, [[a.x, a.y]])) throw new Error('そこには置けません');
    p.board[a.y * SIZE + a.x] = LEATHER_ID;
    s.pendingLeather--;
    afterPlace(s, by);
  } else if (a.type === 'advance') {
    const target = Math.min(END, s.players[1 - by].pos + 1);
    const gain = target - p.pos;
    p.buttons += gain;
    s.log.push(`${p.name} が ${gain} マス進み ${gain} ボタン獲得。`);
    moveToken(s, by, gain);
  } else if (a.type === 'buy') {
    if (a.idx < 0 || a.idx > 2 || a.idx >= s.circle.length) throw new Error('そのパッチは選べません');
    const piece = PIECES[s.circle[a.idx]];
    if (piece.cost > p.buttons) throw new Error('ボタンが足りません');
    if (a.cells.length !== piece.cells.length || !isOrientationOf(piece.cells, a.cells))
      throw new Error('形が一致しません');
    if (!canFit(p.board, a.cells)) throw new Error('そこには置けません');
    p.buttons -= piece.cost;
    p.income += piece.income;
    for (const [x, y] of a.cells) p.board[y * SIZE + x] = piece.id;
    s.circle = [...s.circle.slice(a.idx + 1), ...s.circle.slice(0, a.idx)];
    s.log.push(`${p.name} がパッチ(${piece.cost}ボタン/${piece.time}時間)を購入。`);
    afterPlace(s, by);
    moveToken(s, by, piece.time);
  } else {
    throw new Error('不正なアクションです');
  }
  checkOver(s);
  s.seq++;
  return s;
}
