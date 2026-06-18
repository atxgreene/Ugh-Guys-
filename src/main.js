// Entry point: main menu, faction selection, game lifecycle and loop.
import { FACTIONS } from './data.js';
import { BIOMES, MAP_SIZES } from './terrain.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { Sound, Music } from './audio.js';
import { Settings } from './settings.js';

const TRAITS = {
  covenant: 'Balanced economy · strong defenses · disciplined bronze infantry · temple favor',
  watchers: 'Elite expensive units · forbidden knowledge tech · devastating casters',
  nephilim: 'Brutal melee · fast raids · giants that level cities · weak economy',
};

let current = null; // { game, ai, controls, ui, raf }
const SAVE_KEY = 'sotw_save_v1';
const AUTOSAVE_SECONDS = 45;

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

function showLoading(then) {
  document.getElementById('menu').style.display = 'none';
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  requestAnimationFrame(() => setTimeout(() => { then(); loading.style.display = 'none'; }, 30));
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
  let slowFrames = 0, totalFrames = 0, autosaveT = AUTOSAVE_SECONDS;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
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
    if (!game.paused) game.update(dt);   // pause freezes the simulation only
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

bindShell();
buildMenu();
