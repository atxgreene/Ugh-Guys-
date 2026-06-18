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
    document.getElementById('mp-quick').onclick = () => { Sound.click(); lobbyQuickMatch(); };
    document.getElementById('mp-host2').onclick = () => { Sound.click(); lobbyHost(); };
    document.getElementById('mp-join2').onclick = () => { Sound.click(); lobbyJoin(); };
    document.getElementById('mp-code').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); lobbyJoin(); } };
    document.getElementById('mp-ready').onclick = () => { Sound.click(); lobbyToggleReady(); };
    document.getElementById('mp-start').onclick = () => { Sound.click(); lobbyStart(); };
    document.getElementById('mp-copy').onclick = () => { Sound.click(); lobbyCopyInvite(); };
    document.getElementById('mp-cancel-qm').onclick = () => { Sound.click(); lobbyCancelQuickMatch(); };
    document.getElementById('mp-close').onclick = () => { Sound.click(); closeLobby(); };
    document.getElementById('mp-cl-quit').onclick = () => { Sound.click(); returnToMenu(); };
    const nameInput = document.getElementById('mp-name');
    if (nameInput) {
      nameInput.value = Settings.get('mpName') || '';
      nameInput.onchange = () => { Settings.set('mpName', nameInput.value.trim()); _mp.transport?.setName?.(nameInput.value.trim()); };
    }
    document.getElementById('mp-faction').onchange = () => {
      const f = document.getElementById('mp-faction').value;
      Settings.set('mpFaction', f); _mp.transport?.setFaction?.(f);
    };
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
let _chatCleanup = null;   // tears down in-match chat key listeners between games

// Append one line to a chat log. `from` is the sender's seat; `youSeat` is the local
// seat, so we can colour our own lines differently. `sys` marks a system notice.
function appendChat(logEl, { from, text, sys }, youSeat) {
  if (!logEl) return null;
  const div = document.createElement('div');
  if (sys) { div.className = 'cm cm-sys'; div.textContent = text; }
  else {
    const mine = from === youSeat;
    div.className = 'cm ' + (mine ? 'cm-me' : 'cm-them');
    const who = document.createElement('b');
    who.textContent = (mine ? 'You' : `Player ${(from ?? 0) + 1}`) + ': ';
    div.appendChild(who);
    div.appendChild(document.createTextNode(text));
  }
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// The hosted relay players reach by default — no setup, no URLs. Overridable via the
// Advanced panel (e.g. ws://localhost:8787 for dev) or a ?relay= query param.
const DEFAULT_RELAY = 'wss://sotw-relay.fly.dev';
const CODE_WORDS = ['RAVEN', 'ASHEN', 'IRON', 'GRAVE', 'WOLF', 'EMBER', 'STORM', 'THORN',
  'DUSK', 'FROST', 'BONE', 'OMEN', 'RUIN', 'VEIL', 'WRAITH', 'TIDE'];

function genCode() {
  const w = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)];
  const n = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${w}-${n}`;
}
// A code is also the relay room name; normalize so "raven 7f2a" and "RAVEN-7F2A" match.
function codeToRoom(code) { return String(code).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '-'); }

function relayUrl() {
  let url = document.getElementById('mp-url').value.trim() || DEFAULT_RELAY;
  if (!/^wss?:\/\//.test(url)) url = /^https?:\/\//.test(url) ? url.replace(/^https?/, 'ws') : 'ws://' + url;
  return url;
}
function mpStatus(t) { const s = document.getElementById('mp-status'); if (s) s.textContent = t || ''; }
function setStage(stage) {
  _mp.stage = stage;
  for (const s of ['choose', 'search', 'room'])
    document.getElementById('mp-stage-' + s).style.display = s === stage ? 'block' : 'none';
}

function openLobby(prefillCode) {
  const fSel = document.getElementById('mp-faction');
  fSel.innerHTML = Object.values(FACTIONS).map(f => `<option value="${f.key}">${f.name}</option>`).join('');
  fSel.value = Settings.get('mpFaction') && FACTIONS[Settings.get('mpFaction')] ? Settings.get('mpFaction') : 'covenant';
  const nameInput = document.getElementById('mp-name');
  if (nameInput && !nameInput.value) nameInput.value = Settings.get('mpName') || '';
  // relay: query override > saved > default; shown only inside Advanced
  const qsRelay = new URLSearchParams(location.search).get('relay');
  document.getElementById('mp-url').value = qsRelay || Settings.get('mpRelay') || DEFAULT_RELAY;
  document.getElementById('lobby-chat').style.display = 'none';
  document.getElementById('lobby-chat-log').innerHTML = '';
  document.getElementById('mp-start').disabled = true;
  document.getElementById('mp-ready').classList.remove('on');
  document.getElementById('mp-invite').style.display = 'none';
  mpStatus('');
  setStage('choose');
  document.getElementById('lobby').classList.add('show');
  _mp = { stage: 'choose' };
  if (prefillCode) {
    document.getElementById('mp-code').value = prefillCode;
    lobbyJoin(prefillCode);
  }
}

function hideLobbyPanel() { document.getElementById('lobby').classList.remove('show'); }

function closeLobby() {
  hideLobbyPanel();
  if (_mp.pingTimer) { clearInterval(_mp.pingTimer); _mp.pingTimer = null; }
  try { _mp.transport?.cancelQuickMatch?.(); } catch {}
  try { _mp.transport?.close?.(); } catch {}
  _mp = {};
}

function localName() {
  return (document.getElementById('mp-name').value.trim() || 'Commander');
}
function localFaction() { return document.getElementById('mp-faction').value; }

// Connect (once) to the relay for a given room and wire every channel. Reused by host,
// join, and quick match — they differ only in the room and which stage they show.
function ensureTransport(room) {
  if (_mp.transport) { try { _mp.transport.close(); } catch {} }
  Settings.set('mpRelay', document.getElementById('mp-url').value.trim());
  const chatLog = document.getElementById('lobby-chat-log');
  const transport = new WebSocketTransport(relayUrl(), room, {
    name: localName(), faction: localFaction(),
    onError: () => mpStatus('Could not reach the relay. Check the address in Advanced, or try again.'),
  });
  _mp.transport = transport;

  transport.onStatus = (st) => {
    if (st === 'reconnecting') mpStatus('Connection lost — reconnecting…');
    else if (st === 'reconnected') mpStatus('Reconnected.');
  };
  transport.onLobby = (msg) => {
    const grew = (_mp.players?.length || 0) < msg.players.length;
    const left = msg.left;
    Object.assign(_mp, { you: msg.you, players: msg.players, names: msg.names || [],
      readies: msg.readies || [], factions: msg.factions || [] });
    if (msg.auto && _mp.stage !== 'room') onQuickMatched();   // paired → drop into a room
    renderPlayers();
    document.getElementById('lobby-chat').style.display = 'block';
    if (grew && _mp.stage === 'room') appendChat(chatLog, { sys: true, text: `${(msg.names||[])[msg.players.length-1] || 'A player'} joined.` });
    if (left) appendChat(chatLog, { sys: true, text: 'A player left.' });
  };
  transport.onChat = (msg) => appendChat(chatLog, { from: msg.from, text: msg.text }, _mp.you);
  transport.onStart = (msg) => { if (_mp.started) return; _mp.started = true; beginNetMatch(transport, msg.header, _mp.you, msg.players); };
  transport.onPong = (msg) => updatePing(Date.now() - msg.t);

  // chat input (bound once per connect)
  const chatInput = document.getElementById('lobby-chat-input');
  chatInput.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    transport.sendChat(text);
    appendChat(chatLog, { from: _mp.you, text }, _mp.you);
    chatInput.value = '';
  };

  // liveness ping for the connection indicator
  if (_mp.pingTimer) clearInterval(_mp.pingTimer);
  _mp.pingTimer = setInterval(() => transport.ping(), 2500);
  transport.ping();
  return transport;
}

function lobbyHost() {
  const code = genCode();
  _mp.code = code; _mp.isAuto = false;
  ensureTransport(codeToRoom(code));
  document.getElementById('mp-code-display').textContent = code;
  document.getElementById('mp-invite').style.display = 'flex';
  document.getElementById('mp-copy').classList.remove('done');
  document.getElementById('mp-copy').textContent = '⧉ Copy link';
  setStage('room');
  mpStatus('Share the code or link. The match starts when both players ready up.');
}

function lobbyJoin(code) {
  code = code || document.getElementById('mp-code').value;
  if (!code || !code.trim()) { mpStatus('Enter an invite code to join.'); return; }
  _mp.code = codeToRoom(code); _mp.isAuto = false;
  ensureTransport(_mp.code);
  document.getElementById('mp-code-display').textContent = _mp.code;
  document.getElementById('mp-invite').style.display = 'flex';
  setStage('room');
  mpStatus('Joined. Ready up when you are set.');
}

function lobbyQuickMatch() {
  _mp.isAuto = true;
  // a throwaway holding room; the relay pulls us into the queue and pairs us elsewhere
  ensureTransport('__lobby_' + Math.random().toString(36).slice(2, 8));
  _mp.transport.quickMatch(localName());
  setStage('search');
  mpStatus('Looking for an opponent…');
}
function lobbyCancelQuickMatch() {
  try { _mp.transport?.cancelQuickMatch?.(); _mp.transport?.close?.(); } catch {}
  _mp.transport = null;
  if (_mp.pingTimer) { clearInterval(_mp.pingTimer); _mp.pingTimer = null; }
  setStage('choose');
  mpStatus('');
}

// Quick match paired us: show the room, auto-ready, and let seat 0 auto-launch.
function onQuickMatched() {
  document.getElementById('mp-invite').style.display = 'none';
  setStage('room');
  mpStatus('Opponent found! Locking in…');
  _mp.ready = true;
  document.getElementById('mp-ready').classList.add('on');
  _mp.transport.sendReady(true);
}

function lobbyToggleReady() {
  _mp.ready = !_mp.ready;
  document.getElementById('mp-ready').classList.toggle('on', _mp.ready);
  _mp.transport?.sendReady(_mp.ready);
}

function lobbyCopyInvite() {
  const link = `${location.origin}${location.pathname}?join=${encodeURIComponent(_mp.code)}`;
  const btn = document.getElementById('mp-copy');
  const done = () => { btn.classList.add('done'); btn.textContent = '✓ Copied'; };
  navigator.clipboard?.writeText(link).then(done, () => {
    // fallback for non-secure contexts
    const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t);
    t.select(); try { document.execCommand('copy'); done(); } catch {} t.remove();
  });
}

// Render the seat list with names, factions, and ready state, and gate the Start button.
function renderPlayers() {
  const wrap = document.getElementById('mp-players');
  if (!wrap) return;
  const n = _mp.players?.length || 0;
  wrap.innerHTML = '';
  for (let i = 0; i < Math.max(2, n); i++) {
    const present = i < n;
    const name = present ? (_mp.names[i] || `Player ${i + 1}`) : 'Waiting for opponent…';
    const fac = present && _mp.factions[i] && FACTIONS[_mp.factions[i]] ? FACTIONS[_mp.factions[i]].name : '';
    const ready = present && _mp.readies[i];
    const row = document.createElement('div');
    row.className = `mp-player p${i}` + (i === _mp.you ? ' you' : '') + (present ? '' : ' empty');
    row.innerHTML = `<span class="mp-seat"></span><span class="mp-pname">${name}${fac ? ' · ' + fac : ''}</span>` +
      (present ? `<span class="mp-rs ${ready ? 'on' : 'off'}">${ready ? '● Ready' : '○ Not ready'}</span>` : '<span class="mp-rs off">—</span>');
    wrap.appendChild(row);
  }
  const allReady = n >= 2 && _mp.readies.slice(0, n).every(Boolean);
  // seat 0 owns the launch; everyone else just readies up
  document.getElementById('mp-start').disabled = !(_mp.you === 0 && allReady);
  if (_mp.isAuto && _mp.you === 0 && allReady && !_mp.started) lobbyStart();   // quick match auto-launches
}

function updatePing(ms) {
  _mp.pingMs = ms;
  const el = document.getElementById('mp-ping');
  if (el) {
    el.className = 'mp-ping ' + (ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad');
    el.innerHTML = `ping <b>${Math.round(ms)}ms</b>`;
  }
  const nel = document.getElementById('net-ping');
  if (nel && current && current.game && current.game.net) {
    nel.style.display = 'block';
    nel.className = ms < 80 ? 'good' : ms < 160 ? 'ok' : 'bad';
    nel.textContent = `▲ ${Math.round(ms)}ms`;
  }
}

function lobbyStart() {
  if (!_mp.transport || _mp.you !== 0 || _mp.startSent) return;
  _mp.startSent = true;
  const pf = _mp.factions[0] || localFaction() || 'covenant';
  const ef = _mp.factions[1] || 'watchers';
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
  // the relay echoes 'start' back to seat 0 too, so both clients begin via onStart
  _mp.transport.sendMessage({ kind: 'start', header });
}

// A 3-2-1 launch countdown over the menu, then drop into the match. Both clients run it
// when the 'start' packet arrives, so they enter together (the lockstep prime keeps the
// sim itself frame-exact regardless of a few ms of skew here).
function runCountdown(then) {
  const ov = document.getElementById('mp-countdown');
  const num = document.getElementById('mp-cd-num');
  if (!ov || !num) { then(); return; }
  hideLobbyPanel();
  ov.classList.add('show');
  let n = 3;
  num.textContent = n;
  const tick = () => {
    n--;
    if (n > 0) { num.textContent = n; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = ''; setTimeout(tick, 1000); }
    else if (n === 0) { num.textContent = 'GO'; setTimeout(tick, 700); }
    else { ov.classList.remove('show'); then(); }
  };
  setTimeout(tick, 1000);
}

function beginNetMatch(transport, header, you, players) {
  if (_mp.pingTimer) { clearInterval(_mp.pingTimer); _mp.pingTimer = null; }
  runCountdown(() => showLoading(() => startNetGame(transport, header, you, players)));
  // keep a light ping going during the match for the HUD indicator
  _mp.pingTimer = setInterval(() => { try { transport.ping(); } catch {} }, 2500);
}

// In-match chat overlay. Enter opens a one-line composer; Enter again sends, Escape
// cancels. Messages ride the relay's chat channel (never the lockstep stream, so they
// can't desync the sim) and fade after a few seconds so they don't clutter the field.
function setupMatchChat(transport, youSeat) {
  const wrap = document.getElementById('match-chat');
  const log = document.getElementById('match-chat-log');
  const input = document.getElementById('match-chat-input');
  if (!wrap || !log || !input) return;
  log.innerHTML = '';
  wrap.style.display = 'flex';
  wrap.classList.remove('typing');

  const FADE_MS = 9000;
  const add = (m) => {
    const div = appendChat(log, m, youSeat);
    if (!div) return;
    div.style.transition = 'opacity 1.2s';
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 1300); }, FADE_MS);
  };

  transport.onChat = (msg) => add({ from: msg.from, text: msg.text });

  const openComposer = () => {
    wrap.classList.add('typing');
    input.focus();
    // surface any faded lines while composing so you can read the thread
    for (const c of log.children) { c.style.transition = ''; c.style.opacity = '1'; }
  };
  const closeComposer = () => { wrap.classList.remove('typing'); input.value = ''; input.blur(); };

  const onKey = (e) => {
    if (e.key === 'Enter' && document.activeElement !== input) {
      // don't hijack Enter while another field (settings, etc.) is focused
      if (e.target && e.target.tagName === 'INPUT') return;
      e.preventDefault();
      openComposer();
    }
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const text = input.value.trim();
      if (text) { transport.sendChat(text); add({ from: youSeat, text }); }
      closeComposer();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeComposer();
    }
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey);

  // tear down when the match ends so listeners don't leak into the next game
  _chatCleanup = () => {
    window.removeEventListener('keydown', onKey);
    input.onkeydown = null;
    wrap.style.display = 'none';
    wrap.classList.remove('typing');
    log.innerHTML = '';
  };
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
  ui.toast(`⚔ Networked match — you are Player ${you + 1} (${FACTIONS[you === 0 ? header.pf : header.ef].name}). Press Enter to chat.`);
  if (Settings.get('music')) Music.start();

  setupMatchChat(transport, you);

  // connection overlay: shown when the socket drops or the sim stalls waiting on a peer
  const conn = document.getElementById('mp-connlost');
  const connTitle = document.getElementById('mp-cl-title');
  const connSub = document.getElementById('mp-cl-sub');
  let socketDown = false;
  const showConn = (on, title, sub) => {
    if (conn) { conn.classList.toggle('show', on); if (on && title) { connTitle.textContent = title; connSub.textContent = sub || ''; } }
  };
  transport.onStatus = (st) => {
    if (st === 'reconnecting') { socketDown = true; showConn(true, 'Connection lost', 'Reconnecting to the relay…'); }
    else if (st === 'reconnected') { socketDown = false; showConn(false); ui.toast('✓ Reconnected.'); }
  };

  let last = performance.now(), acc = 0, tickInTurn = 0, stallStart = 0;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    acc = Math.min(MAX_FRAME, acc + rawDt);
    let steps = 0, stalled = false;
    while (acc >= SIM_DT && steps < MAX_STEPS) {
      // a turn spans turnLength ticks; commands for the turn apply at its first tick
      if (tickInTurn === 0) {
        if (!session.ready()) { stalled = true; break; }   // hold until every peer's packet arrives
        const cmds = session.commandsForCurrentTurn();
        if (cmds.length) { const map = buildIdMap(game); for (const c of cmds) game.dispatchRecorded(c.cmd, map); }
      }
      game.update(SIM_DT);
      acc -= SIM_DT; steps++;
      if (++tickInTurn >= session.ticksPerTurn) { tickInTurn = 0; session.advance(game.checksum()); }
    }
    if (steps >= MAX_STEPS) acc = 0;
    // Surface a waiting-on-opponent overlay if we've been blocked a beat (but not while
    // the socket itself is reconnecting — that message takes precedence).
    if (stalled && !socketDown) {
      if (!stallStart) stallStart = now;
      if (now - stallStart > 900) showConn(true, 'Waiting for opponent…', 'Their game has fallen behind or dropped.');
    } else if (!socketDown) {
      stallStart = 0; showConn(false);
    }
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
  if (_chatCleanup) { try { _chatCleanup(); } catch {} _chatCleanup = null; }
  document.getElementById('mp-connlost')?.classList.remove('show');
  const np = document.getElementById('net-ping'); if (np) np.style.display = 'none';
  if (!current) return;
  cancelAnimationFrame(current.raf);
  current.game.dispose();
  current = null;
}

function returnToMenu() {
  saveGame(true);   // autosave on abandon (no-op if the match is already over)
  stopGame();
  if (_mp.pingTimer) { clearInterval(_mp.pingTimer); _mp.pingTimer = null; }
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
  // iOS ignores the viewport's user-scalable=no, so a pinch (even on the HUD, away
  // from the canvas which already preventDefaults its touches) would zoom the whole
  // page and strand the player off-screen. Suppressing the Safari gesture events
  // stops page pinch-zoom everywhere; CSS touch-action handles double-tap zoom.
  for (const t of ['gesturestart', 'gesturechange', 'gestureend'])
    document.addEventListener(t, e => e.preventDefault(), { passive: false });

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

// Deep-link: opening an invite link (?join=CODE) drops you straight into that lobby.
(() => {
  const code = new URLSearchParams(location.search).get('join');
  if (code) { try { history.replaceState(null, '', location.pathname); } catch {} openLobby(code); }
})();
