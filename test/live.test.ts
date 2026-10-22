import { project } from "../src/brush.ts";
import { test, expect } from "bun:test";
import { isolatedDatabase } from "./database.ts";
import { rawStation } from "./fixtures.ts";
import { normalizeStation, hourOf, contains } from "../src/domain.ts";
import { collect } from "../src/collector.ts";
import { createServerOptions } from "../src/server.ts";

const integration =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL ? test : test.skip;
integration(
  "one WebSocket supports viewport changes, validation, coalescing and origin checks",
  async () => {
    const { db, close } = await isolatedDatabase();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      ...(await createServerOptions(db)),
    });
    let socket: WebSocket | undefined;
    try {
      const fixtures = [
        normalizeStation(rawStation("west", 5.12)),
        normalizeStation(rawStation("east", 6)),
      ];
      await collect(db, {
        hour: hourOf(),
        delay: 0,
        request: async (b) => fixtures.filter((s) => contains(b, s)),
      });
      const endpoint = new URL("/ws/stations", server.url);
      expect(
        (
          await fetch(endpoint, {
            headers: { Origin: "https://elsewhere.example" },
          })
        ).status,
      ).toBe(403);
      expect(
        (await fetch(endpoint, { headers: { Origin: server.url.origin } }))
          .status,
      ).toBe(426);
      endpoint.protocol = "ws:";
      const BunSocket = WebSocket as unknown as {
        new (url: URL, options: Bun.WebSocketOptions): WebSocket;
      };
      socket = new BunSocket(endpoint, {
        headers: { Origin: server.url.origin },
      });
      const ws = socket;
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = reject;
      });
      const replies: any[] = [];
      ws.onmessage = (event) => replies.push(JSON.parse(String(event.data)));
      const waitFor = async (id: number | null) => {
        for (let i = 0; i < 200; i++) {
          const found = replies.find((r) => r.id === id);
          if (found) return found;
          await Bun.sleep(10);
        }
        throw new Error(`No reply for ${id}`);
      };
      const request = (id: number, bounds: string) =>
        ws.send(
          JSON.stringify({
            id,
            query: new URLSearchParams({ bounds }).toString(),
          }),
        );
      request(1, "52,5,52.2,5.3");
      expect(await waitFor(1)).toMatchObject({ type: "stations", total: 1 });
      request(2, "bad");
      expect(await waitFor(2)).toMatchObject({
        type: "error",
        error: "Ongeldige kaartgrenzen.",
      });
      ws.send("invalid json");
      expect((await waitFor(null)).type).toBe("error");

      let locked!: () => void, release!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const unblock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transaction = db.begin(async (tx) => {
        await tx`LOCK TABLE stations IN ACCESS EXCLUSIVE MODE`;
        locked();
        await unblock;
      });
      await ready;
      try {
        request(3, "52,5,52.2,5.3");
        await Bun.sleep(30);
        request(4, "52,5,52.2,5.5");
        request(5, "52,5,52.2,6.2");
        await Bun.sleep(30);
      } finally {
        release();
        await transaction;
      }
      expect(await waitFor(5)).toMatchObject({ type: "stations", total: 2 });
      expect(replies.filter((r) => r.id === 3 || r.id === 4)).toEqual([]);
      const brush = [
        {
          radius: 0.001,
          points: Array.from({ length: 80 }, (_, i) =>
            project(52.079 + i * 0.000025, 5.12),
          ),
        },
      ];
      const query = new URLSearchParams({
        bounds: "52,5.9,52.2,6.1",
        brush: JSON.stringify(brush),
      }).toString();
      expect(query.length).toBeGreaterThan(1024);
      ws.send(JSON.stringify({ id: 6, query }));
      const brushed = await waitFor(6);
      expect(brushed).toMatchObject({
        type: "stations",
        total: 1,
        mapStationCount: 1,
      });
      expect(brushed.html).toContain('data-lng="5.12"');
      expect(ws.readyState).toBe(WebSocket.OPEN);
    } finally {
      socket?.close();
      await server.stop(true);
      await close();
    }
  },
  30000,
);
