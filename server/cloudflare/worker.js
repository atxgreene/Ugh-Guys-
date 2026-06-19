// Cloudflare Workers + Durable Objects port of the lockstep relay.
//
// Why this exists: it's the free, always-on, globally-distributed way to host the relay
// — no server to babysit, no cold-start that drops a lobby, and Durable Objects are on
// the Workers free plan. The wire protocol is byte-for-byte the same as the Node relay
// in ../relay.mjs, so the browser client (src/net.js) connects unchanged — only the URL
// differs (wss://<worker>.workers.dev).
//
// Architecture: the Worker authenticates the upgrade (origin allowlist) and forwards
// every WebSocket to ONE Durable Object instance ("hub") that holds all rooms and the
// matchmaking queue in memory — mirroring the single-process Node relay. A single DO
// comfortably handles thousands of sockets, which is plenty for this game; if you ever
// need to shard, split by room via idFromName(room) instead.

const MAX_ROOM = 2;             // 1v1 lockstep → 2 seats; a stranger can't sneak in as a 3rd
const MAX_FRAME_BYTES = 64 * 1024;
const RATE_LIMIT = 60;          // messages/sec per socket
const MAX_SOCKETS = 2000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') {
      // health check / friendly root
      return new Response('SotW lockstep relay — ok\n', { headers: { 'content-type': 'text/plain' } });
    }
    // Origin allowlist: only your game may use the relay. Set ALLOWED_ORIGINS (a comma
    // separated list) in wrangler.toml / dashboard. Empty = allow all (dev only).
    const allow = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin') || '';
    // entries may contain '*' wildcards (e.g. https://mygame-*.vercel.app) to cover
    // rotating preview URLs without listing each one
    const ok = allow.some(pat =>
      new RegExp('^' + pat.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(origin));
    if (allow.length && !ok) return new Response('forbidden origin', { status: 403 });

    const id = env.HUB.idFromName('hub');
    return env.HUB.get(id).fetch(request);
  },
};

export class RelayHub {
  constructor(state) {
    this.state = state;
    this.rooms = new Map();   // room -> Set<ws>
    this.queue = [];          // ws[] waiting for a quick match
    this.meta = new Map();    // ws -> { room, ready, name, faction, rl }
  }

  async fetch() {
    if (this.meta.size >= MAX_SOCKETS) return new Response('relay full', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();   // keeps this DO pinned in memory while sockets are open
    this.meta.set(server, { room: null, ready: false, name: '', faction: '', rl: { t: 0, n: 0 } });
    server.addEventListener('message', (e) => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  rateOk(ws) {
    const m = this.meta.get(ws); if (!m) return false;
    const now = Date.now();
    if (now - m.rl.t > 1000) { m.rl.t = now; m.rl.n = 0; }
    m.rl.n++;
    if (m.rl.n > RATE_LIMIT * 5) { try { ws.close(1008, 'flood'); } catch {} this.onClose(ws); return false; }
    return m.rl.n <= RATE_LIMIT;
  }

  lobbyState(set) {
    const arr = [...set];
    return {
      players: arr.map((_, i) => i),
      names: arr.map(s => this.meta.get(s)?.name || ''),
      readies: arr.map(s => !!this.meta.get(s)?.ready),
      factions: arr.map(s => this.meta.get(s)?.faction || ''),
    };
  }
  broadcastLobby(room, extra = {}) {
    const set = this.rooms.get(room); if (!set) return;
    const arr = [...set]; const st = this.lobbyState(set);
    for (const c of set) this.send(c, { kind: 'lobby', room, you: arr.indexOf(c), ...st, ...extra });
  }

  joinRoom(ws, room) {
    room = String(room || 'default').slice(0, 64);
    let set = this.rooms.get(room);
    if (!set) { set = new Set(); this.rooms.set(room, set); }
    if (set.size >= MAX_ROOM && !set.has(ws)) { this.send(ws, { kind: 'reject', reason: 'full' }); return false; }
    const m = this.meta.get(ws); m.room = room; m.ready = false;
    set.add(ws);
    return true;
  }

  onMessage(ws, data) {
    if (typeof data !== 'string') return;            // we only speak JSON text frames
    if (data.length > MAX_FRAME_BYTES) { try { ws.close(1009, 'too big'); } catch {} this.onClose(ws); return; }
    if (!this.rateOk(ws)) return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.kind !== 'string') return;
    const m = this.meta.get(ws); if (!m) return;

    if (msg.kind === 'join') {
      if (msg.name) m.name = String(msg.name).slice(0, 24);
      if (msg.faction) m.faction = String(msg.faction).slice(0, 24);
      if (m.room) this.leave(ws, true);
      if (this.joinRoom(ws, msg.room)) this.broadcastLobby(m.room);
    } else if (msg.kind === 'name') {
      m.name = String(msg.name || '').slice(0, 24);
      if (m.room) this.broadcastLobby(m.room);
    } else if (msg.kind === 'faction') {
      m.faction = String(msg.faction || '').slice(0, 24);
      if (m.room) this.broadcastLobby(m.room);
    } else if (msg.kind === 'ready') {
      m.ready = !!msg.ready;
      if (m.room) this.broadcastLobby(m.room);
    } else if (msg.kind === 'start') {
      const set = this.rooms.get(m.room);
      if (set) for (const c of set) this.send(c, { kind: 'start', header: msg.header, players: [...set].map((_, i) => i) });
    } else if (msg.kind === 'packet') {
      this.broadcast(m.room, { kind: 'packet', packet: msg.packet }, ws);
    } else if (msg.kind === 'chat') {
      const set = this.rooms.get(m.room);
      const you = set ? [...set].indexOf(ws) : -1;
      this.broadcast(m.room, { kind: 'chat', from: you, text: String(msg.text || '').slice(0, 240) }, ws);
    } else if (msg.kind === 'quickmatch') {
      this.enterQueue(ws, msg.name);
    } else if (msg.kind === 'cancelqm') {
      this.dequeue(ws);
    } else if (msg.kind === 'ping') {
      this.send(ws, { kind: 'pong', t: msg.t });
    }
  }

  enterQueue(ws, name) {
    const m = this.meta.get(ws); if (!m) return;
    if (name) m.name = String(name).slice(0, 24);
    this.dequeue(ws);
    if (m.room) this.leave(ws, true);
    this.queue.push(ws);
    this.send(ws, { kind: 'qm', state: 'searching' });
    this.pairUp();
  }
  dequeue(ws) { const i = this.queue.indexOf(ws); if (i >= 0) this.queue.splice(i, 1); }
  pairUp() {
    while (this.queue.length >= 2) {
      const a = this.queue.shift(), b = this.queue.shift();
      if (!this.meta.has(a)) { if (this.meta.has(b)) this.queue.unshift(b); continue; }
      if (!this.meta.has(b)) { if (this.meta.has(a)) this.queue.unshift(a); continue; }
      const room = 'qm-' + crypto.randomUUID().slice(0, 8);
      if (this.joinRoom(a, room) && this.joinRoom(b, room)) this.broadcastLobby(room, { auto: true });
    }
  }

  leave(ws, keepQueue) {
    if (!keepQueue) this.dequeue(ws);
    const m = this.meta.get(ws); if (!m) return;
    const room = m.room; m.room = null; m.ready = false;
    const set = room && this.rooms.get(room);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.rooms.delete(room);
    else this.broadcastLobby(room, { left: true });
  }
  onClose(ws) { this.dequeue(ws); this.leave(ws, true); this.meta.delete(ws); }

  broadcast(room, obj, except) {
    const set = this.rooms.get(room); if (!set) return;
    for (const c of set) if (c !== except) this.send(c, obj);
  }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch {} }
}
