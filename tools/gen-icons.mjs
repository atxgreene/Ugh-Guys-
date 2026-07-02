// Rasterize public/icon.svg into the PNG sizes the PWA manifest + iOS need.
// Run: node tools/gen-icons.mjs   (uses the project's Playwright Chromium)
//
// Maskable icons must keep artwork inside a ~80% safe zone (the launcher may crop
// to a circle), so the maskable variant scales the art down over a solid backdrop.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icon.svg'), 'utf8');
const b64 = Buffer.from(svg).toString('base64');

const targets = [
  { file: 'icon-180.png', size: 180, maskable: false },  // apple-touch-icon
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
];

// Prefer the environment's preinstalled Chromium; fall back to Playwright's default.
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let browser;
try { browser = await chromium.launch({ executablePath: exe }); }
catch { browser = await chromium.launch(); }

const page = await browser.newPage();
for (const t of targets) {
  const inner = t.maskable ? Math.round(t.size * 0.78) : t.size;
  const pad = Math.round((t.size - inner) / 2);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${t.size}px;height:${t.size}px;background:#0a0a10;overflow:hidden">
    <img src="data:image/svg+xml;base64,${b64}" style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px"></body></html>`);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(root, 'public', t.file), clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log('wrote public/' + t.file);
}
await browser.close();
