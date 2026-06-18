// Camera rig + mouse/keyboard input: selection, drag-box, right-click orders,
// attack-move, control groups, building placement ghost.
import * as THREE from 'three';
import { WORLD, TILE } from './terrain.js';
import { buildBuildingMesh } from './models.js';
import { Sound } from './audio.js';

export class Controls {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.dom = game.renderer.domElement;

    // camera rig (focus/dist/yaw ease toward their targets each frame)
    this.focus = new THREE.Vector3(game.playerMain.pos.x, 0, game.playerMain.pos.z + 6);
    this.focusT = this.focus.clone();
    this.yaw = Math.PI * 0.25;   // look NE toward map center
    this.yawT = this.yaw;
    this.dist = 42;
    this.distT = 42;
    this.keys = {};
    // inside=false until the first real mousemove, so edge-scroll can't trigger
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, inside: false };
    this.raycaster = new THREE.Raycaster();
    this.attackMoveArm = false;
    this.placement = null; // { key, ghost, valid }
    this.groups = {};
    this.dragStart = null;
    this.boxEl = document.getElementById('selbox');

    this.selRings = [];

    // opening flyover: start high, far and rotated, then settle onto the city.
    const m = game.playerMain;
    this.focus.set(m.pos.x, 0, m.pos.z + 6);
    this.focusT.copy(this.focus);
    this.dist = 96; this.distT = 42;
    this.yaw = Math.PI * 0.25 + 0.85; this.yawT = Math.PI * 0.25;
    this.intro = 3.6;          // seconds of scripted intro (skippable)

    this.bind();
    this.updateCamera(0);
  }

  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', e => e.preventDefault());
    d.addEventListener('mousedown', e => this.onMouseDown(e));
    window.addEventListener('mousemove', e => this.onMouseMove(e));
    window.addEventListener('mouseup', e => this.onMouseUp(e));
    d.addEventListener('wheel', e => {
      this.distT = Math.max(16, Math.min(80, this.distT + e.deltaY * 0.035));
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    document.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    this.bindTouch(d);
  }

  // ---------- touch: drag-pan, pinch-zoom, two-finger rotate, tap select/command ----------
  bindTouch(d) {
    this.touch = null;  // { mode, sx, sy, lx, ly, t0, dist0, ang0, yaw0, distT0, moved }
    const pt = t => ({ x: t.clientX, y: t.clientY });
    const dist2 = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ang2  = (a, b) => Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX);

    d.addEventListener('touchstart', e => {
      e.preventDefault();
      if (this.intro > 0) { this.skipIntro(); }
      if (e.touches.length === 1) {
        const p = pt(e.touches[0]);
        this.touch = { mode: 'one', sx: p.x, sy: p.y, lx: p.x, ly: p.y, t0: performance.now(), moved: 0 };
      } else if (e.touches.length === 2) {
        this.touch = {
          mode: 'two', dist0: dist2(e.touches[0], e.touches[1]), ang0: ang2(e.touches[0], e.touches[1]),
          distT0: this.distT, yaw0: this.yawT,
        };
      }
    }, { passive: false });

    d.addEventListener('touchmove', e => {
      e.preventDefault();
      const tc = this.touch; if (!tc) return;
      if (tc.mode === 'one' && e.touches.length === 1) {
        const p = pt(e.touches[0]);
        // placing a building: the finger drags the ghost instead of panning, so the
        // player can see exactly where it will land before lifting to drop it.
        if (this.placement) {
          tc.moved += Math.abs(p.x - tc.lx) + Math.abs(p.y - tc.ly);
          tc.lx = p.x; tc.ly = p.y;
          this.mouse.x = p.x; this.mouse.y = p.y;
          this.updateGhost();
          return;
        }
        const dx = p.x - tc.lx, dy = p.y - tc.ly;
        tc.moved += Math.abs(dx) + Math.abs(dy);
        tc.lx = p.x; tc.ly = p.y;
        // drag-to-pan: content follows the finger. Ground basis at this yaw is
        // worldRight=(cos,-sin), worldFwd=(-sin,-cos); finger-right shifts focus
        // left, finger-down shifts focus forward (into the screen).
        const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw), k = this.dist * 0.0022;
        this.focusT.x += (-dx * cos - dy * sin) * k;
        this.focusT.z += (dx * sin - dy * cos) * k;
        this.focusT.x = Math.max(4, Math.min(WORLD - 4, this.focusT.x));
        this.focusT.z = Math.max(4, Math.min(WORLD - 4, this.focusT.z));
      } else if (tc.mode === 'two' && e.touches.length === 2) {
        const dn = dist2(e.touches[0], e.touches[1]);
        const an = ang2(e.touches[0], e.touches[1]);
        if (tc.dist0 > 0) this.distT = Math.max(16, Math.min(80, tc.distT0 * (tc.dist0 / dn)));
        this.yawT = tc.yaw0 + (an - tc.ang0);
      }
    }, { passive: false });

    d.addEventListener('touchend', e => {
      e.preventDefault();
      const tc = this.touch;
      // placing a building: lift to drop it at the ghost's spot (positioned by the
      // last touch). A tap with no drag also works — the ghost sits under the finger.
      if (this.placement && tc && tc.mode === 'one') {
        this.mouse.x = tc.lx; this.mouse.y = tc.ly;
        this.updateGhost();
        this.tryPlaceTouch();
        this.touch = e.touches.length ? this.touch : null;
        return;
      }
      // a quick, near-stationary single touch is a tap → select or command
      if (tc && tc.mode === 'one' && tc.moved < 14 && performance.now() - tc.t0 < 350) {
        this.handleTap(tc.sx, tc.sy);
      }
      // if one finger remains (e.g. lifted from a pinch), keep panning with it but
      // mark it moved so it can't register as a tap; otherwise clear the gesture.
      if (e.touches.length === 1) {
        const p = pt(e.touches[0]);
        this.touch = { mode: 'one', sx: p.x, sy: p.y, lx: p.x, ly: p.y, t0: performance.now(), moved: 99 };
      } else {
        this.touch = null;
      }
    }, { passive: false });
  }

  // Tap: own unit/building → select; with a selection, tapping elsewhere issues a
  // command (move/gather/attack); tapping empty ground with nothing picked clears.
  handleTap(cx, cy) {
    const ent = this.pickEntity(cx, cy);
    const mine = this.selectedUnits();
    const lp = this.game.localPlayer;
    // tapping your own UNFINISHED building with workers selected should (re)assign
    // them to build it — fall through to the command path instead of just reselecting
    // (so a worker pulled off mid-build can be put back on touch, matching right-click)
    const assignBuild = ent && ent.isBuilding && ent.owner === lp && !ent.complete && mine.length > 0;
    if (ent && ent.owner === lp && !ent.isResource && !assignBuild) {
      this.game.selection = [ent]; Sound.select(); this.game.emit('selection'); return;
    }
    if (mine.length) {
      const p = this.screenToWorld(cx, cy);
      if (p) {
        this.game.cmd('right', { sel: this.ownSelection(), x: p.x, z: p.z, ent, q: false });
        if (!ent) this.game.emit('ground-click', p.x, p.z, 'move');
        Sound.command();
      }
      return;
    }
    if (ent) { this.game.selection = [ent]; Sound.select(); }
    else this.game.selection = [];
    this.game.emit('selection');
  }

  skipIntro() { if (this.intro > 0) { this.intro = 0; this.ui?.hideIntroCard?.(); } }

  onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (e.target.tagName === 'INPUT') return;   // typing in chat/lobby — don't drive the camera or hotkeys
    this.keys[k] = true;
    this.skipIntro();
    // WASD pan the camera, so unit commands live on F (attack-move) and X (stop)
    if (k === 'f' && !this.placement) { if (this.selectedUnits().length) { this.attackMoveArm = true; this.patrolArm = false; } }
    if (k === 'r' && !this.placement) { if (this.selectedUnits().length) { this.patrolArm = true; this.attackMoveArm = false; } }
    if (k === 'x') { if (this.selectedUnits().length) this.game.cmd('stop', { sel: this.selectedUnits() }); this.attackMoveArm = false; this.patrolArm = false; }
    if (k === 'g') { this.game.cmd('empower', { o: 0 }); this.ui.refreshPanel?.(); }
    if (k === ' ') { const a = this.game.lastAlertPos; if (a) { this.focusT.x = a.x; this.focusT.z = a.z; } e.preventDefault(); }
    if (k === 'y') {   // cycle combat stance for the selected fighters
      const order = ['aggressive', 'defensive', 'hold'];
      const fighters = this.selectedUnits().filter(u => u.def.attack && !u.def.worker);
      if (fighters.length) {
        const next = order[(order.indexOf(fighters[0].stance) + 1) % order.length];
        this.game.cmd('stance', { sel: fighters, s: next });
        this.ui.toast?.(`Stance: ${next[0].toUpperCase() + next.slice(1)}`);
        this.ui.refreshPanel?.();
      }
    }
    if (k === 'q') { for (const u of this.selectedUnits()) if (u.def.ability) this.game.cmd('ability', { u }); }
    if (k === 'p') { this.onPause?.(); }
    // secret code: type "greene" to summon the Fields of Evil near your city
    this._code = ((this._code || '') + k).slice(-6);
    if (this._code === 'greene') {
      this._code = '';
      const bp = this.game.map.basePlayer;
      if (this.game.spawnFieldsOfEvil(bp.x + 12, bp.y - 12))
        this.ui.toast('The Fields of Evil rise nearby. The House of Greene awaits.');
    }
    if (k === 'escape') { this.cancelPlacement(); this.attackMoveArm = false; this.patrolArm = false; this.ui.buildMenuOpen = false; this.ui.refreshPanel(); }
    if (k === 'h') { const m = this.game.playerMain; if (m) { this.focusT.x = m.pos.x; this.focusT.z = m.pos.z; } }
    if (k === '.') { this.ui.selectIdleWorker?.(); }
    if (k === 'b' && this.selectedUnits().some(u => u.def.worker)) { this.ui.buildMenuOpen = true; this.ui.refreshPanel(); }
    if (k >= '1' && k <= '9') {
      if (e.ctrlKey || e.metaKey) {
        this.groups[k] = [...this.selectedUnits()];
        e.preventDefault();
      } else if (this.groups[k]?.length) {
        const live = this.groups[k].filter(u => !u.dead);
        this.game.selection = live;
        this.game.emit('selection');
        // double-tap the same group key to snap the camera to it (classic RTS)
        const now = performance.now();
        if (this._lastGroupKey === k && now - (this._lastGroupT || 0) < 320 && live.length) {
          let cx = 0, cz = 0; for (const u of live) { cx += u.pos.x; cz += u.pos.z; }
          this.focusT.x = cx / live.length; this.focusT.z = cz / live.length;
        }
        this._lastGroupKey = k; this._lastGroupT = now;
      }
    }
  }

  selectedUnits() { return this.game.selection.filter(s => s.isUnit && s.owner === this.game.localPlayer); }
  // the local seat's own entities in the current selection (units + buildings),
  // used to issue commands that only the local player may give
  ownSelection() { return this.game.selection.filter(s => s.owner === this.game.localPlayer); }

  screenToWorld(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const hits = this.raycaster.intersectObject(this.game.map.mesh);
    return hits.length ? hits[0].point : null;
  }

  pickEntity(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.game.camera);
    const meshes = [];
    for (const u of this.game.units) if (u.mesh.visible) meshes.push(u.mesh);
    for (const b of this.game.buildings) if (b.mesh.visible) meshes.push(b.mesh);
    for (const n of this.game.resources) if (n.mesh.visible) meshes.push(n.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.entity) o = o.parent;
      if (o) return o.userData.entity;
    }
    return null;
  }

  onMouseDown(e) {
    if (e.target !== this.dom) return;
    if (this.intro > 0) { this.skipIntro(); return; }
    if (e.button === 0) {
      if (this.placement) { this.tryPlace(e); return; }
      if (this.attackMoveArm) {
        const p = this.screenToWorld(e.clientX, e.clientY);
        if (p) {
          this.game.cmd('formation', { sel: this.selectedUnits(), x: p.x, z: p.z, am: true, q: e.shiftKey });
          this.game.emit('ground-click', p.x, p.z, 'attack');
          Sound.command();
        }
        this.attackMoveArm = false;
        return;
      }
      if (this.patrolArm) {
        const p = this.screenToWorld(e.clientX, e.clientY);
        if (p) {
          this.game.cmd('patrol', { sel: this.selectedUnits(), x: p.x, z: p.z, q: e.shiftKey });
          this.game.emit('ground-click', p.x, p.z, 'attack');
        }
        this.patrolArm = false;
        return;
      }
      this.dragStart = { x: e.clientX, y: e.clientY };
    } else if (e.button === 1) {
      this.rotating = { x: e.clientX, yaw: this.yaw };
      e.preventDefault();
    } else if (e.button === 2) {
      if (this.placement) { this.cancelPlacement(); return; }
      if (this.attackMoveArm || this.patrolArm) { this.attackMoveArm = false; this.patrolArm = false; return; }
      const ent = this.pickEntity(e.clientX, e.clientY);
      const p = this.screenToWorld(e.clientX, e.clientY);
      if (p) {
        this.game.cmd('right', { sel: this.ownSelection(), x: p.x, z: p.z, ent, q: e.shiftKey });
        if (!ent) this.game.emit('ground-click', p.x, p.z, e.shiftKey ? 'queue' : 'move');
      }
    }
  }

  onMouseMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (this.rotating) {
      this.yawT = this.rotating.yaw + (e.clientX - this.rotating.x) * 0.008;
    }
    if (this.dragStart) {
      const dx = Math.abs(e.clientX - this.dragStart.x), dy = Math.abs(e.clientY - this.dragStart.y);
      if (dx > 4 || dy > 4) {
        this.boxEl.style.display = 'block';
        this.boxEl.style.left = Math.min(e.clientX, this.dragStart.x) + 'px';
        this.boxEl.style.top = Math.min(e.clientY, this.dragStart.y) + 'px';
        this.boxEl.style.width = dx + 'px';
        this.boxEl.style.height = dy + 'px';
      }
    }
    if (this.placement) this.updateGhost();
  }

  onMouseUp(e) {
    if (e.button === 1) this.rotating = null;
    if (e.button !== 0 || !this.dragStart) return;
    const start = this.dragStart; this.dragStart = null;
    this.boxEl.style.display = 'none';
    const dx = Math.abs(e.clientX - start.x), dy = Math.abs(e.clientY - start.y);
    const shift = e.shiftKey;
    if (dx > 5 || dy > 5) {
      // box select own units
      const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX);
      const y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY);
      const r = this.dom.getBoundingClientRect();
      const sel = [];
      const v = new THREE.Vector3();
      for (const u of this.game.units) {
        if (u.owner !== this.game.localPlayer) continue;
        v.copy(u.pos); v.y = this.game.map.heightAt(u.pos.x, u.pos.z) + 0.5;
        v.project(this.game.camera);
        const sx = r.left + (v.x + 1) / 2 * r.width, sy = r.top + (-v.y + 1) / 2 * r.height;
        if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) sel.push(u);
      }
      if (sel.length) {
        const military = sel.filter(u => !u.def.worker);
        const finalSel = military.length && sel.some(u => u.def.worker) && military.length >= 2 ? military : sel;
        this.game.selection = shift ? [...new Set([...this.game.selection, ...finalSel])] : finalSel;
        Sound.select();
      } else if (!shift) this.game.selection = [];
      this.game.emit('selection');
    } else {
      // single click select
      const ent = this.pickEntity(e.clientX, e.clientY);
      if (ent && !ent.isResource) {
        if (shift && ent.owner === this.game.localPlayer) {
          if (this.game.selection.includes(ent)) this.game.selection = this.game.selection.filter(s => s !== ent);
          else this.game.selection = [...this.game.selection, ent];
        } else this.game.selection = [ent];
        Sound.select();
      } else if (ent && ent.isResource) {
        this.game.selection = [ent];
      } else if (!shift) {
        this.game.selection = [];
      }
      this.game.emit('selection');
    }
  }

  // ---------- building placement ----------
  startPlacement(key) {
    this.cancelPlacement();
    const me = this.game.players[this.game.localPlayer];
    const def = me.faction.buildings[key];
    const f = me.faction;
    const ghost = buildBuildingMesh(def.model, f.color, f.glow);
    ghost.traverse(o => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; }
    });
    this.game.scene.add(ghost);
    // tinted footprint pad: shows exactly which tiles the building will occupy
    const fp = new THREE.Mesh(
      new THREE.PlaneGeometry(def.size * TILE, def.size * TILE),
      new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    fp.rotation.x = -Math.PI / 2;
    this.game.scene.add(fp);
    this.placement = { key, def, ghost, footprint: fp, valid: false, tx: 0, ty: 0 };
    this.updateGhost();
  }

  cancelPlacement() {
    if (this.placement) {
      this.game.scene.remove(this.placement.ghost);
      if (this.placement.footprint) this.game.scene.remove(this.placement.footprint);
      this.placement = null;
    }
  }

  updateGhost() {
    const p = this.placement;
    if (!p) return;
    const w = this.screenToWorld(this.mouse.x, this.mouse.y);
    if (!w) { p.ghost.visible = false; p.valid = false; return; }
    p.ghost.visible = true;
    const tx = Math.round(w.x / TILE - p.def.size / 2);
    const ty = Math.round(w.z / TILE - p.def.size / 2);
    p.tx = tx; p.ty = ty;
    const cx = (tx + p.def.size / 2) * TILE, cz = (ty + p.def.size / 2) * TILE;
    p.ghost.position.set(cx, this.game.map.heightAt(cx, cz), cz);
    const lp = this.game.localPlayer;
    p.valid = this.game.canPlace(lp, p.key, tx, ty, true) && this.game.canAfford(lp, p.def.cost);
    p.ghost.traverse(o => { if (o.isMesh) o.material.opacity = p.valid ? 0.65 : 0.2; });
    if (p.footprint) {
      p.footprint.visible = true;
      p.footprint.position.set(cx, this.game.map.heightAt(cx, cz) + 0.08, cz);
      p.footprint.material.color.set(p.valid ? 0x66ff88 : 0xff5544);
      p.footprint.material.opacity = p.valid ? 0.22 : 0.18;
    }
  }

  tryPlace(e) {
    const p = this.placement;
    if (!p || !p.valid) { Sound.error(); return; }
    const workers = this.selectedUnits().filter(u => u.def.worker);
    const b = this.game.cmd('build', { o: this.game.localPlayer, key: p.key, tx: p.tx, ty: p.ty, w: workers });
    if (b) {
      if (!e.shiftKey) this.cancelPlacement();
      this.ui.refreshPanel();
    } else Sound.error();
  }

  // Touch placement: drop the building at the ghost's spot (no shift-to-chain). In a
  // net match game.cmd defers (returns null) but the command is submitted, so cancel
  // optimistically once the spot is valid.
  tryPlaceTouch() {
    const p = this.placement;
    if (!p || !p.valid) { Sound.error(); return; }
    const workers = this.selectedUnits().filter(u => u.def.worker);
    this.game.cmd('build', { o: this.game.localPlayer, key: p.key, tx: p.tx, ty: p.ty, w: workers });
    this.cancelPlacement();
    this.ui.refreshPanel();
  }

  // ---------- per-frame ----------
  moveCameraTo(wx, wz) {
    this.focusT.x = Math.max(0, Math.min(WORLD, wx));
    this.focusT.z = Math.max(0, Math.min(WORLD, wz));
  }

  updateCamera(dt) {
    // ---- end-game cinematic: slow orbit over the decisive ruin ----
    if (this.game.over && this.game.endFocus) {
      if (this.intro > 0) { this.intro = 0; this.ui?.hideIntroCard?.(); }
      this.focusT.set(this.game.endFocus.x, 0, this.game.endFocus.z);
      this.distT = 30;
      this.yawT += dt * 0.18;            // slow drift around the scene
    }
    // ---- opening flyover: scripted, input-locked, skippable ----
    const inputLocked = this.intro > 0;
    if (inputLocked) {
      this.intro -= dt;
      this.yawT -= dt * 0.12;            // gentle sweep as we descend
      if (this.intro <= 0) this.ui?.hideIntroCard?.();
    }

    const speed = (30 + this.dist * 0.6) * dt;
    // strafe = screen-right (+) / left (-) ; fwd = screen-forward/up (+) / back/down (-)
    let strafe = 0, fwd = 0;
    if (!inputLocked && !this.game.over) {
      // WASD (and arrow keys) pan the camera across the ground
      if (this.keys['w'] || this.keys['arrowup']) fwd += 1;
      if (this.keys['s'] || this.keys['arrowdown']) fwd -= 1;
      if (this.keys['a'] || this.keys['arrowleft']) strafe -= 1;
      if (this.keys['d'] || this.keys['arrowright']) strafe += 1;
      // edge scroll
      if (this.mouse.inside && !this.dragStart) {
        const m = 14;
        if (this.mouse.x < m) strafe -= 1;
        if (this.mouse.x > window.innerWidth - m) strafe += 1;
        if (this.mouse.y < m) fwd += 1;
        if (this.mouse.y > window.innerHeight - m) fwd -= 1;
      }
      if (this.keys['q']) this.yawT += dt * 1.8;
      if (this.keys['e']) this.yawT -= dt * 1.8;
    }
    if (strafe || fwd) {
      // pan along the camera's true ground basis so directions match the screen at
      // any yaw: forward (into screen) = (-sin, -cos); right = (cos, -sin).
      const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
      this.focusT.x += (strafe * cos - fwd * sin) * speed;
      this.focusT.z += (-strafe * sin - fwd * cos) * speed;
      this.focusT.x = Math.max(4, Math.min(WORLD - 4, this.focusT.x));
      this.focusT.z = Math.max(4, Math.min(WORLD - 4, this.focusT.z));
    }
    // ease toward targets — gentler during the cinematic intro for a slow descent
    const k = inputLocked ? 2.2 : 9;
    const ease = 1 - Math.exp(-dt * k);
    this.focus.lerp(this.focusT, ease);
    this.dist += (this.distT - this.dist) * (1 - Math.exp(-dt * (inputLocked ? 1.8 : 7)));
    this.yaw += (this.yawT - this.yaw) * (1 - Math.exp(-dt * (inputLocked ? 2.0 : 10)));
    const cam = this.game.camera;
    const pitch = 0.9 + (this.dist - 16) / 64 * 0.25; // steeper when zoomed out
    const fy = this.game.map.heightAt(this.focus.x, this.focus.z);
    // impact shake (giant footfalls, collapses) — decays in game.update
    const sh = this.game.shake || 0;
    const sx = sh ? (Math.random() - 0.5) * sh * 2.2 : 0;
    const sz = sh ? (Math.random() - 0.5) * sh * 2.2 : 0;
    const sy = sh ? (Math.random() - 0.5) * sh * 1.6 : 0;
    const cx = this.focus.x + Math.sin(this.yaw) * Math.cos(pitch) * this.dist + sx;
    const cz = this.focus.z + Math.cos(this.yaw) * Math.cos(pitch) * this.dist + sz;
    const cy = fy + Math.sin(pitch) * this.dist + sy;
    cam.position.set(cx, cy, cz);
    cam.lookAt(this.focus.x + sx * 0.4, fy, this.focus.z + sz * 0.4);
    // sun follows camera focus so shadows stay crisp
    const sun = this.game.sun;
    sun.position.set(this.focus.x + 40, 70, this.focus.z + 25);
    sun.target.position.set(this.focus.x, 0, this.focus.z);
    // cool rim light from the opposite side, low angle, for hero pop
    const rim = this.game.rim;
    if (rim) {
      rim.position.set(this.focus.x - 50, 26, this.focus.z - 38);
      rim.target.position.set(this.focus.x, 0, this.focus.z);
    }

    // selection rings + hover highlight + rally marker (all render-only)
    this.syncSelectionRings();
    // hover pick is a raycast, so rate-limit it rather than run every frame
    this.hoverT = (this.hoverT || 0) - dt;
    if (this.hoverT <= 0) {
      this.hoverT = 0.05;
      this.hoverEnt = (this.mouse.inside && !this.dragStart && !this.placement)
        ? this.pickEntity(this.mouse.x, this.mouse.y) : null;
    }
    this.syncHoverRing();
    this.syncRallyMarker();
  }

  // a soft ring under whatever the cursor is over (skipped for already-selected)
  syncHoverRing() {
    if (!this.hoverRing) {
      this.hoverRing = new THREE.Mesh(
        new THREE.RingGeometry(0.86, 1.0, 28),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
      );
      this.hoverRing.rotation.x = -Math.PI / 2;
      this.game.scene.add(this.hoverRing);
    }
    const e = this.hoverEnt;
    const show = e && !e.dead && !this.game.selection.includes(e);
    this.hoverRing.visible = !!show;
    if (!show) return;
    const r = (e.radius + 0.45) * (1 + 0.03 * Math.sin(this.game.time * 7));
    this.hoverRing.scale.setScalar(r);
    this.hoverRing.position.set(e.pos.x, this.game.map.heightAt(e.pos.x, e.pos.z) + 0.07, e.pos.z);
    this.hoverRing.material.color.set(
      e.isResource ? 0xd8b75a : e.owner === this.game.localPlayer ? 0x9be86e : e.owner === 2 ? 0xcccc88 : 0xff7066);
    this.hoverRing.material.opacity = 0.42;
  }

  // a banner + beam at the rally point of the selected production building, so you
  // can see where trained units will gather
  syncRallyMarker() {
    if (!this.rallyMarker) {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd56e, transparent: true, opacity: 0.5, depthWrite: false }));
      beam.position.y = 1.1;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.7, 20),
        new THREE.MeshBasicMaterial({ color: 0xffd56e, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      g.add(beam); g.add(ring);
      this.rallyMarker = g; this.game.scene.add(g);
    }
    const sel = this.game.selection;
    const b = sel.length === 1 && sel[0].isBuilding && sel[0].owner === this.game.localPlayer
      && sel[0].rally ? sel[0] : null;
    this.rallyMarker.visible = !!b;
    if (!b) return;
    const { x, z } = b.rally;
    this.rallyMarker.position.set(x, this.game.map.heightAt(x, z), z);
    const t = 0.45 + 0.2 * Math.sin(this.game.time * 4);
    this.rallyMarker.children[0].material.opacity = t;
    this.rallyMarker.children[1].material.opacity = t + 0.15;
    this.rallyMarker.children[1].scale.setScalar(1 + 0.06 * Math.sin(this.game.time * 4));
  }

  syncSelectionRings() {
    const sel = this.game.selection;
    while (this.selRings.length < sel.length) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.0, 24),
        new THREE.MeshBasicMaterial({ color: 0x66ff88, transparent: true, opacity: 0.85, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      this.game.scene.add(ring);
      this.selRings.push(ring);
    }
    const pulse = 0.68 + 0.22 * Math.sin(this.game.time * 5);
    for (let i = 0; i < this.selRings.length; i++) {
      const ring = this.selRings[i];
      const e = sel[i];
      if (!e || e.dead) { ring.visible = false; continue; }
      ring.visible = true;
      const r = (e.radius + 0.3) * (1 + 0.04 * Math.sin(this.game.time * 5));
      ring.scale.setScalar(r);
      ring.position.set(e.pos.x, this.game.map.heightAt(e.pos.x, e.pos.z) + 0.08, e.pos.z);
      ring.material.color.set(e.owner === this.game.localPlayer ? 0x66ff88 : e.owner === 2 ? 0xcccc88 : 0xff5544);
      ring.material.opacity = pulse;
    }
  }
}
