// Entry point: main menu, faction selection, game lifecycle and loop.
import { FACTIONS } from './data.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';

const TRAITS = {
  covenant: 'Balanced economy · strong defenses · disciplined bronze infantry · temple favor',
  watchers: 'Elite expensive units · forbidden knowledge tech · devastating casters',
  nephilim: 'Brutal melee · fast raids · giants that level cities · weak economy',
};

let current = null; // { game, ai, controls, ui, raf }
const SAVE_KEY = 'sotw_save_v1';

function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }

function saveGame() {
  if (!current || current.game.over) return false;
  try {
    const g = current.game;
    const payload = { data: g.serialize(), meta: { faction: g.pfKey, enemy: g.efKey,
      biome: g.map.biome.name, time: Math.floor(g.time), at: Date.now() } };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    current.ui.toast('⌖ Campaign saved.');
    refreshContinue();
    return true;
  } catch (e) { current?.ui.toast('Save failed — storage may be full.'); return false; }
}

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
  refreshContinue();
}

function showLoading(then) {
  document.getElementById('menu').style.display = 'none';
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  requestAnimationFrame(() => setTimeout(() => { then(); loading.style.display = 'none'; }, 30));
}

function startGame(playerFactionKey) {
  // world generation takes a moment — paint the loading screen first
  showLoading(() => startGameNow(playerFactionKey));
}

function startGameNow(playerFactionKey, enemyKey, loadData) {
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
  const opts = loadData ? { load: loadData } : (window.__forceOpts || {});
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
  window.__game = game; window.__controls = controls;

  if (loading) { controls.intro = 0; ui.hideIntroCard(); ui.toast(`Campaign restored — ${game.map.biome.name}.`); }
  else {
    ui.showIntroCard(FACTIONS[playerFactionKey]);
    ui.toast(`${game.map.biome.name} — the ${FACTIONS[enemyKey].name} stir beyond the ridge…`);
  }

  let last = performance.now();
  let slowFrames = 0, totalFrames = 0;
  const loop = (now) => {
    current.raf = requestAnimationFrame(loop);
    const rawDt = (now - last) / 1000;
    const dt = Math.min(0.05, rawDt);
    last = now;
    // auto quality: after warmup, sustained slow frames drop bloom + pixel ratio
    totalFrames++;
    if (totalFrames > 40 && !game.lowQuality) {
      slowFrames = rawDt > 0.045 ? slowFrames + 1 : Math.max(0, slowFrames - 2);
      if (slowFrames > 25) game.setLowQuality();
    }
    if (!game.paused) game.update(dt);   // pause freezes the simulation only
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
  stopGame();
  document.getElementById('menu').style.display = 'flex';
  document.getElementById('topbar').style.display = 'none';
  document.getElementById('minimap-wrap').style.display = 'none';
  document.getElementById('panel').style.display = 'none';
  document.getElementById('gameover').style.display = 'none';
  const pm = document.getElementById('pausemenu'); if (pm) pm.style.display = 'none';
  const ic = document.getElementById('introcard'); ic.style.display = 'none'; ic.classList.remove('show');
  document.getElementById('toasts').innerHTML = '';
  const ov = document.getElementById('overlay');
  ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  refreshContinue();
}

buildMenu();
