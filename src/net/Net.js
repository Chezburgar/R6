// Online transport: WebRTC data channels brokered by the public PeerJS cloud (no server of our own).
// One peer hosts a room and runs the authoritative simulation; the others send inputs and mirror
// the host's world. Messages are small JSON objects; the game-side replication lives in Sync.js.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_PREFIX = 'r6siege-border-';

class NetClass {
  constructor() {
    this.mode = 'off';            // 'off' | 'host' | 'client'
    this.peer = null; this.code = null; this.id = null;
    this.name = 'Operator';
    this.conns = new Map();       // host: peerId -> conn ; client: single 'host' entry
    this.players = [];            // lobby roster [{ id, name, side, ready }]
    this.handlers = new Map();
    this.onLobby = null; this.onError = null; this.onStatus = null;
    this.hostConn = null;
    this.stats = { in: 0, out: 0, rtt: 0 };
    this._pingT = 0;
  }
  get isHost() { return this.mode === 'host'; }
  get isClient() { return this.mode === 'client'; }
  get online() { return this.mode !== 'off'; }
  on(type, fn) { this.handlers.set(type, fn); }

  _status(s) { this.onStatus && this.onStatus(s); }
  _fail(msg) { console.warn('[net]', msg); this.onError && this.onError(msg); }

  _makePeer(id) {
    if (typeof Peer === 'undefined') { this._fail('PeerJS did not load (no internet?)'); return null; }
    const p = new Peer(id, { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] } });
    p.on('error', e => { this._fail(e.type === 'peer-unavailable' ? 'No room with that code' : e.type === 'unavailable-id' ? 'Room code taken, try again' : ('Network error: ' + e.type)); });
    p.on('disconnected', () => { this._status('signalling lost — reconnecting'); try { p.reconnect(); } catch (e) {} });
    return p;
  }

  // ---- host ----
  host(name) {
    this.leave(); this.name = name || 'Host';
    this.code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
    this.peer = this._makePeer(ROOM_PREFIX + this.code); if (!this.peer) return null;
    this.mode = 'host'; this._status('opening room…');
    this.peer.on('open', id => { this.id = id; this.players = [{ id: 'host', name: this.name, side: 'atk', ready: false, host: true }]; this._status('room open'); this._lobbyChanged(); });
    this.peer.on('connection', conn => {
      conn.on('open', () => {
        const pid = conn.peer;
        if (this.locked) { conn.send({ t: 'reject', why: 'Match in progress' }); setTimeout(() => conn.close(), 300); return; }
        if (this.players.length >= 10) { conn.send({ t: 'reject', why: 'Room full' }); setTimeout(() => conn.close(), 300); return; }
        this.conns.set(pid, conn);
        const atk = this.players.filter(p => p.side === 'atk').length, def = this.players.filter(p => p.side === 'def').length;
        this.players.push({ id: pid, name: conn.metadata && conn.metadata.name || 'Player', side: atk <= def ? 'atk' : 'def', ready: false });
        conn.on('data', d => this._recv(pid, d));
        conn.on('close', () => { this.conns.delete(pid); this.players = this.players.filter(p => p.id !== pid); this._lobbyChanged(); const h = this.handlers.get('leave'); h && h(pid); });
        this._lobbyChanged();
      });
    });
    return this.code;
  }
  // ---- client ----
  join(code, name) {
    this.leave(); this.name = name || 'Player'; this.code = (code || '').toUpperCase().trim();
    this.peer = this._makePeer(undefined); if (!this.peer) return;
    this.mode = 'client'; this._status('connecting…');
    this.peer.on('open', id => {
      this.id = id;
      const conn = this.peer.connect(ROOM_PREFIX + this.code, { reliable: true, metadata: { name: this.name } });
      this.hostConn = conn;
      conn.on('open', () => { this._status('connected'); this.conns.set('host', conn); });
      conn.on('data', d => this._recv('host', d));
      conn.on('close', () => { this._status('disconnected from host'); const h = this.handlers.get('hostLeft'); h && h(); this.leave(); });
      conn.on('error', e => this._fail('connection error'));
    });
  }
  leave() {
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    this.peer = null; this.conns.clear(); this.players = []; this.mode = 'off'; this.code = null; this.hostConn = null; this.locked = false;
  }

  // ---- lobby ----
  _lobbyChanged() { if (this.isHost) { this.broadcast({ t: 'lobby', players: this.players, settings: this.settings || null }); this.onLobby && this.onLobby(this.players); } }
  setSide(pid, side) { if (!this.isHost) { this.send({ t: 'side', side }); return; } const p = this.players.find(p => p.id === pid); if (p) { p.side = side; this._lobbyChanged(); } }
  setSettings(s) { this.settings = s; this._lobbyChanged(); }

  // ---- messaging ----
  send(msg) { if (this.isClient && this.hostConn && this.hostConn.open) { this.hostConn.send(msg); this.stats.out++; } }
  sendTo(pid, msg) { const c = this.conns.get(pid); if (c && c.open) { c.send(msg); this.stats.out++; } }
  broadcast(msg, except = null) { for (const [pid, c] of this.conns) { if (pid === except) continue; if (c.open) { c.send(msg); this.stats.out++; } } }
  _recv(from, d) {
    this.stats.in++;
    if (!d || typeof d !== 'object') return;
    if (d.t === 'lobby' && this.isClient) { this.players = d.players; this.settings = d.settings; this.onLobby && this.onLobby(this.players); return; }
    if (d.t === 'side' && this.isHost) { this.setSide(from, d.side); return; }
    if (d.t === 'reject') { this._fail(d.why); this.leave(); return; }
    if (d.t === 'pong') { this.stats.rtt = performance.now() - d.at; return; }
    if (d.t === 'ping') { if (this.isHost) this.sendTo(from, { t: 'pong', at: d.at }); else this.send({ t: 'pong', at: d.at }); return; }
    const h = this.handlers.get(d.t); if (h) h(d, from);
  }
  tick(dt) { this._pingT += dt; if (this._pingT > 2) { this._pingT = 0; const m = { t: 'ping', at: performance.now() }; if (this.isClient) this.send(m); } }
}
export const Net = new NetClass();
