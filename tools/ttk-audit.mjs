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
console.log(failed ? `\n${failed} counter check(s) FAILED` : '\nall counter checks passed');
process.exit(failed ? 1 : 0);
