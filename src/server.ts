import { database, migrate, type Database } from "./db.ts";
import { viewport, stationDetails, history } from "./queries.ts";
import {
  home,
  layout,
  detail,
  stationPayload,
  stationCard,
  esc,
  type Assets,
} from "./views.ts";
import { geocode } from "./geocode.ts";
import { detailRequest } from "./anwb.ts";
import { liveHandler, type LiveSession } from "./live.ts";
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const securityFor = (req: Request) => ({
  ...security,
  "Content-Security-Policy": security["Content-Security-Policy"].replace(
    "connect-src 'self'",
    `connect-src 'self' ws://${new URL(req.url).host} wss://${new URL(req.url).host}`,
  ),
});
export async function createHandler(db: Database) {
  const assets: Assets = await Bun.file(
    new URL("../dist/assets.json", import.meta.url),
  ).json();
  const staticFiles = new Map<
    string,
    { body: Uint8Array; gz: Uint8Array; type: string; etag: string }
  >();
  const paths = [
    "/manifest.webmanifest",
    "/icon.svg",
    "/sw.js",
    "/offline.html",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/apple-touch-icon.png",
    ...Object.values(assets),
  ];
  for (const path of paths) {
    const file = Bun.file(new URL(`../dist${path}`, import.meta.url));
    const body = new Uint8Array(await file.arrayBuffer());
    staticFiles.set(path, {
      body,
      gz: Bun.gzipSync(body),
      type: file.type,
      etag: `"${Bun.hash(body).toString(16)}"`,
    });
  }
  const detailPending = new Map<number, Promise<unknown>>();
  const response = (
    req: Request,
    body: string,
    status = 200,
    type = "text/html; charset=utf-8",
    extra: Record<string, string> = {},
  ) => {
    const headers = new Headers({
      ...securityFor(req),
      "Content-Type": type,
      "Cache-Control": "private, no-cache",
      Vary: "Accept-Encoding",
      ...extra,
    });
    const bytes = new TextEncoder().encode(body);
    if (
      bytes.length > 1024 &&
      /\bgzip\b/.test(req.headers.get("accept-encoding") || "")
    ) {
      headers.set("Content-Encoding", "gzip");
      return new Response(req.method === "HEAD" ? null : Bun.gzipSync(bytes), {
        status,
        headers,
      });
    }
    return new Response(req.method === "HEAD" ? null : body, {
      status,
      headers,
    });
  };
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url),
      path = url.pathname;
    if (!["GET", "HEAD"].includes(req.method))
      return response(
        req,
        "Alleen GET en HEAD zijn toegestaan.",
        405,
        "text/plain; charset=utf-8",
        { Allow: "GET, HEAD" },
      );
    const file = staticFiles.get(path);
    if (file) {
      const headers = new Headers({
        ...securityFor(req),
        "Content-Type": file.type,
        ETag: file.etag,
        Vary: "Accept-Encoding",
        "Cache-Control": path.startsWith("/assets/")
          ? "public,max-age=31536000,immutable"
          : "no-cache",
      });
      if (path === "/sw.js") headers.set("Service-Worker-Allowed", "/");
      if (req.headers.get("if-none-match") === file.etag)
        return new Response(null, { status: 304, headers });
      const gzip =
        !path.endsWith(".png") &&
        /\bgzip\b/.test(req.headers.get("accept-encoding") || "");
      if (gzip) headers.set("Content-Encoding", "gzip");
      return new Response(
        req.method === "HEAD"
          ? null
          : new Uint8Array(gzip ? file.gz : file.body),
        { headers },
      );
    }
    try {
      if (path === "/healthz") {
        await db`SELECT 1`;
        const [last] =
          await db`SELECT hour_id,status,stations,changes FROM collection_runs ORDER BY hour_id DESC LIMIT 1`;
        return response(
          req,
          JSON.stringify({ ok: true, collection: last || null }),
          200,
          "application/json",
        );
      }
      if (path === "/") {
        const q = url.searchParams.get("q");
        const country = url.searchParams.get("country") || "nl";
        const search = q
          ? { q, country, results: await geocode(db, q, country) }
          : undefined;
        return response(
          req,
          home(await viewport(db, url.searchParams), assets, search),
        );
      }
      if (path === "/api/stations") {
        const v = await viewport(db, url.searchParams);
        return response(
          req,
          JSON.stringify(stationPayload(v)),
          200,
          "application/json",
        );
      }
      const match = /^\/(api\/)?stations\/(\d+)(\/history)?$/.exec(path);
      if (match) {
        const id = Number(match[2]);
        if (!Number.isSafeInteger(id) || id > 2147483647)
          return response(req, "Niet gevonden.", 404);
        const s = await stationDetails(db, id);
        if (!s) return response(req, "Niet gevonden.", 404);
        if (match[3])
          return response(
            req,
            JSON.stringify(await history(db, id, url.searchParams)),
            200,
            "application/json",
          );
        if (
          !match[1] &&
          (!s.details_checked_at ||
            Date.now() - new Date(s.details_checked_at).getTime() > 86400000)
        ) {
          if (!detailPending.has(id))
            detailPending.set(
              id,
              (async () => {
                try {
                  const facilities = await detailRequest(s.source_id);
                  await db`UPDATE stations SET facilities=${JSON.stringify(facilities)}::text::jsonb,details_checked_at=now() WHERE id=${id}`;
                  s.facilities = facilities;
                } catch {
                  await db`UPDATE stations SET details_checked_at=now()-interval '23 hours' WHERE id=${id}`;
                }
              })().finally(() => detailPending.delete(id)),
            );
          await detailPending.get(id);
        }
        if (match[1])
          return response(req, JSON.stringify(s), 200, "application/json");
        if (url.searchParams.get("card") === "1")
          return response(
            req,
            stationCard(
              s,
              url.searchParams.get("fuel") || "EURO95",
              await history(db, id, url.searchParams),
            ),
          );
        return response(
          req,
          detail(s, await history(db, id, url.searchParams), assets),
        );
      }
      if (path === "/search" || path === "/api/search") {
        const results = await geocode(
          db,
          url.searchParams.get("q") || "",
          url.searchParams.get("country") || "nl",
        );
        if (path.startsWith("/api/"))
          return response(
            req,
            JSON.stringify(results),
            200,
            "application/json",
          );
        return response(
          req,
          home(await viewport(db, url.searchParams), assets, {
            q: url.searchParams.get("q") || "",
            country: url.searchParams.get("country") || "nl",
            results,
          }),
        );
      }

      return response(req, "Niet gevonden.", 404, "text/plain; charset=utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const bad = /Ongeldige|Vul een/.test(message);
      if (!bad)
        console.error(
          JSON.stringify({ event: "request_error", path, message }),
        );
      const safe =
        bad || path === "/search" || path === "/api/search"
          ? message
          : "Tijdelijk niet beschikbaar. Probeer het later opnieuw.";
      if (path.startsWith("/api/"))
        return response(
          req,
          JSON.stringify({ error: safe }),
          bad ? 400 : 503,
          "application/json",
        );
      return response(
        req,
        layout(
          "Niet beschikbaar",
          `<main class="detail-page"><h1>${esc(safe)}</h1><a href="/">Terug naar de kaart</a></main>`,
          assets,
        ),
        bad ? 400 : 503,
      );
    }
  };
}
export async function createServerOptions(db: Database) {
  const handler = await createHandler(db);
  return {
    fetch(req: Request, server: Bun.Server<LiveSession>) {
      if (new URL(req.url).pathname !== "/ws/stations") return handler(req);
      // Browser WebSocket upgrades retain Host behind the HTTPS proxy.
      const origin = req.headers.get("origin");
      try {
        if (!origin || new URL(origin).host !== req.headers.get("host"))
          return new Response("Forbidden", { status: 403 });
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
      if (
        server.upgrade(req, {
          data: { running: false, closed: false, latestId: 0 },
        })
      )
        return;
      return new Response("WebSocket upgrade required", { status: 426 });
    },
    websocket: liveHandler(db),
  };
}
if (import.meta.main) {
  const db = database();
  await migrate(db);
  const server = Bun.serve({
    hostname: process.env.HOST || "0.0.0.0",
    port: Number(process.env.PORT || 3000),
    ...(await createServerOptions(db)),
  });
  console.log(`Tanken: ${server.url}`);
  const stop = async () => {
    await server.stop(true);
    await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
