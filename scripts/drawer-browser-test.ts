import { chromium, webkit, devices, expect, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const fixture = spawn('bun', ['run', 'scripts/drawer-fixture.ts'], { stdio: ['pipe', 'pipe', 'inherit'] });
const lines = createInterface({ input: fixture.stdout });
const ready = new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Drawer fixture startup timed out')), 30000);
  fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Drawer fixture exited: ${code}`)); });
  lines.on('line', line => { try { const value = JSON.parse(line); if (value.ready) { clearTimeout(timer); resolve(value.ready); } } catch {} });
});
async function settled(page: Page, name: string) {
  await expect.poll(() => page.locator(`#${name}-popup`).evaluate(el => !el.hasAttribute('data-starting-style') && !el.getAnimations().length)).toBe(true);
}
try {
  const base = await ready;
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]] as const) {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext({ ...devices['iPhone 13'], serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(base);
      await expect.poll(() => page.evaluate(() => !!window.drawers?.parent)).toBe(true);
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await expect(page.locator('#outside')).toHaveJSProperty('inert', true);
      await page.locator('#child-trigger').click(); await settled(page, 'child');
      await expect(page.locator('#parent-popup')).toHaveAttribute('data-nested-drawer-open', '');
      await settled(page, 'parent');
      const referenceStyle = await page.locator('#parent-popup').evaluate(el => {
        const style = getComputedStyle(el);
        return { duration: style.transitionDuration, easing: style.transitionTimingFunction,
          height: el.getBoundingClientRect().height / new DOMMatrixReadOnly(style.transform).a,
          filter: style.filter, opacity: getComputedStyle(el.querySelector('[data-slot=drawer-content]')!).opacity };
      });
      expect(referenceStyle.duration).toBe('0.45s');
      expect(referenceStyle.easing).toBe('cubic-bezier(0.22, 1, 0.36, 1)');
      expect(referenceStyle.height).toBeCloseTo(await page.locator('#child-popup').evaluate(el => (el as HTMLElement).offsetHeight), 1);
      expect(referenceStyle.filter).toBe('brightness(0.95)');
      expect(referenceStyle.opacity).toBe('0');

      await expect.poll(() => page.locator('#parent-popup').evaluate(el => el.style.getPropertyValue('--nested-drawers'))).toBe('1');
      await page.locator('#grandchild-trigger').click(); await settled(page, 'grandchild');
      await expect.poll(() => page.locator('#parent-popup').evaluate(el => el.style.getPropertyValue('--nested-drawers'))).toBe('2');
      await expect.poll(() => page.locator('#parent-popup').evaluate(el => el.style.getPropertyValue('--drawer-frontmost-height'))).toBe('480px');
      await page.keyboard.press('Tab');
      expect(await page.locator('#grandchild-popup').evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.locator('#grandchild-popup')).toBeHidden();
      await expect(page.locator('#child-popup')).toBeVisible();
      await expect(page.locator('#grandchild-trigger')).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden');
      // A child drag updates the parent without moving/dismissing the parent.
      const handle = (await page.locator('#child-handle').boundingBox())!;
      const x = handle.x + 20, y = handle.y + 20;
      await page.mouse.move(x, y); await page.mouse.down();
      for (let i = 1; i <= 5; i++) await page.mouse.move(x, y + i * 20);
      await expect(page.locator('#parent-popup')).toHaveAttribute('data-nested-drawer-swiping', '');
      expect(await page.locator('#parent-popup').evaluate(el => parseFloat(el.style.getPropertyValue('--drawer-swipe-progress')))).toBeGreaterThan(0);
      await page.mouse.up();
      await expect(page.locator('#parent-popup')).toBeVisible();
      if (await page.locator('#child-popup').isVisible()) await page.keyboard.press('Escape');
      await expect(page.locator('#child-popup')).toBeHidden();
      await expect(page.locator('#child-trigger')).toBeFocused();
      await expect(page.locator('#parent-popup')).not.toHaveAttribute('data-nested-drawer-open', '');
      await page.keyboard.press('Escape');
      await expect(page.locator('#parent-popup')).toBeHidden();
      await expect(page.locator('#parent-trigger')).toBeFocused();
      await expect(page.locator('#outside')).toHaveJSProperty('inert', false);
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      // A short nested drag settles back with the reference transform transition.
      // Progress and the parent's swiping flag must commit together on release.
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await page.locator('#child-trigger').click(); await settled(page, 'child'); await settled(page, 'parent');
      const settlingHandle = (await page.locator('#child-handle').boundingBox())!;
      await page.mouse.move(settlingHandle.x + 20, settlingHandle.y + 20); await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(settlingHandle.x + 20, settlingHandle.y + 20 + i * 10);
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(180);
      const draggedScale = await page.locator('#parent-popup').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
      expect(draggedScale).toBeGreaterThan(.954);
      await page.mouse.up();
      const release = await page.locator('#parent-popup').evaluate(el => ({
        scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
        transitioning: el.getAnimations().some(animation => (animation as CSSTransition).transitionProperty === 'transform'),
      }));
      expect(release.transitioning).toBe(true);
      expect(release.scale).toBeGreaterThan(.9501);
      expect(release.scale).toBeLessThanOrEqual(draggedScale + .0001);
      await settled(page, 'parent');
      expect(await page.locator('#parent-popup').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBeCloseTo(.95, 3);
      await expect(page.locator('#child-popup')).toHaveAttribute('data-open', '');
      await page.keyboard.press('Escape'); await expect(page.locator('#child-popup')).toBeHidden();
      await page.keyboard.press('Escape'); await expect(page.locator('#parent-popup')).toBeHidden();
      // Native touch on Chromium, with equivalent synthetic TouchEvents on the
      // Windows WebKit port (which cannot inject native touchscreen drags).
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await page.locator('#child-trigger').click(); await settled(page, 'child');
      const cdp = name === 'chromium' ? await context.newCDPSession(page) : undefined;
      const touch = async (type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', x: number, y: number) => {
        const end = type === 'touchend' || type === 'touchcancel';
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', { type: ({ touchstart: 'touchStart', touchmove: 'touchMove', touchend: 'touchEnd', touchcancel: 'touchCancel' } as const)[type], touchPoints: end ? [] : [{ x, y, id: 1 }] });
        } else await page.evaluate(({ type, x, y, end }) => {
          const target = document.querySelector('#child-handle')!;
          const point = { identifier: 1, clientX: x, clientY: y, pageX: x, pageY: y, target };
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, { touches: { value: end ? [] : [point] }, changedTouches: { value: [point] } });
          target.dispatchEvent(event);
        }, { type, x, y, end });
      };
      const touchRect = (await page.locator('#child-handle').boundingBox())!;
      const tx = touchRect.x + 25, ty = touchRect.y + 20;
      await touch('touchstart', tx, ty);
      for (let i = 1; i <= 5; i++) { await touch('touchmove', tx, ty + 20 * i); await page.waitForTimeout(16); }
      await expect(page.locator('#parent-popup')).toHaveAttribute('data-nested-drawer-swiping', '');
      for (let i = 6; i <= 17; i++) { await touch('touchmove', tx, ty + 20 * i); await page.waitForTimeout(16); }
      await touch('touchend', tx, ty + 340);
      await expect(page.locator('#child-popup')).toBeHidden();
      await expect(page.locator('#parent-popup')).toBeVisible();
      await expect(page.locator('#child-trigger')).toBeFocused();
      await page.keyboard.press('Escape'); await expect(page.locator('#parent-popup')).toBeHidden();
      // Canceled closes must restore the resting position and keep focus/scroll locked.
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await page.evaluate(() => { window.preventDrawerClose = true; });
      await page.keyboard.press('Escape');
      await expect(page.locator('#parent-popup')).toHaveAttribute('data-open', '');
      await page.evaluate(() => { window.preventDrawerClose = false; window.drawers.parent.close(); window.drawers.parent.open(); });
      await settled(page, 'parent');
      await page.keyboard.press('Escape'); await expect(page.locator('#parent-popup')).toBeHidden();
      // Once a closing child starts restoring its parent, scale must never dip
      // back toward the nested size while that child waits to unmount.
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await page.locator('#child-trigger').click(); await settled(page, 'child'); await settled(page, 'parent');
      await page.evaluate(() => {
        const samples = { largest: 0, retreat: 0, done: false };
        (window as any).parentCloseScales = samples;
        const popup = document.querySelector('#parent-popup')!;
        const start = performance.now();
        function sample() {
          const transform = getComputedStyle(popup).transform;
          const scale = transform === 'none' ? 1 : new DOMMatrixReadOnly(transform).a;
          samples.largest = Math.max(samples.largest, scale);
          samples.retreat = Math.max(samples.retreat, samples.largest - scale);
          if (performance.now() - start < 1100) requestAnimationFrame(sample);
          else samples.done = true;
        }
        requestAnimationFrame(sample);
      });
      const closingHandle = (await page.locator('#child-handle').boundingBox())!;
      await page.mouse.move(closingHandle.x + 20, closingHandle.y + 20); await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(closingHandle.x + 20, closingHandle.y + 20 + i * 30);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
      await expect(page.locator('#child-popup')).toBeHidden();
      await expect.poll(() => page.evaluate(() => (window as any).parentCloseScales.done)).toBe(true);
      const scaleResult = await page.evaluate(() => (window as any).parentCloseScales);
      expect(scaleResult.largest).toBeCloseTo(1, 3);
      expect(scaleResult.retreat).toBeLessThan(.002);
      await page.keyboard.press('Escape'); await expect(page.locator('#parent-popup')).toBeHidden();
      // A canceled swipe must also remove its optimistic ending styles.
      await page.locator('#parent-trigger').click(); await settled(page, 'parent');
      await page.evaluate(() => { window.preventDrawerClose = true; });
      const cancelRect = (await page.locator('#parent-handle').boundingBox())!;
      await page.mouse.move(cancelRect.x + 20, cancelRect.y + 20); await page.mouse.down();
      for (let i = 1; i <= 12; i++) { await page.mouse.move(cancelRect.x + 20, cancelRect.y + 20 + i * 30); await page.waitForTimeout(16); }
      await page.mouse.up();
      await expect(page.locator('#parent-popup')).toHaveAttribute('data-open', '');
      await expect(page.locator('#parent-popup')).not.toHaveAttribute('data-ending-style', '');
      await expect.poll(() => page.locator('#parent-popup').evaluate(el => Math.round(el.getBoundingClientRect().bottom))).toBe(page.viewportSize()!.height);
      await page.evaluate(() => { window.preventDrawerClose = false; window.drawers.parent.close(); });
      await expect(page.locator('#parent-popup')).toBeHidden();
      // Snap sizes, imperative changes and reset on close use upstream resolution.
      await page.locator('#snap-trigger').click(); await settled(page, 'snap');
      await expect.poll(() => page.locator('#snap-popup').evaluate(el => el.getBoundingClientRect().height - parseFloat(el.style.getPropertyValue('--drawer-snap-point-offset')))).toBe(200);
      await page.evaluate(() => window.drawers.snap.setSnapPoint('400px'));
      await expect.poll(() => page.locator('#snap-popup').evaluate(el => parseFloat(el.style.getPropertyValue('--drawer-snap-point-offset')))).toBe(120);
      await page.keyboard.press('Escape'); await expect(page.locator('#snap-popup')).toBeHidden();
      expect(await page.evaluate(() => window.drawers.snap.snapPoint)).toBe('200px');
      // Every direction uses the same swipe engine. Drag well beyond half size.
      for (const direction of ['down', 'up', 'left', 'right'] as const) {
        await page.evaluate(direction => window.configureDrawer('side', { swipeDirection: direction }), direction);
        await page.locator('#side-trigger').click(); await settled(page, 'side');
        const rect = (await page.locator('#side-handle').boundingBox())!;
        const start = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        const dx = direction === 'left' ? -230 : direction === 'right' ? 230 : 0;
        const dy = direction === 'up' ? -350 : direction === 'down' ? 350 : 0;
        await page.mouse.move(start.x, start.y); await page.mouse.down();
        for (let i = 1; i <= 12; i++) { await page.mouse.move(start.x + dx * i / 12, start.y + dy * i / 12); await page.waitForTimeout(16); }
        await page.mouse.up();
        await expect(page.locator('#side-popup')).toBeHidden();
      }
      // Destroying an open ancestor tears down every descendant and releases the stack.
      await page.evaluate(() => { window.drawers.parent.open(); window.drawers.child.open(); window.drawers.grandchild.open(); });
      await settled(page, 'grandchild');
      await page.evaluate(() => window.drawers.parent.destroy());
      await expect(page.locator('#parent-popup')).toBeHidden();
      await expect(page.locator('#child-popup')).toBeHidden();
      await expect(page.locator('#grandchild-popup')).toBeHidden();
      expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
      await expect(page.locator('#outside')).toHaveJSProperty('inert', false);
      expect(errors).toEqual([]);
      await context.close();
      console.log(`${name}: three-level nesting, focus/scroll ownership, nested drag progress, canceled closes, interrupted animations, snap points, all swipe directions and cleanup passed`);
    } finally { await browser.close(); }
  }
} finally {
  lines.close(); fixture.stdin.end('stop\n');
  if (fixture.exitCode === null) await new Promise<void>(resolve => fixture.once('exit', () => resolve()));
}
