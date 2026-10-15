// ランダムな手で最後までプレイできることを確認する最低限のテスト
import { PIECES, orientations } from './pieces';
import { apply, canFit, currentPlayer, newGame, score, SIZE, type Action, type GameState } from './game';

function randomMove(s: GameState): Action {
  const i = currentPlayer(s);
  const board = s.players[i].board;
  if (s.pendingLeather > 0) {
    const e = board.findIndex((c) => c < 0);
    return { type: 'leather', x: e % SIZE, y: Math.floor(e / SIZE) };
  }
  for (let k = 0; k < 3 && k < s.circle.length; k++) {
    const pc = PIECES[s.circle[k]];
    if (pc.cost > s.players[i].buttons || Math.random() < 0.3) continue;
    for (const o of orientations(pc.cells))
      for (let y = 0; y < SIZE; y++)
        for (let x = 0; x < SIZE; x++) {
          const cells = o.map(([a, b]) => [a + x, b + y] as [number, number]);
          if (canFit(board, cells)) return { type: 'buy', idx: k, cells };
        }
  }
  return { type: 'advance' };
}

if (PIECES.length !== 33) throw new Error('パッチは33枚のはず');
for (let g = 0; g < 200; g++) {
  let s = newGame(['A', 'B'], g % 2);
  let n = 0;
  while (!s.over) {
    s = apply(s, currentPlayer(s), randomMove(s));
    if (++n > 1000) throw new Error('終わらない');
  }
  if (s.players.some((p) => p.pos !== 53)) throw new Error('ゴールしていない');
  if (s.leatherLeft.length !== 0) throw new Error('1×1パッチが残っている');
  void score;
}
// 手番でないプレイヤーの操作は拒否される
const s0 = newGame(['A', 'B'], 0);
let rejected = false;
try { apply(s0, 1, { type: 'advance' }); } catch { rejected = true; }
if (!rejected) throw new Error('手番外の操作が通った');
console.log('OK: 200ゲームを最後までプレイ');
