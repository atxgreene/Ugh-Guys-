// Minimal lockstep relay server — zero dependencies (Node built-ins only), so it
// runs with `node server/relay.mjs` and needs no `npm install`. It does NOT simulate
// anything: clients run the deterministic sim themselves and this just groups them
// into rooms and rebroadcasts their turn packets, giving a single ordering point and
// trivial NAT traversal. Pair it with WebSocketTransport in src/net.js.
//
// Protocol (JSON text frames):
//   client → { kind:'join', room, name?, faction? }   join/create a room
//   client → { kind:'name'|'faction', ... }            update your seat label/faction
//   client → { kind:'ready', ready }                   toggle this seat's ready state
//   client → { kind:'start', header }                  broadcast the agreed match config
//   client → { kind:'packet', packet }                 a lockstep turn packet → peers
//   client → { kind:'chat', text }                     free-text chat → peers
//   client → { kind:'quickmatch' } / { kind:'cancelqm' }   matchmaking queue
//   client → { kind:'ping', t }                        liveness probe (relay echoes pong)
//   server → { kind:'lobby', room, you, players, names, readies, factions, auto?, left? }
//   server → { kind:'start', header, players }
//   server → { kind:'packet', packet } / { kind:'chat', from, text } / { kind:'pong', t }
//   server → { kind:'reject', reason }                 join refused (full room, etc.)
//
// SECURITY POSTURE (a relay is an internet-facing service — treat it like one):
//   • Binds to 127.0.0.1 by default so a bare `npm run relay` is NOT exposed on your
//     LAN/WAN. Front it with TLS (Cloudflare Tunnel, a reverse proxy, or the Workers
//     port) before exposing it. Set HOST=0.0.0.0 only inside a trusted container.
//   • Optional Origin allowlist (ALLOWED_ORIGINS) so only your game can use the relay.
//   • Room size is capped (MAX_ROOM, default 2) — a stranger with your code can't sneak
//     in as a third seat and desync the match.
//   • Frame size, message rate, total connections and rooms are all bounded, and idle
//     sockets are swept, so one peer can't exhaust memory or clog rooms.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';          // secure default: localhost only
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_ROOM = Number(process.env.MAX_ROOM || 2);     // 1v1 lockstep → 2 seats
const MAX_CONNECTIONS = Number(process.env.MAX_CONNECTIONS || 500);
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 200);
const MAX_FRAME_BYTES = Number(process.env.MAX_FRAME_BYTES || 64 * 1024);
const RATE_LIMIT = Number(process.env.RATE_LIMIT || 60); // messages/sec per socket
const IDLE_TIMEOUT_MS = Number(process.env.IDLE_TIMEOUT_MS || 30_000);

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();   // room -> Set<socket>
const queue = [];          // sockets waiting for a quick match
const sockets = new Set();  // every live socket (for idle sweeps + caps)

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('SotW lockstep relay — ok\n');
});

server.on('upgrade', (req, socket) => {
  // cap total connections so the relay can't be exhausted
  if (sockets.size >= MAX_CONNECTIONS) { try { socket.destroy(); } catch {} return; }
  // optional origin allowlist — only our game(s) may use the relay
  const origin = req.headers['origin'] || '';
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) {
    try { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); } catch {}
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.room = null; socket.ready = false; socket.name = ''; socket.faction = '';
  socket.buf = Buffer.alloc(0); socket.lastSeen = Date.now(); socket.rl = { t: 0, n: 0 };
  sockets.add(socket);
  socket.on('data', (chunk) => {
    socket.buf = Buffer.concat([socket.buf, chunk]);
    let f;
    try {
      while ((f = decodeFrame(socket.buf))) {
        socket.buf = f.rest;
        if (f.tooBig) { drop(socket); return; }   // oversized frame → hang up
        handle(socket, f);
      }
    } catch { drop(socket); }
  });
  socket.on('close', () => leave(socket, false, true));
  socket.on('error', () => leave(socket, false, true));
});

// per-socket message-rate gate; returns false (and may hang up) when flooding
function rateOk(sock) {
  const now = Date.now();
  if (now - sock.rl.t > 1000) { sock.rl.t = now; sock.rl.n = 0; }
  sock.rl.n++;
  if (sock.rl.n > RATE_LIMIT * 5) { drop(sock); return false; }  // egregious flood → close
  return sock.rl.n <= RATE_LIMIT;                                // otherwise just shed extras
}

function lobbyState(set) {
  const arr = [...set];
  return {
    players: arr.map((_, i) => i),
    names: arr.map(s => s.name || ''),
    readies: arr.map(s => !!s.ready),
    factions: arr.map(s => s.faction || ''),
  };
}
function broadcastLobby(room, extra = {}) {
  const set = rooms.get(room);
  if (!set) return;
  const arr = [...set];
  const st = lobbyState(set);
  for (const c of set) send(c, { kind: 'lobby', room, you: arr.indexOf(c), ...st, ...extra });
}

// Add a socket to a room, enforcing the size cap. Returns true on success.
function joinRoom(sock, room) {
  room = String(room || 'default').slice(0, 64);
  let set = rooms.get(room);
  if (!set) {
    if (rooms.size >= MAX_ROOMS) { send(sock, { kind: 'reject', reason: 'busy' }); return false; }
    set = new Set(); rooms.set(room, set);
  }
  if (set.size >= MAX_ROOM && !set.has(sock)) { send(sock, { kind: 'reject', reason: 'full' }); return false; }
  sock.room = room; sock.ready = false;
  set.add(sock);
  return true;
}

function handle(sock, frame) {
  if (frame.opcode === 0x8) { leave(sock); try { sock.end(); } catch {} return; }  // close
  if (frame.opcode === 0x9 || frame.opcode === 0xa) return;                          // ping/pong
  sock.lastSeen = Date.now();
  if (!rateOk(sock)) return;
  let msg; try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }
  if (!msg || typeof msg.kind !== 'string') return;

  if (msg.kind === 'join') {
    if (msg.name) sock.name = String(msg.name).slice(0, 24);
    if (msg.faction) sock.faction = String(msg.faction).slice(0, 24);
    if (sock.room) leave(sock, true);          // never be in two rooms at once
    if (joinRoom(sock, msg.room)) broadcastLobby(sock.room);
  } else if (msg.kind === 'name') {
    sock.name = String(msg.name || '').slice(0, 24);
    if (sock.room) broadcastLobby(sock.room);
  } else if (msg.kind === 'faction') {
    sock.faction = String(msg.faction || '').slice(0, 24);
    if (sock.room) broadcastLobby(sock.room);
  } else if (msg.kind === 'ready') {
    sock.ready = !!msg.ready;
    if (sock.room) broadcastLobby(sock.room);
  } else if (msg.kind === 'start') {
    const set = rooms.get(sock.room);
    if (set) for (const c of set) send(c, { kind: 'start', header: msg.header, players: [...set].map((_, i) => i) });
  } else if (msg.kind === 'packet') {
    broadcast(sock.room, { kind: 'packet', packet: msg.packet }, sock);
  } else if (msg.kind === 'chat') {
    const set = rooms.get(sock.room);
    const you = set ? [...set].indexOf(sock) : -1;
    broadcast(sock.room, { kind: 'chat', from: you, text: String(msg.text || '').slice(0, 240) }, sock);
  } else if (msg.kind === 'quickmatch') {
    enterQueue(sock, msg.name);
  } else if (msg.kind === 'cancelqm') {
    dequeue(sock);
  } else if (msg.kind === 'ping') {
    send(sock, { kind: 'pong', t: msg.t });
  }
}

// ---- quick match: pair the first two waiting sockets into a fresh private room ----
function enterQueue(sock, name) {
  if (name) sock.name = String(name).slice(0, 24);
  dequeue(sock);
  if (sock.room) leave(sock, true);
  queue.push(sock);
  send(sock, { kind: 'qm', state: 'searching' });
  pairUp();
}
function dequeue(sock) { const i = queue.indexOf(sock); if (i >= 0) queue.splice(i, 1); }
function pairUp() {
  while (queue.length >= 2) {
    const a = queue.shift(), b = queue.shift();
    if (a.destroyed) { if (!b.destroyed) queue.unshift(b); continue; }
    if (b.destroyed) { if (!a.destroyed) queue.unshift(a); continue; }
    const room = 'qm-' + crypto.randomBytes(4).toString('hex');
    if (joinRoom(a, room) && joinRoom(b, room)) broadcastLobby(room, { auto: true });
  }
}

function leave(sock, keepQueue, gone) {
  if (!keepQueue) dequeue(sock);
  if (gone) sockets.delete(sock);
  const set = sock.room && rooms.get(sock.room);
  const room = sock.room;
  sock.room = null; sock.ready = false;
  if (!set) return;
  set.delete(sock);
  if (set.size === 0) { rooms.delete(room); return; }
  broadcastLobby(room, { left: true });
}
function drop(sock) { try { sock.destroy(); } catch {} leave(sock, false, true); }

function broadcast(room, obj, except) {
  const set = rooms.get(room);
  if (!set) return;
  for (const c of set) if (c !== except) send(c, obj);
}
function send(sock, obj) { try { sock.write(encodeFrame(Buffer.from(JSON.stringify(obj), 'utf8'))); } catch {} }

// sweep idle/dead sockets so a half-open connection can't hold a room hostage
setInterval(() => {
  const now = Date.now();
  for (const s of sockets) if (now - s.lastSeen > IDLE_TIMEOUT_MS) drop(s);
}, 10_000).unref?.();

// ---- minimal RFC6455 framing (text frames; client→server is masked) ----
function encodeFrame(payload) {
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, off = 2;
  if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
  else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
  // reject oversized frames before allocating/copying their payload
  if (len > MAX_FRAME_BYTES) return { tooBig: true, rest: Buffer.alloc(0) };
  let mask;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
  return { opcode, payload, rest: buf.subarray(off + len) };
}

server.listen(PORT, HOST, () => console.log(`SotW lockstep relay listening on ${HOST}:${PORT}` +
  (ALLOWED_ORIGINS.length ? `  (origin allowlist: ${ALLOWED_ORIGINS.join(', ')})` : '  (no origin allowlist — dev mode)')));
