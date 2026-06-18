// Entry point: main menu, faction selection, game lifecycle and loop.
import { FACTIONS } from './data.js';
import { BIOMES, MAP_SIZES } from './terrain.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { Sound, Music } from './audio.js';
import { Settings } from './settings.js';
import { LockstepSession, WebSocketTransport } from './net.js';

const TRAITS = {
  covenant: 'Balanced economy · strong defenses · disciplined bronze infantry · temple favor',
  watchers: 'Elite expensive units · forbidden knowledge tech · devastating casters',
  nephilim: 'Brutal melee · fast raids · giants that level cities · weak economy',
};

let current = null; // { game, ai, controls, ui, raf }
const SAVE_KEY = 'sotw_save_v1';
const AUTOSAVE_SECONDS = 45;

// Fixed-timestep simulation. The sim advances in deterministic SIM_DT ticks
// decoupled from the render framerate — the prerequisite for lockstep multiplayer
// (every client must step the sim identically regardless of its refresh rate) and
// for bit-exact replays. Rendering, camera and HUD still run once per animation
// frame on real time. MAX_STEPS caps catch-up after a stall so we drop backlog
// instead of spiralling; MAX_FRAME clamps a single huge gap (e.g. a backgrounded tab).
const SIM_HZ = 60;
const SIM_DT = 1 / SIM_HZ;
const MAX_STEPS = 5;
const MAX_FRAME = 0.25;

function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }

function saveGame(silent) {
  if (!current || current.game.over) return false;
  try {
    const g = current.game;
    const payload = { data: g.serialize(), meta: { faction: g.pfKey, enemy: g.efKey,
      biome: g.map.biome.name, time: Math.floor(g.time), at: Date.now() } };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    if (!silent) current.ui.toast('⌖ Campaign saved.');
    refreshContinue();
    return true;
  } catch (e) { if (!silent) current?.ui.toast('Save failed — storage may be full.'); return false; }
}

// never lose progress to a closed/refreshed tab
window.addEventListener('beforeunload', () => { try { saveGame(true); } catch {} });

function loadSavedGame() {
  let raw; try { raw = localStorage.getItem(SAVE_KEY); } catch { return; }
  if (!raw) return;
  try {
    const { data } = JSON.parse(raw);
    showLoading(() => startGameNow(data.pf, data.ef, data));
  } catch (e) { console.error('Load failed', e); }
}

function togglePause(force) {
  if (!current || current.game.over) return;
  const g = current.game;
  g.paused = force === undefined ? !g.paused : force;
  current.ui.setPaused(g.paused, hasSave());
}

function refreshContinue() {
  const btn = document.getElementById('btn-continue');
  if (!btn) return;
  if (hasSave()) {
    btn.style.display = 'inline-block';
    try { const m = JSON.parse(localStorage.getItem(SAVE_KEY)).meta;
      btn.textContent = `Continue — ${FACTIONS[ (JSON.parse(localStorage.getItem(SAVE_KEY)).data.pf) ]?.name || 'campaign'} · ${Math.floor(m.time/60)}:${String(m.time%60).padStart(2,'0')}`;
    } catch { btn.textContent = 'Continue Campaign'; }
  } else btn.style.display = 'none';
}

function buildMenu() {
  const wrap = document.getElementById('faction-cards');
  wrap.innerHTML = '';
  for (const f of Object.values(FACTIONS)) {
    const card = document.createElement('div');
    card.className = 'fcard ' + f.key;
    card.innerHTML = `<h2 style="color:${f.colorCss}">${f.name}</h2><p>${f.desc}</p>
      <div class="traits">${TRAITS[f.key]}</div>`;
    card.onclick = () => { Sound.click(); startGame(f.key); };
    wrap.appendChild(card);
  }
  const cont = document.getElementById('btn-continue');
  if (cont) cont.onclick = () => { Sound.click(); loadSavedGame(); };
  // watch-a-replay: pick a .json the player previously downloaded
  const rb = document.getElementById('btn-replay');
  const rf = document.getElementById('replay-file');
  if (rb && rf) {
    rb.style.display = 'inline-block';
    rb.onclick = () => { Sound.click(); rf.value = ''; rf.click(); };
    rf.onchange = () => { if (rf.files && rf.files[0]) loadReplayFile(rf.files[0]); };
  }
  // multiplayer lobby (lockstep over a relay)
  const mpb = document.getElementById('btn-mp');
  if (mpb) {
    mpb.style.display = 'inline-block';
    mpb.onclick = () => { Sound.click(); openLobby(); };
    document.getElementById('mp-host').onclick = () => { Sound.click(); lobbyConnect(true); };
    document.getElementById('mp-join').onclick = () => { Sound.click(); lobbyConnect(false); };
    document.getElementById('mp-start').onclick = () => { Sound.click(); lobbyStart(); };
    document.getElementById('mp-close').onclick = () => { Sound.click(); closeLobby(); };
  }
  // difficulty picker (persisted; applied to new games via Settings → game.difficulty)
  const diffWrap = document.getElementById('menu-diff');
  if (diffWrap) {
    const sync = () => { for (const b of diffWrap.querySelectorAll('button'))
      b.classList.toggle('on', b.dataset.d === Settings.get('difficulty')); };
    for (const b of diffWrap.querySelectorAll('button'))
      b.onclick = () => { Sound.click(); Settings.set('difficulty', b.dataset.d); sync(); };
    sync();
  }
  // skirmish setup: opponent + land selectors (Random by default)
  const enemySel = document.getElementById('sel-enemy');
  if (enemySel) {
    enemySel.innerHTML = '<option value="random">Random</option>' +
      Object.values(FACTIONS).map(f => `<option value="${f.key}">${f.name}</option>`).join('');
    enemySel.value = Settings.get('enemy') || 'random';
    enemySel.onchange = () => Settings.set('enemy', enemySel.value);
  }
  const biomeSel = document.getElementById('sel-biome');
  if (biomeSel) {
    biomeSel.innerHTML = '<option value="random">Random</option>' +
      Object.entries(BIOMES).map(([k, b]) => `<option value="${k}">${b.name}</option>`).join('');
    biomeSel.value = Settings.get('biome') || 'random';
    biomeSel.onchange = () => Settings.set('biome', biomeSel.value);
  }
  const sizeSel = document.getElementById('sel-mapsize');
  if (sizeSel) {
    const labels = { standard: 'Standard', large: 'Large', huge: 'Huge' };
    sizeSel.innerHTML = Object.keys(MAP_SIZES).map(k =>
      `<option value="${k}">${labels[k] || k} (${MAP_SIZES[k]}×${MAP_SIZES[k]})</option>`).join('');
    sizeSel.value = MAP_SIZES[Settings.get('mapSize')] ? Settings.get('mapSize') : 'standard';
    sizeSel.onchange = () => Settings.set('mapSize', sizeSel.value);
  }
  refreshContinue();
}

// ---------- replays ----------
// Download the just-played match as a deterministic replay file (seed + the player
// command stream). Re-watched via startReplay, which re-runs the sim in lockstep.
function downloadReplay() {
  const rep = current?.game?.exportReplay?.();
  if (!rep) { current?.ui.toast('No replay available for this match.'); return; }
  const blob = new Blob([JSON.stringify(rep)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const t = Math.floor(rep.frames.length / 60);
  a.href = url; a.download = `sotw-replay-${rep.header.pf}-vs-${rep.header.ef}-${t}s.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function loadReplayFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    let rep; try { rep = JSON.parse(fr.result); } catch { alert('Not a valid replay file.'); return; }
    if (!rep || rep.app !== 'sotw' || !rep.header || !rep.frames) { alert('Not a Shadow of the Watchers replay.'); return; }
    showLoading(() => startReplay(rep));
  };
  fr.readAsText(file);
}

function buildIdMap(game) {
  const m = new Map();
  for (const u of game.units) m.set(u.id, u);
  for (const b of game.buildings) m.set(b.id, b);
  for (const r of game.resources) m.set(r.id, r);
  return m;
}

function startReplay(rep) {
  stopGame();
  document.getElementById('menu').style.display = 'none';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('minimap-wrap').style.display = 'block';
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('gameover').style.display = 'none';

  const h = rep.header;
  const container = document.getElementById('game-container');
  const game = new Game(container, h.pf, h.ef, { seed: h.seed, biome: h.biomeKey,
    timeOfDay: h.timeOfDay, mapSize: h.mapSize, difficulty: h.difficulty, replay: true });
  const ui = new UI(game, returnToMenu);
  const controls = new Controls(game, ui);
  ui.controls = controls; game.controls = controls;
  game.ai = new AI(game);              // the AI re-runs deterministically from the seed
  controls.onPause = () => { game.paused = !game.paused; ui.setPaused(game.paused, false); };
  ui.onPause = controls.onPause; ui.onResume = () => { game.paused = false; ui.setPaused(false, false); };
  if (game.qualityMode !== 'auto') game.setQualityMode(game.qualityMode);
  window.__game = game; window.__controls = controls;
  controls.intro = 0; ui.hideIntroCard();
  ui.toast(`▶ Replay — ${game.map.biome.name}. ${FACTIONS[h.pf].name} vs ${FACTIONS[h.ef].name}.`);

  const frames = rep.frames;
  let fi = 0, desynced = false, done = false;
  let last = performance.now(), acc = 0;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    // consume recorded ticks at the pace they were recorded (real-time on any
    // display refresh), advancing the deterministic sim one logged frame at a time
    if (!game.paused && !done) {
      acc += Math.min(MAX_FRAME, rawDt);
      let steps = 0;
      while (acc >= SIM_DT && fi < frames.length && steps < MAX_STEPS * 4) {
        const f = frames[fi++];
        if (f.c) { const map = buildIdMap(game); for (const rec of f.c) game.dispatchRecorded(rec, map); }
        if (f.k !== undefined && !desynced && game.checksum() !== f.k) {
          desynced = true; ui.toast('⚠ Replay desynced — the simulation diverged from the recording.');
        }
        game.update(f.d);
        acc -= f.d; steps++;
      }
      game.replayDesync = desynced;
      if (fi >= frames.length) { done = true; game.replayDone = true; ui.toast(desynced ? 'Replay ended (desynced).' : '▣ Replay complete.'); }
    }
    Music.setIntensity(0);
    controls.updateCamera(dt);
    ui.update(dt);
    game.render();
  };
  current = { game, ai: game.ai, controls, ui, raf: requestAnimationFrame(loop) };
}

function showLoading(then) {
  document.getElementById('menu').style.display = 'none';
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  requestAnimationFrame(() => setTimeout(() => { then(); loading.style.display = 'none'; }, 30));
}

// ---------- multiplayer lobby + lockstep match ----------
let _mp = {};   // { transport, isHost, you, players }

function openLobby() {
  const opts = Object.values(FACTIONS).map(f => `<option value="${f.key}">${f.name}</option>`).join('');
  const fSel = document.getElementById('mp-faction'), foeSel = document.getElementById('mp-foe');
  fSel.innerHTML = opts; foeSel.innerHTML = opts;
  fSel.value = 'covenant'; foeSel.value = 'watchers';
  document.getElementById('mp-start').disabled = true;
  document.getElementById('lobby').classList.add('show');
}
function closeLobby() {
  document.getElementById('lobby').classList.remove('show');
  try { _mp.transport?.close?.(); } catch {}
  _mp = {};
}

function lobbyConnect(isHost) {
  const url = document.getElementById('mp-url').value.trim();
  const room = (document.getElementById('mp-room').value.trim() || 'default');
  const status = document.getElementById('mp-status');
  const startBtn = document.getElementById('mp-start');
  status.textContent = `Connecting to ${url} …`;
  let transport;
  try {
    transport = new WebSocketTransport(url, room, {
      onOpen: () => { status.textContent = isHost ? 'Hosting — waiting for an opponent to join…' : 'Joined — waiting for the host to start…'; },
      onClose: () => { status.textContent = 'Connection closed.'; startBtn.disabled = true; },
      onError: () => { status.textContent = 'Could not connect. Is the relay running?  (npm run relay)'; },
    });
  } catch { status.textContent = 'Invalid relay URL.'; return; }
  _mp = { transport, isHost, you: 0, players: [0], room };
  transport.onLobby = (msg) => {
    _mp.you = msg.you; _mp.players = msg.players;
    status.textContent = `Room "${room}" — ${msg.players.length} player(s). You are Player ${msg.you + 1}.`;
    startBtn.disabled = !(isHost && msg.players.length >= 2);
  };
  transport.onStart = (msg) => showLoading(() => startNetGame(transport, msg.header, _mp.you, msg.players));
}

function lobbyStart() {
  if (!_mp.transport || !_mp.isHost) return;
  const pf = document.getElementById('mp-faction').value;
  const ef = document.getElementById('mp-foe').value;
  const bsel = Settings.get('biome');
  const biomeKeys = Object.keys(BIOMES);
  const biomeKey = bsel && bsel !== 'random' ? bsel : biomeKeys[Math.floor(Math.random() * biomeKeys.length)];
  const moods = BIOMES[biomeKey].moods;
  const msel = Settings.get('mapSize');
  const header = {
    seed: Math.floor(Math.random() * 1e9), biomeKey,
    timeOfDay: moods[Math.floor(Math.random() * moods.length)],
    mapSize: MAP_SIZES[msel] ? msel : 'standard',
    difficulty: 'normal', pf, ef,
  };
  // the relay echoes 'start' back to the host too, so both clients begin via onStart
  _mp.transport.ws.send(JSON.stringify({ kind: 'start', header }));
}

// A networked, human-vs-human lockstep match. Both clients run the identical
// deterministic sim; game.cmd routes input to the session, and each turn's gathered
// commands are applied at the turn boundary on every client. No local AI.
function startNetGame(transport, header, you, players) {
  stopGame();
  document.getElementById('lobby').classList.remove('show');
  document.getElementById('menu').style.display = 'none';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('minimap-wrap').style.display = 'block';
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('gameover').style.display = 'none';

  const container = document.getElementById('game-container');
  const game = new Game(container, header.pf, header.ef, {
    seed: header.seed, biome: header.biomeKey, timeOfDay: header.timeOfDay,
    mapSize: header.mapSize, difficulty: header.difficulty, localPlayer: you,
  });
  const ui = new UI(game, returnToMenu);
  const controls = new Controls(game, ui);
  ui.controls = controls; game.controls = controls;
  game.rec = null;   // net matches aren't recorded by the single-stream recorder
  controls.onPause = () => {};   // no pause in a live net match
  if (game.qualityMode !== 'auto') game.setQualityMode(game.qualityMode);
  window.__game = game; window.__controls = controls;

  const session = new LockstepSession({
    players, localId: you, transport, turnLength: 3, delay: 2,
    onDesync: () => { game.netDesync = true; ui.toast('⚠ Desync — the match has drifted out of sync.'); },
  });
  game.net = session;     // game.cmd now defers commands to the session
  session.start();
  controls.intro = 0; ui.hideIntroCard();
  ui.toast(`⚔ Networked match — you are Player ${you + 1} (${FACTIONS[you === 0 ? header.pf : header.ef].name}).`);
  if (Settings.get('music')) Music.start();

  let last = performance.now(), acc = 0, tickInTurn = 0;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    acc = Math.min(MAX_FRAME, acc + rawDt);
    let steps = 0;
    while (acc >= SIM_DT && steps < MAX_STEPS) {
      // a turn spans turnLength ticks; commands for the turn apply at its first tick
      if (tickInTurn === 0) {
        if (!session.ready()) break;   // stall until every peer's packet for this turn arrives
        const cmds = session.commandsForCurrentTurn();
        if (cmds.length) { const map = buildIdMap(game); for (const c of cmds) game.dispatchRecorded(c.cmd, map); }
      }
      game.update(SIM_DT);
      acc -= SIM_DT; steps++;
      if (++tickInTurn >= session.ticksPerTurn) { tickInTurn = 0; session.advance(game.checksum()); }
    }
    if (steps >= MAX_STEPS) acc = 0;
    Music.setIntensity(game.over ? 0 : game.combatHeat);
    controls.updateCamera(dt);
    ui.update(dt);
    game.render();
  };
  current = { game, ai: null, controls, ui, raf: requestAnimationFrame(loop) };
}

function startGame(playerFactionKey) {
  // resolve opponent + land from the skirmish-setup selectors (Random by default).
  // Validate against the live roster so a stale/renamed persisted key can't crash start.
  const enemySel = Settings.get('enemy');
  const enemyKey = enemySel && FACTIONS[enemySel] && enemySel !== playerFactionKey ? enemySel : null;
  const biomeSel = Settings.get('biome');
  const biome = biomeSel && biomeSel !== 'random' ? biomeSel : null;
  // world generation takes a moment — paint the loading screen first
  showLoading(() => startGameNow(playerFactionKey, enemyKey, null, biome));
}

function startGameNow(playerFactionKey, enemyKey, loadData, biome) {
  stopGame();
  const loading = !!loadData;
  if (!enemyKey) { // new game: enemy is a random different faction
    const others = Object.keys(FACTIONS).filter(k => k !== playerFactionKey);
    enemyKey = others[Math.floor(Math.random() * others.length)];
  }

  document.getElementById('menu').style.display = 'none';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('minimap-wrap').style.display = 'block';
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('gameover').style.display = 'none';

  const container = document.getElementById('game-container');
  const opts = loadData ? { load: loadData } : { ...(window.__forceOpts || {}), ...(biome ? { biome } : {}) };
  const game = new Game(container, playerFactionKey, enemyKey, opts);
  const ui = new UI(game, returnToMenu);
  const controls = new Controls(game, ui);
  ui.controls = controls;
  game.controls = controls;
  controls.onPause = () => togglePause();
  ui.onPause = () => togglePause();
  ui.onResume = () => togglePause(false);
  ui.onSave = () => saveGame();
  ui.onLoad = () => { togglePause(false); loadSavedGame(); };
  ui.onSaveAvailable = hasSave;
  ui.onDownloadReplay = downloadReplay;
  game.ai = new AI(game);
  if (loading && game._aiState) Object.assign(game.ai, game._aiState);
  // pin quality if the player chose a fixed level (auto leaves the loop in charge)
  if (game.qualityMode !== 'auto') game.setQualityMode(game.qualityMode);
  window.__game = game; window.__controls = controls;

  if (Settings.get('music')) Music.start();   // user gesture (faction click) already unlocked audio

  if (loading) { controls.intro = 0; ui.hideIntroCard(); ui.toast(`Campaign restored — ${game.map.biome.name}.`); }
  else {
    ui.showIntroCard(FACTIONS[playerFactionKey]);
    ui.toast(`${game.map.biome.name} — the ${FACTIONS[enemyKey].name} stir beyond the ridge…`);
    showCoachHints();   // gentle first-match nudges (only on a fresh game)
  }

  let last = performance.now();
  let acc = 0;
  let slowFrames = 0, totalFrames = 0, autosaveT = AUTOSAVE_SECONDS;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);   // clamped, for non-sim per-frame work
    last = now;
    // auto quality: after warmup, sustained slow frames drop bloom + pixel ratio
    totalFrames++;
    if (totalFrames > 40 && !game.lowQuality && game.autoQuality) {
      slowFrames = rawDt > 0.045 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
      if (slowFrames > 25) game.setLowQuality();
    }
    // silent autosave on a steady cadence so Continue always resumes the latest
    if (!game.paused && !game.over) {
      autosaveT -= dt;
      if (autosaveT <= 0) { autosaveT = AUTOSAVE_SECONDS; saveGame(true); }
    }
    // fixed-timestep simulation (pause freezes only the sim, not camera/HUD)
    if (!game.paused) {
      acc += Math.min(MAX_FRAME, rawDt);
      let steps = 0;
      while (acc >= SIM_DT && steps < MAX_STEPS) {
        game.update(SIM_DT);
        acc -= SIM_DT; steps++;
        if (game.over) { acc = 0; break; }
      }
      if (steps >= MAX_STEPS) acc = 0;   // drop backlog rather than spiral
    }
    Music.setIntensity(game.paused || game.over ? 0 : game.combatHeat);  // score swells with battle
    controls.updateCamera(dt);           // camera + HUD stay responsive while paused
    ui.update(dt);
    game.render();
  };
  current = { game, ai: game.ai, controls, ui, raf: requestAnimationFrame(loop) };
}

function stopGame() {
  if (!current) return;
  cancelAnimationFrame(current.raf);
  current.game.dispose();
  current = null;
}

function returnToMenu() {
  saveGame(true);   // autosave on abandon (no-op if the match is already over)
  stopGame();
  try { _mp.transport?.close?.(); } catch {}
  _mp = {};
  document.getElementById('lobby')?.classList.remove('show');
  Music.stop();
  hideCoach();
  document.getElementById('help')?.classList.remove('show');
  document.getElementById('settings').style.display = 'none';
  document.getElementById('menu').style.display = 'flex';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('minimap-wrap').style.display = 'none';
  document.getElementById('panel').style.display = 'none';
  document.getElementById('gameover').style.display = 'none';
  const pm = document.getElementById('pausemenu'); if (pm) pm.style.display = 'none';
  const dlg = document.getElementById('dialogue'); if (dlg) dlg.classList.remove('show');
  const ic = document.getElementById('introcard'); ic.style.display = 'none'; ic.classList.remove('show');
  document.getElementById('toasts').innerHTML = '';
  const ov = document.getElementById('overlay');
  ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  refreshContinue();
}

// ---------- onboarding coach: a short sequence of first-match nudges ----------
let coachTimers = [];
function hideCoach() {
  coachTimers.forEach(clearTimeout); coachTimers = [];
  document.getElementById('coach')?.classList.remove('show');
}
function showCoachHints() {
  if (Settings.get('coachSeen')) return;     // once per player, ever
  const el = document.getElementById('coach');
  if (!el) return;
  const hints = [
    '⛏  Select a laborer and right-click grain or timber to gather. Workers win wars.',
    '🏗  Press B with a laborer selected to build. A granary raises your population cap.',
    '⚔  Build a barracks, train soldiers, then press F to attack-move toward the enemy.',
    '☠  Destroy the enemy\'s seat of power to win. Press ? any time for the full controls.',
  ];
  let i = 0;
  const show = () => {
    if (i >= hints.length) { el.classList.remove('show'); return; }
    el.textContent = hints[i++];
    el.classList.add('show');
    coachTimers.push(setTimeout(() => { el.classList.remove('show'); coachTimers.push(setTimeout(show, 600)); }, 7000));
  };
  coachTimers.push(setTimeout(show, 6000));   // let the intro flyover land first
  Settings.set('coachSeen', true);
}

// ---------- settings panel + help + touch notice (bound once) ----------
function bindShell() {
  // apply persisted audio volumes immediately
  Sound.setVolume(Settings.get('sfxVol'));
  Music.setVolume(Settings.get('musicVol'));

  const $ = id => document.getElementById(id);
  const settings = $('settings');
  const openSettings = () => { syncSettingsUI(); settings.style.display = 'flex'; };
  const closeSettings = () => { settings.style.display = 'none'; };

  $('btn-settings')?.addEventListener('click', openSettings);
  $('set-close')?.addEventListener('click', closeSettings);
  settings?.addEventListener('click', e => { if (e.target === settings) closeSettings(); });

  // brightness
  const bright = $('set-bright'), brightVal = $('set-bright-val');
  bright?.addEventListener('input', () => {
    const v = parseFloat(bright.value);
    brightVal.textContent = Math.round(v * 100) + '%';
    Settings.set('brightness', v);
    current?.game.setBrightness(v);
  });
  // quality segmented control
  for (const b of document.querySelectorAll('#set-quality button')) {
    b.addEventListener('click', () => {
      const q = b.dataset.q;
      Settings.set('quality', q);
      current?.game.setQualityMode(q);
      syncSeg('set-quality', 'q', q);
    });
  }
  // music on/off
  for (const b of document.querySelectorAll('#set-music button')) {
    b.addEventListener('click', () => {
      const on = b.dataset.m === 'on';
      Settings.set('music', on);
      if (on) { if (current) Music.start(); } else Music.stop();
      syncSeg('set-music', 'm', b.dataset.m);
    });
  }
  // volumes
  const mvol = $('set-mvol'), mvolVal = $('set-mvol-val');
  mvol?.addEventListener('input', () => {
    const v = parseFloat(mvol.value);
    mvolVal.textContent = Math.round(v * 100) + '%';
    Settings.set('musicVol', v); Music.setVolume(v);
  });
  const svol = $('set-svol'), svolVal = $('set-svol-val');
  svol?.addEventListener('input', () => {
    const v = parseFloat(svol.value);
    svolVal.textContent = Math.round(v * 100) + '%';
    Settings.set('sfxVol', v); Sound.setVolume(v);
    Sound.select();   // audible preview
  });

  // help / hotkey reference
  const help = $('help');
  const toggleHelp = () => help?.classList.toggle('show');
  $('btn-help')?.addEventListener('click', toggleHelp);
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === '?') toggleHelp();
    if (e.key === 'Escape') {
      if (settings.style.display === 'flex') closeSettings();
      else help?.classList.remove('show');
    }
  });

  // "best on desktop" notice on touch / coarse-pointer devices
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (touch && !Settings.get('touchNoteDismissed')) {
    const note = $('touchnote');
    note?.classList.add('show');
    $('touchnote-x')?.addEventListener('click', () => {
      note.classList.remove('show'); Settings.set('touchNoteDismissed', true);
    });
    setTimeout(() => note?.classList.remove('show'), 12000);
  }
}

function syncSeg(groupId, attr, value) {
  for (const b of document.querySelectorAll(`#${groupId} button`))
    b.classList.toggle('on', b.dataset[attr] === value);
}
function syncSettingsUI() {
  const $ = id => document.getElementById(id);
  const b = Settings.get('brightness');
  $('set-bright').value = b; $('set-bright-val').textContent = Math.round(b * 100) + '%';
  const mv = Settings.get('musicVol');
  $('set-mvol').value = mv; $('set-mvol-val').textContent = Math.round(mv * 100) + '%';
  const sv = Settings.get('sfxVol');
  $('set-svol').value = sv; $('set-svol-val').textContent = Math.round(sv * 100) + '%';
  syncSeg('set-quality', 'q', Settings.get('quality'));
  syncSeg('set-music', 'm', Settings.get('music') ? 'on' : 'off');
}

// test/debug hook: drive deterministic replay playback from a recording object
window.__startReplay = startReplay;

// Test hooks for headless CI. The art-spec renderer (3072² shadows, bloom) is so
// heavy under a runner's software-WebGL that the rAF loop can render barely a frame
// per second, which would starve the fixed-timestep sim of wall-clock time. The sim
// itself is deterministic and render-independent, so tests step it directly — the
// same "drive the engine, not the clock" approach the smoke tests already use to
// skip the intro flyover. This advances the live match's sim without waiting on frames.
window.__stepSim = (seconds) => {
  const g = window.__game;
  if (!g) return 0;
  const n = Math.max(1, Math.round(seconds * SIM_HZ));
  for (let i = 0; i < n; i++) g.update(SIM_DT);
  return g.time;
};

// Re-run a recorded replay synchronously through a fresh deterministic Game, with the
// exact same dispatch + per-frame checksum comparison as the live (rAF-driven) replay
// loop in startReplay — just without rendering, so it can't be starved by a slow GPU.
// Sets window.__game.replayDone / replayDesync for the smoke test to read.
window.__runReplaySync = (rep) => {
  stopGame();
  const h = rep.header;
  const container = document.getElementById('game-container');
  const game = new Game(container, h.pf, h.ef, { seed: h.seed, biome: h.biomeKey,
    timeOfDay: h.timeOfDay, mapSize: h.mapSize, difficulty: h.difficulty, replay: true });
  game.ai = new AI(game);              // the AI re-runs deterministically from the seed
  if (game.qualityMode !== 'auto') game.setQualityMode(game.qualityMode);
  window.__game = game; window.__controls = null;
  let desynced = false;
  for (const f of rep.frames) {
    if (f.c) { const map = buildIdMap(game); for (const rec of f.c) game.dispatchRecorded(rec, map); }
    if (f.k !== undefined && !desynced && game.checksum() !== f.k) desynced = true;
    game.update(f.d);
  }
  game.replayDesync = desynced;
  game.replayDone = true;
  current = { game, ai: game.ai, controls: null, ui: null, raf: 0 };
  return { desync: desynced, frames: rep.frames.length };
};

bindShell();
buildMenu();
