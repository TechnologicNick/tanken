import { priceParts, priceHTML } from "../price.ts";
import type * as Leaflet from "leaflet";
import type { MapMarker, MapStation } from "../map-markers.ts";
declare const L: typeof Leaflet;

interface Pin extends Leaflet.CircleMarker {
  station: MapMarker;
  caption: string;
  runs: {
    before: string;
    last: string;
    after: string;
    beforeWidth: number;
    lastWidth: number;
  };
  width: number;
  labelShown: boolean;
  _point: Leaflet.Point;
  _project(): void;
  _empty(): boolean;
}
interface Renderer extends Leaflet.Canvas {
  _ctx: CanvasRenderingContext2D;
  _container: HTMLCanvasElement;
  _drawing: boolean;
  _redrawBounds?: Leaflet.Bounds;
  _redraw(): void;
  _draw(): void;
  _update(): void;
  _reset(): void;
  _onZoomEnd(): void;
  _updateCircle(layer: Pin): void;
  occupied: Set<string>;
  origin: Leaflet.Point;
}

export function stationPins(
  map: Leaflet.Map,
  iconUrl: string,
  select: (station: MapStation) => void,
) {
  const image = new Image();
  const font = "600 11px system-ui, sans-serif",
    smallFont = "600 8px system-ui, sans-serif";
  const measure = document.createElement("canvas").getContext("2d")!;
  const captions = new Map<string, ReturnType<typeof makeCaption>>();
  function makeCaption(
    s: Pick<MapStation, "amount" | "currency">,
    suffix = "",
  ) {
    const p = priceParts(s.amount, s.currency);
    p.after += suffix;
    measure.font = font;
    const beforeWidth = measure.measureText(p.before).width,
      afterWidth = measure.measureText(p.after).width;
    measure.font = smallFont;
    const lastWidth = measure.measureText(p.last).width;
    return {
      text: p.before + p.last + p.after,
      runs: { ...p, beforeWidth, lastWidth },
      width:
        Math.ceil(beforeWidth + lastWidth + afterWidth) + (suffix ? 16 : 10),
    };
  }
  function caption(s: Pick<MapStation, "amount" | "currency">, suffix = "") {
    const key = `${s.currency}:${s.amount}:${suffix}`;
    if (!captions.has(key)) {
      captions.set(key, makeCaption(s, suffix));
      if (captions.size > 2000) captions.delete(captions.keys().next().value!);
    }
    return captions.get(key)!;
  }
  function paintPrice(
    ctx: CanvasRenderingContext2D,
    pin: Pin,
    x: number,
    y: number,
  ) {
    const p = pin.runs;
    const left =
      x - (pin.width - (pin.station.kind === "cluster" ? 16 : 10)) / 2;
    ctx.textAlign = "left";
    ctx.font = font;
    ctx.fillText(p.before, left, y);
    ctx.font = smallFont;
    ctx.fillText(p.last, left + p.beforeWidth, y - 2);
    ctx.font = font;
    ctx.fillText(p.after, left + p.beforeWidth + p.lastWidth, y);
  }
  // Leaflet 1.9.4's native Canvas manages projection, retina scaling, dragging,
  // zoom transforms and hit testing. Only its path painting is customized.
  const native = L.Canvas.prototype as unknown as Renderer;
  let held = false;
  const Canvas = L.Canvas.extend({
    // Keep Leaflet's zoom transform, but do not repaint the old groups at the
    // target zoom before their replacement is ready. Commit the canvas once.
    _update(this: Renderer) {
      if (!held) native._update.call(this);
    },
    _reset(this: Renderer) {
      if (!held) native._reset.call(this);
    },
    _onZoomEnd(this: Renderer) {
      if (!held) native._onZoomEnd.call(this);
    },
    _redraw(this: Renderer) {
      if (held) return;
      // Decluttering needs a full, deterministic paint, coalesced to one frame.
      this._redrawBounds = undefined;
      native._redraw.call(this);
    },
    _draw(this: Renderer) {
      this.occupied = new Set();
      this.origin = map.getPixelOrigin();
      // Reserve group labels before painting individual price labels.
      for (const pin of pins.values())
        if (pin.station.kind === "cluster" && pin._point) {
          const x = pin._point.x + this.origin.x,
            y = pin._point.y + this.origin.y;
          for (
            let a = Math.floor((x - pin.width / 2 - 3) / 16);
            a <= Math.floor((x + pin.width / 2 + 3) / 16);
            a++
          )
            for (
              let b = Math.floor((y - 15) / 16);
              b <= Math.floor((y + 15) / 16);
              b++
            )
              this.occupied.add(`${a}:${b}`);
        }
      native._draw.call(this);
      this._container.classList.add("station-canvas");
      this._container.setAttribute("role", "img");
      this._container.setAttribute(
        "aria-label",
        "Tankstations; groepen tonen de laagste prijs en het aantal stations. Prijzen en links staan ook in de stationslijst.",
      );
      this._container.dataset.markerCount = String(pins.size);
      this._container.dataset.stationCount = String(
        [...pins.values()].reduce(
          (n, p) => n + (p.station.kind === "cluster" ? p.station.count : 1),
          0,
        ),
      );
    },
    _updateCircle(this: Renderer, pin: Pin) {
      if (!pin.station) {
        native._updateCircle.call(this, pin);
        return;
      }
      if (!this._drawing || pin._empty()) return;
      const ctx = this._ctx,
        { x, y } = pin._point,
        s = pin.station;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (s.kind === "cluster") {
        ctx.beginPath();
        ctx.roundRect(x - pin.width / 2, y - 12, pin.width, 24, 12);
        ctx.fillStyle =
          s.tier === 1 ? "#e7f1d5" : s.tier === 3 ? "#fff3e4" : "#fff";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#adbea1";
        ctx.stroke();
        ctx.fillStyle = "#183e35";
        paintPrice(ctx, pin, x, y);
        return;
      }
      // Image loading never gates station visibility: draw a dot until decoded.
      if (image.complete && image.naturalWidth)
        ctx.drawImage(image, x - 7, y - 20, 14, 23);
      else {
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#123e34";
        ctx.fill();
      }
      const left = x - pin.width / 2,
        top = y - 40;
      const cells: string[] = [];
      for (
        let a = Math.floor((left + this.origin.x - 2) / 16);
        a <= Math.floor((left + this.origin.x + pin.width + 2) / 16);
        a++
      )
        for (
          let b = Math.floor((top + this.origin.y - 2) / 16);
          b <= Math.floor((top + this.origin.y + 20) / 16);
          b++
        )
          cells.push(`${a}:${b}`);
      pin.labelShown = !cells.some((key) => this.occupied.has(key));
      if (!pin.labelShown) return;
      for (const key of cells) this.occupied.add(key);
      ctx.beginPath();
      ctx.roundRect(left, top, pin.width, 18, 8);
      ctx.fillStyle =
        s.tier === 1 ? "#e7f1d5" : s.tier === 3 ? "#fff3e4" : "#fff";
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#adbea1";
      ctx.stroke();
      ctx.fillStyle = "#183e35";
      paintPrice(ctx, pin, x, top + 9);
    },
  });
  const pins = new Map<number | string, Pin>();
  const renderer = new (
    Canvas as unknown as { new (options: Leaflet.RendererOptions): Renderer }
  )({ padding: 0.35 }) as Renderer;
  const layer = L.layerGroup().addTo(map);
  function commitZoom() {
    if (!map.hasLayer(renderer)) return;
    // Canvas._reset resizes and paints before resetting its paths. Project all
    // paths first so that first paint already contains the final coordinates.
    for (const pin of pins.values()) pin._project();
    renderer._reset();
  }
  image.onload = () => {
    for (const pin of pins.values()) pin.redraw();
  };
  image.src = iconUrl;
  let highlight: Leaflet.CircleMarker | undefined;
  return {
    highlight(station: MapStation | null) {
      highlight?.remove();
      highlight = undefined;
      if (!station) return;
      const text = document.createElement("span");
      text.append(document.createTextNode(`${station.title} · `));
      const value = document.createElement("span");
      value.innerHTML = priceHTML(station.amount, station.currency);
      text.append(value);
      highlight = L.circleMarker([station.lat, station.lng], {
        radius: 12,
        color: "#b28c24",
        weight: 4,
        fillColor: "#fff2a8",
        fillOpacity: 0.65,
        className: "station-highlight",
        interactive: false,
      })
        .bindTooltip(text, {
          permanent: true,
          direction: "top",
          className: "station-highlight-label",
          offset: [0, -12],
        })
        .addTo(map);
    },
    hold() {
      held = true;
    },
    release() {
      if (!held) return;
      held = false;
      commitZoom();
    },
    update(items: MapMarker[]) {
      const wasHeld = held;
      held = false;
      const visible = new Set(items.map((s) => s.id));
      for (const [id, pin] of pins)
        if (!visible.has(id)) {
          layer.removeLayer(pin);
          pins.delete(id);
        }
      for (const s of items) {
        let pin = pins.get(s.id);
        const label = caption(s, s.kind === "cluster" ? `  ×${s.count}` : "");
        if (!pin) {
          pin = Object.assign(
            L.circleMarker([s.lat, s.lng], {
              renderer,
              radius: Math.max(42, label.width / 2 + 4),
              stroke: false,
            }),
            {
              station: s,
              caption: label.text,
              runs: label.runs,
              width: label.width,
              labelShown: false,
            },
          ) as Pin;
          const entry = pin;
          Object.assign(pin, {
            _containsPoint(point: Leaflet.Point) {
              const { x, y } = entry._point;
              if (entry.station.kind === "cluster")
                return (
                  Math.abs(point.x - x) < entry.width / 2 + 4 &&
                  Math.abs(point.y - y) < 16
                );
              return (
                (Math.abs(point.x - x) < 12 &&
                  point.y >= y - 22 &&
                  point.y <= y + 8) ||
                (entry.labelShown &&
                  Math.abs(point.x - x) < entry.width / 2 + 3 &&
                  point.y >= y - 42 &&
                  point.y <= y - 20)
              );
            },
          });
          pin.on("click", () => {
            const current = entry.station;
            if (current.kind === "cluster") {
              const [south, west, north, east] = current.bounds;
              const zoom = map.getZoom();
              map.fitBounds(
                [
                  [south, west],
                  [north, east],
                ],
                {
                  padding: [35, 35],
                  maxZoom: Math.min(18, zoom + 3),
                  animate: false,
                },
              );
              if (map.getZoom() <= zoom)
                map.setView([current.lat, current.lng], Math.min(18, zoom + 2));
              return;
            }
            select(current);
          });
          pins.set(s.id, pin);
          pin.addTo(layer);
        } else {
          const old = pin.station;
          const changed = pin.caption !== label.text || old.tier !== s.tier;
          pin.station = s;
          pin.caption = label.text;
          pin.runs = label.runs;
          pin.width = label.width;
          if (changed) pin.setRadius(Math.max(42, label.width / 2 + 4));
          if (old.lat !== s.lat || old.lng !== s.lng)
            pin.setLatLng([s.lat, s.lng]);
          else if (changed) pin.redraw();
        }
      }
      if (wasHeld) commitZoom();
    },
  };
}
