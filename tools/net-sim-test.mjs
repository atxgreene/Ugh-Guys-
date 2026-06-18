// Lockstep scheduler test — runs in Node (no browser needed). Drives two sessions
// over an in-process bus and asserts the properties multiplayer correctness rests
// on: both clients derive the SAME ordered command stream per turn, input delay is
// honoured, the sim never advances past a missing packet, and mismatched checksums
// are flagged. This is the determinism guarantee at the scheduling layer; the
// in-game sim determinism is covered by the Playwright replay test.
import { LockstepSession, LocalBus, LocalTransport } from '../src/net.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}  (${JSON.stringify(a)} === ${JSON.stringify(b)})`);

// Two clients (players 0 and 1) on one bus, input delay = 2 turns.
function makePair(delay = 2, turnLength = 3) {
  const bus = new LocalBus();
  const a = new LockstepSession({ players: [0, 1], localId: 0, transport: new LocalTransport(bus), delay, turnLength });
  const b = new LockstepSession({ players: [0, 1], localId: 1, transport: new LocalTransport(bus), delay, turnLength });
  a.start(); b.start();
  return { a, b };
}

// Lockstep both sessions in parallel for N turns, collecting the command stream each
// one applies. Commands are submitted via the provided schedule: turn -> {0:[],1:[]}.
function run(a, b, turns, schedule) {
  const streamA = [], streamB = [];
  for (let t = 0; t < turns; t++) {
    // each side submits its commands for this executing turn BEFORE advancing
    for (const c of (schedule[t]?.[0] || [])) a.submit(c);
    for (const c of (schedule[t]?.[1] || [])) b.submit(c);
    // both must be ready (all packets present) before executing the turn
    if (!a.ready() || !b.ready()) throw new Error(`stalled at turn ${t}`);
    streamA.push({ t, cmds: a.commandsForCurrentTurn() });
    streamB.push({ t, cmds: b.commandsForCurrentTurn() });
    a.advance(); b.advance();
  }
  return { streamA, streamB };
}

console.log('lockstep scheduler:');

// 1) Identical ordered command stream on both clients.
{
  const { a, b } = makePair(2);
  const schedule = {
    0: { 0: ['a-move'], 1: ['b-move'] },
    1: { 1: ['b-attack'] },
    2: { 0: ['a-build'] },
  };
  const { streamA, streamB } = run(a, b, 6, schedule);
  eq(streamA, streamB, 'both clients apply the same ordered stream');
  // commands submitted while executing turn T land at turn T+delay
  const landTurn = streamA.find(s => s.cmds.some(c => c.cmd === 'a-move'))?.t;
  eq(landTurn, 2, 'a command submitted on turn 0 executes on turn 0+delay(2)');
  const attackTurn = streamA.find(s => s.cmds.some(c => c.cmd === 'b-attack'))?.t;
  eq(attackTurn, 3, 'a command submitted on turn 1 executes on turn 3');
}

// 2) Deterministic ordering within a turn: player 0 before player 1.
{
  const { a, b } = makePair(1);
  const { streamA } = run(a, b, 3, { 0: { 1: ['Z'], 0: ['A'] } });
  const turn1 = streamA.find(s => s.t === 1).cmds.map(c => `${c.player}:${c.cmd}`);
  eq(turn1, ['0:A', '1:Z'], 'within a turn, commands order by player id (0 before 1)');
}

// 3) The sim cannot advance past a missing packet (the "lock"). A peer that never
//    participates means the match can't even start — you never get its turn-0 packet.
{
  const bus = new LocalBus();
  const a = new LockstepSession({ players: [0, 1], localId: 0, transport: new LocalTransport(bus), delay: 2 });
  a.start();   // player 1 never joins/sends
  let advanced = 0;
  for (let t = 0; t < 5; t++) { if (!a.ready()) break; a.commandsForCurrentTurn(); a.advance(); advanced++; }
  eq(advanced, 0, 'with a silent peer the sim never advances (it locks on the missing player)');
  ok(a.stalled, 'session reports stalled while waiting on the missing player');
}

// 4) Checksum cross-check: agreement is silent, disagreement raises a desync.
{
  const okBus = new LocalBus();
  const a0 = new LockstepSession({ players: [0, 1], localId: 0, transport: new LocalTransport(okBus), delay: 1 });
  const b0 = new LockstepSession({ players: [0, 1], localId: 1, transport: new LocalTransport(okBus), delay: 1 });
  a0.start(); b0.start();
  a0.commandsForCurrentTurn(); b0.commandsForCurrentTurn();
  a0.advance(777); b0.advance(777);   // both agree on turn 0's state
  ok(!a0.desynced && !b0.desynced, 'matching checksums do not raise a false desync');

  const bus = new LocalBus();
  let flagged = null;
  const a = new LockstepSession({ players: [0, 1], localId: 0, transport: new LocalTransport(bus), delay: 1,
    onDesync: (turn) => { flagged = turn; } });
  const b = new LockstepSession({ players: [0, 1], localId: 1, transport: new LocalTransport(bus), delay: 1 });
  a.start(); b.start();
  ok(a.ready() && b.ready(), 'both clients ready for turn 0 after priming');
  a.commandsForCurrentTurn(); b.commandsForCurrentTurn();
  a.advance(111); b.advance(222);     // diverging state for turn 0
  ok(a.desynced && flagged === 0, 'mismatched turn checksums flag a desync');
}

console.log(failures === 0 ? '\nALL LOCKSTEP TESTS PASSED' : `\n${failures} LOCKSTEP TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
