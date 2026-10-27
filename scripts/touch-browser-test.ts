import { chromium, webkit, devices, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const fixture = spawn("bun", ["run", "scripts/browser-fixture.ts"], { stdio: ["pipe", "pipe", "inherit"] });
const lines = createInterface({ input: fixture.stdout });
const ready = new Promise<string>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Fixture startup timed out")), 30000);
  fixture.once("exit", code => { clearTimeout(timeout); reject(new Error(`Fixture exited: ${code}`)); });
  lines.on("line", line => {
    try {
      const value = JSON.parse(line);
      if (value.ready) { clearTimeout(timeout); resolve(value.ready); }
    } catch {}
  });
});
try {
  const base = await ready;
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
      const page = await context.newPage(), errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("https://tile.openstreetmap.org/**", route => route.abort());
      await page.goto(`${base}?bounds=52.02,4.99,52.16,5.25`);
      await expect(page.locator("canvas.station-canvas")).toBeVisible();
      await expect.poll(() => new URL(page.url()).searchParams.has("zoom")).toBe(true);
      await expect(page.locator("#loading")).toBeHidden();
      const zoom = () => Number(new URL(page.url()).searchParams.get("zoom"));
      const box = (await page.locator("#map").boundingBox())!;
      const x = box.x + box.width * .65, y = box.y + box.height * .5;
      let touchTarget = "#map";
      const cdp = name === "chromium" ? await context.newCDPSession(page) : undefined;
      const touch = async (type: string, points: { x: number; y: number; id?: number }[]) => {
        if (cdp) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: ({ touchstart: "touchStart", touchmove: "touchMove", touchend: "touchEnd", touchcancel: "touchCancel" } as const)[type as "touchstart"],
            touchPoints: points.map(p => ({ x: p.x, y: p.y, id: p.id || 1 })),
          });
          return;
        }
        await page.evaluate(({ type, points, selector }) => {
          const target = document.querySelector(selector)!;
          const touches = points.map(p => ({ identifier: p.id || 1, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, pageX: p.x, pageY: p.y, target }));
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperties(event, {
            touches: { value: touches }, targetTouches: { value: touches },
            changedTouches: { value: touches.length ? touches : [{ identifier: 1, clientX: 0, clientY: 0, target }] }
          });
          target.dispatchEvent(event);
        }, { type, points, selector: touchTarget });
      };
      const tap = async () => {
        await touch("touchstart", [{ x, y }]);
        await touch("touchend", []);
        await page.waitForTimeout(70);
      };
      const drag = async (dy: number, cancel = false) => {
        await tap();
        await touch("touchstart", [{ x, y }]);
        for (let i = 1; i <= 10; i++) {
          await touch("touchmove", [{ x, y: y + dy * i / 10 }]);
          await page.waitForTimeout(20);
        }
        await touch(cancel ? "touchcancel" : "touchend", []);
      };
      const start = zoom();
      await drag(-220);
      await expect.poll(zoom).toBe(start + 2);
      await expect(page.locator("#loading")).toBeHidden();
      await page.waitForTimeout(550);
      await drag(220);
      await expect.poll(zoom).toBe(start);
      await expect(page.locator("#loading")).toBeHidden();
      await page.waitForTimeout(550);
      await tap();
      await tap();
      await expect.poll(zoom).toBe(start + 1);
      await page.waitForTimeout(550);
      await drag(-110, true);
      await expect.poll(zoom).toBe(start + 2);
      await page.waitForTimeout(550);
      const beforePan = new URL(page.url()).searchParams.get("bounds");
      await touch("touchstart", [{ x, y }]);
      for (let i = 1; i <= 8; i++) {
        await touch("touchmove", [{ x: x + i * 10, y }]);
        await page.waitForTimeout(20);
      }
      await touch("touchend", []);
      await expect.poll(() => new URL(page.url()).searchParams.get("bounds")).not.toBe(beforePan);
      expect(zoom()).toBe(start + 2);
      await page.waitForTimeout(550);
      await touch("touchstart", [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }]);
      for (let i = 1; i <= 8; i++) {
        await touch("touchmove", [{ x: x - 35 - i * 8, y, id: 1 }, { x: x + 35 + i * 8, y, id: 2 }]);
        await page.waitForTimeout(20);
      }
      await touch("touchend", []);
      await expect.poll(zoom).toBeGreaterThan(start + 2);
      await page.goto(`${base}?bounds=52.02,4.99,52.16,5.25`);
      await expect(page.locator("canvas.station-canvas")).toBeVisible();
      const popup = page.locator("#station-card"), body = page.locator("#station-card-body");
      const openDrawer = async () => {
        // Isolate independent scroll scenarios from Chromium's compositor fling.
        await page.goto(`${base}?bounds=52.02,4.99,52.16,5.25`);
        await expect(page.locator("canvas.station-canvas")).toBeVisible();
        await expect(page.locator("#list-drawer")).toHaveAttribute("data-open", "");
        await page.locator("#stations .station").first().tap();
        await expect(body.locator("article")).toBeVisible();
        await expect.poll(() => popup.evaluate(el =>
          !el.hasAttribute("data-starting-style") && el.getAnimations().length === 0
        )).toBe(true);
      };
      // Base UI dismisses slow swipes beyond half the popup's height.
      const swipeDrawer = async (selector: string, distance = 350) => {
        touchTarget = selector;
        const rect = (await page.locator(selector).boundingBox())!;
        const p = { x: rect.x + 3, y: rect.y + Math.min(rect.height / 2, 30) };
        await touch("touchstart", [p]);
        for (let i = 1; i <= 12; i++) {
          await touch("touchmove", [{ x: p.x, y: p.y + i * distance / 12 }]);
          // Synthetic WebKit events don't perform the browser's default scroll.
          if (name === "webkit" && selector === "#station-card-body")
            await body.evaluate((el, delta) => { el.scrollTop = Math.max(0, el.scrollTop - delta); }, distance / 12);
          await page.waitForTimeout(16);
        }
        await touch("touchend", []);
      };
      await openDrawer();
      // Windows' WebKit port can omit overscroll CSS; iOS 17 supports it.
      const cardHeight = () => popup.evaluate(el => innerHeight - el.getBoundingClientRect().top);
      await expect.poll(cardHeight).toBeCloseTo(page.viewportSize()!.height * .455, 0);
      await swipeDrawer("#station-card .drawer-handle", -page.viewportSize()!.height * .5);
      await expect.poll(cardHeight).toBeCloseTo(page.viewportSize()!.height, 0);
      await expect.poll(() => popup.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
      await swipeDrawer("#station-card .drawer-handle", page.viewportSize()!.height * .4);
      await expect.poll(cardHeight).toBeCloseTo(page.viewportSize()!.height * .455, 0);
      if (await page.evaluate(() => CSS.supports("overscroll-behavior", "contain")))
        expect(await body.evaluate(el => getComputedStyle(el).getPropertyValue("overscroll-behavior"))).toBe("contain");
      await swipeDrawer("#station-card .drawer-handle");
      await expect(popup).toBeHidden();
      await expect(page.locator("#stations .station").first()).toBeVisible();
      await openDrawer();
      // Ensure a long card exercises scroll arbitration in both browser engines.
      await body.evaluate(el => {
        const spacer = document.createElement("div");
        spacer.style.height = "1200px";
        el.append(spacer);
        el.scrollTop = 180;
      });
      await swipeDrawer("#station-card-body", 80);
      await expect(popup).toBeVisible();
      expect(await popup.getAttribute("data-swiping")).toBeNull();
      await openDrawer();
      await swipeDrawer("#station-card-body");
      await expect(popup).toBeHidden();
      await expect(page.locator("#stations .station").first()).toBeVisible();
      await openDrawer();
      await page.locator("#station-card-close").tap();
      await expect(popup).toBeHidden();
      await expect(page.locator("#stations .station").first()).toBeVisible();
      await openDrawer();
      // Non-modal details keep search and the exposed map interactive.
      await expect(popup).not.toHaveAttribute('aria-modal', 'true');
      await expect(page.locator('#station-backdrop')).toBeHidden();
      await page.locator('#search').focus();
      await expect(page.locator('#search')).toBeFocused();
      await expect(popup).toBeVisible();
      await page.locator('#map').tap({position:{x:20,y:100}});
      await expect(popup).toBeVisible();
      await page.locator('#station-card-close').tap();
      await expect(popup).toBeHidden();
      await expect(page.locator("#stations .station").first()).toBeVisible();
      expect(errors).toEqual([]);
      const list = page.locator("#list-drawer");
      const settledList = () => expect.poll(() => list.evaluate(el => el.getAnimations().length)).toBe(0);
      await settledList();
      const visibleListHeight = () => list.evaluate(el => innerHeight - el.getBoundingClientRect().top);
      const peekHeight = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--list-peek-height')));
      await expect.poll(visibleListHeight).toBeCloseTo(peekHeight, 0);
      await swipeDrawer("#list-drawer .drawer-handle", -page.viewportSize()!.height * .25);
      await settledList();
      await expect.poll(visibleListHeight).toBeCloseTo(page.viewportSize()!.height * .455, 0);
      await swipeDrawer("#list-drawer .drawer-handle", -page.viewportSize()!.height * .5);
      await settledList();
      await expect.poll(visibleListHeight).toBeCloseTo(page.viewportSize()!.height, 0);
      await expect.poll(() => list.evaluate(el => getComputedStyle(el).paddingBottom)).toBe('0px');
      await expect(page.locator("#list-viewport")).toHaveAttribute("data-expanded", "");
      expect(await page.evaluate(() => document.elementFromPoint(40, 40)?.closest('[data-slot="drawer-popup"]')?.id)).toBe("list-drawer");
      await page.locator("#stations .station").first().tap();
      await expect(body.locator("article")).toBeVisible();
      await page.locator("#station-card-close").tap();
      await expect(popup).toBeHidden();
      await settledList();
      await expect.poll(visibleListHeight).toBeCloseTo(page.viewportSize()!.height, 0);
      await swipeDrawer("#list-drawer .drawer-handle", page.viewportSize()!.height * .4);
      await settledList();
      await expect.poll(visibleListHeight).toBeCloseTo(page.viewportSize()!.height * .455, 0);
      await swipeDrawer("#list-drawer .drawer-handle");
      await settledList();
      await expect.poll(visibleListHeight).toBeCloseTo(peekHeight, 0);
      await swipeDrawer("#list-drawer .drawer-handle");
      await settledList();
      await expect(page.locator("#list-drawer")).toHaveAttribute("data-open", "");
      await expect(page.locator("#map")).toBeVisible();
      await expect(page.locator("#search")).toBeVisible();
      await expect(page.locator("#mobile-toggle")).toHaveCount(0);
      await context.close();
      console.log(`${name}: map gestures, drawer handle dismissal, content scrolling and swipe dismissal at the top passed`);
    } finally { await browser.close(); }
  }
} finally {
  lines.close();
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null)
    await new Promise<void>(resolve => fixture.once("exit", () => resolve()));
}
