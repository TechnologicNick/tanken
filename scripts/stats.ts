import { database } from "../src/db.ts";
const db = database();
try {
  console.log(
    JSON.stringify(
      {
        catalogue: (
          await db`SELECT (SELECT count(*) FROM stations)::integer AS stations,(SELECT count(*) FROM station_fuels)::integer AS series`
        )[0],
        recent:
          await db`SELECT hour_id,status,stations,changes,finished_at FROM collection_runs ORDER BY hour_id DESC LIMIT 24`,
        archive:
          await db`SELECT relname,pg_total_relation_size(relid)::bigint AS bytes,n_live_tup AS estimated_rows FROM pg_stat_user_tables WHERE relname LIKE 'price_changes_%' ORDER BY relname`,
        current:
          await db`SELECT relname,n_live_tup,n_dead_tup,n_tup_hot_upd,n_tup_upd FROM pg_stat_user_tables WHERE relname IN ('current_prices','station_state')`,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
