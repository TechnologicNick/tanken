import {
  database,
  ensurePartition,
  migrate,
  pgBounds,
  type Database,
} from "./db.ts";
import {
  hourOf,
  initialBounds,
  splitBounds,
  type Bounds,
  type Station,
} from "./domain.ts";
import { stationRequest, UpstreamError } from "./anwb.ts";
import { ingest, type SeenStation } from "./ingest.ts";
export type RequestStations = (bounds: Bounds) => Promise<Station[]>;
export async function getPlan(db: Database) {
  let [plan] = await db`SELECT id FROM query_plans WHERE active`;
  if (!plan) {
    plan = await db.begin(async (tx) => {
      const [created] =
        await tx`INSERT INTO query_plans(active,verified_at) VALUES(true,now()) RETURNING id`;
      for (const b of initialBounds)
        await tx`INSERT INTO query_shards(plan_id,bounds) VALUES(${created.id},${pgBounds(b)})`;
      return created;
    });
  }
  return Number(plan.id);
}
export async function collect(
  db: Database,
  options: { hour?: number; request?: RequestStations; delay?: number } = {},
) {
  const session = await db.reserve();
  const [lock] = await session`SELECT pg_try_advisory_lock(74326202) AS locked`;
  if (!lock.locked) {
    session.release();
    return { skipped: true };
  }
  const hour = options.hour ?? hourOf(),
    request = options.request ?? stationRequest;
  const observations: SeenStation[] = [],
    covered: Bounds[] = [];
  let fatal = false,
    failed = false;
  try {
    const [previous] =
      await db`SELECT status FROM collection_runs WHERE hour_id=${hour}`;
    if (previous?.status === 1) return { skipped: true };
    const planId = await getPlan(db);
    await ensurePartition(db, hour);
    await db`INSERT INTO collection_runs(hour_id,plan_id) VALUES(${hour},${planId}) ON CONFLICT(hour_id) DO UPDATE SET status=0,finished_at=NULL`;
    const shards =
      await db`SELECT id,bounds FROM query_shards WHERE plan_id=${planId} AND enabled ORDER BY id`;
    async function visit(id: number, bounds: Bounds, depth = 0): Promise<void> {
      // Completed shards are re-read on a partial-hour restart so disappearance reconciliation
      // sees the entire successful snapshot; history's hourly primary key remains idempotent.
      for (let retry = 0; retry < 3; retry++) {
        const [counter] =
          await db`SELECT COALESCE(max(attempt),0)::integer AS n FROM collection_shards WHERE hour_id=${hour} AND shard_id=${id}`;
        const attempt = counter.n + 1,
          start = new Date();
        try {
          const items = await request(bounds);
          const [batch] =
            await db`INSERT INTO collection_shards(hour_id,shard_id,attempt,started_at,fetched_at,status,station_count) VALUES(${hour},${id},${attempt},${start},now(),1,${items.length}) RETURNING id`;
          for (const station of items)
            observations.push({ station, batchId: Number(batch.id) });
          covered.push(bounds);
          await Bun.sleep(options.delay ?? 1000);
          return;
        } catch (error) {
          const e = error instanceof Error ? error : new Error(String(error));
          await db`INSERT INTO collection_shards(hour_id,shard_id,attempt,started_at,fetched_at,status,error) VALUES(${hour},${id},${attempt},${start},now(),2,${e.message.slice(0, 500)})`;
          if (e instanceof UpstreamError && e.code === "limit_exceeded") {
            const children = splitBounds(bounds, depth);
            // Leave the parent enabled until both children are durable. Retrying a crashed
            // split is harmless; only replace the parent's coverage as one transaction.
            const childRows = await db.begin(async (tx) => {
              const rows = [];
              for (const b of children)
                rows.push(
                  ...(await tx`INSERT INTO query_shards(plan_id,bounds) VALUES(${planId},${pgBounds(b)}) RETURNING id,bounds`),
                );
              await tx`UPDATE query_shards SET enabled=false WHERE id=${id}`;
              return rows;
            });
            for (const child of childRows)
              await visit(Number(child.id), child.bounds as Bounds, depth + 1);
            return;
          }
          if (e instanceof UpstreamError && [401, 403].includes(e.status)) {
            fatal = true;
            failed = true;
            return;
          }
          if (
            retry === 2 ||
            (e instanceof UpstreamError && e.retryAfter > 60_000)
          ) {
            failed = true;
            return;
          }
          await Bun.sleep(
            Math.max(
              options.delay ?? 1000,
              e instanceof UpstreamError ? e.retryAfter : 0,
              2 ** retry * (options.delay ?? 1000),
            ),
          );
        }
      }
    }
    for (const shard of shards) {
      if (fatal) break;
      await visit(Number(shard.id), shard.bounds as Bounds);
    }
    const result = await ingest(db, hour, observations, covered);
    await db`UPDATE collection_runs SET finished_at=now(),status=${failed ? 2 : 1},stations=${result.stations},changes=${result.changes} WHERE hour_id=${hour}`;
    console.log(
      JSON.stringify({
        event: "collection",
        hour,
        ...result,
        status: failed ? "partial" : "complete",
      }),
    );
    return { ...result, partial: failed };
  } catch (error) {
    await db`UPDATE collection_runs SET finished_at=now(),status=3 WHERE hour_id=${hour}`;
    throw error;
  } finally {
    await session`SELECT pg_advisory_unlock(74326202)`;
    session.release();
  }
}
if (import.meta.main) {
  const db = database();
  await migrate(db);
  const run = async () => {
    try {
      await collect(db);
    } catch (e) {
      console.error(
        JSON.stringify({
          event: "collection_error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
    }
  };
  if (process.argv.includes("--once")) {
    try {
      const r = await collect(db);
      if ("partial" in r && r.partial) process.exitCode = 1;
    } finally {
      await db.close();
    }
  } else {
    Bun.cron("0 * * * *", run, { tz: "UTC" });
    await run();
    const stop = async () => {
      await db.close();
      process.exit(0);
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
}
