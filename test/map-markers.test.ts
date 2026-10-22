import { test, expect } from "bun:test";
import {
  mapMarkers,
  type MapMarker,
  type MapStation,
} from "../src/map-markers.ts";

const stations: MapStation[] = Array.from({ length: 16000 }, (_, id) => ({
  kind: "station",
  id,
  title: String(id),
  lat: 50 + Math.floor(id / 160) * 0.04,
  lng: 3 + (id % 160) * 0.03,
  amount: 1800 + (id % 300),
  currency: "EUR",
  tier: 1,
}));
const count = (markers: MapMarker[]) =>
  markers.reduce((n, m) => n + (m.kind === "cluster" ? m.count : 1), 0);

test("zoomed-out groups span the wider price labels and split at closer zoom", () => {
  const nearby = [20, 100].map((offset, id) => ({
    ...stations[0],
    id,
    lng: ((128000 + offset) / (256 * 2 ** 10)) * 360 - 180,
  }));
  expect(mapMarkers(nearby, 10)).toHaveLength(1);
  expect(mapMarkers(nearby, 10)[0]).toMatchObject({
    kind: "cluster",
    count: 2,
  });
  expect(mapMarkers(nearby, 11)).toHaveLength(2);
});

test("every station is represented at every zoom without the old 500-station cutoff", () => {
  for (const zoom of [3, 8, 12, 14, 18]) {
    const markers = mapMarkers(stations, zoom);
    expect(count(markers)).toBe(stations.length);
    expect(markers.length).toBeLessThanOrEqual(4000);
    for (const m of markers)
      if (m.kind === "cluster") {
        expect(m.lat).toBeGreaterThanOrEqual(m.bounds[0] - 1e-10);
        expect(m.lat).toBeLessThanOrEqual(m.bounds[2] + 1e-10);
        expect(m.lng).toBeGreaterThanOrEqual(m.bounds[1] - 1e-10);
        expect(m.lng).toBeLessThanOrEqual(m.bounds[3] + 1e-10);
      }
  }
});

test("cluster membership is independent of prices and list sorting", () => {
  const members = (markers: MapMarker[]) =>
    markers.map((m) => [m.id, m.kind === "cluster" ? m.count : 1]);
  expect(
    members(
      mapMarkers(
        [...stations].reverse().map((s) => ({ ...s, amount: 900 })),
        8,
      ),
    ),
  ).toEqual(members(mapMarkers(stations, 8)));
});

test("close zoom returns every individual station and empty areas remain empty", () => {
  const markers = mapMarkers(stations.slice(0, 600), 14);
  expect(markers).toHaveLength(600);
  expect(markers.every((m) => m.kind === "station")).toBe(true);
  expect(mapMarkers([], 10)).toEqual([]);
});

test("merged pins show the cheapest price and the total count, separately per currency", () => {
  const nearby = [2100, 1599, 1839].map((amount, id) => ({
    ...stations[0],
    id,
    amount,
    tier: id === 1 ? 3 : 1,
  }));
  expect(mapMarkers(nearby, 10)[0]).toMatchObject({
    kind: "cluster",
    amount: 1599,
    tier: 3,
    currency: "EUR",
    count: 3,
  });
  expect(mapMarkers([...nearby].reverse(), 10)).toEqual(mapMarkers(nearby, 10));
  const mixed = mapMarkers(
    [
      ...nearby,
      { ...nearby[0], id: 4, currency: "GBP", amount: 1200 },
      { ...nearby[0], id: 5, currency: "GBP", amount: 1300 },
    ],
    10,
  );
  expect(mixed).toHaveLength(2);
  expect(mixed.find((m) => m.currency === "GBP")).toMatchObject({
    kind: "cluster",
    amount: 1200,
    count: 2,
  });
  expect(mixed.find((m) => m.currency === "EUR")).toMatchObject({
    kind: "cluster",
    amount: 1599,
    count: 3,
  });
});
