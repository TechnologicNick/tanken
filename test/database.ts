import { database, migrate } from "../src/db.ts";
import { randomBytes } from "node:crypto";
export async function isolatedDatabase() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "DATABASE_URL or TEST_DATABASE_URL is required for integration tests",
    );
  const admin = database(url),
    name = `tanken_test_${randomBytes(6).toString("hex")}`;
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const testUrl = new URL(url);
  testUrl.pathname = `/${name}`;
  const db = database(testUrl.toString());
  try {
    await migrate(db);
  } catch (error) {
    await db.close();
    await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.close();
    throw error;
  }
  return {
    db,
    async close() {
      await db.close();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.close();
    },
  };
}
