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
const DIFFICULTY = {
  easy:   { worker: 9,  lateWorker: 11, waves: [3, 5, 7, 9, 12, 15],      firstWave: 220, cadence: 150, trickle: 0,   handicap: 0.8 },
  normal: { worker: 11, lateWorker: 14, waves: [5, 8, 12, 16, 20, 24],    firstWave: 170, cadence: 110, trickle: 0,   handicap: 1.0 },
  hard:   { worker: 14, lateWorker: 17, waves: [7, 11, 16, 22, 28, 34],   firstWave: 130, cadence: 85,  trickle: 1.6, handicap: 1.2 },
};

export class AI {
  constructor(game) {
    this.game = game;
    this.owner = 1;
    this.faction = game.players[1].faction;
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
    // resource handicap: scale the AI's opening stockpile up (hard) or down (easy).
    // Skip on a restored save — those resources are already the post-handicap values.
    if (d.handicap !== 1 && !game.loadedGame) {
      const r = game.players[1].resources;
      for (const k of ['grain', 'timber', 'bronze']) r[k] = Math.round((r[k] || 0) * d.handicap);
    }
    game.on('damaged', (e, attacker) => {
      if (e.owner === 1 && attacker && attacker.owner === 0) {
        this.defendUntil = game.time + 18;
        this.defendPoint = { x: attacker.pos.x, z: attacker.pos.z };
      }
    });
  }

  get main() { return this.game.buildings.find(b => b.owner === 1 && b.def.main && !b.dead); }
  myUnits() { return this.game.units.filter(u => u.owner === 1 && !u.dead); }
  myWorkers() { return this.myUnits().filter(u => u.def.worker); }
  myArmy() { return this.myUnits().filter(u => !u.def.worker); }
  myBuildings() { return this.game.buildings.filter(b => b.owner === 1 && !b.dead); }

  update(dt) {
    // passive economy trickle (hard only) — applied every frame for smoothness
    if (this.diff.trickle && !this.game.over) {
      const r = this.game.players[1].resources;
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
  }

  manageWorkers(main) {
    const g = this.game;
    const workers = this.myWorkers();
    // train more workers
    if (workers.length < this.workerTarget && main.complete && main.trainQueue.length < 2) {
      g.queueTrain(main, this.faction.worker);
    }
    // assign idle workers; keep rough balance grain > timber > bronze, knowledge late
    const wantKnowledge = g.time > 420 && g.players[1].resources.knowledge < 60;
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
        if (n.type === 'knowledge' && g.units.some(u => u.owner === 2 && !u.dead && u.distTo(n) < 12)) continue;
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
    const p = g.players[1];
    const order = BUILD_ORDERS[this.faction.key];
    // emergency supply
    let key = null;
    const supplyKey = order.find(k => this.faction.buildings[k].supplyProvided > 0);
    const underConstruction = this.myBuildings().filter(b => !b.complete);
    if (p.supplyCap - p.supplyUsed - g.queuedSupply(1) < 4 && p.supplyCap < 80 &&
        !underConstruction.some(b => b.def.supplyProvided > 0)) {
      key = supplyKey;
    } else if (this.buildIndex < order.length) {
      key = order[this.buildIndex];
      if (!g.buildingAvailable(1, key)) key = null;
      if (underConstruction.length >= 2) key = null;
    }
    if (!key) return;
    const def = this.faction.buildings[key];
    if (!g.canAfford(1, def.cost)) return;
    const spot = this.findSpot(main, def.size);
    if (!spot) return;
    const worker = this.myWorkers().find(w => w.state !== 'build') || this.myWorkers()[0];
    if (!worker) return;
    const b = g.placeBuilding(1, key, spot.x, spot.y, [worker]);
    if (b && key === order[this.buildIndex] && b.def.supplyProvided === 0) this.buildIndex++;
    else if (b && this.buildIndex < order.length && key === order[this.buildIndex]) this.buildIndex++;
  }

  findSpot(main, size) {
    const g = this.game;
    const ct = g.map.tileOf(main.pos.x, main.pos.z);
    for (let r = 3; r < 16; r += 1) {
      for (let attempt = 0; attempt < 10; attempt++) {
        const a = Math.random() * Math.PI * 2;
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

  manageTraining() {
    const g = this.game;
    const mix = ARMY_MIX[this.faction.key];
    for (const b of this.myBuildings()) {
      if (!b.complete || !b.def.trains.length || b.trainQueue.length >= 2) continue;
      const options = b.def.trains.filter(k =>
        !g.players[1].faction.units[k].worker && g.unitAvailable(1, k) && g.canAfford(1, g.players[1].faction.units[k].cost));
      if (!options.length) continue;
      // weight by mix
      const weighted = options.flatMap(k => Array(Math.max(1, mix.filter(m => m === k).length * 2)).fill(k));
      g.queueTrain(b, weighted[Math.floor(Math.random() * weighted.length)]);
    }
    // research upgrades opportunistically
    if (g.time > 360) {
      for (const b of this.myBuildings()) {
        if (!b.complete || !b.def.upgrades?.length || b.trainQueue.length) continue;
        for (const upKey of b.def.upgrades) {
          if (!g.players[1].upgrades.has(upKey)) { g.queueUpgrade(b, upKey); break; }
        }
      }
    }
  }

  manageDefense(main) {
    const g = this.game;
    if (g.time < this.defendUntil && this.defendPoint) {
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
        const pb = g.map.basePlayer;
        w.orderMove((pb.x + 0.5) * TILE, (pb.y + 0.5) * TILE);
        // return home after a while
        setTimeout(() => { if (!w.dead) w.orderMove(main.pos.x + 6, main.pos.z + 6); }, 25000);
      }
    }
  }

  manageAttacks(main) {
    const g = this.game;
    const army = this.myArmy();
    const want = this.waveSizes[Math.min(this.wave, this.waveSizes.length - 1)];
    if (g.time >= this.nextWaveTime && army.length >= want) {
      this.wave++;
      this.nextWaveTime = g.time + this.diff.cadence;
      // target: a known player building (prefer main), else map base site
      const target = g.playerMain && !g.playerMain.dead
        ? g.playerMain.pos
        : { x: (g.map.basePlayer.x + 0.5) * TILE, z: (g.map.basePlayer.y + 0.5) * TILE };
      // raiders/fast units harass workers on odd waves
      const attackers = army.slice(0, Math.max(want, Math.floor(army.length * 0.8)));
      g.formationMove(attackers, target.x, target.z, true);
    } else if (g.time >= this.nextWaveTime && army.length >= 4) {
      // can't reach full wave yet; push timer a little
      this.nextWaveTime = g.time + 30;
    }
    // idle army units rally near base
    for (const u of army) {
      if (u.state === 'idle' && u.distTo(main) > 26) u.orderMove(main.pos.x + 8, main.pos.z + 8, true);
    }
  }
}
