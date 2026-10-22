import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex").slice(0, 12);
await mkdir("dist/assets", { recursive: true });
await mkdir("dist/icons", { recursive: true });
const built = await Bun.build({
  entrypoints: [
    "src/client/common.ts",
    "src/client/map.ts",
    "src/client/drawer.ts",
    "src/client/style.css",
  ],
  outdir: "dist/assets",
  target: "browser",
  format: "esm",
  minify: true,
  naming: "[name]-[hash].[ext]",
});
if (!built.success) throw new AggregateError(built.logs, "Client build failed");
const assets: Record<string, string> = {};
for (const output of built.outputs) {
  const name = output.path.split(/[\\/]/).pop()!;
  const key = name.split("-")[0];
  if (key === "drawer") {
    // Keep the upstream MIT notice with distributed copies of the port.
    const body = `${await output.text()}\n/*\n${await Bun.file("src/client/drawer/LICENSE.base-ui").text()}\n*/\n`;
    const licensedName = `drawer-${hash(body)}.js`;
    await Bun.write(`dist/assets/${licensedName}`, body);
    assets[key] = `/assets/${licensedName}`;
  } else assets[key] = `/assets/${name}`;
}
for (const [key, source, ext] of [
  ["leaflet", "node_modules/leaflet/dist/leaflet.js", "js"],
  ["leafletCss", "node_modules/leaflet/dist/leaflet.css", "css"],
  ["pin", "node_modules/leaflet/dist/images/marker-icon.png", "png"],
  ["pinRetina", "node_modules/leaflet/dist/images/marker-icon-2x.png", "png"],
]) {
  const body = await readFile(source);
  const name = `${key}-${hash(body)}.${ext}`;
  await Bun.write(`dist/assets/${name}`, body);
  assets[key] = `/assets/${name}`;
}
const svg = await Bun.file("public/icon.svg").text();
for (const name of ["icon-192", "icon-512", "apple-touch-icon"])
  await Bun.write(
    `dist/icons/${name}.png`,
    Bun.file(`public/icons/${name}.png`),
  );
await Bun.write("dist/icon.svg", svg);
await Bun.write("dist/assets.json", JSON.stringify(assets));
await Bun.write(
  "dist/manifest.webmanifest",
  JSON.stringify({
    id: "/",
    name: "Tanken · brandstofprijzen",
    short_name: "Tanken",
    lang: "nl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8f9f5",
    theme_color: "#123e34",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  }),
);
await Bun.write(
  "dist/offline.html",
  `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline · Tanken</title><link rel="stylesheet" href="${assets.style}"><main class="detail-page"><h1>Je bent offline</h1><p>Deze pagina is nog niet opgeslagen. Eerder bekeken stations en gebieden zijn via je browsergeschiedenis beschikbaar. Hun waarnemingstijd geeft aan hoe oud de prijzen zijn.</p><a href="/">Terug naar Tanken</a></main></html>`,
);
const precache = [
  ...Object.entries(assets)
    .filter(([name]) => name !== "drawer")
    .map(([, path]) => path),
  "/offline.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const version = hash(
  JSON.stringify(assets) +
    (await Bun.file("src/client/sw.ts").text()) +
    (await Bun.file("dist/offline.html").text()),
);
const sw = await Bun.build({
  entrypoints: ["src/client/sw.ts"],
  target: "browser",
  minify: true,
  define: {
    BUILD_VERSION: JSON.stringify(version),
    PRECACHE: JSON.stringify(precache),
    DRAWER_ASSET: JSON.stringify(assets.drawer),
  },
});
if (!sw.success)
  throw new AggregateError(sw.logs, "Service worker build failed");
await Bun.write("dist/sw.js", await sw.outputs[0].arrayBuffer());
let jsBytes = 0,
  cssBytes = 0;
const drawerBytes = gzipSync(await readFile(`dist${assets.drawer}`)).length;
if (drawerBytes > 16 * 1024)
  throw new Error(`Drawer budget exceeded: ${drawerBytes}`);
for (const path of Object.values(assets)) {
  if (path === assets.drawer) continue;
  const bytes = gzipSync(await readFile(`dist${path}`)).length;
  if (path.endsWith(".js")) jsBytes += bytes;
  else if (path.endsWith(".css")) cssBytes += bytes;
}
jsBytes += gzipSync(await readFile("dist/sw.js")).length;
if (jsBytes > 60 * 1024 || cssBytes > 6.5 * 1024)
  throw new Error(`Asset budget exceeded: JS ${jsBytes}, CSS ${cssBytes}`);
console.log(
  JSON.stringify({
    gzipJavaScriptBytes: jsBytes,
    gzipCssBytes: cssBytes,
    gzipLazyDrawerBytes: drawerBytes,
    assets,
  }),
);
