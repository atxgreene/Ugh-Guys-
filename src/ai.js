// Enemy AI (owner 1): runs economy, follows a build order, trains an army,
// scouts, defends its base, and launches escalating attack waves.
import { TILE } from './terrain.js';

const BUILD_ORDERS = {
  covenant: ['granary', 'barracks', 'granary', 'foundry', 'watchtower', 'temple', 'granary', 'barracks', 'granary'],
  watchers: ['star_forge', 'obsidian_gate', 'star_forge', 'archive', 'watcher_tower', 'hybrid_pit', 'star_forge', 'obsidian_gate'],
  nephilim: ['bone_pit', 'war_lodge', 'bone_pit', 'totem', 'giant_cairn', 'beast_den', 'bone_pit', 'war_lodge', 'bone_pit'],
};

const ARMY_MIX = {
  covenant: ['spearman', 'spearman', 'archer', 'archer', 'chariot', 'temple_guard', 'prophet'],
  watchers: ['starmetal', 'starmetal', 'adept', 'adept', 'skyfire', 'hybrid'],
  nephilim: ['raider', 'raider', 'champion', 'warbeast', 'shaman', 'giant'],
};

// Difficulty tuning: economy size, attack-wave sizes/cadence, a passive resource
// trickle (a stronger economy stand-in), and a handicap on the AI's opening
// stockpile. 'normal' preserves the original numbers exactly.
// retreatAt: keep pressing until the committed group falls below this fraction of
// its launch size, then pull survivors home to regroup. harass: peel fast units
// onto the player's workers on alternating waves.
const DIFFICULTY = {
  easy:   { worker: 9,  lateWorker: 11, waves: [3, 5, 7, 9, 12, 15],      firstWave: 220, cadence: 150, trickle: 0,   handicap: 0.8, retreatAt: 0.50, harass: false },
  normal: { worker: 11, lateWorker: 14, waves: [5, 8, 12, 16, 20, 24],    firstWave: 170, cadence: 110, trickle: 0,   handicap: 1.0, retreatAt: 0.35, harass: true },
  hard:   { worker: 14, lateWorker: 17, waves: [7, 11, 16, 22, 28, 34],   firstWave: 130, cadence: 85,  trickle: 1.6, handicap: 1.2, retreatAt: 0.22, harass: true },
};

export class AI {
  constructor(game, owner = 1) {
    this.game = game;
    this.owner = owner;
    this.faction = game.players[owner].faction;
    this.buildIndex = 0;
    this.thinkT = 0;
    this.wave = 0;
    const d = DIFFICULTY[game.difficulty] || DIFFICULTY.normal;
    this.diff = d;
    this.waveSizes = d.waves;
    this.nextWaveTime = d.firstWave;   // first push timing scales with difficulty
    this.scouted = false;
    this.defendUntil = 0;
    this.defendPoint = null;
    this.workerTarget = d.worker;
    this.phase = 'massing';     // 'massing' | 'attacking'
    this.attackGroup = [];      // units committed to the current push
    this.launchSize = 0;        // group size at launch (for the retreat threshold)
    // resource handicap: scale the AI's opening stockpile up (hard) or down (easy).
    // Skip on a restored save — those resources are already the post-handicap values.
    if (d.handicap !== 1 && !game.loadedGame) {
      const r = game.players[owner].resources;
      for (const k of ['grain', 'timber', 'bronze']) r[k] = Math.round((r[k] || 0) * d.handicap);
    }
    game.on('damaged', (e, attacker) => {
      if (e.owner !== this.owner || !attacker || !this.isEnemy(attacker.owner)) return;
      // only treat it as a home threat if it's near our base — otherwise a single
      // immortal harasser chipping a far outbuilding could lock us out of attacking
      const m = this.main;
      if (m && Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) > 34) return;
      this.defendUntil = game.time + 14;
      this.defendPoint = { x: attacker.pos.x, z: attacker.pos.z };
    });
  }

  get main() { return this.game.buildings.find(b => b.owner === this.owner && b.def.main && !b.dead); }
  myUnits() { return this.game.units.filter(u => u.owner === this.owner && !u.dead); }
  myWorkers() { return this.myUnits().filter(u => u.def.worker); }
  myArmy() { return this.myUnits().filter(u => !u.def.worker); }
  myBuildings() { return this.game.buildings.filter(b => b.owner === this.owner && !b.dead); }

  // A real, non-neutral player that isn't us — i.e. someone to fight.
  isEnemy(owner) { return owner < this.game.NEUTRAL && owner !== this.owner; }
  // Nearest enemy base site (tile coords) to our main — the fallback attack anchor
  // when no enemy structure is currently known.
  enemyBaseSite(main) {
    const g = this.game; let best = null, bd = Infinity;
    for (let o = 0; o < g.numPlayers; o++) {
      if (o === this.owner) continue;
      const s = g.map.bases[o]; if (!s) continue;
      const cx = (s.x + 0.5) * TILE, cz = (s.y + 0.5) * TILE;
      const d = main ? Math.hypot(cx - main.pos.x, cz - main.pos.z) : 0;
      if (d < bd) { bd = d; best = { x: cx, z: cz }; }
    }
    return best || { x: (g.map.baseEnemy.x + 0.5) * TILE, z: (g.map.baseEnemy.y + 0.5) * TILE };
  }

  update(dt) {
    // passive economy trickle (hard only) — applied every frame for smoothness
    if (this.diff.trickle && !this.game.over) {
      const r = this.game.players[this.owner].resources;
      const add = this.diff.trickle * dt;
      r.grain = (r.grain || 0) + add; r.timber = (r.timber || 0) + add * 0.7; r.bronze = (r.bronze || 0) + add * 0.5;
    }
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = 0.8;
    const g = this.game;
    if (g.over) return;
    const main = this.main;
    if (!main) return;

    this.manageWorkers(main);
    this.manageBuildOrder(main);
    this.manageTraining();
    this.manageDefense(main);
    this.manageScouting(main);
    this.manageAttacks(main);
    this.manageAbilities();
    // keep the macro economy ability on cooldown, same as a diligent player would
    if (this.game.players[this.owner].empowerCd <= 0) this.game.marshalStores(this.owner);
  }

  manageWorkers(main) {
    const g = this.game;
    const workers = this.myWorkers();
    // train more workers
    if (workers.length < this.workerTarget && main.complete && main.trainQueue.length < 2) {
      g.queueTrain(main, this.faction.worker);
    }
    // assign idle workers; keep rough balance grain > timber > bronze, knowledge late
    const wantKnowledge = g.time > 420 && g.players[this.owner].resources.knowledge < 60;
    for (const w of workers) {
      if (w.state !== 'idle') continue;
      const counts = { grain: 0, timber: 0, bronze: 0, knowledge: 0 };
      for (const o of workers) if (o.gatherNode) counts[o.gatherNode.type]++;
      let want = 'grain';
      if (counts.timber < Math.floor(counts.grain * 0.6)) want = 'timber';
      else if (counts.bronze < Math.floor(counts.grain * 0.5)) want = 'bronze';
      if (wantKnowledge && counts.knowledge < 2) want = 'knowledge';
      let best = null, bd = Infinity;
      for (const n of g.resources) {
        if (n.type !== want || n.amount <= 0) continue;
        // avoid guarded obelisks until guards are dead
        if (n.type === 'knowledge' && g.units.some(u => u.owner === g.NEUTRAL && !u.dead && u.distTo(n) < 12)) continue;
        const d = w.distTo(n);
        if (d < bd) { bd = d; best = n; }
      }
      if (!best) {
        for (const n of g.resources) {
          if (n.amount <= 0 || n.type === 'knowledge') continue;
          const d = w.distTo(n);
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best) w.orderGather(best);
    }
    // late game: grow worker count a bit (scaled by difficulty)
    if (this.game.time > 300) this.workerTarget = this.diff.lateWorker;
  }

  manageBuildOrder(main) {
    const g = this.game;
    const p = g.players[this.owner];
    const order = BUILD_ORDERS[this.faction.key];
    // emergency supply
    let key = null;
    const supplyKey = order.find(k => this.faction.buildings[k].supplyProvided > 0);
    const underConstruction = this.myBuildings().filter(b => !b.complete);
    if (p.supplyCap - p.supplyUsed - g.queuedSupply(this.owner) < 4 && p.supplyCap < 80 &&
        !underConstruction.some(b => b.def.supplyProvided > 0)) {
      key = supplyKey;
    } else if (this.buildIndex < order.length) {
      key = order[this.buildIndex];
      if (!g.buildingAvailable(this.owner, key)) key = null;
      if (underConstruction.length >= 2) key = null;
    }
    if (!key) return;
    const def = this.faction.buildings[key];
    if (!g.canAfford(this.owner, def.cost)) return;
    const spot = this.findSpot(main, def.size);
    if (!spot) return;
    const worker = this.myWorkers().find(w => w.state !== 'build') || this.myWorkers()[0];
    if (!worker) return;
    const b = g.placeBuilding(this.owner, key, spot.x, spot.y, [worker]);
    if (b && key === order[this.buildIndex] && b.def.supplyProvided === 0) this.buildIndex++;
    else if (b && this.buildIndex < order.length && key === order[this.buildIndex]) this.buildIndex++;
  }

  findSpot(main, size) {
    const g = this.game;
    const ct = g.map.tileOf(main.pos.x, main.pos.z);
    for (let r = 3; r < 16; r += 1) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const a = g.rand() * Math.PI * 2;
        const tx = Math.round(ct.x + Math.cos(a) * r) - Math.floor(size / 2);
        const ty = Math.round(ct.y + Math.sin(a) * r) - Math.floor(size / 2);
        let ok = true;
        for (let y = 0; y < size && ok; y++) for (let x = 0; x < size && ok; x++) {
          if (!g.map.inBounds(tx + x, ty + y) || g.map.blocked[g.map.idx(tx + x, ty + y)]) ok = false;
        }
        if (!ok) continue;
        let hMin = Infinity, hMax = -Infinity;
        for (let y = 0; y <= size; y++) for (let x = 0; x <= size; x++) {
          const h = g.map.heightAt((tx + x) * TILE, (ty + y) * TILE);
          hMin = Math.min(hMin, h); hMax = Math.max(hMax, h);
        }
        if (hMax - hMin >= 1.6) continue;
        const cx = (tx + size / 2) * TILE, cz = (ty + size / 2) * TILE;
        if (g.units.some(u => Math.hypot(u.pos.x - cx, u.pos.z - cz) < size * TILE * 0.5 + 0.5)) continue;
        return { x: tx, y: ty };
      }
    }
    return null;
  }

  // Tally the tags of the player's standing army so we can train answers to it.
  playerArmyTags() {
    const tags = {};
    for (const u of this.game.units) {
      if (!this.isEnemy(u.owner) || u.dead || u.def.worker) continue;
      for (const t of u.def.tags || []) tags[t] = (tags[t] || 0) + 1;
    }
    return tags;
  }
  // How well a unit counters the player's army: sum of its bonus margins weighted
  // by how many enemy units carry each countered tag.
  counterScore(unitKey, enemyTags) {
    const bonus = this.faction.units[unitKey]?.attack?.bonus;
    if (!bonus) return 0;
    let s = 0;
    for (const tag in bonus) s += (bonus[tag] - 1) * (enemyTags[tag] || 0);
    return s;
  }

  manageTraining() {
    const g = this.game;
    const mix = ARMY_MIX[this.faction.key];
    const enemyTags = this.playerArmyTags();
    for (const b of this.myBuildings()) {
      if (!b.complete || !b.def.trains.length || b.trainQueue.length >= 2) continue;
      const options = b.def.trains.filter(k =>
        !g.players[this.owner].faction.units[k].worker && g.unitAvailable(this.owner, k) && g.canAfford(this.owner, g.players[this.owner].faction.units[k].cost));
      if (!options.length) continue;
      // weight by base composition + a bias toward whatever counters the player's army
      const weighted = [];
      for (const k of options) {
        let w = 1 + 2 * mix.filter(m => m === k).length;
        w += this.counterScore(k, enemyTags) * 1.5;
        for (let j = 0; j < Math.max(1, Math.round(w)); j++) weighted.push(k);
      }
      g.queueTrain(b, weighted[Math.floor(g.rand() * weighted.length)]);
    }
    // research upgrades opportunistically
    if (g.time > 360) {
      for (const b of this.myBuildings()) {
        if (!b.complete || !b.def.upgrades?.length || b.trainQueue.length) continue;
        for (const upKey of b.def.upgrades) {
          if (!g.players[this.owner].upgrades.has(upKey)) { g.queueUpgrade(b, upKey); break; }
        }
      }
    }
  }

  manageDefense(main) {
    const g = this.game;
    if (g.time < this.defendUntil && this.defendPoint) {
      // home is threatened — abort any push and bring everyone back to defend
      if (this.phase === 'attacking') { this.phase = 'massing'; this.attackGroup = []; }
      for (const u of this.myArmy()) {
        if (u.state === 'idle' || (u.state === 'move' && !u.target)) {
          u.orderMove(this.defendPoint.x, this.defendPoint.z, true);
        }
      }
    }
  }

  manageScouting(main) {
    const g = this.game;
    if (!this.scouted && g.time > 70) {
      this.scouted = true;
      const w = this.myWorkers()[0];
      if (w) {
        const t = this.enemyBaseSite(main);
        w.orderMove(t.x, t.z);
        // return home after a while
        setTimeout(() => { if (!w.dead) w.orderMove(main.pos.x + 6, main.pos.z + 6); }, 25000);
      }
    }
  }

  // freshest worthwhile target: nearest enemy main, else nearest known enemy
  // building, else the nearest enemy base site on the map.
  playerTarget() {
    const g = this.game;
    const from = this.main?.pos;
    const dist = (p) => from ? Math.hypot(p.x - from.x, p.z - from.z) : 0;
    let best = null, bd = Infinity;
    for (const b of g.buildings) {
      if (b.dead || !this.isEnemy(b.owner)) continue;
      const score = (b.def.main ? 0 : 1e6) + dist(b.pos);   // prefer mains, then nearest
      if (score < bd) { bd = score; best = b.pos; }
    }
    return best || this.enemyBaseSite(this.main);
  }
  // a forward staging point ~30% of the way from our base toward the nearest enemy,
  // so reserves mass up the field instead of dribbling out one unit at a time.
  stagingPoint(main) {
    const t = this.enemyBaseSite(main);
    return { x: main.pos.x + (t.x - main.pos.x) * 0.28, z: main.pos.z + (t.z - main.pos.z) * 0.28 };
  }
  // peel the fastest free units onto an enemy economy
  harass() {
    const g = this.game;
    const workers = g.units.filter(u => this.isEnemy(u.owner) && !u.dead && u.def.worker);
    if (!workers.length) return;
    const t = workers[Math.floor(g.rand() * workers.length)];
    const fast = this.myArmy().filter(u => !this.attackGroup.includes(u) && !u._harassUntil && u.def.speed >= 9).slice(0, 4);
    if (fast.length >= 2) {
      for (const u of fast) u._harassUntil = g.time + 22;   // leave them on the raid, don't reclaim
      g.formationMove(fast, t.pos.x, t.pos.z, true);
    }
  }

  manageAbilities() {
    const g = this.game;
    for (const u of this.myArmy()) {
      if (u.dead || !u.def.ability || u.abilityCd > 0) continue;
      if (u.state !== 'attack' && u.state !== 'attackMove') continue;
      if (g.rand() > 0.35) continue;   // 35% chance per AI think cycle to fire
      g.useAbility(u);
    }
  }

  manageAttacks(main) {
    const g = this.game;
    if (g.time < this.defendUntil) return;      // defending home takes priority
    const army = this.myArmy();
    const want = this.waveSizes[Math.min(this.wave, this.waveSizes.length - 1)];

    if (this.phase === 'attacking') {
      this.attackGroup = this.attackGroup.filter(u => !u.dead);
      // ground down past the retreat threshold → pull survivors back to regroup
      // rather than feeding them in piecemeal
      if (this.attackGroup.length < Math.max(2, this.launchSize * this.diff.retreatAt)) {
        const home = this.stagingPoint(main);
        for (const u of this.attackGroup) if (!u.dead) u.orderMove(home.x, home.z);
        this.attackGroup = [];
        this.phase = 'massing';
        this.nextWaveTime = g.time + this.diff.cadence * 0.8;
        return;
      }
      // keep the group pressing the freshest target
      const t = this.playerTarget();
      for (const u of this.attackGroup) {
        if (!u.dead && (u.state === 'idle' || (u.state === 'move' && !u.target))) u.orderMove(t.x, t.z, true);
      }
      return;
    }

    // expire harass tags so those raiders rejoin the main force afterward
    for (const u of army) if (u._harassUntil && g.time > u._harassUntil) u._harassUntil = 0;
    const available = army.filter(u => !u._harassUntil);   // not currently on a raid

    // massing → commit the wave as a single body when it's ready
    if (g.time >= this.nextWaveTime && available.length >= want) {
      this.wave++;
      this.nextWaveTime = g.time + this.diff.cadence;
      this.attackGroup = available.slice(0, Math.max(want, Math.floor(available.length * 0.85)));
      this.launchSize = this.attackGroup.length;
      this.phase = 'attacking';
      const t = this.playerTarget();
      g.formationMove(this.attackGroup, t.x, t.z, true);
      if (this.diff.harass && this.wave % 2 === 1) this.harass();
    } else if (g.time >= this.nextWaveTime && available.length >= 4) {
      this.nextWaveTime = g.time + 25;          // not enough yet — check back soon
    }

    // reserves gather at the forward staging point, ready for the next push
    const stage = this.stagingPoint(main);
    for (const u of army) {
      if (this.attackGroup.includes(u) || u._harassUntil) continue;
      if (u.state === 'idle' && Math.hypot(u.pos.x - stage.x, u.pos.z - stage.z) > 10) {
        u.orderMove(stage.x, stage.z, true);
      }
    }
  }
}
