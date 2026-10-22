import { test, expect } from "bun:test";
import { parseBrush, prepareBrush, project, unproject } from "../src/brush.ts";
test("brush segments have rounded ends and a union of independent strokes, without filling their bounding box", () => {
  const strokes = [
    {
      radius: 0.01,
      points: [
        [130, 80],
        [131, 81],
      ],
    },
    {
      radius: 0.01,
      points: [
        [132, 80],
        [132, 81],
      ],
    },
  ];
  const brush = prepareBrush(parseBrush(JSON.stringify(strokes)));
  const hit = (x: number, y: number) => brush.contains(...unproject(x, y));
  expect(hit(130.5, 80.5)).toBe(true);
  expect(hit(129.995, 79.995)).toBe(true);
  expect(hit(132, 80.5)).toBe(true);
  expect(hit(131.5, 80.5)).toBe(false);
  expect(hit(130.5, 80.52)).toBe(false);
  expect(project(...unproject(130, 80))[0]).toBeCloseTo(130, 10);
  expect(project(...unproject(130, 80))[1]).toBeCloseTo(80, 10);
});
test("malformed and unbounded brush masks are rejected", () => {
  for (const raw of [
    "null",
    "{}",
    "[null]",
    '[{"radius":0,"points":[[1,1],[2,2]]}]',
    '[{"radius":1,"points":[[999,1],[2,2]]}]',
    '[{"radius":1,"points":[[1,1]]}]',
    JSON.stringify([{ radius: 1, points: Array(2049).fill([1, 1]) }]),
  ])
    expect(() => parseBrush(raw)).toThrow("Ongeldig penseelgebied.");
  expect(parseBrush(null)).toEqual([]);
});

test("encircling fills the interior, including near closure, while an open arc stays hollow", () => {
  const points: [number, number][] = [
    [130, 80],
    [132, 80],
    [132, 82],
    [130, 82],
  ];
  const open = prepareBrush([{ radius: 0.01, points }]);
  expect(open.contains(...unproject(131, 81))).toBe(false);
  for (const end of [
    [130, 80],
    [130, 80.015],
  ] as [number, number][]) {
    const closed = prepareBrush([{ radius: 0.01, points: [...points, end] }]);
    expect(closed.contains(...unproject(131, 81))).toBe(true);
    expect(closed.contains(...unproject(129.98, 81))).toBe(false);
  }
  // The enlarged brush remains valid at the minimum map zoom.
  expect(
    parseBrush(JSON.stringify([{ radius: 62.4 / 2 ** 3, points }])),
  ).toHaveLength(1);
});
test("a loop remains filled when drawing continues, including loops after a lead-in", () => {
  const points: [number, number][] = [
    [128, 80],
    [130, 80],
    [132, 80],
    [132, 82],
    [130, 82],
    [130, 79],
    [128, 79],
  ];
  const closed = prepareBrush([{ radius: 0.01, points }]);
  expect(closed.contains(...unproject(131, 81))).toBe(true);
  expect(closed.contains(...unproject(129, 81))).toBe(false);
});
