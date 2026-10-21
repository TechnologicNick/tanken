# ANWB fuel-map investigation

## Input and method

Input: `ANWB+Onderweg+&+Wegenwacht_5.21.4_APKPure.xapk`. The ZIP container contains the base `com.themobilecompany.Onderweg.apk`, ARM64 and screen-density splits, an icon and package metadata. Only the base APK was needed for this feature.

Extracted the base APK with Python `zipfile`, decompiled DEX to Java using [JADX](https://github.com/skylot/jadx), and dumped Android resources using the locally installed Android SDK `aapt2`. JADX reported 313 decompilation errors across the app; relevant Retrofit interfaces and request-header interceptor were readable. The web app is an independent implementation of the observed HTTP interface; it does not run copied Android source.

Generated evidence remains under `.analysis/` (ignored by Git). Relevant source paths are relative to `.analysis/decompiled/sources/`:

| Evidence | Finding |
| --- | --- |
| `defpackage/o8c.java` | Retrofit station list, POST list and detail endpoints and query parameter names |
| `defpackage/ln5.java` | National average prices endpoint |
| `defpackage/v82.java` | HTTP request header names |
| `defpackage/fg7.java` | Production resource selection and caller ID |
| `defpackage/e9c.java` | Uppercase fuel code, bounding box serialization, response conversion |
| `defpackage/cx5.java`, method `Q` | Coordinates serialized latitude first for POI API |
| `defpackage/y99.java`, method `A` | Fuel station type is `FUEL_STATION` |
| `nl/anwb/onderweg/core/data/settings/FuelCode.java` | Supported fuel identifiers |
| `nl/anwb/onderweg/core/mapbox/Layers.java` | Separate domestic and European fuel price layers |
| `.analysis/resources.txt` | `apigee_apikey_prod`, `kong_apikey` resource values, stored only in local settings |

## Verified HTTP contract

Base: `https://api.anwb.nl/`

### Station markers and list

```http
GET /routing/points-of-interest/v3/all?type-filter=FUEL_STATION&bounding-box-filter=52.3,4.8,52.4,4.95&fuel-types-filter=EURO95
Accept: application/json
x-anwb-client-id: <apigee_apikey_prod resource>
APIKEY: <kong_apikey resource>
x-anwb-caller-id: onderweg-app/android
```

Bounding box order: **south latitude, west longitude, north latitude, east longitude**. An initial request using `fuel` as the type and longitude-first coordinates returned HTTP 400; the recovered type, latitude-first coordinates and uppercase fuel code returned HTTP 200. The minimal headers above worked without a bearer token, user account, installation ID, device attestation or request signing. The native interceptor also sets User-Agent, `install_id`, and `x-anwb-statistics-application`; they were not required for the tested requests.

The returned `value` array contains `id`, `coordinates.latitude/longitude`, `title`, `address`, `type`, `prices`, `openingHours` and `shopOpeningHours`. Every station can contain prices for several fuels, even when a single fuel filter is supplied. The frontend selects the price matching the active fuel, rather than assuming the first price is correct.

Each price contains `fuelName`, `fuelType`, numeric `value`, `currency`, and `priceTier: { max, value }`. Price tiers observed use a maximum of 3. The UI uses the API tier for the marker colour and independently highlights the minimum returned price. “Cheapest” always refers to the returned stations in the last searched viewport, not the whole country. Zero/unknown prices are excluded from comparisons.

Fuel values: `EURO95`, `DIESEL`, `EURO98`, `DIESEL_SPECIAL`, `AUTOGAS`, `CNG`.

### Details

```http
GET /routing/points-of-interest/v3/details/FUEL_STATION/appitup_2913
```

Verified HTTP 200 with the same headers. Returns `{ value: station, copyright }`. The station includes the list fields and `facilities` (`name`, `key`). Example verified station: Tango Sierenborch, Amsterdam. No user data was requested.

### National averages

```http
GET /routing/points-of-interest/v3/fuel-prices
```

Verified HTTP 200. Returns `{ value: [{ name, type, price }, ...], copyright }`. Six fuel types were returned in the test. The exact method of calculating these averages was not established.

### Other discovered calls

The same Retrofit interface exposes a POST variant of `/routing/points-of-interest/v3/all` with a request body, used for route-oriented queries. The app also has Mapbox geocoding, map layers and account authentication endpoints. These are not required by this web version and were not reproduced. The independent frontend uses Leaflet/OpenStreetMap and [PDOK's Dutch location search](https://github.com/PDOK/open-api-specs/blob/master/locatieserver/oas.yaml), avoiding use of the app's Mapbox tokens.

## Limits

This was static analysis plus direct read-only HTTP verification, not traffic captured from a running Android emulator. Domestic petrol and diesel responses, details and averages were verified. Foreign fuel prices, account-only features, app-wide behavior and background refresh rules were not established. [ANWB's FAQ](https://www.anwb.nl/mobiel/onderweg-app/veelgestelde-vragen) describes login requirements for foreign prices.

API responses include an ANWB copyright notice restricting reuse. The implementation is left as a local personal-use prototype; public distribution requires resolving data permissions. An undocumented endpoint working today is not a guarantee of continued access.

The server is a fixed-endpoint proxy, not a general upstream URL proxy. It keeps identifiers on the server, limits map query size, caches results for two minutes, deduplicates simultaneous requests, times out stalled requests and serves only an explicit file allowlist. It binds to the local network by default for phone access; set `HOST=127.0.0.1` to restrict it to this computer.
