import { test, expect } from "bun:test";
import { priceParts, priceHTML } from "../src/price.ts";
import { openingHours } from "../src/hours.ts";
import { historyChart } from "../src/chart.ts";

test("prices raise only the final fractional digit, preserving currency placement", () => {
  for (const currency of ["EUR", "GBP", "CHF", "CZK"]) {
    const p = priceParts(1839, currency);
    expect(p.last).toBe("9");
    expect(p.before + p.last + p.after).toBe(
      new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency,
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }).format(1.839),
    );
    expect(priceHTML(1839, currency)).toContain(
      '<sup class="price-last">9</sup>',
    );
  }
});
test("opening hours show full days, split shifts, overnight spill and unknown days", () => {
  const html = openingHours([
    { dayOfWeek: ["MONDAY"], opens: "00:00", closes: "24:00" },
    { dayOfWeek: ["TUESDAY"], opens: "08:00", closes: "12:00" },
    { dayOfWeek: ["TUESDAY"], opens: "13:00", closes: "18:00" },
    { dayOfWeek: ["SATURDAY"], opens: "22:00", closes: "02:00" },
    { dayOfWeek: ["FRIDAY"], opens: "00:00", closes: "00:00" },
  ]);
  expect(html).toContain("24 uur open");
  expect(html).toContain("08:00–12:00, 13:00–18:00");
  expect(html).toContain("00:00–02:00");
  expect(html).toContain("Gesloten");
  expect(html).toContain("Niet bekend");
  expect(html.match(/<li/g)).toHaveLength(7);
  expect(openingHours([])).toContain("niet bekend");
});
const point = (hour: number, price = 1839, state = 0) => ({
  observed_hour: hour,
  price_milli: price,
  state,
});
test("a single recent observation has a visible dot and fits the available history", () => {
  const html = historyChart({
    from: 0,
    to: 720,
    points: [point(718)],
    gaps: Array.from({ length: 720 }, (_, i) => i).filter((i) => i !== 718),
    presence: [],
  });
  expect(html).toContain('<circle cx="76.0"');
  expect(html).toContain("H456.0");
  expect(html).toContain("1 bevestigde waarnemingsuren");
});
test("step charts connect consecutive confirmed hours but break across gaps and unknown prices", () => {
  const html = historyChart({
    from: 10,
    to: 15,
    points: [point(9), point(11, 1800), point(13, 0, 1), point(14, 1799)],
    gaps: [12],
    presence: [],
  });
  const path = /<path d="([^"]*)"/.exec(html)![1]!;
  expect(path.match(/M/g)).toHaveLength(2);
  expect(path).toContain("V");
  expect(html).toContain("3 bevestigde waarnemingsuren");
  expect(
    historyChart({
      from: 10,
      to: 15,
      points: [point(9)],
      gaps: [],
      presence: [{ observed_hour: 9, present: false }],
    }),
  ).toContain("Geen bevestigde prijzen");
});
