// Balance audit: numeric time-to-kill (TTK) duels between all combat units, plus
// assertions that the rock-paper-scissors counters hold. Run with `npm run audit`.
//
// This is a melee-range approximation — it ignores projectile range and kiting, so
// archers/casters read as "weak" here while being strong at range. Use it to sanity
// the relative stats and verify counter relationships, not as gospel for ranged units.
import { FACTIONS } from '../src/data.js';

const units = [];
for (const f of Object.values(FACTIONS))
  for (const [k, u] of Object.entries(f.units))
    if (u.attack && u.attack.dmg > 0 && !u.worker) units.push({ fac: f.key, key: k, ...u });

const dmgPerHit = (a, d) => {
  const mult = (d.tags || []).reduce((m, t) => m * (a.attack.bonus?.[t] || 1), 1);
  return Math.max(1, Math.round(a.attack.dmg * mult) - (d.armor || 0));
};
const ttk = (a, d) => d.hp / (dmgPerHit(a, d) / a.attack.cooldown);

console.log('=== 1v1 duels: win counts (melee approximation, ignores range) ===');
const rows = [];
for (const a of units) {
  let wins = 0, losses = 0, draws = 0;
  for (const d of units) {
    if (a === d) continue;
    const ta = ttk(a, d), td = ttk(d, a);
    if (ta < td * 0.95) wins++; else if (td < ta * 0.95) losses++; else draws++;
  }
  rows.push({ name: `${a.fac}/${a.key}`, wins, losses, draws, hp: a.hp, dmg: a.attack.dmg, cd: a.attack.cooldown, rng: a.attack.range });
}
rows.sort((x, y) => y.wins - x.wins);
for (const r of rows)
  console.log(`${r.name.padEnd(22)} W${String(r.wins).padStart(2)} L${String(r.losses).padStart(2)} D${r.draws}  | hp${r.hp} dmg${r.dmg} cd${r.cd} rng${r.rng}`);

console.log('\n=== counter checks (must hold) ===');
const byKey = {};
for (const u of units) byKey[u.fac + '/' + u.key] = u;
const checks = [
  ['covenant/spearman', 'covenant/chariot', 'spear > chariot (anti-mounted)'],
  ['covenant/spearman', 'nephilim/warbeast', 'spear > warbeast (anti-beast)'],
  ['watchers/starmetal', 'covenant/chariot', 'starmetal > chariot (anti-mounted)'],
  ['nephilim/champion', 'covenant/spearman', 'champion > spearman (anti-heavy)'],
  ['nephilim/champion', 'watchers/starmetal', 'champion > starmetal (anti-heavy)'],
  ['covenant/chariot', 'covenant/archer', 'chariot > archer (anti-light)'],
  ['nephilim/warbeast', 'covenant/archer', 'warbeast > archer (anti-light)'],
];
let failed = 0;
for (const [ak, dk, label] of checks) {
  const a = byKey[ak], d = byKey[dk];
  if (!a || !d) { console.log(`?? missing ${ak} or ${dk}`); failed++; continue; }
  const ta = ttk(a, d), td = ttk(d, a), ok = ta < td;
  if (!ok) failed++;
  console.log(`${ok ? 'OK ' : 'XX '} ${label}: TTK ${ta.toFixed(1)}s vs ${td.toFixed(1)}s`);
}
// ---- cost efficiency: combat value produced per resource invested ----
// rough resource value weights; supply is precious (cap is 80)
const COSTW = { grain: 1, timber: 1.1, bronze: 1.4, favor: 2.2, knowledge: 2.6 };
const costOf = (u) => Object.entries(u.cost || {}).reduce((s, [k, v]) => s + v * (COSTW[k] || 1), 0) + (u.supply || 1) * 14;
// effective bulk vs an unarmored average target, and sustained dps
const avgDps = (u) => {
  let s = 0; for (const d of units) s += dmgPerHit(u, d) / u.attack.cooldown;
  return s / units.length;
};
console.log('\n=== cost efficiency (effective HP x DPS per 100 cost; range-blind) ===');
const eff = units.map(u => {
  const c = costOf(u);
  const score = (u.hp * avgDps(u)) / c;     // durability x output per cost
  return { name: `${u.fac}/${u.key}`, cost: Math.round(c), dps: +avgDps(u).toFixed(1), score: +score.toFixed(2) };
}).sort((a, b) => b.score - a.score);
for (const e of eff) console.log(`${e.name.padEnd(22)} score ${String(e.score).padStart(6)}  | cost ${e.cost} avgDPS ${e.dps}`);

// ---- ranged-aware duel: shooters land free hits while melee closes the gap ----
// crude model: melee closer covers (attackerRange→0) at its speed; the longer-ranged
// unit gets that window of free DPS first. Same-range falls back to the TTK duel.
const CLOSE = 'melee approximation + a free-fire window for the longer-ranged unit';
function rangedDuel(a, d) {
  const gap = Math.abs(a.attack.range - d.attack.range);
  const longer = a.attack.range >= d.attack.range ? a : d, shorter = longer === a ? d : a;
  const closeSpeed = Math.max(3, shorter.speed);
  const freeWindow = gap / closeSpeed;                       // seconds of unanswered fire
  const freeDmg = (dmgPerHit(longer, shorter) / longer.attack.cooldown) * freeWindow;
  const shorterHp = Math.max(1, shorter.hp - freeDmg);
  const tLong = shorter.hp / (dmgPerHit(longer, shorter) / longer.attack.cooldown);
  const tShort = shorterHp / (dmgPerHit(shorter, longer) / shorter.attack.cooldown);
  return longer === a ? { ta: tLong, td: tShort } : { ta: tShort, td: tLong };
}
console.log(`\n=== ranged-aware win counts (${CLOSE}) ===`);
const rrows = units.map(a => {
  let w = 0, l = 0;
  for (const d of units) { if (a === d) continue; const { ta, td } = rangedDuel(a, d); if (ta < td * 0.95) w++; else if (td < ta * 0.95) l++; }
  return { name: `${a.fac}/${a.key}`, w, l, rng: a.attack.range };
}).sort((x, y) => y.w - x.w);
for (const r of rrows) console.log(`${r.name.padEnd(22)} W${String(r.w).padStart(2)} L${String(r.l).padStart(2)}  | rng ${r.rng}`);

console.log(failed ? `\n${failed} counter check(s) FAILED` : '\nall counter checks passed');
process.exit(failed ? 1 : 0);
