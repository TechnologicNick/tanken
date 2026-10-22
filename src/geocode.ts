import type { Database } from "./db.ts";
export async function geocode(db: Database, q: string, country: string) {
  q = q.trim();
  if (!q || q.length > 120 || !/^(nl|eu)$/.test(country))
    throw new Error("Vul een plaats, adres of postcode in.");
  const key = `${country}:${q.toLocaleLowerCase("nl")}`;
  const [hit] =
    await db`SELECT results FROM geocode_cache WHERE key=${key} AND expires_at>now()`;
  if (hit) return hit.results;
  let results: { label: string; lat: number; lng: number }[];
  if (country === "nl") {
    const url = new URL(
      "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free",
    );
    url.search = new URLSearchParams({
      q,
      rows: "5",
      fq: "type:(woonplaats OR postcode OR adres)",
    }).toString();
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("Zoeken is tijdelijk niet beschikbaar.");
    const data = (await r.json()) as any;
    results = data.response.docs.map((d: any) => {
      const match = /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll);
      if (!match) throw new Error("Ongeldig zoekresultaat.");
      return {
        label: d.weergavenaam,
        lng: Number(match[1]),
        lat: Number(match[2]),
      };
    });
  } else {
    const agent = process.env.GEOCODER_USER_AGENT;
    if (!agent)
      throw new Error(
        "Europees zoeken is nog niet ingesteld. Verplaats de kaart of gebruik je locatie.",
      );
    // Serialize requests across web processes through a shared, short transaction.
    const wait = await db.begin(async (tx) => {
      await tx`INSERT INTO service_limits(name,next_at) VALUES('geocoder',now()) ON CONFLICT DO NOTHING`;
      const [slot] =
        await tx`SELECT greatest(0,extract(epoch FROM next_at-now())*1000)::integer AS wait FROM service_limits WHERE name='geocoder' FOR UPDATE`;
      if (slot.wait > 10000)
        throw new Error("Zoeken is druk. Probeer het later opnieuw.");
      await tx`UPDATE service_limits SET next_at=greatest(next_at,now())+interval '1100 milliseconds' WHERE name='geocoder'`;
      return Number(slot.wait);
    });
    await Bun.sleep(wait);
    const url = new URL(
      process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org/search",
    );
    url.search = new URLSearchParams({
      q,
      format: "jsonv2",
      limit: "5",
      "accept-language": "nl",
    }).toString();
    const r = await fetch(url, {
      headers: { "User-Agent": agent },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error("Zoeken is tijdelijk niet beschikbaar.");
    const data = (await r.json()) as any[];
    results = data.map((d) => ({
      label: String(d.display_name),
      lat: Number(d.lat),
      lng: Number(d.lon),
    }));
  }
  if (results.some((r) => !Number.isFinite(r.lat) || !Number.isFinite(r.lng)))
    throw new Error("Ongeldig zoekresultaat.");
  await db`INSERT INTO geocode_cache(key,results,expires_at) VALUES(${key},${JSON.stringify(results)}::text::jsonb,now()+interval '7 days') ON CONFLICT(key) DO UPDATE SET results=excluded.results,expires_at=excluded.expires_at`;
  await db`DELETE FROM geocode_cache WHERE expires_at<now()`;
  return results;
}
