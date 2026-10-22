import type * as Leaflet from "leaflet";
import {
  brushLoops,
  parseBrush,
  project,
  unproject,
  type BrushStroke,
} from "../brush.ts";
declare const L: typeof Leaflet;
const radius = 62.4;
export function mapBrush(
  map: Leaflet.Map,
  changed: (finished: boolean) => void,
) {
  const container = map.getContainer();
  let strokes: BrushStroke[] = [];
  try {
    strokes = parseBrush(sessionStorage.getItem("tanken-brush"));
  } catch {}
  const pane = map.createPane("brush");
  pane.style.zIndex = "350";
  pane.style.pointerEvents = "none";
  // Composite the opaque strokes and fills together before applying transparency.
  pane.style.opacity = "0.28";
  const renderer = L.svg({ pane: "brush", padding: 0.5 });
  const layers: Leaflet.Polyline[] = [];
  const fills = L.layerGroup().addTo(map);
  function fill(s: BrushStroke) {
    for (const loop of brushLoops(s))
      L.polygon(
        loop.map((p) => unproject(...p)),
        {
          renderer,
          interactive: false,
          stroke: false,
          fillColor: "#7e9b30",
          fillOpacity: 1,
          className: "brush-fill",
          smoothFactor: 0,
        },
      ).addTo(fills);
  }
  function draw(s: BrushStroke) {
    const layer = L.polyline(
      s.points.map((p) => unproject(...p)),
      {
        renderer,
        interactive: false,
        color: "#7e9b30",
        opacity: 1,
        weight: s.radius * 2 ** map.getZoom() * 2,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 0,
      },
    ).addTo(map);
    layers.push(layer);
    return layer;
  }
  strokes.forEach((s) => {
    draw(s);
    fill(s);
  });
  let active:
    | {
        pointer: number;
        start: Leaflet.Point;
        moved?: boolean;
        stroke?: BrushStroke;
        layer?: Leaflet.Polyline;
      }
    | undefined;
  function save() {
    try {
      sessionStorage.setItem("tanken-brush", JSON.stringify(strokes));
    } catch {}
  }
  function clear() {
    strokes = [];
    fills.clearLayers();
    layers.splice(0).forEach((layer) => layer.remove());
    save();
    changed(true);
  }
  function point(event: PointerEvent) {
    return map.mouseEventToContainerPoint(event);
  }
  function world(p: Leaflet.Point): [number, number] {
    const ll = map.containerPointToLatLng(p);
    return project(ll.lat, Math.max(-180, Math.min(180, ll.lng))).map((v) =>
      Number(Math.max(0, Math.min(256, v)).toFixed(8)),
    ) as [number, number];
  }
  container.addEventListener(
    "contextmenu",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  container.addEventListener(
    "mousedown",
    (event) => {
      if (active) event.stopPropagation();
    },
    true,
  );
  container.addEventListener(
    "pointerdown",
    (event) => {
      if (
        event.button !== 2 ||
        (event.target as Element).closest(".leaflet-control,.leaflet-popup")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      active = { pointer: event.pointerId, start: point(event) };
      container.setPointerCapture(event.pointerId);
      container.classList.add("painting");
    },
    true,
  );
  container.addEventListener(
    "pointermove",
    (event) => {
      if (!active || event.pointerId !== active.pointer) return;
      event.preventDefault();
      event.stopPropagation();
      const p = point(event);
      if (!active.stroke) {
        if (p.distanceTo(active.start) < 4) return;
        active.moved = true;
        if (
          strokes.length >= 64 ||
          strokes.reduce((n, s) => n + s.points.length, 0) >= 2046
        ) {
          container.dispatchEvent(new Event("brushlimit"));
          return;
        }
        active.stroke = {
          radius: radius / 2 ** map.getZoom(),
          points: [world(active.start), world(p)],
        };
        strokes.push(active.stroke);
        active.layer = draw(active.stroke);
      } else {
        if (strokes.reduce((n, s) => n + s.points.length, 0) >= 2048) return;
        const previous = active.stroke.points.at(-1)!,
          next = world(p);
        if (
          Math.hypot(next[0] - previous[0], next[1] - previous[1]) *
            2 ** map.getZoom() <
          2
        )
          return;
        // Collapse straight runs while preserving turns, keeping long strokes compact.
        const a = active.stroke.points.at(-2)!;
        const dx = next[0] - a[0],
          dy = next[1] - a[1],
          length = Math.hypot(dx, dy);
        const deviation = length
          ? Math.abs(dx * (a[1] - previous[1]) - (a[0] - previous[0]) * dy) /
            length
          : Infinity;
        const forward =
          (previous[0] - a[0]) * (next[0] - previous[0]) +
            (previous[1] - a[1]) * (next[1] - previous[1]) >=
          0;
        if (forward && deviation * 2 ** map.getZoom() < 0.7)
          active.stroke.points[active.stroke.points.length - 1] = next;
        else active.stroke.points.push(next);
        active.layer!.setLatLngs(
          active.stroke.points.map((p) => unproject(...p)),
        );
      }
      changed(false);
    },
    true,
  );
  function finish(event?: PointerEvent, cancelled = false) {
    if (!active || (event && event.pointerId !== active.pointer)) return;
    const ended = active;
    active = undefined;
    container.classList.remove("painting");
    if (container.hasPointerCapture(ended.pointer))
      container.releasePointerCapture(ended.pointer);
    if (!ended.moved && !cancelled) clear();
    else {
      if (ended.stroke) fill(ended.stroke);
      save();
      changed(true);
    }
  }
  container.addEventListener(
    "pointerup",
    (event) => {
      if (active) {
        event.stopPropagation();
        finish(event);
      }
    },
    true,
  );
  container.addEventListener("pointercancel", (event) => finish(event, true));
  container.addEventListener("lostpointercapture", (event) =>
    finish(event, true),
  );
  addEventListener("blur", () => finish(undefined, true));
  map.on("zoomend", () =>
    layers.forEach((layer, i) =>
      layer.setStyle({ weight: strokes[i]!.radius * 2 ** map.getZoom() * 2 }),
    ),
  );
  return {
    get value() {
      return strokes.length ? JSON.stringify(strokes) : null;
    },
    get active() {
      return strokes.length > 0;
    },
    clear,
  };
}
