// The Chronicle of the Fields — a five-mission story campaign.
//
// Missions are DATA: a fixed map (faction/biome/mood/seed), a briefing, an objective,
// an onStart hook that scripts the opening, timed story beats (dialogue + reinforcements
// via the game's portrait-dialogue and neutral-spawn systems), and win/lose predicates.
// The runner lives in game.js (updateCampaign); this file only describes the story.
//
// It reuses the game's existing cast — Mr Greene, Parker the shepherd, Lord Landry, King
// Conner, the hounds — so the easter-egg characters become the spine of a real arc.

// Convenience: a mission's per-game scratchpad is game._camp (missions never store their
// own state, so a mission object is reusable across playthroughs).
import { Sound } from './audio.js';

const scratch = (g) => g._camp;

export const MISSIONS = [
  {
    id: 'm1', act: 'I', name: 'The Shepherd’s Plea',
    faction: 'covenant', biome: 'river_valley', mood: 'dawn', mapSize: 'standard', seed: 71001,
    brief: 'Parker, shepherd of the Fields, begs the Covenant for aid: raiders harry his flocks at every dawn. ' +
      'Raise a foothold on the river and drive them back into the wilds.',
    objective: 'Build a barracks, then destroy the raiding band.',
    onStart(g) {
      scratch(g).raidersLeft = 0; scratch(g).raidersDone = false;
      g.dialog('parker', 'Parker · Shepherd of the Fields',
        '“Oh, thank heaven you’ve come. Build yourself a proper hall — barracks first — and I’ll point you at the brutes.”');
    },
    beats: [
      { at: 70, do(g) {
        g.dialog('parker', 'Parker · Shepherd of the Fields', '“There — they’re massing past the reeds. Send your spearmen, quickly!”');
        const bp = g.map.basePlayer;
        for (let i = 0; i < 6; i++) scratch(g).raidersLeft += g.spawnRaider('landonian', bp.x + 26, bp.y + 8, 0.85) ? 1 : 0;
        scratch(g).raidersDone = true;
      } },
      { at: 74, do(g) { g.emit('toast', '⚔ A raiding band approaches from the east. Break it.'); } },
    ],
    objectiveText(g) {
      const left = g.units.filter(u => u.owner === g.NEUTRAL && !u.dead && u.def.attack).length;
      return scratch(g).raidersDone ? `Destroy the raiders — ${left} remain` : 'Build a barracks and train soldiers';
    },
    win(g) { return scratch(g).raidersDone && g.units.filter(u => u.owner === g.NEUTRAL && !u.dead && u.def.attack).length === 0; },
  },

  {
    id: 'm2', act: 'II', name: 'The Feud of Fields',
    faction: 'covenant', enemy: 'nephilim', biome: 'cedar_forest', mood: 'dusk', mapSize: 'standard', seed: 71002,
    brief: 'The truce is broken. King Conner’s warhost has seized the eastern woods and burns all it finds. ' +
      'The Covenant marches to war: tear down the Boydonian warcamp before it grows.',
    objective: 'Destroy the enemy’s seat of power.',
    onStart(g) {
      g.dialog('boydonian', 'Conner · King of the Boydonians', '“You came all this way to die in my woods? Bold. I respect it.”');
      // a small vanguard to start the war with
      const bp = g.map.basePlayer;
      for (let i = 0; i < 3; i++) g.spawnUnit(0, 'spearman', (bp.x + 3) * 2 + i, (bp.y + 3) * 2);
    },
    beats: [
      { at: 150, do(g) { if (!g.over) g.dialog('boydonian', 'Conner · King of the Boydonians', '“Is that all? My hounds have bigger teeth.”'); } },
    ],
    objectiveText(g) {
      const enemyMain = g.buildings.some(b => b.owner === 1 && b.def.main && !b.dead);
      return enemyMain ? 'Raze King Conner’s seat of power' : 'The Boydonians are broken!';
    },
    // classic conquest: destroy the AI seat
    win(g) { return !g.buildings.some(b => b.owner === 1 && b.def.main && !b.dead); },
  },

  {
    id: 'm3', act: 'III', name: 'The Green-Eyed Sentinel',
    faction: 'watchers', biome: 'basalt_highland', mood: 'night', mapSize: 'standard', seed: 71003,
    brief: 'Deep in the black highlands the Watchers wake an old guardian — SCOTT, the green-eyed sentinel. ' +
      'It will not sleep again while you draw breath. Raise your host and fell it.',
    objective: 'Fell SCOTT, the green-eyed sentinel.',
    onStart(g) {
      scratch(g).scottUp = false;
      g.dialog('greene', 'Mr Greene · Master of the House', '“You’ve stirred something that should have stayed buried. On your own head be it.”');
    },
    beats: [
      { at: 90, do(g) {
        const cx = Math.floor(g.map.basePlayer.x + 22), cy = Math.floor(g.map.basePlayer.y + 6);
        if (g.summonScott(cx, cy)) { scratch(g).scottUp = true; g.emit('toast', '◎ SCOTT awakens. Mind the green rings — they fall where he points.'); }
      } },
    ],
    objectiveText(g) {
      if (g.slainBosses.includes('scott')) return 'The sentinel is felled.';
      return scratch(g).scottUp ? 'Destroy SCOTT — dodge his optic rings' : 'Muster your host before the sentinel wakes';
    },
    win(g) { return g.slainBosses.includes('scott'); },
  },

  {
    id: 'm4', act: 'IV', name: 'The House of Greene',
    faction: 'nephilim', biome: 'nephilim_waste', mood: 'bloodmoon', mapSize: 'standard', seed: 71004,
    brief: 'All roads lead to the House of Greene, where the master hoards forbidden lore behind a wall of feuding clans. ' +
      'Under the blood moon, the giants come to collect. Raze the House and seize its trove.',
    objective: 'Raze the House of Greene.',
    onStart(g) {
      g.spawnFieldsOfEvil(Math.floor(g.map.basePlayer.x + 24), Math.floor(g.map.basePlayer.y + 4));
      g.dialog('greene', 'Mr Greene · Master of the House', '“Welcome to my Fields. The hounds caught your scent a mile off. Few leave.”');
    },
    beats: [
      { at: 8, do(g) { g.dialog('tucker', 'Tucker · the Goldendoodle', '(He sniffs the giants, wags once, and bolts for the house.)'); } },
    ],
    objectiveText(g) {
      return g.greeneRazed ? 'The House has fallen — the trove is yours.' : 'Break the feuding clans and raze the House of Greene';
    },
    win(g) { return g.greeneRazed; },
  },

  {
    id: 'm5', act: 'V', name: 'The Deluge',
    faction: 'covenant', biome: 'drowned_delta', mood: 'storm', mapSize: 'standard', seed: 71005,
    brief: 'The waters are rising. This is the last dawn of the old world. Hold your hall against the Flood’s ' +
      'horrors until the storm breaks — there is no victory here but survival.',
    objective: 'Hold the line for six minutes as the Flood rises.',
    onStart(g) {
      scratch(g).waves = 0;
      g.dialog('parker', 'Parker · Shepherd of the Fields', '“The river’s over its banks and still climbing. Whatever comes — we hold. Together.”');
    },
    // escalating waves of drowned horrors every ~40s; win by outlasting them
    beats: Array.from({ length: 8 }, (_, k) => ({
      at: 60 + k * 42,
      do(g) {
        if (g.over) return;
        scratch(g).waves = k + 1;
        const n = 3 + k * 2, mult = 0.7 + k * 0.12;
        const boss = k === 3 ? 'nephil_titan' : k === 6 ? 'leviathan' : null;
        const bp = g.map.basePlayer;
        for (let i = 0; i < n; i++) g.spawnRaider('devourer', bp.x + (i % 2 ? 24 : -24), bp.y + (i * 3 - n), mult);
        if (boss) g.spawnRaider(boss, bp.x + 22, bp.y - 6, mult);
        Sound.wave(k + 1);
        g.emit('toast', `🌊 Wave ${k + 1} breaks upon your walls${boss ? ' — a champion of the deep leads it!' : ''}.`);
      },
    })),
    objectiveText(g) {
      const left = Math.max(0, 360 - Math.floor(g.time));
      return `Survive the Flood — ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} remain (wave ${scratch(g).waves || 0})`;
    },
    win(g) { return g.time >= 360; },
  },
];

export function missionById(id) { return MISSIONS.find(m => m.id === id); }
export function missionIndex(id) { return MISSIONS.findIndex(m => m.id === id); }
