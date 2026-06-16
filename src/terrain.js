// Map generation, terrain mesh, walkability and fog of war.
// World is GRID x GRID tiles of TILE world units, origin at (0,0).
import * as THREE from 'three';
import { buildDoodad } from './models.js';
import { terrainMaps } from './textures.js';

export const GRID = 96;
export const TILE = 2;
export const WORLD = GRID * TILE;

// deterministic value noise
function makeNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// Biomes give each map a distinct land identity: ground palette, what litters it,
// and the sky moods it pairs with. Layout/movement are unchanged for fairness.
export const BIOMES = {
  river_valley: {
    name: 'Fertile River Valley',
    base: 0x4c5240, ash: 0x6a6b4a, rock: 0x3a3a33, sand: 0x7a6c4e, moss: 0x4e6a48,
    clutter: { rock: 0.3, ruin: 0.2, dead_tree: 0.15, monolith: 0.1, boundary_stone: 0.15, crystal: 0.1 },
    moods: ['dawn', 'noon', 'dusk'],
  },
  cedar_forest: {
    name: 'Ancient Cedar Stands',
    base: 0x36402f, ash: 0x4a4a38, rock: 0x2c2e28, sand: 0x55503a, moss: 0x3a4e34,
    clutter: { rock: 0.25, dead_tree: 0.35, ruin: 0.15, monolith: 0.1, tablet: 0.15 },
    moods: ['dusk', 'dawn', 'night'],
  },
  basalt_highland: {
    name: 'Basalt Highlands',
    base: 0x33333c, ash: 0x44444e, rock: 0x1f1f26, sand: 0x4a4640, moss: 0x32403a,
    clutter: { rock: 0.45, monolith: 0.2, ruin: 0.15, fallen_obelisk: 0.1, crystal: 0.1 },
    moods: ['storm', 'dusk', 'night'],
  },
  nephilim_waste: {
    name: 'Nephilim Wasteland',
    base: 0x46403a, ash: 0x564a42, rock: 0x2e2824, sand: 0x6a5a48, moss: 0x4a4030, tint: 0x3a2420,
    clutter: { rock: 0.3, giant_bones: 0.25, giant_weapon: 0.15, ruin: 0.15, altar: 0.15 },
    moods: ['storm', 'night', 'dusk'],
  },
  watcher_ruins: {
    name: 'The Watcher Ruins',
    base: 0x2c2e3a, ash: 0x3a3c4c, rock: 0x1c1e28, sand: 0x44465a, moss: 0x2e3848,
    clutter: { fallen_obelisk: 0.3, monolith: 0.2, crystal: 0.2, tablet: 0.15, ruin: 0.15 },
    moods: ['night', 'storm', 'dusk'],
  },
  sacred_foothills: {
    name: 'Sacred Mountain Foothills',
    base: 0x52543e, ash: 0x6e6a4c, rock: 0x40403a, sand: 0x80714e, moss: 0x566a4a,
    clutter: { rock: 0.3, altar: 0.2, dead_tree: 0.2, boundary_stone: 0.2, tablet: 0.1 },
    moods: ['dawn', 'noon', 'dusk'],
  },
};

export class GameMap {
  constructor(seed = Math.floor(Math.random() * 1e9), biomeKey) {
    this.seed = seed;
    const bkeys = Object.keys(BIOMES);
    this.biomeKey = biomeKey && BIOMES[biomeKey] ? biomeKey : bkeys[Math.floor(Math.random() * bkeys.length)];
    this.biome = BIOMES[this.biomeKey];
    const noise = makeNoise(seed);
    this.height = new Float32Array(GRID * GRID);
    this.mountain = new Uint8Array(GRID * GRID);
    this.blocked = new Uint8Array(GRID * GRID);   // static: mountains, nodes, buildings
    this.fog = new Uint8Array(GRID * GRID);       // 0 unexplored, 1 explored, 2 visible

    // Base sites (tile coords), mirrored layout.
    this.basePlayer = { x: 18, y: 18 };
    this.baseEnemy = { x: GRID - 18, y: GRID - 18 };
    this.expansions = [{ x: 18, y: GRID - 22 }, { x: GRID - 18, y: 22 }];

    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      let h = noise(x * 0.06, y * 0.06) * 2.2 + noise(x * 0.15, y * 0.15) * 0.9;
      // mountainous border
      const edge = Math.min(x, y, GRID - 1 - x, GRID - 1 - y);
      if (edge < 5) h += (5 - edge) * 1.6;
      // central ridge with two passes
      const dCenter = Math.abs((x + y) - GRID) / Math.SQRT2; // distance to anti-diagonal
      const alongRidge = Math.abs(x - y);                    // position along ridge
      const gap = (alongRidge > 18 && alongRidge < 34);      // two symmetric passes
      if (dCenter < 4 && !gap && alongRidge < 62) h += (4 - dCenter) * 1.5 + noise(x * 0.3, y * 0.3);
      // flatten base + expansion sites
      for (const s of [this.basePlayer, this.baseEnemy, ...this.expansions]) {
        const d = Math.hypot(x - s.x, y - s.y);
        if (d < 13) { const t = Math.min(1, d / 13); h = h * t * t + 0.8 * (1 - t * t); }
      }
      this.height[i] = h;
    }
    // mark mountains by slope/height
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) {
      const i = y * GRID + x;
      if (this.height[i] > 4.0) { this.mountain[i] = 1; this.blocked[i] = 1; }
    }

    this.fogCanvas = document.createElement('canvas');
    this.fogCanvas.width = GRID; this.fogCanvas.height = GRID;
    this.fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true });
    this.fogTexture = new THREE.CanvasTexture(this.fogCanvas);
    this.fogTexture.magFilter = THREE.LinearFilter;
    this.fogTexture.colorSpace = THREE.NoColorSpace;
    this.fogTexture.flipY = false;
    this.fogEnabled = true;
  }

  idx(x, y) { return y * GRID + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < GRID && y < GRID; }
  tileOf(wx, wz) { return { x: Math.max(0, Math.min(GRID - 1, Math.floor(wx / TILE))), y: Math.max(0, Math.min(GRID - 1, Math.floor(wz / TILE))) }; }
  isWalkable(x, y) { return this.inBounds(x, y) && !this.blocked[this.idx(x, y)]; }

  // A tile is "clear" for a unit needing `clearance` tiles of margin only if
  // every tile within that margin is walkable. Used so large units don't get
  // routed through gaps too narrow to physically fit.
  isWalkableClear(x, y, clearance = 0) {
    if (!this.isWalkable(x, y)) return false;
    if (clearance <= 0) return true;
    for (let dy = -clearance; dy <= clearance; dy++)
      for (let dx = -clearance; dx <= clearance; dx++)
        if (!this.isWalkable(x + dx, y + dy)) return false;
    return true;
  }

  // True if a unit-circle of world-radius r centred at (wx,wz) overlaps any
  // blocked tile. Cheap AABB-vs-circle test over the few tiles it could touch.
  circleBlocked(wx, wz, r) {
    if (wx < r || wz < r || wx > WORLD - r || wz > WORLD - r) return true;
    const minTx = Math.floor((wx - r) / TILE), maxTx = Math.floor((wx + r) / TILE);
    const minTy = Math.floor((wz - r) / TILE), maxTy = Math.floor((wz + r) / TILE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (!this.inBounds(tx, ty)) return true;
        if (!this.blocked[this.idx(tx, ty)]) continue;
        // closest point on the tile rect to the circle centre
        const rx = Math.max(tx * TILE, Math.min(wx, (tx + 1) * TILE));
        const rz = Math.max(ty * TILE, Math.min(wz, (ty + 1) * TILE));
        const ddx = wx - rx, ddz = wz - rz;
        if (ddx * ddx + ddz * ddz < r * r) return true;
      }
    }
    return false;
  }

  heightAt(wx, wz) {
    const fx = Math.max(0, Math.min(GRID - 1.001, wx / TILE - 0.5));
    const fy = Math.max(0, Math.min(GRID - 1.001, wz / TILE - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const h = (x, y) => this.height[this.idx(Math.min(GRID - 1, x), Math.min(GRID - 1, y))];
    return h(x0, y0) * (1 - tx) * (1 - ty) + h(x0 + 1, y0) * tx * (1 - ty)
         + h(x0, y0 + 1) * (1 - tx) * ty + h(x0 + 1, y0 + 1) * tx * ty;
  }

  buildMesh() {
    // 2x grid density for smoother hill silhouettes; heights sampled bilinearly
    const SEG = GRID * 2 - 1;
    const geo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD / 2, 0, WORLD / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const noise = makeNoise(this.seed + 7);
    const B = this.biome;
    const cBase = new THREE.Color(B.base), cAsh = new THREE.Color(B.ash),
          cRock = new THREE.Color(B.rock), cSand = new THREE.Color(B.sand),
          cMoss = new THREE.Color(B.moss);
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i), wz = pos.getZ(i);
      const h = this.heightAt(wx, wz);
      pos.setY(i, h);
      const gx = wx / TILE, gy = wz / TILE;
      const n = noise(gx * 0.2, gy * 0.2) * 0.8 + noise(gx * 0.7, gy * 0.7) * 0.2;
      let c = cBase.clone().lerp(cAsh, n);
      if (n > 0.62) c.lerp(cSand, (n - 0.62) * 1.6);
      if (n < 0.3) c.lerp(cMoss, (0.3 - n) * 1.2);
      if (h > 3.2) c.lerp(cRock, Math.min(1, (h - 3.2) / 2.5));
      if (h < 0.35) c.lerp(cRock, 0.4); // dark lowland basins
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const tm = terrainMaps();
    const REP = 22;
    [tm.map, tm.normalMap, tm.roughnessMap].forEach(t => t.repeat.set(REP, REP));
    const matr = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1.0, metalness: 0.02,
      map: tm.map, normalMap: tm.normalMap, roughnessMap: tm.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
    });
    matr.color.setScalar(1.8); // compensate for albedo texture multiplying vertex colors
    // multiply fog texture into terrain color
    const fogTex = this.fogTexture;
    matr.onBeforeCompile = (shader) => {
      shader.uniforms.fogMap = { value: fogTex };
      shader.uniforms.worldSizeV = { value: WORLD };
      shader.vertexShader = ('uniform float worldSizeV;\n' + shader.vertexShader)
        .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFogUv = vec2(position.x, position.z) / worldSizeV;');
      shader.fragmentShader = 'uniform sampler2D fogMap;\nvarying vec2 vFogUv;\n' + shader.fragmentShader
        .replace('#include <dithering_fragment>',
          'float fogV = texture2D(fogMap, vFogUv).r;\ngl_FragColor.rgb *= (0.12 + 0.88 * fogV);\n#include <dithering_fragment>');
    };
    const mesh = new THREE.Mesh(geo, matr);
    mesh.receiveShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  scatterDoodads(scene) {
    this.doodads = [];
    const sites = [this.basePlayer, this.baseEnemy, ...this.expansions];
    // seeded RNG so the doodad layout (and thus the static blocked grid) is identical
    // every time this seed is generated — essential for save/load to reload the map.
    let s = (this.seed ^ 0x9e3779b9) >>> 0;
    const rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const weights = Object.entries(this.biome.clutter);
    const total = weights.reduce((s, [, w]) => s + w, 0);
    const pick = () => {
      let r = rng() * total;
      for (const [type, w] of weights) { if ((r -= w) <= 0) return type; }
      return weights[0][0];
    };
    const BLOCKS = new Set(['monolith', 'ruin', 'fallen_obelisk', 'giant_weapon']);
    const place = (count, minSite, yOffset) => {
      let made = 0;
      for (let attempt = 0; attempt < count * 3 && made < count; attempt++) {
        const x = 5 + rng() * (GRID - 10), y = 5 + rng() * (GRID - 10);
        if (!this.isWalkable(Math.floor(x), Math.floor(y))) continue;
        if (sites.some(s => Math.hypot(x - s.x, y - s.y) < minSite)) continue;
        const type = pick();
        const d = buildDoodad(type);
        const wx = x * TILE, wz = y * TILE;
        d.position.set(wx, this.heightAt(wx, wz) + yOffset, wz);
        d.rotation.y = rng() * Math.PI * 2;
        scene.add(d);
        this.doodads.push(d);
        made++;
        if (BLOCKS.has(type)) { const t = this.tileOf(wx, wz); this.blocked[this.idx(t.x, t.y)] = 1; }
      }
    };
    place(150, 13, 0);     // dense ground cover keeps clear of bases
    place(20, 11, -0.05);  // a few extra landmarks closer in
  }

  // Resource node placement plan: [{type, tx, ty}]
  resourcePlan() {
    const plan = [];
    const addCluster = (cx, cy, type, n, spread) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.4;
        const tx = Math.round(cx + Math.cos(a) * spread), ty = Math.round(cy + Math.sin(a) * spread);
        if (this.isWalkable(tx, ty)) plan.push({ type, tx, ty });
      }
    };
    for (const [s, mirror] of [[this.basePlayer, 1], [this.baseEnemy, -1]]) {
      addCluster(s.x + 8 * mirror, s.y - 2 * mirror, 'grain', 4, 1.7);
      addCluster(s.x - 2 * mirror, s.y + 8 * mirror, 'timber', 4, 1.7);
      addCluster(s.x + 7 * mirror, s.y + 7 * mirror, 'bronze', 2, 1.2);
    }
    for (const e of this.expansions) {
      addCluster(e.x + 5, e.y, 'grain', 3, 1.5);
      addCluster(e.x - 5, e.y, 'bronze', 2, 1.2);
      addCluster(e.x, e.y + 5, 'timber', 3, 1.5);
    }
    // knowledge obelisks near the two ridge passes (guarded)
    const passes = [{ x: GRID / 2 - 13, y: GRID / 2 + 13 }, { x: GRID / 2 + 13, y: GRID / 2 - 13 }];
    for (const p of passes) plan.push({ type: 'knowledge', tx: p.x, ty: p.y, guarded: true });
    // a couple of extra timber stands mid-map
    addCluster(GRID / 2 - 20, GRID / 2 - 6, 'timber', 3, 1.6);
    addCluster(GRID / 2 + 20, GRID / 2 + 6, 'timber', 3, 1.6);
    return plan.filter(p => this.isWalkable(p.tx, p.ty));
  }

  // ---- fog of war ----
  updateFog(viewers) {
    // demote visible -> explored
    for (let i = 0; i < this.fog.length; i++) if (this.fog[i] === 2) this.fog[i] = 1;
    if (!this.fogEnabled) { this.fog.fill(2); }
    else {
      for (const v of viewers) {
        const t = this.tileOf(v.pos.x, v.pos.z);
        const r = Math.ceil((v.sight || 12) / TILE);
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const x = t.x + dx, y = t.y + dy;
          if (this.inBounds(x, y)) this.fog[this.idx(x, y)] = 2;
        }
      }
    }
    // paint
    const ctx = this.fogCtx;
    const img = ctx.getImageData(0, 0, GRID, GRID);
    const d = img.data;
    for (let i = 0; i < this.fog.length; i++) {
      const v = this.fog[i] === 2 ? 255 : this.fog[i] === 1 ? 110 : 0;
      d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.fogTexture.needsUpdate = true;
  }

  fogStateAt(wx, wz) {
    const t = this.tileOf(wx, wz);
    return this.fog[this.idx(t.x, t.y)];
  }
}
