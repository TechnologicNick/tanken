export const fuelNames: Record<string, string> = {
  EURO95: "Euro 95 · E10",
  DIESEL: "Diesel · B7",
  EURO98: "Euro 98 · E5",
  DIESEL_SPECIAL: "Premium diesel",
  AUTOGAS: "LPG",
  CNG: "CNG",
};
export type Bounds = [number, number, number, number];
export const initialCuts = [
  -180, -4.532403, -1.307071, 2.2354315, 5.511397, 7.7284355, 9.2203065,
  10.9293405, 12.596814, 14.5536285, 17.288875, 21.916173, 27.9567045,
  38.064989, 180,
];
export const initialBounds: Bounds[] = initialCuts
  .slice(0, -1)
  .map((w, i) => [-90, w, 90, initialCuts[i + 1]]);
export const hourOf = (date: Date | number = Date.now()) =>
  Math.floor(Number(date) / 3_600_000);
export const hourISO = (hour: number) =>
  new Date(hour * 3_600_000).toISOString();
export function priceMilli(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid price");
  if (value === 0) return null;
  const scaled = Math.round(value * 1000);
  if (scaled > 2_147_483_647 || Math.abs(value * 1000 - scaled) > 1e-7)
    throw new Error("Unsupported price precision or range");
  return scaled;
}
export interface Price {
  code: string;
  label: string;
  amount: number | null;
  currency: string;
  tier: number;
}
export interface Station {
  sourceId: string;
  lat: number;
  lng: number;
  title: string;
  country: string;
  countryName: string;
  address: Record<string, unknown>;
  hours: unknown[];
  prices: Price[];
}
export function normalizeStation(raw: any): Station {
  const lat = raw?.coordinates?.latitude,
    lng = raw?.coordinates?.longitude;
  if (
    typeof raw?.id !== "string" ||
    !raw.id ||
    raw.id.length > 500 ||
    typeof raw.title !== "string" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180 ||
    !Array.isArray(raw.prices) ||
    typeof raw.address?.iso3CountryCode !== "string"
  )
    throw new Error("Invalid station");
  const codes = new Set<string>();
  const prices = raw.prices.map((p: any): Price => {
    if (
      typeof p.fuelType !== "string" ||
      !/^[A-Z0-9_]{1,50}$/.test(p.fuelType) ||
      !/^[A-Z]{3}$/.test(p.currency) ||
      codes.has(p.fuelType)
    )
      throw new Error("Invalid fuel or currency");
    codes.add(p.fuelType);
    return {
      code: p.fuelType,
      label: p.fuelName || p.fuelType,
      amount: priceMilli(p.value),
      currency: p.currency,
      tier: Number.isInteger(p.priceTier?.value) ? p.priceTier.value : 0,
    };
  });
  return {
    sourceId: raw.id,
    lat,
    lng,
    title: raw.title,
    country: raw.address.iso3CountryCode,
    countryName: raw.address.country || raw.address.iso3CountryCode,
    address: raw.address,
    hours: Array.isArray(raw.openingHours) ? raw.openingHours : [],
    prices,
  };
}
export function parseBounds(value: string | null): Bounds {
  const parts = (value ?? "52.02,4.99,52.16,5.25").split(",");
  const b = parts.map(Number);
  if (
    parts.length !== 4 ||
    parts.some((p) => !p.trim()) ||
    b.some((n) => !Number.isFinite(n)) ||
    b[0] < -85 ||
    b[2] > 85 ||
    b[1] < -180 ||
    b[3] > 180 ||
    b[0] >= b[2] ||
    b[1] >= b[3]
  )
    throw new Error("Ongeldige kaartgrenzen.");
  return b as Bounds;
}
export function contains(b: Bounds, s: { lat: number; lng: number }): boolean {
  return s.lat >= b[0] && s.lat <= b[2] && s.lng >= b[1] && s.lng <= b[3];
}
export function splitBounds(b: Bounds, depth = 0): [Bounds, Bounds] {
  if (depth >= 32) throw new Error("Unable to split overfull area safely");
  if (b[3] - b[1] > 1e-6) {
    const m = (b[1] + b[3]) / 2;
    return [
      [b[0], b[1], b[2], m],
      [b[0], m, b[2], b[3]],
    ];
  }
  const m = (b[0] + b[2]) / 2;
  return [
    [b[0], b[1], m, b[3]],
    [m, b[1], b[2], b[3]],
  ];
}
export function balancedBounds(
  stations: { lng: number }[],
  cap = 10_000,
): Bounds[] {
  if (!stations.length) return [[-90, -180, 90, 180]];
  const groups: { lng: number; count: number }[] = [];
  for (const s of [...stations].sort((a, b) => a.lng - b.lng)) {
    const previous = groups.at(-1);
    if (previous?.lng === s.lng) previous.count++;
    else groups.push({ lng: s.lng, count: 1 });
  }
  const n = Math.ceil(stations.length / cap),
    result: Bounds[] = [];
  let index = 0,
    remaining = stations.length,
    west = -180;
  for (let i = 0; i < n; i++) {
    const target = Math.ceil(remaining / (n - i));
    let count = 0;
    while (
      index < groups.length &&
      (i === n - 1 || count + groups[index].count <= target)
    )
      count += groups[index++].count;
    if (!count || count > cap)
      throw new Error("Longitude ties prevent a balanced strip plan");
    const east =
      index === groups.length
        ? 180
        : (groups[index - 1].lng + groups[index].lng) / 2;
    result.push([-90, west, 90, east]);
    west = east;
    remaining -= count;
  }
  return result;
}
