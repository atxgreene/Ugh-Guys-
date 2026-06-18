// Minimal lockstep relay server — zero dependencies (Node built-ins only), so it
// runs with `node server/relay.mjs` and needs no `npm install`. It does NOT simulate
// anything: clients run the deterministic sim themselves and this just groups them
// into rooms and rebroadcasts their turn packets, giving a single ordering point and
// trivial NAT traversal. Pair it with WebSocketTransport in src/net.js.
//
// Protocol (JSON text frames):
//   client → { kind:'join', room, name? }    join/create a room (name = display label)
//   client → { kind:'ready', ready }          toggle this seat's ready state
//   client → { kind:'start', header }         broadcast the agreed match config (seed…)
//   client → { kind:'packet', packet }        a lockstep turn packet → relayed to peers
//   client → { kind:'chat', text }            free-text chat → relayed to peers
//   client → { kind:'quickmatch' }            enter the matchmaking queue
//   client → { kind:'cancelqm' }              leave the matchmaking queue
//   client → { kind:'ping', t }               liveness probe (relay echoes a pong)
//   server → { kind:'lobby', room, you, players, names, readies, auto?, left? }
//   server → { kind:'start', header, players }
//   server → { kind:'packet', packet }
//   server → { kind:'chat', from, text }
//   server → { kind:'pong', t }
//
// This is intentionally small (in-memory rooms, index-based player ids). A production
// relay would add stable ids, auth, reconnect tokens, and room lifecycle limits.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 8787;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();   // room -> Set<socket>
const queue = [];          // sockets waiting for a quick match

const server = http.createServer((req, res) => {
  // a tiny health endpoint so Fly.io (and curl) can confirm the relay is alive
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('SotW lockstep relay — ok\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.room = null; socket.ready = false; socket.name = ''; socket.faction = ''; socket.buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    socket.buf = Buffer.concat([socket.buf, chunk]);
    let f;
    while ((f = decodeFrame(socket.buf))) { socket.buf = f.rest; handle(socket, f); }
  });
  socket.on('close', () => leave(socket));
  socket.on('error', () => leave(socket));
});

// Build the canonical lobby snapshot for a room: seat order, names, ready flags.
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

function joinRoom(sock, room) {
  sock.room = String(room || 'default');
  sock.ready = false;
  let set = rooms.get(sock.room);
  if (!set) { set = new Set(); rooms.set(sock.room, set); }
  set.add(sock);
  return set;
}

function handle(sock, frame) {
  if (frame.opcode === 0x8) { leave(sock); try { sock.end(); } catch {} return; }  // close
  if (frame.opcode === 0x9 || frame.opcode === 0xa) return;                          // ping/pong
  let msg; try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }

  if (msg.kind === 'join') {
    if (msg.name) sock.name = String(msg.name).slice(0, 24);
    if (msg.faction) sock.faction = String(msg.faction).slice(0, 24);
    joinRoom(sock, msg.room);
    broadcastLobby(sock.room);
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
    // free-text chat — rides alongside the lockstep stream, never through it, so it
    // can't perturb the deterministic sim. Tag with the sender's seat for display.
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
  dequeue(sock);                 // never double-queue
  // if the socket was already in a room (e.g. the lobby), pull it out first
  if (sock.room) leave(sock, true);
  queue.push(sock);
  send(sock, { kind: 'qm', state: 'searching' });
  pairUp();
}
function dequeue(sock) {
  const i = queue.indexOf(sock);
  if (i >= 0) queue.splice(i, 1);
}
function pairUp() {
  while (queue.length >= 2) {
    const a = queue.shift(), b = queue.shift();
    // a stale/closed socket may linger in the queue — skip it
    if (a.destroyed) { if (!b.destroyed) queue.unshift(b); continue; }
    if (b.destroyed) { if (!a.destroyed) queue.unshift(a); continue; }
    const room = 'qm-' + crypto.randomBytes(4).toString('hex');
    joinRoom(a, room); joinRoom(b, room);
    broadcastLobby(room, { auto: true });
  }
}

function leave(sock, keepQueue) {
  if (!keepQueue) dequeue(sock);
  const set = sock.room && rooms.get(sock.room);
  const room = sock.room;
  sock.room = null; sock.ready = false;
  if (!set) return;
  set.delete(sock);
  if (set.size === 0) { rooms.delete(room); return; }
  broadcastLobby(room, { left: true });
}

function broadcast(room, obj, except) {
  const set = rooms.get(room);
  if (!set) return;
  for (const c of set) if (c !== except) send(c, obj);
}
function send(sock, obj) { try { sock.write(encodeFrame(Buffer.from(JSON.stringify(obj), 'utf8'))); } catch {} }

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
  let mask;
  if (masked) { if (buf.length < off + 4) return null; mask = buf.subarray(off, off + 4); off += 4; }
  if (buf.length < off + len) return null;
  let payload = buf.subarray(off, off + len);
  if (masked) { const out = Buffer.alloc(len); for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3]; payload = out; }
  return { opcode, payload, rest: buf.subarray(off + len) };
}

server.listen(PORT, () => console.log(`SotW lockstep relay listening on :${PORT}`));
