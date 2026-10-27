import { expandStationList } from './browser-drawer.ts';
import { chromium, webkit, devices, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const fixture = spawn('bun', ['run', 'scripts/browser-fixture.ts'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: fixture.stdout });
const ready = new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Fixture startup timed out')), 30000);
  fixture.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture exited')); });
  lines.on('line', line => { try { const data = JSON.parse(line); if (data.ready) { clearTimeout(timer); resolve(data.ready); } } catch {} });
});
// Reconstruct screen positions from the public map URL, without production debug hooks.
async function selection(page: Page) {
  return page.evaluate(() => {
    const params = new URLSearchParams(location.search), bounds = params.get('bounds')!.split(',').map(Number), area = params.get('listBounds')!.split(',').map(Number);
    const leaflet = (window as any).L;
    const project = (lat: number, lng: number) => leaflet.CRS.EPSG3857.latLngToPoint(leaflet.latLng(lat, lng), Number(params.get('zoom')));
    const sw = project(bounds[0]!, bounds[1]!), ne = project(bounds[2]!, bounds[3]!);
    const rect = document.querySelector('#map')!.getBoundingClientRect();
    const point = (lat: number, lng: number) => { const p = project(lat, lng); return { x: rect.x + rect.width / 2 + p.x - (sw.x + ne.x) / 2, y: rect.y + rect.height / 2 + p.y - (sw.y + ne.y) / 2 }; };
    const station = document.querySelector<HTMLElement>('#station-card-body article');
    const selected = station && document.querySelector<HTMLElement>(`#stations .station[data-id="${station.dataset.stationId}"]`);
    return { top: point(area[2]!, area[3]!).y, bottom: point(area[0]!, area[1]!).y, station: selected ? point(Number(selected.dataset.lat), Number(selected.dataset.lng)) : null };
  });
}
async function pan(page: Page) {
  const before = new URL(page.url()).searchParams.get('bounds');
  await page.locator('#map').focus();
  await page.locator('#map').press('ArrowLeft');
  await expect.poll(() => new URL(page.url()).searchParams.get('bounds')).not.toBe(before);
  await expect(page.locator('#loading')).toBeHidden();
}
try {
  const base = await ready;
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ ...devices['iPhone 13'], serviceWorkers: 'block' });
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('https://tile.openstreetmap.org/**', route => route.abort());
      await page.goto(`${base}?bounds=52.02,4.99,52.16,5.25`);
      await expect.poll(() => new URL(page.url()).searchParams.has('listBounds')).toBe(true);
      await expect(page.locator('#loading')).toBeHidden();
      const controls = (await page.locator('.map-controls').boundingBox())!;
      await expect(page.locator('#mobile-toggle')).toHaveCount(0);
      const list = page.locator('#list-drawer');
      await expect(list).toHaveAttribute('data-open', '');
      await expect.poll(() => list.evaluate(el => el.getAnimations().length)).toBe(0);
      await expect(list).toHaveAttribute('data-compact', '');
      await expect(page.locator('#sort')).toBeHidden();
      const rows = await page.locator('#stations .station').evaluateAll(els => els.slice(0, 2).map(el => ({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})));
      expect(rows[0]!.bottom).toBeLessThan(page.viewportSize()!.height);
      expect(rows[1]!.top).toBeLessThan(page.viewportSize()!.height);
      expect(rows[1]!.bottom).toBeGreaterThan(page.viewportSize()!.height);
      await pan(page);
      const initial = await selection(page);
      expect(initial.top).toBeCloseTo(controls.y + controls.height, 0);
      expect(initial.bottom).toBeCloseTo((await list.locator('.drawer-handle').boundingBox())!.y, 0);
      const beforeOpen = new URL(page.url()).searchParams.get('listBounds');
      await expandStationList(page);
      await expect(page.locator('#sort')).toBeVisible();
      expect(new URL(page.url()).searchParams.get('listBounds')).toBe(beforeOpen);
      await pan(page);
      const handle = (await page.locator('#list-drawer .drawer-handle').boundingBox())!;
      expect((await selection(page)).bottom).toBeCloseTo(handle.y, 0);
      const previousBounds = new URL(page.url()).searchParams.get('bounds');
      const previousSelection = new URL(page.url()).searchParams.get('listBounds');
      const station = page.locator('#stations .station').first();
      const coordinates = { lat: Number(await station.getAttribute('data-lat')), lng: Number(await station.getAttribute('data-lng')) };
      await station.tap();
      await expect(page.locator('#station-card-body article')).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.get('bounds')).not.toBe(previousBounds);
      await expect(page.locator('#loading')).toBeHidden();
      const centered = await page.evaluate(({lat, lng}) => {
        const leaflet = (window as any).L, params = new URLSearchParams(location.search), b = params.get('bounds')!.split(',').map(Number);
        const project = (lat: number, lng: number) => leaflet.CRS.EPSG3857.latLngToPoint(leaflet.latLng(lat, lng), Number(params.get('zoom')));
        const sw = project(b[0]!, b[1]!), ne = project(b[2]!, b[3]!), p = project(lat, lng), rect = document.querySelector('#map')!.getBoundingClientRect();
        return { x: rect.width / 2 + p.x - (sw.x + ne.x) / 2, y: rect.height / 2 + p.y - (sw.y + ne.y) / 2 };
      }, coordinates);
      const cardHandle = (await page.locator('#station-card .drawer-handle').boundingBox())!;
      expect(Math.abs(centered.x - page.viewportSize()!.width / 2)).toBeLessThan(2);
      expect(Math.abs(centered.y - (controls.y + controls.height + cardHandle.y) / 2)).toBeLessThan(2);
      const article = page.locator('#station-card-body article');
      expect(await article.evaluate(el => el.firstElementChild?.className)).toBe('navigation-links');
      expect(await article.locator('.detail-prices').evaluate(el => el.nextElementSibling?.textContent)).toContain('Laatst waargenomen');
      await expect(article.locator('.detail-prices')).toContainText('/ L');
      // A manual move in details must still return to the original list view.
      await pan(page);
      await page.locator('#station-card-close').tap();
      await expect(page.locator('#station-card')).toBeHidden();
      await expect.poll(() => new URL(page.url()).searchParams.get('bounds')).toBe(previousBounds);
      await expect.poll(() => new URL(page.url()).searchParams.get('listBounds')).toBe(previousSelection);
      await expect(page.locator('#loading')).toBeHidden();
      await page.locator('#list-close').tap();
      await expect(page.locator('#list-drawer')).toHaveAttribute('data-compact', '');
      await expect.poll(() => list.evaluate(el => el.getAnimations().length)).toBe(0);
      expect(new URL(page.url()).searchParams.get('listBounds')).toBe(previousSelection);
      await pan(page);
      expect((await selection(page)).bottom).toBeCloseTo((await list.locator('.drawer-handle').boundingBox())!.y, 0);
      expect(errors).toEqual([]);
      console.log(`${name}: mobile selection, deferred drawer bounds, animated station centering and restoration, detail order and liter labels passed`);
    } finally { await browser.close(); }
  }
} finally {
  lines.close(); fixture.stdin.end('stop\n');
  if (fixture.exitCode === null) await new Promise<void>(resolve => fixture.once('exit', () => resolve()));
}
