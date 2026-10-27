/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;
declare const BUILD_VERSION: string;
declare const PRECACHE: string[];
declare const DRAWER_ASSET: string;
const VERSION = BUILD_VERSION,
  ASSETS = `tanken-assets-${VERSION}`,
  PAGES = `tanken-pages-${VERSION}`;
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(ASSETS).then((c) => c.addAll(PRECACHE))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("tanken-") && ![ASSETS, PAGES].includes(key))
          await caches.delete(key);
      await self.clients.claim();
      // The first document was fetched before the worker existed. Save it too,
      // so a first-time installation can reopen that page offline.
      await Promise.allSettled(
        (await self.clients.matchAll({ type: "window" })).map(
          async (client) => {
            const url = new URL(client.url);
            if (url.origin !== self.location.origin || !cacheable(url)) return;
            const request = new Request(url);
            const response = await fetch(request);
            if (response.ok) await remember(request, response);
          },
        ),
      );
    })(),
  ),
);
const cacheable = (url: URL) =>
  url.pathname === "/" ||
  /^\/stations\/\d+$/.test(url.pathname) ||
  url.pathname === "/api/stations" ||
  /^\/api\/stations\/\d+(\/history)?$/.test(url.pathname);
async function remember(request: Request, response: Response) {
  try {
    const cache = await caches.open(PAGES);
    await cache.delete(request);
    await cache.put(request, response);
    const keys = [...(await cache.keys())];
    while (keys.length > 50) await cache.delete(keys.shift()!);
  } catch {
    /* Storage eviction/quota must not break online navigation. */
  }
}
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data?.type === "drawer") {
    event.waitUntil(caches.open(ASSETS).then(async cache => {
      if (!await cache.match(DRAWER_ASSET)) await cache.add(DRAWER_ASSET);
    }).catch(() => {}));
    return;
  }
  if (
    data?.type !== "viewport" ||
    typeof data.query !== "string" ||
    data.query.length > 128 * 1024
  )
    return;
  event.waitUntil(
    remember(
      new Request(`${self.location.origin}/api/stations?${data.query}`),
      new Response(JSON.stringify(data.value), {
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/healthz"
  )
    return;
  if (PRECACHE.includes(url.pathname) || url.pathname === DRAWER_ASSET) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS),
          stored = await cache.match(req);
        if (stored) return stored;
        const response = await fetch(req);
        if (response.ok) await cache.put(req, response.clone());
        return response;
      })(),
    );
    return;
  }
  if (!cacheable(url)) return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(req);
        if (response.ok) event.waitUntil(remember(req, response.clone()));
        if (response.status < 500) return response;
        throw new Error("Server unavailable");
      } catch {
        const cached = await (await caches.open(PAGES)).match(req);
        if (cached) return cached;
        if (req.mode === "navigate" && url.pathname === "/") {
          // The client restores this URL's viewport from its cached API response.
          const cache = await caches.open(PAGES);
          const pages = await cache.keys();
          const home = [...pages]
            .reverse()
            .find((key) => new URL(key.url).pathname === "/");
          if (home) return (await cache.match(home))!;
        }
        if (req.mode === "navigate")
          return (await (await caches.open(ASSETS)).match("/offline.html"))!;
        return new Response(
          JSON.stringify({
            error: "Offline · dit gebied is nog niet opgeslagen.",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }
    })(),
  );
});
export {};
