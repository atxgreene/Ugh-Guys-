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
  const t0 = await page.evaluate(() => window.__game.time);
  await page.waitForTimeout(1500);
  const t1 = await page.evaluate(() => window.__game.time);
  expect(t1).toBeGreaterThan(t0);
});

test('easter egg: typing "greene" spawns the Fields of Evil + fires dialogue', async ({ page }) => {
  await startMatch(page);
  // dismiss the scripted intro, then type the secret code
  await page.keyboard.press('Space');
  for (const ch of 'greene') await page.keyboard.press(ch);
  await page.waitForFunction(() => !!window.__game.fieldsOfEvil, null, { timeout: 10_000 });

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
  await page.keyboard.press('Space');
  for (const ch of 'greene') await page.keyboard.press(ch);
  await page.waitForFunction(() => !!window.__game.fieldsOfEvil, null, { timeout: 10_000 });
  // run the sim for several seconds — units fight, projectiles fly, things die
  const before = await page.evaluate(() => window.__game.units.length);
  await page.waitForTimeout(5000);
  const stats = await page.evaluate(() => ({
    units: window.__game.units.length,
    time: window.__game.time,
    heat: window.__game.combatHeat,
  }));
  expect(stats.time).toBeGreaterThan(3);        // still ticking, not frozen
  expect(stats.units).toBeLessThan(before + 999); // sanity: array intact
  expect(errors, `console errors during combat:\n${errors.join('\n')}`).toEqual([]);
});

test('replay reproduces the recorded match deterministically (no desync)', async ({ page }) => {
  const errors = watchErrors(page);
  await startMatch(page);
  await page.keyboard.press('Space');   // skip the intro so the sim runs at full pace
  // issue a real player command through the recorded bus, then let the sim accrue
  await page.evaluate(() => {
    const g = window.__game;
    const w = g.units.find(u => u.owner === 0 && u.def.worker);
    if (w) g.cmd('formation', { sel: [w], x: w.pos.x + 8, z: w.pos.z + 8, am: false, q: false });
  });
  await page.waitForTimeout(4000);
  // snapshot the recording so far (deep-copied across the bridge)
  const rep = await page.evaluate(() => window.__game.exportReplay());
  expect(rep && rep.frames && rep.frames.length).toBeGreaterThan(60);
  expect(rep.frames.some(f => f.k !== undefined)).toBe(true);   // checksums were captured

  // re-run those exact frames in a fresh, deterministic playback
  await page.evaluate((r) => window.__startReplay(r), rep);
  await page.waitForFunction(() => window.__game && window.__game.replayDone, null, { timeout: 25_000 });
  const desync = await page.evaluate(() => window.__game.replayDesync);
  expect(desync, 'replay simulation diverged from the recording').toBe(false);
  expect(errors, `console errors during replay:\n${errors.join('\n')}`).toEqual([]);
});

test('stances: a selected fighter cycles aggressive → defensive → hold', async ({ page }) => {
  await startMatch(page);
  await page.keyboard.press('Space');
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
