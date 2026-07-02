// Achievements & records — pure UI layer. It OBSERVES finished games (and a few live
// events) and persists unlocks locally; it never mutates the simulation, so it can't
// affect determinism, replays or lockstep.
import { Settings } from './settings.js';

// Each def: id, name, desc, and a check run when a game ends. `g` is the Game.
export const ACHIEVEMENTS = [
  { id: 'first_win',  name: 'First Light',        desc: 'Win your first match.',
    check: (g, won) => won },
  { id: 'covenant',   name: 'Line of Seth',       desc: 'Win as the Covenant.',
    check: (g, won) => won && g.players[g.localPlayer].faction.key === 'covenant' },
  { id: 'watchers',   name: 'Forbidden Knowledge', desc: 'Win as the Watchers.',
    check: (g, won) => won && g.players[g.localPlayer].faction.key === 'watchers' },
  { id: 'nephilim',   name: 'Blood of Giants',    desc: 'Win as the Nephilim.',
    check: (g, won) => won && g.players[g.localPlayer].faction.key === 'nephilim' },
  { id: 'hard_win',   name: 'Against the Storm',  desc: 'Win a match on Hard.',
    check: (g, won) => won && g.difficulty === 'hard' && g.mode === 'standard' },
  { id: 'swift',      name: 'Before the Rains',   desc: 'Win in under 15 minutes.',
    check: (g, won) => won && g.mode === 'standard' && g.time < 900 },
  { id: 'ffa',        name: 'Last House Standing', desc: 'Win a 4-player free-for-all.',
    check: (g, won) => won && g.numPlayers >= 4 },
  { id: 'net_win',    name: 'Word Made Flesh',    desc: 'Win a networked match.',
    check: (g, won) => won && !!g.net },
  { id: 'boss',       name: 'Monster Hunter',     desc: 'Slay a world boss.',
    check: (g) => g.slainBosses.length > 0 },
  { id: 'scott',      name: 'The Green Eye Closes', desc: 'Fell SCOTT, the Green-Eyed Sentinel.',
    check: (g) => g.slainBosses.includes('scott') },
  { id: 'greene',     name: 'Fields of Ruin',     desc: 'Raze the House of Greene.',
    check: (g) => g.greeneRazed },
  { id: 'wave5',      name: 'Storm-Tested',       desc: 'Survive 5 waves of the Deluge.',
    check: (g) => g.mode === 'survival' && g.wave >= 5 },
  { id: 'wave10',     name: 'The Unbowed',        desc: 'Survive 10 waves of the Deluge.',
    check: (g) => g.mode === 'survival' && g.wave >= 10 },
  { id: 'daily',      name: 'Pilgrim',            desc: 'Complete a Daily Trial.',
    check: (g) => !!g.isDaily },
];

export function unlocked() { return Settings.get('ach') || {}; }

// Evaluate a finished game; unlock anything newly earned, persist records, and
// toast each unlock. Returns the list of newly unlocked defs.
export function onGameOver(game, winner, toast) {
  const won = winner === 0;
  const have = unlocked();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (have[a.id]) continue;
    let ok = false;
    try { ok = !!a.check(game, won); } catch {}
    if (ok) { have[a.id] = Date.now(); fresh.push(a); }
  }
  if (fresh.length) Settings.set('ach', have);
  // records: best survival wave, daily log
  if (game.mode === 'survival') {
    const best = Settings.get('bestWave') || 0;
    if (game.wave > best) Settings.set('bestWave', game.wave);
  }
  if (game.isDaily) {
    const log = Settings.get('daily') || {};
    const prev = log[game.isDaily];
    const entry = { won, wave: game.wave, time: Math.floor(game.time) };
    if (!prev || (won && !prev.won) || (game.wave > (prev.wave || 0))) log[game.isDaily] = entry;
    Settings.set('daily', log);
  }
  for (const a of fresh) toast?.(`🏆 ${a.name} — ${a.desc}`);
  return fresh;
}

// Data for the Records panel: achievement states + headline records.
export function recordsSummary() {
  const have = unlocked();
  const log = Settings.get('daily') || {};
  const dailyDone = Object.keys(log).length;
  const dailyWon = Object.values(log).filter(e => e.won).length;
  return {
    achievements: ACHIEVEMENTS.map(a => ({ ...a, done: !!have[a.id] })),
    bestWave: Settings.get('bestWave') || 0,
    dailyDone, dailyWon,
  };
}
