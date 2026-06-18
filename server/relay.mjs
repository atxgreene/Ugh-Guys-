// Minimal lockstep relay server — zero dependencies (Node built-ins only), so it
// runs with `node server/relay.mjs` and needs no `npm install`. It does NOT simulate
// anything: clients run the deterministic sim themselves and this just groups them
// into rooms and rebroadcasts their turn packets, giving a single ordering point and
// trivial NAT traversal. Pair it with WebSocketTransport in src/net.js.
//
// Protocol (JSON text frames):
//   client → { kind:'join', room }        join/create a room
//   client → { kind:'start', header }      broadcast the agreed match config (seed…)
//   client → { kind:'packet', packet }     a lockstep turn packet → relayed to peers
//   server → { kind:'lobby', room, you, players, left? }
//   server → { kind:'start', header, players }
//   server → { kind:'packet', packet }
//
// This is intentionally small (in-memory rooms, index-based player ids). A production
// relay would add stable ids, auth, reconnect tokens, and room lifecycle limits.
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 8787;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();   // room -> Set<socket>

const server = http.createServer((req, res) => { res.writeHead(200); res.end('SotW lockstep relay\n'); });

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.room = null; socket.buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    socket.buf = Buffer.concat([socket.buf, chunk]);
    let f;
    while ((f = decodeFrame(socket.buf))) { socket.buf = f.rest; handle(socket, f); }
  });
  socket.on('close', () => leave(socket));
  socket.on('error', () => leave(socket));
});

function handle(sock, frame) {
  if (frame.opcode === 0x8) { leave(sock); try { sock.end(); } catch {} return; }  // close
  if (frame.opcode === 0x9 || frame.opcode === 0xa) return;                          // ping/pong
  let msg; try { msg = JSON.parse(frame.payload.toString('utf8')); } catch { return; }

  if (msg.kind === 'join') {
    sock.room = String(msg.room || 'default');
    let set = rooms.get(sock.room);
    if (!set) { set = new Set(); rooms.set(sock.room, set); }
    set.add(sock);
    const arr = [...set];
    for (const c of set) send(c, { kind: 'lobby', room: sock.room, you: arr.indexOf(c), players: arr.map((_, i) => i) });
  } else if (msg.kind === 'start') {
    const set = rooms.get(sock.room);
    if (set) for (const c of set) send(c, { kind: 'start', header: msg.header, players: [...set].map((_, i) => i) });
  } else if (msg.kind === 'packet') {
    broadcast(sock.room, { kind: 'packet', packet: msg.packet }, sock);
  }
}

function leave(sock) {
  const set = sock.room && rooms.get(sock.room);
  if (!set) return;
  set.delete(sock);
  if (set.size === 0) { rooms.delete(sock.room); return; }
  const arr = [...set];
  for (const c of set) send(c, { kind: 'lobby', room: sock.room, you: arr.indexOf(c), players: arr.map((_, i) => i), left: true });
  sock.room = null;
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
