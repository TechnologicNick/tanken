# Tanken

A Dutch map of ANWB fuel prices, built with Bun, TypeScript and PostgreSQL. The server collects the entire available international catalogue hourly; browsers query PostgreSQL rather than ANWB. Lists, station details and price-history charts are rendered on the server. Leaflet adds the interactive map.

## Run with Compose

```powershell
Copy-Item .env.example .env
# Fill in POSTGRES_PASSWORD, DATABASE_URL and the ANWB settings.
docker compose up -d --build
```

Use a long URL-safe database password, or percent-encode it in DATABASE_URL. The Compose database URL uses POSTGRES_PASSWORD; the DATABASE_URL in `.env` is for running Bun directly against the development database port. Existing local ANWB settings are in the ignored `.anwb-local.json`; copy its clientId and apiKey into ANWB_CLIENT_ID and ANWB_API_KEY for Docker. The image excludes both local configuration files.

The application migrates the database, starts a web process and a separate hourly collector, and immediately collects if the current UTC hour has not completed. PostgreSQL data persists in the `postgres-data` volume.

Tanken stays on Docker's default **bridge** network for nginx-proxy. PostgreSQL connections use a shared `postgres-socket` volume mounted read-only in Tanken, so database access does not depend on legacy links or container DNS. `DATABASE_SOCKET` supplies the full Unix socket filename; `DATABASE_URL` still supplies the database and credentials. For Bun running directly on the host, leave `DATABASE_SOCKET` unset to use TCP through the development database port. Tanken listens on `0.0.0.0:$PORT`; PORT defaults to 3000. VIRTUAL_HOST and VIRTUAL_PORT are passed to the application container for an existing nginx-proxy installation. VIRTUAL_PORT defaults to PORT and must identify the application's internal listening port. These variables do not configure DNS or start a reverse proxy. Put the proxy on the same default bridge network, with HTTPS for installed PWAs and location access. Forward WebSocket upgrades at `/ws/stations`, preserving the public Host header. The app sends automatic keepalive pings before 30 seconds of inactivity.

For direct host/network access and development PostgreSQL access:

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up -d --build
```

Open http://localhost:3000, or the PORT configured in `.env`. This override publishes the app on `0.0.0.0` for access from other devices; PostgreSQL is available only at `127.0.0.1:54329`. The base Compose file publishes no host ports. Changing PORT also changes the development port mapping and the default VIRTUAL_PORT. A custom PORT of 3100 has been verified.

## Develop with Bun

Requires Bun 1.3.14 or newer; the image pins Bun 1.4.3 and PostgreSQL 18.

```powershell
bun install --frozen-lockfile
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
bun run build
bun run migrate
bun run collect
bun start
```

Set DATABASE_URL in `.env` to the local PostgreSQL port with the same password. Bun reads `.env` automatically. The server can use either the ANWB environment variables or `.anwb-local.json`. `bun run dev` starts only the web server; `bun run collector` starts only the hourly process. Build again after changing browser code. Stop the Compose application before running a local server on the same port.

## Data collection and storage

Live verification on 21 October 2026 found **133,154 distinct stations in 50 countries/territories**, with **292,787 station/fuel series**. All currently returned price currencies were EUR; currency changes are handled explicitly. Foreign IDs are retained as opaque strings.

The list endpoint has a 10,000-result limit, rather than a simple geographic-area limit. One request covers the Netherlands. Covering the complete catalogue requires at least `ceil(133154 / 10000) = 14` requests. The shipped 14 longitude strips cover the world and returned the same complete ID set as an exhaustive scan. Each initially returned 9,511 stations. See [query discovery](docs/query-discovery.md) for the verification and future maintenance.

The collector runs at minute zero every UTC hour using Bun.cron, with a PostgreSQL advisory lock preventing overlap. It retries transient failures and subdivides an overfull shard automatically, preserving coverage. A successful hour is idempotent. A partial hour can be retried with `bun run collect`; successful areas are reread to reconcile the complete snapshot. Failed areas keep their previous observations. Missing stations get a presence transition, not a permanent closure flag.

Only price, currency and availability changes create archive events. Zero means an unknown price; a formerly reported fuel disappearing from a response is recorded separately. Station metadata and current prices are stored independently. Exact retrieval times belong to shared collection batches, rather than every historical price. ANWB supplies no actual price-change timestamp: history shows hourly observations. Charts leave gaps during incomplete or missing collections and station absence. Past periods remain accessible through the older-period links.

See [database design](docs/database.md) and [the migration](migrations/001_initial.sql). The initial real snapshot used about **21.6 MB for 292,787 price-history rows including the primary-key index**, approximately 74 bytes per event. The whole initial database used about 168 MiB. Future growth depends on actual changes: one change per series per day would add roughly 7.9 GB per year of price history at that measured density. These figures exclude WAL, backups and future bloat. `bun run stats` reports current row counts, archive sizes, recent collection results and update statistics; measure the actual change rate over time.

## PWA and client size

On desktop, an unfilled rectangle inset 25% from every map edge selects the sidebar stations; map pins still cover the whole viewport. Hold the right mouse button and drag to paint with a 124.8 px wide brush instead; closed loops fill their interior, including when the painted ends overlap or the stroke continues afterwards; strokes and filled loops share one opacity, so overlaps keep the same shade; strokes combine and remain attached to their geographic area through pan and zoom. The sidebar includes all painted stations, including outside the current viewport. A right-click without dragging clears the paint and restores the rectangle. The selection survives reloads in the same tab. Mobile station lists open in a swipe-to-dismiss drawer that initially shows 45.5% of the viewport height (30% smaller than the original 65%), with an additional full-viewport snap point over the map, with a compact search field, inline clear button and country selector floating outside at the top. Mobile maps use touch zoom gestures instead of zoom buttons. Horizontally scrollable fuel radio pills sit inside the stations drawer. Station details nest over the list and restore its scroll position when closed. Sorting sits beside the station count; fuel and sort changes apply immediately. Mobile lists use the full viewport. The map refreshes 150 ms after panning stops and immediately after zooming, using one persistent WebSocket. A single Leaflet canvas retains the station pins and compact labels. During zooming it keeps the existing canvas transformed until the matching response is ready, then commits the new groups once. Pending views are coalesced and stale replies ignored; the connection retries after interruption. Clicking a sidebar station or an individual map pin opens server-rendered information, a weekly opening-hours graphic and price history in a card next to the sidebar, or a swipe-to-dismiss drawer on mobile. Closing the mobile drawer restores the station list when opened from the list, or the map when opened from a pin. The drawer uses a local vanilla TypeScript port of Base UI's swipe engine, scroll arbitration and snap-point logic, with nested modal focus and dismissal. Hovering or focusing a sidebar station highlights its exact location, including when it belongs to a group. Station links retain ordinary navigation without JavaScript and on modified clicks. The map is enhanced with JavaScript; search forms, filters, station pages and SVG history work without it. The build enforces compressed initial budgets of 60 KiB JavaScript and 6.5 KiB CSS, including Leaflet and the service worker. The current initial build is about **54.1 KiB JavaScript and 6.3 KiB CSS**. Mobile station drawers use the [local Base UI port](src/client/drawer/UPSTREAM.md), loaded only on first use (about 15.0 KiB gzip, with a separate 16 KiB budget) and cached for subsequent offline use. It requires no React and supports nested drawers; run `bun run test:drawer` for its isolated browser suite. Detail pages load only the small shared PWA script. Fonts use the system font stack; there is no framework or client hydration.

On HTTPS, Safari's Share → Add to Home Screen installs the PWA. It caches the application assets and up to 50 recently viewed pages/API responses. Previously viewed station history is readable offline, with its retrieval time and an offline indicator. Unvisited pages show an offline explanation. Map tiles require a connection and are not downloaded for offline use. Offline data is a browser cache, not a promise of current pump prices.

The browser code uses iOS 17-compatible features. Double-tap and hold the second tap, then drag vertically for continuous one-finger zoom around the tapped point. On iOS, drag up to zoom in and down to zoom out; on other devices, drag down to zoom in and up to zoom out. Ordinary panning, double-tap zoom and pinch zoom remain available. `bun run test:touch` checks these gestures with native touch input in Chromium and dispatched touch events in WebKit. Automated checks also cover service-worker caching and JavaScript-disabled SSR. A physical iPhone running iOS 17 has not been tested.

Search shows locations inline and moves the existing map when a result is selected. Without JavaScript, results stay in the home sidebar. Dutch place/address/postcode search uses the existing PDOK API with up to five suggestions after a 300 ms typing pause (at least two characters). Arrow keys and Enter select suggestions; Escape or clicking outside dismisses them. Requests are cancelled when the query changes and recent results are cached in memory. European search remains submit-only because the public Nominatim service prohibits autocomplete. European search uses GEOCODER_URL (default: Nominatim) and requires GEOCODER_USER_AGENT to identify the deployment with contact details. Results are cached for seven days; public-geocoder requests are serialized across server processes. Without that setting, map browsing and location access still work abroad.

## Verification and operations

```powershell
bun run typecheck
bun test test/domain.test.ts
# DATABASE_URL or TEST_DATABASE_URL must allow creating disposable test databases:
bun test test/integration.test.ts
bun run test:locking
bunx playwright install chromium webkit
bun run test:browser
bun run stats
```

`bun test`/`bun run test` run unit and PostgreSQL integration tests; database tests skip if no database URL exists. The locking regression takes about 35 seconds. Browser checks use an isolated fixture database and require Node 22.18+ or 24+ to drive Playwright; the app itself uses Bun only. They check automatic pan/zoom updates on a single WebSocket, retained canvas rendering, coverage above 500 stations, delayed zoom replies without intermediate repaints, reconnects, and offline restoration. They need no live ANWB requests. Screenshots are in `test-results/`.

`GET /healthz` checks PostgreSQL and reports the latest collection status. Docker checks the actual PORT. Collection results/errors are JSON logs (`docker compose logs tanken`). `bun run rebalance` recalculates the minimum longitude-strip plan from the latest complete catalogue and verifies every ID against fresh API responses before activating it atomically. It retains the existing plan if verification fails. Automatic splitting prioritizes complete coverage; run rebalance after material catalogue growth to recover the minimum query count.

Back up PostgreSQL using your usual pg_dump/pg_restore workflow. History partitions are created ahead of time and retained indefinitely; no raw upstream snapshots are stored. `docker compose down` preserves the database volume.

## API and provenance

The map uses `/ws/stations` with JSON requests `{ "id": 1, "query": "bounds=52,5,52.2,5.3&fuel=EURO95&sort=price" }`. Responses echo the monotonically increasing request ID and contain a `stations` payload or an `error`. Each socket runs at most one database query at a time, keeping only the latest queued view. HTTP endpoints remain available for SSR and cached offline data.

Local endpoints are `/api/stations?bounds=south,west,north,east&fuel=EURO95`, `/api/stations/:id`, and `/api/stations/:id/history?fuel=EURO95&days=30`. IDs in these routes are internal numeric station IDs. Lists paginate at 50 stations. Maps represent every matching station using individual pins or counted groups on a single Leaflet canvas, with at most 4,000 drawn features. Group cells are anchored to world coordinates, independent of price sorting, and widen from 96 pixels at zoom 13 to 128 at zooms 11–12 and 160 at zooms 3–10. At zoom 14 and above, up to 4,000 stations are shown individually; overlapping price labels are hidden while their pins remain visible. Groups display their cheapest price and a station count (for example, `€ 1,839 ×12`); different currencies form separate groups. Group labels stay centered on their geographic anchors and inherit the price tier colour of their cheapest station. Click a group to zoom in or a pin to open its prices. The client requests a 35% buffer around the visible area and reuses its WebSocket during gestures. Requests accept `zoom` (3–18) and optional `mapBounds` containing `bounds`; list totals refer to `bounds`, while `mapStationCount` includes the buffer. History supports 1, 7, 30 and 365-day windows, 100 changes per table page, and older windows. Different currencies are never ranked as equivalent amounts.

[Reverse-engineering notes](docs/reverse-engineering.md) document the original app investigation. This is an independent implementation, not an ANWB product. The upstream endpoint is undocumented and responses include restrictions on reuse; public/commercial distribution requires appropriate data permissions. Credentials stay on the backend. The displayed station price is an observation; the price at the pump is authoritative.

Map tiles come from OpenStreetMap with attribution and normal browser caching. Choose a suitable tile provider for larger deployments. No Mapbox tokens, ANWB imagery, account login or analytics are included.

History charts fit the available observations within the selected period, with step lines, date labels and visible points for isolated observations. Only confirmed hourly coverage is connected; successful local shards count even when another shard fails. Missing observations, unknown prices, station absence and currency changes break the line. Only changes are stored, as before. Prices display the last decimal as a smaller raised digit in HTML and canvas labels; Euro 95 is used consistently in the interface.
