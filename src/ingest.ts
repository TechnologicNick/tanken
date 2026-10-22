import type { Database } from "./db.ts";
import type { Bounds, Station } from "./domain.ts";
export interface SeenStation {
  station: Station;
  batchId: number;
}

// All comparisons and current-state/history writes occur in one transaction.
export async function ingest(
  db: Database,
  hour: number,
  observations: SeenStation[],
  covered: Bounds[],
) {
  return db.begin(async (tx) => {
    await tx`CREATE TEMP TABLE incoming (source_id text PRIMARY KEY, lat double precision, lng double precision, title text, country text, country_name text, address jsonb, hours jsonb, prices jsonb, batch_id integer) ON COMMIT DROP`;
    const unique = new Map(observations.map((o) => [o.station.sourceId, o]));
    const rows = [...unique.values()].map(({ station: s, batchId }) => ({
      source_id: s.sourceId,
      lat: s.lat,
      lng: s.lng,
      title: s.title,
      country: s.country,
      country_name: s.countryName,
      address: s.address,
      hours: s.hours,
      prices: s.prices,
      batch_id: batchId,
    }));
    for (let i = 0; i < rows.length; i += 2000) {
      await tx`INSERT INTO incoming SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows.slice(i, i + 2000))}::text::jsonb) AS x(source_id text,lat double precision,lng double precision,title text,country text,country_name text,address jsonb,hours jsonb,prices jsonb,batch_id integer)`;
    }
    await tx`ANALYZE incoming`;
    // Avoid ON CONFLICT for identity dimensions: it would burn IDs on every hourly check.
    await tx`INSERT INTO countries(code,name) SELECT DISTINCT ON(i.country) i.country,i.country_name FROM incoming i WHERE NOT EXISTS(SELECT 1 FROM countries c WHERE c.code=i.country) ORDER BY i.country,i.country_name`;
    await tx`INSERT INTO currencies(code) SELECT DISTINCT p->>'currency' FROM incoming i CROSS JOIN LATERAL jsonb_array_elements(i.prices) p WHERE NOT EXISTS(SELECT 1 FROM currencies c WHERE c.code=p->>'currency')`;
    await tx`INSERT INTO fuel_types(code,name,unit) SELECT DISTINCT ON(p->>'code') p->>'code',p->>'label',CASE WHEN p->>'code'='CNG' THEN 'kg' ELSE 'l' END FROM incoming i CROSS JOIN LATERAL jsonb_array_elements(i.prices) p WHERE NOT EXISTS(SELECT 1 FROM fuel_types f WHERE f.code=p->>'code') ORDER BY p->>'code',p->>'label'`;
    await tx`INSERT INTO stations(source_id,country_id,latitude,longitude,title,address,opening_hours)
      SELECT i.source_id,c.id,i.lat,i.lng,i.title,i.address,i.hours FROM incoming i JOIN countries c ON c.code=i.country WHERE NOT EXISTS(SELECT 1 FROM stations s WHERE s.source_id=i.source_id)`;
    await tx`UPDATE stations s SET country_id=c.id,latitude=i.lat,longitude=i.lng,title=i.title,address=i.address,opening_hours=i.hours
      FROM incoming i JOIN countries c ON c.code=i.country WHERE s.source_id=i.source_id
      AND (s.country_id,s.latitude,s.longitude,s.title,s.address,s.opening_hours) IS DISTINCT FROM (c.id,i.lat,i.lng,i.title,i.address,i.hours)`;
    await tx`INSERT INTO station_fuels(station_id,fuel_type_id)
      SELECT s.id,f.id FROM incoming i JOIN stations s ON s.source_id=i.source_id CROSS JOIN LATERAL jsonb_array_elements(i.prices) p JOIN fuel_types f ON f.code=p->>'code'
      WHERE NOT EXISTS(SELECT 1 FROM station_fuels sf WHERE sf.station_id=s.id AND sf.fuel_type_id=f.id)`;
    await tx`CREATE TEMP TABLE reported ON COMMIT DROP AS SELECT sf.id AS series_id,(p->>'amount')::integer AS price_milli,c.id AS currency_id,
      (CASE WHEN p->>'amount' IS NULL THEN 1 ELSE 0 END)::smallint AS state,LEAST(3,GREATEST(0,(p->>'tier')::integer))::smallint AS tier
      FROM incoming i JOIN stations s ON s.source_id=i.source_id CROSS JOIN LATERAL jsonb_array_elements(i.prices) p
      JOIN fuel_types f ON f.code=p->>'code' JOIN station_fuels sf ON sf.station_id=s.id AND sf.fuel_type_id=f.id JOIN currencies c ON c.code=p->>'currency'`;
    await tx`INSERT INTO reported SELECT cp.series_id,NULL,cp.currency_id,2::smallint,0::smallint FROM current_prices cp JOIN station_fuels sf ON sf.id=cp.series_id JOIN stations s ON s.id=sf.station_id JOIN incoming i ON i.source_id=s.source_id WHERE NOT EXISTS(SELECT 1 FROM reported r WHERE r.series_id=cp.series_id)`;
    await tx`CREATE TEMP TABLE changed ON COMMIT DROP AS SELECT r.* FROM reported r LEFT JOIN current_prices cp ON cp.series_id=r.series_id
      WHERE cp.series_id IS NULL OR (cp.price_milli,cp.currency_id,cp.state) IS DISTINCT FROM (r.price_milli,r.currency_id,r.state)`;
    await tx`INSERT INTO price_changes(series_id,observed_hour,price_milli,currency_id,state) SELECT series_id,${hour},price_milli,currency_id,state FROM changed
      ON CONFLICT(series_id,observed_hour) DO UPDATE SET price_milli=excluded.price_milli,currency_id=excluded.currency_id,state=excluded.state`;
    await tx`INSERT INTO current_prices(series_id,observed_hour,price_milli,currency_id,state,tier) SELECT series_id,${hour},price_milli,currency_id,state,tier FROM changed
      ON CONFLICT(series_id) DO UPDATE SET observed_hour=excluded.observed_hour,price_milli=excluded.price_milli,currency_id=excluded.currency_id,state=excluded.state,tier=excluded.tier`;
    await tx`UPDATE current_prices cp SET tier=r.tier FROM reported r WHERE cp.series_id=r.series_id AND cp.tier IS DISTINCT FROM r.tier`;
    await tx`INSERT INTO station_presence_changes(station_id,observed_hour,present) SELECT s.id,${hour},true FROM incoming i JOIN stations s ON s.source_id=i.source_id LEFT JOIN station_state ss ON ss.station_id=s.id WHERE ss.station_id IS NULL OR NOT ss.present
      ON CONFLICT(station_id,observed_hour) DO UPDATE SET present=true`;
    await tx`INSERT INTO station_state(station_id,last_seen_batch_id,present) SELECT s.id,i.batch_id,true FROM incoming i JOIN stations s ON s.source_id=i.source_id
      ON CONFLICT(station_id) DO UPDATE SET last_seen_batch_id=excluded.last_seen_batch_id,present=true`;
    await tx`CREATE TEMP TABLE coverage(south double precision,west double precision,north double precision,east double precision) ON COMMIT DROP`;
    if (covered.length)
      await tx`INSERT INTO coverage SELECT * FROM jsonb_to_recordset(${JSON.stringify(covered.map((b) => ({ south: b[0], west: b[1], north: b[2], east: b[3] })))}::text::jsonb) AS x(south double precision,west double precision,north double precision,east double precision)`;
    await tx`CREATE TEMP TABLE disappeared ON COMMIT DROP AS SELECT ss.station_id FROM station_state ss JOIN stations s ON s.id=ss.station_id
      WHERE ss.present AND NOT EXISTS(SELECT 1 FROM incoming i WHERE i.source_id=s.source_id)
      AND EXISTS(SELECT 1 FROM coverage c WHERE s.latitude BETWEEN c.south AND c.north AND s.longitude BETWEEN c.west AND c.east)`;
    await tx`INSERT INTO station_presence_changes(station_id,observed_hour,present) SELECT station_id,${hour},false FROM disappeared ON CONFLICT(station_id,observed_hour) DO UPDATE SET present=false`;
    await tx`UPDATE station_state SET present=false WHERE station_id IN (SELECT station_id FROM disappeared)`;
    const [count] = await tx`SELECT count(*)::integer AS count FROM changed`;
    return { stations: rows.length, changes: Number(count.count) };
  });
}
