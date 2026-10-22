import { parseBrush, prepareBrush } from "./brush.ts";
import type { Database } from "./db.ts";
import { parseBounds, type Bounds, hourOf } from "./domain.ts";
import { mapMarkers, type MapMarker } from "./map-markers.ts";
export interface StationRow {
  id: number;
  title: string;
  address: any;
  latitude: number;
  longitude: number;
  price_milli: number;
  currency: string;
  unit: string;
  tier: number;
  distance: number;
  fetched_at: Date;
  [key: string]: any;
}
export interface Viewport {
  bounds: Bounds;
  listBounds: Bounds;
  fuel: string;
  sort: string;
  page: number;
  total: number;
  rows: StationRow[];
  markers: MapMarker[];
  mapBounds: Bounds;
  mapStationCount: number;
  zoom: number;
  truncated: boolean;
  retrievedAt: string | null;
  stale: boolean;
}
export async function viewport(
  db: Database,
  params: URLSearchParams,
): Promise<Viewport> {
  const bounds = parseBounds(params.get("bounds")),
    fuel = params.get("fuel") || "EURO95",
    sort = params.get("sort") || "price";
  if (!/^[A-Z0-9_]{1,50}$/.test(fuel) || !["price", "distance"].includes(sort))
    throw new Error("Ongeldige brandstof of sortering.");
  const page = Number(params.get("page") || 1);
  if (!Number.isInteger(page) || page < 1 || page > 10000)
    throw new Error("Ongeldige pagina.");
  const [south, west, north, east] = bounds,
    lat = (south + north) / 2,
    lng = (west + east) / 2;
  const mapBounds = params.has("mapBounds")
    ? parseBounds(params.get("mapBounds"))
    : bounds;
  if (
    mapBounds[0] > south ||
    mapBounds[1] > west ||
    mapBounds[2] < north ||
    mapBounds[3] < east
  )
    throw new Error("Ongeldige kaartbuffer.");
  const listBounds = params.has("listBounds")
    ? parseBounds(params.get("listBounds"))
    : bounds;
  if (
    listBounds[0] < south ||
    listBounds[1] < west ||
    listBounds[2] > north ||
    listBounds[3] > east
  )
    throw new Error("Ongeldig lijstgebied.");
  const zoom = params.has("zoom")
    ? Number(params.get("zoom"))
    : Math.max(3, Math.min(18, Math.floor(Math.log2(1440 / (east - west)))));
  if (!Number.isFinite(zoom) || zoom < 3 || zoom > 18)
    throw new Error("Ongeldige zoom.");
  const strokes = parseBrush(params.get("brush"));
  const brush = strokes.length ? prepareBrush(strokes) : null;
  const brushBounds = brush?.bounds || mapBounds;
  const selected =
    (await db`SELECT s.id,s.title,s.address,s.latitude,s.longitude,cp.price_milli,c.code AS currency,f.unit,cp.tier,cs.fetched_at,
    6371*acos(least(1.0,greatest(-1.0,sin(radians(s.latitude))*sin(radians(${lat}::double precision))+cos(radians(s.latitude))*cos(radians(${lat}::double precision))*cos(radians(s.longitude-${lng}::double precision))))) AS distance
    FROM stations s JOIN station_state ss ON ss.station_id=s.id AND ss.present
    JOIN collection_shards cs ON cs.id=ss.last_seen_batch_id
    JOIN station_fuels sf ON sf.station_id=s.id JOIN fuel_types f ON f.id=sf.fuel_type_id AND f.code=${fuel}
    JOIN current_prices cp ON cp.series_id=sf.id AND cp.state=0 JOIN currencies c ON c.id=cp.currency_id
    WHERE (s.latitude BETWEEN ${mapBounds[0]} AND ${mapBounds[2]} AND s.longitude BETWEEN ${mapBounds[1]} AND ${mapBounds[3]}) OR (s.latitude BETWEEN ${brushBounds[0]} AND ${brushBounds[2]} AND s.longitude BETWEEN ${brushBounds[1]} AND ${brushBounds[3]})`) as StationRow[];
  // Viewport sets are bounded by the station catalogue, independently of archive size.
  // Do not compare different currencies as if their amounts were equivalent.
  const visible = selected.filter((s) =>
    brush
      ? brush.contains(s.latitude, s.longitude)
      : s.latitude >= listBounds[0] &&
        s.latitude <= listBounds[2] &&
        s.longitude >= listBounds[1] &&
        s.longitude <= listBounds[3],
  );
  visible.sort((a, b) =>
    sort === "distance"
      ? a.distance - b.distance || a.id - b.id
      : a.currency.localeCompare(b.currency) ||
        a.price_milli - b.price_milli ||
        a.distance - b.distance ||
        a.id - b.id,
  );
  const times = visible.map((s) => new Date(s.fetched_at).getTime());
  const mapStations = selected.filter(
    (s) =>
      s.latitude >= mapBounds[0] &&
      s.latitude <= mapBounds[2] &&
      s.longitude >= mapBounds[1] &&
      s.longitude <= mapBounds[3],
  );
  const markers = mapMarkers(
    mapStations.map((s) => ({
      kind: "station",
      id: s.id,
      title: s.title,
      lat: s.latitude,
      lng: s.longitude,
      amount: s.price_milli,
      currency: s.currency,
      tier: s.tier,
    })),
    zoom,
  );
  return {
    bounds,
    listBounds,
    fuel,
    sort,
    page,
    total: visible.length,
    rows: visible.slice((page - 1) * 50, page * 50),
    markers,
    mapBounds,
    mapStationCount: mapStations.length,
    zoom,
    truncated: false,
    retrievedAt: times.length
      ? new Date(times.reduce((a, b) => Math.min(a, b), Infinity)).toISOString()
      : null,
    stale: times.some((t) => Date.now() - t > 90 * 60000),
  };
}
export async function stationDetails(db: Database, id: number) {
  const [station] =
    await db`SELECT s.*,c.code AS country_code,c.name AS country_name,ss.present,cs.fetched_at FROM stations s JOIN countries c ON c.id=s.country_id LEFT JOIN station_state ss ON ss.station_id=s.id LEFT JOIN collection_shards cs ON cs.id=ss.last_seen_batch_id WHERE s.id=${id}`;
  if (!station) return null;
  const prices =
    await db`SELECT sf.id AS series_id,f.code,f.name,f.unit,cp.price_milli,cp.state,c.code AS currency,cp.observed_hour FROM station_fuels sf JOIN fuel_types f ON f.id=sf.fuel_type_id JOIN current_prices cp ON cp.series_id=sf.id JOIN currencies c ON c.id=cp.currency_id WHERE sf.station_id=${id} ORDER BY f.id`;
  return { ...station, prices };
}
export async function history(
  db: Database,
  id: number,
  params: URLSearchParams,
) {
  const fuel = params.get("fuel") || "EURO95",
    days = Number(params.get("days") || 30),
    page = Number(params.get("page") || 1);
  if (
    ![1, 7, 30, 365].includes(days) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000
  )
    throw new Error("Ongeldige periode of pagina.");
  const to = params.has("to") ? Number(params.get("to")) : hourOf() + 1;
  if (!Number.isInteger(to) || to < 0 || to > hourOf() + 1)
    throw new Error("Ongeldige einddatum.");
  const from = Math.max(0, to - days * 24);
  const [series] =
    await db`SELECT sf.id,f.name,f.unit FROM station_fuels sf JOIN fuel_types f ON f.id=sf.fuel_type_id WHERE sf.station_id=${id} AND f.code=${fuel}`;
  if (!series)
    return {
      fuel,
      days,
      page,
      from,
      to,
      rows: [],
      points: [],
      gaps: [],
      total: 0,
      presence: [],
      unit: "l",
    };
  const all =
    await db`SELECT pc.observed_hour,pc.price_milli,pc.state,c.code AS currency FROM price_changes pc JOIN currencies c ON c.id=pc.currency_id WHERE pc.series_id=${series.id} AND pc.observed_hour>=${from} AND pc.observed_hour<${to} ORDER BY pc.observed_hour`;
  const before =
    await db`SELECT pc.observed_hour,pc.price_milli,pc.state,c.code AS currency FROM price_changes pc JOIN currencies c ON c.id=pc.currency_id WHERE pc.series_id=${series.id} AND pc.observed_hour<${from} ORDER BY pc.observed_hour DESC LIMIT 1`;
  // A successful shard confirms this location even if another shard failed.
  // Explicit price changes remain evidence even if station coordinates later move.
  const runs = await db`SELECT DISTINCT cs.hour_id FROM collection_shards cs
    JOIN query_shards qs ON qs.id=cs.shard_id JOIN stations s ON s.id=${id}
    WHERE cs.hour_id>=${from} AND cs.hour_id<${to} AND cs.status=1
    AND s.latitude BETWEEN qs.bounds[1] AND qs.bounds[3]
    AND s.longitude BETWEEN qs.bounds[2] AND qs.bounds[4]`;
  const successful = new Set([
      ...runs.map((r: any) => Number(r.hour_id)),
      ...all.map((p: any) => Number(p.observed_hour)),
    ]),
    gaps: number[] = [];
  for (let h = from; h < to; h++) if (!successful.has(h)) gaps.push(h);
  const presence =
    await db`SELECT observed_hour,present FROM station_presence_changes WHERE station_id=${id} AND observed_hour>=${from} AND observed_hour<${to} ORDER BY observed_hour`;
  const lastPresence =
    await db`SELECT observed_hour,present FROM station_presence_changes WHERE station_id=${id} AND observed_hour<${from} ORDER BY observed_hour DESC LIMIT 1`;
  return {
    fuel,
    days,
    page,
    from,
    to,
    rows: [...all].reverse().slice((page - 1) * 100, page * 100),
    points: [...before, ...all],
    gaps,
    total: all.length,
    presence: [...lastPresence, ...presence],
    unit: series.unit,
  };
}
