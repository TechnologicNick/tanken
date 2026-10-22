import { database, migrate, pgBounds } from "../src/db.ts";
import { balancedBounds } from "../src/domain.ts";
import { stationRequest } from "../src/anwb.ts";
// Offline calculation uses the catalogue; activating a plan requires a fresh ID comparison.
const db = database();
await migrate(db);
const session = await db.reserve();
try {
  const [lock] = await session`SELECT pg_try_advisory_lock(74326202) AS locked`;
  if (!lock.locked)
    throw new Error("Collector is active; retry after it finishes.");
  const [last] =
    await db`SELECT status FROM collection_runs ORDER BY hour_id DESC LIMIT 1`;
  if (last?.status !== 1)
    throw new Error("A complete collection is required before rebalancing.");
  const catalogue =
    await db`SELECT s.source_id AS id,s.longitude AS lng FROM stations s JOIN station_state ss ON ss.station_id=s.id WHERE ss.present`;
  const plan = balancedBounds(catalogue as { lng: number }[]);
  const ids = new Set<string>();
  for (const bounds of plan) {
    const items = await stationRequest(bounds);
    for (const s of items) ids.add(s.sourceId);
    await Bun.sleep(1000);
  }
  if (
    ids.size !== catalogue.length ||
    catalogue.some((s: any) => !ids.has(s.id))
  )
    throw new Error(
      "Catalogue changed during verification; collect again before rebalancing. Existing plan retained.",
    );
  await db.begin(async (tx) => {
    await tx`UPDATE query_plans SET active=false WHERE active`;
    const [p] =
      await tx`INSERT INTO query_plans(active,verified_at) VALUES(true,now()) RETURNING id`;
    for (const bounds of plan)
      await tx`INSERT INTO query_shards(plan_id,bounds) VALUES(${p.id},${pgBounds(bounds)})`;
  });
  console.log(
    JSON.stringify({
      stations: ids.size,
      queries: plan.length,
      verified: true,
      bounds: plan,
    }),
  );
} finally {
  await session`SELECT pg_advisory_unlock(74326202)`;
  session.release();
  await db.close();
}
