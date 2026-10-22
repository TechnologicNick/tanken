import { isolatedDatabase } from "../test/database.ts";
import { rawStation } from "../test/fixtures.ts";
import { normalizeStation, hourOf, contains } from "../src/domain.ts";
import { collect } from "../src/collector.ts";
import { createServerOptions } from "../src/server.ts";

// A disposable database keeps browser tests independent of live ANWB data.
const { db, close } = await isolatedDatabase();
try {
  const fixtures = [
    ...Array.from({ length: 600 }, (_, i) => ({
      ...rawStation(
        `dense_${i}`,
        6 + (i % 30) * 0.0005,
        i === 0 ? 1.599 : 1.839,
      ),
      coordinates: {
        latitude: 48 + Math.floor(i / 30) * 0.0005,
        longitude: 6 + (i % 30) * 0.0005,
      },
    })),
    rawStation("browser_nl", 5.12),
    rawStation("browser_be", 5.15),
    { ...rawStation("browser_east", 5.5), title: "Tango Oost" },
  ];
  fixtures[0].prices[0].priceTier.value = 3;
  await collect(db, {
    hour: hourOf() - 1,
    delay: 0,
    request: async (bounds) =>
      fixtures.map(normalizeStation).filter((s) => contains(bounds, s)),
  });
  await db`UPDATE stations SET details_checked_at=now(),facilities='[{"name":"Shop"}]'::jsonb`;
  const [station] =
    await db`SELECT id FROM stations WHERE source_id='browser_nl'`;
  await db`INSERT INTO geocode_cache(key,results,expires_at) VALUES ('nl:teststad','[{"label":"Teststad centrum","lat":52.08,"lng":5.12},{"label":"Teststad oost","lat":52.08,"lng":5.5}]'::jsonb,now()+interval '1 day')`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    ...(await createServerOptions(db)),
  });
  console.log(
    JSON.stringify({ ready: server.url.toString(), station: station.id }),
  );
  await new Promise<void>((resolve) =>
    process.stdin.once("data", () => resolve()),
  );
  await server.stop(true);
} finally {
  await close();
}
