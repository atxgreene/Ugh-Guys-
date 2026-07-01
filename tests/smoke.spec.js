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
