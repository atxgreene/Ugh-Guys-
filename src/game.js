// Core RTS engine: entities, orders, combat, economy, production, win/loss.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GameMap, BIOMES, GRID, TILE, WORLD, MAP_SIZES, setMapSize } from './terrain.js';
import { findPath, findNearestWalkable, clearanceFor } from './pathfinding.js';
import { FACTIONS, UPGRADES, NEUTRALS, MONSTERS, RESOURCE_NODES, START_RES, SUPPLY_CAP,
  FIELDS_OF_EVIL, NEUTRAL_UNIT_DEFS, NEUTRAL_BUILDING_DEFS, EMPOWER } from './data.js';
import { makeRng } from './rng.js';
import { buildUnitMesh, buildBuildingMesh, buildResourceNode, glowMat, tickGlowMats, buildScaffold, buildFireCluster, buildDoodad } from './models.js';
import { waterNormalMap } from './textures.js';
import { ParticlePool } from './fx.js';
import { Sound } from './audio.js';
import { Settings } from './settings.js';

// Entity ids must be deterministic per match (a replay reconstructs the same id
// space), so this counter is reset at the start of every Game construction.
let nextId = 1;

const NEUTRAL_COLOR = 0x808078, NEUTRAL_GLOW = 0xc2b89a;

// Easter-egg first-contact dialogue (pixel portraits live in public/portraits/)
const CLAN_DIALOGUE = {
  landonian: { portrait: 'portraits/landon.png', name: 'Landry · Lord of the Landonians',
    line: '“You’re standing in my Fields. Bold move — I respect it. Won’t change what happens next.”' },
  boydonian: { portrait: 'portraits/boydonian.png', name: 'Connor · King of the Boydonians',
    line: '“Swing true, fear nothing. This is Boydonian ground, friend. Always has been.”' },
  greene: { portrait: 'portraits/greene.png', name: 'Mr Greene · Master of the House',
    line: '“Welcome to my Fields, stranger. The hounds caught your scent a mile off. Stay a while — few leave.”' },
  parker: { portrait: 'portraits/parker.png', name: 'Parker · Shepherd of the Fields',
    line: '“Oh — hello there! Didn’t expect company in the Fields. Parker’s the name. How are you holding up?”' },
  tucker: { portrait: 'portraits/tucker.png', name: 'Tucker · the Goldendoodle',
    line: '(He sniffs you thoroughly, wags once, and trots back to the house. Seems you passed.)' },
  gatsby: { portrait: 'portraits/gatsby.png', name: 'Gatsby · the French Bulldog',
    line: '(He stares at you. Deeply. With the absolute confidence of a dog who has never doubted himself.)' },
};

// Parker wanders the Fields and checks in on you — friendly, unbidden, harmless.
const PARKER_LINES = [
  '“How are you doing out there, friend? Truly — it’s a strange age to be alive.”',
  '“Mind the flock if you pass through. They spook easy, bless them.”',
  '“Rough times before the Flood, eh? Still — the grass grows. That’s something.”',
  '“You look weary. Rest if you need it. No quarrel here, never was.”',
  '“If you’re hungry, the Fields are generous. You’ve only to ask.”',
];

// Cinematic time-of-day moods. Each match picks one — sky, sun, fog and ambient
// shift together so the world reads as the last age before the Flood.
// Cinematic moods, tuned so the playfield stays readable in every one — the
// world is meant to feel like the last age before the Flood, not to be unlit.
// Hemisphere (sky/ground) carries most of the top-down terrain read, so its
// intensity + ground colour are kept up even at night.
const TIME_PRESETS = {
  dawn:  { name: 'Dawn of the Last Age', sun: 0xffd9a0, sunI: 2.7, hemiSky: 0x7a88b6, hemiGround: 0x46382a, hemiI: 1.55,
           rim: 0x8fa6ff, rimI: 0.9, fog: 0x2e3346, fogD: 0.0040, bg: 0x283044, env: 0.8,
           skyTop: '#1c2750', skyHorizon: '#c98a5a', skyGround: '#241a16', exposure: 1.55, storm: 0.2 },
  noon:  { name: 'High Sun', sun: 0xfff0d0, sunI: 3.1, hemiSky: 0x9ab0d8, hemiGround: 0x46402e, hemiI: 1.7,
           rim: 0x9fb4ff, rimI: 0.7, fog: 0x9aa2b0, fogD: 0.0028, bg: 0x6a7892, env: 0.9,
           skyTop: '#3a5a9a', skyHorizon: '#b9c2cf', skyGround: '#4a4030', exposure: 1.5, storm: 0.15 },
  dusk:  { name: 'Red Dusk', sun: 0xff9a5a, sunI: 2.85, hemiSky: 0x6e5c82, hemiGround: 0x3c2c1e, hemiI: 1.5,
           rim: 0x7a6cff, rimI: 1.1, fog: 0x402636, fogD: 0.0046, bg: 0x36222e, env: 0.74,
           skyTop: '#1a1430', skyHorizon: '#d9622e', skyGround: '#1a1012', exposure: 1.6, storm: 0.4 },
  night: { name: 'The Watch of Night', sun: 0xaebfe8, sunI: 1.9, hemiSky: 0x46587e, hemiGround: 0x282420, hemiI: 1.6,
           rim: 0x6f8cff, rimI: 1.3, fog: 0x141b2e, fogD: 0.0044, bg: 0x10131f, env: 0.72,
           skyTop: '#05060f', skyHorizon: '#2a3358', skyGround: '#06060a', exposure: 1.7, storm: 0.45, night: true },
  storm: { name: 'The Gathering Flood', sun: 0x9aa0b2, sunI: 2.1, hemiSky: 0x4c586e, hemiGround: 0x2c2c36, hemiI: 1.6,
           rim: 0x6a7cc0, rimI: 1.0, fog: 0x2a313f, fogD: 0.0052, bg: 0x232836, env: 0.74,
           skyTop: '#10141e', skyHorizon: '#3a4150', skyGround: '#0c0e14', exposure: 1.5, storm: 1.0, lightning: true },
};

// ---- replay command (de)serialization: entities ↔ stable ids ----
const _ids = a => (a || []).map(e => e.id);
const _id = e => (e ? e.id : null);
function serCmd(name, p) {
  switch (name) {
    case 'right':     return { sel: _ids(p.sel), x: p.x, z: p.z, ent: _id(p.ent), q: !!p.q };
    case 'formation': return { sel: _ids(p.sel), x: p.x, z: p.z, am: !!p.am, q: !!p.q };
    case 'patrol':    return { sel: _ids(p.sel), x: p.x, z: p.z, q: !!p.q };
    case 'stop':      return { sel: _ids(p.sel) };
    case 'stance':    return { sel: _ids(p.sel), s: p.s };
    case 'ability':   return { u: _id(p.u) };
    case 'train':     return { b: _id(p.b), key: p.key };
    case 'upgrade':   return { b: _id(p.b), key: p.key };
    case 'build':     return { o: p.o, key: p.key, tx: p.tx, ty: p.ty, w: _ids(p.w) };
    case 'empower':   return { o: p.o };
  }
  return {};
}
function deserCmd(name, s, map) {
  const e = id => (id == null ? null : map.get(id) || null);
  const es = arr => (arr || []).map(id => map.get(id)).filter(Boolean);
  switch (name) {
    case 'right':     return { sel: es(s.sel), x: s.x, z: s.z, ent: e(s.ent), q: s.q };
    case 'formation': return { sel: es(s.sel), x: s.x, z: s.z, am: s.am, q: s.q };
    case 'patrol':    return { sel: es(s.sel), x: s.x, z: s.z, q: s.q };
    case 'stop':      return { sel: es(s.sel) };
    case 'stance':    return { sel: es(s.sel), s: s.s };
    case 'ability':   return { u: e(s.u) };
    case 'train':     return { b: e(s.b), key: s.key };
    case 'upgrade':   return { b: e(s.b), key: s.key };
    case 'build':     return { o: s.o, key: s.key, tx: s.tx, ty: s.ty, w: es(s.w) };
    case 'empower':   return { o: s.o };
  }
  return {};
}

export class Entity {
  constructor(game, owner, def, key, x, z) {
    this.id = nextId++;
    this.game = game; this.owner = owner; this.def = def; this.key = key;
    this.pos = new THREE.Vector3(x, 0, z);
    this.maxHp = def.hp; this.hp = def.hp;
    this.dead = false;
    this.discovered = false; // for fog: has the local player ever seen it
  }
  get player() { return this.game.players[this.owner]; }
  get radius() { return this.def.radius || 0.6; }
  takeDamage(dmg, attacker) {
    if (this.dead) return;
    this.hp -= dmg;
    this.lastHurt = this.game.time;
    this.hitFlash = 0.14;                    // drives a brief scale-pop + recoil (units)
    if (attacker) {
      const dx = this.pos.x - attacker.pos.x, dz = this.pos.z - attacker.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.hitDir = { x: dx / l, z: dz / l };
    }
    this.game.onDamaged(this, attacker);
    if (this.hp <= 0) this.die(attacker);
  }
  distTo(o) { return Math.hypot(this.pos.x - o.pos.x, this.pos.z - o.pos.z); }
}

// ---------------- Unit ----------------
export class Unit extends Entity {
  constructor(game, owner, def, key, x, z) {
    super(game, owner, def, key, x, z);
    this.isUnit = true;
    this.state = 'idle';
    this.path = null; this.pathI = 0;
    this.dest = null;
    this.target = null;        // entity to attack
    this.gatherNode = null; this.carry = 0; this.carryType = null;
    this.buildSite = null;
    this.cooldown = 0;
    this.scanT = game.rand() * 0.3;       // sim-critical (scan cadence) → seeded
    this.animT = Math.random() * 10;       // cosmetic
    this.facing = Math.random() * Math.PI * 2;  // cosmetic (smoothly corrected on first order)
    this.facingTarget = this.facing;
    this.clearance = clearanceFor(def.radius || 0.6);
    this.stuckT = 0;           // time spent making no progress while moving
    this.repathT = 0;          // cooldown so we don't re-path every frame
    this.curSpeed = 0;         // eased speed for smooth accel/decel
    this.leash = null;         // neutral guard post
    this.stance = 'aggressive'; // 'aggressive' | 'defensive' | 'hold'
    this.anchor = null;         // hold/defensive return point
    this.orderQueue = [];       // shift-queued waypoints/commands (FIFO)
    this.patrolA = null; this.patrolB = null;  // patrol endpoints
    this.abilityCd = 0;         // seconds until ability is ready again
    this.abilityActiveDur = 0;  // seconds remaining on an active self-buff
    this.abilityBuff = null;    // { dmgMult?, armorAdd?, spdMult?, atkCdMult?, firstHit?, stunDur? }
    this.abilityDebuffDur = 0;  // seconds remaining on an incoming damage debuff
    this.abilityDebuffMult = 1; // incoming damage multiplier while debuffed
    this.stunDur = 0;           // seconds remaining of stun (can't attack)
    const f = owner === 2 ? { color: NEUTRAL_COLOR, glow: NEUTRAL_GLOW } : game.players[owner].faction;
    this.mesh = buildUnitMesh(def.model, f.color, f.glow, f.accent, f.glow2);
    this.mesh.position.copy(this.pos);
    this.mesh.userData.entity = this;
    game.scene.add(this.mesh);
  }

  effDmg(base) {
    let mult = this.owner <= 1 ? this.player.dmgMult : 1;
    if (this.abilityBuff?.dmgMult) mult *= this.abilityBuff.dmgMult;
    return Math.round(base * mult);
  }
  effArmor() {
    return this.def.armor + (this.owner <= 1 ? this.player.armorAdd : 0) + (this.abilityBuff?.armorAdd || 0);
  }
  effSpeed() { return this.def.speed * (this.abilityBuff?.spdMult ?? 1); }

  orderMove(x, z, attackMove = false) {
    this.target = null; this.gatherNode = null; this.buildSite = null; this.carryReturn = false;
    this.path = findPath(this.game.map, this.pos, { x, z }, this.clearance);
    this.pathI = 0; this.dest = { x, z }; this.pathGoal = { x, z };
    this.stuckT = 0; this.lastDist = undefined; this.ckDist = undefined; this.ckT = 0;
    // even with no tile path (e.g. destination deep in a wall) still head there;
    // the collision resolver will slide along barriers rather than freeze.
    this.state = attackMove ? 'attackMove' : 'move';
    if (this.stance !== 'aggressive') this.anchor = { x, z };   // hold/defend the new spot
  }
  // Combat stance: aggressive hunts freely, defensive engages but won't overextend
  // from its anchor, hold stands its ground and only strikes what comes in range.
  setStance(s) {
    this.stance = s;
    this.anchor = s === 'aggressive' ? null : { x: this.pos.x, z: this.pos.z };
  }
  orderAttack(target) {
    this.target = target; this.gatherNode = null; this.buildSite = null;
    this.state = 'attack'; this.path = null;
  }
  orderGather(node) {
    if (!this.def.worker || !node || node.amount <= 0) return;
    this.gatherNode = node; this.target = null; this.buildSite = null;
    this.state = this.carry > 0 && this.carryType === node.type ? 'return' : 'gather';
    this.path = null;
  }
  orderBuild(site) {
    if (!this.def.worker) return;
    this.buildSite = site; this.target = null; this.gatherNode = null;
    this.state = 'build'; this.path = null;
  }
  stop() { this.state = 'idle'; this.path = null; this.target = null; this.gatherNode = null; this.buildSite = null; this.pendingStrike = null; this.patrolA = this.patrolB = null; this.orderQueue.length = 0; }

  // Patrol back and forth between the current spot and a point, attacking what
  // strays into range and returning to the beat — classic guard micro.
  orderPatrol(x, z) {
    this.patrolA = { x: this.pos.x, z: this.pos.z };
    this.patrolB = { x, z };
    this.patrolTo = 'B';
    this.target = null; this.gatherNode = null; this.buildSite = null;
    this.orderMove(x, z, true);
    this.state = 'patrol';
  }

  // ---- shift-queued orders ----
  // Dispatch a single queued command object to the matching order.
  startOrder(c) {
    if (c.type === 'move') this.orderMove(c.x, c.z, c.attackMove);
    else if (c.type === 'patrol') this.orderPatrol(c.x, c.z);
    else if (c.type === 'attack') { if (c.target && !c.target.dead) this.orderAttack(c.target); else this.orderMove(c.x, c.z); }
    else if (c.type === 'gather') { if (c.node && c.node.amount > 0) this.orderGather(c.node); else this.orderMove(c.x, c.z); }
    else if (c.type === 'build') { if (c.site && !c.site.dead && !c.site.complete) this.orderBuild(c.site); else this.orderMove(c.x, c.z); }
  }
  // Issue a command, optionally appending to the queue (shift). Appends only while
  // the unit is already busy or has a queue; otherwise it starts immediately.
  command(c, queue) {
    if (queue && (this.state !== 'idle' || this.orderQueue.length)) this.orderQueue.push(c);
    else { this.orderQueue.length = 0; this.startOrder(c); }
  }
  // Pop and begin the next queued command; returns false when the queue is empty.
  advanceOrders() {
    const next = this.orderQueue.shift();
    if (!next) return false;
    this.startOrder(next);
    return true;
  }

  // Collision-aware move with wall sliding (LoL-style barrier glide). Attempts
  // the full step; if blocked, slides along whichever axis is clear. Returns the
  // distance actually travelled.
  moveBy(dx, dz) {
    const map = this.game.map, r = this.radius;
    const fromX = this.pos.x, fromZ = this.pos.z;
    if (!map.circleBlocked(fromX + dx, fromZ + dz, r)) {
      this.pos.x += dx; this.pos.z += dz;
    } else {
      // try each axis independently so we graze walls instead of stopping dead
      if (dx && !map.circleBlocked(fromX + dx, fromZ, r)) this.pos.x += dx;
      if (dz && !map.circleBlocked(this.pos.x, fromZ + dz, r)) this.pos.z += dz;
    }
    return Math.hypot(this.pos.x - fromX, this.pos.z - fromZ);
  }

  // Steer toward world point along the current path; returns true when within
  // `near`. Self-heals stale/blocked paths and gives up gracefully when crowded.
  seek(x, z, near, dt) {
    const dist = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (dist <= near) { this.moving = false; return true; }

    this.repathT -= dt;
    const goalMoved = !this.pathGoal || Math.hypot(this.pathGoal.x - x, this.pathGoal.z - z) > TILE;
    if (!this.path || goalMoved) {
      this.path = findPath(this.game.map, this.pos, { x, z }, this.clearance);
      this.pathGoal = { x, z }; this.pathI = 0; this.stuckT = 0; this.repathT = 0.4;
      this.lastDist = undefined; this.ckDist = undefined; this.ckT = 0;
    }

    // advance past waypoints we've effectively reached
    let wp = this.path && this.path[this.pathI];
    while (wp && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) < Math.max(0.5, this.radius)) {
      this.pathI++; wp = this.path[this.pathI];
    }
    const tx = wp ? wp.x : x, tz = wp ? wp.z : z;
    const mx = tx - this.pos.x, mz = tz - this.pos.z;
    const md = Math.hypot(mx, mz) || 1;

    // ease speed for smooth start/stop; slow slightly on the final approach
    const tileMult = this.game.map.tileSpeedMult(this.pos.x, this.pos.z);
    const target = this.effSpeed() * tileMult * (dist < 2.5 ? Math.max(0.35, dist / 2.5) : 1);
    this.curSpeed += (target - this.curSpeed) * Math.min(1, dt * 8);
    const step = this.curSpeed * dt;
    this.moveBy((mx / md) * step, (mz / md) * step);
    this.facingTarget = Math.atan2(mx, mz);
    this.moving = true;

    // backstop: if we haven't gained real ground (≥2 units) in 4s, settle. Legit
    // long journeys keep improving and reset this; only true grinders trip it.
    if (this.ckDist === undefined || dist < this.ckDist - 2) { this.ckDist = dist; this.ckT = 0; }
    else { this.ckT = (this.ckT || 0) + dt; if (this.ckT > 4) { this.moving = false; this.ckDist = undefined; return true; } }

    // stuck detection by NET PROGRESS toward the goal (robust to crowd jitter):
    // if we aren't actually getting closer, escalate from re-route → slip → give up.
    const progress = (this.lastDist === undefined ? 0 : this.lastDist - dist);
    this.lastDist = dist;
    if (progress < step * 0.25) {
      this.stuckT += dt;
      if (this.stuckT > 0.3 && this.repathT <= 0) {
        this.path = findPath(this.game.map, this.pos, { x, z }, this.clearance);
        this.pathGoal = { x, z }; this.pathI = 0; this.repathT = 0.5;
      }
      if (this.stuckT > 0.5) {
        // perpendicular slip to escape a corner or a clump
        const px = -(mz / md), pz = (mx / md);
        const side = ((this.id & 1) ? 1 : -1);
        this.moveBy(px * step * side, pz * step * side);
      }
      // jammed among allies anywhere near the destination → the slot is taken,
      // settle here rather than grinding (handles deep formation stragglers)
      if (this.stuckT > 0.8) {
        const crowd = this.game.unitsNear(this.pos, this.radius + 1.3, this).length;
        if (crowd >= 2 && dist <= near + this.radius * 2 + 9) { this.moving = false; return true; }
      }
      if (this.stuckT > 0.9 && dist <= near + this.radius * 2 + 2.0) { this.moving = false; return true; }
      if (this.stuckT > 2.0) { this.moving = false; return true; }
    } else {
      this.stuckT = 0;
    }
    return Math.hypot(x - this.pos.x, z - this.pos.z) <= near;
  }

  // Pick a target by tactical value, not just proximity: strongly prefer prey we
  // counter (tag bonus), finish wounded targets (focus fire), favour real threats
  // over workers, and treat buildings as a last resort. Distance is the baseline
  // so units still fight what's in front of them. Shared by player units AND the
  // AI, so smarter acquisition lifts enemy micro for free.
  acquireTarget(range) {
    const atk = this.def.attack;
    let best = null, bestScore = -Infinity;
    for (const e of this.game.allCombatants()) {
      if (e.dead || e.owner === this.owner) continue;
      if (this.owner !== 2 && e.owner === 2 && this.state !== 'attackMove') continue; // don't auto-aggro neutrals
      if (this.owner === 2 && e.owner === 2) continue;
      if (e.isBuilding && !e.complete) continue;
      const d = this.distTo(e) - e.radius;
      if (d > range) continue;
      let score = -d * 1.2;                              // closer is better (baseline)
      if (atk?.bonus) {                                  // we counter this unit → hunt it
        const mult = (e.def.tags || []).reduce((m, t) => m * (atk.bonus[t] || 1), 1);
        if (mult > 1) score += (mult - 1) * 6;
      }
      score += (1 - e.hp / e.maxHp) * 5;                 // focus fire: finish the wounded
      if (e.isUnit && !e.def.worker && e.def.attack) score += 3;   // real threat
      else if (e.def.worker) score += 1.5;               // workers: juicy, low threat
      if (e.isBuilding) score -= 5;                       // sieging is the fallback
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // Peaceful amble: pause a while, then drift to a random spot near home (the
  // leash, or the spawn point). orderMove carries us off in 'move'; on arrival
  // we fall back to 'idle' and amble again.
  wander(dt) {
    this.wanderT = (this.wanderT ?? this.game.rand() * 4) - dt;
    if (this.wanderT > 0) return;
    this.wanderT = 4 + this.game.rand() * 6;
    const home = this.leash || (this.wanderHome ||= { x: this.pos.x, z: this.pos.z });
    const a = this.game.rand() * Math.PI * 2, r = 2.5 + this.game.rand() * 6.5;
    this.orderMove(home.x + Math.cos(a) * r, home.z + Math.sin(a) * r);
  }

  attackRange(target) { return this.def.attack.range + this.radius + (target ? target.radius : 0); }

  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.moving = false;
    this.harvesting = false;
    const atk = this.def.attack;
    // ability cooldown + buff/debuff/stun ticks
    if (this.abilityCd > 0) this.abilityCd = Math.max(0, this.abilityCd - dt);
    if (this.abilityActiveDur > 0) {
      this.abilityActiveDur -= dt;
      if (this.abilityActiveDur <= 0) { this.abilityActiveDur = 0; this.abilityBuff = null; }
    }
    if (this.abilityDebuffDur > 0) {
      this.abilityDebuffDur -= dt;
      if (this.abilityDebuffDur <= 0) { this.abilityDebuffDur = 0; this.abilityDebuffMult = 1; }
    }
    if (this.stunDur > 0) this.stunDur = Math.max(0, this.stunDur - dt);

    // deferred melee blow: lands when the lunge reaches the target — but only if
    // we're still attacking that same target (orders/target may have changed).
    if (this.pendingStrike) {
      this.pendingStrike.delay -= dt;
      if (this.pendingStrike.delay <= 0) {
        const ps = this.pendingStrike; this.pendingStrike = null;
        const t = ps.target;
        if (t && !t.dead && this.state === 'attack' && this.target === t &&
            this.distTo(t) <= this.attackRange(t) + 0.4) {
          this.game.performAttack(this, t, ps.atk);
        }
      }
    }

    switch (this.state) {
      case 'idle': {
        if (this.def.peaceful) { this.wander(dt); break; }   // shepherds don't hunt — they amble
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 0.3;
          if (atk && !this.def.worker) {
            // hold only notices what it can already hit; defensive only what it can
            // reach inside its leash; aggressive sweeps its full aggro range
            const scanRange = this.stance === 'hold' ? atk.range + this.radius + 1.2
              : this.stance === 'defensive' ? Math.min(this.def.aggroRange, 7 + atk.range)
              : this.def.aggroRange;
            const t = this.acquireTarget(scanRange);
            if (t) { this.target = t; this.state = 'attack'; this.returnTo = { x: this.pos.x, z: this.pos.z }; }
          }
          // neutral leash
          if (this.owner === 2 && this.leash) {
            const t = this.acquireTarget(this.def.aggroRange);
            if (t) { this.target = t; this.state = 'attack'; }
          }
        }
        break;
      }
      case 'move': {
        if (this.seek(this.dest.x, this.dest.z, 0.5, dt)) { if (!this.advanceOrders()) this.state = 'idle'; }
        break;
      }
      case 'attackMove': {
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 0.25;
          const t = this.acquireTarget(this.def.aggroRange + 2);
          if (t) { this.target = t; this.state = 'attack'; this.resumeAM = this.dest; break; }
        }
        if (this.seek(this.dest.x, this.dest.z, 0.8, dt)) { if (!this.advanceOrders()) this.state = 'idle'; }
        break;
      }
      case 'patrol': {
        this.scanT -= dt;
        if (this.scanT <= 0) {
          this.scanT = 0.25;
          const t = this.acquireTarget(this.def.aggroRange + 2);
          if (t) { this.target = t; this.state = 'attack'; this.resumePatrol = true; break; }
        }
        const ep = this.patrolTo === 'B' ? this.patrolB : this.patrolA;
        if (!ep) { this.state = 'idle'; break; }
        if (this.seek(ep.x, ep.z, 0.9, dt)) {
          this.patrolTo = this.patrolTo === 'B' ? 'A' : 'B';
          const n = this.patrolTo === 'B' ? this.patrolB : this.patrolA;
          this.orderMove(n.x, n.z, true); this.state = 'patrol';
        }
        break;
      }
      case 'attack': {
        const t = this.target;
        if (!t || t.dead) {
          this.target = null;
          if (this.resumePatrol && this.patrolB) { this.resumePatrol = false; const ep = this.patrolTo === 'B' ? this.patrolB : this.patrolA; this.orderMove(ep.x, ep.z, true); this.state = 'patrol'; }
          else if (this.resumeAM) { this.orderMove(this.resumeAM.x, this.resumeAM.z, true); this.resumeAM = null; }
          else if (this.owner === 2 && this.leash) { this.state = 'move'; this.dest = { ...this.leash }; this.path = null; }
          else if (!this.advanceOrders()) this.state = 'idle';
          break;
        }
        if (!atk) { this.state = 'idle'; break; }
        // neutral leash break (bosses roam farther before disengaging + heal home)
        if (this.owner === 2 && this.leash &&
            Math.hypot(this.pos.x - this.leash.x, this.pos.z - this.leash.z) > (this.def.leashRange || 26)) {
          this.target = null; this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.5);
          this.state = 'move'; this.dest = { ...this.leash }; this.path = null; break;
        }
        // world bosses unleash their signature ability on cooldown the moment they fight
        if (this.owner === 2 && this.def.ability && this.abilityCd <= 0) this.game.useAbility(this);
        const inRange = this.distTo(t) <= this.attackRange(t);
        if (!inRange) {
          // hold stands its ground — wait if the target is still within reach (same
          // band the idle scan used, so no acquire/drop flicker), else release it
          if (this.stance === 'hold') {
            if (this.distTo(t) > atk.range + this.radius + 1.2) { this.target = null; this.state = 'idle'; }
            break;
          }
          // defensive chases, but breaks home if pulled past the leash. The break
          // radius is strictly beyond the defensive scan reach so it can't yo-yo.
          if (this.stance === 'defensive' && this.anchor &&
              Math.hypot(this.pos.x - this.anchor.x, this.pos.z - this.anchor.z) > 7 + atk.range + 2) {
            this.target = null; this.orderMove(this.anchor.x, this.anchor.z); break;
          }
          this.seek(t.pos.x, t.pos.z, this.attackRange(t) - 0.2, dt); break;
        }
        // ranged kiting: archers/casters back away from incoming melee threats while still firing.
        // Only when the target is a melee unit (no projectile), in aggressive/defensive stance, and
        // close enough to feel threatening (within 55% of full attack range).
        if (atk.projectile && this.stance !== 'hold' &&
            !t.def.attack?.projectile && t.def.attack &&
            this.distTo(t) < atk.range * 0.55 + this.radius + t.radius) {
          const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          this.moveBy((dx / d) * this.effSpeed() * 0.75 * dt, (dz / d) * this.effSpeed() * 0.75 * dt);
          this.moving = true;
        }
        this.facingTarget = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
        if (this.stunDur > 0) break;   // stunned — cannot attack
        if (this.cooldown <= 0) {
          this.cooldown = atk.cooldown * (this.abilityBuff?.atkCdMult ?? 1);
          this.lungeDur = 0.3; this.lungeT = this.lungeDur;
          // ranged fires now (the projectile carries the timing); melee lands on
          // contact — scheduled to the lunge's strike apex so the blow connects.
          if (atk.projectile) this.game.performAttack(this, t, atk);
          else this.pendingStrike = { target: t, atk, delay: 0.12 };
        }
        break;
      }
      case 'gather': {
        const n = this.gatherNode;
        if (!n || n.amount <= 0) { this.findNewNode(); break; }
        if (this.seek(n.pos.x, n.pos.z, n.radius + this.radius + 0.5, dt)) {
          // a faction-wide gather surge (Marshal the Stores) speeds the swing
          const boost = this.game.players[this.owner].gatherBoostT > 0 ? EMPOWER.gatherBoost : 1;
          this.gatherT = (this.gatherT ?? 0) + dt * boost;
          this.facingTarget = Math.atan2(n.pos.x - this.pos.x, n.pos.z - this.pos.z);
          this.harvesting = true;          // drives the chop/swing + gather particles
          this.game.gatherFx(n);
          const info = RESOURCE_NODES[n.type];
          if (this.gatherT >= info.gatherTime) {
            this.gatherT = 0;
            // worker saturation: past the node's ideal headcount, each surplus
            // laborer hauls less — the engine's nudge to spread out and expand.
            const crew = this.game.gatherersOn(n);
            const ideal = info.ideal || 3;
            const sat = crew <= ideal ? 1 : Math.max(0.45, ideal / crew);
            const take = Math.min(info.carry, n.amount);
            n.amount -= take;
            this.carry = take * sat; this.carryType = n.type;
            if (n.amount <= 0) this.game.depleteNode(n);
            this.state = 'return';
          }
        }
        break;
      }
      case 'return': {
        const drop = this.game.nearestDropoff(this.owner, this.pos);
        if (!drop) { this.state = 'idle'; break; }
        if (this.seek(drop.pos.x, drop.pos.z, drop.radius + this.radius + 0.6, dt)) {
          this.player.resources[this.carryType] = (this.player.resources[this.carryType] || 0) + this.carry;
          this.carry = 0;
          if (this.gatherNode && this.gatherNode.amount > 0) this.state = 'gather';
          else this.findNewNode();
        }
        break;
      }
      case 'build': {
        const s = this.buildSite;
        if (!s || s.dead || s.complete) { this.stop(); break; }
        if (this.seek(s.pos.x, s.pos.z, s.radius + this.radius + 0.8, dt)) {
          this.facingTarget = Math.atan2(s.pos.x - this.pos.x, s.pos.z - this.pos.z);
          s.builders = Math.min(3, (s.builders || 0) + 1);
        }
        break;
      }
    }

    // soft separation — resolved through the collision mover so units are never
    // shoved into walls (which was the old freeze cause). Moving units push less
    // so they can flow through a crowd instead of jamming.
    {
      const near = this.game.unitsNear(this.pos, 2.0, this);
      let sx = 0, sz = 0;
      for (const o of near) {
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
        const d = Math.hypot(dx, dz) || 0.01;
        const overlap = this.radius + o.radius + 0.12 - d;
        if (overlap > 0) {
          // settled units hold ground; movers yield — keeps clumps from churning
          const mine = this.moving ? 0.35 : 0.55;
          sx += (dx / d) * overlap * mine;
          sz += (dz / d) * overlap * mine;
        }
      }
      if (sx || sz) this.moveBy(sx * Math.min(1, dt * 9), sz * Math.min(1, dt * 9));
    }
    // safety net: if anything still left us inside a blocked tile, ease out
    if (this.game.map.circleBlocked(this.pos.x, this.pos.z, this.radius)) {
      const t = this.game.map.tileOf(this.pos.x, this.pos.z);
      const w = findNearestWalkable(this.game.map, t.x, t.y, 5, this.clearance);
      if (w) {
        const wx = (w.x + 0.5) * TILE, wz = (w.y + 0.5) * TILE;
        this.pos.x += (wx - this.pos.x) * Math.min(1, dt * 5);
        this.pos.z += (wz - this.pos.z) * Math.min(1, dt * 5);
      }
    }
    this.pos.x = Math.max(1, Math.min(WORLD - 1, this.pos.x));
    this.pos.z = Math.max(1, Math.min(WORLD - 1, this.pos.z));

    // visuals — smooth turn toward facing target (shortest arc)
    const dA = ((this.facingTarget - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += dA * Math.min(1, dt * 11);
    this.animT += dt * (this.moving ? 10 : this.harvesting ? 9 : 2);
    const h = this.game.map.heightAt(this.pos.x, this.pos.z);
    // idle breathing keeps standing units alive; running bob while moving
    const bob = this.moving ? Math.abs(Math.sin(this.animT)) * 0.12 : Math.sin(this.animT) * 0.03;
    this.mesh.position.set(this.pos.x, h + bob, this.pos.z);
    this.mesh.rotation.y = this.facing;
    this.mesh.rotation.z = this.moving ? Math.sin(this.animT) * 0.06 : 0;
    // bend/swing while harvesting: a rhythmic chop forward, else lean into the run
    this.mesh.rotation.x = this.harvesting ? Math.max(0, Math.sin(this.animT)) * 0.5
      : this.moving ? 0.05 : 0;
    // attack: anticipation (pull back) then a snap strike forward, settling home
    if (this.lungeT > 0) {
      this.lungeT -= dt;
      const p = this.lungeT / this.lungeDur;          // 1 → 0
      const f = p > 0.65 ? -(p - 0.65) / 0.35 * 0.4    // wind-up: ease backward
                         : Math.sin((0.65 - p) / 0.65 * Math.PI) * 0.55; // strike forward & return
      this.mesh.position.x += Math.sin(this.facing) * f;
      this.mesh.position.z += Math.cos(this.facing) * f;
    }
    // getting hit: a quick scale-pop + recoil nudge so blows register with weight
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt);
      const k = this.hitFlash / 0.14;                 // 1 → 0
      this.mesh.scale.setScalar(1 + 0.16 * k);
      if (this.hitDir) {
        const r = 0.18 * k;
        this.mesh.position.x += this.hitDir.x * r;
        this.mesh.position.z += this.hitDir.z * r;
      }
    } else if (this.mesh.scale.x !== 1) {
      this.mesh.scale.setScalar(1);
    }
    // kicked-up dust while moving — heavier and shakier for the great ones
    if (this.moving) {
      const massive = (this.def.tags || []).includes('massive');
      const interval = massive ? 0.28 : 0.5;
      this.dustT = (this.dustT || 0) - dt;
      if (this.dustT <= 0) {
        this.dustT = interval;
        this.game.dustAt(this.pos.x, this.pos.z, massive ? 2.4 : 0.9);
        if (massive) {
          this.game.dustAt(this.pos.x + (Math.random() - 0.5), this.pos.z + (Math.random() - 0.5), 1.8);
          const f = this.game.controls && this.game.controls.focus;
          if (f && Math.hypot(this.pos.x - f.x, this.pos.z - f.z) < 26) this.game.addShake(0.06);
        }
      }
    }
  }

  findNewNode() {
    const cur = this.gatherNode;
    let best = null, bd = 45;
    for (const n of this.game.resources) {
      if (n.amount <= 0 || (cur && n.type !== cur.type)) continue;
      const d = this.distTo(n);
      if (d < bd) { bd = d; best = n; }
    }
    if (best) this.orderGather(best);
    else this.stop();
  }

  die(attacker) {
    this.dead = true;
    const s = this.game.stats;
    if (this.owner === 0) s.lost++;
    else if (attacker && attacker.owner === 0) s.killed++;
    this.game.removeUnit(this, attacker);
    Sound.death();
  }
}

// ---------------- Building ----------------
export class Building extends Entity {
  constructor(game, owner, def, key, tx, ty) {
    const size = def.size;
    const cx = (tx + size / 2) * TILE, cz = (ty + size / 2) * TILE;
    super(game, owner, def, key, cx, cz);
    this.isBuilding = true;
    this.tx = tx; this.ty = ty; this.size = size;
    this.complete = false;
    this.progress = 0;
    this.builders = 0;
    this.trainQueue = [];
    this.rally = null;
    this.cooldown = 0;
    this.def.radius = size * TILE * 0.55;
    const f = game.players[owner].faction;
    this.mesh = buildBuildingMesh(def.model, f.color, f.glow, f.accent, f.glow2);
    // average ground height across footprint
    let hs = 0;
    for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) hs += game.map.heightAt((tx + x) * TILE, (ty + y) * TILE);
    this.groundY = hs / ((size + 1) * (size + 1));
    this.mesh.position.set(cx, this.groundY, cz);
    this.mesh.scale.y = 0.08;
    this.mesh.userData.entity = this;
    game.scene.add(this.mesh);
    // faction-colored claim glow under the structure
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(size * TILE * 0.6, 24),
      new THREE.MeshBasicMaterial({ color: f.glow, transparent: true, opacity: 0.09, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(cx, this.groundY + 0.06, cz);
    game.scene.add(disc);
    this.disc = disc;
    // block tiles
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      game.map.blocked[game.map.idx(tx + x, ty + y)] = 1;
    this.hp = Math.max(1, Math.round(def.hp * 0.1));
    // smoke/spark emission profile by building type
    const FORGE = ['foundry', 'starforge', 'star_forge'];
    const HEARTH = ['city_center', 'spire', 'hearth', 'granary', 'bonepit', 'temple', 'archive'];
    this.emitsSparks = FORGE.includes(def.model);
    this.emitsSmoke = this.emitsSparks || HEARTH.includes(def.model);
    this.smokeY = size * 1.6 + 1.2;
    this.emitT = Math.random();
    this.damageStage = 0;
    // timber scaffold while it's being raised
    this.scaffold = buildScaffold(size * TILE, size * 1.6 + 1);
    this.scaffold.position.set(cx, this.groundY, cz);
    game.scene.add(this.scaffold);
  }

  get radius() { return this.def.radius; }

  update(dt) {
    if (!this.complete) {
      if (this.builders > 0) {
        const rate = Math.sqrt(this.builders);
        this.progress += (dt / this.def.buildTime) * rate;
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.9 * (dt / this.def.buildTime) * rate);
        // ease the rise so structures grow out of the ground rather than snapping
        this.mesh.scale.y = 0.08 + 0.92 * Math.min(1, this.progress);
        // construction dust around the footprint
        if (Math.random() < dt * 4 && this.game.map.fogStateAt(this.pos.x, this.pos.z) === 2)
          this.game.dustAt(this.pos.x + (Math.random() - 0.5) * this.radius * 2,
                           this.pos.z + (Math.random() - 0.5) * this.radius * 2, 1.2);
        // scaffold planks settle a touch as the structure rises within them
        if (this.scaffold) {
          this.scaffold.visible = this.mesh.visible;
          this.scaffold.position.y = this.groundY + Math.sin(this.game.time * 3) * 0.02;
        }
        if (this.progress >= 1) {
          this.complete = true;
          this.mesh.scale.y = 1;
          this.removeScaffold();
          this.game.onBuildingComplete(this);
        }
      }
      this.builders = 0;
      return;
    }
    // progressive battle damage: char → smoke → fire + structural lean
    this.updateDamage(dt);
    // living chimney smoke / forge sparks, and distress smoke when damaged
    const visible = this.mesh.visible && this.game.map.fogStateAt(this.pos.x, this.pos.z) >= 1;
    if (visible) {
      this.emitT -= dt;
      const hurt = this.hp < this.maxHp * 0.5;
      if (this.emitT <= 0) {
        this.emitT = 0.18 + Math.random() * 0.18;
        if (this.emitsSmoke || hurt) {
          const c = hurt ? 0.9 : 0.5;
          this.game.fxSmoke.spawn(this.pos.x + (Math.random() - 0.5) * this.radius,
            this.groundY + this.smokeY, this.pos.z + (Math.random() - 0.5) * this.radius,
            (Math.random() - 0.5) * 0.4, 1.0 + Math.random(), (Math.random() - 0.5) * 0.4,
            2.2 + Math.random(), 1.2 + Math.random() * 0.8, c, 2.6);
        }
      }
      if (this.emitsSparks && Math.random() < dt * 12) {
        this.game.fxSpark.spawn(this.pos.x + (Math.random() - 0.5) * this.radius, this.groundY + 1.6,
          this.pos.z + (Math.random() - 0.5) * this.radius,
          (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2,
          0.5 + Math.random() * 0.3, 0.18, 1.0);
      }
      if (hurt && Math.random() < dt * 3) {
        this.game.fxSpark.spawn(this.pos.x + (Math.random() - 0.5) * this.radius * 1.5, this.groundY + this.smokeY * 0.6,
          this.pos.z + (Math.random() - 0.5) * this.radius * 1.5, 0, 0.5, 0, 0.5, 0.16, 1.0);
      }
    }
    // production
    if (this.trainQueue.length) {
      const job = this.trainQueue[0];
      job.t += dt;
      if (job.t >= job.total) {
        this.trainQueue.shift();
        if (job.upgrade) this.game.finishUpgrade(this.owner, job.key);
        else this.game.spawnTrained(this, job.key);
      }
    }
    // favor / knowledge trickle
    const p = this.game.players[this.owner];
    if (this.def.favorRate) p.resources.favor += this.def.favorRate * dt / 60;
    if (this.def.knowledgeRate) p.resources.knowledge += this.def.knowledgeRate * dt / 60;
    // tower attack
    if (this.def.attack) {
      this.cooldown = Math.max(0, this.cooldown - dt);
      if (this.cooldown <= 0) {
        let best = null, bd = this.def.attack.range + this.radius;
        for (const e of this.game.allCombatants()) {
          if (e.dead || e.owner === this.owner || e.owner === 2 || e.isBuilding) continue;
          const d = this.distTo(e);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) {
          this.cooldown = this.def.attack.cooldown;
          this.game.performAttack(this, best, this.def.attack);
        }
      }
    }
  }

  removeScaffold() {
    if (!this.scaffold) return;
    this.game.scene.remove(this.scaffold);
    this.scaffold.traverse(o => { if (o.isMesh) o.geometry.dispose?.(); });
    this.scaffold = null;
    // a puff of dust as the frame comes down
    if (this.game.map.fogStateAt(this.pos.x, this.pos.z) === 2)
      for (let i = 0; i < 6; i++)
        this.game.dustAt(this.pos.x + (Math.random() - 0.5) * this.radius * 2,
                         this.pos.z + (Math.random() - 0.5) * this.radius * 2, 1.3);
  }

  // escalate visible damage at HP thresholds; clear it again if repaired.
  // NB: building meshes share cached materials, so damage is shown with
  // per-instance scorch geometry + tilt + fire, never by recoloring materials.
  updateDamage(dt) {
    const frac = this.hp / this.maxHp;
    const stage = frac < 0.34 ? 2 : frac < 0.66 ? 1 : 0;
    if (stage !== this.damageStage) {
      this.damageStage = stage;
      // structural lean as it fails
      this.mesh.rotation.z = stage === 2 ? 0.05 : stage === 1 ? 0.02 : 0;
      // scorch marks: a few charred chunks clinging to the structure
      if (stage >= 1 && !this.scorch) {
        this.scorch = new THREE.Group();
        const char = new THREE.MeshStandardMaterial({ color: 0x140f0c, roughness: 1, flatShading: true });
        const span = this.size * TILE * 0.5;
        for (let i = 0; i < this.size + 2; i++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.4 + Math.random() * 0.5, 0.4 + Math.random() * 0.6, 0.2), char);
          c.position.set((Math.random() - 0.5) * span * 1.6, this.size * (0.4 + Math.random()),
            span + 0.05);
          c.rotation.set(Math.random(), Math.random(), Math.random());
          this.scorch.add(c);
        }
        this.scorch.position.set(this.pos.x, this.groundY, this.pos.z);
        this.game.scene.add(this.scorch);
      }
      if (stage === 2 && !this.fire) {
        this.fire = buildFireCluster(Math.min(6, this.size * 2), 0.9);
        this.fire.position.set(this.pos.x, this.groundY + this.size * 0.9, this.pos.z);
        this.game.scene.add(this.fire);
      } else if (stage < 2 && this.fire) {
        this.game.scene.remove(this.fire); this.fire = null;
      }
      if (stage === 0 && this.scorch) { this.game.scene.remove(this.scorch); this.scorch = null; }
    }
    if (this.scorch) this.scorch.visible = this.mesh.visible;
    if (this.fire) {
      const t = this.game.time;
      this.fire.visible = this.mesh.visible;
      this.fire.children.forEach(f => {
        f.scale.y = 0.7 + Math.abs(Math.sin(t * 9 + f.userData.phase)) * 0.7;
        f.material.opacity = 0.7 + Math.sin(t * 12 + f.userData.phase) * 0.25;
      });
    }
  }

  die(attacker) {
    this.dead = true;
    if (this.owner === 1 && attacker && attacker.owner === 0) this.game.stats.razed++;
    this.removeScaffold();
    if (this.fire) { this.game.scene.remove(this.fire); this.fire = null; }
    if (this.scorch) { this.game.scene.remove(this.scorch); this.scorch = null; }
    this.game.removeBuilding(this, attacker);
    Sound.buildingDie();
  }
}

// ---------------- Resource node ----------------
export class ResourceNode extends Entity {
  constructor(game, type, tx, ty) {
    const def = { hp: 1, radius: type === 'timber' ? 1.6 : 1.2, name: RESOURCE_NODES[type].name };
    super(game, 2, def, type, (tx + 0.5) * TILE, (ty + 0.5) * TILE);
    this.isResource = true;
    this.type = type;
    this.amount = RESOURCE_NODES[type].amount;
    this.tx = tx; this.ty = ty;
    this.mesh = buildResourceNode(RESOURCE_NODES[type].model === 'field' ? 'grain' : type);
    this.mesh.position.set(this.pos.x, game.map.heightAt(this.pos.x, this.pos.z), this.pos.z);
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    this.mesh.userData.entity = this;
    game.scene.add(this.mesh);
    game.map.blocked[game.map.idx(tx, ty)] = 1;
  }
}

// ---------------- Game ----------------
export class Game {
  constructor(container, playerFactionKey, enemyFactionKey, opts = {}) {
    nextId = 1;   // deterministic per-match entity id space (replay reconstructs it)
    this.container = container;
    this.pfKey = playerFactionKey; this.efKey = enemyFactionKey;
    this.time = 0;
    this.speed = 1;
    this.over = false;
    this.paused = false;
    this.fogTimer = 0;
    this.combatHeat = 0;  // 0..1 battle intensity, drives the music's combat layer
    this.stats = { trained: 0, lost: 0, killed: 0, razed: 0 };  // player (owner 0) match tally
    this.metClans = {};   // first-contact dialogue fired per clan
    // a saved game pins the exact map (seed/biome/mood) so it reloads identically
    const load = opts.load || null;
    this.loadedGame = !!load;   // AI skips the opening-stockpile handicap on a restored game
    if (load) { opts = { seed: load.seed, biome: load.biomeKey, timeOfDay: load.timeOfDay, difficulty: load.difficulty, mapSize: load.mapSize }; }
    // Battlefield size — pinned by a save, else the player's setting. Must be set
    // before the map (and WORLD-dependent atmosphere) is built. Live binding means
    // GRID/WORLD elsewhere pick up the new scale automatically.
    this.mapSizeKey = (opts.mapSize && MAP_SIZES[opts.mapSize]) ? opts.mapSize
      : (MAP_SIZES[Settings.get('mapSize')] ? Settings.get('mapSize') : 'standard');
    setMapSize(this.mapSizeKey);
    // AI difficulty: explicit option wins, else the saved value, else the player's setting
    this.difficulty = opts.difficulty || Settings.get('difficulty') || 'normal';
    // choose the land first, then a sky mood that suits it
    const bkeys = Object.keys(BIOMES);
    this.biomeKey = opts.biome && BIOMES[opts.biome] ? opts.biome : bkeys[Math.floor(Math.random() * bkeys.length)];
    const moods = opts.timeOfDay ? [opts.timeOfDay] : BIOMES[this.biomeKey].moods;
    this.timeOfDay = moods[Math.floor(Math.random() * moods.length)];
    this.preset = TIME_PRESETS[this.timeOfDay];
    // player-tunable exposure (settings panel); _exposureFade is the defeat dim.
    this.brightness = Settings.get('brightness') ?? 1;
    this._exposureFade = 1;
    // quality: 'auto' lets the main loop drop visuals under load; 'high'/'low' pin it.
    this.qualityMode = Settings.get('quality') || 'auto';
    this.units = []; this.buildings = []; this.resources = [];
    this.projectiles = []; this.effects = [];
    this.pendingTelegraphs = [];   // dodgeable boss AoE wind-ups (resolve after a delay)
    this.selection = [];
    this.listeners = {};
    // Which player THIS client controls (0 in single-player; the joined seat in
    // multiplayer). Only input/UI/fog read it — the simulation itself is the same on
    // every client, keyed by actual entity owners. `net` holds the lockstep session
    // when in a networked match (commands are deferred to it instead of run inline).
    this.localPlayer = opts.localPlayer ?? 0;
    this.net = null;

    this.players = [
      this.makePlayer(FACTIONS[playerFactionKey]),
      this.makePlayer(FACTIONS[enemyFactionKey]),
      { faction: { color: NEUTRAL_COLOR, glow: NEUTRAL_GLOW, name: 'The Wild' }, resources: {}, dmgMult: 1, armorAdd: 0, hpMult: 1, upgrades: new Set() },
    ];

    this.initRenderer();
    this.map = new GameMap(opts.seed, this.biomeKey);
    // Seeded simulation RNG: every gameplay-affecting random draw flows through
    // this.rand() so a match is fully reproducible from (seed + input stream).
    // Derived from the (now-fixed) map seed so a save/replay reloads identically.
    this.rng = makeRng((this.map.seed ^ 0x53c0ffee) >>> 0);
    this.scene.add(this.map.buildMesh());
    const _wm = this.map.buildWaterMesh();
    if (_wm) this.scene.add(_wm);
    this.map.scatterDoodads(this.scene);
    this.initAtmosphere();
    if (load) this.deserialize(load);
    else this.spawnInitial();
    this.map.updateFog(this.playerViewers());
    this.applyFogVisibility();

    // ---- replay recorder ----
    // Every fresh match records its seed + the player command stream so it can be
    // replayed deterministically. Playback runs with replayMode=true (no recording,
    // live input ignored; the Replay driver feeds the recorded frames instead).
    // Saved-game restores are not recorded (their mid-match state isn't reproducible
    // from a seed alone).
    this.replayMode = !!opts.replay;
    this.rec = (this.replayMode || load) ? null : {
      v: 1, frame: 0, frames: [],
      pending: [],
      header: { seed: this.map.seed, biomeKey: this.biomeKey, timeOfDay: this.timeOfDay,
        mapSize: this.mapSizeKey, difficulty: this.difficulty, pf: this.pfKey, ef: this.efKey },
    };
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }

  makePlayer(faction) {
    return {
      faction,
      resources: { ...START_RES },
      dmgMult: 1, armorAdd: 0, hpMult: 1,
      upgrades: new Set(),
      supplyUsed: 0, supplyCap: 0,
      empowerCd: 0,      // Marshal-the-Stores cooldown (active economy ability)
      gatherBoostT: 0,   // remaining seconds of the gather-speed surge it grants
    };
  }

  // Seeded simulation RNG accessor — use for ANY randomness that affects the
  // simulation (movement, AI, timing). Cosmetic-only jitter stays on Math.random.
  rand() { return this.rng(); }

  // The player THIS client controls (the local seat). Input, the HUD, and fog read
  // this so the same code serves owner 0 in single-player and owner N in a net game.
  get me() { return this.players[this.localPlayer]; }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.applyExposure();
    this.container.appendChild(this.renderer.domElement);

    const P = this.preset;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(P.bg);
    this.scene.fog = new THREE.FogExp2(P.fog, P.fogD);

    // Image-based lighting from a procedural dusk sky — gives every surface
    // soft ambient gradient and lets bronze/star-metal actually reflect.
    this.scene.environment = this.buildEnvironment();
    this.scene.environmentIntensity = P.env;

    this.camera = new THREE.PerspectiveCamera(48, this.container.clientWidth / this.container.clientHeight, 1, 600);

    const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiI);
    this.scene.add(hemi); this.hemi = hemi;
    // warm key sun
    this.sun = new THREE.DirectionalLight(P.sun, P.sunI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 280;
    const ext = 70;
    this.sun.shadow.camera.left = -ext; this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext; this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun); this.scene.add(this.sun.target);
    // cool rim/back light makes units and buildings pop off the dark ground (LoL look)
    this.rim = new THREE.DirectionalLight(P.rim, P.rimI);
    this.scene.add(this.rim); this.scene.add(this.rim.target);

    // doomed red star on the horizon (pure mood)
    const star = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 12), glowMat(0xff3a22, 1.2));
    star.position.set(WORLD * 0.5, 38, -90);
    this.scene.add(star);

    // bloom pipeline (MSAA target so edges stay clean)
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.6, 0.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // cinematic grade: gentle vignette, lifted contrast, a touch more saturation
    this.gradePass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, vignette: { value: 1.12 }, sat: { value: 1.14 }, contrast: { value: 1.06 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tDiffuse; uniform float vignette, sat, contrast;
        void main(){
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = dot(c, vec3(0.299,0.587,0.114));
          c = mix(vec3(l), c, sat);                 // saturation
          c = (c - 0.5) * contrast + 0.5;           // contrast
          vec2 d = vUv - 0.5;
          float v = smoothstep(0.85, 0.35, dot(d,d) * vignette * 2.0);
          c *= mix(0.72, 1.0, v);                    // vignette
          gl_FragColor = vec4(clamp(c,0.0,1.0), 1.0);
        }`,
    });
    this.composer.addPass(this.gradePass);

    window.addEventListener('resize', this.onResize = () => {
      const cw = this.container.clientWidth, ch = this.container.clientHeight;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
      this.composer.setSize(cw, ch);
    });
  }

  // Procedural sky environment map for image-based lighting, tinted to the mood.
  buildEnvironment() {
    const P = this.preset;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, P.skyTop);
    g.addColorStop(0.5, P.skyHorizon);
    g.addColorStop(0.62, P.skyHorizon);
    g.addColorStop(0.72, P.skyGround);
    g.addColorStop(1.0, P.skyGround);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 256);
    // faint warm bloom near the horizon (the doomed star's glow)
    const rg = ctx.createRadialGradient(380, 150, 10, 380, 150, 150);
    rg.addColorStop(0, 'rgba(255,90,40,0.5)'); rg.addColorStop(1, 'rgba(255,90,40,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, 512, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose(); tex.dispose();
    return env;
  }

  // Gradient sky dome + storm cloud wall + lunar halo + distant rain curtain.
  buildSky() {
    const P = this.preset;
    const geo = new THREE.SphereGeometry(440, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, fog: false, depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(P.skyTop) },
        horizon: { value: new THREE.Color(P.skyHorizon) },
        ground: { value: new THREE.Color(P.skyGround) },
        flash: { value: 0 },
      },
      vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
      fragmentShader: `
        varying vec3 vW; uniform vec3 top, horizon, ground; uniform float flash;
        void main(){
          float h = vW.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55))
                           : mix(horizon, ground, clamp(-h*2.2,0.0,1.0));
          c += flash * vec3(0.5,0.55,0.75) * smoothstep(0.5,-0.1,h); // lightning lifts the low sky
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dome = new THREE.Mesh(geo, mat);
    dome.position.set(WORLD / 2, 0, WORLD / 2);
    this.scene.add(dome);
    this.skyMat = mat;

    // distant storm cloud wall — a dark banded ring that slowly drifts
    if (P.storm > 0.25) {
      const cloud = new THREE.Mesh(
        new THREE.CylinderGeometry(410, 410, 150 * P.storm, 48, 1, true),
        new THREE.MeshBasicMaterial({ color: P.lightning ? 0x161a24 : 0x241c28, transparent: true,
          opacity: 0.55 + P.storm * 0.35, side: THREE.BackSide, fog: false, depthWrite: false })
      );
      cloud.position.set(WORLD / 2, 60, WORLD / 2);
      this.scene.add(cloud); this.stormBand = cloud;
      // far rain curtain on one flank
      const rain = new THREE.Mesh(
        new THREE.PlaneGeometry(280, 150),
        new THREE.MeshBasicMaterial({ color: 0x3a4456, transparent: true, opacity: 0.22 * P.storm,
          fog: false, depthWrite: false, side: THREE.DoubleSide })
      );
      rain.position.set(WORLD / 2 - 300, 70, WORLD / 2 + 120);
      rain.lookAt(WORLD / 2, 30, WORLD / 2);
      this.scene.add(rain);
    }

    // lunar halo at night / dawn
    if (P.night || this.timeOfDay === 'dawn') {
      const moon = new THREE.Mesh(new THREE.CircleGeometry(14, 32),
        new THREE.MeshBasicMaterial({ color: 0xcdd6f0, transparent: true, opacity: 0.9, fog: false, depthWrite: false }));
      const halo = new THREE.Mesh(new THREE.RingGeometry(16, 34, 40),
        new THREE.MeshBasicMaterial({ color: 0x8fa0d0, transparent: true, opacity: 0.18, fog: false,
          side: THREE.DoubleSide, depthWrite: false }));
      const mp = new THREE.Vector3(WORLD / 2 - 160, 150, WORLD / 2 - 360);
      moon.position.copy(mp); halo.position.copy(mp);
      moon.lookAt(WORLD / 2, 40, WORLD / 2); halo.lookAt(WORLD / 2, 40, WORLD / 2);
      this.scene.add(moon); this.scene.add(halo);
    }
  }

  initAtmosphere() {
    this.buildSky();
    // black water in the lowland basins, with slow drifting ripples
    this.waterNormal = waterNormalMap();
    this.waterNormal.repeat.set(36, 36);
    // faint sky-tinted sheen so dark-mood water reads as a surface, not a void
    const wc = new THREE.Color(this.preset.skyHorizon).lerp(new THREE.Color(0x0d1118), 0.7);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD, WORLD),
      new THREE.MeshStandardMaterial({
        color: wc, metalness: 0.6, roughness: 0.32,
        emissive: new THREE.Color(this.preset.skyHorizon).multiplyScalar(0.06),
        normalMap: this.waterNormal, normalScale: new THREE.Vector2(0.5, 0.5),
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(WORLD / 2, 0.24, WORLD / 2);
    water.receiveShadow = true;
    this.scene.add(water);

    // far starfield (unaffected by scene fog)
    const starN = 420, starPos = new Float32Array(starN * 3);
    for (let i = 0; i < starN; i++) {
      const a = Math.random() * Math.PI * 2, el = 0.06 + Math.random() * 0.9;
      const r = 380;
      starPos[i * 3] = WORLD / 2 + Math.cos(a) * Math.cos(el) * r;
      starPos[i * 3 + 1] = Math.sin(el) * r * 0.6;
      starPos[i * 3 + 2] = WORLD / 2 + Math.sin(a) * Math.cos(el) * r;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starOpacity = this.preset.night ? 0.85 : this.timeOfDay === 'noon' ? 0.12 : 0.5;
    this.scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0xaab6e8, size: 1.7, sizeAttenuation: false, transparent: true,
      opacity: starOpacity, fog: false, depthWrite: false,
    })));

    // drifting embers — ash of the age, caught by bloom
    const N = 160;
    const posArr = new Float32Array(N * 3);
    this.emberVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      posArr[i * 3] = Math.random() * WORLD;
      posArr[i * 3 + 1] = Math.random() * 10;
      posArr[i * 3 + 2] = Math.random() * WORLD;
      this.emberVel[i] = 0.4 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.embers = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xff8a50, size: 0.32, sizeAttenuation: true, transparent: true,
      opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.scene.add(this.embers);

    this.buildGodRays();
    this.buildCloudShadows();
    this.buildDustMotes();

    // particle pools: marching/footstep dust, building & damage smoke, foundry sparks
    this.fxDust = new ParticlePool(this.scene, { capacity: 360, color: 0xb9a98a, gravity: -1.2 });
    this.fxSmoke = new ParticlePool(this.scene, { capacity: 300, color: 0x6a6358, gravity: 0.6 });
    this.fxSpark = new ParticlePool(this.scene, { capacity: 180, color: 0xffb24a, gravity: -7, blending: THREE.AdditiveBlending });
    this.shake = 0;
  }

  // Volumetric sun shafts: a handful of soft additive slabs leaning along the
  // key-light direction, so light appears to stream down across the battlefield.
  // Strong in daylight moods, near-absent at night / under storm cloud.
  buildGodRays() {
    const P = this.preset;
    const rayI = P.night ? 0.05 : P.lightning ? 0.05 : this.timeOfDay === 'noon' ? 0.10 : 0.15;
    const tex = this._shaftTexture();
    const warm = new THREE.Color(P.sun).lerp(new THREE.Color(0xfff0d0), 0.4);
    // align the slab's local up-axis with the direction back toward the sun
    const up = new THREE.Vector3(40, 70, 25).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const grp = new THREE.Group();
    this.godRayShafts = [];
    const N = 7;
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: warm, transparent: true, opacity: rayI,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
      const w = 14 + Math.random() * 10, len = 95 + Math.random() * 30;
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(w, len), mat);
      shaft.quaternion.copy(quat);
      shaft.rotateY(Math.random() * Math.PI); // spin around the shaft so some always face the camera
      const ang = (i / N) * Math.PI * 2;
      shaft.position.set(WORLD / 2 + Math.cos(ang) * (28 + Math.random() * 60), 34,
                         WORLD / 2 + Math.sin(ang) * (28 + Math.random() * 60));
      shaft.renderOrder = 2;
      shaft.userData = { base: rayI, phase: Math.random() * Math.PI * 2, rate: 0.5 + Math.random() * 0.7, yaw: Math.random() * Math.PI };
      grp.add(shaft);
      this.godRayShafts.push(shaft);
    }
    this.scene.add(grp);
    this.godRays = grp;
  }

  // Slow soft-noise plane just above the ground that scrolls dark blotches over
  // the terrain — clouds passing overhead. Subtle, and skipped in dark moods.
  buildCloudShadows() {
    const P = this.preset;
    const strength = P.night ? 0.0 : P.lightning ? 0.34 : 0.2;
    if (strength <= 0) return;
    const tex = this._cloudTexture();
    tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.repeat.set(2.4, 2.4);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: strength, color: 0x0a0c12,
      depthWrite: false, fog: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 1.4, WORLD * 1.4), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(WORLD / 2, 6.5, WORLD / 2);
    plane.renderOrder = 1;
    this.scene.add(plane);
    this.cloudShadow = plane;
  }

  // Soft vertical gradient with feathered horizontal falloff for a light shaft.
  _shaftTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, 'rgba(255,255,255,0)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 256);
    // feather the left/right edges so the slab has no hard vertical seams
    const h = ctx.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.5, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = h; ctx.fillRect(0, 0, 64, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Tileable field of soft dark blobs — the silhouette of drifting clouds.
  _cloudTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    let seed = (this.map.seed ^ 0x5bd1e995) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 26; i++) {
      const x = rnd() * 256, y = rnd() * 256, r = 26 + rnd() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.35 + rnd() * 0.4;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  addShake(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  // themed particles where a worker is harvesting a node (chaff / chips / ore sparks)
  gatherFx(node) {
    if (this.map.fogStateAt(node.pos.x, node.pos.z) !== 2) return;
    node._gfx = (node._gfx || 0) - 0.016;
    if (node._gfx > 0) return;
    node._gfx = 0.22;
    const y = this.map.heightAt(node.pos.x, node.pos.z) + 0.8;
    const jx = (Math.random() - 0.5) * node.radius * 1.4, jz = (Math.random() - 0.5) * node.radius * 1.4;
    if (node.type === 'bronze') {
      this.fxSpark.spawn(node.pos.x + jx, y, node.pos.z + jz,
        (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 2, 0.45, 0.15, 1.0);
    } else {
      // grain chaff drifts up, timber chips arc out — both read as tan motes
      this.fxDust.spawn(node.pos.x + jx, y, node.pos.z + jz,
        (Math.random() - 0.5) * 1.5, (node.type === 'grain' ? 1.2 : 0.4) + Math.random(),
        (Math.random() - 0.5) * 1.5, 0.7, 0.32, 0.55, 2.0);
    }
  }

  // spawn a small dust kick at a unit's feet (only where the player can see it)
  dustAt(x, z, scale = 1) {
    if (this.map.fogStateAt(x, z) !== 2) return;
    const y = this.map.heightAt(x, z) + 0.15;
    this.fxDust.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.3, 0.55 * scale, 0.5, 2.4);
  }

  // weight behind every blow: a spark burst (bigger on hard / super-effective
  // hits) + a dust puff at the contact point, with a camera kick for heavy hits.
  hitImpact(attacker, target, dmg, countered) {
    if (this.map.fogStateAt(target.pos.x, target.pos.z) !== 2) return;
    const gy = this.map.heightAt(target.pos.x, target.pos.z);
    const dx = target.pos.x - attacker.pos.x, dz = target.pos.z - attacker.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const cx = target.pos.x - dx / len * target.radius * 0.6;   // contact: just inside the target
    const cz = target.pos.z - dz / len * target.radius * 0.6;
    const y = gy + 1.0 + target.radius * 0.3;
    const n = Math.min(12, 3 + (dmg / 5 | 0)) + (countered ? 4 : 0);
    for (let i = 0; i < n; i++) {
      this.fxSpark.spawn(cx, y, cz, (Math.random() - 0.5) * 4.5, 1 + Math.random() * 3.5,
        (Math.random() - 0.5) * 4.5, 0.16 + Math.random() * 0.16, 0.16 + Math.random() * 0.12, 0.9, 0.6);
    }
    this.fxDust.spawn(cx, y - 0.4, cz, (Math.random() - 0.5) * 1.4, 0.4 + Math.random() * 0.5,
      (Math.random() - 0.5) * 1.4, 0.45, 0.6, 0.5, 2.0);
    if (dmg >= 22) {
      const f = this.controls && this.controls.focus;
      if (f && Math.hypot(target.pos.x - f.x, target.pos.z - f.z) < 24) this.addShake(0.07);
    }
  }

  // ---------- active abilities ----------
  useAbility(unit) {
    const ab = unit.def.ability;
    if (!ab || unit.abilityCd > 0 || unit.dead) return false;
    unit.abilityCd = ab.cooldown;
    const gy = this.map.heightAt(unit.pos.x, unit.pos.z);
    const visible = this.map.fogStateAt(unit.pos.x, unit.pos.z) === 2;

    switch (ab.type) {
      case 'self_buff': {
        unit.abilityBuff = { ...ab.buff };
        unit.abilityActiveDur = ab.duration;
        if (visible) {
          for (let i = 0; i < 7; i++) {
            const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 0.8;
            this.fxSpark.spawn(unit.pos.x + Math.cos(a) * r, gy + 1.0, unit.pos.z + Math.sin(a) * r,
              (Math.random() - 0.5) * 2, 2 + Math.random() * 2, (Math.random() - 0.5) * 2,
              0.4, 0.13, 1.0);
          }
          Sound.abilityBuff();
        }
        break;
      }
      case 'target_debuff': {
        const t = unit.target || unit.acquireTarget(unit.def.aggroRange);
        if (!t) { unit.abilityCd = 0; return false; }
        t.abilityDebuffDur = ab.duration;
        t.abilityDebuffMult = ab.damageMult;
        if (this.map.fogStateAt(t.pos.x, t.pos.z) === 2) {
          const ty = this.map.heightAt(t.pos.x, t.pos.z);
          for (let i = 0; i < 5; i++) {
            const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 0.7;
            this.fxSpark.spawn(t.pos.x + Math.cos(a) * r, ty + 1.0, t.pos.z + Math.sin(a) * r,
              (Math.random() - 0.5), 1.5 + Math.random(), (Math.random() - 0.5),
              0.55, 0.10, 0.8);
          }
          Sound.abilityDebuff();
        }
        break;
      }
      case 'aoe_strike': {
        const rawDmg = unit.effDmg(unit.def.attack?.dmg || 10);
        const dmgBase = rawDmg * (ab.dmgMult || 1);
        const fxColor = unit.owner <= 1 ? this.players[unit.owner].faction.glow : 0xff7a4d;
        // World bosses TELEGRAPH their slam: a warning ring blooms on the ground and
        // the blow lands a beat later, so a sharp player can pull units out of it.
        // (Player/AI abilities still strike instantly to preserve PvP balance.)
        if (unit.owner === 2 && unit.def.boss) {
          this.telegraphAoe(unit, ab, dmgBase, fxColor);
          break;
        }
        this.addEffect(unit.pos.x, unit.pos.z, ab.radius, glowMat(fxColor, 2));
        if (visible) {
          for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2, r = ab.radius * (0.5 + Math.random() * 0.6);
            this.fxSpark.spawn(unit.pos.x + Math.cos(a) * r, gy + 0.6, unit.pos.z + Math.sin(a) * r,
              Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 0.5, 0.14, 1.0);
          }
          this.addShake(0.2);
          Sound.abilityAoe();
        }
        for (const e of this.allCombatants()) {
          if (e.dead || e.owner === unit.owner || (unit.owner !== 2 && e.owner === 2)) continue;
          if (unit.distTo(e) - e.radius <= ab.radius) {
            this.applyHit(unit, e, unit.def.attack || {}, dmgBase);
            if (ab.stunDur && e.isUnit) e.stunDur = Math.max(e.stunDur || 0, ab.stunDur);
          }
        }
        break;
      }
      case 'aoe_friendly': {
        const r = ab.radius || 8;
        for (const u of this.units) {
          if (u.dead || u.owner !== unit.owner) continue;
          if (unit.distTo(u) <= r) {
            u.abilityBuff = { ...ab.buff };
            u.abilityActiveDur = ab.duration;
          }
        }
        if (visible) {
          for (let i = 0; i < 10; i++) {
            const a = i / 10 * Math.PI * 2, fr = 1.5 + Math.random() * r * 0.4;
            this.fxSpark.spawn(unit.pos.x + Math.cos(a) * fr, gy + 1.0, unit.pos.z + Math.sin(a) * fr,
              Math.cos(a), 1.5 + Math.random(), Math.sin(a), 0.6, 0.11, 0.8);
          }
          Sound.abilityBuff();
        }
        break;
      }
      case 'multi_shot': {
        const range = (unit.def.attack?.range || 12) + 3;
        const enemies = [];
        for (const e of this.allCombatants()) {
          if (e.dead || e.owner === unit.owner) continue;
          if (unit.distTo(e) <= range) enemies.push(e);
        }
        enemies.sort((a, b) => unit.distTo(a) - unit.distTo(b));
        const atk = unit.def.attack;
        for (let i = 0; i < Math.min(ab.count || 3, enemies.length); i++) {
          this.performAttack(unit, enemies[i], atk);
        }
        if (visible) Sound.abilityAoe();
        break;
      }
    }
    return true;
  }

  useSelectedAbility() {
    for (const u of this.selection) if (u.isUnit && u.owner === 0 && !u.dead) this.useAbility(u);
  }

  // ---- dodgeable boss AoE telegraphs ----
  // Paint a danger zone on the ground that detonates after a wind-up. The impact
  // centre is FIXED where the boss stood, so micro'ing units out of the ring dodges
  // the blow — the heart of reading a boss fight.
  telegraphAoe(attacker, ab, dmgBase, fxColor) {
    const windup = ab.windup || 1.1;
    const x = attacker.pos.x, z = attacker.pos.z, r = ab.radius;
    const y = this.map.heightAt(x, z) + 0.12;
    const ringMat = new THREE.MeshBasicMaterial({ color: fxColor, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.84, r, 36), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, y, z);
    this.scene.add(ring);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 36),
      new THREE.MeshBasicMaterial({ color: fxColor, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, y, z);
    this.scene.add(disc);
    this.pendingTelegraphs.push({ attacker, ab, dmgBase, x, z, r, t: 0, dur: windup, ring, disc });
    if (this.map.fogStateAt(x, z) === 2) Sound.alert();
  }

  updateTelegraphs(dt) {
    if (!this.pendingTelegraphs.length) return;
    for (const tg of this.pendingTelegraphs) {
      tg.t += dt;
      const p = Math.min(1, tg.t / tg.dur);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 18);
      tg.disc.material.opacity = 0.08 + 0.20 * p;
      tg.ring.material.opacity = 0.30 + 0.55 * p * pulse;
      if (tg.t < tg.dur) continue;
      tg.done = true;
      this.scene.remove(tg.ring); this.scene.remove(tg.disc);
      const u = tg.attacker;
      const gy = this.map.heightAt(tg.x, tg.z);
      const visible = this.map.fogStateAt(tg.x, tg.z) === 2;
      this.addEffect(tg.x, tg.z, tg.r, glowMat(0xff7a4d, 2));
      if (visible) {
        for (let i = 0; i < 14; i++) {
          const a = i / 14 * Math.PI * 2, rr = tg.r * (0.5 + Math.random() * 0.6);
          this.fxSpark.spawn(tg.x + Math.cos(a) * rr, gy + 0.6, tg.z + Math.sin(a) * rr,
            Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 0.5, 0.14, 1.0);
        }
        this.addShake(0.25); Sound.abilityAoe();
      }
      // only what is STILL inside the marked zone is struck — step out to dodge
      for (const e of this.allCombatants()) {
        if (e.dead || e.owner === u.owner || (u.owner !== 2 && e.owner === 2)) continue;
        if (Math.hypot(e.pos.x - tg.x, e.pos.z - tg.z) - e.radius <= tg.r) {
          this.applyHit(u, e, u.def.attack || {}, tg.dmgBase);
          if (tg.ab.stunDur && e.isUnit) e.stunDur = Math.max(e.stunDur || 0, tg.ab.stunDur);
        }
      }
    }
    this.pendingTelegraphs = this.pendingTelegraphs.filter(t => !t.done);
  }

  updateEmbers(dt) {
    const a = this.embers.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + this.emberVel[i] * dt;
      let x = a.getX(i) + Math.sin(this.time * 0.7 + i) * dt * 0.6;
      if (y > 11) {
        // respawn at ground level, only over ground the player has seen
        for (let tries = 0; tries < 4; tries++) {
          const nx = Math.random() * WORLD, nz = Math.random() * WORLD;
          if (this.map.fogStateAt(nx, nz) >= 1) { x = nx; a.setZ(i, nz); break; }
        }
        y = this.map.heightAt(x, a.getZ(i)) + 0.5;
      }
      a.setX(i, x); a.setY(i, y);
    }
    a.needsUpdate = true;
  }

  // Faint dust motes drifting in the air near the camera — adds atmospheric depth
  // and catches the bloom. One draw call; recycled within a moving window so they're
  // always around the player's view. Purely cosmetic.
  buildDustMotes() {
    const M = 120;
    this.moteSpan = 64;
    const pos = new Float32Array(M * 3);
    this.moteVel = new Float32Array(M * 3);
    const c = WORLD / 2;
    for (let i = 0; i < M; i++) {
      pos[i * 3] = c + (Math.random() - 0.5) * this.moteSpan;
      pos[i * 3 + 1] = 0.5 + Math.random() * 15;
      pos[i * 3 + 2] = c + (Math.random() - 0.5) * this.moteSpan;
      this.moteVel[i * 3] = (Math.random() - 0.5) * 0.5;
      this.moteVel[i * 3 + 1] = (Math.random() - 0.35) * 0.22;
      this.moteVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const tint = new THREE.Color(this.preset.skyHorizon || '#cdbf9a').lerp(new THREE.Color(0xffffff), 0.25);
    this.dustMotes = new THREE.Points(geo, new THREE.PointsMaterial({
      color: tint, size: 0.11, sizeAttenuation: true, transparent: true,
      opacity: 0.30, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.dustMotes.frustumCulled = false;
    this.scene.add(this.dustMotes);
  }

  updateDustMotes(dt) {
    if (!this.dustMotes) return;
    const f = this.controls && this.controls.focus;
    if (!f) return;
    const a = this.dustMotes.geometry.attributes.position;
    const span = this.moteSpan, half = span / 2;
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i) + this.moteVel[i * 3] * dt + Math.sin(this.time * 0.5 + i) * dt * 0.12;
      let y = a.getY(i) + this.moteVel[i * 3 + 1] * dt;
      let z = a.getZ(i) + this.moteVel[i * 3 + 2] * dt;
      if (x < f.x - half) x += span; else if (x > f.x + half) x -= span;
      if (z < f.z - half) z += span; else if (z > f.z + half) z -= span;
      if (y < 0.4) y += 15; else if (y > 15.4) y -= 15;
      a.setX(i, x); a.setY(i, y); a.setZ(i, z);
    }
    a.needsUpdate = true;
  }

  spawnInitial() {
    // resource nodes
    for (const p of this.map.resourcePlan()) {
      const n = new ResourceNode(this, p.type, p.tx, p.ty);
      this.resources.push(n);
      if (p.guarded) {
        const mult = this.neutralMult();
        for (let i = 0; i < 2; i++) {
          const u = new Unit(this, 2, this.scaleNeutral(NEUTRALS.devourer, mult), 'devourer',
            n.pos.x + Math.cos(i * 2.5) * 4, n.pos.z + Math.sin(i * 2.5) * 4);
          u.leash = { x: u.pos.x, z: u.pos.z };
          this.units.push(u);
        }
      }
    }
    // bases
    for (const [owner, site] of [[0, this.map.basePlayer], [1, this.map.baseEnemy]]) {
      const p = this.players[owner];
      const mainKey = p.faction.main;
      const def = p.faction.buildings[mainKey];
      const b = new Building(this, owner, { ...def }, mainKey, site.x - def.size / 2 | 0, site.y - def.size / 2 | 0);
      b.complete = true; b.progress = 1; b.hp = b.maxHp; b.mesh.scale.y = 1;
      b.removeScaffold();
      this.buildings.push(b);
      if (owner === this.localPlayer) this.playerMain = b; else if (owner !== 2) this.enemyMain = b;
      // starting workers
      const wKey = p.faction.worker;
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        const u = this.spawnUnit(owner, wKey, b.pos.x + Math.cos(a) * (b.radius + 1.5), b.pos.z + Math.sin(a) * (b.radius + 1.5));
        // auto-gather nearest grain
        const grain = this.resources.filter(r => r.type === 'grain').sort((q, w) => u.distTo(q) - u.distTo(w))[0];
        if (grain) u.orderGather(grain);
      }
    }
    this.spawnMonsterLairs();
    this.recalcSupply();
    // Easter egg: a rare hidden encampment, deterministic per seed (also summonable
    // any match by typing the secret code, or via window.__game.spawnFieldsOfEvil()).
    if (this.map.seed % 100 < 18) this.spawnFieldsOfEvil(Math.floor(GRID * 0.5), Math.floor(GRID * 0.12));
  }

  // Neutral strength scalar from match difficulty — bosses and guardians hit
  // harder and last longer on Hard, softer on Easy.
  neutralMult() {
    return this.difficulty === 'easy' ? 0.85 : this.difficulty === 'hard' ? 1.25 : 1.0;
  }
  // Clone a neutral def with HP and attack damage scaled by `mult`.
  scaleNeutral(def, mult) {
    if (mult === 1) return def;
    const out = { ...def, hp: Math.round(def.hp * mult) };
    if (def.attack) out.attack = { ...def.attack, dmg: Math.round(def.attack.dmg * mult) };
    return out;
  }

  // World bosses: one monster lairs at each mid-field site, guarding a Forbidden
  // Knowledge obelisk. Felling the beast drops its bounty (see removeUnit). Bigger
  // maps generate more lairs; Hard difficulty makes each boss meaner.
  spawnMonsterLairs() {
    const sites = this.map.lairPlan();
    if (!sites.length) return;
    const mult = this.neutralMult();
    const keys = Object.keys(MONSTERS);
    let s = (this.map.seed ^ 0x77a5b3c1) >>> 0;
    const rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    this.lairs = [];
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      // a rich obelisk at the heart of the lair (the boss guards it)
      const node = new ResourceNode(this, 'knowledge', site.tx, site.ty);
      this.resources.push(node);
      const key = keys[Math.floor(rng() * keys.length)];
      const def = MONSTERS[key];
      // boss stands a couple of tiles off the obelisk (the lair was cleared with margin 2)
      const w = findNearestWalkable(this.map, site.tx + 2, site.ty, 4, 1) || { x: site.tx + 2, y: site.ty };
      const bx = (w.x + 0.5) * TILE, bz = (w.y + 0.5) * TILE;
      const u = new Unit(this, 2, this.scaleNeutral(def, mult), key, bx, bz);
      u.leash = { x: node.pos.x, z: node.pos.z };
      this.units.push(u);
      this.lairs.push({ x: node.pos.x, z: node.pos.z, boss: u });
    }
  }

  // The Fields of Evil: the House of Greene ringed by feuding Landonian & Boydonian
  // clans, all hostile to everyone. Razing the House drops a knowledge trove.
  spawnFieldsOfEvil(tx, ty) {
    if (this.fieldsOfEvil) return false;
    const w = findNearestWalkable(this.map, tx, ty, 16, 1);
    if (!w) return false;
    const def = NEUTRAL_BUILDING_DEFS.house_of_greene, size = def.size;
    if (!this.map.isWalkableClear(w.x, w.y, 1)) { /* still try */ }
    const b = new Building(this, 2, { ...def }, 'house_of_greene', w.x - (size / 2 | 0), w.y - (size / 2 | 0));
    b.complete = true; b.progress = 1; b.hp = b.maxHp; b.mesh.scale.y = 1; b.removeScaffold();
    this.buildings.push(b);
    const roster = ['landonian', 'boydonian', 'landonian', 'parker', 'boydonian', 'landonian', 'boydonian', 'warwagon'];
    for (let i = 0; i < roster.length; i++) {
      const a = i / roster.length * Math.PI * 2, key = roster[i];
      const ring = key === 'warwagon' ? b.radius + 4.5 : b.radius + 3;
      const ux = b.pos.x + Math.cos(a) * ring, uz = b.pos.z + Math.sin(a) * ring;
      const d = NEUTRAL_UNIT_DEFS[key];
      const u = new Unit(this, 2, { ...d, hp: d.hp }, key, ux, uz);
      u.leash = { x: ux, z: uz };
      this.units.push(u);
    }
    // The hounds — Tucker and Gatsby lounge close to the house entrance
    for (const [key, angle] of [['tucker', 0.4], ['gatsby', -0.4]]) {
      const ring = b.radius + 1.4;
      const ux = b.pos.x + Math.cos(angle) * ring, uz = b.pos.z + Math.sin(angle) * ring;
      const d = NEUTRAL_UNIT_DEFS[key];
      const u = new Unit(this, 2, { ...d, hp: d.hp }, key, ux, uz);
      u.leash = { x: ux, z: uz };
      this.units.push(u);
    }
    this._combat = null;
    this.recalcSupply();
    this.fieldsOfEvil = { x: b.pos.x, z: b.pos.z, seen: false };
    return true;
  }

  defFor(owner, kind, key) {
    if (owner === 2) return kind === 'building' ? NEUTRAL_BUILDING_DEFS[key] : NEUTRAL_UNIT_DEFS[key];
    const f = this.players[owner].faction;
    return kind === 'building' ? f.buildings[key] : f.units[key];
  }

  // ---------- save / load ----------
  serialize() {
    let fogStr = '';
    for (let i = 0; i < this.map.fog.length; i++) fogStr += String.fromCharCode(this.map.fog[i]);
    return {
      v: 1, t: this.time, timeOfDay: this.timeOfDay, biomeKey: this.biomeKey, seed: this.map.seed,
      difficulty: this.difficulty, mapSize: this.mapSizeKey,
      pf: this.pfKey, ef: this.efKey,
      players: [0, 1].map(o => { const p = this.players[o]; return {
        res: { ...p.resources }, up: [...p.upgrades], dmgMult: p.dmgMult, armorAdd: p.armorAdd, hpMult: p.hpMult }; }),
      units: this.units.filter(u => !u.dead).map(u => ({ o: u.owner, k: u.key,
        x: +u.pos.x.toFixed(2), z: +u.pos.z.toFixed(2), hp: Math.round(u.hp),
        cy: u.carry || 0, ct: u.carryType || null, leash: u.leash || null,
        st: u.stance !== 'aggressive' ? u.stance : undefined })),
      buildings: this.buildings.filter(b => !b.dead).map(b => ({ o: b.owner, k: b.key, tx: b.tx, ty: b.ty,
        hp: Math.round(b.hp), c: b.complete, p: +(b.progress || 0).toFixed(3),
        q: b.trainQueue.map(j => ({ key: j.key, t: +j.t.toFixed(2), total: j.total, up: !!j.upgrade })),
        rally: b.rally ? { x: +b.rally.x.toFixed(1), z: +b.rally.z.toFixed(1) } : null })),
      resources: this.resources.filter(n => n.amount > 0).map(n => ({ t: n.type, tx: n.tx, ty: n.ty, amount: Math.round(n.amount) })),
      fog: btoa(fogStr),
      foe: this.fieldsOfEvil ? { x: this.fieldsOfEvil.x, z: this.fieldsOfEvil.z, seen: this.fieldsOfEvil.seen } : null,
      met: this.metClans,
      ai: this.ai ? { buildIndex: this.ai.buildIndex, wave: this.ai.wave, nextWaveTime: this.ai.nextWaveTime, workerTarget: this.ai.workerTarget } : null,
    };
  }

  deserialize(d) {
    this.time = d.t || 0;
    (d.players || []).forEach((ps, o) => { const p = this.players[o];
      p.resources = { ...ps.res }; p.upgrades = new Set(ps.up || []);
      p.dmgMult = ps.dmgMult ?? 1; p.armorAdd = ps.armorAdd ?? 0; p.hpMult = ps.hpMult ?? 1; });
    for (const r of d.resources || []) { const n = new ResourceNode(this, r.t, r.tx, r.ty); n.amount = r.amount; this.resources.push(n); }
    for (const bs of d.buildings || []) {
      const def = this.defFor(bs.o, 'building', bs.k); if (!def) continue;
      const b = new Building(this, bs.o, { ...def }, bs.k, bs.tx, bs.ty);
      if (bs.c) { b.complete = true; b.progress = 1; b.mesh.scale.y = 1; b.removeScaffold(); }
      else { b.progress = bs.p || 0; b.mesh.scale.y = 0.08 + 0.92 * Math.min(1, b.progress); }
      b.hp = Math.min(b.maxHp, bs.hp);
      b.trainQueue = (bs.q || []).map(j => ({ key: j.key, t: j.t, total: j.total, upgrade: j.up }));
      b.rally = bs.rally || null;
      this.buildings.push(b);
      if (def.main) { if (bs.o === this.localPlayer) this.playerMain = b; else if (bs.o !== 2) this.enemyMain = b; }
    }
    for (const us of d.units || []) {
      const def = this.defFor(us.o, 'unit', us.k); if (!def) continue;
      const hpMult = this.players[us.o]?.hpMult || 1;   // honor researched HP upgrades
      const u = new Unit(this, us.o, { ...def, hp: Math.round(def.hp * hpMult) }, us.k, us.x, us.z);
      u.hp = Math.min(u.maxHp, us.hp);
      u.leash = us.leash || null;
      if (us.st) u.setStance(us.st);
      if (us.cy) { u.carry = us.cy; u.carryType = us.ct; }
      this.units.push(u);
    }
    this._combat = null;
    this.recalcSupply();
    // re-task: workers resume gathering / return their load; soldiers idle (re-aggro naturally)
    for (const u of this.units) {
      if (u.owner > 1 || !u.def.worker) continue;
      if (u.carry > 0) u.state = 'return';
      else { const n = this.resources.filter(r => r.amount > 0).sort((a, b) => u.distTo(a) - u.distTo(b))[0]; if (n) u.orderGather(n); }
    }
    if (d.fog) { const raw = atob(d.fog); for (let i = 0; i < this.map.fog.length && i < raw.length; i++) this.map.fog[i] = raw.charCodeAt(i); }
    if (d.foe) this.fieldsOfEvil = { ...d.foe };
    this.metClans = d.met || {};
    this._aiState = d.ai || null;   // applied by main.js after the AI is created
  }

  spawnUnit(owner, key, x, z) {
    const p = this.players[owner];
    const def = p.faction.units[key];
    const eff = { ...def, hp: Math.round(def.hp * p.hpMult) };
    const u = new Unit(this, owner, eff, key, x, z);
    if (owner === 0) this.stats.trained++;
    this.units.push(u);
    this.recalcSupply();
    return u;
  }

  // ---------- macro: active economy ability ----------
  // How many of an owner's laborers are currently working a given node — drives
  // worker-saturation diminishing returns.
  gatherersOn(node) {
    let c = 0;
    for (const u of this.units) if (!u.dead && u.gatherNode === node) c++;
    return c;
  }
  // "Marshal the Stores": instant soft-resource burst + a timed gather surge, on a
  // cooldown. Returns false (and stays silent) if still cooling down. Deterministic.
  marshalStores(owner) {
    const p = this.players[owner];
    if (!p || p.empowerCd > 0) return false;
    p.empowerCd = EMPOWER.cooldown;
    p.gatherBoostT = Math.max(p.gatherBoostT, EMPOWER.boostDur);
    for (const [k, v] of Object.entries(EMPOWER.burst)) p.resources[k] = (p.resources[k] || 0) + v;
    if (owner === 0) {
      Sound.upgrade();
      this.emit('toast', '⛟ The stores are marshalled — granaries fill and the laborers quicken.');
      const m = this.playerMain;
      if (m) this.addEffect(m.pos.x, m.pos.z, m.radius + 3, glowMat(this.players[0].faction.glow, 2));
    }
    return true;
  }

  // ---------- player command bus (recorded for replays) ----------
  // EVERY sim-mutating player action funnels through cmd(): it logs a serialized
  // form (entities → stable ids) then executes live with the real refs. The AI calls
  // the raw methods directly and is never logged — it re-runs deterministically from
  // the seeded RNG + recorded player inputs. During playback cmd() is inert; the
  // Replay driver calls runCmd() with rehydrated refs instead.
  cmd(name, refs) {
    if (this.replayMode) return null;
    // Networked match: don't run the command now — hand it to the lockstep session,
    // which schedules it to execute on a future turn simultaneously on every client.
    if (this.net) { this.net.submit({ n: name, p: serCmd(name, refs) }); return null; }
    if (this.rec) this.rec.pending.push({ n: name, p: serCmd(name, refs) });
    return this.runCmd(name, refs);
  }

  // Apply a command that arrived over the network (already serialized), resolving its
  // entity ids against the live sim. Builds the id map lazily per turn via the caller.
  applyNetCommand(rec, idMap) { this.dispatchRecorded(rec, idMap); }
  // Execute a command with live entity references. Shared by live play and playback.
  runCmd(name, p) {
    switch (name) {
      case 'right':     return this.commandRightClick(p.sel, p.x, p.z, p.ent, p.q);
      case 'formation': return this.formationMove(p.sel, p.x, p.z, p.am, p.q);
      case 'patrol':    return this.commandPatrol(p.sel, p.x, p.z, p.q);
      case 'stop':      for (const u of p.sel) u.stop(); return;
      case 'stance':    for (const u of p.sel) u.setStance(p.s); return;
      case 'ability':   return p.u ? this.useAbility(p.u) : null;
      case 'train':     return p.b ? this.queueTrain(p.b, p.key) : null;
      case 'upgrade':   return p.b ? this.queueUpgrade(p.b, p.key) : null;
      case 'build':     return this.placeBuilding(p.o, p.key, p.tx, p.ty, p.w);
      case 'empower':   return this.marshalStores(p.o);
    }
  }
  // Rehydrate a logged command's ids back into live entities, then run it (playback).
  dispatchRecorded(rec, idMap) { this.runCmd(rec.n, deserCmd(rec.n, rec.p, idMap)); }

  // Deterministic state fingerprint — order-independent, integer-only — used to
  // verify a replay is tracking the original simulation frame-for-frame.
  checksum() {
    let h = 0x811c9dc5 >>> 0;
    const mix = (e) => {
      let v = (Math.imul(e.id, 2654435761) ^ (Math.round(e.hp) | 0) ^
        (Math.round(e.pos.x * 4) << 3) ^ (Math.round(e.pos.z * 4) << 11)) >>> 0;
      h = (h ^ v) >>> 0; h = Math.imul(h, 16777619) >>> 0;
    };
    for (const u of this.units) if (!u.dead) mix(u);
    for (const b of this.buildings) if (!b.dead) mix(b);
    return h >>> 0;
  }

  // Snapshot the recording for download. Frames are already compact; JSON-friendly.
  exportReplay() {
    if (!this.rec) return null;
    return { v: this.rec.v, app: 'sotw', header: this.rec.header, frames: this.rec.frames };
  }

  // ---------- queries ----------
  allCombatants() { return this._combat || (this._combat = [...this.units, ...this.buildings]); }
  unitsNear(pos, r, exclude) {
    const out = [];
    for (const u of this.units) {
      if (u === exclude || u.dead) continue;
      if (Math.abs(u.pos.x - pos.x) > r || Math.abs(u.pos.z - pos.z) > r) continue;
      out.push(u);
    }
    return out;
  }
  nearestDropoff(owner, pos) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.complete || b.dead || !b.def.dropoff) continue;
      const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  playerViewers() {
    const lp = this.localPlayer;
    return [...this.units.filter(u => u.owner === lp), ...this.buildings.filter(b => b.owner === lp)]
      .map(e => ({ pos: e.pos, sight: e.def.sight }));
  }

  // ---------- economy / production ----------
  canAfford(owner, cost) {
    const r = this.players[owner].resources;
    return Object.entries(cost || {}).every(([k, v]) => (r[k] || 0) >= v);
  }
  pay(owner, cost) {
    const r = this.players[owner].resources;
    for (const [k, v] of Object.entries(cost || {})) r[k] -= v;
  }
  refund(owner, cost) {
    const r = this.players[owner].resources;
    for (const [k, v] of Object.entries(cost || {})) r[k] += v;
  }
  recalcSupply() {
    for (const owner of [0, 1]) {
      const p = this.players[owner];
      p.supplyUsed = this.units.filter(u => u.owner === owner && !u.dead).reduce((s, u) => s + (u.def.supply || 1), 0);
      p.supplyCap = Math.min(SUPPLY_CAP, this.buildings.filter(b => b.owner === owner && b.complete && !b.dead)
        .reduce((s, b) => s + (b.def.supplyProvided || 0), 0));
    }
  }

  hasBuilding(owner, key) {
    return this.buildings.some(b => b.owner === owner && b.key === key && b.complete && !b.dead);
  }
  unitAvailable(owner, key) {
    const def = this.players[owner].faction.units[key];
    return !def.requires || this.hasBuilding(owner, def.requires);
  }
  buildingAvailable(owner, key) {
    const def = this.players[owner].faction.buildings[key];
    return !def.requires || this.hasBuilding(owner, def.requires);
  }

  queueTrain(building, key) {
    const p = this.players[building.owner];
    const def = p.faction.units[key];
    if (!def || building.trainQueue.length >= 5) return false;
    if (!this.unitAvailable(building.owner, key)) return false;
    if (p.supplyUsed + this.queuedSupply(building.owner) + (def.supply || 1) > p.supplyCap) {
      if (building.owner === 0) this.emit('toast', 'Not enough housing — build more supply structures');
      return false;
    }
    if (!this.canAfford(building.owner, def.cost)) {
      if (building.owner === 0) this.emit('toast', 'Not enough resources');
      return false;
    }
    this.pay(building.owner, def.cost);
    building.trainQueue.push({ key, t: 0, total: def.buildTime, cost: def.cost });
    return true;
  }
  queuedSupply(owner) {
    return this.buildings.filter(b => b.owner === owner)
      .reduce((s, b) => s + b.trainQueue.filter(j => !j.upgrade).reduce((q, j) => q + (this.players[owner].faction.units[j.key]?.supply || 1), 0), 0);
  }
  queueUpgrade(building, key) {
    const up = UPGRADES[key];
    const p = this.players[building.owner];
    if (!up || p.upgrades.has(key) || building.trainQueue.some(j => j.key === key)) return false;
    if (!this.canAfford(building.owner, up.cost)) {
      if (building.owner === 0) this.emit('toast', 'Not enough resources');
      return false;
    }
    this.pay(building.owner, up.cost);
    building.trainQueue.push({ key, t: 0, total: up.time, upgrade: true, cost: up.cost });
    return true;
  }
  finishUpgrade(owner, key) {
    const p = this.players[owner];
    p.upgrades.add(key);
    const e = UPGRADES[key].effect;
    if (e.dmgMult) p.dmgMult *= e.dmgMult;
    if (e.armorAdd) p.armorAdd += e.armorAdd;
    if (e.hpMult) {
      p.hpMult *= e.hpMult;
      for (const u of this.units) if (u.owner === owner) {
        const frac = u.hp / u.maxHp;
        u.maxHp = Math.round(u.maxHp * e.hpMult); u.hp = Math.round(u.maxHp * frac);
      }
    }
    if (owner === 0) { Sound.upgrade(); this.emit('toast', UPGRADES[key].name + ' complete'); }
  }

  spawnTrained(building, key) {
    // spawn at building edge toward rally (or south)
    const rally = building.rally || { x: building.pos.x, z: building.pos.z + building.radius + 4 };
    const dx = rally.x - building.pos.x, dz = rally.z - building.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const sx = building.pos.x + (dx / d) * (building.radius + 1.2);
    const sz = building.pos.z + (dz / d) * (building.radius + 1.2);
    const u = this.spawnUnit(building.owner, key, sx, sz);
    if (building.rally) {
      if (building.rallyNode) u.orderGather(building.rallyNode);
      else u.orderMove(rally.x, rally.z);
    }
    if (building.owner === 0) Sound.trained();
    return u;
  }

  // ---------- building placement ----------
  // checkFog is an input-layer affordance only (don't let the player place into
  // unexplored ground). It must NOT gate the actual placement: fog is per-client, so
  // a fog test inside the simulation would let clients diverge. placeBuilding calls
  // this WITHOUT checkFog; only the placement ghost passes it.
  canPlace(owner, key, tx, ty, checkFog = false) {
    const def = this.players[owner].faction.buildings[key];
    if (!def) return false;
    for (let y = 0; y < def.size; y++) for (let x = 0; x < def.size; x++) {
      if (!this.map.inBounds(tx + x, ty + y)) return false;
      if (this.map.blocked[this.map.idx(tx + x, ty + y)]) return false;
      if (checkFog && this.map.fog[this.map.idx(tx + x, ty + y)] === 0) return false;
    }
    // keep clear of units
    const cx = (tx + def.size / 2) * TILE, cz = (ty + def.size / 2) * TILE;
    const rr = def.size * TILE * 0.5 + 0.5;
    for (const u of this.units) {
      if (Math.hypot(u.pos.x - cx, u.pos.z - cz) < rr) return false;
    }
    // slope check: footprint must be reasonably flat
    let hMin = Infinity, hMax = -Infinity;
    for (let y = 0; y <= def.size; y++) for (let x = 0; x <= def.size; x++) {
      const h = this.map.heightAt((tx + x) * TILE, (ty + y) * TILE);
      hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
    }
    return (hMax - hMin) < 1.6;
  }

  placeBuilding(owner, key, tx, ty, workers = []) {
    const def = this.players[owner].faction.buildings[key];
    if (!this.canPlace(owner, key, tx, ty)) return null;
    if (!this.buildingAvailable(owner, key)) return null;
    if (!this.canAfford(owner, def.cost)) {
      if (owner === 0) this.emit('toast', 'Not enough resources');
      return null;
    }
    this.pay(owner, def.cost);
    const b = new Building(this, owner, { ...def }, key, tx, ty);
    this.buildings.push(b);
    this._combat = null;
    for (const w of workers) w.orderBuild(b);
    if (owner === 0) Sound.place();
    return b;
  }

  onBuildingComplete(b) {
    this.recalcSupply();
    if (b.owner === 0) this.emit('toast', b.def.name + ' complete');
    // builders go idle next to it
    for (const u of this.units) if (u.buildSite === b) u.stop();
    this.dressBuilding(b);
  }

  // Scatter a couple of themed props just outside a finished building so settlements
  // read as lived-in: sacks at granaries, weapon racks at war buildings, braziers at
  // temples, banners at the seat of power. Decorative scene objects (not children, so
  // construction scaling never touches them); removed when the building falls.
  dressBuilding(b) {
    if (b.owner > 1) return;
    const types = b.def.main ? ['banner', 'amphorae', 'brazier']
      : /granary|store/.test(b.key) ? ['grain_sacks', 'amphorae', 'wood_pile']
      : /barrack|lodge|foundry|forge|gate|pit|den/.test(b.key) ? ['weapon_rack', 'banner']
      : /temple|totem|archive|tower|cairn|spire|hearth/.test(b.key) ? ['brazier', 'banner']
      : ['amphorae'];
    const n = 1 + (Math.random() < 0.6 ? 1 : 0);
    b.props = b.props || [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = b.radius + 0.7 + Math.random() * 0.6;
      const wx = b.pos.x + Math.cos(a) * r, wz = b.pos.z + Math.sin(a) * r;
      const t = this.map.tileOf(wx, wz);
      if (!this.map.inBounds(t.x, t.y) || this.map.blocked[this.map.idx(t.x, t.y)]) continue;
      const d = buildDoodad(types[(Math.random() * types.length) | 0]);
      d.position.set(wx, this.map.heightAt(wx, wz), wz);
      d.rotation.y = Math.random() * Math.PI * 2;
      d.scale.setScalar(0.7);
      this.scene.add(d);
      b.props.push(d);
    }
  }

  // ---------- combat ----------
  performAttack(attacker, target, atk) {
    // consume a firstHit buff before computing damage (effDmg already applies dmgMult)
    const firstHit = attacker.isUnit && attacker.abilityBuff?.firstHit;
    const stunToApply = firstHit ? (attacker.abilityBuff.stunDur || 0) : 0;
    const dmgBase = attacker.isUnit ? attacker.effDmg(atk.dmg) : atk.dmg;
    if (firstHit) { attacker.abilityBuff = null; attacker.abilityActiveDur = 0; }
    if (atk.projectile) {
      this.spawnProjectile(attacker, target, atk, dmgBase);
      if (stunToApply && target.isUnit) target.stunDur = Math.max(target.stunDur || 0, stunToApply);
    } else {
      this.applyHit(attacker, target, atk, dmgBase);
      if (stunToApply && target.isUnit) target.stunDur = Math.max(target.stunDur || 0, stunToApply);
      if (this.map.fogStateAt(target.pos.x, target.pos.z) === 2) Sound.meleeHit(dmgBase);
    }
  }

  applyHit(attacker, target, atk, dmgBase) {
    const mult = (target.def.tags || []).reduce((m, tag) => m * (atk.bonus?.[tag] || 1), 1);
    const armor = target.isUnit ? target.effArmor() : (target.def.armor || 0);
    let dmg = Math.max(1, Math.round(dmgBase * mult) - armor);
    if (target.isUnit && target.abilityDebuffDur > 0) dmg = Math.ceil(dmg * target.abilityDebuffMult);
    target.takeDamage(dmg, attacker);
    this.hitImpact(attacker, target, dmg, mult > 1.05);
  }

  spawnProjectile(attacker, target, atk, dmgBase) {
    const colors = { stone: 0xb8a888, sigil: 0xc08bff, holyfire: 0xffd56e, ember: 0xff7a4d, skyfire: 0xb07fff, rock: 0x99908a };
    const size = atk.aoe ? 0.3 : 0.16;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 6, 5), glowMat(colors[atk.projectile] || 0xffffff, 2));
    const y = this.map.heightAt(attacker.pos.x, attacker.pos.z) + 1.4;
    mesh.position.set(attacker.pos.x, y, attacker.pos.z);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh, target, atk, dmgBase, attacker,
      from: new THREE.Vector3(attacker.pos.x, y, attacker.pos.z),
      to: target.pos.clone(),
      t: 0,
      dur: Math.max(0.25, attacker.distTo(target) / 28),
      arc: atk.projectile === 'skyfire' || atk.projectile === 'rock' || atk.projectile === 'stone' ? 4 : 1.2,
    });
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      p.t += dt / p.dur;
      if (!p.target.dead) p.to.copy(p.target.pos);
      const t = Math.min(1, p.t);
      p.mesh.position.lerpVectors(p.from, new THREE.Vector3(p.to.x, this.map.heightAt(p.to.x, p.to.z) + 0.8, p.to.z), t);
      p.mesh.position.y += Math.sin(t * Math.PI) * p.arc;
      p.mesh.visible = this.map.fogStateAt(p.mesh.position.x, p.mesh.position.z) === 2;
      // fading trail puffs
      p.trailT = (p.trailT || 0) - dt;
      if (p.trailT <= 0 && p.mesh.visible && p.t < 1) {
        p.trailT = 0.045;
        const m = new THREE.Mesh(p.mesh.geometry, p.mesh.material);
        m.position.copy(p.mesh.position);
        m.scale.setScalar(0.7);
        this.scene.add(m);
        this.effects.push({ mesh: m, life: 0.28, max: 0.28, type: 'shrink' });
      }
      if (p.t >= 1) {
        p.done = true;
        this.scene.remove(p.mesh);
        const visible = this.map.fogStateAt(p.to.x, p.to.z) === 2;
        if (p.atk.aoe) {
          this.addEffect(p.to.x, p.to.z, p.atk.aoe, p.mesh.material);
          for (const e of this.allCombatants()) {
            if (e.dead || e.owner === p.attacker.owner) continue;
            if (Math.hypot(e.pos.x - p.to.x, e.pos.z - p.to.z) <= p.atk.aoe + e.radius) {
              this.applyHit(p.attacker, e, p.atk, p.dmgBase);
            }
          }
          if (visible) Sound.rangedHit();
        } else if (!p.target.dead) {
          this.applyHit(p.attacker, p.target, p.atk, p.dmgBase);
          if (visible) Sound.rangedHit();
        }
      }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);
  }

  addEffect(x, z, r, material) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(r * 0.3, r, 18), material.clone());
    mesh.material.transparent = true; mesh.material.side = THREE.DoubleSide;
    mesh.material.emissiveIntensity = Math.min(1.1, mesh.material.emissiveIntensity || 1.1);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.map.heightAt(x, z) + 0.15, z);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.45, max: 0.45, type: 'ring' });
  }

  onDamaged(entity, attacker) {
    this.combatHeat = Math.min(1, this.combatHeat + 0.05);   // feeds the combat music layer
    if (entity.owner === this.localPlayer && (this.time - (this.lastAlert || -99)) > 12) {
      const anySelectedNear = false;
      if (this.map.fogStateAt(entity.pos.x, entity.pos.z) !== 2 || entity.isBuilding) {
        this.lastAlert = this.time;
        this.lastAlertPos = { x: entity.pos.x, z: entity.pos.z };   // Space jumps here
        Sound.alert();
        this.emit('toast', '⚔ Your forces are under attack! (Space to view)');
        this.emit('ping', entity.pos.x, entity.pos.z);
      }
    }
    // worker flee / fight back
    if (entity.isUnit && attacker) {
      if (entity.def.peaceful) {
        // even shepherds defend the fold — retaliate from the amble, once struck
        if (entity.state !== 'attack') entity.orderAttack(attacker);
      } else if (entity.state === 'idle') {
        if (entity.def.worker) {
          entity.orderMove(entity.pos.x + (entity.pos.x - attacker.pos.x), entity.pos.z + (entity.pos.z - attacker.pos.z));
        } else if (!entity.target) {
          // hold stands its ground — it fires back only if the attacker is in range,
          // never chasing (the idle scan picks it up if it closes in)
          if (entity.stance === 'hold' && entity.distTo(attacker) > entity.attackRange(attacker)) { /* hold */ }
          else entity.orderAttack(attacker);
        }
      }
    }
    // gathering workers near attacker also keep working (classic RTS)
    this.emit('damaged', entity, attacker);
  }

  removeUnit(u, attacker) {
    // felling a world boss: pay out its bounty to the killer and mark the kill
    if (u.def.bounty) this.onBossSlain(u, attacker);
    // death animation: topple + sink, plus a burst of debris
    u.mesh.scale.setScalar(1);   // clear any mid-flash scale-pop before the corpse falls
    this.effects.push({ mesh: u.mesh, life: 1.0, max: 1.0, type: 'corpse' });
    if (this.map.fogStateAt(u.pos.x, u.pos.z) === 2) {
      const h = this.map.heightAt(u.pos.x, u.pos.z);
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(this.debrisGeo ||= new THREE.BoxGeometry(0.16, 0.16, 0.16), u.mesh.children[0]?.material);
        m.position.set(u.pos.x, h + 0.8, u.pos.z);
        this.scene.add(m);
        this.effects.push({
          mesh: m, life: 0.8, max: 0.8, type: 'debris',
          vel: new THREE.Vector3((Math.random() - 0.5) * 6, 2.5 + Math.random() * 3, (Math.random() - 0.5) * 6),
          spin: Math.random() * 10,
        });
      }
    }
    this.units = this.units.filter(x => x !== u);
    this.selection = this.selection.filter(x => x !== u);
    this._combat = null;
    this.recalcSupply();
    this.emit('selection');
  }

  // Reward + spectacle when a world boss falls: pay the bounty to its slayer,
  // shake the earth, and announce it. Killer defaults to the player if a neutral
  // or environment landed the blow.
  onBossSlain(boss, attacker) {
    const owner = attacker && attacker.owner <= 1 ? attacker.owner : 0;
    const r = this.players[owner].resources;
    for (const [k, v] of Object.entries(boss.def.bounty)) r[k] = (r[k] || 0) + v;
    const visible = this.map.fogStateAt(boss.pos.x, boss.pos.z) === 2;
    if (visible) {
      const gy = this.map.heightAt(boss.pos.x, boss.pos.z);
      this.addEffect(boss.pos.x, boss.pos.z, boss.radius * 3.2, glowMat(0xffd56e, 2));
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2, rr = Math.random() * boss.radius * 2.4;
        this.fxSpark.spawn(boss.pos.x + Math.cos(a) * rr, gy + 0.8 + Math.random() * 1.5, boss.pos.z + Math.sin(a) * rr,
          Math.cos(a) * 3, 1.5 + Math.random() * 3, Math.sin(a) * 3, 0.7, 0.18, 1.0);
      }
      this.addShake(0.7);
    }
    if (owner === 0) {
      Sound.win();
      const spoils = Object.entries(boss.def.bounty).map(([k, v]) => `${v} ${k}`).join(', ');
      this.emit('toast', `☠ ${boss.def.name} is slain! Its hoard — ${spoils} — is yours.`);
    }
  }

  removeBuilding(b, attacker) {
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++)
      this.map.blocked[this.map.idx(b.tx + x, b.ty + y)] = 0;
    if (b.props) { for (const p of b.props) this.scene.remove(p); b.props = null; }
    if (b.disc) this.scene.remove(b.disc);
    this.addEffect(b.pos.x, b.pos.z, b.radius * 1.4, glowMat(0xff5522, 1.5));
    this.effects.push({ mesh: b.mesh, life: 1.4, max: 1.4, type: 'rubble' });
    // collapse: billowing dust + smoke and a ground shake felt near the camera
    if (this.map.fogStateAt(b.pos.x, b.pos.z) === 2) {
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * b.radius;
        this.fxSmoke.spawn(b.pos.x + Math.cos(a) * r, b.groundY + Math.random() * b.size,
          b.pos.z + Math.sin(a) * r, Math.cos(a) * 2, 0.6 + Math.random() * 1.5, Math.sin(a) * 2,
          2.5 + Math.random() * 1.5, 1.6 + Math.random(), 0.95, 2.8);
        this.dustAt(b.pos.x + Math.cos(a) * r, b.pos.z + Math.sin(a) * r, 2.5);
      }
      const f = this.controls && this.controls.focus;
      if (f && Math.hypot(b.pos.x - f.x, b.pos.z - f.z) < 40) this.addShake(0.6);
    }
    this.buildings = this.buildings.filter(x => x !== b);
    this.selection = this.selection.filter(x => x !== b);
    this._combat = null;
    this.recalcSupply();
    this.emit('selection');
    // Easter egg: razing the House of Greene spills a trove of forbidden knowledge
    if (b.key === 'house_of_greene') {
      const owner = attacker && attacker.owner <= 1 ? attacker.owner : 0;
      const r = this.players[owner].resources;
      for (const [k, v] of Object.entries(FIELDS_OF_EVIL.reward)) r[k] = (r[k] || 0) + v;
      if (owner === 0) { Sound.win(); this.emit('toast', '☩ The House of Greene has fallen. Their hoard of forbidden knowledge is yours.'); }
    }
    if (!this.over) {
      if (b === this.playerMain) this.endGame(1, b.pos);
      else if (b === this.enemyMain) this.endGame(0, b.pos);
    }
  }

  depleteNode(n) {
    this.map.blocked[this.map.idx(n.tx, n.ty)] = 0;
    this.scene.remove(n.mesh);
    this.resources = this.resources.filter(x => x !== n);
  }

  endGame(winner, focusPos) {
    this.over = true;
    this.winner = winner;
    if (focusPos) this.endFocus = { x: focusPos.x, z: focusPos.z };
    // defeat foreshadows the Flood: deepen the fog and darken toward the storm
    if (winner === 1 && this.scene.fog) {
      this.defeatFade = 0;
      this.scene.fog.density = Math.max(this.scene.fog.density, 0.006);
    }
    if (winner === 0) Sound.win(); else Sound.lose();
    this.emit('gameover', winner);
  }

  // ---------- commands from UI ----------
  // `targets` are the commanding player's own entities (the input layer filters the
  // selection to the local seat; a net-applied command's ids resolve to the issuer's
  // units). The commander is derived from them so this is owner-agnostic — the same
  // path serves the local player and a remote player's relayed command. Only the
  // local seat's commands click.
  commandRightClick(targets, wx, wz, entity, queue = false) {
    const units = targets.filter(t => t.isUnit);
    const buildings = targets.filter(t => t.isBuilding);
    const cmdr = units[0]?.owner ?? buildings[0]?.owner;
    for (const b of buildings) {
      b.rally = { x: wx, z: wz };
      b.rallyNode = entity && entity.isResource ? entity : null;
    }
    if (!units.length) return;
    if (cmdr === this.localPlayer) Sound.command();
    if (entity && entity.isResource) {
      for (const u of units) u.command(u.def.worker ? { type: 'gather', node: entity, x: wx, z: wz } : { type: 'move', x: wx, z: wz }, queue);
      return;
    }
    if (entity && !entity.dead && entity.owner !== cmdr && !entity.isResource) {
      for (const u of units) u.command(u.def.attack ? { type: 'attack', target: entity, x: wx, z: wz } : { type: 'move', x: wx, z: wz }, queue);
      return;
    }
    if (entity && entity.isBuilding && entity.owner === cmdr && !entity.complete) {
      for (const u of units) u.command(u.def.worker ? { type: 'build', site: entity, x: wx, z: wz } : { type: 'move', x: wx, z: wz }, queue);
      return;
    }
    // formation move
    this.formationMove(units, wx, wz, false, queue);
  }

  // Patrol: each unit walks a beat between where it stands and the point, engaging
  // what wanders into range. Shift appends it as a queued order. Owner-agnostic.
  commandPatrol(units, wx, wz, queue = false) {
    const us = units.filter(u => u.isUnit);
    if (!us.length) return;
    if (us[0].owner === this.localPlayer) Sound.command();
    for (const u of us) u.command({ type: 'patrol', x: wx, z: wz }, queue);
  }

  // Move a group as a battle line: the block is oriented to the travel direction
  // with a wide front, melee in the leading rows and ranged/casters/workers tucked
  // behind them. Reads as an army and keeps fragile units out of the front line.
  formationMove(units, wx, wz, attackMove, queue = false) {
    const n = units.length;
    if (n === 0) return;
    if (n === 1) { units[0].command({ type: 'move', x: wx, z: wz, attackMove }, queue); return; }

    // travel direction from the group's centroid toward the destination
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
    cx /= n; cz /= n;
    let dx = wx - cx, dz = wz - cz;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const rx = -dz, rz = dx;                       // right vector (across the front)

    const maxR = units.reduce((m, u) => Math.max(m, u.radius), 0.5);
    const spacing = Math.max(1.7, maxR * 2.2);

    // melee lead, then workers/support, then ranged at the back
    const melee  = units.filter(u => u.def.attack && !u.def.attack.projectile && !u.def.worker);
    const ranged = units.filter(u => u.def.attack && u.def.attack.projectile);
    const rest   = units.filter(u => !melee.includes(u) && !ranged.includes(u));
    const ordered = [...melee, ...rest, ...ranged];

    // a touch wider than tall so it presents a front, not a square
    const cols = Math.max(1, Math.round(Math.sqrt(n) * 1.4));
    const rows = Math.ceil(n / cols);
    ordered.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const across = (c - (cols - 1) / 2) * spacing;
      const depth  = ((rows - 1) / 2 - r) * spacing;   // r=0 → front, toward the target
      const sx = wx + rx * across + dx * depth;
      const sz = wz + rz * across + dz * depth;
      u.command({ type: 'move', x: sx, z: sz, attackMove }, queue);
    });
  }

  // ---------- fog ----------
  applyFogVisibility() {
    const lp = this.localPlayer;
    for (const u of this.units) {
      if (u.owner === lp) { u.mesh.visible = true; continue; }
      u.mesh.visible = this.map.fogStateAt(u.pos.x, u.pos.z) === 2;
    }
    for (const b of this.buildings) {
      if (b.owner === lp) { b.mesh.visible = true; continue; }
      const st = this.map.fogStateAt(b.pos.x, b.pos.z);
      if (st === 2) b.discovered = true;
      b.mesh.visible = b.discovered && st >= 1;
      if (b.disc) b.disc.visible = b.mesh.visible;
    }
    for (const r of this.resources) {
      r.mesh.visible = this.map.fogStateAt(r.pos.x, r.pos.z) >= 1;
    }
    // doodads are merged static batches whose fog is sampled per-fragment in the
    // shader (see GameMap._applyDoodadFog), so no per-mesh visibility toggle here.
  }

  // ---------- main update ----------
  update(dt) {
    if (this.over) dt *= 0.3; // slow-mo end
    // record this tick: its dt, the commands issued since the last tick, and a
    // periodic state checksum so playback can detect (and report) any desync.
    if (this.rec && !this.over) {
      const f = { d: +dt.toFixed(5) };
      if (this.rec.pending.length) { f.c = this.rec.pending; this.rec.pending = []; }
      if ((this.rec.frame % 120) === 0) f.k = this.checksum();
      this.rec.frames.push(f);
      this.rec.frame++;
    }
    this.time += dt;
    this.combatHeat = Math.max(0, this.combatHeat - dt * 0.14);   // cools between clashes
    this._combat = null;
    // defeat: the world slowly darkens toward the gathering Flood
    if (this.over && this.winner === 1 && this.defeatFade !== undefined) {
      this.defeatFade = Math.min(1, this.defeatFade + dt * 0.25);
      const f = this.defeatFade;
      if (this.scene.fog) this.scene.fog.density = this.preset.fogD + f * 0.01;
      this.scene.background.lerpColors(new THREE.Color(this.preset.bg), new THREE.Color(0x05060a), f);
      this._exposureFade = 1 - f * 0.4;
      this.applyExposure();
    }

    // macro ability timers (active economy: Marshal the Stores)
    for (const o of [0, 1]) {
      const p = this.players[o];
      if (p.empowerCd > 0) p.empowerCd = Math.max(0, p.empowerCd - dt);
      if (p.gatherBoostT > 0) p.gatherBoostT = Math.max(0, p.gatherBoostT - dt);
    }
    this.updateTelegraphs(dt);   // dodgeable boss AoE wind-ups land here

    for (const u of this.units) u.update(dt);
    for (const b of this.buildings) b.update(dt);
    this.updateProjectiles(dt);

    // effects
    for (const e of this.effects) {
      e.life -= dt;
      const t = 1 - e.life / e.max;
      if (e.type === 'ring') {
        e.mesh.scale.setScalar(0.4 + t * 1.2);
        e.mesh.material.opacity = 1 - t;
      } else if (e.type === 'corpse') {
        e.mesh.rotation.x = t * Math.PI / 2;
        e.mesh.position.y -= dt * 0.8;
      } else if (e.type === 'shrink') {
        e.mesh.scale.setScalar(Math.max(0.01, 0.7 * (1 - t)));
      } else if (e.type === 'debris') {
        e.vel.y -= dt * 14;
        e.mesh.position.addScaledVector(e.vel, dt);
        e.mesh.rotation.x += e.spin * dt; e.mesh.rotation.z += e.spin * 0.7 * dt;
        e.mesh.scale.setScalar(Math.max(0.05, 1 - t * 0.7));
      } else if (e.type === 'rubble') {
        e.mesh.scale.y = Math.max(0.05, 1 - t);
        e.mesh.position.y -= dt * 0.5;
      }
      if (e.life <= 0) { this.scene.remove(e.mesh); e.done = true; }
    }
    this.effects = this.effects.filter(e => !e.done);

    // fog
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) {
      this.fogTimer = 0.18;
      this.map.updateFog(this.playerViewers());
      this.applyFogVisibility();
      // Easter egg discovery cue
      if (this.fieldsOfEvil && !this.fieldsOfEvil.seen &&
          this.map.fogStateAt(this.fieldsOfEvil.x, this.fieldsOfEvil.z) === 2) {
        this.fieldsOfEvil.seen = true;
        Sound.alert();
        this.emit('toast', '☩ You have found the Fields of Evil — the House of Greene stands defiant.');
        if (!this.metClans.greene) {
          this.metClans.greene = true;
          const g = CLAN_DIALOGUE.greene;
          this.emit('dialogue', g.portrait, g.name, g.line);
        }
      }
      // first-contact dialogue when a clansman is first laid eyes upon
      for (const u of this.units) {
        const d = CLAN_DIALOGUE[u.key];
        if (!d || u.dead || this.metClans[u.key]) continue;
        if (this.map.fogStateAt(u.pos.x, u.pos.z) === 2) {
          this.metClans[u.key] = true;
          this.emit('dialogue', d.portrait, d.name, d.line);
        }
      }
      // Parker checks in on you while he ambles — visible, in view, and only
      // when your forces are near enough that he can holler a friendly word.
      // (Only Parker chatters; the hounds get a one-time reveal and stay quiet.)
      for (const u of this.units) {
        if (u.key !== 'parker' || u.dead || u.state === 'attack') continue;
        if (this.map.fogStateAt(u.pos.x, u.pos.z) !== 2 || !this.metClans[u.key]) continue;
        u.chatterT = (u.chatterT ?? 45 + Math.random() * 35) - 0.18;
        if (u.chatterT > 0) continue;
        u.chatterT = 55 + Math.random() * 45;
        const near = this.units.some(p => p.owner === 0 && !p.dead && Math.hypot(p.pos.x - u.pos.x, p.pos.z - u.pos.z) < 24);
        if (near) this.emit('dialogue', CLAN_DIALOGUE.parker.portrait, CLAN_DIALOGUE.parker.name, PARKER_LINES[(Math.random() * PARKER_LINES.length) | 0]);
      }
    }

    tickGlowMats(this.time);
    this.updateEmbers(dt);
    this.waterNormal.offset.set(this.time * 0.008, this.time * 0.005);
    this.fxDust.update(dt); this.fxSmoke.update(dt); this.fxSpark.update(dt);
    this.updateSky(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);

    if (this.ai) this.ai.update(dt);
  }

  updateSky(dt) {
    this.updateDustMotes(dt);
    if (this.stormBand) this.stormBand.rotation.y += dt * 0.012;
    // drifting cloud shadows scroll slowly across the ground
    if (this.cloudShadow) {
      const off = this.cloudShadow.material.map.offset;
      off.x += dt * 0.0065; off.y += dt * 0.0028;
    }
    // god-ray shafts shimmer gently (and lightning briefly flares them)
    if (this.godRayShafts) {
      const flare = 1 + (this._flash || 0) * 1.4;
      for (const s of this.godRayShafts) {
        const u = s.userData;
        u.phase += dt * u.rate;
        s.material.opacity = u.base * (0.7 + 0.3 * Math.sin(u.phase)) * flare;
      }
    }
    if (this.skyMat) {
      // distant lightning during storms: brief stacked flashes
      let f = 0;
      if (this.preset.lightning) {
        this._boltT = (this._boltT || 2 + Math.random() * 6) - dt;
        if (this._boltT <= 0) { this._flash = 0.9; this._boltT = 3 + Math.random() * 7; }
        this._flash = Math.max(0, (this._flash || 0) - dt * 4);
        f = this._flash * (0.6 + Math.random() * 0.4);
      }
      this.skyMat.uniforms.flash.value = f;
    }
  }

  render() {
    if (this.lowQuality) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }

  // Final exposure = mood preset × player brightness × defeat-fade.
  applyExposure() {
    this.renderer.toneMappingExposure = this.preset.exposure * this.brightness * this._exposureFade;
  }
  setBrightness(v) {
    this.brightness = Math.max(0.4, Math.min(2, v));
    this.applyExposure();
  }
  // 'auto' (loop may drop), 'high' (pin full), 'low' (pin reduced).
  get autoQuality() { return this.qualityMode === 'auto'; }
  setQualityMode(mode) {
    this.qualityMode = mode;
    if (mode === 'low') this.setLowQuality();
    else if (mode === 'high') this.setHighQuality();
    // 'auto': leave current state; the loop decides from here.
  }

  // Called by the main loop when sustained frame times are poor, or pinned 'low'.
  setLowQuality() {
    if (this.lowQuality) return;
    this.lowQuality = true;
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = false;
    this.sun.castShadow = false;
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.emit('toast', 'Reduced visual quality for smoother play');
  }
  // Restore the full pipeline (shadows, bloom/grade composer, device pixel ratio).
  setHighQuality() {
    if (!this.lowQuality) return;
    this.lowQuality = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = true;
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.fxDust?.dispose(); this.fxSmoke?.dispose(); this.fxSpark?.dispose();
    this.composer?.dispose?.();
    this.scene.environment?.dispose?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
