# PostgreSQL storage design

The authoritative schema is `migrations/001_initial.sql`. Migrations run under a transaction-scoped advisory lock. Collection and query-plan changes share a separate session advisory lock; its connection has no idle expiration while the collector performs HTTP requests.

## Tables and relationships

| Table                             | Purpose                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------- |
| countries, currencies, fuel_types | Small shared dictionaries; smallint surrogate keys                                                |
| stations                          | Integer ID, unique opaque ANWB ID, coordinates, current title/address/hours and cached facilities |
| station_fuels                     | Integer series ID for each unique station/fuel pair                                               |
| current_prices                    | One current value/state/currency/tier per series                                                  |
| price_changes                     | Monthly partitioned, indefinite change history                                                    |
| station_state                     | Latest successful observation batch and whether the station is currently present                  |
| station_presence_changes          | Only appearance, disappearance and reappearance events                                            |
| query_plans, query_shards         | Versioned world coverage plans and persistent shard subdivisions                                  |
| collection_runs                   | One UTC hour, status and aggregate counts                                                         |
| collection_shards                 | Exact start/retrieval timestamps and outcome for each shard attempt                               |
| geocode_cache, service_limits     | Expiring submitted-query results and shared geocoder throttling                                   |

Foreign source IDs can contain `|` and other delimiters; they remain text in the stations table. Public application routes use the internal integer ID. Dictionary and station IDs are only allocated on insertion, avoiding sequence exhaustion from hourly conflict checks.

## Compact price events

| Column        | PostgreSQL type   | Payload bytes |
| ------------- | ----------------- | ------------: |
| series_id     | integer           |             4 |
| observed_hour | integer           |             4 |
| price_milli   | integer, nullable |             4 |
| currency_id   | smallint          |             2 |
| state         | smallint          |             2 |

The event payload is 16 bytes before tuple headers, alignment, page space and its index. Integer prices represent thousandths of the currency unit, with conversion validated before ingestion. State 0 means known, 1 means reported but unknown (upstream zero), and 2 means a previously reported fuel was omitted. Null prices accompany states 1 and 2. CNG uses kilograms; the other current fuels use liters.

`observed_hour = floor(UTC_epoch_milliseconds / 3600000)`. A shared collection row supplies the hourly observation context. Exact retrieval timestamps are kept once per shard attempt, referenced through current station state. Events describe observed hourly state, not ANWB's actual price-change time.

The sole historical index is the primary key `(series_id, observed_hour)`. PostgreSQL partitions history by observed_hour in calendar months. The collector creates the current and next two partitions; all existing partitions remain indefinitely. Range queries prune months and use the per-series key. Queries include the last prior price and presence event to carry known state into a selected window, while leaving missing observation hours unconfirmed.

## Write behavior

An ingestion transaction stages normalized, deduplicated station rows; inserts new dictionary entries/stations/series; updates changed metadata; compares reported values with current state; and writes only changed price, currency or availability states to history. Tier-only changes update current display metadata without creating price history. History's hourly primary key makes retry writes idempotent, coalescing repeated observations within the same hour.

Successful observations update station_state every hour. Keeping this small mutable table separate prevents rewriting large address/opening-hours JSON or price history on unchanged polls. Its fillfactor of 75 and the current_prices fillfactor of 85 leave space for HOT updates. There is no index on the frequently updated last-seen field. PostgreSQL autovacuum remains enabled.

Absence reconciliation applies only inside successfully queried bounds and only after combining the successful station observations. Failure in another area does not mark that area's stations absent. Absence has its own small change log and does not fabricate a price transition or permanent station closure. Partial-hour retries reread the successful areas as well, so reconciliation sees a complete snapshot of all areas that succeeded in that attempt.

Metadata is current-state data; historical addresses, opening hours and facilities are not retained. Raw upstream responses are not stored. Price, currency, fuel availability and station presence events remain indefinitely.

## Measured size and growth

The initial live PostgreSQL 18 snapshot contained 133,154 stations and 292,787 fuel series. `pg_total_relation_size` of its populated price-history partition was 21,577,728 bytes, approximately **74 bytes per event including its primary key**. Empty future partitions were 8 KiB each. The complete initial database was about 168 MiB, including metadata, current state, dictionaries and indexes, excluding WAL and backups.

At the measured event density, a rough annual archive estimate is:

```text
series_count × average_changes_per_series_per_day × 365 × 74 bytes
```

| Average changes per series per day | Approximate annual price-history growth |
| ---------------------------------: | --------------------------------------: |
|                                0.1 |                                 0.79 GB |
|                                  1 |                                  7.9 GB |
|                                  5 |                                 39.5 GB |

These are scenarios, not a measured ANWB change rate. Actual growth includes availability/currency changes, new stations, shared run logs and PostgreSQL overhead/bloat. With unchanged prices, price-history row count does not grow; run logs and occasional presence changes still do. Measure actual collection changes over several weeks using `bun run stats`. Normal backups and WAL storage need separate capacity.
