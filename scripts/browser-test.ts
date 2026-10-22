import { chromium, webkit, devices, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir } from "node:fs/promises";

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
  const { ready: base, station } = await ready;
  await mkdir("test-results", { recursive: true });
  for (const [name, engine] of [
    ["chromium", chromium],
    ["webkit", webkit],
  ] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"] });
      await context.addInitScript(() => {
        const groupColors = new Set<string>();
        (window as any).testGroupColors = groupColors;
        const roundRect = CanvasRenderingContext2D.prototype.roundRect;
        const fill = CanvasRenderingContext2D.prototype.fill;
        CanvasRenderingContext2D.prototype.roundRect = function (
          ...args: Parameters<typeof roundRect>
        ) {
          (this as any).testGroupShape = args[3] === 24;
          return roundRect.apply(this, args);
        };
        CanvasRenderingContext2D.prototype.fill = function (...args: any[]) {
          if ((this as any).testGroupShape)
            groupColors.add(String(this.fillStyle));
          (this as any).testGroupShape = false;
          return (fill as any).apply(this, args);
        };
        const painted = new Set<string>();
        (window as any).testPaintedTexts = painted;
        (window as any).testGroupBoxes = [];
        (window as any).testCanvasClears = 0;
        const clearRect = CanvasRenderingContext2D.prototype.clearRect;
        CanvasRenderingContext2D.prototype.clearRect = function (
          ...args: Parameters<typeof clearRect>
        ) {
          (window as any).testGroupBoxes = [];
          (window as any).testCanvasClears++;
          return clearRect.apply(this, args);
        };
        const fillText = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function (
          ...args: Parameters<typeof fillText>
        ) {
          painted.add(args[0]);
          if (/×\d+$/.test(args[0])) {
            const rect = this.canvas.getBoundingClientRect(),
              transform = this.getTransform();
            (window as any).testGroupBoxes.push({
              x: args[1],
              y: args[2],
              width: Math.ceil(this.measureText(args[0]).width) + 16,
              clientX:
                rect.left +
                ((transform.a * args[1] + transform.c * args[2] + transform.e) *
                  rect.width) /
                  this.canvas.width,
              clientY:
                rect.top +
                ((transform.b * args[1] + transform.d * args[2] + transform.f) *
                  rect.height) /
                  this.canvas.height,
            });
          }
          return fillText.apply(this, args);
        };
        window.WebSocket = new Proxy(WebSocket, {
          construct(target, args) {
            const socket = Reflect.construct(target, args);
            (window as typeof window & { testSocket: WebSocket }).testSocket =
              socket;
            Object.defineProperty(socket, "onmessage", {
              set(handler) {
                socket.addEventListener("message", (event: MessageEvent) => {
                  const delay = (window as any).testMessageDelay || 0;
                  if (delay)
                    setTimeout(() => handler.call(socket, event), delay);
                  else handler.call(socket, event);
                });
              },
            });
            return socket;
          },
        });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      let sockets = 0,
        frames = 0,
        apiRequests = 0,
        drawerRequests = 0;
      page.on("websocket", (ws) => {
        if (!ws.url().endsWith("/ws/stations")) return;
        sockets++;
        ws.on("framereceived", () => {
          frames++;
        });
      });
      page.on("request", (request) => {
        if (new URL(request.url()).pathname === "/api/stations") apiRequests++;
        if (new URL(request.url()).pathname.startsWith("/assets/drawer-"))
          drawerRequests++;
      });
      page.on("pageerror", (error) => errors.push(error.message));
      if (process.env.BROWSER_DEBUG) {
        page.on("console", (message) =>
          console.log(name, message.type(), message.text()),
        );
        page.on("websocket", (ws) => {
          console.log(name, "socket", ws.url());
          ws.on("framesent", (event) =>
            console.log(name, "sent", event.payload),
          );
          ws.on("framereceived", () => console.log(name, "received"));
          ws.on("socketerror", (error) =>
            console.log(name, "socketerror", error),
          );
          ws.on("close", () => console.log(name, "closed"));
        });
      }
      await page.route("https://tile.openstreetmap.org/**", (route) =>
        route.abort(),
      );
      await page.goto(base);
      await expect(page.locator(".leaflet-container")).toBeVisible();
      const canvas = page.locator("canvas.station-canvas");
      await expect(canvas).toBeVisible();
      await expect(canvas).toHaveAttribute("data-station-count", "2");
      await expect.poll(() => frames).toBeGreaterThan(0);
      await expect(page.locator("#refresh")).toHaveCount(0);
      await expect(page.locator(".pin-label, img.station-pin")).toHaveCount(0);
      const retainedCanvas = await canvas.elementHandle();
      // Pixel checks catch a blank canvas even if marker metadata is present.
      expect(
        await canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const pixels = c
            .getContext("2d")!
            .getImageData(0, 0, c.width, c.height).data;
          let painted = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) painted++;
          return painted;
        }),
      ).toBeGreaterThan(100);
      const clickStation = async (lat: number, lng: number) => {
        const point = await page.evaluate(
          ({ lat, lng }) => {
            const params = new URLSearchParams(location.search);
            const bounds = params.get("bounds")!.split(",").map(Number);
            const zoom = Number(params.get("zoom"));
            const project = (lat: number, lng: number) =>
              (window as any).L.CRS.EPSG3857.latLngToPoint(
                (window as any).L.latLng(lat, lng),
                zoom,
              );
            const sw = project(bounds[0], bounds[1]),
              ne = project(bounds[2], bounds[3]),
              p = project(lat, lng);
            const rect = document
              .querySelector("#map")!
              .getBoundingClientRect();
            return {
              x: rect.x + rect.width / 2 + p.x - (sw.x + ne.x) / 2,
              y: rect.y + rect.height / 2 + p.y - (sw.y + ne.y) / 2 - 8,
            };
          },
          { lat, lng },
        );
        await page.mouse.click(point.x, point.y);
      };
      await expect.poll(() => page.url().includes("mapBounds=")).toBe(true);
      const startZoom = Number(new URL(page.url()).searchParams.get("zoom"));
      const clears = await page.evaluate(async () => {
        await new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        );
        (window as any).testMessageDelay = 600;
        return (window as any).testCanvasClears;
      });
      const initialFrames = frames;
      await page.locator(".leaflet-control-zoom-out").evaluate(el => (el as HTMLElement).click());
      await expect.poll(() => frames).toBeGreaterThan(initialFrames);
      // Even with a slow reply, zoom only transforms the existing canvas; it
      // must not repaint old groups and then repaint again with the new groups.
      expect(await page.evaluate(() => (window as any).testCanvasClears)).toBe(
        clears,
      );
      await expect
        .poll(() => Number(new URL(page.url()).searchParams.get("zoom")))
        .toBe(startZoom - 1);
      await page.evaluate(() => {
        (window as any).testMessageDelay = 0;
      });
      await page.locator(".leaflet-control-zoom-out").evaluate(el => (el as HTMLElement).click());
      await expect(
        page.locator("#stations .station").filter({ hasText: "Tango Oost" }),
      ).toHaveCount(1);
      expect(await retainedCanvas!.evaluate((el) => el.isConnected)).toBe(true);
      const before = frames;
      const rect = (await page.locator("#map").boundingBox())!;
      await page.mouse.move(
        rect.x + rect.width * 0.65,
        rect.y + rect.height * 0.65,
      );
      await page.mouse.down();
      // A paced drag avoids launching a high-velocity inertial fling.
      for (let step = 1; step <= 15; step++) {
        await page.mouse.move(
          rect.x + rect.width * (0.65 - (0.2 * step) / 15),
          rect.y + rect.height * 0.65,
        );
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      await page.mouse.up();
      await expect.poll(() => frames).toBeGreaterThan(before);
      expect(sockets).toBe(1);
      expect(apiRequests).toBe(0);
      expect(await retainedCanvas!.evaluate((el) => el.isConnected)).toBe(true);
      const beforeReconnect = frames;
      await page.evaluate(() =>
        (
          window as typeof window & { testSocket: WebSocket }
        ).testSocket.close(),
      );
      await expect.poll(() => sockets).toBe(2);
      await expect.poll(() => frames).toBeGreaterThan(beforeReconnect);
      expect(apiRequests).toBe(0);
      await page.screenshot({ path: `test-results/${name}-map.png` });
      expect(drawerRequests).toBe(0);
      await page.locator("#mobile-toggle").click();
      await expect(page.locator("#list-drawer")).toHaveAttribute("data-open", "");
      await expect(page.locator("#map")).toBeVisible();
      await expect(page.locator("#search")).toBeVisible();
      expect(await page.locator("#search").evaluate(el => el.closest('[data-slot="drawer-popup"]'))).toBeNull();
      expect(await page.locator("#fuel").evaluate(el => el.closest('[data-slot="drawer-popup"]')?.id)).toBe("list-drawer");
      await expect(page.locator('.searchbox button[type="submit"]')).toHaveCount(0);
      await expect(page.locator('.leaflet-control-zoom')).toBeHidden();
      await expect.poll(() => page.locator('#list-drawer').evaluate(el => el.getBoundingClientRect().height - parseFloat((el as HTMLElement).style.getPropertyValue('--drawer-snap-point-offset')))).toBeCloseTo(page.viewportSize()!.height * .455, 0);
      await expect(page.locator('#updated')).toHaveCount(0);
      const fullscreenMap = (await page.locator("#map").boundingBox())!;
      expect(fullscreenMap.y).toBe(0);
      expect(fullscreenMap.height).toBe(page.viewportSize()!.height);
      const countBox = (await page.locator("#count").boundingBox())!;
      const sortBox = (await page.locator("#sort").boundingBox())!;
      expect(sortBox.x).toBeGreaterThan(countBox.x + countBox.width);
      expect(await page.locator("#fuel").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await expect(
        page.locator("#stations .station").filter({ hasText: "Tango Oost" }),
      ).toHaveCount(1);
      await page.screenshot({
        path: `test-results/${name}-list.png`,
        fullPage: true,
      });
      expect(drawerRequests).toBe(1);
      const eastLink = page
        .locator("#stations .station")
        .filter({ hasText: "Tango Oost" });
      await eastLink.click();
      await expect(page.locator("#station-card")).toHaveAttribute(
        "role",
        "dialog",
      );
      await expect(page.locator("#station-card")).not.toHaveAttribute("aria-modal", "true");
      await expect(page.locator("#station-card-title")).toHaveText(
        "Tango Oost",
      );
      await expect(page.locator("#station-card-body article")).toContainText(
        "Shop",
      );
      await expect(page.getByRole('link', {name:'Apple Kaarten ↗'})).toBeVisible();
      const googleLink = page.getByRole('link', {name:'Google Maps ↗'});
      await expect(googleLink).toBeVisible();
      const googleUrl = new URL((await googleLink.getAttribute('href'))!);
      expect(googleUrl.searchParams.get('api')).toBe('1');
      expect(googleUrl.pathname).toBe('/maps/search/');
      expect(googleUrl.searchParams.get('query')).toContain('Tango Oost');
      expect(googleUrl.searchParams.get('query')).toContain('Teststraat 1');
      expect(googleUrl.searchParams.has('dir_action')).toBe(false);
      expect(new URL(page.url()).pathname).toBe('/');
      expect(drawerRequests).toBe(1);
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              document.getElementById("station-card")!.getAnimations().length,
          ),
        )
        .toBe(0);
      await page.screenshot({ path: `test-results/${name}-drawer.png` });
      await page.keyboard.press("Escape");
      await expect(page.locator("#station-card")).toBeHidden();
      await expect(eastLink).toBeVisible();
      await expect(page.locator("#list-drawer")).toHaveAttribute("data-open", "");
      await eastLink.click();
      await expect(page.locator("#station-card-body article")).toBeVisible();
      await expect.poll(() => page.locator("#station-card").evaluate(el =>
        !el.hasAttribute("data-starting-style") && el.getAnimations().length === 0
      )).toBe(true);
      const handle = (await page.locator("#station-card .drawer-handle").boundingBox())!;
      await page.mouse.move(
        handle.x + handle.width / 2,
        handle.y + handle.height / 2,
      );
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(
          handle.x + handle.width / 2,
          handle.y + handle.height / 2 + i * 24,
        );
        await new Promise((r) => setTimeout(r, 16));
      }
      await page.mouse.up();
      await expect(page.locator("#station-card")).toBeHidden();
      expect(drawerRequests).toBe(1);
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller)
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener(
              "controllerchange",
              () => resolve(),
              { once: true },
            ),
          );
      });
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const keys = await caches.keys();
            const cache = await caches.open(
              keys.find((key) => key.startsWith("tanken-pages-"))!,
            );
            return (
              (await cache.keys()).some(
                (key) => new URL(key.url).pathname === "/",
              ) &&
              !!(await cache.match(
                `${location.origin}/api/stations${location.search}`,
              ))
            );
          }),
        )
        .toBe(true);
      await context.setOffline(true);
      await page.reload();
      await expect(
        page.locator("#stations .station").filter({ hasText: "Tango Oost" }),
      ).toHaveCount(1);
      await page.locator("#mobile-toggle").click();
      await eastLink.click();
      await expect(page.locator("#station-card-body article")).toContainText(
        "Shop",
      );
      await page.keyboard.press("Escape");
      await expect(page.locator("#station-card")).toBeHidden();
      await context.setOffline(false);
      // Cache a station page and its server-rendered archive.
      await page.goto(`${base}stations/${station}?fuel=EURO95`);
      await expect(page.locator("h1")).toHaveText("Tango Test");
      await expect(page.locator(".history-chart")).toHaveCount(1);
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const keys = await caches.keys();
            const cache = await caches.open(
              keys.find((key) => key.startsWith("tanken-pages-"))!,
            );
            return !!(await cache.match(location.href));
          }),
        )
        .toBe(true);
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator("h1")).toHaveText("Tango Test");
      await expect(page.locator("#connection")).toBeVisible();
      await page.goto(`${base}stations/2147483647`);
      await expect(page.locator("h1")).toHaveText("Je bent offline");
      expect(errors).toEqual([]);
      await context.setOffline(false);
      await page.goto(`${base}?bounds=47.99,5.99,48.03,6.03&zoom=14`);
      await expect(page.locator("canvas.station-canvas")).toHaveAttribute(
        "data-station-count",
        "600",
      );
      await expect(page.locator("#count")).toHaveText("600 stations");
      await expect(page.locator("canvas.station-canvas")).toHaveCount(1);
      await expect(
        page.locator(".leaflet-tooltip, img.station-pin"),
      ).toHaveCount(0);
      await expect
        .poll(() => new URL(page.url()).searchParams.has("mapBounds"))
        .toBe(true);
      const denseZoom = Number(new URL(page.url()).searchParams.get("zoom"));
      const denseFrames = frames;
      await page.locator(".leaflet-control-zoom-out").evaluate(el => (el as HTMLElement).click());
      await expect.poll(() => frames).toBeGreaterThan(denseFrames);
      await expect
        .poll(() => Number(new URL(page.url()).searchParams.get("zoom")))
        .toBeLessThan(denseZoom);
      await expect(page.locator(".leaflet-zoom-anim")).toHaveCount(0);
      await expect(page.locator("canvas.station-canvas")).toHaveAttribute(
        "data-station-count",
        "600",
      );
      await expect
        .poll(() =>
          page.evaluate(() =>
            [...((window as any).testPaintedTexts as Set<string>)].some(
              (text) => /1,59/.test(text),
            ),
          ),
        )
        .toBe(true);
      expect(
        await page.evaluate(() =>
          (window as any).testGroupColors.has("#fff3e4"),
        ),
      ).toBe(true);
      await page.screenshot({ path: `test-results/${name}-dense.png` });
      const beforeGroupClick = Number(
        new URL(page.url()).searchParams.get("zoom"),
      );
      const group = await page.evaluate(() => {
        const rect = document.querySelector("#map")!.getBoundingClientRect();
        return (window as any).testGroupBoxes.findLast(
          (box: any) =>
            box.clientX > rect.left + 50 &&
            box.clientX < rect.right - 50 &&
            box.clientY > rect.top + 100 &&
            box.clientY < rect.bottom - 100,
        );
      });
      expect(group).toBeTruthy();
      await page.mouse.click(group.clientX, group.clientY);
      await expect
        .poll(() => Number(new URL(page.url()).searchParams.get("zoom")))
        .toBeGreaterThan(beforeGroupClick);
      await page.goto(`${base}?bounds=52.079,5.119,52.081,5.121&zoom=17`);
      await expect.poll(() => page.url().includes("mapBounds=")).toBe(true);
      await clickStation(52.08, 5.12);
      await expect(page.locator(".leaflet-popup")).toHaveCount(0);
      await expect(page.locator("#station-card-body article")).toHaveAttribute("data-station-id", String(station));
      await page.locator("#station-card-close").tap();
      await expect(page.locator("#station-card")).toBeHidden();
      await expect(page.locator("#map")).toBeVisible();
      expect(errors).toEqual([]);
      await page.locator("#mobile-toggle").tap();
      await page.locator("#search").fill("Teststad");
      await expect(page.locator("#search-results button")).toHaveCount(2);
      await page.locator("#search-results button").nth(1).tap();
      await expect(page.locator("#search")).toHaveValue("Teststad oost");
      await expect(page.locator("#search-status")).toBeEmpty();
      await expect(page.locator("#map")).toBeVisible();
      await context.close();
      const desktop = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
      });
      await desktop.addInitScript(() => {
        window.WebSocket = new Proxy(WebSocket, {
          construct(target, args) {
            const socket = Reflect.construct(target, args);
            Object.defineProperty(socket, "onmessage", {
              set(handler) {
                socket.addEventListener("message", (event: MessageEvent) => {
                  const delay = (window as any).testMessageDelay || 0;
                  if (delay)
                    setTimeout(() => handler.call(socket, event), delay);
                  else handler.call(socket, event);
                });
              },
            });
            return socket;
          },
        });
      });
      const cardPage = await desktop.newPage();
      let desktopDrawerRequests = 0;
      cardPage.on("request", (req) => {
        if (new URL(req.url()).pathname.startsWith("/assets/drawer-"))
          desktopDrawerRequests++;
      });
      await cardPage.route("https://tile.openstreetmap.org/**", (route) =>
        route.abort(),
      );
      await cardPage.goto(base);
      await expect.poll(() => cardPage.url().includes("mapBounds=")).toBe(true);
      await expect(cardPage.locator("#loading")).toBeHidden();
      const beforeLoading = await cardPage
        .locator("aside")
        .evaluate((aside) => ({
          stations: aside.querySelector("#stations")!.innerHTML,
          status: aside.querySelector("#status")!.textContent,
          pagination: aside.querySelector("#pagination")!.innerHTML,
          count: aside.querySelector("#count")!.textContent,
          top: aside.querySelector("#stations")!.getBoundingClientRect().top,
        }));
      await cardPage.evaluate(() => {
        (window as any).testMessageDelay = 1000;
      });
      await cardPage.locator('#fuel label').filter({hasText:"Diesel · B7"}).click();
      await expect(cardPage.locator("#loading")).toBeVisible();
      await expect(cardPage.locator("#stations")).toHaveAttribute(
        "aria-busy",
        "true",
      );
      expect(
        await cardPage.locator("aside").evaluate((aside) => ({
          stations: aside.querySelector("#stations")!.innerHTML,
          status: aside.querySelector("#status")!.textContent,
          pagination: aside.querySelector("#pagination")!.innerHTML,
          count: aside.querySelector("#count")!.textContent,
          top: aside.querySelector("#stations")!.getBoundingClientRect().top,
        })),
      ).toEqual(beforeLoading);
      await expect(cardPage.locator("#loading")).toBeHidden();
      await expect(cardPage.locator("#stations .money").first()).toContainText(
        "1,729",
      );
      await cardPage.evaluate(() => {
        (window as any).testMessageDelay = 0;
      });
      await cardPage.locator('#fuel label').filter({hasText:"Euro 95 · E10"}).click();
      await expect(cardPage.locator("#stations .money").first()).toContainText(
        "1,839",
      );
      const firstLink = cardPage.locator("#stations .station").first();
      await firstLink.hover();
      await expect(cardPage.locator(".station-highlight")).toBeVisible();
      await expect(cardPage.locator(".station-highlight-label")).toContainText(
        "Tango Test",
      );
      await cardPage.locator("#search").hover();
      await expect(cardPage.locator(".station-highlight")).toHaveCount(0);
      await firstLink.click();
      await expect(
        cardPage.locator("#station-card-body article"),
      ).toContainText("Shop");
      await expect(cardPage.locator("aside")).toBeVisible();
      await expect(
        cardPage.locator("#station-card .history-chart path"),
      ).toHaveAttribute("d", /M.+H/);
      await expect(
        cardPage.locator("#station-card .history-chart circle"),
      ).toHaveCount(1);
      await expect(
        cardPage.locator("#station-card .opening-hours li"),
      ).toHaveCount(7);
      await expect(
        cardPage.locator("#station-card .price-last").first(),
      ).toHaveText("9");
      await expect(cardPage.getByRole("radio", { name: "Euro 95 · E10", exact: true })).toBeChecked();
      const area = (await cardPage.locator("#list-area").boundingBox())!;
      const mapBox = (await cardPage.locator("#map").boundingBox())!;
      expect(area.x - mapBox.x).toBeCloseTo(mapBox.width * 0.25, 0);
      expect(area.y - mapBox.y).toBeCloseTo(mapBox.height * 0.25, 0);
      expect(area.width).toBeCloseTo(mapBox.width * 0.5, 0);
      const central = new URL(cardPage.url()).searchParams
        .get("listBounds")!
        .split(",")
        .map(Number);
      for (const station of await cardPage
        .locator("#stations .station")
        .evaluateAll((links) =>
          links.map((link) => ({
            lat: Number((link as HTMLElement).dataset.lat),
            lng: Number((link as HTMLElement).dataset.lng),
          })),
        )) {
        expect(station.lat).toBeGreaterThanOrEqual(central[0]!);
        expect(station.lat).toBeLessThanOrEqual(central[2]!);
        expect(station.lng).toBeGreaterThanOrEqual(central[1]!);
        expect(station.lng).toBeLessThanOrEqual(central[3]!);
      }
      const sidebar = (await cardPage.locator("aside").boundingBox())!;
      const card = (await cardPage.locator("#station-card").boundingBox())!;
      expect(card.x).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
      expect(new URL(cardPage.url()).pathname).toBe("/");
      expect(desktopDrawerRequests).toBe(0);
      await cardPage.screenshot({
        path: `test-results/${name}-station-card.png`,
      });
      await cardPage.keyboard.press("Escape");
      await expect(cardPage.locator("#station-card")).toBeHidden();
      const secondLink = cardPage.locator("#stations .station").nth(1);
      const secondId = await secondLink.getAttribute("data-id");
      await secondLink.click();
      await expect(
        cardPage.locator("#station-card-body article"),
      ).toHaveAttribute("data-station-id", secondId!);
      await cardPage.locator("#station-card-close").click();
      await expect(cardPage.locator("#station-card")).toBeHidden();
      await cardPage.route("**/stations/*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Unavailable",
        }),
      );
      await firstLink.click();
      await expect(cardPage.locator("#station-card-body")).toContainText(
        "Stationinformatie kon niet worden opgehaald.",
      );
      await expect(cardPage.locator("#station-card-body a")).toHaveText(
        "Open stationspagina →",
      );
      await cardPage.locator("#station-card-close").click();
      const stationPoint = (lng: number) =>
        cardPage.evaluate((lng) => {
          const params = new URLSearchParams(location.search),
            b = params.get("bounds")!.split(",").map(Number),
            zoom = Number(params.get("zoom"));
          const L = (window as any).L,
            project = (lat: number, lng: number) =>
              L.CRS.EPSG3857.latLngToPoint(L.latLng(lat, lng), zoom);
          const sw = project(b[0]!, b[1]!),
            ne = project(b[2]!, b[3]!),
            p = project(52.08, lng),
            rect = document.querySelector("#map")!.getBoundingClientRect();
          return {
            x: rect.x + rect.width / 2 + p.x - (sw.x + ne.x) / 2,
            y: rect.y + rect.height / 2 + p.y - (sw.y + ne.y) / 2,
          };
        }, lng);
      const paintStation = async (lng: number) => {
        const p = await stationPoint(lng);
        await cardPage.mouse.move(p.x - 6, p.y);
        await cardPage.mouse.down({ button: "right" });
        await cardPage.mouse.move(p.x + 6, p.y, { steps: 6 });
        await cardPage.mouse.up({ button: "right" });
      };
      const beforePaintBounds = new URL(cardPage.url()).searchParams.get(
        "bounds",
      );
      await paintStation(5.12);
      await expect(
        cardPage.locator(".leaflet-brush-pane path").first(),
      ).toHaveAttribute("stroke-width", "124.8");
      await expect(cardPage.locator("#count")).toHaveText("1 stations");
      await expect(cardPage.locator("#list-area")).toBeHidden();
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(1);
      expect(new URL(cardPage.url()).searchParams.get("bounds")).toBe(
        beforePaintBounds,
      );
      const paintAlpha = () =>
        cardPage.evaluate(async () => {
          const pane = document.querySelector<HTMLElement>(
            ".leaflet-brush-pane",
          )!;
          const source = pane.querySelector("svg")!;
          const svg = source.cloneNode(true) as SVGSVGElement;
          svg.style.transform = "";
          svg.style.opacity = getComputedStyle(pane).opacity;
          const canvas = document.createElement("canvas");
          canvas.width = source.width.baseVal.value;
          canvas.height = source.height.baseVal.value;
          const image = new Image();
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
          await image.decode();
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(image, 0, 0);
          const pixels = ctx.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data;
          let alpha = 0;
          for (let i = 3; i < pixels.length; i += 4)
            alpha = Math.max(alpha, pixels[i]!);
          return alpha;
        });
      const singleAlpha = await paintAlpha();
      expect(singleAlpha).toBeGreaterThan(50);
      await paintStation(5.12);
      expect(await paintAlpha()).toBe(singleAlpha);
      await cardPage.mouse.click(
        mapBox.x + mapBox.width * 0.8,
        mapBox.y + mapBox.height * 0.6,
        { button: "right" },
      );
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(0);
      await paintStation(5.12);
      await paintStation(5.15);
      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(2);
      expect(new URL(cardPage.url()).searchParams.has("brush")).toBe(false);
      await cardPage.locator(".leaflet-control-zoom-out").click();
      await expect
        .poll(() => new URL(cardPage.url()).searchParams.get("bounds"))
        .not.toBe(beforePaintBounds);
      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      const beforePan = new URL(cardPage.url()).searchParams.get("bounds");
      const mapRect = (await cardPage.locator("#map").boundingBox())!;
      await cardPage.mouse.move(
        mapRect.x + mapRect.width * 0.8,
        mapRect.y + mapRect.height * 0.75,
      );
      await cardPage.mouse.down();
      await cardPage.mouse.move(
        mapRect.x + mapRect.width * 0.8 + 80,
        mapRect.y + mapRect.height * 0.75,
        { steps: 8 },
      );
      await cardPage.mouse.up();
      await expect
        .poll(() => new URL(cardPage.url()).searchParams.get("bounds"))
        .not.toBe(beforePan);
      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      await cardPage.reload();
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(2);
      await expect(cardPage.locator("#list-area")).toBeHidden();
      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      await cardPage.screenshot({ path: `test-results/${name}-brush.png` });
      await cardPage.mouse.click(
        mapRect.x + mapRect.width * 0.8,
        mapRect.y + mapRect.height * 0.6,
        { button: "right" },
      );
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(0);
      await expect(cardPage.locator("#list-area")).toBeVisible();
      await expect
        .poll(() => new URL(cardPage.url()).searchParams.has("listBounds"))
        .toBe(true);
      // The preceding inertia test may pan both stations outside the viewport.
      await cardPage.goto(`${base}?bounds=52.02,4.99,52.16,5.25`);
      await expect
        .poll(() => new URL(cardPage.url()).searchParams.has("zoom"))
        .toBe(true);
      const leftStation = await stationPoint(5.12),
        rightStation = await stationPoint(5.15);
      const center = {
        x: (leftStation.x + rightStation.x) / 2,
        y: leftStation.y,
      };
      await cardPage.mouse.move(center.x + 180, center.y);
      await cardPage.mouse.down({ button: "right" });
      const arc = async (from: number, to: number) => {
        for (let i = from; i <= to; i++)
          await cardPage.mouse.move(
            center.x + 180 * Math.cos((i / 100) * Math.PI * 2),
            center.y + 140 * Math.sin((i / 100) * Math.PI * 2),
          );
      };
      await arc(1, 75);
      await expect(cardPage.locator("#count")).toHaveText("0 stations");
      await arc(76, 100);
      await cardPage.mouse.up({ button: "right" });

      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      await expect(
        cardPage.locator(".leaflet-brush-pane .brush-fill"),
      ).toHaveCount(1);
      await cardPage.screenshot({
        path: `test-results/${name}-brush-loop.png`,
      });
      await cardPage.reload();
      await expect(
        cardPage.locator(".leaflet-brush-pane .brush-fill"),
      ).toHaveCount(1);
      await expect(cardPage.locator("#count")).toHaveText("2 stations");
      await cardPage.mouse.click(
        mapRect.x + mapRect.width * 0.8,
        mapRect.y + mapRect.height * 0.6,
        { button: "right" },
      );
      await expect(cardPage.locator(".leaflet-brush-pane path")).toHaveCount(0);
      let searchNavigations = 0;
      cardPage.on("request", (request) => {
        if (request.isNavigationRequest()) searchNavigations++;
      });
      await cardPage.locator("#search").fill("Teststad");
      await expect(cardPage.locator("#search-results button")).toHaveCount(2);
      await expect(cardPage.locator("#search")).toHaveAttribute("aria-expanded", "true");
      await cardPage.locator("#search").press("Escape");
      await expect(cardPage.locator("#search-results button")).toHaveCount(0);
      await cardPage.locator("#search").fill("");
      await cardPage.locator("#search").fill("Teststad");
      await expect(cardPage.locator("#search-results button")).toHaveCount(2);
      const beforeSearch = new URL(cardPage.url()).searchParams.get("bounds");
      await cardPage.locator("#search").press("ArrowDown");
      await cardPage.locator("#search").press("ArrowDown");
      await expect(cardPage.locator("#search")).toHaveAttribute("aria-activedescendant", "search-option-1");
      await cardPage.locator("#search").press("Enter");
      await expect
        .poll(() => new URL(cardPage.url()).searchParams.get("bounds"))
        .not.toBe(beforeSearch);
      await expect(cardPage.locator("#search")).toHaveValue("Teststad oost");
      await expect(cardPage.locator("#search-status")).toBeEmpty();
      await expect(cardPage.locator("#stations")).toContainText("Tango Oost");
      expect(searchNavigations).toBe(0);
      await desktop.close();
      const plain = await browser.newContext({ javaScriptEnabled: false });
      const html = await plain.newPage();
      await html.goto(base);
      await expect(html.locator(".station")).toHaveCount(2);
      await html.locator(".station").first().click();
      await expect(html.locator("h2").first()).toHaveText("Prijsgeschiedenis");
      await expect(html.locator("tbody tr")).toHaveCount(1);
      await html.goto(base);
      await html.locator("#search").fill("Teststad");
      await html.locator("#search").press("Enter");
      await expect(html.locator("#search-results a")).toHaveCount(2);
      expect(new URL(html.url()).pathname).toBe("/");
      await plain.close();
      console.log(
        `${name}: automatic pan/zoom over one WebSocket, retained canvas, sidebar hover/cards, swipe drawer, cheapest-tier colours, SSR and offline PWA passed`,
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  lines.close();
  fixture.stdin.end("stop\n");
  if (fixture.exitCode === null)
    await new Promise<void>((resolve) => fixture.once("exit", () => resolve()));
}
