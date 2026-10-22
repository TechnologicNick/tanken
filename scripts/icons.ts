import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const browser = await chromium.launch();
try {
  const svg = await readFile("public/icon.svg", "utf8");
  for (const [name, size] of [
    ["icon-192", 192],
    ["icon-512", 512],
    ["apple-touch-icon", 180],
  ] as const) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;background:#123e34}svg{width:100vw;height:100vh;display:block}</style>${svg}`,
    );
    await page.screenshot({ path: `public/icons/${name}.png` });
    await page.close();
  }
} finally {
  await browser.close();
}
