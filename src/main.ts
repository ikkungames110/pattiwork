import './style.css';
import { PIECES, LEATHER_ID, LEATHER_COLOR, transform } from './pieces';
import {
  type Action,
  type GameState,
  SIZE,
  END,
  INCOME_SPACES,
  apply,
  canFit,
  currentPlayer,
  emptyCount,
  newGame,
  score,
  winner,
} from './game';
import { host, join, type Msg, type Net } from './net';

type Mode = 'local' | 'host' | 'guest';

const app = document.getElementById('app')!;
const PLAYER_COLORS = ['#3c9a4c', '#e2b23b'];

let mode: Mode = 'local';
let me = 0;
let state: GameState | null = null;
let net: Net | null = null;
let teardown: (() => void) | null = null;
let banner = '';

// 配置 UI の状態
let sel: number | 'leather' | null = null;
let rot = 0;
let flip = false;
let anchor: [number, number] | null = null;
let lastPointer = 'mouse';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------------- ロビー ----------------

function savedName(): string {
  try {
    return localStorage.getItem('pattiwork-name') || '';
  } catch {
    return '';
  }
}
function saveName(n: string) {
  try {
    localStorage.setItem('pattiwork-name', n);
  } catch {
    /* noop */
  }
}

function renderLobby(msg = '') {
  const room = new URLSearchParams(location.search).get('room') || '';
  app.innerHTML = `
  <div class="lobby">
    <h1>Pattiwork</h1>
    <p class="sub">パッチワーク — 2人用キルト作りボードゲーム</p>
    <label class="field">あなたの名前<input id="name" maxlength="12" value="${esc(savedName())}" placeholder="プレイヤー"></label>
    <div class="cards">
      <section class="card">
        <h2>オンライン対戦 (P2P)</h2>
        <button id="host" class="primary">ルームを作成</button>
        <div class="or">または</div>
        <div class="row"><input id="code" maxlength="6" placeholder="ルームコード" value="${esc(room)}"><button id="join">参加</button></div>
      </section>
      <section class="card">
        <h2>ローカル対戦</h2>
        <p class="hint">1台の端末で交代しながら遊びます。</p>
        <button id="local">ローカルで開始</button>
      </section>
    </div>
    <div id="lobbymsg" class="msg">${msg}</div>
    <details class="rules"><summary>ルール概要</summary>
      <ul>
        <li>手番はタイムトラックで<strong>後ろにいる</strong>プレイヤー（同じマスなら上に乗っている方）。</li>
        <li><b>A: 進む</b> — 相手の1つ先のマスまで進み、進んだマス数だけボタンを得る。</li>
        <li><b>B: パッチを買う</b> — ニュートラルトークンの先3枚から1枚選び、ボタンを払ってボードに置く。時間分だけ進む。</li>
        <li>ボタンマークを通過すると、ボード上のボタン数ぶん収入。1×1パッチのマスを最初に通過した人はそれを置く。</li>
        <li>7×7 を最初に埋めた人は +7 点。両者がゴールしたら終了。得点 = ボタン − 空きマス×2 (+7)。</li>
        <li>操作: クリックで配置 / R・右クリックで回転 / F で反転 / Esc で取消。</li>
      </ul>
    </details>
  </div>`;
  const name = () => {
    const n = (document.getElementById('name') as HTMLInputElement).value.trim() || 'プレイヤー';
    saveName(n);
    return n;
  };
  document.getElementById('local')!.onclick = () => {
    mode = 'local';
    startLocal();
  };
  document.getElementById('host')!.onclick = () => startHost(name());
  document.getElementById('join')!.onclick = () => {
    const code = (document.getElementById('code') as HTMLInputElement).value.trim();
    if (code) startGuest(name(), code);
  };
}

function setLobbyMsg(html: string) {
  const el = document.getElementById('lobbymsg');
  if (el) el.innerHTML = html;
}

function startLocal() {
  state = newGame(['プレイヤー1', 'プレイヤー2'], Math.random() < 0.5 ? 0 : 1);
  resetSel();
  render();
}

let hostName = 'ホスト';

function hostNewGame(guestName: string) {
  state = newGame([hostName, guestName], Math.random() < 0.5 ? 0 : 1);
  resetSel();
  broadcast();
  render();
}

let guestName = 'ゲスト';

function startHost(name: string) {
  mode = 'host';
  me = 0;
  hostName = name;
  teardown?.();
  setLobbyMsg('ルームを作成中…');
  teardown = host({
    onCode(code) {
      const url = `${location.origin}${location.pathname}?room=${code}`;
      setLobbyMsg(`ルームコード: <b class="code">${code}</b><br>
        相手にコードかリンクを送ってください: <input class="link" readonly value="${url}" onclick="this.select()">
        <button id="copy">リンクをコピー</button><br><span class="hint">相手の参加を待っています…</span>`);
      const b = document.getElementById('copy');
      if (b) b.onclick = () => navigator.clipboard?.writeText(url).then(() => (b.textContent = 'コピーしました'));
    },
    onConn(n) {
      net = n;
    },
    onOpen() {
      banner = '';
    },
    onMessage(m: Msg) {
      if (m.t === 'hello') {
        guestName = m.name;
        if (state && !state.over) {
          broadcast(); // 再接続時は続きから
          render();
        } else hostNewGame(m.name);
      } else if (m.t === 'action') {
        doAction(1, m.action as Action);
      } else if (m.t === 'rematch') {
        if (state?.over) hostNewGame(guestName);
      }
    },
    onClose() {
      banner = '相手との接続が切れました。相手は同じコードで再参加できます。';
      render();
    },
    onError(e) {
      if (state) {
        banner = `通信エラー: ${e}`;
        render();
      } else setLobbyMsg(`エラー: ${esc(e)}`);
    },
  });
}

function startGuest(name: string, code: string) {
  mode = 'guest';
  teardown?.();
  setLobbyMsg('接続中…');
  const g = join(code, {
    onOpen() {
      banner = '';
      g.net.send({ t: 'hello', name });
      setLobbyMsg('接続しました。ゲーム開始を待っています…');
    },
    onMessage(m: Msg) {
      if (m.t === 'state') {
        me = m.you;
        const prevSeq = state?.seq;
        state = m.state as GameState;
        if (prevSeq !== state.seq) resetSel();
        render();
      } else if (m.t === 'error') {
        toast(m.message);
      }
    },
    onClose() {
      banner = 'ホストとの接続が切れました。';
      render();
    },
    onError(e) {
      if (state) {
        banner = `通信エラー: ${e}`;
        render();
      } else setLobbyMsg(`エラー: ${esc(e)}`);
    },
  });
  teardown = () => g.destroy();
  // join() 内で接続が確立してから net が差し替わるので getter 経由で送る
  net = { send: (m) => g.net.send(m), close: () => g.net.close() };
}

function broadcast() {
  if (mode === 'host' && net && state) net.send({ t: 'state', state, you: 1 });
}

// ---------------- アクション ----------------

function doAction(by: number, a: Action) {
  if (!state) return;
  try {
    state = apply(state, by, a);
    resetSel();
    broadcast();
    render();
  } catch (e) {
    const msg = (e as Error).message;
    if (mode === 'host' && by === 1) net?.send({ t: 'error', message: msg });
    else toast(msg);
  }
}

function act(a: Action) {
  if (!state) return;
  if (mode === 'guest') net?.send({ t: 'action', action: a });
  else doAction(mode === 'local' ? currentPlayer(state) : me, a);
}

function myTurn(): boolean {
  if (!state || state.over) return false;
  return mode === 'local' || currentPlayer(state) === me;
}

function viewer(): number {
  return mode === 'local' && state ? currentPlayer(state) : me;
}

function resetSel() {
  sel = null;
  rot = 0;
  flip = false;
  anchor = null;
  if (state && state.pendingLeather > 0 && myTurn()) sel = 'leather';
}

function selCells(): [number, number][] | null {
  if (sel === null) return null;
  if (sel === 'leather') return [[0, 0]];
  return transform(PIECES[state!.circle[sel]].cells, rot, flip);
}

function previewCells(): [number, number][] | null {
  const cells = selCells();
  if (!cells || !anchor) return null;
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  const ox = anchor[0] - Math.floor((w - 1) / 2);
  const oy = anchor[1] - Math.floor((h - 1) / 2);
  return cells.map(([x, y]) => [x + ox, y + oy] as [number, number]);
}

function tryPlace() {
  const cells = previewCells();
  if (!cells || !state) return;
  if (!canFit(state.players[viewer()].board, cells)) return toast('そこには置けません');
  if (sel === 'leather') act({ type: 'leather', x: cells[0][0], y: cells[0][1] });
  else if (sel !== null) act({ type: 'buy', idx: sel, cells });
}

// ---------------- 描画 ----------------

function buttonCells(board: number[]): Set<number> {
  // 各パッチのボタン数ぶん、そのパッチのセルにボタン印を付ける
  const res = new Set<number>();
  const used = new Map<number, number>();
  board.forEach((id, i) => {
    if (id < 0 || id === LEATHER_ID) return;
    const n = used.get(id) ?? 0;
    if (n < PIECES[id].income) {
      res.add(i);
      used.set(id, n + 1);
    }
  });
  return res;
}

function boardHTML(pi: number, interactive: boolean): string {
  const p = state!.players[pi];
  const btn = buttonCells(p.board);
  let cells = '';
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const id = p.board[i];
      let cls = 'cell';
      let style = '';
      if (id >= 0) {
        cls += ' filled';
        style = `background:${id === LEATHER_ID ? LEATHER_COLOR : PIECES[id].color};`;
        const diff = (nx: number, ny: number) =>
          nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE || p.board[ny * SIZE + nx] !== id;
        if (diff(x, y - 1)) cls += ' et';
        if (diff(x, y + 1)) cls += ' eb';
        if (diff(x - 1, y)) cls += ' el';
        if (diff(x + 1, y)) cls += ' er';
      }
      cells += `<div class="${cls}" data-x="${x}" data-y="${y}" style="${style}">${btn.has(i) ? '<i class="btn"></i>' : ''}</div>`;
    }
  const bonus = state!.bonus === pi ? '<span class="bonus" title="7×7ボーナス">7×7 +7</span>' : '';
  return `<div class="quilt-wrap"><div class="quilt-title" style="--pc:${PLAYER_COLORS[pi]}">${esc(p.name)} のキルト ${bonus}</div>
    <div class="quilt ${interactive ? 'interactive' : ''}" data-player="${pi}">${cells}</div></div>`;
}

function miniPiece(id: number, size = 12): string {
  const pc = PIECES[id];
  const w = Math.max(...pc.cells.map((c) => c[0])) + 1;
  const h = Math.max(...pc.cells.map((c) => c[1])) + 1;
  const btnIdx = new Set(pc.cells.slice(0, pc.income).map((c) => c.join(',')));
  const cells = pc.cells
    .map(
      ([x, y]) =>
        `<div style="grid-column:${x + 1};grid-row:${y + 1};background:${pc.color}">${btnIdx.has(`${x},${y}`) ? '<i class="btn"></i>' : ''}</div>`,
    )
    .join('');
  return `<div class="mini" style="grid-template-columns:repeat(${w},${size}px);grid-template-rows:repeat(${h},${size}px)">${cells}</div>`;
}

function circleHTML(): string {
  const s = state!;
  const p = s.players[viewer()];
  const turn = myTurn() && s.pendingLeather === 0;
  const items = s.circle
    .map((id, i) => {
      const pc = PIECES[id];
      const avail = i < 3;
      const afford = pc.cost <= p.buttons;
      const cls = ['patch', avail ? 'avail' : '', avail && turn && afford ? 'can' : '', sel === i ? 'sel' : '', avail && !afford ? 'poor' : '']
        .filter(Boolean)
        .join(' ');
      return `<div class="${cls}" data-idx="${i}">
        ${avail ? `<span class="num">${i + 1}</span>` : ''}
        ${miniPiece(id, avail ? 14 : 10)}
        <div class="stats"><span title="ボタン">●${pc.cost}</span><span title="時間">⌛${pc.time}</span></div>
      </div>`;
    })
    .join('');
  return `<div class="circle"><div class="token" title="ニュートラルトークン">🧵</div>${items}</div>`;
}

function spiral(): [number, number][] {
  // 8×8 の外周から内側へ渦巻き状に 54 マス
  const n = 8;
  const out: [number, number][] = [];
  let [t, b, l, r] = [0, n - 1, 0, n - 1];
  while (t <= b && l <= r) {
    for (let x = l; x <= r; x++) out.push([x, t]);
    t++;
    for (let y = t; y <= b; y++) out.push([r, y]);
    r--;
    for (let x = r; x >= l; x--) out.push([x, b]);
    b--;
    for (let y = b; y >= t; y--) out.push([l, y]);
    l++;
  }
  return out.slice(0, END + 1);
}
const SPIRAL = spiral();

function trackHTML(): string {
  const s = state!;
  const cells = SPIRAL.map(([x, y], i) => {
    let inner = '';
    if (INCOME_SPACES.includes(i)) inner += '<i class="btn big"></i>';
    if (s.leatherLeft.includes(i)) inner += '<span class="leather"></span>';
    const here = [0, 1].filter((pi) => s.players[pi].pos === i);
    if (here.length === 2) here.sort((a) => (a === s.top ? 1 : -1)); // 上に乗っている方を後に描画
    here.forEach((pi, k) => (inner += `<span class="tok" style="background:${PLAYER_COLORS[pi]};--k:${k}"></span>`));
    return `<div class="tcell ${i === 0 ? 'start' : ''} ${i === END ? 'goal' : ''}" style="grid-column:${x + 1};grid-row:${y + 1}" title="${i}">${inner}<em>${i}</em></div>`;
  }).join('');
  return `<div class="track">${cells}</div>`;
}

function playerPanel(pi: number): string {
  const s = state!;
  const p = s.players[pi];
  const cur = !s.over && currentPlayer(s) === pi;
  const you = mode !== 'local' && pi === me ? '<span class="you">あなた</span>' : '';
  return `<div class="pp ${cur ? 'cur' : ''}" style="--pc:${PLAYER_COLORS[pi]}">
    <div class="pname"><span class="dot"></span>${esc(p.name)} ${you}</div>
    <div class="pstats">
      <span title="所持ボタン">● <b>${p.buttons}</b></span>
      <span title="ボタン収入">収入 <b>${p.income}</b></span>
      <span title="位置">⌛ <b>${p.pos}</b>/${END}</span>
      <span title="空きマス">空き <b>${emptyCount(p)}</b></span>
      <span title="現時点の得点">得点 <b>${score(s, pi)}</b></span>
    </div>
  </div>`;
}

function controlsHTML(): string {
  const s = state!;
  if (s.over) {
    const w = winner(s);
    const again = mode === 'guest' ? '<button id="rematch">再戦をリクエスト</button>' : '<button id="again" class="primary">もう一度遊ぶ</button>';
    return `<div class="result"><h2>${esc(s.players[w].name)} の勝利！</h2>
      <p>${esc(s.players[0].name)}: ${score(s, 0)}点 ／ ${esc(s.players[1].name)}: ${score(s, 1)}点</p>
      ${again} <button id="leave">ロビーへ</button></div>`;
  }
  const cp = currentPlayer(s);
  if (!myTurn()) return `<div class="status">${esc(s.players[cp].name)} の手番です…</div>`;
  const who = mode === 'local' ? `${esc(s.players[cp].name)} の手番` : 'あなたの手番';
  if (s.pendingLeather > 0)
    return `<div class="status"><b>${who}</b>: 1×1 パッチをキルトに置いてください（残り${s.pendingLeather}）</div>`;
  const p = s.players[cp];
  const gain = Math.min(END, s.players[1 - cp].pos + 1) - p.pos;
  const selInfo =
    sel !== null && sel !== 'leather'
      ? `<button id="rot">↻ 回転 (R)</button><button id="flip">⇋ 反転 (F)</button><button id="cancel">取消 (Esc)</button>
         <span class="hint">キルト上をクリックして配置</span>`
      : '<span class="hint">パッチの輪から1〜3番目を選ぶか、進んでボタンを得ます</span>';
  return `<div class="status"><b>${who}</b>
    <button id="advance" class="primary">進む (+${gain}ボタン)</button>
    ${selInfo}</div>`;
}

function render() {
  if (!state) return renderLobby();
  const s = state;
  const v = viewer();
  const other = 1 - v;
  app.innerHTML = `
  <div class="game">
    <header>
      <h1>Pattiwork</h1>
      ${mode !== 'local' ? `<span class="mode">${mode === 'host' ? 'ホスト' : 'ゲスト'} · P2P</span>` : '<span class="mode">ローカル</span>'}
      <button id="leave2" class="ghost">退出</button>
    </header>
    ${banner ? `<div class="banner">${esc(banner)}</div>` : ''}
    <div class="players">${playerPanel(0)}${playerPanel(1)}</div>
    <div class="controls">${controlsHTML()}</div>
    ${circleHTML()}
    <div class="main">
      ${boardHTML(v, myTurn())}
      <div class="center">${trackHTML()}</div>
      ${boardHTML(other, false)}
    </div>
    <div class="log">${s.log.slice(-8).reverse().map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  </div>`;
  bind();
  paintPreview();
}

function paintPreview() {
  const quilt = app.querySelector('.quilt.interactive');
  if (!quilt || !state) return;
  quilt.querySelectorAll('.pv').forEach((el) => {
    el.classList.remove('pv', 'ok', 'ng');
    (el as HTMLElement).style.removeProperty('--pv');
  });
  const cells = previewCells();
  if (!cells) return;
  const ok = canFit(state.players[viewer()].board, cells);
  const color = sel === 'leather' ? LEATHER_COLOR : PIECES[state.circle[sel as number]].color;
  for (const [x, y] of cells) {
    const el = quilt.querySelector(`[data-x="${x}"][data-y="${y}"]`) as HTMLElement | null;
    if (el) {
      el.classList.add('pv', ok ? 'ok' : 'ng');
      el.style.setProperty('--pv', color);
    }
  }
}

function leaveGame() {
  teardown?.();
  teardown = null;
  net = null;
  state = null;
  banner = '';
  history.replaceState(null, '', location.pathname);
  renderLobby();
}

function bind() {
  const $ = (id: string) => document.getElementById(id);
  $('advance')?.addEventListener('click', () => act({ type: 'advance' }));
  $('rot')?.addEventListener('click', () => rotate());
  $('flip')?.addEventListener('click', () => doFlip());
  $('cancel')?.addEventListener('click', () => {
    resetSel();
    render();
  });
  $('again')?.addEventListener('click', () => (mode === 'host' ? hostNewGame(guestName) : startLocal()));
  $('rematch')?.addEventListener('click', () => {
    net?.send({ t: 'rematch' });
    toast('再戦をリクエストしました');
  });
  $('leave')?.addEventListener('click', leaveGame);
  $('leave2')?.addEventListener('click', () => {
    if (confirm('ゲームを退出しますか？')) leaveGame();
  });

  app.querySelectorAll('.patch.can').forEach((el) =>
    el.addEventListener('click', () => {
      const i = Number((el as HTMLElement).dataset.idx);
      if (sel === i) sel = null;
      else {
        sel = i;
        rot = 0;
        flip = false;
      }
      render();
    }),
  );

  const quilt = app.querySelector('.quilt.interactive') as HTMLElement | null;
  if (!quilt) return;
  const cellAt = (e: Event): [number, number] | null => {
    const t = (e.target as HTMLElement).closest('.cell') as HTMLElement | null;
    return t ? [Number(t.dataset.x), Number(t.dataset.y)] : null;
  };
  quilt.addEventListener('pointerdown', (e) => (lastPointer = e.pointerType));
  quilt.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const c = cellAt(e);
    if (c && (!anchor || c[0] !== anchor[0] || c[1] !== anchor[1])) {
      anchor = c;
      paintPreview();
    }
  });
  quilt.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') {
      anchor = null;
      paintPreview();
    }
  });
  quilt.addEventListener('click', (e) => {
    const c = cellAt(e);
    if (!c || sel === null) return;
    if (lastPointer !== 'mouse' && (!anchor || c[0] !== anchor[0] || c[1] !== anchor[1])) {
      // タッチ操作: 1回目のタップで位置決め、同じマスをもう一度タップで確定
      anchor = c;
      paintPreview();
      return;
    }
    anchor = c;
    tryPlace();
  });
  quilt.addEventListener('contextmenu', (e) => {
    if (sel === null) return;
    e.preventDefault();
    rotate();
  });
}

function rotate() {
  if (sel === null || sel === 'leather') return;
  rot = (rot + 1) % 4;
  updateAfterTransform();
}
function doFlip() {
  if (sel === null || sel === 'leather') return;
  flip = !flip;
  updateAfterTransform();
}
function updateAfterTransform() {
  paintPreview();
}

document.addEventListener('keydown', (e) => {
  if (!state || (e.target as HTMLElement).tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === 'r') rotate();
  else if (k === 'f') doFlip();
  else if (k === 'escape' && sel !== 'leather') {
    resetSel();
    render();
  } else if (['1', '2', '3'].includes(k) && myTurn() && state.pendingLeather === 0) {
    const i = Number(k) - 1;
    if (PIECES[state.circle[i]]?.cost <= state.players[viewer()].buttons) {
      sel = i;
      rot = 0;
      flip = false;
      render();
    }
  }
});

let toastTimer = 0;
function toast(msg: string) {
  let el = document.querySelector('.toast') as HTMLElement | null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 2200);
}

renderLobby();
