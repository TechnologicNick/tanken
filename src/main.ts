import { fileURLToPath } from "node:url";
import { database, migrate } from "./db.ts";
const db = database();
await migrate(db);
await db.close();
const children = ["server.ts", "collector.ts"].map((file) =>
  Bun.spawn(
    [process.execPath, "run", fileURLToPath(new URL(file, import.meta.url))],
    { stdin: "ignore", stdout: "inherit", stderr: "inherit", env: process.env },
  ),
);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const first = await Promise.race(
  children.map(async (child) => ({ child, code: await child.exited })),
);
stop();
await Promise.all(children.map((child) => child.exited));
process.exit(first.code || 0);
