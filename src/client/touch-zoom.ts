import type { Map as LeafletMap, LatLng } from "leaflet";

// The same continuous view updates as Leaflet 1.9.4's pinch handler.
type GestureMap = LeafletMap & {
  _moveStart(zoom: boolean, noMoveStart: boolean): void;
  _move(center: LatLng, zoom: number, data: { pinch: boolean; round: boolean }): void;
  _moveEnd(zoom: boolean): void;
};

export function doubleTapDragZoom(leaflet: LeafletMap) {
  const map = leaflet as GestureMap, container = map.getContainer();
  let first: { x: number; y: number; time: number; moved: boolean } | undefined,
    previous: { x: number; y: number; time: number } | undefined,
    gesture: {
      id: number; y: number; zoom: number; anchor: LatLng;
      offset: ReturnType<LeafletMap["getSize"]>;
      dragging: boolean; moved: boolean;
    } | undefined,
    frame = 0, nextZoom = 0, suppressClickUntil = 0;
  // Match Apple Maps on iOS; Google Maps uses the opposite direction.
  const direction = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? -1 : 1;

  function center(zoom: number) {
    return map.unproject(map.project(gesture!.anchor, zoom).subtract(gesture!.offset), zoom);
  }
  function update() {
    frame = 0;
    if (gesture?.moved) map._move(center(nextZoom), nextZoom, { pinch: true, round: false });
  }
  function finish(cancelled: boolean) {
    if (!gesture) return;
    cancelAnimationFrame(frame);
    frame = 0;
    const current = gesture;
    if (current.moved) {
      const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), Math.round(nextZoom)));
      map._move(center(zoom), zoom, { pinch: true, round: false });
      map._moveEnd(true);
    } else if (!cancelled) {
      map.setZoomAround(map.latLngToContainerPoint(current.anchor), Math.min(map.getMaxZoom(), current.zoom + 1));
    }
    gesture = undefined;
    if (current.dragging) map.dragging.enable();
    suppressClickUntil = Date.now() + 500;
  }
  function stop(event: TouchEvent) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function start(event: TouchEvent) {
    if (event.touches.length !== 1) {
      previous = first = undefined;
      finish(true);
      return;
    }
    if ((event.target as Element).closest(".leaflet-control, .leaflet-popup")) return;
    const touch = event.touches[0]!, now = Date.now();
    if (previous && now - previous.time < 300 &&
        Math.hypot(touch.clientX - previous.x, touch.clientY - previous.y) < 28) {
      map.stop();
      const point = map.mouseEventToContainerPoint(touch as unknown as MouseEvent);
      gesture = {
        id: touch.identifier, y: touch.clientY, zoom: map.getZoom(),
        anchor: map.containerPointToLatLng(point), offset: point.subtract(map.getSize().divideBy(2)),
        dragging: map.dragging.enabled(), moved: false,
      };
      nextZoom = gesture.zoom;
      map.dragging.disable();
      previous = first = undefined;
      stop(event);
    } else {
      previous = undefined;
      first = { x: touch.clientX, y: touch.clientY, time: now, moved: false };
    }
  }
  function move(event: TouchEvent) {
    if (!gesture) {
      const touch = event.touches[0];
      if (first && touch && Math.hypot(touch.clientX - first.x, touch.clientY - first.y) > 10)
        first.moved = true;
      return;
    }
    const touch = Array.from(event.touches).find(touch => touch.identifier === gesture!.id);
    if (!touch || event.touches.length !== 1) { finish(true); return; }
    stop(event);
    const delta = touch.clientY - gesture.y;
    if (!gesture.moved && Math.abs(delta) < 6) return;
    if (!gesture.moved) { gesture.moved = true; map._moveStart(true, false); }
    nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), gesture.zoom + direction * delta / 110));
    if (!frame) frame = requestAnimationFrame(update);
  }
  function end(event: TouchEvent) {
    if (gesture) { stop(event); finish(event.type === "touchcancel"); }
    else if (first) {
      if (event.type !== "touchcancel" && !first.moved && Date.now() - first.time < 250)
        previous = { x: first.x, y: first.y, time: Date.now() };
      first = undefined;
    }
  }
  function click(event: Event) {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }
  const options = { capture: true, passive: false };
  container.addEventListener("touchstart", start, options);
  document.addEventListener("touchmove", move, options);
  document.addEventListener("touchend", end, options);
  document.addEventListener("touchcancel", end, options);
  container.addEventListener("click", click, true);
  container.addEventListener("dblclick", click, true);
  const blur = () => { first = previous = undefined; finish(true); };
  window.addEventListener("blur", blur);
  map.on("unload", () => {
    blur();
    container.removeEventListener("touchstart", start, true);
    document.removeEventListener("touchmove", move, true);
    document.removeEventListener("touchend", end, true);
    document.removeEventListener("touchcancel", end, true);
    container.removeEventListener("click", click, true);
    container.removeEventListener("dblclick", click, true);
    window.removeEventListener("blur", blur);
  });
}
