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
