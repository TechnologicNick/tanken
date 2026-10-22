import type { WebSocketHandler } from "bun";
import type { Database } from "./db.ts";
import { viewport } from "./queries.ts";
import { stationPayload } from "./views.ts";

interface ViewRequest {
  id: number;
  query: string;
}
export interface LiveSession {
  running: boolean;
  closed: boolean;
  latestId: number;
  pending?: ViewRequest;
}

export function liveHandler(db: Database): WebSocketHandler<LiveSession> {
  return {
    maxPayloadLength: 256 * 1024,
    idleTimeout: 30,
    sendPings: true,
    // WebKit rejects Bun 1.3's extension negotiation on Windows. Plain frames
    // keep the same persistent connection compatible with Safari/iOS 17.
    perMessageDeflate: false,
    backpressureLimit: 1024 * 1024,
    closeOnBackpressureLimit: true,
    async message(ws, raw) {
      let request: ViewRequest;
      try {
        if (typeof raw !== "string") throw new Error();
        const value = JSON.parse(raw);
        if (
          !Number.isSafeInteger(value.id) ||
          value.id < 1 ||
          typeof value.query !== "string" ||
          value.query.length > 128 * 1024
        )
          throw new Error();
        request = value;
      } catch {
        ws.send(
          JSON.stringify({
            type: "error",
            id: null,
            error: "Ongeldig kaartverzoek.",
          }),
        );
        return;
      }
      const state = ws.data;
      if (request.id <= state.latestId) return;
      state.latestId = request.id;
      // Only one query runs at a time; queued movement keeps just the latest view.
      state.pending = request;
      if (state.running) return;
      state.running = true;
      try {
        while (state.pending && !state.closed) {
          const current = state.pending;
          state.pending = undefined;
          try {
            const result = await viewport(
              db,
              new URLSearchParams(current.query),
            );
            if (!state.closed && current.id === state.latestId)
              ws.send(
                JSON.stringify({
                  type: "stations",
                  id: current.id,
                  ...stationPayload(result),
                }),
              );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            const invalid = message.startsWith("Ongeldige");
            if (!invalid)
              console.error(
                JSON.stringify({ event: "viewport_error", message }),
              );
            if (!state.closed && current.id === state.latestId)
              ws.send(
                JSON.stringify({
                  type: "error",
                  id: current.id,
                  error: invalid
                    ? message
                    : "Prijzen zijn tijdelijk niet beschikbaar.",
                }),
              );
          }
        }
      } finally {
        state.running = false;
      }
    },
    close(ws) {
      ws.data.closed = true;
      ws.data.pending = undefined;
    },
  };
}
