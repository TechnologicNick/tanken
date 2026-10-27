import { expect, type Page } from '@playwright/test';

export async function expandStationList(page: Page) {
  const list = page.locator('#list-drawer');
  await expect(list).toHaveAttribute('data-open', '');
  await expect.poll(() => list.evaluate(el => el.getAnimations().length)).toBe(0);
  if (await list.getAttribute('data-compact') === null) return;
  const handle = (await list.locator('.drawer-handle').boundingBox())!;
  const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(x, y - page.viewportSize()!.height * .25 * i / 10);
    await page.waitForTimeout(20);
  }
  // Controls must reveal while the pointer is still held, before snap selection.
  await expect(list).not.toHaveAttribute('data-compact', '');
  await expect(page.locator('.list-summary')).toHaveJSProperty('inert', false);
  // Crossing back below the same threshold also hides them without releasing.
  await page.mouse.move(x, y - 10);
  await expect(list).toHaveAttribute('data-compact', '');
  await expect(page.locator('.list-summary')).toHaveJSProperty('inert', true);
  await page.mouse.move(x, y - page.viewportSize()!.height * .25);
  await expect(list).not.toHaveAttribute('data-compact', '');
  await page.mouse.up();
  await expect(list).not.toHaveAttribute('data-compact', '');
  expect(await page.locator('.list-summary').evaluate(el =>
    el.getAnimations().some(animation => (animation as CSSTransition).transitionProperty === 'grid-template-rows')
  )).toBe(true);
  await expect.poll(() => list.evaluate(el => el.getAnimations().length)).toBe(0);
}
