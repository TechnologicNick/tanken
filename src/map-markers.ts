import type { Bounds } from "./domain.ts";

export interface MapStation {
  kind: "station";
  id: number;
  title: string;
  lat: number;
  lng: number;
  amount: number;
  currency: string;
  tier: number;
}
export interface MapCluster {
  kind: "cluster";
  id: string;
  lat: number;
  lng: number;
  count: number;
  tier: number;
  amount: number;
  currency: string;
  bounds: Bounds;
}
export type MapMarker = MapStation | MapCluster;

// Grid cells are anchored to world pixels, independently of price, list order,
// and viewport position. Every station contributes to a marker or a count.
export function mapMarkers(stations: MapStation[], zoom: number): MapMarker[] {
  if (zoom >= 14 && stations.length <= 4000) return stations;
  const scale = 256 * 2 ** zoom;
  // Price-and-count labels need more room than the original count circles.
  const cellSize = zoom <= 10 ? 160 : zoom <= 12 ? 128 : 96;
  for (let size = cellSize; ; size *= 2) {
    const groups = new Map<string, MapStation[]>();
    for (const s of stations) {
      const sin = Math.sin(
        (Math.max(-85, Math.min(85, s.lat)) * Math.PI) / 180,
      );
      const x = Math.floor((((s.lng + 180) / 360) * scale) / size);
      const y = Math.floor(
        ((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale) /
          size,
      );
      // Prices in different currencies cannot be ranked without an exchange rate.
      const key = `${zoom}:${size}:${x}:${y}:${s.currency}`;
      const group = groups.get(key);
      if (group) group.push(s);
      else groups.set(key, [s]);
    }
    if (groups.size > 4000) continue;
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, group]) => {
        if (group.length === 1) return group[0];
        let lat = 0,
          lng = 0;
        let cheapest = group[0];
        const bounds: Bounds = [90, 180, -90, -180];
        for (const s of group) {
          if (
            s.amount < cheapest.amount ||
            (s.amount === cheapest.amount && s.id < cheapest.id)
          )
            cheapest = s;
          lat += s.lat;
          lng += s.lng;
          bounds[0] = Math.min(bounds[0], s.lat);
          bounds[1] = Math.min(bounds[1], s.lng);
          bounds[2] = Math.max(bounds[2], s.lat);
          bounds[3] = Math.max(bounds[3], s.lng);
        }
        return {
          kind: "cluster",
          id,
          lat: lat / group.length,
          lng: lng / group.length,
          count: group.length,
          tier: cheapest.tier,
          amount: cheapest.amount,
          currency: cheapest.currency,
          bounds,
        };
      });
  }
}
