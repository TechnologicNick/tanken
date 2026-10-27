import { priceHTML } from "./price.ts";
import { openingHours } from "./hours.ts";
import { fuelNames, hourISO } from "./domain.ts";
import type { StationRow, Viewport } from "./queries.ts";
import { historyChart } from "./chart.ts";
export const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const money = (amount: number, currency = "EUR") =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency,
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(amount / 1000);
export const date = (v: Date | string) =>
  new Date(v).toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    dateStyle: "short",
    timeStyle: "short",
  });
const unitLabel = (unit: string) => unit === "l" ? "L" : unit;
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
export interface Assets {
  style: string;
  common: string;
  map: string;
  leaflet: string;
  leafletCss: string;
  pin: string;
  pinRetina: string;
  drawer: string;
}
export function layout(
  title: string,
  body: string,
  assets: Assets,
  map = false,
) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#123e34"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="description" content="Vergelijk brandstofprijzen en bekijk de prijsgeschiedenis van tankstations in Europa."><title>${esc(title)} · Tanken</title><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icon.svg"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><link rel="stylesheet" href="${assets.style}">${map ? `<link rel="stylesheet" href="${assets.leafletCss}"><script defer src="${assets.leaflet}"></script><script type="module" src="${assets.map}"></script>` : ""}<script type="module" src="${assets.common}"></script></head><body><div id="connection" role="status" hidden></div>${body}</body></html>`;
}
export function cards(rows: StationRow[], fuel: string) {
  return (
    rows
      .map(
        (s) =>
          `<a class="station" data-id="${s.id}" data-lat="${s.latitude}" data-lng="${s.longitude}" data-amount="${s.price_milli}" data-currency="${esc(s.currency)}" data-tier="${s.tier}" href="/stations/${s.id}?fuel=${encodeURIComponent(fuel)}"><span class="brand">${esc(s.title.slice(0, 2).toUpperCase())}</span><span class="info"><strong>${esc(s.title)}</strong><span class="address">${esc([s.address.streetAddress, s.address.city].filter(Boolean).join(", "))}</span><small>Waargenomen ${esc(date(s.fetched_at))}</small></span><span class="price">${priceHTML(s.price_milli, s.currency)}<small>per ${s.unit === "kg" ? "kg" : "liter"} · ${s.distance.toFixed(1)} km</small></span></a>`,
      )
      .join("") ||
    "<p>Geen stations met een bekende prijs in dit gebied. Verplaats de kaart of kies een andere brandstof.</p>"
  );
}
export function markers(v: Viewport) {
  return v.markers;
}
export function stationPayload(v: Viewport) {
  return {
    markers: markers(v),
    html: cards(v.rows, v.fuel),
    total: v.total,
    page: v.page,
    truncated: v.truncated,
    retrievedAt: v.retrievedAt,
    stale: v.stale,
    mapBounds: v.mapBounds,
    mapStationCount: v.mapStationCount,
    zoom: v.zoom,
  };
}

export function stationMapLinks(s: any) {
  const address = [s.address?.streetAddress, s.address?.postalCode, s.address?.city, s.country_name].filter(Boolean).join(', ');
  const query = [s.title?.trim(), address].filter(Boolean).join(', ') || `${s.latitude},${s.longitude}`;
  const apple = new URLSearchParams({ q: s.title?.trim() || address || `${s.latitude},${s.longitude}`, ll: `${s.latitude},${s.longitude}` });
  const google = new URLSearchParams({ api: '1', query });
  return `<div class="navigation-links"><a class="navigate" href="https://maps.apple.com/?${esc(apple)}" target="_blank" rel="noopener">Apple Kaarten ↗</a><a class="navigate" href="https://www.google.com/maps/search/?${esc(google)}" target="_blank" rel="noopener">Google Maps ↗</a></div>`;
}

export function home(
  v: Viewport,
  assets: Assets,
  search?: {
    q: string;
    country: string;
    results: { label: string; lat: number; lng: number }[];
  },
) {
  const searchLinks =
    search?.results
      .map(
        (r) =>
          `<li><a href="/?${esc(new URLSearchParams({ bounds: [Math.max(-85, r.lat - 0.07), Math.max(-180, r.lng - 0.13), Math.min(85, r.lat + 0.07), Math.min(180, r.lng + 0.13)].join(","), fuel: v.fuel }))}">${esc(r.label)}</a></li>`,
      )
      .join("") || "";

  const query = new URLSearchParams({
    fuel: v.fuel,
    bounds: v.bounds.join(","),
    sort: v.sort,
    listBounds: v.listBounds.join(","),
  });
  const paging = (p: number) =>
    `/?${new URLSearchParams({ ...Object.fromEntries(query), page: String(p) })}`;
  const fuelPills = Object.entries(fuelNames)
    .map(
      ([code, name]) =>
        `<label><input type="radio" name="fuel" value="${code}" ${code === v.fuel ? "checked" : ""}><span>${esc(name)}</span></label>`,
    )
    .join("");
  const content = `<main class="map-layout" aria-label="Tankstations"><div class="map-controls"><form action="/" role="search" class="search-form" id="search-form"><div class="searchbox"><div class="search-input"><input id="search" aria-label="Plaats, adres of postcode" name="q" value="${esc(search?.q || "")}" required maxlength="120" placeholder="Plaats of postcode"><button id="search-clear" type="button" aria-label="Wis zoekopdracht" hidden>×</button></div><select name="country" aria-label="Zoekgebied"><option value="nl">Nederland</option><option value="eu" ${search?.country === "eu" ? "selected" : ""}>Europa</option></select></div><input type="hidden" name="fuel" value="${esc(v.fuel)}"><div id="search-status" role="status"></div><ul id="search-results" aria-label="Gevonden locaties">${searchLinks}</ul></form></div><aside id="list-panel" data-slot="drawer"><div id="list-portal" data-slot="drawer-portal"><div id="list-viewport" data-slot="drawer-viewport"><section id="list-drawer" data-slot="drawer-popup" data-compact aria-label="Tankstations"><div class="drawer-handle" data-slot="drawer-swipe-handle" aria-hidden="true"></div><button id="list-close" data-slot="drawer-close" type="button" aria-label="Verklein stationslijst">×</button><span id="loading" role="status" aria-label="Prijzen worden geladen" hidden></span><div id="list-body" data-slot="drawer-content"><form action="/" id="filters"><input type="hidden" name="bounds" id="bounds" value="${esc(v.bounds.join(","))}"><fieldset id="fuel" aria-label="Brandstof">${fuelPills}</fieldset><noscript><button>Bekijk stations</button></noscript></form><div class="list-summary"><div class="list-summary-content"><div class="summary"><strong id="count">${v.total} stations</strong><select name="sort" id="sort" form="filters" aria-label="Sorteer stations"><option value="price" ${v.sort === "price" ? "selected" : ""}>Laagste prijs</option><option value="distance" ${v.sort === "distance" ? "selected" : ""}>Dichtstbij</option></select><small class="list-area-hint">Binnen het kader op de kaart</small></div></div></div><p id="status" role="status">${v.stale ? "De laatste waarnemingen zijn ouder dan 90 minuten. " : ""}</p><div id="stations">${cards(v.rows, v.fuel)}</div><nav id="pagination" aria-label="Pagina's">${v.page > 1 ? `<a href="${esc(paging(v.page - 1))}">← Vorige</a>` : ""} ${v.page * 50 < v.total ? `<a href="${esc(paging(v.page + 1))}">Volgende →</a>` : ""}</nav></div></section></div></div></aside><section class="map-panel" aria-label="Kaart met brandstofprijzen"><div id="map"></div><div id="list-area" aria-hidden="true"></div><button id="locate" type="button" aria-label="Mijn locatie" title="Mijn locatie"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 3 14 21l-4-7-7-4Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></button><div id="station-panel" data-slot="drawer"><div data-slot="drawer-portal"><div id="station-backdrop" data-slot="drawer-backdrop" hidden></div><div id="station-card-viewport" data-slot="drawer-viewport" hidden><section id="station-card" data-slot="drawer-popup" role="region" aria-labelledby="station-card-title" tabindex="-1" hidden><div class="drawer-handle" data-slot="drawer-swipe-handle" aria-hidden="true"></div><button id="station-card-close" data-slot="drawer-close" type="button" aria-label="Sluit stationinformatie">×</button><div id="station-card-content" data-slot="drawer-content"><h2 id="station-card-title" data-slot="drawer-title">Stationinformatie</h2><div id="station-card-body" aria-live="polite"></div></div></section></div></div></div><noscript>De stationslijst werkt zonder JavaScript. Voor de interactieve kaart is JavaScript nodig.</noscript></section></main><script type="application/json" id="map-data">${json({ bounds: v.bounds, mapBounds: v.mapBounds, zoom: v.zoom, fuel: v.fuel, markers: markers(v), sort: v.sort, pin: assets.pin, pinRetina: assets.pinRetina, drawer: assets.drawer })}</script>`;
  return layout("Brandstofprijzen", content, assets, true);
}
export function historyCharts(h: any) {
  const currencies = [...new Set<string>(h.points.map((p: any) => p.currency))];
  return currencies
    .map(
      (currency) =>
        `<h3>${esc(currency)} / ${esc(unitLabel(h.unit))}</h3>${historyChart({ ...h, points: h.points.map((p: any) => (p.currency === currency ? p : { ...p, state: 1 })) })}`,
    )
    .join("");
}
export function stationCard(s: any, fuel: string, h: any) {
  const prices = s.prices
    .map(
      (p: any) =>
        `<div><span>${esc(fuelNames[p.code] || p.name)}</span><strong>${p.state === 0 ? `${priceHTML(p.price_milli, p.currency)} / ${esc(unitLabel(p.unit))}` : "Prijs onbekend"}</strong></div>`,
    )
    .join("");

  return `<article data-station-id="${s.id}" data-station-name="${esc(s.title)}">${stationMapLinks(s)}<p>${esc([s.address.streetAddress, s.address.postalCode, s.address.city, s.country_name].filter(Boolean).join(", "))}</p><div class="detail-prices">${prices || "Geen bekende prijzen."}</div><p>${s.present === false ? "Station niet aangetroffen bij de laatste geslaagde controle. " : ""}${s.fetched_at ? `Laatst waargenomen: ${esc(date(s.fetched_at))}` : "Nog geen waarnemingen."}</p><p><a href="/stations/${s.id}?fuel=${encodeURIComponent(fuel)}">Alle prijzen en prijsgeschiedenis →</a></p><h3>Prijsgeschiedenis · ${esc(fuelNames[h.fuel] || h.fuel)}</h3>${historyCharts(h) || "<p>Nog geen prijsgeschiedenis.</p>"}<h3>Openingstijden</h3>${openingHours(s.opening_hours)}<h3>Voorzieningen</h3><p>${s.facilities?.length ? s.facilities.map((f: any) => esc(f.name)).join(" · ") : "Niet bekend"}</p></article>`;
}
export function detail(s: any, h: any, assets: Assets) {
  const current = s.prices
    .map(
      (p: any) =>
        `<div><a href="?fuel=${encodeURIComponent(p.code)}">${esc(fuelNames[p.code] || p.name)}</a><strong>${p.state === 0 ? `${priceHTML(p.price_milli, p.currency)} / ${esc(unitLabel(p.unit))}` : "Prijs onbekend"}</strong></div>`,
    )
    .join("");
  const periods = [1, 7, 30, 365]
    .map(
      (days) =>
        `<option value="${days}" ${days === h.days ? "selected" : ""}>${days} dagen</option>`,
    )
    .join("");
  const fuels = s.prices
    .map(
      (p: any) =>
        `<option value="${esc(p.code)}" ${h.fuel === p.code ? "selected" : ""}>${esc(fuelNames[p.code] || p.name)}</option>`,
    )
    .join("");
  const charts = historyCharts(h);
  const rows = h.rows
    .map(
      (p: any) =>
        `<tr><td>${esc(date(hourISO(p.observed_hour)))}</td><td>${p.state === 0 ? priceHTML(p.price_milli, p.currency) : p.state === 1 ? "Onbekend" : "Niet gerapporteerd"}</td></tr>`,
    )
    .join("");
  const link = (page: number, to = h.to) =>
    `?${new URLSearchParams({ fuel: h.fuel, days: String(h.days), page: String(page), to: String(to) })}`;

  return layout(
    s.title,
    `<main class="detail-page"><a href="/?bounds=${s.latitude - 0.07},${s.longitude - 0.13},${s.latitude + 0.07},${s.longitude + 0.13}&fuel=${esc(h.fuel)}">← Kaart en stations</a><div class="eyebrow">TANKSTATION · ${esc(s.country_name)}</div><h1>${esc(s.title)}</h1>${stationMapLinks(s)}<p>${esc([s.address.streetAddress, s.address.postalCode, s.address.city].filter(Boolean).join(", "))}</p><div class="detail-prices">${current}</div><p>${s.present === false ? "Station niet aangetroffen bij de laatste geslaagde controle. " : ""}${s.fetched_at ? `Laatst waargenomen: ${esc(date(s.fetched_at))}` : ""}</p><h2>Prijsgeschiedenis</h2><form><label>Brandstof <select name="fuel">${fuels}</select></label><label>Periode <select name="days">${periods}</select></label><button>Bekijken</button></form>${charts || "<p>Nog geen prijsgeschiedenis voor deze brandstof.</p>"}<table><thead><tr><th>Waarnemingsuur</th><th>Prijs / ${esc(unitLabel(h.unit))}</th></tr></thead><tbody>${rows || '<tr><td colspan="2">Geen wijzigingen in deze periode.</td></tr>'}</tbody></table><nav>${h.page > 1 ? `<a href="${esc(link(h.page - 1))}">← Vorige wijzigingen</a>` : ""} ${h.page * 100 < h.total ? `<a href="${esc(link(h.page + 1))}">Meer wijzigingen →</a>` : ""}<br><a href="${esc(link(1, h.from))}">← Oudere periode</a> ${h.to < hourNow() ? `<a href="${esc(link(1, Math.min(hourNow(), h.to + h.days * 24)))}">Nieuwere periode →</a>` : ""}</nav><h2>Openingstijden</h2>${openingHours(s.opening_hours)}<h2>Voorzieningen</h2><p>${s.facilities?.length ? s.facilities.map((f: any) => esc(f.name)).join(" · ") : "Niet bekend"}</p></main>`,
    assets,
  );
}
function hourNow() {
  return Math.floor(Date.now() / 3600000) + 1;
}
