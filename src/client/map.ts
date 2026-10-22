import { locationSearch } from "./search.ts";
import { doubleTapDragZoom } from "./touch-zoom.ts";
import { mapBrush } from "./brush.ts";
import type * as Leaflet from "leaflet";
import type { stationPayload } from "../views.ts";
declare const L: typeof Leaflet;
type View = ReturnType<typeof stationPayload>;
import { stationPins } from "./pins.ts";
import { stationPanel } from "./station-panel.ts";
import { stationList } from "./station-list.ts";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const data = JSON.parse($("map-data").textContent || "{}");
const urlParams = new URLSearchParams(location.search);
let page = Number(urlParams.get("page") || 1);
if (!Number.isInteger(page) || page < 1 || page > 10000) page = 1;
const validBounds = (value: string | null) => {
  const b = (value || "").split(",").map(Number);
  return b.length === 4 &&
    b.every(Number.isFinite) &&
    b[0] >= -85 &&
    b[2] <= 85 &&
    b[1] >= -180 &&
    b[3] <= 180 &&
    b[0] < b[2] &&
    b[1] < b[3]
    ? b
    : null;
};
// A cached home document can be reused for another previously viewed area.
const initialBounds = validBounds(urlParams.get("bounds")) || data.bounds;
const fuelSelect = $("fuel"),
  sortSelect = $<HTMLSelectElement>("sort");
const fuels = [...fuelSelect.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const fuel = () => fuels.find(input => input.checked)!.value;
function setFuel(value: string | null) {
  const input = fuels.find(input => input.value === value);
  if (input) input.checked = true;
  $("search-form").querySelector<HTMLInputElement>('input[name="fuel"]')!.value = fuel();
}
setFuel(urlParams.get("fuel"));
document.body.classList.add("map-ready");
const controls = document.querySelector<HTMLElement>(".map-controls")!;
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--map-controls-height", `${controls.offsetHeight}px`);
}).observe(controls);
if ([...sortSelect.options].some((o) => o.value === urlParams.get("sort")))
  sortSelect.value = urlParams.get("sort")!;
const map = L.map("map", {
  minZoom: 3,
  maxZoom: 18,
  worldCopyJump: true,
}).fitBounds(
  [
    [initialBounds[0], initialBounds[1]],
    [initialBounds[2], initialBounds[3]],
  ],
  { padding: [-1, -1] },
);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const pins = stationPins(
  map,
  data.pinRetina || data.pin,
  (station) => panel.select(station, fuel()),
);
const render = (items: View["markers"]) => pins.update(items);
render(data.markers);
function bounds() {
  if (!map.getContainer().clientWidth)
    return $<HTMLInputElement>("bounds").value;
  const b = map.getBounds();
  return [
    Math.max(-85, b.getSouth()),
    Math.max(-180, b.getWest()),
    Math.min(85, b.getNorth()),
    Math.min(180, b.getEast()),
  ]
    .map((n) => n.toFixed(5))
    .join(",");
}
let brush: ReturnType<typeof mapBrush> | undefined;
let brushTimer: ReturnType<typeof setTimeout> | undefined;
const desktop = matchMedia("(min-width: 601px)");
type MapArea = { top: number; bottom: number };
let mobileArea: MapArea | undefined;
function exposedArea(details = false): MapArea {
  const rect = map.getContainer().getBoundingClientRect();
  const top = Math.max(0, controls.getBoundingClientRect().bottom - rect.top);
  let bottom = $("mobile-toggle").getBoundingClientRect().top - rect.top - 12;
  const popup = details || document.body.classList.contains("station-card-open")
    ? $("station-card")
    : document.body.classList.contains("list-open") ? $("list-drawer") : undefined;
  if (popup) {
    const handle = popup.querySelector<HTMLElement>('.drawer-handle')!;
    // Use the destination snap point even while the drawer is animating in.
    bottom = (popup.parentElement!.hasAttribute('data-expanded') ? 0 : map.getSize().y * .545) + handle.offsetTop;
  }
  return { top, bottom: Math.min(map.getSize().y, bottom) };
}
function captureMobileArea() {
  const area = exposedArea();
  if (area.bottom > area.top + 1) mobileArea = area;
}
function listBounds() {
  const size = map.getSize();
  if (!desktop.matches && !mobileArea) captureMobileArea();
  const area = mobileArea || { top: 0, bottom: size.y };
  const sw = map.containerPointToLatLng(desktop.matches ? [size.x * 0.25, size.y * 0.75] : [0, area.bottom]);
  const ne = map.containerPointToLatLng(desktop.matches ? [size.x * 0.75, size.y * 0.25] : [size.x, area.top]);
  return [
    Math.max(-85, sw.lat),
    Math.max(-180, sw.lng),
    Math.min(85, ne.lat),
    Math.min(180, ne.lng),
  ]
    .map((n) => n.toFixed(5))
    .join(",");
}
let moving = false;
let zooming = false,
  zoomChanged = false;
let loadedBounds = data.mapBounds || data.bounds;
let revision = 0,
  latest: { id: number; query: string } | undefined;
let socket: WebSocket | undefined,
  retry: ReturnType<typeof setTimeout> | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined,
  retryDelay = 500,
  suspended = false;
function loading(active: boolean) {
  $("loading").hidden = !active;
  $("stations").setAttribute("aria-busy", String(active));
}
function status(message: string, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
function apply(v: View, request: { id: number; query: string }) {
  requestAnimationFrame(() => {
    if (request.id !== revision) return;
    if (zooming || v.zoom !== map.getZoom()) return;
    render(v.markers);
    loadedBounds = v.mapBounds;
    if (moving || new URLSearchParams(request.query).get("bounds") !== bounds())
      return;
    loading(false);
    $("stations").innerHTML = v.html;
    panel.sync();
    $("count").textContent = `${v.total} stations`;
    status(
      (v.stale ? "De laatste waarnemingen zijn ouder dan 90 minuten. " : "") +
        (!navigator.onLine ? " Offline · eerder opgehaalde prijzen." : ""),
    );
    const params = new URLSearchParams(request.query);
    params.delete("brush");
    $("pagination").replaceChildren();
    if (v.page > 1) {
      const a = document.createElement("a");
      params.set("page", String(v.page - 1));
      a.href = `/?${params}`;
      a.textContent = "← Vorige";
      $("pagination").append(a);
    }
    if (v.page * 50 < v.total) {
      const a = document.createElement("a");
      params.set("page", String(v.page + 1));
      a.href = `/?${params}`;
      a.textContent = "Volgende →";
      $("pagination").append(a);
    }
    if (v.page > 1) params.set("page", String(v.page));
    else params.delete("page");
    history.replaceState(null, "", `/?${params}`);
    try {
      localStorage.setItem(
        "tanken",
        JSON.stringify({
          fuel: params.get("fuel"),
          bounds: params.get("bounds"),
        }),
      );
    } catch {}
  });
}
async function cached(request: { id: number; query: string }) {
  try {
    const response = await caches.match(`/api/stations?${request.query}`);
    if (request.id !== revision) return;
    if (response) apply(await response.json(), request);
    else if (!navigator.onLine) {
      pins.release();
      loading(false);
      status(
        "Offline · dit gebied is nog niet opgeslagen. De eerdere prijzen blijven staan.",
        true,
      );
    }
  } catch {
    if (!navigator.onLine) loading(false);
    /* Cache access is optional on insecure origins. */
  }
}
function send() {
  if (!latest) return;
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(latest));
  else {
    void cached(latest);
    if (navigator.onLine) loading(true);
  }
}
function refresh() {
  const params = new URLSearchParams({
    bounds: bounds(),
    zoom: String(map.getZoom()),
    mapBounds: (() => {
      const b = map.getBounds().pad(0.35);
      return [
        Math.max(-85, b.getSouth()),
        Math.max(-180, b.getWest()),
        Math.min(85, b.getNorth()),
        Math.min(180, b.getEast()),
      ]
        .map((n) => n.toFixed(5))
        .join(",");
    })(),
    fuel: fuel(),
    sort: sortSelect.value,
  });
  if (brush?.value) params.set("brush", brush.value);
  else params.set("listBounds", listBounds());
  if (page > 1) params.set("page", String(page));
  $<HTMLInputElement>("bounds").value = params.get("bounds")!;
  latest = { id: ++revision, query: params.toString() };
  loading(true);
  send();
}
function schedule() {
  clearTimeout(debounce);
  debounce = setTimeout(refresh, 150);
}
function connect() {
  if (
    suspended ||
    !navigator.onLine ||
    (socket && socket.readyState < WebSocket.CLOSING)
  )
    return;
  clearTimeout(retry);
  const ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws/stations`,
  );
  socket = ws;
  ws.onopen = () => {
    retryDelay = 500;
    if (latest?.id === revision) send();
    else schedule();
  };
  ws.onmessage = (event) => {
    if (ws !== socket) return;
    try {
      const value = JSON.parse(event.data);
      if (!latest || value.id !== revision) return;
      if (value.type === "error") {
        pins.release();
        loading(false);
        status(value.error, true);
        return;
      }
      if (value.type !== "stations") return;
      apply(value, latest);
      navigator.serviceWorker?.controller?.postMessage({
        type: "viewport",
        query: latest.query,
        value,
      });
    } catch {
      loading(false);
      status("Ophalen mislukt. Probeer de kaart opnieuw te bewegen.", true);
    }
  };
  ws.onclose = () => {
    if (ws !== socket || suspended) return;
    loading(false);
    status(
      navigator.onLine
        ? "Verbinding verbroken · opnieuw verbinden…"
        : "Offline · eerder opgehaalde prijzen blijven zichtbaar.",
    );
    if (latest) void cached(latest);
    if (navigator.onLine) {
      retry = setTimeout(connect, retryDelay);
      retryDelay = Math.min(15000, retryDelay * 2);
    }
  };
}
// Keep useful in-flight replies during gestures.
map.on("zoomstart", () => {
  if (!cameraMove && !desktop.matches) captureMobileArea();
  zooming = true;
  zoomChanged = true;
  pins.hold();
});
map.on("zoomend", () => {
  zooming = false;
});
map.on("movestart", () => {
  if (!cameraMove && !desktop.matches) captureMobileArea();
  page = 1;
  moving = true;
  clearTimeout(debounce);
});
map.on("moveend", () => {
  moving = false;
  if (zoomChanged) {
    zoomChanged = false;
    refresh();
  } else schedule();
});
let lastMoveQuery = 0;
map.on("move", () => {
  if (!moving || zooming || Date.now() - lastMoveQuery < 250) return;
  const b = map.getBounds();
  if (
    b.getSouth() >= loadedBounds[0] &&
    b.getWest() >= loadedBounds[1] &&
    b.getNorth() <= loadedBounds[2] &&
    b.getEast() <= loadedBounds[3]
  )
    return;
  lastMoveQuery = Date.now();
  refresh();
});
$("filters").addEventListener("submit", (e) => {
  e.preventDefault();
  clearTimeout(debounce);
  page = 1;
  refresh();
});
fuelSelect.onchange = sortSelect.onchange = () => {
  setFuel(fuel());
  clearTimeout(debounce);
  page = 1;
  refresh();
};
let locationMarker: Leaflet.CircleMarker | undefined;
$("locate").onclick = () => {
  if (!navigator.geolocation) {
    status("Locatie wordt niet ondersteund.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      map.setView([p.coords.latitude, p.coords.longitude], 13);
      locationMarker?.remove();
      locationMarker = L.circleMarker([p.coords.latitude, p.coords.longitude], {
        radius: 7,
      }).addTo(map);
      schedule();
    },
    () => status("Locatie niet beschikbaar. Gebruik HTTPS of zoek op plaats."),
    { timeout: 10000, maximumAge: 60000 },
  );
};
const list = stationList(data.drawer);
if (!desktop.matches) captureMobileArea();
function toggleMap(show: boolean) {
  void list.show(!show);
}
let cameraMove = false;
let previousView: { center: Leaflet.LatLng; zoom: number; area: MapArea | undefined } | undefined;
function animateCamera(center: Leaflet.LatLng, zoom: number) {
  map.stop();
  cameraMove = true;
  map.once('moveend', () => { cameraMove = false; });
  map.flyTo(center, zoom, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches, duration: .45 });
}
map.on('dragstart', () => {
  cameraMove = false;
  if (!desktop.matches) captureMobileArea();
});
const panel = stationPanel(data.drawer, toggleMap, pins.highlight, list.parent, {
  select(station) {
    if (desktop.matches) return;
    previousView ||= { center: map.getCenter(), zoom: map.getZoom(), area: mobileArea && { ...mobileArea } };
    const size = map.getSize(), area = exposedArea(true);
    const y = area.bottom > area.top ? (area.top + area.bottom) / 2 : size.y / 2;
    const center = map.unproject(map.project([station.lat, station.lng]).add([0, size.y / 2 - y]));
    animateCamera(center, map.getZoom());
  },
  close(restore) {
    const view = previousView;
    previousView = undefined;
    if (!view || !restore) return;
    mobileArea = view.area;
    animateCamera(view.center, view.zoom);
  },
});
function brushChanged(finished: boolean) {
  $("list-area").hidden = !!brush?.active;
  const hint = document.querySelector<HTMLElement>(".list-area-hint")!;
  hint.textContent = brush?.active
    ? "Binnen het geschilderde gebied"
    : "Binnen het kader op de kaart";
  page = 1;
  ++revision; // Ignore replies for an older paint mask, including during a stroke.
  clearTimeout(debounce);
  if (finished) {
    clearTimeout(brushTimer);
    brushTimer = undefined;
    refresh();
  } else
    brushTimer ||= setTimeout(() => {
      brushTimer = undefined;
      refresh();
    }, 120);
}
brush = mapBrush(map, brushChanged);
$("list-area").hidden = brush.active;
document.querySelector<HTMLElement>(".list-area-hint")!.textContent =
  brush.active
    ? "Binnen het geschilderde gebied"
    : "Binnen het kader op de kaart";
map
  .getContainer()
  .addEventListener("brushlimit", () =>
    status(
      "Selectie vol. Rechtsklik zonder te slepen om opnieuw te beginnen.",
      true,
    ),
  );
$("pagination").addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a");
  if (
    !link ||
    event.button ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  event.preventDefault();
  page = Number(new URL(link.href).searchParams.get("page") || 1);
  refresh();
});

if (!location.search) {
  try {
    const saved = JSON.parse(localStorage.getItem("tanken") || "{}"),
      b = validBounds(saved.bounds);
    if (b) {
      map.fitBounds([
        [b[0], b[1]],
        [b[2], b[3]],
      ]);
      setFuel(saved.fuel);
    }
  } catch {}
}
addEventListener("offline", () => {
  clearTimeout(retry);
  socket?.close();
  if (latest) void cached(latest);
});
addEventListener("online", () => {
  connect();
  schedule();
});
addEventListener("pagehide", () => {
  suspended = true;
  clearTimeout(retry);
  clearTimeout(debounce);
  clearTimeout(brushTimer);
  socket?.close();
});
addEventListener("pageshow", () => {
  suspended = false;
  connect();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    connect();
    schedule();
  }
});
connect();
schedule();

map.on("resize", () => {
  page = 1;
  if (!desktop.matches) captureMobileArea();
  schedule();
});
desktop.addEventListener("change", () => {
  mobileArea = undefined;
  page = 1;
  schedule();
});
doubleTapDragZoom(map);
locationSearch((location) => {
  panel.close(false);
  toggleMap(true);
  map.setView([location.lat, location.lng], 13);
  schedule();
});
