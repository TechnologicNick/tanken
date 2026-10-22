import { normalizeStation, type Bounds, type Station } from "./domain.ts";
export class UpstreamError extends Error {
  constructor(
    public code: string,
    public status = 502,
    public retryAfter = 0,
  ) {
    super(`ANWB: ${code}`);
  }
}
export async function credentials() {
  let local: { clientId?: string; apiKey?: string } = {};
  const file = Bun.file(new URL("../.anwb-local.json", import.meta.url));
  if (await file.exists()) local = await file.json();
  const clientId = process.env.ANWB_CLIENT_ID || local.clientId,
    apiKey = process.env.ANWB_API_KEY || local.apiKey;
  if (!clientId || !apiKey)
    throw new Error(
      "ANWB_CLIENT_ID and ANWB_API_KEY are required for collection",
    );
  return {
    "x-anwb-client-id": clientId,
    APIKEY: apiKey,
    "x-anwb-caller-id": "onderweg-app/android",
    Accept: "application/json",
  };
}
export function validateResponse(data: any): Station[] {
  if (data?.error)
    throw new UpstreamError(String(data.error.code || "invalid_response"));
  if (
    !Array.isArray(data?.value) ||
    !Number.isInteger(data.totalResults) ||
    data.value.length !== data.totalResults
  )
    throw new UpstreamError("incomplete_response");
  const items = data.value.map(normalizeStation);
  if (new Set(items.map((s: Station) => s.sourceId)).size !== items.length)
    throw new UpstreamError("duplicate_station_ids");
  return items;
}
export async function stationRequest(bounds: Bounds): Promise<Station[]> {
  const url = new URL("https://api.anwb.nl/routing/points-of-interest/v3/all");
  url.search = new URLSearchParams({
    "type-filter": "FUEL_STATION",
    "bounding-box-filter": bounds.join(","),
  }).toString();
  const r = await fetch(url, {
    headers: await credentials(),
    signal: AbortSignal.timeout(15_000),
  });
  const retry = r.headers.get("retry-after");
  const retryAfter = retry
    ? /^\d+$/.test(retry)
      ? Number(retry) * 1000
      : Math.max(0, Date.parse(retry) - Date.now())
    : 0;
  if (!r.ok) throw new UpstreamError(`HTTP_${r.status}`, r.status, retryAfter);
  return validateResponse(await r.json());
}
export async function detailRequest(sourceId: string): Promise<any> {
  const r = await fetch(
    `https://api.anwb.nl/routing/points-of-interest/v3/details/FUEL_STATION/${encodeURIComponent(sourceId)}`,
    { headers: await credentials(), signal: AbortSignal.timeout(5000) },
  );
  if (!r.ok) throw new UpstreamError(`HTTP_${r.status}`, r.status);
  const data = (await r.json()) as any;
  if (
    !data.value ||
    data.error ||
    data.value.id !== sourceId ||
    !Array.isArray(data.value.facilities)
  )
    throw new UpstreamError("invalid_details");
  return data.value.facilities;
}
