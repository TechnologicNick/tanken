import { chromium, webkit, devices, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Node drives Playwright; all application and fixture code runs under Bun.
const fixture = spawn("bun", ["run", "scripts/browser-fixture.ts"], {
  stdio: ["pipe", "pipe", "inherit"],
});
const lines = createInterface({ input: fixture.stdout });
const ready = new Promise<{ ready: string; station: number }>(
  (resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture startup timed out")),
      30000,
    );
    fixture.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Fixture exited: ${code}`));
    });
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line);
        if (value.ready) {
          clearTimeout(timer);
          resolve(value);
        }
      } catch {}
    });
  },
);
try {
  const { ready: base } = await ready;
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const mobile of [false, true]) {
        const context = await browser.newContext(mobile
          ? { ...devices["iPhone 13"], serviceWorkers: "block" }
          : { viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
        const page = await context.newPage();
        await page.route("https://tile.openstreetmap.org/**", route => route.abort());
        const searches: string[] = [];
        await page.route("**/api/search?**", async route => {
          const q = new URL(route.request().url()).searchParams.get("q")!;
          searches.push(q);
          if (q === "Older") await new Promise(resolve => setTimeout(resolve, 700));
          await route.fulfill({ json: Array.from({ length: 7 }, (_, i) => ({ label: `${q} ${i + 1}`, lat: 52.08, lng: 5.5 })) });
        });
        await page.goto(base);
        await expect(page.locator("canvas.station-canvas")).toBeVisible();
        if (mobile) await page.locator("#mobile-toggle").tap();
        const input = page.locator("#search"), options = page.locator("#search-results button");
        await input.fill("O");
        await page.waitForTimeout(400);
        expect(searches).toEqual([]);
        await input.fill("Older");
        await expect.poll(() => searches.includes("Older")).toBe(true);
        await input.fill("Newest");
        await expect(options).toHaveCount(5);
        await page.waitForTimeout(800);
        await expect(options.first()).toHaveText("Newest 1");
        await expect(input).toHaveAttribute("aria-expanded", "true");
        await input.press("Escape");
        await expect(options).toHaveCount(0);
        await input.fill("");
        await input.fill("Newest");
        await expect(options).toHaveCount(5);
        expect(searches).toEqual(["Older", "Newest"]);
        if (mobile) await options.nth(1).tap();
        else {
          await input.press("ArrowDown");
          await input.press("ArrowDown");
          await expect(input).toHaveAttribute("aria-activedescendant", "search-option-1");
          await input.press("Enter");
        }
        await expect(page.locator("#search-status")).toHaveText("Newest 2");
        await expect(page.locator("#map")).toBeVisible();
        await expect.poll(() => new URL(page.url()).searchParams.get("bounds")).toContain("5.");
        if (mobile) await page.locator("#mobile-toggle").tap();
        await input.fill("");
        await expect(options).toHaveCount(0);
        await page.locator('[name="country"]').selectOption("eu");
        await input.fill("Europa");
        await page.waitForTimeout(400);
        expect(searches).toEqual(["Older", "Newest"]);
        await page.locator("#search-form button").first().click();
        await expect(options).toHaveCount(5);
        expect(searches).toEqual(["Older", "Newest", "Europa"]);
        await context.close();
        console.log(`${name} ${mobile ? "mobile" : "desktop"}: autocomplete, five-result limit, stale responses, cache, dismissal, selection and explicit European search passed`);
      }
    } finally { await browser.close(); }
  }
} finally {
  lines.close();
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null)
    await new Promise<void>(resolve => fixture.once("exit", () => resolve()));
}
