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
}

function startGame(playerFactionKey) {
  // world generation takes a moment — paint the loading screen first
  document.getElementById('menu').style.display = 'none';
  const loading = document.getElementById('loading');
  loading.style.display = 'flex';
  requestAnimationFrame(() => setTimeout(() => {
    startGameNow(playerFactionKey);
    loading.style.display = 'none';
  }, 30));
}

function startGameNow(playerFactionKey) {
  stopGame();
  // enemy: random different faction
  const others = Object.keys(FACTIONS).filter(k => k !== playerFactionKey);
  const enemyKey = others[Math.floor(Math.random() * others.length)];

  document.getElementById('menu').style.display = 'none';
  document.getElementById('topbar').style.display = 'flex';
  document.getElementById('minimap-wrap').style.display = 'block';
  document.getElementById('panel').style.display = 'flex';
  document.getElementById('gameover').style.display = 'none';

  const container = document.getElementById('game-container');
  const game = new Game(container, playerFactionKey, enemyKey);
  const ui = new UI(game, returnToMenu);
  const controls = new Controls(game, ui);
  ui.controls = controls;
  game.ai = new AI(game);
  window.__game = game; window.__controls = controls;

  ui.toast(`The ${FACTIONS[enemyKey].name} stir beyond the ridge…`);

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
    game.update(dt);
    controls.updateCamera(dt);
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
  document.getElementById('toasts').innerHTML = '';
  const ov = document.getElementById('overlay');
  ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
}

buildMenu();
