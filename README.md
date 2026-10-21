# Tanken

A mobile-friendly fuel-price map built from analysis of the supplied ANWB Onderweg & Wegenwacht **5.21.4** XAPK. The interface is Dutch. It uses live ANWB station data, with a separate web interface and OpenStreetMap basemap.

## Run

Requires Node.js 22 or newer.

```powershell
npm install
npm start
```

Open **http://localhost:3000** on this computer. On an iPhone connected to the same Wi-Fi, open **http://192.168.1.55:3000** in Safari (the server prints the current network addresses). Keep the computer and server running. If Windows prompts about the firewall, allow Node on your private network. You can use Safari → Share → Add to Home Screen.

The code uses browser features available in iOS 17. Tested using Playwright Chromium and mobile WebKit; not on a physical iOS 17 device. Safari geolocation requires an HTTPS origin on a phone. Place/address/postcode search and manual map browsing work over local HTTP. Use your own HTTPS reverse proxy/hosting if you want location access or access away from home; this project has not been deployed publicly.

## Features

- Petrol E10, diesel B7, Euro 98 E5, premium diesel, LPG and CNG.
- Price markers, cheapest stations highlighted, list sorted by price or straight-line distance from the map centre.
- Search Dutch places, addresses and postcodes; optional device location.
- Station details, fuel prices, opening hours, facilities and Apple Maps navigation.
- Explicit “search this area” control after moving the map, plus saved fuel and map position.
- Two-minute in-memory API cache, request deduplication, input validation and upstream timeouts.
- No invented prices, account login, or analytics. API failure is shown explicitly.

## Local API settings

The extracted application-level identifiers have already been saved in `.anwb-local.json`, ignored by Git and never served by the web server. They are identifiers bundled with the Android app, not personal account credentials. Alternatively set `ANWB_CLIENT_ID` and `ANWB_API_KEY` in the server environment. Never place them in frontend JavaScript or commit the local settings.

To reproduce extraction from the existing analysis artifacts:

```powershell
python scripts/extract-config.py .analysis/resources.txt
```

The file `.analysis/resources.txt` is the output of Android SDK `aapt2 dump resources` on the base APK. For full steps and API evidence, see [docs/reverse-engineering.md](docs/reverse-engineering.md).

## Verification

```powershell
npm test
npx playwright install chromium webkit
# With npm start running in another terminal:
npm run test:browser
```

Screenshots are written to `test-results/`. Browser checks use live upstream responses, so they require network access and working ANWB settings.

## Data and scope

This is an independent, personal-use prototype, not an ANWB product. The ANWB API is undocumented and may change or revoke its application identifiers. Responses include ANWB copyright and restrictions on reuse; public/commercial distribution would need the appropriate permission. No ANWB branding, imagery, app code or Mapbox tokens are included in the web interface.

The API does not supply a last-price-change timestamp in the tested responses. “Opgehaald om” means the response retrieval time, possibly from the two-minute server cache. The displayed national average comes from ANWB; station price tiers come from ANWB as well. Prices at the pump take precedence. Foreign-station access was not verified; the app indicates that European prices require a logged-in account. No login or access restrictions are bypassed.

Search uses [PDOK Locatieserver](https://www.pdok.nl/restful-api/-/article/pdok-locatieserver-1). Map tiles use [OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/) with visible attribution and normal browser caching; use a suitable tile provider for larger deployments. Fonts load from Google Fonts with system fallbacks. This app requires a network connection and does not provide offline fuel data.
