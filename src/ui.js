// HUD: resource bar, minimap, selection/command panel, health bars, toasts.
import * as THREE from 'three';
import { GRID, TILE, WORLD } from './terrain.js';
import { RESOURCE_INFO, UPGRADES } from './data.js';
import { Sound } from './audio.js';

const UNIT_ICONS = {
  laborer: '⛏', spearman: '🛡', archer: '🏹', chariot: '🐎', temple_guard: '⚔', prophet: '🔥',
  servitor: '⛏', starmetal: '⚔', adept: '✦', skyfire: '☄', hybrid: '👹',
  thrall: '⛏', raider: '🪓', champion: '🦴', warbeast: '🐺', giant: '🗿', shaman: '💀',
  devourer: '🐲',
};
const BLD_ICONS = {
  city_center: '🏛', granary: '🌾', barracks: '⚔', foundry: '⚒', temple: '🔥', watchtower: '🗼',
  fallen_spire: '🌠', star_forge: '☄', obsidian_gate: '🌀', archive: '📜', hybrid_pit: '🕳', watcher_tower: '👁',
  clan_hearth: '🔥', bone_pit: '🦴', war_lodge: '🪓', beast_den: '🐺', totem: '💀', giant_cairn: '🗿',
};

function costStr(cost) {
  return Object.entries(cost || {}).map(([k, v]) => `${RESOURCE_INFO[k].icon}${v}`).join(' ');
}

export class UI {
  constructor(game, onRestart) {
    this.game = game;
    this.onRestart = onRestart;
    this.controls = null; // set by main after construction
    this.buildMenuOpen = false;
    this.refreshT = 0;
    this.pings = [];

    this.elRes = document.getElementById('resources');
    this.elPanel = document.getElementById('panel');
    this.elInfo = document.getElementById('selinfo');
    this.elCmds = document.getElementById('commands');
    this.elToasts = document.getElementById('toasts');
    this.elClock = document.getElementById('clock');
    this.minimap = document.getElementById('minimap');
    this.mmCtx = this.minimap.getContext('2d');
    this.overlay = document.getElementById('overlay');
    this.ovCtx = this.overlay.getContext('2d');

    this.bakeMinimapTerrain();
    this.bindMinimap();

    game.on('selection', () => this.refreshPanel());
    game.on('toast', (msg) => this.toast(msg));
    game.on('ping', (x, z) => this.pings.push({ x, z, t: 6 }));
    game.on('gameover', (winner) => this.showGameOver(winner));
    game.on('ground-click', (x, z, kind) => this.groundMarker(x, z, kind));
    game.on('dialogue', (portrait, name, line) => this.showDialogue(portrait, name, line));
    const dlg = document.getElementById('dialogue');
    if (dlg) dlg.onclick = () => this.hideDialogue();

    document.getElementById('btn-menu').onclick = () => onRestart();
    const bp = document.getElementById('btn-pause');
    if (bp) bp.onclick = () => this.onPause?.();
    // pause-menu buttons
    const pm = document.getElementById('pausemenu');
    if (pm) {
      pm.querySelector('#pm-resume').onclick = () => this.onResume?.();
      pm.querySelector('#pm-save').onclick = () => this.onSave?.();
      pm.querySelector('#pm-load').onclick = () => this.onLoad?.();
      pm.querySelector('#pm-quit').onclick = () => onRestart();
    }
    this.refreshPanel();
  }

  setPaused(on, saveExists) {
    const pm = document.getElementById('pausemenu');
    if (pm) {
      pm.style.display = on ? 'flex' : 'none';
      const load = pm.querySelector('#pm-load');
      if (load) load.style.display = saveExists ? 'inline-block' : 'none';
    }
    const bp = document.getElementById('btn-pause');
    if (bp) bp.textContent = on ? 'Resume' : 'Pause';
  }

  // ---------- minimap ----------
  bakeMinimapTerrain() {
    const c = document.createElement('canvas');
    c.width = GRID; c.height = GRID;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(GRID, GRID);
    const map = this.game.map;
    for (let i = 0; i < GRID * GRID; i++) {
      const h = map.height[i];
      let r = 46, g = 46, b = 54;
      if (h > 3.2) { r = 24; g = 24; b = 30; }
      else { const t = h / 3.2; r = 40 + t * 26; g = 38 + t * 24; b = 44 + t * 18; }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mmTerrain = c;
  }

  bindMinimap() {
    const mm = this.minimap;
    const toWorld = (e) => {
      const r = mm.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / r.width * WORLD,
        z: (e.clientY - r.top) / r.height * WORLD,
      };
    };
    let panning = false;
    mm.addEventListener('contextmenu', e => e.preventDefault());
    mm.addEventListener('mousedown', e => {
      const w = toWorld(e);
      if (e.button === 0) { panning = true; this.controls.moveCameraTo(w.x, w.z); }
      else if (e.button === 2) {
        const sel = this.game.selection.filter(s => s.isUnit && s.owner === 0);
        if (sel.length) { this.game.formationMove(sel, w.x, w.z, false); Sound.command(); }
      }
    });
    window.addEventListener('mousemove', e => {
      if (panning) {
        const r = mm.getBoundingClientRect();
        if (e.clientX >= r.left - 30 && e.clientX <= r.right + 30 && e.clientY >= r.top - 30 && e.clientY <= r.bottom + 30) {
          const w = toWorld(e); this.controls.moveCameraTo(w.x, w.z);
        }
      }
    });
    window.addEventListener('mouseup', () => { panning = false; });
  }

  drawMinimap() {
    const ctx = this.mmCtx, S = this.minimap.width;
    const k = S / WORLD;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mmTerrain, 0, 0, S, S);
    // fog multiply
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this.game.map.fogCanvas, 0, 0, S, S);
    ctx.globalCompositeOperation = 'source-over';
    // resources
    for (const n of this.game.resources) {
      if (this.game.map.fogStateAt(n.pos.x, n.pos.z) === 0) continue;
      ctx.fillStyle = RESOURCE_INFO[n.type].color;
      ctx.fillRect(n.pos.x * k - 1, n.pos.z * k - 1, 2.5, 2.5);
    }
    // entities
    for (const b of this.game.buildings) {
      if (b.owner !== 0 && !(b.discovered && this.game.map.fogStateAt(b.pos.x, b.pos.z) >= 1)) continue;
      ctx.fillStyle = b.owner === 0 ? this.game.players[0].faction.colorCss : '#e03c2c';
      const s = b.size * TILE * k;
      ctx.fillRect(b.pos.x * k - s / 2, b.pos.z * k - s / 2, s, s);
    }
    for (const u of this.game.units) {
      if (u.owner !== 0 && this.game.map.fogStateAt(u.pos.x, u.pos.z) !== 2) continue;
      ctx.fillStyle = u.owner === 0 ? '#9be86e' : u.owner === 1 ? '#ff5040' : '#c9bd92';
      ctx.fillRect(u.pos.x * k - 1, u.pos.z * k - 1, 2, 2);
    }
    // pings
    for (const p of this.pings) {
      p.t -= 0.25;
      ctx.strokeStyle = `rgba(255,60,40,${Math.max(0, p.t / 6)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * k, p.z * k, 4 + (6 - p.t) * 2 % 8, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.pings = this.pings.filter(p => p.t > 0);
    // camera box
    const f = this.controls.focus, yaw = this.controls.yaw;
    ctx.save();
    ctx.translate(f.x * k, f.z * k);
    ctx.rotate(-yaw);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    const vw = this.controls.dist * 0.9 * k, vh = this.controls.dist * 0.6 * k;
    ctx.strokeRect(-vw / 2, -vh / 2, vw, vh);
    ctx.restore();
  }

  // ---------- ground click marker ----------
  groundMarker(x, z, kind) {
    const color = kind === 'attack' ? 0xff4433 : 0x66ff88;
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.55, 16),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.game.map.heightAt(x, z) + 0.1, z);
    this.game.scene.add(mesh);
    this.game.effects.push({ mesh, life: 0.5, max: 0.5, type: 'ring' });
  }

  // ---------- top bar ----------
  drawResources() {
    const p = this.game.players[0];
    const r = p.resources;
    let html = '';
    for (const k of ['grain', 'timber', 'bronze', 'favor', 'knowledge']) {
      html += `<span class="res" title="${RESOURCE_INFO[k].name}"><b style="color:${RESOURCE_INFO[k].color}">${RESOURCE_INFO[k].icon}</b> ${Math.floor(r[k] || 0)}</span>`;
    }
    html += `<span class="res" title="Population"><b style="color:#9ad">⌂</b> ${p.supplyUsed}/${p.supplyCap}</span>`;
    this.elRes.innerHTML = html;
    const t = Math.floor(this.game.time);
    this.elClock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }

  // ---------- selection / command panel ----------
  refreshPanel() {
    const sel = this.game.selection;
    const cmds = [];
    let info = '';
    if (!sel.length) {
      info = `<div class="sel-name">${this.game.players[0].faction.name}</div><div class="sel-desc">Select units with left-click / drag. Right-click to command.</div>`;
      this.buildMenuOpen = false;
    } else if (sel.length === 1) {
      const e = sel[0];
      const hp = `${Math.ceil(e.hp)}/${e.maxHp}`;
      info = `<div class="sel-name">${e.def.name || e.def.name}</div>`;
      if (e.isResource) {
        info += `<div class="sel-hp">${Math.floor(e.amount)} remaining</div>`;
      } else {
        info += `<div class="sel-hp">HP ${hp}</div>`;
      }
      info += `<div class="sel-desc">${e.def.desc || ''}</div>`;
      if (e.isBuilding && !e.complete) info += `<div class="sel-hp">Construction ${Math.floor(e.progress * 100)}%</div>`;
      if (e.isBuilding && e.trainQueue.length) {
        const j = e.trainQueue[0];
        const nm = j.upgrade ? UPGRADES[j.key].name : this.game.players[e.owner].faction.units[j.key].name;
        info += `<div class="queue">▶ ${nm} <progress value="${j.t}" max="${j.total}"></progress> (+${e.trainQueue.length - 1} queued)</div>`;
      }
    } else {
      const counts = {};
      for (const e of sel) counts[e.def.name] = (counts[e.def.name] || 0) + 1;
      info = `<div class="sel-name">${sel.length} selected</div><div class="sel-desc">` +
        Object.entries(counts).map(([n, c]) => `${c}× ${n}`).join(', ') + '</div>';
    }
    this.elInfo.innerHTML = info;

    // commands
    const own = sel.filter(s => s.owner === 0);
    const units = own.filter(s => s.isUnit);
    const workers = units.filter(u => u.def.worker);
    const building = own.length === 1 && own[0].isBuilding ? own[0] : null;
    const faction = this.game.players[0].faction;

    if (units.length) {
      cmds.push({ icon: '⚔', label: 'Attack-Move (F)', cls: 'cmd-act', fn: () => { this.controls.attackMoveArm = true; } });
      cmds.push({ icon: '✋', label: 'Stop (X)', cls: 'cmd-act', fn: () => units.forEach(u => u.stop()) });
      // combat stance — shared value highlighted when the whole selection agrees
      const fighters = units.filter(u => u.def.attack && !u.def.worker);
      if (fighters.length) {
        const allSame = (s) => fighters.every(u => u.stance === s);
        const STANCES = [['aggressive', '⚔', 'Aggressive'], ['defensive', '🛡', 'Defensive'], ['hold', '⚓', 'Hold (Y)']];
        for (const [s, icon, label] of STANCES) {
          cmds.push({
            icon, label, cls: 'cmd-act' + (allSame(s) ? ' cmd-on' : ''),
            tip: `${label} stance — ${s === 'aggressive' ? 'hunt freely within sight'
              : s === 'defensive' ? 'engage nearby but return to position' : 'stand ground; strike only what comes in range'}`,
            fn: () => { fighters.forEach(u => u.setStance(s)); Sound.click(); this.refreshPanel(); },
          });
        }
      }
    }
    if (workers.length && !this.buildMenuOpen) {
      cmds.push({ icon: '🏗', label: 'Build… (B)', cls: 'cmd-act', fn: () => { this.buildMenuOpen = true; this.refreshPanel(); } });
    }
    if (workers.length && this.buildMenuOpen) {
      for (const [key, def] of Object.entries(faction.buildings)) {
        if (def.main) continue;
        const avail = this.game.buildingAvailable(0, key);
        const afford = this.game.canAfford(0, def.cost);
        cmds.push({
          icon: BLD_ICONS[key] || '🏛', label: `${def.name}`, sub: costStr(def.cost),
          disabled: !avail || !afford,
          tip: `${def.name} — ${costStr(def.cost)}${def.requires ? ` (requires ${faction.buildings[def.requires].name})` : ''}\n${def.desc}`,
          fn: () => { this.controls.startPlacement(key); },
        });
      }
      cmds.push({ icon: '↩', label: 'Back (Esc)', cls: 'cmd-act', fn: () => { this.buildMenuOpen = false; this.refreshPanel(); } });
    }
    if (building && building.complete) {
      for (const key of building.def.trains) {
        const def = faction.units[key];
        const avail = this.game.unitAvailable(0, key);
        cmds.push({
          icon: UNIT_ICONS[key] || '⚔', label: def.name, sub: costStr(def.cost),
          disabled: !avail,
          tip: `${def.name} — ${costStr(def.cost)} ⌂${def.supply}${def.requires ? ` (requires ${faction.buildings[def.requires].name})` : ''}\n${def.desc}`,
          fn: () => { if (!this.game.queueTrain(building, key)) Sound.error(); else Sound.click(); this.refreshPanel(); },
        });
      }
      for (const upKey of building.def.upgrades || []) {
        const up = UPGRADES[upKey];
        if (this.game.players[0].upgrades.has(upKey)) continue;
        cmds.push({
          icon: '⬆', label: up.name, sub: costStr(up.cost),
          tip: `${up.name} — ${costStr(up.cost)}\n${up.desc}`,
          fn: () => { if (!this.game.queueUpgrade(building, upKey)) Sound.error(); else Sound.click(); this.refreshPanel(); },
        });
      }
    }

    this.elCmds.innerHTML = '';
    for (const c of cmds) {
      const btn = document.createElement('button');
      btn.className = 'cmd' + (c.cls ? ' ' + c.cls : '') + (c.disabled ? ' disabled' : '');
      btn.title = c.tip || c.label;
      btn.innerHTML = `<span class="cmd-icon">${c.icon}</span><span class="cmd-label">${c.label}</span>` +
        (c.sub ? `<span class="cmd-sub">${c.sub}</span>` : '');
      btn.onclick = () => { if (!c.disabled) c.fn(); };
      this.elCmds.appendChild(btn);
    }
  }

  // ---------- health bars ----------
  drawHealthBars() {
    const ctx = this.ovCtx;
    const r = this.overlay;
    if (r.width !== window.innerWidth) { r.width = window.innerWidth; r.height = window.innerHeight; }
    ctx.clearRect(0, 0, r.width, r.height);
    const cam = this.game.camera;
    const v = new THREE.Vector3();
    const draw = (e, yOff) => {
      if (!e.mesh.visible) return;
      const selected = this.game.selection.includes(e);
      const hurt = e.hp < e.maxHp;
      const constructing = e.isBuilding && !e.complete;
      if (!selected && !hurt && !constructing) return;
      v.set(e.pos.x, this.game.map.heightAt(e.pos.x, e.pos.z) + yOff, e.pos.z);
      v.project(cam);
      if (v.z > 1) return;
      const sx = (v.x + 1) / 2 * r.width, sy = (-v.y + 1) / 2 * r.height;
      const w = e.isBuilding ? 46 : 26, h = 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(sx - w / 2 - 1, sy - 1, w + 2, h + 2);
      const frac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = e.owner === 0 ? (frac > 0.5 ? '#7ee06a' : frac > 0.25 ? '#e0c14a' : '#e05540')
        : e.owner === 1 ? '#e05540' : '#c9bd92';
      ctx.fillRect(sx - w / 2, sy, w * frac, h);
      if (constructing) {
        ctx.fillStyle = 'rgba(120,180,255,0.9)';
        ctx.fillRect(sx - w / 2, sy + h + 1, w * Math.min(1, e.progress), 2);
      }
    };
    for (const u of this.game.units) draw(u, 2.2);
    for (const b of this.game.buildings) draw(b, b.size * 1.6 + 2);
  }

  // ---------- first-contact dialogue (queued so several play in sequence) ----------
  showDialogue(portrait, name, line) {
    (this._dlgQueue ||= []).push({ portrait, name, line });
    if (!this._dlgActive) this._nextDialogue();
  }
  _nextDialogue() {
    const dlg = document.getElementById('dialogue');
    const d = (this._dlgQueue || []).shift();
    if (!dlg || !d) { this._dlgActive = false; dlg?.classList.remove('show'); return; }
    this._dlgActive = true;
    document.getElementById('dlg-portrait').src = d.portrait;
    document.getElementById('dlg-name').textContent = d.name;
    document.getElementById('dlg-line').textContent = d.line;
    dlg.classList.add('show');
    Sound.alert();
    clearTimeout(this._dlgT);
    this._dlgT = setTimeout(() => this._nextDialogue(), 8000);
  }
  hideDialogue() {
    clearTimeout(this._dlgT);
    if (this._dlgQueue && this._dlgQueue.length) return this._nextDialogue();
    this._dlgActive = false;
    document.getElementById('dialogue')?.classList.remove('show');
  }

  // ---------- toasts / game over ----------
  toast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    this.elToasts.appendChild(el);
    setTimeout(() => el.classList.add('fade'), 2600);
    setTimeout(() => el.remove(), 3300);
  }

  showGameOver(winner) {
    this.hideIntroCard();
    // let the end-game camera breathe before the verdict screen lands
    setTimeout(() => {
      const div = document.getElementById('gameover');
      div.style.display = 'flex';
      div.querySelector('h1').textContent = winner === 0 ? 'VICTORY' : 'DEFEAT';
      div.querySelector('h1').style.color = winner === 0 ? '#ffd56e' : '#e05540';
      div.querySelector('p').textContent = winner === 0
        ? 'The enemy\'s seat of power lies in ruin. The age endures — for now.'
        : 'Your hall has fallen. The waters will remember your name.';
      document.getElementById('btn-restart').onclick = () => this.onRestart();
    }, 2200);
  }

  // opening faction card over the flyover
  showIntroCard(faction) {
    const taglines = {
      covenant: 'Bronze and grain and the favor of heaven hold the walls of the faithful.',
      watchers: 'They taught us the names of the stars, and the price was our souls.',
      nephilim: 'The giants do not build walls. They break them.',
    };
    const el = document.getElementById('introcard');
    document.getElementById('ic-name').textContent = faction.name;
    document.getElementById('ic-name').style.color = faction.colorCss;
    document.getElementById('ic-sub').textContent = taglines[faction.key] || faction.desc;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('show'));
  }
  hideIntroCard() {
    const el = document.getElementById('introcard');
    if (!el || el.style.display === 'none') return;
    el.classList.remove('show');
    setTimeout(() => { el.style.display = 'none'; }, 1100);
  }

  // ---------- per-frame ----------
  update(dt) {
    this.refreshT -= dt;
    if (this.refreshT <= 0) {
      this.refreshT = 0.25;
      this.drawResources();
      this.drawMinimap();
      // live-refresh queue/progress text when a building is selected
      const s = this.game.selection;
      if (s.length === 1 && s[0].isBuilding) this.refreshPanel();
    }
    this.drawHealthBars();
  }
}
