import { test, expect } from "bun:test";
import { isolatedDatabase } from "./database.ts";
import { collect } from "../src/collector.ts";
import { pgBounds } from "../src/db.ts";
import { normalizeStation } from "../src/domain.ts";
import { rawStation } from "./fixtures.ts";

test("collector lock survives more than 30 seconds without SQL traffic", async () => {
  const { db, close } = await isolatedDatabase();
  try {
    const [plan] =
      await db`INSERT INTO query_plans(active) VALUES(true) RETURNING id`;
    await db`INSERT INTO query_shards(plan_id,bounds) VALUES(${plan.id},${pgBounds([-90, -180, 90, 180])})`;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const first = collect(db, {
      delay: 0,
      request: async () => {
        started();
        await Bun.sleep(35000);
        return [normalizeStation(rawStation("lock-test", 5.12))];
      },
    });
    await entered;
    await Bun.sleep(32000);
    expect(await collect(db)).toEqual({ skipped: true });
    expect(await first).toMatchObject({ stations: 1, partial: false });
  } finally {
    await close();
  }
}, 60000);
