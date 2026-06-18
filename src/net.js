// Deterministic lockstep networking layer.
//
// The simulation is already deterministic (seeded RNG + fixed timestep + the
// game.cmd command bus + checksums). Multiplayer is therefore NOT about syncing
// state — every client runs the full sim locally and only tiny *command packets*
// cross the wire. This module is the scheduler that makes that safe:
//
//   • Turns. Sim ticks are grouped into TURNS (turnLength ticks each). Commands a
//     player issues while executing turn T are scheduled to run at turn T+delay on
//     EVERY client, so input lag is hidden behind a couple of turns instead of a
//     round-trip per click (the reason RTS clicks feel slightly "floaty").
//   • Every player sends one packet per turn — even an empty one — so peers know a
//     turn is complete. The sim only advances into turn T once packets from ALL
//     players for T have arrived (this is the "lock" in lockstep).
//   • Within a turn, commands are applied in a deterministic order (by player id,
//     then submission index) so all clients converge bit-for-bit.
//
// N players cost the same as 2 — the scheduler waits on whatever player set it was
// given — so free-for-all and team games fall out for free.
//
// Transport is pluggable: LocalBus/LocalTransport for in-process play & tests,
// WebSocketTransport for networked play through a thin relay (server/relay.mjs).

export class LockstepSession {
  // players: array of stable player ids participating (e.g. [0, 1, 2]).
  // localId: this client's player id (must be in players).
  // transport: { send(packet), onPacket(cb) } — broadcasts to all OTHER players.
  // opts: { turnLength=4, delay=2, onDesync(turn, sums) }
  constructor({ players, localId, transport, turnLength = 4, delay = 2, onDesync } = {}) {
    this.players = [...players].sort((a, b) => a - b);
    this.localId = localId;
    this.transport = transport;
    this.turnLength = turnLength;
    this.delay = delay;
    this.onDesync = onDesync;

    this.turn = 0;          // turn currently being executed
    this.localSeq = 0;      // monotonic per-command index for ordering ties
    this.localBuffer = [];  // commands gathered since the last outgoing packet
    this.inbox = new Map(); // turn -> Map<playerId, cmds[]>   (commands to execute)
    this.checks = new Map();// turn -> Map<playerId, checksum> (state-sync compare)
    this.started = false;
    this.stalled = false;   // true while waiting on a missing packet
    this.desynced = false;

    if (transport) transport.onPacket((pkt) => this._receive(pkt));
  }

  // Prime the pipeline: send empty packets for the first `delay` turns so the sim
  // can begin immediately (nobody could have issued commands for them yet).
  start() {
    if (this.started) return;
    this.started = true;
    for (let t = 0; t < this.delay; t++) this._emit(t, [], null, undefined);
  }

  // A local player command (already serialized by game.cmd). Tagged to execute at
  // turn this.turn + delay so every client applies it on the same turn.
  submit(cmd) {
    this.localBuffer.push({ seq: this.localSeq++, cmd });
  }

  // True when packets from every player have arrived for the current turn, i.e. the
  // sim is cleared to execute it. While false the caller should hold the sim.
  ready() {
    const slot = this.inbox.get(this.turn);
    if (!slot) { this.stalled = true; return false; }
    for (const p of this.players) if (!slot.has(p)) { this.stalled = true; return false; }
    this.stalled = false;
    return true;
  }

  // The ordered commands to apply for the current turn: by player id, then by the
  // submitting client's sequence index. Identical on every client → no divergence.
  commandsForCurrentTurn() {
    const slot = this.inbox.get(this.turn);
    if (!slot) return [];
    const out = [];
    for (const p of this.players) {
      const cmds = slot.get(p);
      if (!cmds) continue;
      for (const c of cmds) out.push({ player: p, cmd: c.cmd });
    }
    return out;
  }

  // Finalize the current turn: flush our buffered commands as the packet scheduled
  // for turn this.turn + delay, piggybacking an optional checksum of the state we
  // just executed (compared across clients to detect divergence), then advance.
  // Call once per turn AFTER applying commandsForCurrentTurn().
  advance(checksum) {
    const future = this.turn + this.delay;
    this._emit(future, this.localBuffer, this.turn, checksum);
    this.localBuffer = [];
    this.inbox.delete(this.turn);   // commands consumed; checksum map kept for compare
    this.turn++;
  }

  // Broadcast one turn packet. checkTurn/check report our state checksum for an
  // already-executed turn (or null/undefined to omit, e.g. for primed turns).
  _emit(turn, cmds, checkTurn, check) {
    this._storeCmds(turn, this.localId, cmds);
    if (check !== undefined && checkTurn !== null) this._storeCheck(checkTurn, this.localId, check);
    if (this.transport) this.transport.send({ turn, player: this.localId, cmds, checkTurn, check });
  }

  _receive(pkt) {
    if (pkt.player === this.localId) return;            // ignore echoes
    this._storeCmds(pkt.turn, pkt.player, pkt.cmds || []);
    if (pkt.check !== undefined && pkt.checkTurn !== null && pkt.checkTurn !== undefined)
      this._storeCheck(pkt.checkTurn, pkt.player, pkt.check);
  }

  _storeCmds(turn, player, cmds) {
    let slot = this.inbox.get(turn);
    if (!slot) { slot = new Map(); this.inbox.set(turn, slot); }
    slot.set(player, cmds);
  }

  // Record a player's state checksum for a turn and cross-check it against the
  // others already in hand; the first disagreement raises a desync.
  _storeCheck(turn, player, sum) {
    let slot = this.checks.get(turn);
    if (!slot) { slot = new Map(); this.checks.set(turn, slot); }
    slot.set(player, sum);
    let ref;
    for (const s of slot.values()) {
      if (ref === undefined) ref = s;
      else if (s !== ref && !this.desynced) {
        this.desynced = true;
        this.onDesync && this.onDesync(turn, Object.fromEntries(slot));
      }
    }
  }

  // How many sim ticks a turn spans (the loop runs the sim this many ticks per turn).
  get ticksPerTurn() { return this.turnLength; }
}

// ---- in-process transport (tests, hot-seat, and the single-player default) ----
// A shared bus that fans a packet out to every joined transport except the sender.
export class LocalBus {
  constructor() { this.peers = []; }
  join(t) { this.peers.push(t); }
  broadcast(from, packet) {
    for (const p of this.peers) if (p !== from) p._deliver(packet);
  }
}
export class LocalTransport {
  constructor(bus) { this.bus = bus; this.cb = null; bus.join(this); }
  send(packet) { this.bus.broadcast(this, packet); }
  onPacket(cb) { this.cb = cb; }
  _deliver(packet) { if (this.cb) this.cb(packet); }
}

// ---- networked transport (browser) ----
// Talks JSON command packets to the relay (server/relay.mjs), which rebroadcasts
// them to the room. Queues sends until the socket is open, auto-reconnects on an
// unexpected drop, and exposes lobby/chat/quick-match/ping channels alongside the
// lockstep packet stream. Browser-only (uses the global WebSocket); kept out of the
// Node test path.
export class WebSocketTransport {
  constructor(url, room, { onOpen, onClose, onError, name = '', faction = '' } = {}) {
    this.url = url; this.room = room; this.name = name; this.faction = faction;
    this.cb = null;
    this.queue = [];
    this.rxbuf = [];   // packets that arrive before a session attaches its handler
    // channel callbacks (assigned by the lobby / match code)
    this.onLobby = null; this.onStart = null; this.onChat = null;
    this.onQm = null; this.onPong = null; this.onStatus = null;
    this._userOpen = onOpen; this._userClose = onClose; this._userError = onError;
    this._closed = false;     // set by close() to suppress reconnection
    this._reconnects = 0;
    this._reconnectT = null;
    this._connect(true);
  }

  _connect(first) {
    let ws;
    try { ws = new WebSocket(this.url); }
    catch (e) { this._userError && this._userError(e); return; }
    this.ws = ws;
    ws.onopen = () => {
      this._reconnects = 0;
      ws.send(JSON.stringify({ kind: 'join', room: this.room, name: this.name, faction: this.faction }));
      for (const m of this.queue) ws.send(m);
      this.queue.length = 0;
      this.onStatus && this.onStatus(first ? 'open' : 'reconnected');
      if (first) this._userOpen && this._userOpen();
    };
    ws.onmessage = (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      switch (msg.kind) {
        case 'packet': if (this.cb) this.cb(msg.packet); else this.rxbuf.push(msg.packet); break;
        case 'lobby': this.room = msg.room; this.onLobby && this.onLobby(msg); break;   // track room for reconnects
        case 'start': this.onStart && this.onStart(msg); break;
        case 'chat':  this.onChat && this.onChat(msg); break;
        case 'qm':    this.onQm && this.onQm(msg); break;
        case 'pong':  this.onPong && this.onPong(msg); break;
      }
    };
    ws.onclose = () => {
      if (this._closed) { this.onStatus && this.onStatus('closed'); this._userClose && this._userClose(); return; }
      // unexpected drop — surface it and retry with exponential backoff (capped)
      this.onStatus && this.onStatus('reconnecting');
      this._userClose && this._userClose();
      const delay = Math.min(8000, 500 * 2 ** this._reconnects);
      this._reconnects++;
      clearTimeout(this._reconnectT);
      this._reconnectT = setTimeout(() => { if (!this._closed) this._connect(false); }, delay);
    };
    ws.onerror = (err) => { this._userError && this._userError(err); };
  }

  send(packet) { this._raw({ kind: 'packet', packet }); }
  sendMessage(msg) { this._raw(msg); }
  // Free-text chat — rides next to the lockstep stream (never through it), so it can't
  // affect the deterministic sim regardless of when it arrives.
  sendChat(text) { this._raw({ kind: 'chat', text: String(text).slice(0, 240) }); }
  sendReady(ready) { this._raw({ kind: 'ready', ready: !!ready }); }
  setName(name) { this.name = String(name).slice(0, 24); this._raw({ kind: 'name', name: this.name }); }
  setFaction(faction) { this.faction = String(faction).slice(0, 24); this._raw({ kind: 'faction', faction: this.faction }); }
  quickMatch(name) { if (name) this.name = String(name).slice(0, 24); this._raw({ kind: 'quickmatch', name: this.name }); }
  cancelQuickMatch() { this._raw({ kind: 'cancelqm' }); }
  ping() { this._raw({ kind: 'ping', t: Date.now() }); }

  _raw(msg) {
    const m = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === 1) { try { this.ws.send(m); } catch {} }
    else this.queue.push(m);
  }
  onPacket(cb) { this.cb = cb; for (const p of this.rxbuf) cb(p); this.rxbuf = []; }
  close() { this._closed = true; clearTimeout(this._reconnectT); try { this.ws.close(); } catch {} }
}
