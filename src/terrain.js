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

export class GameMap {
  constructor(seed = Math.floor(Math.random() * 1e9)) {
    this.seed = seed;
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
    const cBase = new THREE.Color(0x42424e), cAsh = new THREE.Color(0x595449),
          cRock = new THREE.Color(0x2a2a33), cSand = new THREE.Color(0x6b5e4c),
          cMoss = new THREE.Color(0x44524a);
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
    const noise = makeNoise(this.seed + 13);
    this.doodads = [];
    const sites = [this.basePlayer, this.baseEnemy, ...this.expansions];
    for (let i = 0; i < 130; i++) {
      const x = 4 + Math.random() * (GRID - 8), y = 4 + Math.random() * (GRID - 8);
      if (!this.isWalkable(Math.floor(x), Math.floor(y))) continue;
      if (sites.some(s => Math.hypot(x - s.x, y - s.y) < 14)) continue;
      const r = noise(x * 0.5, y * 0.5);
      const type = r < 0.5 ? 'rock' : r < 0.72 ? 'ruin' : r < 0.9 ? 'monolith' : 'crystal';
      const d = buildDoodad(type);
      const wx = x * TILE, wz = y * TILE;
      d.position.set(wx, this.heightAt(wx, wz), wz);
      d.rotation.y = Math.random() * Math.PI * 2;
      scene.add(d);
      this.doodads.push(d);
      if (type === 'monolith' || type === 'ruin') {
        const t = this.tileOf(wx, wz);
        this.blocked[this.idx(t.x, t.y)] = 1;
      }
    }
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
