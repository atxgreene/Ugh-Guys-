// Procedural low-poly models. Style: dark obsidian/ash world, faction identity
// carried by emissive glow accents. All builders return a THREE.Group whose
// origin sits at ground level.
import * as THREE from 'three';
import { stoneMaps, blockMaps, woodMaps, boneMaps } from './textures.js';

// Attach a procedural PBR surface to a material; brightens base color to
// compensate for the albedo multiply.
function applySurface(m, kind, gain = 1.9) {
  const s = kind === 'wood' ? woodMaps() : kind === 'bone' ? boneMaps()
    : kind === 'blocks' ? blockMaps() : stoneMaps();
  m.map = s.map; m.normalMap = s.normalMap; m.roughnessMap = s.roughnessMap;
  m.normalScale = new THREE.Vector2(0.6, 0.6);
  m.color.multiplyScalar(gain);
}

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const m = new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.1,
      emissive: opts.emissive ?? 0x000000, emissiveIntensity: opts.ei ?? 1,
      flatShading: true,
    });
    // textured surfaces for the common structural materials (not for glows)
    if (!opts.emissive) {
      if (color === 0x3d3228 || color === 0x2e2620) applySurface(m, 'wood');
      else if (color === 0x6b6457) applySurface(m, 'bone');
      else if (color === 0x26262c || color === 0x1b1b20) applySurface(m, 'stone');
      else if (color === 0x3a3a40) applySurface(m, 'blocks');
    }
    matCache.set(key, m);
  }
  return matCache.get(key);
}

export function glowMat(color, intensity = 1.6) {
  return mat(0x111114, { emissive: color, ei: intensity, rough: 0.5 });
}

const DARK = 0x26262c, DARKER = 0x1b1b20, ASH = 0x3a3a40, BONE = 0x9c8d72, WOOD = 0x3d3228;
const LEATHER = 0x4a3526, CLOTH = 0x33304a, LINEN = 0xbfb49a, SKIN = 0x7a6450, HIDE = 0x5a4736;
// bronze with a little metalness so it catches the env reflections
const bronzeMat = () => mat(0x8a6a30, { metal: 0.55, rough: 0.45 });

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
const torus = (R, r, m, ...p) => prim(new THREE.TorusGeometry(R, r, 6, 14), m, ...p);
// a two-segment limb (upper + lower with a joint kink) — adds readable anatomy
function limb(grp, m, x, y, z, len, thick, lean = 0, side = 1) {
  const seg = len / 2;
  grp.add(cyl(thick, thick * 0.85, seg, m, 5, x, y - seg / 2, z, lean, 0, 0));
  grp.add(sph(thick * 0.95, m, x + Math.sin(lean) * seg, y - seg, z + Math.cos(lean) * 0 - 0));
  grp.add(cyl(thick * 0.8, thick * 0.7, seg, m, 5, x + side * 0.02, y - seg * 1.5, z, -lean * 0.5, 0, 0));
}

// ---------- units ----------
// Each unit builder receives (body, glow) materials derived from faction colors.

const unitBuilders = {
  // ---- Covenant Cities ----
  worker(b, g, a) {
    const grp = new THREE.Group();
    const cloth = mat(LEATHER);
    grp.add(cyl(0.16, 0.24, 0.62, cloth, 6, 0, 0.42, 0));        // tunic, slightly hunched
    grp.add(box(0.34, 0.34, 0.26, mat(WOOD), 0, 0.95, -0.18));   // load basket on the back
    grp.add(cyl(0.05, 0.05, 0.05, a, 6, 0, 0.78, 0.1));          // faction-color sash collar
    grp.add(sph(0.14, mat(SKIN), 0, 0.92, 0.02));                // head
    grp.add(box(0.3, 0.09, 0.32, a, 0, 1.0, 0));                 // faction work-cap
    limb(grp, cloth, 0.18, 0.62, 0.05, 0.4, 0.06, 0.7);          // arms gripping tool
    limb(grp, cloth, -0.16, 0.62, 0.05, 0.36, 0.06, 0.5);
    limb(grp, mat(DARK), 0.09, 0.2, 0, 0.36, 0.07);              // legs
    limb(grp, mat(DARK), -0.09, 0.2, 0, 0.36, 0.07);
    grp.add(cyl(0.035, 0.04, 1.1, mat(WOOD), 4, 0.26, 0.6, 0.18, 0, 0, -0.35)); // mattock haft
    grp.add(box(0.2, 0.1, 0.08, mat(DARK), 0.5, 0.95, 0.18, 0, 0, -0.35));      // mattock head
    return grp;
  },
  spearman(b, g, a) {
    const grp = new THREE.Group();
    grp.add(box(0.36, 0.5, 0.24, b, 0, 0.62, 0));               // bronze cuirass torso
    grp.add(box(0.4, 0.12, 0.28, bronzeMat(), 0, 0.9, 0));      // shoulder yoke
    grp.add(box(0.16, 0.5, 0.05, a, 0, 0.66, 0.13));            // faction tabard down the chest
    grp.add(cyl(0.06, 0.1, 0.2, mat(LEATHER), 6, 0, 0.45, 0));  // belt/kilt waist
    grp.add(cone(0.2, 0.22, a, 8, 0, 0.32, 0));                 // faction-blue pteruges kilt
    grp.add(sph(0.13, mat(SKIN), 0, 1.06, 0));                  // head
    grp.add(cyl(0.15, 0.16, 0.2, bronzeMat(), 8, 0, 1.1, 0));   // conical helm
    grp.add(cone(0.05, 0.34, g, 4, 0, 1.36, -0.04, -0.2));      // tall crest
    limb(grp, mat(SKIN), -0.24, 0.78, 0.02, 0.42, 0.06, 0.3);   // shield arm
    limb(grp, mat(SKIN), 0.24, 0.78, 0.05, 0.42, 0.06, -0.4);   // spear arm
    limb(grp, mat(DARK), 0.1, 0.34, 0, 0.34, 0.07);
    limb(grp, mat(DARK), -0.1, 0.34, 0, 0.34, 0.07);
    grp.add(cyl(0.28, 0.28, 0.08, bronzeMat(), 14, -0.34, 0.62, 0.08, Math.PI / 2, 0, 0)); // round shield
    grp.add(cyl(0.2, 0.2, 0.085, a, 14, -0.34, 0.62, 0.1, Math.PI / 2, 0, 0));  // shield rondel (faction color)
    grp.add(torus(0.12, 0.03, g, -0.34, 0.62, 0.14, 0, 0, 0));  // shield boss glow
    grp.add(cyl(0.025, 0.025, 1.7, mat(WOOD), 5, 0.36, 0.85, 0)); // spear shaft
    grp.add(cone(0.06, 0.28, bronzeMat(), 5, 0.36, 1.78, 0));     // spearhead
    return grp;
  },
  archer(b, g) {                                                  // sling-archer, light & poised
    const grp = new THREE.Group();
    grp.add(cyl(0.14, 0.2, 0.52, mat(LINEN), 6, 0, 0.52, 0));     // short tunic
    grp.add(cone(0.2, 0.26, mat(LINEN), 7, 0, 0.34, 0));          // skirt hem
    grp.add(sph(0.12, mat(SKIN), 0, 0.92, 0.02));
    grp.add(box(0.27, 0.08, 0.27, g, 0, 1.0, 0));                 // glowing headband
    grp.add(box(0.06, 0.5, 0.22, mat(LEATHER), -0.02, 0.7, -0.16, 0.2)); // quiver on back
    for (let i = 0; i < 3; i++) grp.add(cyl(0.01, 0.01, 0.3, mat(WOOD), 3, -0.02 + i * 0.04, 1.0, -0.2, 0.2));
    limb(grp, mat(SKIN), 0.22, 0.74, 0.08, 0.46, 0.05, -0.7);     // extended sling arm
    limb(grp, mat(SKIN), -0.2, 0.74, 0.05, 0.4, 0.05, 0.5);
    limb(grp, mat(SKIN), 0.09, 0.32, 0.05, 0.34, 0.06, -0.15);    // striding legs
    limb(grp, mat(SKIN), -0.09, 0.32, -0.05, 0.34, 0.06, 0.15);
    grp.add(torus(0.16, 0.02, mat(LEATHER), 0.46, 0.62, 0.18, 0.4, 0.6, 0)); // whirling sling
    grp.add(sph(0.05, mat(DARK), 0.46, 0.46, 0.18));              // sling stone
    return grp;
  },
  chariot(b, g, a) {
    const grp = new THREE.Group();
    const horseMat = mat(ASH);
    const horse = (x) => {
      grp.add(box(0.28, 0.34, 0.85, horseMat, x, 0.62, 0.75));    // body
      grp.add(box(0.18, 0.34, 0.22, horseMat, x, 0.86, 1.12));    // neck
      grp.add(box(0.14, 0.18, 0.26, horseMat, x, 1.0, 1.28));     // head
      grp.add(box(0.04, 0.22, 0.04, mat(DARKER), x, 1.12, 1.18)); // mane
      [0.32, -0.32].forEach(zz => { grp.add(cyl(0.05, 0.04, 0.6, horseMat, 4, x, 0.3, 0.75 + zz)); });
    };
    horse(-0.22); horse(0.22);
    grp.add(box(0.78, 0.34, 0.7, mat(WOOD), 0, 0.5, -0.25));       // chariot cab
    grp.add(box(0.6, 0.46, 0.04, a, 0, 0.46, -0.6));              // faction war-banner on the cab
    grp.add(box(0.82, 0.2, 0.06, bronzeMat(), 0, 0.72, -0.6));     // back rail
    grp.add(box(0.08, 0.16, 0.7, g, 0.42, 0.62, -0.25));           // glowing side trim
    grp.add(box(0.08, 0.16, 0.7, g, -0.42, 0.62, -0.25));
    const wheel = (x) => {
      grp.add(torus(0.34, 0.06, mat(DARKER), x, 0.34, -0.32, 0, Math.PI / 2, 0));
      for (let i = 0; i < 6; i++) grp.add(cyl(0.02, 0.02, 0.62, mat(WOOD), 3, x, 0.34, -0.32, 0, 0, i / 6 * Math.PI));
    };
    wheel(-0.5); wheel(0.5);
    grp.add(box(0.06, 0.06, 1.0, mat(WOOD), 0, 0.5, 0.4));         // yoke pole
    // driver
    grp.add(box(0.26, 0.42, 0.2, b, 0, 0.78, -0.25));
    grp.add(sph(0.12, mat(SKIN), 0, 1.08, -0.25));
    grp.add(cyl(0.13, 0.14, 0.16, bronzeMat(), 8, 0, 1.12, -0.25)); // helm
    grp.add(cone(0.04, 0.22, g, 4, 0, 1.32, -0.27, -0.2));
    grp.add(cyl(0.012, 0.012, 0.9, mat(LEATHER), 3, 0, 0.85, 0.25, 0.9)); // reins
    return grp;
  },
  guard(b, g, a) {                                                 // temple guard — tower shield + glaive
    const grp = new THREE.Group();
    grp.add(box(0.42, 0.64, 0.3, b, 0, 0.68, 0));                  // heavy armored torso
    grp.add(cone(0.3, 0.42, a, 8, 0, 0.34, 0));                    // faction-color robe hem
    grp.add(box(0.5, 0.14, 0.34, bronzeMat(), 0, 1.0, 0));         // broad pauldrons
    grp.add(sph(0.14, mat(SKIN), 0, 1.16, 0));
    grp.add(cyl(0.16, 0.17, 0.24, bronzeMat(), 8, 0, 1.2, 0));     // tall helm
    grp.add(box(0.5, 0.06, 0.06, g, 0, 1.42, 0));                  // winged halo bar
    grp.add(cone(0.04, 0.18, g, 4, 0.26, 1.5, 0, 0, 0, -0.5));     // halo horns
    grp.add(cone(0.04, 0.18, g, 4, -0.26, 1.5, 0, 0, 0, 0.5));
    limb(grp, mat(DARK), 0.16, 0.36, 0, 0.36, 0.08);
    limb(grp, mat(DARK), -0.16, 0.36, 0, 0.36, 0.08);
    // tower shield (full-height) on the left
    grp.add(box(0.46, 0.92, 0.1, mat(DARK), -0.42, 0.62, 0.1));
    grp.add(box(0.12, 0.7, 0.03, g, -0.42, 0.62, 0.16));          // shield sigil
    grp.add(torus(0.1, 0.02, g, -0.42, 0.62, 0.17, 0, 0, 0));
    // glaive on the right
    grp.add(cyl(0.035, 0.035, 1.5, mat(WOOD), 5, 0.42, 0.9, 0));
    grp.add(cone(0.07, 0.4, bronzeMat(), 4, 0.42, 1.78, 0));
    grp.add(box(0.04, 0.36, 0.02, g, 0.42, 1.74, 0.04));          // glaive edge glow
    return grp;
  },
  prophet(b, g, a) {                                               // robed seer, raised hand, flame
    const grp = new THREE.Group();
    grp.add(cone(0.34, 0.95, mat(LINEN), 8, 0, 0.48, 0));          // outer robe
    grp.add(cone(0.26, 0.7, b, 8, 0, 0.55, 0.02));                 // inner mantle (faction tint)
    grp.add(box(0.5, 0.1, 0.18, a, 0, 0.95, 0));                   // faction shoulder shawl
    grp.add(sph(0.13, mat(SKIN), 0, 1.12, 0.02));
    grp.add(cone(0.16, 0.2, mat(LINEN), 7, 0, 1.26, 0));           // tall headwrap
    grp.add(box(0.1, 0.22, 0.06, mat(LINEN), 0, 1.02, 0.12));      // beard
    grp.add(torus(0.22, 0.02, g, 0, 1.42, 0, Math.PI / 2, 0, 0));  // halo ring above
    limb(grp, mat(LINEN), 0.22, 0.84, 0.04, 0.5, 0.06, -1.1);      // raised hand
    limb(grp, mat(LINEN), -0.2, 0.8, 0.04, 0.4, 0.06, 0.4);        // staff hand
    grp.add(cyl(0.03, 0.035, 1.5, mat(WOOD), 5, -0.3, 0.75, 0));   // staff
    grp.add(sph(0.1, g, -0.3, 1.55, 0));                           // staff flame
    grp.add(sph(0.09, g, 0.34, 1.35, 0.04));                       // flame summoned over raised hand
    return grp;
  },

  // ---- Watcher Remnant ----
  starmetal(b, g, a) {                                             // star-iron juggernaut — silver plate
    const grp = new THREE.Group();
    grp.add(box(0.5, 0.7, 0.4, a, 0, 0.66, 0));                    // star-metal plated torso
    grp.add(box(0.6, 0.2, 0.5, a, 0, 1.02, 0));                    // heavy gorget
    grp.add(prim(new THREE.OctahedronGeometry(0.16), a, -0.34, 1.06, 0)); // shoulder spikes
    grp.add(prim(new THREE.OctahedronGeometry(0.16), a, 0.34, 1.06, 0));
    grp.add(box(0.26, 0.24, 0.26, a, 0, 1.22, 0));                 // faceted helm
    grp.add(box(0.22, 0.04, 0.06, g, 0, 1.24, 0.16));              // visor slit glow
    grp.add(box(0.14, 0.5, 0.04, g, 0, 0.66, 0.21));               // chest seam glow
    grp.add(cone(0.34, 0.3, mat(DARKER), 6, 0, 0.32, 0));          // dark under-skirt
    limb(grp, mat(DARKER), 0.2, 0.38, 0, 0.36, 0.09);
    limb(grp, mat(DARKER), -0.2, 0.38, 0, 0.36, 0.09);
    limb(grp, a, -0.3, 0.92, 0.04, 0.42, 0.07, 0.3);              // armored arms
    limb(grp, a, 0.32, 0.92, 0.06, 0.44, 0.07, -0.3);
    // planted greatsword
    grp.add(box(0.12, 0.2, 0.12, mat(DARKER), 0.46, 0.5, 0.18));   // pommel/guard
    grp.add(box(0.16, 1.3, 0.05, mat(0x6a7080, { metal: 0.6, rough: 0.35 }), 0.46, 1.2, 0.18));
    grp.add(box(0.05, 1.2, 0.02, g, 0.46, 1.2, 0.21));             // blade fuller glow
    return grp;
  },
  adept(b, g, a, g2) {                                             // hooded sigil-reader, floating
    const grp = new THREE.Group();
    grp.add(cone(0.3, 1.05, b, 7, 0, 0.55, 0));                    // long robe (no legs — hovers)
    grp.add(cone(0.18, 0.4, mat(DARKER), 7, 0, 0.95, 0));          // hood
    grp.add(sph(0.08, g2 || g, 0, 1.04, 0.1));                     // glowing face-void (sigil magenta)
    grp.add(box(0.46, 0.12, 0.2, mat(DARKER), 0, 0.92, 0));        // shoulders
    limb(grp, b, 0.24, 0.8, 0.06, 0.42, 0.05, -0.6);              // hand presenting orb
    limb(grp, b, -0.22, 0.78, 0.04, 0.38, 0.05, 0.4);
    grp.add(sph(0.1, g2 || g, 0.4, 0.66, 0.12));                  // sigil orb (magenta)
    grp.add(torus(0.34, 0.025, g, 0, 1.2, 0, Math.PI / 2, 0, 0)); // two crossed sigil rings overhead
    grp.add(torus(0.34, 0.025, g, 0, 1.2, 0, 0, 0, Math.PI / 2));
    grp.add(sph(0.06, g2 || g, 0, 1.2, 0));
    return grp;
  },
  skyfire(b, g, a, g2) {                                           // star-caller, orbiting rings
    const grp = new THREE.Group();
    grp.add(cone(0.34, 1.2, b, 7, 0, 0.6, 0));                     // tall robe
    grp.add(cone(0.2, 0.42, mat(DARKER), 7, 0, 1.04, 0));          // cowl
    grp.add(sph(0.07, g2 || g, 0, 1.12, 0.1));
    grp.add(box(0.5, 0.12, 0.22, mat(DARKER), 0, 1.0, 0));
    limb(grp, b, 0.24, 0.86, 0.05, 0.5, 0.05, -1.2);              // staff raised high
    limb(grp, b, -0.22, 0.82, 0.05, 0.4, 0.05, 0.4);
    grp.add(cyl(0.03, 0.03, 1.7, mat(DARKER), 5, 0.34, 0.95, 0)); // staff
    grp.add(torus(0.22, 0.04, g, 0.34, 1.85, 0, Math.PI / 2, 0, 0)); // star ring at the tip
    grp.add(sph(0.13, g, 0.34, 1.85, 0));                         // captive star
    for (let i = 0; i < 3; i++)                                    // orbiting glyph rings (alternating hue)
      grp.add(torus(0.4 + i * 0.06, 0.02, i % 2 ? (g2 || g) : g, 0, 1.0, 0, i * 0.7, i * 1.1, Math.PI / 2));
    return grp;
  },
  hybrid(b, g) {                                                   // nephilim-hybrid abomination
    const grp = new THREE.Group();
    grp.add(box(0.7, 0.9, 0.5, b, 0, 0.95, 0));                    // hunched broad torso
    grp.add(box(0.95, 0.3, 0.6, b, 0, 1.42, 0));                   // hulking shoulders
    grp.add(box(0.26, 0.24, 0.34, mat(DARKER), 0, 1.66, 0.05));    // beast skull head
    grp.add(box(0.16, 0.06, 0.1, g, 0, 1.66, 0.22));              // jaw glow
    grp.add(cone(0.05, 0.4, mat(BONE), 4, -0.16, 1.78, 0.02, 0.3, 0, -0.3)); // horns
    grp.add(cone(0.05, 0.4, mat(BONE), 4, 0.16, 1.78, 0.02, 0.3, 0, 0.3));
    grp.add(box(0.26, 0.26, 0.05, g, 0, 1.05, 0.26));             // chest sigil glow
    // ragged wings
    grp.add(box(0.5, 0.7, 0.04, mat(DARKER), -0.6, 1.45, -0.1, 0, 0.5, 0.3));
    grp.add(box(0.5, 0.7, 0.04, mat(DARKER), 0.6, 1.45, -0.1, 0, -0.5, -0.3));
    limb(grp, b, -0.42, 1.2, 0.06, 0.6, 0.1, 0.3);               // long clawed arms
    limb(grp, b, 0.42, 1.2, 0.06, 0.6, 0.1, -0.3);
    grp.add(prim(new THREE.OctahedronGeometry(0.1), mat(BONE), -0.5, 0.62, 0.12)); // claws
    grp.add(prim(new THREE.OctahedronGeometry(0.1), mat(BONE), 0.5, 0.62, 0.12));
    limb(grp, b, 0.2, 0.55, 0, 0.5, 0.12);                       // digitigrade legs
    limb(grp, b, -0.2, 0.55, 0, 0.5, 0.12);
    return grp;
  },

  // ---- Nephilim Clans ----
  raider(b, g, a) {                                                // lean, fast, war-axe
    const grp = new THREE.Group();
    grp.add(box(0.3, 0.5, 0.22, mat(HIDE), 0, 0.66, 0));          // bare hide torso
    grp.add(box(0.36, 0.1, 0.26, a, 0, 0.92, 0));                 // dried-blood strap harness
    grp.add(box(0.08, 0.4, 0.04, a, -0.14, 0.66, 0.12));         // war-sash
    grp.add(box(0.16, 0.1, 0.04, g, 0, 0.74, 0.12));             // war-paint glow
    grp.add(sph(0.13, mat(SKIN), 0, 1.04, 0.02));
    grp.add(cyl(0.04, 0.02, 0.34, mat(DARK), 4, 0, 1.3, -0.06));  // topknot
    grp.add(box(0.34, 0.06, 0.06, mat(BONE), 0, 1.14, 0));        // bone brow-band
    limb(grp, mat(SKIN), 0.22, 0.78, 0.06, 0.46, 0.06, -0.6);     // axe arm cocked
    limb(grp, mat(SKIN), -0.2, 0.78, 0.04, 0.42, 0.06, 0.5);
    limb(grp, mat(SKIN), 0.1, 0.34, 0.06, 0.36, 0.07, -0.2);      // mid-stride
    limb(grp, mat(SKIN), -0.1, 0.34, -0.06, 0.36, 0.07, 0.2);
    grp.add(cyl(0.025, 0.025, 0.7, mat(WOOD), 4, 0.4, 0.85, 0.1, 0, 0, -0.4)); // axe haft
    grp.add(box(0.04, 0.26, 0.18, mat(DARKER), 0.62, 1.05, 0.1, 0, 0, -0.4));  // axe blade
    return grp;
  },
  warwagon(b, g) {                                                 // Easter egg: the Landonian Warwagon — a white GMC
    const grp = new THREE.Group();
    const white = mat(0xe6e7ea, { rough: 0.45, metal: 0.25 });
    const blk = mat(0x14141a);
    const glass = mat(0x223040, { rough: 0.2, metal: 0.5 });
    const red = mat(0xc8181c, { emissive: 0xc8181c, ei: 0.4 });   // GMC-red grille
    const chrome = mat(0xb8bcc4, { rough: 0.3, metal: 0.6 });
    grp.add(box(1.0, 0.42, 2.0, white, 0, 0.56, 0));               // body / chassis
    grp.add(box(0.96, 0.34, 0.4, blk, 0, 0.5, -0.7));              // open truck bed
    grp.add(box(0.98, 0.34, 0.95, white, 0, 0.95, 0.32));          // cab
    grp.add(box(0.88, 0.28, 0.62, glass, 0, 0.98, 0.42));          // windscreen + windows
    grp.add(box(0.86, 0.34, 0.1, red, 0, 0.6, 1.02));              // red grille (GMC)
    grp.add(box(0.92, 0.12, 0.08, chrome, 0, 0.42, 1.04));         // chrome bumper
    grp.add(box(0.18, 0.12, 0.06, glowMat(0xfff3d0, 1.6), -0.32, 0.66, 1.03)); // headlight L
    grp.add(box(0.18, 0.12, 0.06, glowMat(0xfff3d0, 1.6), 0.32, 0.66, 1.03));  // headlight R
    grp.add(box(0.72, 0.07, 0.14, blk, 0, 1.16, 0.34));            // roof light bar
    for (let i = -2; i <= 2; i++) grp.add(box(0.1, 0.05, 0.09, glowMat(0xbfe0ff, 1.3), i * 0.14, 1.19, 0.36));
    const wheel = (x, z) => grp.add(cyl(0.27, 0.27, 0.2, blk, 10, x, 0.27, z, 0, 0, Math.PI / 2));
    wheel(-0.54, 0.62); wheel(0.54, 0.62); wheel(-0.54, -0.6); wheel(0.54, -0.6);
    grp.add(cyl(0.2, 0.2, 0.21, chrome, 10, -0.54, 0.27, 0.62, 0, 0, Math.PI / 2));  // hubcaps
    grp.add(cyl(0.2, 0.2, 0.21, chrome, 10, 0.54, 0.27, 0.62, 0, 0, Math.PI / 2));
    // the Landonian himself — maroon blazer + shades, riding in the bed
    grp.add(cyl(0.14, 0.17, 0.46, mat(0x6e2230), 6, 0, 1.0, -0.66));   // maroon torso
    grp.add(sph(0.13, mat(SKIN), 0, 1.28, -0.66));                     // head
    grp.add(box(0.22, 0.06, 0.05, blk, 0, 1.3, -0.55));                // sunglasses
    grp.add(box(0.05, 0.05, 0.16, mat(0xd8c89a), 0.16, 1.0, -0.5, 0.4)); // raised drink
    return grp;
  },
  champion(b, g, a) {                                              // bone-club bruiser
    const grp = new THREE.Group();
    grp.add(box(0.5, 0.66, 0.36, mat(HIDE), 0, 0.78, 0));         // massive chest
    grp.add(cone(0.4, 0.5, a, 8, 0, 0.4, 0));                    // dried-blood war-kilt
    grp.add(box(0.5, 0.12, 0.05, a, 0, 0.6, 0.2));              // blood-daubed belt
    grp.add(box(0.7, 0.2, 0.4, mat(BONE), 0, 1.16, 0));          // bone pauldrons
    grp.add(prim(new THREE.DodecahedronGeometry(0.16), mat(BONE), -0.34, 1.22, 0));
    grp.add(prim(new THREE.DodecahedronGeometry(0.16), mat(BONE), 0.34, 1.22, 0));
    grp.add(sph(0.16, mat(SKIN), 0, 1.32, 0));
    grp.add(box(0.34, 0.08, 0.34, mat(BONE), 0, 1.42, 0));       // bone circlet
    grp.add(cone(0.07, 0.32, mat(BONE), 4, -0.18, 1.56, 0, 0, 0, 0.4)); // horns
    grp.add(cone(0.07, 0.32, mat(BONE), 4, 0.18, 1.56, 0, 0, 0, -0.4));
    grp.add(box(0.24, 0.12, 0.05, g, 0, 1.0, 0.19));            // chest war-paint glow
    limb(grp, mat(SKIN), 0.34, 0.96, 0.05, 0.56, 0.1, -0.5);    // huge club arm
    limb(grp, mat(SKIN), -0.32, 0.94, 0.04, 0.5, 0.09, 0.3);
    limb(grp, mat(SKIN), 0.16, 0.4, 0, 0.42, 0.11);
    limb(grp, mat(SKIN), -0.16, 0.4, 0, 0.42, 0.11);
    grp.add(cyl(0.08, 0.16, 1.3, mat(BONE), 6, 0.6, 1.1, 0.05, 0, 0, -0.45)); // bone club
    grp.add(prim(new THREE.DodecahedronGeometry(0.24), mat(BONE), 0.95, 1.55, 0.05)); // club head
    return grp;
  },
  warbeast(b, g) {                                                 // spined quadruped
    const grp = new THREE.Group();
    grp.add(box(0.46, 0.42, 1.0, mat(HIDE), 0, 0.56, 0));         // body
    grp.add(box(0.36, 0.34, 0.42, mat(HIDE), 0, 0.62, 0.62));     // chest
    grp.add(box(0.3, 0.26, 0.34, mat(HIDE), 0, 0.66, 0.92));      // head
    grp.add(box(0.2, 0.12, 0.12, mat(DARKER), 0, 0.58, 1.12));    // snout
    grp.add(sph(0.05, g, -0.1, 0.74, 1.0)); grp.add(sph(0.05, g, 0.1, 0.74, 1.0)); // eyes
    grp.add(cone(0.06, 0.22, mat(BONE), 4, -0.16, 0.78, 0.96, -0.3, 0, -0.3)); // tusks
    grp.add(cone(0.06, 0.22, mat(BONE), 4, 0.16, 0.78, 0.96, -0.3, 0, 0.3));
    for (let i = 0; i < 5; i++)                                    // spine ridge
      grp.add(cone(0.07, 0.2 + (i % 2) * 0.1, mat(BONE), 4, 0, 0.82, 0.4 - i * 0.22));
    [0.36, -0.34].forEach(z => {                                  // four legs
      grp.add(cyl(0.08, 0.06, 0.5, mat(HIDE), 4, 0.2, 0.26, z));
      grp.add(cyl(0.08, 0.06, 0.5, mat(HIDE), 4, -0.2, 0.26, z));
    });
    grp.add(cyl(0.06, 0.02, 0.6, mat(HIDE), 4, 0, 0.6, -0.6, -0.6)); // tail
    return grp;
  },
  giant(b, g) {                                                    // mountain giant — towering, craggy
    const grp = new THREE.Group();
    limb(grp, mat(HIDE), -0.5, 1.0, 0, 1.0, 0.26);               // thick legs
    limb(grp, mat(HIDE), 0.5, 1.0, 0, 1.0, 0.26);
    grp.add(box(0.6, 0.4, 0.7, mat(LEATHER), 0, 0.45, 0));       // loin wrap
    grp.add(box(1.4, 1.3, 0.85, mat(HIDE), 0, 1.7, 0));          // huge torso
    grp.add(box(1.85, 0.5, 1.0, mat(HIDE), 0, 2.45, 0));         // massive shoulders
    grp.add(prim(new THREE.DodecahedronGeometry(0.5), mat(0x4a4640), -1.0, 2.6, 0)); // boulder pauldron
    grp.add(sph(0.4, mat(SKIN), 0.15, 2.95, 0.05));             // head (off-centre, brutish)
    grp.add(box(0.6, 0.12, 0.5, mat(BONE), 0.15, 3.2, 0));      // bone brow
    grp.add(sph(0.09, g, 0.0, 3.0, 0.32)); grp.add(sph(0.09, g, 0.3, 3.0, 0.32)); // glowing eyes
    grp.add(box(0.8, 0.85, 0.1, g, 0, 1.85, 0.46));            // chest rune-slab
    grp.add(torus(0.26, 0.04, mat(DARKER), 0, 1.85, 0.5, 0, 0, 0));
    limb(grp, mat(HIDE), -1.2, 2.3, 0, 1.3, 0.28, 0.25);        // arms
    limb(grp, mat(HIDE), 1.2, 2.3, 0, 1.3, 0.3, -0.2);
    grp.add(cyl(0.16, 0.34, 2.0, mat(WOOD), 6, 1.4, 1.2, 0.35, 0.5)); // ripped-tree club
    grp.add(prim(new THREE.DodecahedronGeometry(0.45), mat(0x2c3a2c), 1.95, 2.05, 0.6)); // root-ball
    return grp;
  },
  shaman(b, g, a) {                                               // antlered skull-speaker
    const grp = new THREE.Group();
    grp.add(cone(0.3, 0.95, mat(HIDE), 7, 0, 0.5, 0));           // hide cloak
    grp.add(box(0.4, 0.5, 0.1, a, 0, 0.7, -0.16));               // dried-blood back drape
    grp.add(sph(0.14, mat(SKIN), 0, 1.06, 0.02));
    grp.add(sph(0.17, mat(BONE), 0, 1.12, 0.04));               // skull headdress over face
    grp.add(box(0.18, 0.06, 0.06, mat(DARKER), 0, 1.08, 0.16)); // skull eye band
    grp.add(cone(0.1, 0.5, mat(BONE), 4, -0.14, 1.34, 0, 0.2, 0, 0.5)); // antlers
    grp.add(cone(0.1, 0.5, mat(BONE), 4, 0.14, 1.34, 0, 0.2, 0, -0.5));
    grp.add(cone(0.06, 0.26, mat(BONE), 4, -0.24, 1.5, 0, 0.3, 0, 0.6));
    grp.add(cone(0.06, 0.26, mat(BONE), 4, 0.24, 1.5, 0, 0.3, 0, -0.6));
    limb(grp, mat(HIDE), 0.24, 0.8, 0.04, 0.42, 0.06, -0.5);
    limb(grp, mat(HIDE), -0.22, 0.78, 0.04, 0.38, 0.06, 0.4);
    grp.add(cyl(0.03, 0.04, 1.4, mat(WOOD), 5, 0.32, 0.7, 0));   // staff
    grp.add(sph(0.13, mat(BONE), 0.32, 1.5, 0));                // skull atop staff
    grp.add(sph(0.07, g, 0.32, 1.52, 0.08));                    // ember in the skull
    return grp;
  },
  devourer(b, g) {                                                // neutral guardian beast — hexapod maw
    const grp = new THREE.Group();
    grp.add(box(0.7, 0.5, 1.2, mat(0x3a3030), 0, 0.58, 0));      // low body
    grp.add(box(0.6, 0.5, 0.55, mat(0x3a3030), 0, 0.66, 0.78));  // head block
    grp.add(box(0.5, 0.18, 0.3, mat(DARKER), 0, 0.5, 1.0));      // lower jaw
    grp.add(box(0.5, 0.18, 0.3, mat(DARKER), 0, 0.78, 1.02));    // upper jaw
    for (let i = 0; i < 4; i++) {                                 // teeth
      grp.add(cone(0.04, 0.16, mat(BONE), 4, -0.18 + i * 0.12, 0.6, 1.12, Math.PI));
      grp.add(cone(0.04, 0.16, mat(BONE), 4, -0.18 + i * 0.12, 0.74, 1.12));
    }
    grp.add(box(0.4, 0.1, 0.1, g, 0, 0.66, 1.05));              // maw glow
    grp.add(sph(0.06, g, -0.18, 0.92, 0.82)); grp.add(sph(0.06, g, 0.18, 0.92, 0.82)); // eyes
    grp.add(sph(0.04, g, -0.26, 0.84, 0.74)); grp.add(sph(0.04, g, 0.26, 0.84, 0.74)); // extra eyes
    for (let i = 0; i < 5; i++) grp.add(cone(0.09, 0.3, mat(BONE), 4, 0, 0.82, 0.3 - i * 0.22)); // back spines
    [0.4, 0, -0.45].forEach(z => {                               // six legs
      grp.add(cyl(0.09, 0.05, 0.5, mat(0x3a3030), 4, 0.3, 0.24, z, 0, 0, -0.3));
      grp.add(cyl(0.09, 0.05, 0.5, mat(0x3a3030), 4, -0.3, 0.24, z, 0, 0, 0.3));
    });
    grp.add(cyl(0.12, 0.02, 0.9, mat(0x3a3030), 4, 0, 0.6, -0.9, -0.5)); // tail
    grp.add(cone(0.08, 0.2, mat(BONE), 4, 0, 0.75, -1.3, -1.2));         // tail barb
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
  barracks(b, g, a) {
    const grp = new THREE.Group();
    grp.add(box(4.6, 1.6, 3.4, mat(ASH), 0, 0.8, 0));
    grp.add(box(4.8, 0.5, 3.6, b, 0, 1.85, 0));
    grp.add(box(0.4, 2.6, 0.4, b, -2.0, 1.3, 1.5));
    grp.add(box(0.4, 2.6, 0.4, b, 2.0, 1.3, 1.5)); // banner posts
    grp.add(box(0.32, 1.1, 0.06, a || g, -2.0, 2.35, 1.55));
    grp.add(box(0.32, 1.1, 0.06, a || g, 2.0, 2.35, 1.55)); // faction-color banners
    grp.add(box(0.16, 0.5, 0.04, g, -2.0, 2.05, 1.6));
    grp.add(box(0.16, 0.5, 0.04, g, 2.0, 2.05, 1.6)); // glowing sigil on each banner
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

// Timber scaffold that wraps a building under construction. `span` is footprint
// world-width, `tall` the build height. Cheap: corner poles + lashing beams + planks.
export function buildScaffold(span, tall) {
  const grp = new THREE.Group();
  const wood = mat(0x3d3228), rope = mat(0x2e2620);
  const h = Math.max(2.2, tall * 0.95);
  const r = span * 0.5 + 0.35;
  const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
  for (const [x, z] of corners) {
    grp.add(cyl(0.09, 0.11, h, wood, 5, x, h / 2, z));
    // angled brace
    grp.add(cyl(0.05, 0.05, h * 0.7, wood, 4, x * 0.7, h * 0.4, z * 0.7, 0.35 * Math.sign(z || 1), 0, 0.35 * Math.sign(x || 1)));
  }
  for (const y of [h * 0.45, h * 0.82]) {
    grp.add(box(r * 2 + 0.2, 0.07, 0.07, rope, 0, y, -r));
    grp.add(box(r * 2 + 0.2, 0.07, 0.07, rope, 0, y, r));
    grp.add(box(0.07, 0.07, r * 2 + 0.2, rope, -r, y, 0));
    grp.add(box(0.07, 0.07, r * 2 + 0.2, rope, r, y, 0));
    // a couple of working planks
    grp.add(box(r * 1.6, 0.06, 0.4, wood, (Math.random() - 0.5) * r, y + 0.05, -r));
  }
  grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return grp;
}

// Flickering flame sprite cluster for burning/damaged buildings.
export function buildFireCluster(n, scale = 1) {
  const grp = new THREE.Group();
  const fire = new THREE.MeshBasicMaterial({ color: 0xff7a30, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const core = new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false });
  for (let i = 0; i < n; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.28 * scale, 0.8 * scale, 5), i % 2 ? core : fire);
    f.position.set((Math.random() - 0.5) * scale * 1.6, 0.4 * scale, (Math.random() - 0.5) * scale * 1.6);
    f.userData.phase = Math.random() * 6.28;
    grp.add(f);
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
  } else if (type === 'fallen_obelisk') {
    // a toppled, half-buried Watcher pillar — broken sacred geometry
    const ob = box(0.7, 4.5, 0.7, mat(DARKER), 0, 0.45, 0, 0, Math.random() * 0.5, Math.PI / 2 - 0.12);
    grp.add(ob);
    grp.add(box(0.74, 0.16, 0.16, glowMat(0x6f8cff, 0.5), 0.2, 0.55, 0.37));
    grp.add(box(0.74, 0.16, 0.16, glowMat(0x6f8cff, 0.5), -1.0, 0.55, 0.37));
    grp.add(prim(new THREE.DodecahedronGeometry(0.5), mat(DARK), 2.3, 0.3, 0.2)); // broken cap
  } else if (type === 'altar') {
    // abandoned offering altar, soot-stained
    grp.add(cyl(1.1, 1.3, 0.5, mat(ASH), 8, 0, 0.25, 0));
    grp.add(box(1.0, 0.7, 1.0, mat(0x3a3a40), 0, 0.85, 0));
    grp.add(box(1.2, 0.18, 1.2, mat(DARK), 0, 1.28, 0));
    grp.add(prim(new THREE.CircleGeometry(0.45, 10), glowMat(0xff6a30, 0.35), 0, 1.39, 0, -Math.PI / 2)); // cold embers
  } else if (type === 'giant_bones') {
    // half-buried Nephilim ribcage rising from the earth
    const bm = mat(BONE);
    grp.add(cyl(0.18, 0.22, 1.0, bm, 5, 0, 0.3, 0, 0, 0, 0.4)); // spine stub
    for (let i = 0; i < 5; i++) {
      const t = i / 4, x = (t - 0.5) * 2.4;
      const rib = prim(new THREE.TorusGeometry(0.9 - Math.abs(t - 0.5) * 0.6, 0.1, 5, 9, Math.PI), bm,
        x, 0.1, 0, 0, 0, 0);
      rib.rotation.z = 0.1 * (i - 2);
      grp.add(rib);
    }
  } else if (type === 'giant_weapon') {
    // a colossal broken bronze blade thrust into the ground
    grp.add(box(0.5, 5.0, 0.16, mat(0x6b5024, { metal: 0.5, rough: 0.5 }), 0, 1.6, 0, 0.12, 0.4, 0.18));
    grp.add(box(0.9, 0.6, 0.4, mat(WOOD), 0, -0.7, 0, 0.12, 0.4, 0.18)); // buried hilt/guard
    grp.add(prim(new THREE.DodecahedronGeometry(0.4), mat(DARK), 0.5, 0.1, 0.3));
  } else if (type === 'boundary_stone') {
    // inscribed kudurru boundary marker
    grp.add(box(0.6, 1.7, 0.5, mat(0x46423a), 0, 0.85, 0, 0, Math.random(), 0.04));
    grp.add(cone(0.42, 0.4, mat(0x46423a), 6, 0, 1.85, 0));
    for (let y = 0.5; y < 1.5; y += 0.32)
      grp.add(box(0.62, 0.1, 0.1, mat(0x2a2722), 0, y, 0.2));
  } else if (type === 'dead_tree') {
    // a sacred grove tree, long dead — gnarled silhouette
    grp.add(cyl(0.18, 0.34, 2.6, mat(0x2a2218), 6, 0, 1.3, 0));
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      grp.add(cyl(0.05, 0.11, 1.3, mat(0x2a2218), 4,
        Math.cos(a) * 0.5, 2.2 + (i % 2) * 0.3, Math.sin(a) * 0.5, 0.5 + Math.random() * 0.4, a, 0));
    }
  } else if (type === 'tablet') {
    // shattered clay tablet leaning in the dust
    grp.add(box(1.0, 1.3, 0.14, mat(0x5a4a36), 0, 0.6, 0, -0.5, Math.random(), 0.1));
    grp.add(box(0.5, 0.7, 0.14, mat(0x4a3c2c), 0.7, 0.25, 0.3, -0.7, Math.random(), 0.3)); // broken-off piece
  }
  return grp;
}

// ---------- factory ----------

const factionMats = new Map();

// Subtle "living sigil" flicker on all faction glow materials.
export function tickGlowMats(time) {
  let i = 0;
  for (const { g } of factionMats.values()) {
    g.emissiveIntensity = 1.8 + Math.sin(time * 2.4 + i * 1.7) * 0.22;
    i++;
  }
}
function getFactionMats(color, glow, accent, glow2) {
  const key = [color, glow, accent, glow2].join(':');
  if (!factionMats.has(key)) {
    // Dark body tinted toward faction color; bright emissive accent.
    const c = new THREE.Color(color);
    const body = new THREE.Color(0x35353e).lerp(c, 0.4);
    const b = new THREE.MeshStandardMaterial({ color: body, roughness: 0.8, metalness: 0.15, flatShading: true });
    applySurface(b, 'blocks');
    // accent: faction's secondary material (Temple Blue cloth / Star-Metal Silver / Dried Blood)
    const a = new THREE.MeshStandardMaterial({
      color: accent ?? body.getHex(), roughness: 0.55, metalness: 0.35, flatShading: true,
    });
    factionMats.set(key, {
      b, a,
      g: new THREE.MeshStandardMaterial({ color: 0x111114, emissive: glow, emissiveIntensity: 1.8, roughness: 0.5, flatShading: true }),
      g2: new THREE.MeshStandardMaterial({ color: 0x111114, emissive: glow2 ?? glow, emissiveIntensity: 1.9, roughness: 0.5, flatShading: true }),
    });
  }
  return factionMats.get(key);
}

// Cache one template per (model, faction). The detailed geometry is built once;
// every spawned unit is a light clone() that shares geometry + materials, so the
// extra detail costs almost nothing per unit.
const unitTemplates = new Map();
export function buildUnitMesh(modelKey, color, glow, accent, glow2) {
  const key = [modelKey, color, glow, accent, glow2].join('|');
  let template = unitTemplates.get(key);
  if (!template) {
    const { b, g, a, g2 } = getFactionMats(color, glow, accent, glow2);
    template = (unitBuilders[modelKey] || unitBuilders.worker)(b, g, a, g2);
    template.scale.setScalar(1.35); // readability at RTS camera distance
    template.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    unitTemplates.set(key, template);
  }
  return template.clone();
}

export function buildBuildingMesh(modelKey, color, glow, accent, glow2) {
  const { b, g, a, g2 } = getFactionMats(color, glow, accent, glow2);
  const grp = (buildingBuilders[modelKey] || buildingBuilders.barracks)(b, g, a, g2);
  grp.traverse(o => { if (o && o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return grp;
}
