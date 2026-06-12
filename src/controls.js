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

    // camera rig
    this.focus = new THREE.Vector3(game.playerMain.pos.x, 0, game.playerMain.pos.z + 6);
    this.yaw = Math.PI * 0.25;   // look NE toward map center
    this.dist = 42;
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
      this.dist = Math.max(16, Math.min(80, this.dist + e.deltaY * 0.03));
      e.preventDefault();
    }, { passive: false });
    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => { this.keys[e.key.toLowerCase()] = false; });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    document.addEventListener('mouseenter', () => { this.mouse.inside = true; });
  }

  onKeyDown(e) {
    const k = e.key.toLowerCase();
    this.keys[k] = true;
    if (e.target.tagName === 'INPUT') return;
    if (k === 'a' && !this.placement) { if (this.selectedUnits().length) this.attackMoveArm = true; }
    if (k === 's') { this.selectedUnits().forEach(u => u.stop()); this.attackMoveArm = false; }
    if (k === 'escape') { this.cancelPlacement(); this.attackMoveArm = false; this.ui.buildMenuOpen = false; this.ui.refreshPanel(); }
    if (k === 'h') { const m = this.game.playerMain; if (m) { this.focus.x = m.pos.x; this.focus.z = m.pos.z; } }
    if (k === 'b' && this.selectedUnits().some(u => u.def.worker)) { this.ui.buildMenuOpen = true; this.ui.refreshPanel(); }
    if (k >= '1' && k <= '9') {
      if (e.ctrlKey || e.metaKey) {
        this.groups[k] = [...this.selectedUnits()];
        e.preventDefault();
      } else if (this.groups[k]?.length) {
        this.game.selection = this.groups[k].filter(u => !u.dead);
        this.game.emit('selection');
      }
    }
  }

  selectedUnits() { return this.game.selection.filter(s => s.isUnit && s.owner === 0); }

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
    if (e.button === 0) {
      if (this.placement) { this.tryPlace(e); return; }
      if (this.attackMoveArm) {
        const p = this.screenToWorld(e.clientX, e.clientY);
        if (p) {
          this.game.formationMove(this.selectedUnits(), p.x, p.z, true);
          this.game.emit('ground-click', p.x, p.z, 'attack');
          Sound.command();
        }
        this.attackMoveArm = false;
        return;
      }
      this.dragStart = { x: e.clientX, y: e.clientY };
    } else if (e.button === 1) {
      this.rotating = { x: e.clientX, yaw: this.yaw };
      e.preventDefault();
    } else if (e.button === 2) {
      if (this.placement) { this.cancelPlacement(); return; }
      if (this.attackMoveArm) { this.attackMoveArm = false; return; }
      const ent = this.pickEntity(e.clientX, e.clientY);
      const p = this.screenToWorld(e.clientX, e.clientY);
      if (p) {
        this.game.commandRightClick(this.game.selection, p.x, p.z, ent);
        if (!ent) this.game.emit('ground-click', p.x, p.z, 'move');
      }
    }
  }

  onMouseMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (this.rotating) {
      this.yaw = this.rotating.yaw + (e.clientX - this.rotating.x) * 0.008;
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
        if (u.owner !== 0) continue;
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
        if (shift && ent.owner === 0) {
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
    const def = this.game.players[0].faction.buildings[key];
    const f = this.game.players[0].faction;
    const ghost = buildBuildingMesh(def.model, f.color, f.glow);
    ghost.traverse(o => {
      if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.55; o.castShadow = false; }
    });
    this.game.scene.add(ghost);
    this.placement = { key, def, ghost, valid: false, tx: 0, ty: 0 };
    this.updateGhost();
  }

  cancelPlacement() {
    if (this.placement) {
      this.game.scene.remove(this.placement.ghost);
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
    p.valid = this.game.canPlace(0, p.key, tx, ty) && this.game.canAfford(0, p.def.cost);
    p.ghost.traverse(o => { if (o.isMesh) o.material.opacity = p.valid ? 0.65 : 0.2; });
  }

  tryPlace(e) {
    const p = this.placement;
    if (!p || !p.valid) { Sound.error(); return; }
    const workers = this.selectedUnits().filter(u => u.def.worker);
    const b = this.game.placeBuilding(0, p.key, p.tx, p.ty, workers);
    if (b) {
      if (!e.shiftKey) this.cancelPlacement();
      this.ui.refreshPanel();
    } else Sound.error();
  }

  // ---------- per-frame ----------
  moveCameraTo(wx, wz) {
    this.focus.x = Math.max(0, Math.min(WORLD, wx));
    this.focus.z = Math.max(0, Math.min(WORLD, wz));
  }

  updateCamera(dt) {
    const speed = (30 + this.dist * 0.6) * dt;
    let mx = 0, mz = 0;
    // arrow keys pan (WASD letters are reserved for command hotkeys)
    if (this.keys['arrowup']) mz -= 1;
    if (this.keys['arrowdown']) mz += 1;
    if (this.keys['arrowleft']) mx -= 1;
    if (this.keys['arrowright']) mx += 1;
    // edge scroll
    if (this.mouse.inside && !this.dragStart) {
      const m = 14;
      if (this.mouse.x < m) mx = -1;
      if (this.mouse.x > window.innerWidth - m) mx = 1;
      if (this.mouse.y < m) mz = -1;
      if (this.mouse.y > window.innerHeight - m) mz = 1;
    }
    if (this.keys['q']) this.yaw += dt * 1.8;
    if (this.keys['e']) this.yaw -= dt * 1.8;
    if (mx || mz) {
      const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
      this.focus.x += (mx * cos - mz * sin) * speed;
      this.focus.z += (mx * sin + mz * cos) * speed;
      this.focus.x = Math.max(4, Math.min(WORLD - 4, this.focus.x));
      this.focus.z = Math.max(4, Math.min(WORLD - 4, this.focus.z));
    }
    const cam = this.game.camera;
    const pitch = 0.9 + (this.dist - 16) / 64 * 0.25; // steeper when zoomed out
    const fy = this.game.map.heightAt(this.focus.x, this.focus.z);
    const cx = this.focus.x + Math.sin(this.yaw) * Math.cos(pitch) * this.dist;
    const cz = this.focus.z + Math.cos(this.yaw) * Math.cos(pitch) * this.dist;
    const cy = fy + Math.sin(pitch) * this.dist;
    cam.position.set(cx, cy, cz);
    cam.lookAt(this.focus.x, fy, this.focus.z);
    // sun follows camera focus so shadows stay crisp
    const sun = this.game.sun;
    sun.position.set(this.focus.x + 40, 70, this.focus.z + 25);
    sun.target.position.set(this.focus.x, 0, this.focus.z);

    // selection rings
    this.syncSelectionRings();
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
    for (let i = 0; i < this.selRings.length; i++) {
      const ring = this.selRings[i];
      const e = sel[i];
      if (!e || e.dead) { ring.visible = false; continue; }
      ring.visible = true;
      const r = e.radius + 0.3;
      ring.scale.setScalar(r);
      ring.position.set(e.pos.x, this.game.map.heightAt(e.pos.x, e.pos.z) + 0.08, e.pos.z);
      ring.material.color.set(e.owner === 0 ? 0x66ff88 : e.owner === 1 ? 0xff5544 : 0xcccc88);
    }
  }
}
