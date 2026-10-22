import { database, migrate } from "../src/db.ts";
const db = database();
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.close();
}
