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
// them to the room. Queues sends until the socket is open. Browser-only (uses the
// global WebSocket); kept out of the Node test path.
export class WebSocketTransport {
  constructor(url, room, { onOpen, onClose, onError } = {}) {
    this.cb = null;
    this.queue = [];
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ kind: 'join', room }));
      for (const m of this.queue) this.ws.send(m);
      this.queue.length = 0;
      onOpen && onOpen();
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.kind === 'packet' && this.cb) this.cb(msg.packet);
      else if (msg.kind === 'lobby' && this.onLobby) this.onLobby(msg);
    };
    this.ws.onclose = () => onClose && onClose();
    this.ws.onerror = (err) => onError && onError(err);
  }
  send(packet) {
    const m = JSON.stringify({ kind: 'packet', packet });
    if (this.ws.readyState === 1) this.ws.send(m); else this.queue.push(m);
  }
  onPacket(cb) { this.cb = cb; }
  close() { try { this.ws.close(); } catch {} }
}
