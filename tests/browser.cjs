const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 18764;
const url = `http://127.0.0.1:${port}/`;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForServer() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* server is starting */ }
    await pause(100);
  }
  throw new Error('Static server did not start');
}

async function run() {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
      page.on('request', request => requests.push(request.url()));
      await page.goto(url, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.spread-tab').count(), 4);
      await page.getByRole('button', { name: '洗牌，开始抽' }).click();
      assert.equal(await page.locator('.fan-card').count(), 78);
      await page.locator('.fan-card').nth(20).click();
      assert.equal(await page.locator('[data-reveal]').count(), 1);
      assert.equal(await page.locator('[data-slot] .is-revealed').count(), 0, 'picked card should stay face down');
      await page.locator('[data-reveal]').click();
      await page.locator('.result-card').first().waitFor();
      assert.equal(await page.locator('.history-item').count(), 1);
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('.result-card').count(), 1, 'daily card should survive reload');
      assert.equal(await page.locator('[data-action="again"]').count(), 0, 'daily card should be once per day');

      await page.locator('[data-spread="three"]').click();
      await page.locator('#question').fill('接下来怎么走？');
      await page.getByRole('button', { name: '洗牌，开始抽' }).click();
      for (const index of [10, 30, 50]) await page.locator('.fan-card').nth(index).click();
      assert.equal(await page.locator('[data-reveal]').count(), 3);
      for (let i = 0; i < 3; i++) await page.locator('[data-reveal]').nth(i).click();
      await page.locator('.result-card').first().waitFor();
      assert.equal(await page.locator('.result-card').count(), 3);
      assert(await page.locator('.result-card img').evaluateAll(images =>
        images.every(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().height > 100)),
      'all revealed card scans should be visible');
      assert.match(await page.locator('.result-question').textContent(), /接下来怎么走/);
      assert.equal(await page.locator('.history-item').count(), 2);
      assert.deepEqual(errors, []);
      assert(requests.every(request => request.startsWith(url)), 'site should not request external assets');
      const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(horizontalOverflow, false, 'page should fit viewport');
      if (viewport.width === 1280) {
        await page.screenshot({ path: path.join(root, 'assets', 'preview.png'), fullPage: true });
      }
      await context.close();
      process.stdout.write(`Passed ${viewport.width}px browser flow\n`);
    }
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.kill());
