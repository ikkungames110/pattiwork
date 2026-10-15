import Peer, { type DataConnection } from 'peerjs';

const PREFIX = 'pattiwork-v1-';

export type Msg =
  | { t: 'hello'; name: string }
  | { t: 'state'; state: unknown; you: number }
  | { t: 'action'; action: unknown }
  | { t: 'error'; message: string }
  | { t: 'rematch' };

export interface Net {
  send(m: Msg): void;
  close(): void;
}

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

interface Handlers {
  onMessage(m: Msg): void;
  onOpen(): void;
  onClose(): void;
  onError(e: string): void;
}

function wire(conn: DataConnection, h: Handlers): Net {
  conn.on('open', () => h.onOpen());
  conn.on('data', (d) => h.onMessage(d as Msg));
  conn.on('close', () => h.onClose());
  conn.on('error', (e) => h.onError(String(e)));
  return { send: (m) => conn.open && conn.send(m), close: () => conn.close() };
}

export interface HostHandlers extends Handlers {
  onCode(code: string): void;
  onConn(net: Net): void;
}

/** ホスト: ルームコードを発行して相手の接続を待つ */
export function host(h: HostHandlers): () => void {
  const code = randomCode();
  const peer = new Peer(PREFIX + code);
  let active: DataConnection | null = null;
  peer.on('open', () => h.onCode(code));
  peer.on('connection', (conn) => {
    if (active?.open) {
      conn.on('open', () => conn.close());
      return;
    }
    active = conn;
    const net = wire(conn, h);
    h.onConn(net);
  });
  peer.on('error', (e) => h.onError(e.type === 'unavailable-id' ? 'コードが重複しました。再作成してください' : String(e)));
  return () => peer.destroy();
}

/** ゲスト: ルームコードで接続する */
export function join(code: string, h: Handlers): { net: Net; destroy(): void } {
  const peer = new Peer();
  const ref: { net: Net } = { net: { send: () => {}, close: () => {} } };
  peer.on('open', () => {
    const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
    ref.net = wire(conn, h);
  });
  peer.on('error', (e) =>
    h.onError(e.type === 'peer-unavailable' ? 'ルームが見つかりません。コードを確認してください' : String(e)),
  );
  return {
    get net() {
      return ref.net;
    },
    destroy: () => peer.destroy(),
  };
}
