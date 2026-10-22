import { describe, test, expect } from "bun:test";
import {
  balancedBounds,
  contains,
  initialBounds,
  normalizeStation,
  parseBounds,
  priceMilli,
  splitBounds,
  hourOf,
} from "../src/domain.ts";
import { UpstreamError, validateResponse } from "../src/anwb.ts";
import { rawStation } from "./fixtures.ts";
describe("upstream contract", () => {
  test("prices are exact integers and zero means unknown", () => {
    expect(priceMilli(1.839)).toBe(1839);
    expect(priceMilli(0)).toBeNull();
    for (const v of [-1, NaN, Infinity, "1.839", 1.0001, 3000000])
      expect(() => priceMilli(v)).toThrow();
  });
  test("preserves opaque foreign IDs and multiple fuels", () => {
    const s = normalizeStation(rawStation("xavvy_M|BEL|10891815", 4));
    expect(s.sourceId).toContain("|");
    expect(s.prices).toHaveLength(2);
  });
  test("HTTP-200 errors and truncation are never accepted as empty coverage", () => {
    expect(() =>
      validateResponse({ error: { code: "limit_exceeded" } }),
    ).toThrow(UpstreamError);
    expect(() => validateResponse({ value: [], totalResults: 1 })).toThrow();
    expect(() =>
      validateResponse({
        value: [rawStation("x", 4), rawStation("x", 4)],
        totalResults: 2,
      }),
    ).toThrow();
    expect(validateResponse({ value: [], totalResults: 0 })).toEqual([]);
  });
  test("initial queries cover the world without gaps", () => {
    expect(initialBounds).toHaveLength(14);
    expect(initialBounds[0]).toEqual([-90, -180, 90, -4.532403]);
    expect(initialBounds.at(-1)?.[3]).toBe(180);
    for (let i = 1; i < initialBounds.length; i++)
      expect(initialBounds[i][1]).toBe(initialBounds[i - 1][3]);
  });
  test("balances at the minimum query count and retains all coordinates", () => {
    const stations = Array.from({ length: 133154 }, (_, i) => ({
      lat: 52,
      lng: -179 + (358 * i) / 133154,
    }));
    const plan = balancedBounds(stations);
    expect(plan).toHaveLength(14);
    const counts = plan.map(
      (b) => stations.filter((s) => contains(b, s)).length,
    );
    expect(new Set(counts)).toEqual(new Set([9511]));
    const [a, b] = splitBounds([-90, 4, 90, 6]);
    expect(a[3]).toBe(b[1]);
    expect(() => splitBounds(a, 32)).toThrow();
  });
  test("bounds validation and UTC hours", () => {
    for (const b of [
      "",
      ",4,53,5",
      "NaN,4,53,5",
      "54,4,53,5",
      "52,5,53,4",
      "-90,4,53,5",
    ])
      expect(() => parseBounds(b)).toThrow();
    expect(hourOf(new Date("2026-10-21T12:59:59Z"))).toBe(
      hourOf(new Date("2026-10-21T12:00:00Z")),
    );
  });
});
