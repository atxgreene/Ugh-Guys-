// Grid A* with octile heuristic and line-of-sight path smoothing.
import { GRID, TILE } from './terrain.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

class MinHeap {
  constructor() { this.a = []; }
  push(n) { this.a.push(n); let i = this.a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (this.a[p].f <= this.a[i].f) break; [this.a[p], this.a[i]] = [this.a[i], this.a[p]]; i = p; } }
  pop() { const t = this.a[0], l = this.a.pop(); if (this.a.length) { this.a[0] = l; let i = 0; for (;;) { let c = i * 2 + 1; if (c >= this.a.length) break; if (c + 1 < this.a.length && this.a[c + 1].f < this.a[c].f) c++; if (this.a[i].f <= this.a[c].f) break; [this.a[i], this.a[c]] = [this.a[c], this.a[i]]; i = c; } } return t; }
  get size() { return this.a.length; }
}

export function findNearestWalkable(map, tx, ty, maxR = 10, clearance = 0) {
  if (map.isWalkableClear(tx, ty, clearance)) return { x: tx, y: ty };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (map.isWalkableClear(tx + dx, ty + dy, clearance)) return { x: tx + dx, y: ty + dy };
    }
  }
  // fall back to bare walkable so a unit is never left without a target tile
  if (clearance > 0) return findNearestWalkable(map, tx, ty, maxR, 0);
  return null;
}

// Returns array of world-space waypoints {x, z}, or null.
// `clearance` (in tiles) keeps wide units away from walls they can't squeeze past.
export function findPath(map, startW, goalW, clearance = 0) {
  const walkable = (x, y) => map.isWalkableClear(x, y, clearance);
  const s0 = map.tileOf(startW.x, startW.z);
  const g0 = map.tileOf(goalW.x, goalW.z);
  const start = findNearestWalkable(map, s0.x, s0.y, 10, clearance) || s0;
  const goal = findNearestWalkable(map, g0.x, g0.y, 10, clearance);
  if (!goal) return null;
  if (start.x === goal.x && start.y === goal.y) return [{ x: goalW.x, z: goalW.z }];

  const N = GRID * GRID;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const idx = (x, y) => y * GRID + x;
  const h = (x, y) => {
    const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
    return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
  };
  const open = new MinHeap();
  const si = idx(start.x, start.y);
  gScore[si] = 0;
  open.push({ x: start.x, y: start.y, f: h(start.x, start.y) });
  let found = false, expanded = 0;
  while (open.size && expanded < 9000) {
    const cur = open.pop();
    const ci = idx(cur.x, cur.y);
    if (closed[ci]) continue;
    closed[ci] = 1; expanded++;
    if (cur.x === goal.x && cur.y === goal.y) { found = true; break; }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!walkable(nx, ny)) continue;
      if (dx && dy && (!walkable(cur.x + dx, cur.y) || !walkable(cur.x, cur.y + dy))) continue; // no corner cutting
      const ni = idx(nx, ny);
      if (closed[ni]) continue;
      const ng = gScore[ci] + cost;
      if (ng < gScore[ni]) {
        gScore[ni] = ng; came[ni] = ci;
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  // No wide-clearance route exists (e.g. a giant facing a narrow pass) — retry
  // without clearance so there's always a path; wall-sliding handles the squeeze.
  if (!found) return clearance > 0 ? findPath(map, startW, goalW, 0) : null;
  // reconstruct
  let tiles = [];
  let i = idx(goal.x, goal.y);
  while (i !== -1) { tiles.push({ x: i % GRID, y: Math.floor(i / GRID) }); i = came[i]; }
  tiles.reverse();
  // smooth with LOS
  const los = (a, b) => {
    let x0 = a.x, y0 = a.y; const x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      if (!walkable(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  };
  const smoothed = [tiles[0]];
  let anchor = 0;
  for (let k = 2; k < tiles.length; k++) {
    if (!los(tiles[anchor], tiles[k])) { smoothed.push(tiles[k - 1]); anchor = k - 1; }
  }
  smoothed.push(tiles[tiles.length - 1]);
  const pts = smoothed.map(t => ({ x: (t.x + 0.5) * TILE, z: (t.y + 0.5) * TILE }));
  // end exactly at requested point if its tile is walkable
  const gt = map.tileOf(goalW.x, goalW.z);
  if (map.isWalkable(gt.x, gt.y)) pts[pts.length - 1] = { x: goalW.x, z: goalW.z };
  return pts;
}

// Tiles of clearance a unit of world-radius r needs to avoid clipping walls.
export function clearanceFor(radius) {
  return radius > 1.0 ? 1 : 0;
}
