import { SQL } from "bun";
export function database(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is required. See README.md.");
  // The reserved collector connection owns a session advisory lock while HTTP
  // requests run. Never expire it while it is idle between SQL statements.
  return new SQL(url, { max: 5, idleTimeout: 0, connectionTimeout: 10 });
}
export type Database = ReturnType<typeof database>;
export const pgBounds = (bounds: number[]) => `{${bounds.join(",")}}`;
export async function migrate(db: Database) {
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(74326201)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const [existing] =
      await tx`SELECT version FROM schema_migrations WHERE version=1`;
    if (!existing) {
      await tx.unsafe(
        await Bun.file(
          new URL("../migrations/001_initial.sql", import.meta.url),
        ).text(),
      );
      await tx`INSERT INTO schema_migrations(version) VALUES (1)`;
    }
  });
}
export async function ensurePartition(db: Database, hour: number) {
  const at = new Date(hour * 3_600_000);
  for (let offset = 0; offset < 3; offset++) {
    const date = new Date(
      Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + offset, 1),
    );
    const next = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1),
    );
    const name = `price_changes_${date.getUTCFullYear()}_${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    await db.unsafe(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF price_changes FOR VALUES FROM (${date.getTime() / 3600000}) TO (${next.getTime() / 3600000})`,
    );
  }
}
