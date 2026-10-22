# ANWB catalogue coverage

Verified with live, read-only calls on 21 October 2026. Application credentials are deliberately omitted.

Request `GET https://api.anwb.nl/routing/points-of-interest/v3/all` with `type-filter=FUEL_STATION` and `bounding-box-filter=south,west,north,east`. Omit `fuel-types-filter`: the result then includes all stations and all their reported fuels. The same application headers used by the original prototype work for foreign stations too.

## Limit and completeness

The endpoint accepts 10,000 stations. A box containing 10,001 stations returned HTTP 200 with an `error.code` of `limit_exceeded`, rather than a station array. A large empty geographic area works, and the Netherlands fits in one request. The prototype's local geographic restriction was therefore unnecessarily strict.

Every accepted response must have a `value` array matching `totalResults`. An error body, mismatched count, malformed station or duplicate ID fails that shard; none is interpreted as an empty successful response. Boundary overlaps are deduplicated by opaque source ID.

An exhaustive recursive scan of world bounds `[-90,-180,90,180]` found 133,154 distinct IDs in 50 country/territory codes, with 292,787 station/fuel entries. 292,561 had positive known prices; zero values are unknown. All returned currencies were EUR. These are the stations exposed by this endpoint and these credentials at verification time, not a claim to cover every physical station worldwide.

## Minimum query plan

The 10,000-result cap gives a lower bound of 14 requests for that catalogue. Sort station coordinates by longitude, keep identical longitudes together and place boundaries halfway between neighboring longitude groups. Fourteen balanced full-latitude strips each returned 9,511 stations. Their union matched the exhaustive ID set exactly, achieving the lower bound.

The adjacent longitude boundaries are:

```text
-180
-4.532403
-1.307071
2.2354315
5.511397
7.7284355
9.2203065
10.9293405
12.596814
14.5536285
17.288875
21.916173
27.9567045
38.064989
180
```

Each query uses latitude -90 to 90 and two successive longitude boundaries. Full world coverage means new stations outside the current catalogue's occupied areas remain discoverable. The shipped values live in `src/domain.ts`; active plans and any subdivisions persist in PostgreSQL.

The implementation was verified again by a full hourly collection: 14 successful shards, 133,154 unique stations and 292,787 first price events. `bun run rebalance` independently recalculated a 14-query plan and verified the exact ID set before switching plans.

## Maintaining coverage

Station additions or a lower upstream cap may make a strip fail. The collector atomically replaces an overfull shard with two covering children and queries them. Boundaries overlap rather than leaving gaps. Transient failures retry up to three times, respect Retry-After, and retain prior state if unsuccessful. Authentication failure stops further requests for that run. Large Retry-After values defer the failed shard to a later run.

Run `bun run rebalance` after a complete collection to reclaim the minimum number of requests. It locks against collection, proposes `ceil(current_station_count/10000)` longitude strips, queries each strip, compares the fresh union to every present stored ID, and activates the plan in a transaction. If the catalogue changes during verification, or tied longitudes prevent that construction, it fails without changing the current plan. A safe covering plan may temporarily use more requests than the theoretical minimum. Fourteen is a verified current minimum, not a permanent API guarantee.

Raw responses and application secrets are not archived. Query bounds, response counts, attempt times and normalized station data provide operational evidence without retaining large JSON snapshots.
