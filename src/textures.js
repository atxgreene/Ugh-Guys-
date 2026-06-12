// Procedural seamless PBR texture sets (albedo + normal + roughness), generated
// on canvas at load — no external assets. Normal maps are derived from a height
// field via Sobel, so flat low-poly faces pick up believable surface relief.
import * as THREE from 'three';

function periodicNoise(seed, period) {
  const hash = (x, y) => {
    x = ((x % period) + period) % period;
    y = ((y % period) + period) % period;
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
    h = (h ^ (h >> 13)) * 1274126177 | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  };
  const smooth = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
}

// fractal brownian motion, seamless with the given base period (in cells)
function fbm(seed, period, oct = 4) {
  const layers = [];
  for (let o = 0; o < oct; o++) layers.push(periodicNoise(seed + o * 7919, period * (1 << o)));
  return (x, y) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += layers[o](x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    return v;
  };
}

const ridge = n => 1 - Math.abs(2 * n - 1);

function makeTexture(canvas, { srgb = true, anisotropy = 4 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

// Build {map, normalMap, roughnessMap} from per-pixel callbacks.
// height(u,v) -> 0..1 ; color(h,u,v) -> [r,g,b] 0..255 ; rough(h,u,v) -> 0..1
function buildSet(size, cells, height, color, rough, normalStrength = 1.5) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    H[y * size + x] = height((x / size) * cells, (y / size) * cells);
  }
  const cMap = document.createElement('canvas'); cMap.width = cMap.height = size;
  const cNor = document.createElement('canvas'); cNor.width = cNor.height = size;
  const cRgh = document.createElement('canvas'); cRgh.width = cRgh.height = size;
  const iMap = cMap.getContext('2d').createImageData(size, size);
  const iNor = cNor.getContext('2d').createImageData(size, size);
  const iRgh = cRgh.getContext('2d').createImageData(size, size);
  const wrap = v => (v + size) % size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, j = i * 4;
    const h = H[i];
    const [r, g, b] = color(h, (x / size) * cells, (y / size) * cells);
    iMap.data[j] = r; iMap.data[j + 1] = g; iMap.data[j + 2] = b; iMap.data[j + 3] = 255;
    // sobel normal
    const hl = H[y * size + wrap(x - 1)], hr = H[y * size + wrap(x + 1)];
    const hu = H[wrap(y - 1) * size + x], hd = H[wrap(y + 1) * size + x];
    let nx = (hl - hr) * normalStrength, ny = (hu - hd) * normalStrength, nz = 1;
    const len = Math.hypot(nx, ny, nz);
    iNor.data[j] = (nx / len * 0.5 + 0.5) * 255;
    iNor.data[j + 1] = (ny / len * 0.5 + 0.5) * 255;
    iNor.data[j + 2] = (nz / len * 0.5 + 0.5) * 255;
    iNor.data[j + 3] = 255;
    const ro = Math.max(0, Math.min(1, rough(h, (x / size) * cells, (y / size) * cells))) * 255;
    iRgh.data[j] = ro; iRgh.data[j + 1] = ro; iRgh.data[j + 2] = ro; iRgh.data[j + 3] = 255;
  }
  cMap.getContext('2d').putImageData(iMap, 0, 0);
  cNor.getContext('2d').putImageData(iNor, 0, 0);
  cRgh.getContext('2d').putImageData(iRgh, 0, 0);
  return {
    map: makeTexture(cMap, { srgb: true, anisotropy: 8 }),
    normalMap: makeTexture(cNor, { srgb: false }),
    roughnessMap: makeTexture(cRgh, { srgb: false }),
  };
}

let _terrain, _stone, _blocks, _wood, _bone, _waterN;

// Cracked basalt / ash ground. Mostly neutral so terrain vertex colors keep
// carrying the biome hue; this adds grain, striation and crack relief.
export function terrainMaps() {
  if (_terrain) return _terrain;
  const n1 = fbm(11, 14, 4), n2 = fbm(23, 28, 3), n3 = fbm(37, 56, 2);
  const height = (x, y) => {
    const base = n1(x, y) * 0.35 + n2(x, y) * 0.35;
    const cracks = Math.pow(ridge(n1(x * 0.7 + 3, y * 0.7)), 8) * 0.22; // faint crevices
    const grain = n3(x, y) * 0.3;
    return Math.max(0, base + grain - cracks);
  };
  _terrain = buildSet(512, 14, height,
    (h, x, y) => {
      let v = 150 + h * 85 + (n3(x * 2, y * 2) - 0.5) * 18;
      const warm = n2(x + 7, y) * 14;
      if (h < 0.16) v *= 0.82; // slightly darker crack floors
      return [v + warm * 0.6, v * 0.97 + warm * 0.3, v * 0.93];
    },
    (h) => 0.98 - h * 0.22,
    1.5);
  return _terrain;
}

// Rough natural rock — used for unit bodies, rocks, generic surfaces.
export function stoneMaps() {
  if (_stone) return _stone;
  const n1 = fbm(51, 6, 4), n2 = fbm(67, 12, 3);
  const height = (x, y) => n1(x, y) * 0.7 + ridge(n2(x, y)) * 0.3;
  _stone = buildSet(256, 6, height,
    (h, x, y) => { const v = 120 + h * 115 + (n2(x * 2, y * 2) - 0.5) * 20; return [v, v * 0.98, v * 0.95]; },
    (h) => 0.95 - h * 0.2,
    1.8);
  return _stone;
}

// Dressed masonry blocks with mortar seams — buildings.
export function blockMaps() {
  if (_blocks) return _blocks;
  const n1 = fbm(81, 8, 3), n2 = fbm(97, 16, 3);
  const rows = 6, cols = 4;
  const height = (x, y) => {
    const u = x / 8, v = y / 8; // 0..1
    const row = v * rows;
    const offset = (Math.floor(row) % 2) * 0.5;
    const col = u * cols + offset;
    const fy = Math.abs(row - Math.round(row)), fx = Math.abs(col - Math.round(col));
    const mortar = Math.min(1, Math.min(fx * cols, fy * rows) * 2.2); // 0 at seam
    const block = n1(x, y) * 0.35 + n2(Math.floor(col) * 13 + x * 0.2, Math.floor(row) * 7 + y * 0.2) * 0.25;
    return mortar * (0.55 + block);
  };
  _blocks = buildSet(256, 8, height,
    (h, x, y) => { const v = 110 + h * 120 + (n2(x * 1.5, y * 1.5) - 0.5) * 22; return [v, v * 0.97, v * 0.92]; },
    (h) => 0.97 - h * 0.18,
    2.4);
  return _blocks;
}

// Aged timber grain.
export function woodMaps() {
  if (_wood) return _wood;
  const n1 = fbm(111, 4, 4), n2 = fbm(127, 16, 3);
  const height = (x, y) => {
    const grain = Math.sin((x * 0.6 + n1(x, y) * 3.0) * Math.PI * 2) * 0.5 + 0.5;
    return grain * 0.55 + n2(x, y) * 0.45;
  };
  _wood = buildSet(256, 4, height,
    (h, x, y) => { const v = 120 + h * 110; return [v, v * 0.94, v * 0.85]; },
    (h) => 0.92 - h * 0.15,
    1.2);
  return _wood;
}

// Weathered bone.
export function boneMaps() {
  if (_bone) return _bone;
  const n1 = fbm(141, 5, 4);
  const height = (x, y) => n1(x, y);
  _bone = buildSet(256, 5, height,
    (h) => { const v = 165 + h * 80; return [v, v * 0.98, v * 0.92]; },
    (h) => 0.75 - h * 0.25,
    0.8);
  return _bone;
}

// Ripple normal map for the basin water (offset is animated per-frame).
export function waterNormalMap() {
  if (_waterN) return _waterN;
  const n1 = fbm(161, 8, 4);
  const set = buildSet(256, 8, (x, y) => n1(x, y), () => [128, 128, 128], () => 0.2, 1.4);
  _waterN = set.normalMap;
  return _waterN;
}
