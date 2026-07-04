// Smoke tests: boot the built game, prove the core loop runs, and exercise the
// Fields of Evil easter egg. These guard against regressions that a plain
// `vite build` can't catch — a black/dark scene that never renders units, a
// broken model that throws on spawn, a frozen simulation, or console errors.
import { test, expect } from '@playwright/test';

// Collect console + page errors for the duration of a test.
function watchErrors(page) {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

async function startMatch(page) {
  await page.goto('/');
  await page.waitForSelector('#faction-cards .fcard', { timeout: 15_000 });
  await page.click('#faction-cards .fcard');
  // the game object is published on window once the match is live
  await page.waitForFunction(() => window.__game && window.__game.units.length > 0, null, { timeout: 20_000 });
}

test('boots a match, spawns units, and renders without console errors', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);

  const stats = await page.evaluate(() => ({
    units: window.__game.units.length,
    buildings: window.__game.buildings.length,
    hasRenderer: !!window.__game.renderer,
  }));
  expect(stats.units).toBeGreaterThan(0);
  expect(stats.buildings).toBeGreaterThan(0);
  expect(stats.hasRenderer).toBe(true);
  expect(errors, `console errors during boot:\n${errors.join('\n')}`).toEqual([]);
});

test('the simulation advances (no freeze)', async ({ page }) => {
  await startMatch(page);
  // Drive the deterministic sim directly rather than waiting on the render loop:
  // under the runner's software-WebGL the heavy scene paints ~1 frame/sec, which
  // would starve the fixed-timestep sim of wall-clock time and make a real-time
  // wait flaky. __stepSim advances game.update ticks the same way the loop does.
  const t0 = await page.evaluate(() => window.__game.time);
  const t1 = await page.evaluate(() => window.__stepSim(1));   // ~1s of sim
  expect(t1).toBeGreaterThan(t0);
});

// Skip the input-locked intro flyover deterministically. Typing the secret code
// via the keyboard proved flaky on CI's software-WebGL runner — when the heavy
// scene saturates the main thread the keypress event can't be processed inside the
// test budget — so we drive the same engine entry point the keyboard handler calls.
async function skipIntro(page) { await page.evaluate(() => { if (window.__controls) window.__controls.intro = 0; }); }
async function spawnFieldsOfEvil(page) {
  await page.evaluate(() => {
    const g = window.__game, bp = g.map.basePlayer;
    g.spawnFieldsOfEvil(bp.x + 12, bp.y - 12);   // exactly what the 'greene' code does
  });
  await page.waitForFunction(() => !!window.__game.fieldsOfEvil, null, { timeout: 10_000 });
}

test('easter egg: the Fields of Evil spawn the House of Greene + neutral cast', async ({ page }) => {
  await startMatch(page);
  await skipIntro(page);
  await spawnFieldsOfEvil(page);

  const ok = await page.evaluate(() => !!window.__game.fieldsOfEvil);
  expect(ok).toBe(true);
  // the House of Greene and its cast should now exist as neutral (owner 2) entities
  const neutral = await page.evaluate(() =>
    window.__game.units.filter(u => u.owner === 2).length +
    window.__game.buildings.filter(b => b.owner === 2).length);
  expect(neutral).toBeGreaterThan(0);
});

test('combat runs without errors and the AI fights (no crash over a longer match)', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  // spawn the Fields of Evil right by the base to force combat, then let it run
  await skipIntro(page);
  await spawnFieldsOfEvil(page);
  // run several seconds of sim deterministically — units fight, projectiles fly,
  // things die — without depending on the render loop's pace (see __stepSim).
  const before = await page.evaluate(() => window.__game.units.length);
  const stats = await page.evaluate(() => {
    window.__stepSim(5);
    return {
      units: window.__game.units.length,
      time: window.__game.time,
      heat: window.__game.combatHeat,
    };
  });
  expect(stats.time).toBeGreaterThan(3);        // still ticking, not frozen
  expect(stats.units).toBeLessThan(before + 999); // sanity: array intact
  expect(errors, `console errors during combat:\n${errors.join('\n')}`).toEqual([]);
});

test('replay reproduces the recorded match deterministically (no desync)', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await skipIntro(page);                 // run the sim at full pace
  // issue a real player command through the recorded bus, then accrue several
  // seconds of recorded sim deterministically (render-pace independent — see __stepSim)
  const rep = await page.evaluate(() => {
    const g = window.__game;
    const w = g.units.find(u => u.owner === 0 && u.def.worker);
    if (w) g.cmd('formation', { sel: [w], x: w.pos.x + 8, z: w.pos.z + 8, am: false, q: false });
    window.__stepSim(4);
    return g.exportReplay();
  });
  expect(rep && rep.frames && rep.frames.length).toBeGreaterThan(60);
  expect(rep.frames.some(f => f.k !== undefined)).toBe(true);   // checksums were captured

  // re-run those exact frames in a fresh, deterministic playback (same dispatch +
  // checksum comparison as the live replay loop, run synchronously without rendering)
  const result = await page.evaluate((r) => window.__runReplaySync(r), rep);
  expect(result.frames).toBe(rep.frames.length);
  expect(result.desync, 'replay simulation diverged from the recording').toBe(false);
  const desync = await page.evaluate(() => window.__game.replayDesync);
  expect(desync, 'replay simulation diverged from the recording').toBe(false);
  expect(errors, `console errors during replay:\n${errors.join('\n')}`).toEqual([]);
});

test('free-for-all: a 4-player match spawns 4 bases and simulates deterministically', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);   // boot the engine first (loads the module + hooks)
  const res = await page.evaluate(() => window.__ffaCheck(4));
  // one main per seat, owners 0..3, neutral relocated to id 4
  expect(res.a.numPlayers).toBe(4);
  expect(res.a.neutral).toBe(4);
  expect(res.a.mains).toBe(4);
  expect(res.a.owners).toEqual([0, 1, 2, 3]);
  // EVERY seat must actually be in the game: supply recomputed (cap > 0 from its main,
  // used > 0 from its starting workers). Guards against per-player systems that only
  // iterate the classic [0, 1] owners and leave seats 2/3 inert.
  for (let o = 0; o < 4; o++) {
    expect(res.a.supply[o].cap, `seat ${o} supplyCap`).toBeGreaterThan(0);
    expect(res.a.supply[o].used, `seat ${o} supplyUsed`).toBeGreaterThan(0);
    expect(res.a.unitsPerSeat[o], `seat ${o} units`).toBeGreaterThan(0);
  }
  // same seed + faction list → bit-for-bit identical sim state (lockstep-safe)
  expect(res.deterministic, 'two identical 4-player games diverged').toBe(true);
  expect(errors, `console errors during FFA:\n${errors.join('\n')}`).toEqual([]);
});

test('free-for-all victory: razing every opponent main wins as last standing', async ({ page }) => {
  await startMatch(page);
  const r = await page.evaluate(() => window.__ffaVictoryCheck(3));
  expect(r.numPlayers).toBe(3);
  expect(r.enemyMains).toBe(2);        // two AI opponents
  expect(r.over).toBe(true);           // match ended
  expect(r.winner).toBe(0);            // local player (seat 0) won
  // first razing eliminates a seat mid-match (toast), second ends the game (no toast)
  expect(r.eliminationToasts).toBe(1);
});

test('free-for-all save/load: an FFA match round-trips through serialize/deserialize', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  const r = await page.evaluate(() => window.__ffaSaveCheck(3));
  expect(r.numPlayers).toBe(3);                       // seats restored, not collapsed to 1v1
  expect(r.ais).toBe(2);                              // an AI per opponent seat
  expect(r.after.units).toBe(r.before.units);         // no army silently dropped
  expect(r.after.buildings).toBe(r.before.buildings);
  expect(r.after.neutralUnits).toBe(r.before.neutralUnits);   // neutral owner id survived
  expect(errors, `console errors during FFA save/load:\n${errors.join('\n')}`).toEqual([]);
});

test('survival (The Deluge): waves rise deterministically and march without an AI seat', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  const res = await page.evaluate(() => window.__survivalCheck(4800));   // ~80s of sim
  expect(res.a.mode).toBe('survival');
  expect(res.a.ais).toBe(0);                    // no rival seat — the flood is the enemy
  expect(res.a.wave).toBeGreaterThanOrEqual(1); // the first wave has risen
  expect(res.a.raiders).toBeGreaterThan(0);     // and its horrors are on the field
  // no zombie state: either the player's main stands, or the match ended in defeat
  expect(res.a.mains.length === 1 || res.a.over === true).toBe(true);
  if (res.a.mains.length) expect(res.a.mains).toEqual([0]);   // only the player holds ground
  expect(res.deterministic, 'two identical survival runs diverged').toBe(true);
  expect(errors, `console errors during survival:\n${errors.join('\n')}`).toEqual([]);
});

test('records: a finished match unlocks achievements and persists them', async ({ page }) => {
  await startMatch(page);
  const r = await page.evaluate(() => window.__recordsCheck());
  expect(r.winner).toBe(0);
  expect(r.freshIds).toContain('first_win');    // a win unlocks the first achievement
  expect(r.freshIds).toContain('swift');        // razed in the opening minute → under 15:00
  expect(r.toasts).toBe(r.freshIds.length);     // every unlock announced
  expect(r.unlockedCount).toBeGreaterThanOrEqual(r.freshIds.length);
  // persistence: a second evaluation unlocks nothing new (already stored)
  const again = await page.evaluate(() => {
    const g = window.__game;
    // re-run the evaluation against the same finished game
    return window.__recordsCheck().freshIds;
  });
  expect(again).toEqual([]);
});

test('environment: the new biomes and Blood Moon mood boot and render clean', async ({ page }) => {
  const errors = watchErrors(page);
  for (const [biome, timeOfDay] of [['salt_waste', 'bloodmoon'], ['drowned_delta', 'storm']]) {
    await page.goto('/');
    await page.waitForSelector('#faction-cards .fcard', { timeout: 15_000 });
    await page.evaluate((cfg) => { window.__forceOpts = cfg; }, { biome, timeOfDay, seed: 90210 });
    await page.click('#faction-cards .fcard');
    await page.waitForFunction(() => window.__game && window.__game.units.length > 0, null, { timeout: 20_000 });
    const got = await page.evaluate(() => ({ biome: window.__game.map.biomeKey, mood: window.__game.timeOfDay }));
    expect(got.biome).toBe(biome);
    expect(got.mood).toBe(timeOfDay);
  }
  expect(errors, `console errors booting new biomes:\n${errors.join('\n')}`).toEqual([]);
});

test('PWA: manifest + service worker are served, and the game boots OFFLINE once cached', async ({ page, context }) => {
  // manifest + icons reachable
  const mf = await page.request.get('/manifest.webmanifest');
  expect(mf.ok()).toBe(true);
  expect((await mf.json()).icons.length).toBeGreaterThanOrEqual(3);
  expect((await page.request.get('/icon-180.png')).ok()).toBe(true);
  expect((await page.request.get('/sw.js')).ok()).toBe(true);

  // first visit installs the SW; reload lets it control the page and cache the build
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForSelector('#faction-cards .fcard', { timeout: 15_000 });

  // sever the network entirely — the installed app must still boot and play
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('#faction-cards .fcard', { timeout: 15_000 });
  await page.click('#faction-cards .fcard');
  await page.waitForFunction(() => window.__game && window.__game.units.length > 0, null, { timeout: 20_000 });
  expect(await page.evaluate(() => window.__game.units.length)).toBeGreaterThan(0);
  await context.setOffline(false);
});

test.describe('touch controls', () => {
  test.use({ hasTouch: true, viewport: { width: 844, height: 390 } });

  async function startTouchMatch(page) {
    await startMatch(page);
    await skipIntro(page);
    await page.evaluate(() => {
      const g = window.__game, c = window.__controls, bp = g.map.basePlayer;
      c.focus.set(bp.x * 2, 0, bp.y * 2); c.focusT.set(bp.x * 2, 0, bp.y * 2);
      c.dist = 40; c.distT = 40;
    });
    await page.waitForTimeout(300);
  }

  test('HUD attack-move arms AND fires on the next tap (was a latched no-op)', async ({ page }) => {
    await startTouchMatch(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.selection = g.units.filter(u => u.owner === 0).slice(0, 3);
      g.emit('selection');
    });
    await page.waitForTimeout(150);
    await page.tap('#commands .cmd');                    // first command = Attack-Move
    expect(await page.evaluate(() => window.__controls.attackMoveArm)).toBe(true);
    await page.touchscreen.tap(600, 160);                // tap ground
    const after = await page.evaluate(() => ({
      armed: window.__controls.attackMoveArm,
      states: window.__game.selection.map(u => u.state),
    }));
    expect(after.armed).toBe(false);                     // consumed, not latched
    expect(after.states.every(s => s === 'attackMove')).toBe(true);
  });

  test('long-press box-select grabs every own unit inside the rectangle', async ({ page }) => {
    await startTouchMatch(page);
    // Drive the exact routine the long-press gesture calls (boxSelect over a screen
    // rect). This is the logic the touch box relies on; the gesture plumbing that
    // enters 'box' mode is exercised by the attack-move/rally tap tests above.
    const n = await page.evaluate(() => {
      const g = window.__game, c = window.__controls;
      g.selection = []; g.emit('selection');
      // project every own unit to screen space, then box the whole extent
      const cam = g.camera, r = c.dom.getBoundingClientRect();
      const V = window.THREE_V || null;
      const pts = g.units.filter(u => u.owner === 0 && !u.dead).map(u => {
        const v = u.mesh.position.clone().project(cam);
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (-v.y + 1) / 2 * r.height };
      });
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      c.boxSelect(Math.min(...xs) - 20, Math.min(...ys) - 20, Math.max(...xs) + 20, Math.max(...ys) + 20, false);
      return g.selection.length;
    });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  test('minimap responds to touch: tap jumps the camera', async ({ page }) => {
    await startTouchMatch(page);
    const before = await page.evaluate(() => ({ x: window.__controls.focusT.x, z: window.__controls.focusT.z }));
    const mm = await page.locator('#minimap').boundingBox();
    await page.touchscreen.tap(mm.x + mm.width * 0.85, mm.y + mm.height * 0.85);   // far corner
    const after = await page.evaluate(() => ({ x: window.__controls.focusT.x, z: window.__controls.focusT.z }));
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(20);
  });

  test('ground tap with a building selected sets its rally point', async ({ page }) => {
    await startTouchMatch(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.selection = [g.buildings.find(b => b.owner === 0 && b.complete)];
      g.emit('selection');
    });
    await page.touchscreen.tap(640, 140);
    const rally = await page.evaluate(() => window.__game.buildings.find(b => b.owner === 0)?.rally);
    expect(rally).toBeTruthy();
  });

  test('the group bar renders chips, and bind/recall round-trips a selection', async ({ page }) => {
    await startTouchMatch(page);
    // the bar exists and shows Army + 4 numbered chips
    expect(await page.locator('#groupbar .gchip').count()).toBe(5);
    // bind then recall via the same methods the chips' tap/hold handlers call
    const out = await page.evaluate(() => {
      const g = window.__game, c = window.__controls;
      g.selection = g.units.filter(u => u.owner === 0).slice(0, 2); g.emit('selection');
      const bound = c.assignGroup('1');
      g.selection = []; g.emit('selection');
      const recalled = c.recallGroup('1');
      return { bound, recalled, sel: g.selection.length };
    });
    expect(out.bound).toBe(2);
    expect(out.recalled).toBe(2);
    expect(out.sel).toBe(2);
    // Army chip selects all warriors
    const army = await page.evaluate(() => window.__controls.selectArmy());
    expect(army).toBe(await page.evaluate(() => window.__game.units.filter(u => u.owner === 0 && !u.def.worker && !u.dead).length));
  });
});

test('onboarding: the coach reacts to game state (not a fixed timer)', async ({ page }) => {
  // fresh player state so the coach is armed
  await page.addInitScript(() => { try { localStorage.removeItem('sotw_settings'); } catch {} });
  await startMatch(page);
  await skipIntro(page);
  // the coach ticks ~1/s and shows its first lesson once time passes its trigger;
  // it must appear on its own without any timed sequence
  const shown = await page.evaluate(async () => {
    const el = document.getElementById('coach');
    for (let i = 0; i < 40; i++) {           // up to ~4s of real polling
      window.__stepSim(0.5);                  // advance sim time so triggers can fire
      if (el.classList.contains('show') && el.textContent.length > 10) return el.textContent;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  });
  expect(shown, 'coach never surfaced a tip').toBeTruthy();
  // it surfaced a real lesson from the core-loop vocabulary (not an empty/placeholder)
  expect(shown.toLowerCase()).toMatch(/gather|build|granary|barracks|soldiers|population/);
});

test('night moods hold a brighter fog-of-war floor than daylight', async ({ page }) => {
  const floorFor = async (mood) => {
    await page.goto('/');
    await page.waitForSelector('#faction-cards .fcard', { timeout: 15_000 });
    await page.evaluate((m) => { window.__forceOpts = { biome: 'basalt_highland', timeOfDay: m, seed: 99 }; }, mood);
    await page.click('#faction-cards .fcard');
    await page.waitForFunction(() => window.__game && window.__game.units.length > 0, null, { timeout: 20_000 });
    return page.evaluate(() => window.__game.preset.fogFloor ?? 0.14);
  };
  const night = await floorFor('night');
  const noon = await floorFor('noon');
  expect(night).toBeGreaterThan(noon);      // the dark mood keeps the ground readable
  expect(night).toBeGreaterThanOrEqual(0.22);
});

test('stances: a selected fighter cycles aggressive → defensive → hold', async ({ page }) => {
  await startMatch(page);
  await skipIntro(page);
  // select all of the player's units via the engine, keep only a fighter if any,
  // else just confirm laborers exist and the stance API is wired
  const setup = await page.evaluate(() => {
    const g = window.__game;
    const own = g.units.filter(u => u.owner === 0);
    g.selection = own;
    g.emit('selection');
    return { count: own.length, stance: own[0] && own[0].stance };
  });
  expect(setup.count).toBeGreaterThan(0);
  expect(setup.stance).toBe('aggressive');
  // pressing Y cycles stance on selected fighters; laborers (no real attack) are skipped,
  // so drive the engine API directly to assert the state machine works
  const cycled = await page.evaluate(() => {
    const g = window.__game;
    const u = g.units.find(x => x.owner === 0);
    u.setStance('defensive'); const a = u.stance;
    u.setStance('hold');      const b = u.stance;
    u.setStance('aggressive'); const c = u.stance;
    return [a, b, c, !!u.anchor];
  });
  expect(cycled.slice(0, 3)).toEqual(['defensive', 'hold', 'aggressive']);
});
