import { project } from "../src/brush.ts";
import { test, expect } from "bun:test";
import { isolatedDatabase } from "./database.ts";
import { rawStation } from "./fixtures.ts";
import {
  normalizeStation,
  hourOf,
  contains,
  type Bounds,
} from "../src/domain.ts";
import { collect } from "../src/collector.ts";
import { UpstreamError } from "../src/anwb.ts";
import { viewport, history } from "../src/queries.ts";
import { createHandler } from "../src/server.ts";
import { pgBounds } from "../src/db.ts";
const integration =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL ? test : test.skip;
integration(
  "PostgreSQL ingestion, archive, failures and SSR/API isolation",
  async () => {
    const { db, close } = await isolatedDatabase();
    try {
      const [plan] =
        await db`INSERT INTO query_plans(active) VALUES(true) RETURNING id`;
      for (const bounds of [
        [-90, -180, 90, 0],
        [-90, 0, 90, 180],
      ])
        await db`INSERT INTO query_shards(plan_id,bounds) VALUES(${plan.id},${pgBounds(bounds)})`;
      const start = hourOf() - 12;
      let fixtures = [
        rawStation("appitup_test", 5.12),
        rawStation("xavvy_M|BEL|1", 4.4),
        rawStation("west", -1),
      ];
      const request = async (bounds: Bounds) =>
        fixtures.map(normalizeStation).filter((s) => contains(bounds, s));
      const first = await collect(db, { hour: start, request, delay: 0 });
      expect(first).toMatchObject({ stations: 3, changes: 6, partial: false });
      const [identity] = await db`SELECT last_value FROM station_fuels_id_seq`;
      expect(
        await collect(db, {
          hour: start,
          request: async () => {
            throw Error("must not request completed hour");
          },
          delay: 0,
        }),
      ).toMatchObject({ skipped: true });
      expect(
        await collect(db, { hour: start + 1, request, delay: 0 }),
      ).toMatchObject({ changes: 0 });
      expect(
        (await db`SELECT last_value FROM station_fuels_id_seq`)[0].last_value,
      ).toBe(identity.last_value);
      fixtures[0].prices[0].value = 1.899;
      expect(
        await collect(db, { hour: start + 2, request, delay: 0 }),
      ).toMatchObject({ changes: 1 });
      fixtures[0].prices[0].currency = "GBP";
      expect(
        await collect(db, { hour: start + 3, request, delay: 0 }),
      ).toMatchObject({ changes: 1 });
      fixtures[0].prices[0].value = 0;
      expect(
        await collect(db, { hour: start + 4, request, delay: 0 }),
      ).toMatchObject({ changes: 1 });
      fixtures[0].prices = fixtures[0].prices.filter(
        (p) => p.fuelType !== "DIESEL",
      );
      expect(
        await collect(db, { hour: start + 5, request, delay: 0 }),
      ).toMatchObject({ changes: 1 });
      expect(
        await collect(db, { hour: start + 6, request, delay: 0 }),
      ).toMatchObject({ changes: 0 });
      const countBefore = (
        await db`SELECT count(*)::integer AS n FROM price_changes`
      )[0].n;
      const failed = await collect(db, {
        hour: start + 7,
        delay: 0,
        request: async (bounds) => {
          if (bounds[1] === 0) throw new UpstreamError("timeout");
          return request(bounds);
        },
      });
      expect(failed).toMatchObject({ partial: true, changes: 0 });
      const [westStation] =
        await db`SELECT id FROM stations WHERE source_id='west'`;
      const [eastStation] =
        await db`SELECT id FROM stations WHERE source_id='appitup_test'`;
      const confirmedWest = await history(
        db,
        westStation.id,
        new URLSearchParams({ days: "1" }),
      );
      const uncertainEast = await history(
        db,
        eastStation.id,
        new URLSearchParams({ days: "1" }),
      );
      expect(confirmedWest.gaps).not.toContain(start + 7);
      expect(uncertainEast.gaps).toContain(start + 7);

      expect(
        (
          await db`SELECT present FROM station_state ss JOIN stations s ON s.id=ss.station_id WHERE s.source_id='appitup_test'`
        )[0].present,
      ).toBe(true);
      expect(
        (await db`SELECT count(*)::integer AS n FROM price_changes`)[0].n,
      ).toBe(countBefore);
      expect(
        await collect(db, { hour: start + 7, request, delay: 0 }),
      ).toMatchObject({ partial: false, changes: 0 });
      fixtures = fixtures.filter((s) => s.id !== "appitup_test");
      expect(
        await collect(db, { hour: start + 8, request, delay: 0 }),
      ).toMatchObject({ changes: 0 });
      expect(
        (
          await db`SELECT present FROM station_state ss JOIN stations s ON s.id=ss.station_id WHERE s.source_id='appitup_test'`
        )[0].present,
      ).toBe(false);
      fixtures.push(rawStation("appitup_test", 5.12, 1.899));
      fixtures.at(-1)!.prices[0].currency = "GBP";
      expect(
        await collect(db, { hour: start + 9, request, delay: 0 }),
      ).toMatchObject({ changes: 2 });
      const [station] =
        await db`SELECT id FROM stations WHERE source_id='appitup_test'`;
      const h = await history(
        db,
        station.id,
        new URLSearchParams({ fuel: "EURO95", days: "1" }),
      );
      expect(h.total).toBe(5);
      expect(h.points.some((p: any) => p.price_milli === null)).toBe(true);
      const v = await viewport(
        db,
        new URLSearchParams({ bounds: "52,4,52.2,5.3" }),
      );
      expect(v.total).toBe(2);
      const central = await viewport(
        db,
        new URLSearchParams({
          bounds: "52,4,52.2,5.3",
          listBounds: "52.05,5,52.15,5.2",
          zoom: "14",
        }),
      );
      expect(central.total).toBe(1);
      expect(central.mapStationCount).toBe(2);
      expect(central.markers).toHaveLength(2);
      await expect(
        viewport(
          db,
          new URLSearchParams({
            bounds: "52,4,52.2,5.3",
            listBounds: "51,4,52.2,5.3",
          }),
        ),
      ).rejects.toThrow("Ongeldig lijstgebied.");
      const brushStrokes = [5.12, 4.4].map((lng) => ({
        radius: 0.001,
        points: [project(52.079, lng), project(52.081, lng)],
      }));
      const painted = await viewport(
        db,
        new URLSearchParams({
          bounds: "52,5,52.2,5.3",
          brush: JSON.stringify(brushStrokes),
          zoom: "14",
        }),
      );
      expect(painted.total).toBe(2); // Includes a painted station outside this viewport.
      expect(painted.mapStationCount).toBe(1);
      expect(painted.markers).toHaveLength(1);
      const firstPaint = await viewport(
        db,
        new URLSearchParams({
          bounds: "52,4,52.2,5.3",
          brush: JSON.stringify([brushStrokes[0]]),
        }),
      );
      expect(firstPaint.total).toBe(1);
      expect(firstPaint.mapStationCount).toBe(2);
      await expect(
        viewport(db, new URLSearchParams({ brush: "invalid" })),
      ).rejects.toThrow("Ongeldig penseelgebied.");
      const buffered = await viewport(
        db,
        new URLSearchParams({
          bounds: "52,5,52.2,5.3",
          mapBounds: "52,4,52.2,5.3",
          zoom: "14",
        }),
      );
      expect(buffered.total).toBe(1);
      expect(buffered.mapStationCount).toBe(2);
      expect(buffered.markers).toHaveLength(2);
      await expect(
        viewport(
          db,
          new URLSearchParams({
            bounds: "52,4,52.2,5.3",
            mapBounds: "52,5,52.2,5.3",
          }),
        ),
      ).rejects.toThrow("Ongeldige kaartbuffer.");
      await expect(
        viewport(db, new URLSearchParams({ zoom: "NaN" })),
      ).rejects.toThrow("Ongeldige zoom.");
      const handler = await createHandler(db);
      const html = await handler(
        new Request("http://localhost/?bounds=52,4,52.2,5.3"),
      );
      expect(html.status).toBe(200);
      expect(await html.text()).toContain("CIRCLE K");
      expect(
        (await handler(new Request("http://localhost/.anwb-local.json")))
          .status,
      ).toBe(404);
      expect(
        (await handler(new Request("http://localhost/api/stations?bounds=bad")))
          .status,
      ).toBe(400);
      const compressed = await handler(
        new Request("http://localhost/", {
          headers: { "Accept-Encoding": "gzip" },
        }),
      );
      expect(compressed.headers.get("Content-Encoding")).toBe("gzip");
      expect(
        (await handler(new Request("http://localhost/", { method: "POST" })))
          .status,
      ).toBe(405);
    } finally {
      await close();
    }
  },
  60000,
);
integration(
  "body-level limits subdivide coverage without losing stations",
  async () => {
    const { db, close } = await isolatedDatabase();
    try {
      const [plan] =
        await db`INSERT INTO query_plans(active) VALUES(true) RETURNING id`;
      await db`INSERT INTO query_shards(plan_id,bounds) VALUES(${plan.id},${pgBounds([-90, -180, 90, 180])})`;
      const fixtures = [
        normalizeStation(rawStation("east", 5)),
        normalizeStation(rawStation("west", -5)),
      ];
      const r = await collect(db, {
        hour: hourOf(),
        delay: 0,
        request: async (bounds) => {
          if (bounds[3] - bounds[1] > 180)
            throw new UpstreamError("limit_exceeded");
          return fixtures.filter((s) => contains(bounds, s));
        },
      });
      expect(r).toMatchObject({ stations: 2, partial: false });
      expect(
        (
          await db`SELECT count(*)::integer AS n FROM query_shards WHERE enabled`
        )[0].n,
      ).toBe(2);
    } finally {
      await close();
    }
  },
  60000,
);
