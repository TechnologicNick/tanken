import { chromium, webkit } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
for (const [name, engine, viewport] of [['desktop', chromium, { width: 1440, height: 1000 }], ['mobile-webkit', webkit, { width: 390, height: 844 }]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ viewport, isMobile: name !== 'desktop', hasTouch: name !== 'desktop' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://localhost:3000');
    await page.locator('.station').first().waitFor({ timeout: 30000 });
    const prices = await page.locator('.station .price').allTextContents();
    const values = prices.map(p => Number(p.match(/[\d]+,[\d]{3}/)[0].replace(',', '.')));
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
    await page.locator('.station').first().click();
    await page.locator('.navigate').waitFor();
    assert.match(await page.locator('.navigate').getAttribute('href'), /^https:\/\/maps.apple.com/);
    await page.locator('#close-details').click();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/api/stations?') && r.url().includes('DIESEL')),
      page.getByRole('button', { name: 'Diesel B7', exact: true }).click(),
    ]);
    await page.locator('.station').first().waitFor();
    assert.equal(await page.locator('[data-fuel=DIESEL]').getAttribute('aria-pressed'), 'true');
    await page.locator('#search').fill('Haarlem');
    await page.locator('#search-form').evaluate(f => f.requestSubmit());
    await page.locator('#search-results button').first().waitFor({ timeout: 20000 });
    await Promise.all([page.waitForResponse(r => r.url().includes('/api/stations?')), page.locator('#search-results button').first().click()]);
    await page.locator('.station').first().waitFor();
    if (name !== 'desktop') {
      await page.locator('#mobile-toggle').click();
      await page.locator('.leaflet-marker-icon').first().waitFor({ state: 'visible' });
      await page.screenshot({ path: `test-results/${name}-map.png` });
      await page.locator('#mobile-toggle').click();
    }
    const invalid = await context.request.get('http://localhost:3000/api/stations?bounds=bad');
    assert.equal(invalid.status(), 400);
    const traversal = await context.request.get('http://localhost:3000/.anwb-local.json');
    assert.equal(traversal.status(), 404);
    await page.route('**/api/stations?**', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Test connection error' }) }));
    if (name !== 'desktop') await page.locator('#mobile-toggle').click();
    await page.locator('#refresh').click();
    await page.locator('#status.error').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.station').count(), 0);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`${name}: live prices, sorting, details, diesel, place search, map, error handling and private-file protection passed`);
  } finally { await browser.close(); }
}
