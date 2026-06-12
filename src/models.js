// Procedural low-poly models. Style: dark obsidian/ash world, faction identity
// carried by emissive glow accents. All builders return a THREE.Group whose
// origin sits at ground level.
import * as THREE from 'three';

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
      flatShading: true,
    }));
  }
  return matCache.get(key);
}

export function glowMat(color, intensity = 1.6) {
  return mat(0x111114, { emissive: color, ei: intensity, rough: 0.5 });
}

const DARK = 0x26262c, DARKER = 0x1b1b20, ASH = 0x3a3a40, BONE = 0x6b6457, WOOD = 0x3d3228;

function prim(geo, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
const box = (w, h, d, m, ...p) => prim(new THREE.BoxGeometry(w, h, d), m, ...p);
const cyl = (rt, rb, h, m, seg = 6, ...p) => prim(new THREE.CylinderGeometry(rt, rb, h, seg), m, ...p);
const cone = (r, h, m, seg = 6, ...p) => prim(new THREE.ConeGeometry(r, h, seg), m, ...p);
const sph = (r, m, ...p) => prim(new THREE.SphereGeometry(r, 6, 5), m, ...p);

// ---------- units ----------
// Each unit builder receives (body, glow) materials derived from faction colors.

const unitBuilders = {
  worker(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.18, 0.26, 0.7, b, 6, 0, 0.35, 0));
    grp.add(sph(0.17, b, 0, 0.85, 0));
    grp.add(box(0.06, 0.5, 0.06, mat(WOOD), 0.25, 0.6, 0, 0, 0, -0.4)); // tool haft
    grp.add(box(0.16, 0.08, 0.05, g, 0.34, 0.83, 0));
    return grp;
  },
  spearman(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.2, 0.28, 0.85, b, 6, 0, 0.42, 0));
    grp.add(sph(0.17, b, 0, 1.0, 0));
    grp.add(cone(0.12, 0.22, g, 4, 0, 1.2, 0)); // crest
    grp.add(cyl(0.03, 0.03, 1.5, mat(WOOD), 4, 0.3, 0.8, 0));
    grp.add(cone(0.06, 0.22, g, 4, 0.3, 1.62, 0)); // spearhead
    grp.add(box(0.34, 0.5, 0.07, mat(DARK), -0.26, 0.55, 0)); // shield
    grp.add(box(0.2, 0.2, 0.02, g, -0.26, 0.55, -0.05));
    return grp;
  },
  archer(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.17, 0.24, 0.8, b, 6, 0, 0.4, 0));
    grp.add(sph(0.16, b, 0, 0.95, 0));
    grp.add(box(0.3, 0.07, 0.07, g, 0, 1.1, 0)); // headband
    const sling = cyl(0.025, 0.025, 0.7, mat(BONE), 4, 0.28, 0.75, 0, 0, 0, 0.9);
    grp.add(sling);
    return grp;
  },
  chariot(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.7, 0.35, 1.0, b, 0, 0.45, -0.2));
    const wheel = (x) => { const w = cyl(0.32, 0.32, 0.1, mat(WOOD), 8, x, 0.32, -0.3, 0, 0, Math.PI / 2); return w; };
    grp.add(wheel(-0.45)); grp.add(wheel(0.45));
    grp.add(box(0.7, 0.06, 0.06, g, 0, 0.65, -0.7)); // rail glow
    // horse
    grp.add(box(0.34, 0.4, 0.8, mat(ASH), 0, 0.55, 0.7));
    grp.add(box(0.16, 0.4, 0.2, mat(ASH), 0, 0.85, 1.05));
    grp.add(sph(0.13, mat(ASH), 0, 1.05, 1.18));
    // rider
    grp.add(cyl(0.14, 0.18, 0.5, b, 6, 0, 0.85, -0.25));
    grp.add(sph(0.13, b, 0, 1.18, -0.25));
    grp.add(cone(0.09, 0.16, g, 4, 0, 1.33, -0.25));
    return grp;
  },
  guard(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.24, 0.32, 0.95, b, 6, 0, 0.48, 0));
    grp.add(sph(0.19, b, 0, 1.12, 0));
    grp.add(box(0.5, 0.1, 0.1, g, 0, 1.3, 0)); // horned halo bar
    grp.add(box(0.4, 0.65, 0.08, mat(DARK), -0.3, 0.6, 0));
    grp.add(box(0.24, 0.4, 0.02, g, -0.3, 0.6, -0.06));
    grp.add(cyl(0.04, 0.04, 1.1, mat(WOOD), 4, 0.32, 0.7, 0));
    grp.add(box(0.2, 0.3, 0.04, g, 0.32, 1.3, 0)); // glaive blade
    return grp;
  },
  prophet(b, g) {
    const grp = new THREE.Group();
    grp.add(cone(0.32, 1.1, b, 6, 0, 0.55, 0));
    grp.add(sph(0.16, b, 0, 1.2, 0));
    grp.add(sph(0.1, g, 0, 1.55, 0)); // hovering flame
    grp.add(cyl(0.03, 0.03, 1.3, mat(WOOD), 4, 0.28, 0.65, 0));
    grp.add(sph(0.08, g, 0.28, 1.35, 0));
    return grp;
  },
  starmetal(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.5, 0.9, 0.35, b, 0, 0.55, 0));
    grp.add(box(0.6, 0.16, 0.4, b, 0, 1.05, 0)); // pauldrons
    grp.add(sph(0.17, b, 0, 1.25, 0));
    grp.add(box(0.1, 0.26, 0.02, g, 0, 0.62, 0.19)); // chest sigil
    grp.add(box(0.34, 1.0, 0.1, mat(DARKER), 0.4, 0.75, 0, 0, 0, -0.15)); // greatblade
    grp.add(box(0.06, 0.9, 0.02, g, 0.42, 0.75, -0.06, 0, 0, -0.15));
    return grp;
  },
  adept(b, g) {
    const grp = new THREE.Group();
    grp.add(cone(0.3, 1.0, b, 6, 0, 0.5, 0));
    grp.add(sph(0.15, b, 0, 1.1, 0));
    grp.add(box(0.36, 0.05, 0.36, g, 0, 1.3, 0, 0, Math.PI / 4, 0)); // floating square halo
    grp.add(sph(0.07, g, 0.3, 0.9, 0));
    grp.add(sph(0.07, g, -0.3, 0.9, 0));
    return grp;
  },
  skyfire(b, g) {
    const grp = new THREE.Group();
    grp.add(cone(0.34, 1.15, b, 6, 0, 0.58, 0));
    grp.add(sph(0.16, b, 0, 1.25, 0));
    const ring = prim(new THREE.TorusGeometry(0.35, 0.04, 6, 12), g, 0, 1.55, 0, Math.PI / 2);
    grp.add(ring);
    grp.add(sph(0.12, g, 0, 1.55, 0));
    return grp;
  },
  hybrid(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.8, 1.1, 0.55, b, 0, 0.75, 0));
    grp.add(box(0.95, 0.25, 0.6, b, 0, 1.35, 0));
    grp.add(sph(0.24, b, 0, 1.65, 0));
    grp.add(box(0.08, 0.4, 0.04, g, -0.18, 1.7, 0.18, 0.3));
    grp.add(box(0.08, 0.4, 0.04, g, 0.18, 1.7, 0.18, 0.3)); // horns
    grp.add(box(0.3, 0.7, 0.3, b, -0.6, 0.5, 0)); grp.add(box(0.3, 0.7, 0.3, b, 0.6, 0.5, 0)); // arms
    grp.add(box(0.2, 0.2, 0.04, g, 0, 0.95, 0.29)); // chest glow
    return grp;
  },
  raider(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.2, 0.26, 0.95, b, 6, 0, 0.5, 0));
    grp.add(sph(0.18, b, 0, 1.12, 0));
    grp.add(box(0.4, 0.08, 0.08, mat(BONE), 0, 1.25, 0)); // bone crest
    grp.add(box(0.1, 0.7, 0.1, mat(BONE), 0.3, 0.8, 0, 0, 0, -0.5)); // axe
    grp.add(box(0.12, 0.1, 0.04, g, 0, 0.7, 0.22));
    return grp;
  },
  champion(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.3, 0.38, 1.3, b, 6, 0, 0.65, 0));
    grp.add(sph(0.24, b, 0, 1.5, 0));
    grp.add(cone(0.1, 0.3, mat(BONE), 4, -0.14, 1.75, 0, 0, 0, 0.3));
    grp.add(cone(0.1, 0.3, mat(BONE), 4, 0.14, 1.75, 0, 0, 0, -0.3));
    grp.add(cyl(0.07, 0.12, 1.1, mat(BONE), 5, 0.45, 0.9, 0, 0, 0, -0.5)); // bone club
    grp.add(box(0.2, 0.16, 0.05, g, 0, 0.9, 0.34)); // war paint glow
    return grp;
  },
  warbeast(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.5, 0.45, 1.1, b, 0, 0.5, 0));
    grp.add(box(0.3, 0.3, 0.4, b, 0, 0.7, 0.6));
    grp.add(sph(0.05, g, -0.1, 0.78, 0.78)); grp.add(sph(0.05, g, 0.1, 0.78, 0.78)); // eyes
    grp.add(cone(0.08, 0.25, mat(BONE), 4, 0, 0.95, 0.55, -0.5)); // horn
    [-0.32, 0.32].forEach(z => { grp.add(box(0.12, 0.4, 0.12, b, -0.2, 0.2, z)); grp.add(box(0.12, 0.4, 0.12, b, 0.2, 0.2, z)); });
    return grp;
  },
  giant(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.6, 1.0, 0.5, b, -0.5, 0.5, 0)); grp.add(box(0.6, 1.0, 0.5, b, 0.5, 0.5, 0)); // legs
    grp.add(box(1.5, 1.3, 0.9, b, 0, 1.6, 0));
    grp.add(box(1.8, 0.4, 1.0, b, 0, 2.4, 0));
    grp.add(sph(0.38, b, 0, 2.9, 0));
    grp.add(box(0.5, 1.4, 0.5, b, -1.1, 1.5, 0)); grp.add(box(0.5, 1.4, 0.5, b, 1.1, 1.5, 0)); // arms
    grp.add(cyl(0.15, 0.3, 1.6, mat(BONE), 5, 1.3, 1.0, 0.3, 0.4)); // tree-club
    grp.add(box(0.5, 0.5, 0.06, g, 0, 1.8, 0.48)); // rune slab strapped to chest
    grp.add(sph(0.07, g, -0.13, 2.95, 0.3)); grp.add(sph(0.07, g, 0.13, 2.95, 0.3));
    return grp;
  },
  shaman(b, g) {
    const grp = new THREE.Group();
    grp.add(cone(0.3, 1.0, b, 6, 0, 0.5, 0));
    grp.add(sph(0.16, b, 0, 1.1, 0));
    grp.add(cone(0.12, 0.35, mat(BONE), 4, -0.1, 1.3, 0, 0, 0, 0.4));
    grp.add(cone(0.12, 0.35, mat(BONE), 4, 0.1, 1.3, 0, 0, 0, -0.4)); // antlers
    grp.add(cyl(0.03, 0.03, 1.2, mat(WOOD), 4, 0.28, 0.6, 0));
    grp.add(sph(0.09, g, 0.28, 1.25, 0)); // ember skull staff
    return grp;
  },
  devourer(b, g) {
    const grp = new THREE.Group();
    grp.add(box(0.7, 0.6, 1.3, b, 0, 0.6, 0));
    grp.add(box(0.45, 0.45, 0.5, b, 0, 0.85, 0.75));
    grp.add(sph(0.06, g, -0.12, 0.95, 0.98)); grp.add(sph(0.06, g, 0.12, 0.95, 0.98));
    grp.add(cone(0.1, 0.4, mat(BONE), 4, 0, 1.2, 0.6, -0.4));
    grp.add(box(0.3, 0.15, 0.7, b, 0, 0.75, -0.85, 0.3)); // tail
    [-0.4, 0.4].forEach(z => { grp.add(box(0.16, 0.5, 0.16, b, -0.25, 0.25, z)); grp.add(box(0.16, 0.5, 0.16, b, 0.25, 0.25, z)); });
    return grp;
  },
};

// ---------- buildings ----------

const buildingBuilders = {
  city_center(b, g) {
    const grp = new THREE.Group();
    grp.add(box(6.4, 1.2, 6.4, mat(ASH), 0, 0.6, 0));
    grp.add(box(5.0, 1.2, 5.0, b, 0, 1.8, 0));
    grp.add(box(3.6, 1.2, 3.6, mat(ASH), 0, 3.0, 0));
    grp.add(box(2.2, 1.2, 2.2, b, 0, 4.2, 0)); // ziggurat tiers
    grp.add(box(0.8, 1.4, 0.8, g, 0, 5.4, 0)); // eternal flame shrine
    grp.add(box(1.2, 0.8, 0.4, mat(DARKER), 0, 0.9, 3.25)); // gate
    return grp;
  },
  granary(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(1.1, 1.3, 1.8, mat(ASH), 8, -0.8, 0.9, 0));
    grp.add(cone(1.2, 0.9, b, 8, -0.8, 2.2, 0));
    grp.add(cyl(0.8, 1.0, 1.4, mat(ASH), 8, 1.0, 0.7, 0.4));
    grp.add(cone(0.95, 0.7, b, 8, 1.0, 1.75, 0.4));
    grp.add(box(0.5, 0.3, 0.1, g, -0.8, 1.0, 1.25));
    return grp;
  },
  barracks(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.6, 1.6, 3.4, mat(ASH), 0, 0.8, 0));
    grp.add(box(4.8, 0.5, 3.6, b, 0, 1.85, 0));
    grp.add(box(0.4, 2.6, 0.4, b, -2.0, 1.3, 1.5));
    grp.add(box(0.4, 2.6, 0.4, b, 2.0, 1.3, 1.5)); // banner posts
    grp.add(box(0.3, 1.0, 0.05, g, -2.0, 2.4, 1.5));
    grp.add(box(0.3, 1.0, 0.05, g, 2.0, 2.4, 1.5)); // banners
    return grp;
  },
  foundry(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.2, 1.4, 4.2, mat(ASH), 0, 0.7, 0));
    grp.add(cyl(0.7, 1.0, 2.4, b, 6, -1.0, 2.4, -0.8)); // chimney
    grp.add(sph(0.3, g, -1.0, 3.7, -0.8)); // furnace glow
    grp.add(box(1.6, 0.9, 1.6, mat(DARKER), 1.2, 1.85, 0.8));
    grp.add(box(0.8, 0.15, 0.8, g, 1.2, 1.5, 0.8)); // molten pool
    return grp;
  },
  temple(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.6, 0.8, 4.6, mat(ASH), 0, 0.4, 0));
    for (const x of [-1.6, 0, 1.6]) for (const z of [-1.6, 1.6])
      grp.add(cyl(0.25, 0.3, 2.4, b, 6, x, 2.0, z));
    grp.add(box(4.8, 0.7, 4.8, b, 0, 3.55, 0)); // roof
    grp.add(cone(0.5, 1.2, g, 4, 0, 4.5, 0)); // sacred flame pyramid
    grp.add(box(0.9, 1.4, 0.2, mat(DARKER), 0, 1.5, 0)); // inner sanctum
    return grp;
  },
  tower(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(1.0, 1.3, 3.6, mat(ASH), 6, 0, 1.8, 0));
    grp.add(cyl(1.3, 1.1, 0.8, b, 6, 0, 4.0, 0));
    grp.add(sph(0.22, g, 0, 4.6, 0)); // signal fire
    return grp;
  },
  spire(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(2.4, 3.2, 1.4, mat(DARKER), 7, 0, 0.7, 0));
    grp.add(cyl(1.2, 2.0, 3.4, b, 7, 0, 3.0, 0));
    grp.add(cyl(0.4, 1.0, 2.6, mat(DARKER), 7, 0, 5.9, 0));
    grp.add(sph(0.5, g, 0, 7.4, 0)); // captive star
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2;
      grp.add(box(0.3, 1.8, 0.3, mat(DARKER), Math.cos(a) * 2.6, 1.6, Math.sin(a) * 2.6, 0, 0, 0.3 * Math.cos(a)));
      grp.add(sph(0.12, g, Math.cos(a) * 2.6, 2.6, Math.sin(a) * 2.6));
    }
    return grp;
  },
  starforge(b, g) {
    const grp = new THREE.Group();
    grp.add(box(2.6, 1.0, 2.6, mat(DARKER), 0, 0.5, 0));
    const ring = prim(new THREE.TorusGeometry(0.9, 0.12, 6, 14), b, 0, 1.9, 0);
    grp.add(ring);
    grp.add(sph(0.35, g, 0, 1.9, 0)); // molten star fragment
    return grp;
  },
  gate(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.4, 1.0, 1.6, mat(DARKER), 0, 0.5, 0));
    const arch = prim(new THREE.TorusGeometry(1.7, 0.3, 6, 16, Math.PI), b, 0, 1.0, 0);
    grp.add(arch);
    const portal = prim(new THREE.CircleGeometry(1.4, 16), glowMat(0x7a3cff, 0.9), 0, 1.2, 0);
    portal.material.side = THREE.DoubleSide;
    grp.add(portal);
    grp.add(box(0.5, 2.8, 0.5, b, -2.2, 1.4, 0));
    grp.add(box(0.5, 2.8, 0.5, b, 2.2, 1.4, 0));
    grp.add(sph(0.15, g, -2.2, 2.95, 0)); grp.add(sph(0.15, g, 2.2, 2.95, 0));
    return grp;
  },
  archive(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.0, 2.2, 3.2, mat(DARKER), 0, 1.1, 0));
    grp.add(box(4.4, 0.4, 3.6, b, 0, 2.4, 0));
    for (const x of [-1.4, 0, 1.4]) grp.add(box(0.5, 1.4, 0.06, g, x, 1.2, 1.63)); // glowing tablet windows
    grp.add(cone(0.7, 1.4, b, 4, 0, 3.3, 0));
    grp.add(sph(0.16, g, 0, 4.1, 0));
    return grp;
  },
  pit(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(2.2, 2.6, 0.9, mat(DARKER), 8, 0, 0.45, 0));
    const pool = prim(new THREE.CircleGeometry(1.7, 12), glowMat(0x8f46ff, 0.8), 0, 0.95, 0, -Math.PI / 2);
    grp.add(pool);
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      grp.add(box(0.3, 1.6 + (i % 2) * 0.7, 0.3, b, Math.cos(a) * 2.3, 0.9, Math.sin(a) * 2.3, 0, a, 0.15));
    }
    return grp;
  },
  wtower(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.5, 1.1, 4.2, b, 5, 0, 2.1, 0));
    const eye = sph(0.35, g, 0, 4.6, 0);
    grp.add(eye);
    grp.add(prim(new THREE.TorusGeometry(0.55, 0.06, 6, 12), mat(DARKER), 0, 4.6, 0));
    return grp;
  },
  hearth(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(3.4, 4.0, 1.6, mat(ASH), 8, 0, 0.8, 0)); // mound
    grp.add(cyl(2.0, 2.6, 1.4, b, 7, 0, 2.3, 0));
    grp.add(cone(0.9, 2.0, g, 6, 0, 4.0, 0)); // great fire
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      grp.add(cone(0.25, 1.6, mat(BONE), 4, Math.cos(a) * 3.2, 1.6, Math.sin(a) * 3.2, 0, 0, 0.25 * Math.cos(a))); // ribs
    }
    return grp;
  },
  bonepit(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(1.6, 1.9, 0.8, mat(ASH), 7, 0, 0.4, 0));
    grp.add(cone(0.3, 1.4, mat(BONE), 4, -0.6, 1.2, 0.3, 0, 0, 0.4));
    grp.add(cone(0.3, 1.8, mat(BONE), 4, 0.5, 1.4, -0.4, 0, 0, -0.3));
    grp.add(sph(0.4, mat(BONE), 0.2, 1.0, 0.5)); // skull
    grp.add(sph(0.08, g, 0.1, 1.05, 0.85)); grp.add(sph(0.08, g, 0.32, 1.05, 0.82));
    return grp;
  },
  lodge(b, g) {
    const grp = new THREE.Group();
    grp.add(box(4.4, 1.8, 3.4, b, 0, 0.9, 0));
    grp.add(prim(new THREE.CylinderGeometry(0.1, 2.6, 1.6, 4), mat(WOOD), 0, 2.6, 0, 0, Math.PI / 4));
    grp.add(cone(0.4, 2.2, mat(BONE), 4, -2.3, 1.6, 1.4, 0, 0, 0.3)); // tusks at door
    grp.add(cone(0.4, 2.2, mat(BONE), 4, 2.3, 1.6, 1.4, 0, 0, -0.3));
    grp.add(box(0.8, 1.2, 0.1, g, 0, 0.9, 1.73)); // firelight door
    return grp;
  },
  den(b, g) {
    const grp = new THREE.Group();
    grp.add(sph(2.4, mat(ASH), 0, 0.4, 0)); // rock dome
    grp.add(box(1.6, 1.2, 0.4, mat(DARKER), 0, 0.7, 2.1));
    grp.add(box(1.2, 0.8, 0.1, g, 0, 0.6, 2.32)); // glowing maw
    grp.add(cone(0.25, 1.2, mat(BONE), 4, -1.4, 1.8, 1.2, 0.3));
    grp.add(cone(0.25, 1.2, mat(BONE), 4, 1.4, 1.8, 1.2, -0.3));
    return grp;
  },
  totem(b, g) {
    const grp = new THREE.Group();
    grp.add(cyl(0.5, 0.7, 3.8, mat(WOOD), 6, 0, 1.9, 0));
    grp.add(sph(0.45, mat(BONE), 0, 2.4, 0));
    grp.add(sph(0.4, mat(BONE), 0, 3.3, 0));
    grp.add(sph(0.09, g, -0.14, 3.38, 0.32)); grp.add(sph(0.09, g, 0.14, 3.38, 0.32));
    grp.add(sph(0.09, g, -0.13, 2.5, 0.38)); grp.add(sph(0.09, g, 0.13, 2.5, 0.38));
    grp.add(box(2.0, 0.18, 0.18, mat(BONE), 0, 4.0, 0, 0, 0, 0.1));
    return grp;
  },
  cairn(b, g) {
    const grp = new THREE.Group();
    grp.add(sph(1.2, mat(ASH), 0, 0.6, 0));
    grp.add(sph(0.9, mat(ASH), 0.7, 1.2, 0.3));
    grp.add(sph(0.7, b, -0.5, 1.6, -0.2));
    grp.add(sph(0.55, mat(BONE), 0, 2.4, 0)); // giant's skull on top
    grp.add(sph(0.1, g, -0.16, 2.45, 0.42)); grp.add(sph(0.1, g, 0.16, 2.45, 0.42));
    return grp;
  },
};

// ---------- resources & doodads ----------

export function buildResourceNode(type) {
  const grp = new THREE.Group();
  if (type === 'grain') {
    const m = mat(0x9c8434, { emissive: 0x6b5a14, ei: 0.25 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6;
      grp.add(cone(0.14, 0.9 + Math.random() * 0.5, m, 4, Math.cos(a) * r, 0.45, Math.sin(a) * r));
    }
  } else if (type === 'timber') {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 1.1 + (Math.random() - 0.5), z = (Math.random() - 0.5) * 1.4;
      grp.add(cyl(0.14, 0.22, 1.6, mat(0x2e2620), 5, x, 0.8, z));
      grp.add(cone(0.8, 2.0, mat(0x24332a), 6, x, 2.4, z));
    }
  } else if (type === 'bronze') {
    const m = mat(0x7a5024, { emissive: 0xa55f1e, ei: 0.35, metal: 0.5, rough: 0.5 });
    grp.add(sph(1.0, mat(DARK), 0, 0.5, 0));
    grp.add(prim(new THREE.OctahedronGeometry(0.55), m, -0.5, 1.0, 0.3));
    grp.add(prim(new THREE.OctahedronGeometry(0.4), m, 0.6, 0.9, -0.2));
    grp.add(prim(new THREE.OctahedronGeometry(0.3), m, 0.2, 1.3, 0.4));
  } else if (type === 'knowledge') {
    grp.add(box(1.0, 0.5, 1.0, mat(DARKER), 0, 0.25, 0));
    grp.add(box(0.55, 3.2, 0.55, mat(DARK), 0, 1.85, 0));
    grp.add(cone(0.4, 0.6, mat(DARK), 4, 0, 3.7, 0));
    for (let y = 0.8; y < 3.2; y += 0.5)
      grp.add(box(0.58, 0.18, 0.18, glowMat(0xb07fff, 1.2), 0, y, 0.22));
  }
  return grp;
}

export function buildDoodad(type) {
  const grp = new THREE.Group();
  if (type === 'rock') {
    grp.add(prim(new THREE.DodecahedronGeometry(0.7 + Math.random() * 0.8), mat(DARK), 0, 0.4, 0, Math.random(), Math.random()));
  } else if (type === 'monolith') {
    grp.add(box(0.8, 3 + Math.random() * 2, 0.5, mat(DARKER), 0, 1.8, 0, 0, Math.random(), (Math.random() - 0.5) * 0.2));
    if (Math.random() < 0.5) grp.add(box(0.84, 0.2, 0.2, glowMat(0x4a6a8a, 0.6), 0, 1.2, 0.18));
  } else if (type === 'ruin') {
    for (let i = 0; i < 3; i++)
      grp.add(box(0.5, 0.6 + Math.random() * 1.4, 0.5, mat(ASH), (Math.random() - 0.5) * 2.4, 0.5, (Math.random() - 0.5) * 2.4, 0, Math.random()));
  } else if (type === 'crystal') {
    grp.add(prim(new THREE.OctahedronGeometry(0.5), glowMat(0x355a7a, 0.7), 0, 0.5, 0, 0.3, 0.5));
  }
  return grp;
}

// ---------- factory ----------

const factionMats = new Map();
function getFactionMats(color, glow) {
  const key = color + ':' + glow;
  if (!factionMats.has(key)) {
    // Dark body tinted toward faction color; bright emissive accent.
    const c = new THREE.Color(color);
    const body = new THREE.Color(0x35353e).lerp(c, 0.4);
    factionMats.set(key, {
      b: new THREE.MeshStandardMaterial({ color: body, roughness: 0.8, metalness: 0.15, flatShading: true }),
      g: new THREE.MeshStandardMaterial({ color: 0x111114, emissive: glow, emissiveIntensity: 1.8, roughness: 0.5, flatShading: true }),
    });
  }
  return factionMats.get(key);
}

export function buildUnitMesh(modelKey, color, glow) {
  const { b, g } = getFactionMats(color, glow);
  const grp = (unitBuilders[modelKey] || unitBuilders.worker)(b, g);
  grp.scale.setScalar(1.35); // readability at RTS camera distance
  grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return grp;
}

export function buildBuildingMesh(modelKey, color, glow) {
  const { b, g } = getFactionMats(color, glow);
  const grp = (buildingBuilders[modelKey] || buildingBuilders.barracks)(b, g);
  grp.traverse(o => { if (o && o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}
