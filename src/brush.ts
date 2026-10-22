// Brush coordinates use Leaflet's zoom-zero Web Mercator pixels, independent of view.
export type BrushStroke = { radius: number; points: [number, number][] };
export const brushQueryLimit = 96 * 1024;
export function parseBrush(raw: string | null): BrushStroke[] {
  if (!raw) return [];
  if (raw.length > brushQueryLimit) throw new Error("Ongeldig penseelgebied.");
  let strokes: any;
  try {
    strokes = JSON.parse(raw);
  } catch {
    throw new Error("Ongeldig penseelgebied.");
  }
  if (!Array.isArray(strokes) || strokes.length > 64)
    throw new Error("Ongeldig penseelgebied.");
  let count = 0;
  for (const s of strokes) {
    if (
      !s ||
      !Number.isFinite(s.radius) ||
      s.radius <= 0 ||
      s.radius > 8 ||
      !Array.isArray(s.points) ||
      s.points.length < 2
    )
      throw new Error("Ongeldig penseelgebied.");
    count += s.points.length;
    for (const p of s.points)
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every(Number.isFinite) ||
        p[0] < 0 ||
        p[0] > 256 ||
        p[1] < 0 ||
        p[1] > 256
      )
        throw new Error("Ongeldig penseelgebied.");
  }
  if (count > 2048) throw new Error("Ongeldig penseelgebied.");
  return strokes;
}
export function project(lat: number, lng: number): [number, number] {
  const sin = Math.sin(
    (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180,
  );
  return [
    ((lng + 180) / 360) * 256,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * 256,
  ];
}
export function unproject(x: number, y: number): [number, number] {
  return [
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 256))) * 180) / Math.PI,
    (x / 256) * 360 - 180,
  ];
}
// Extract closed portions, retaining loops even when the stroke continues afterwards.
// Overlapping brush ends also close a loop, so a hand-drawn circle need not meet exactly.
export function brushLoops(stroke: BrushStroke): [number, number][][] {
  const loops: [number, number][][] = [];
  function addLoop(points: [number, number][]) {
    const origin = points[0]!;
    const area = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length]!;
      return (
        sum +
        (p[0] - origin[0]) * (next[1] - origin[1]) -
        (next[0] - origin[0]) * (p[1] - origin[1])
      );
    }, 0);
    if (Math.abs(area) > 1e-18) loops.push(points);
  }
  let path: [number, number][] = [stroke.points[0]!];
  let leftStart = false;
  for (const next of stroke.points.slice(1)) {
    const a = path.at(-1)!;
    const dx = next[0] - a[0],
      dy = next[1] - a[1];
    let hit: { index: number; t: number; point: [number, number] } | undefined;
    for (let j = 0; j < path.length - 2; j++) {
      const c = path[j]!,
        d = path[j + 1]!,
        ex = d[0] - c[0],
        ey = d[1] - c[1];
      const cross = dx * ey - dy * ex;
      if (Math.abs(cross) < 1e-18) continue;
      const t = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / cross;
      const u = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / cross;
      if (t > 1e-9 && t <= 1 && u >= 0 && u <= 1 && (!hit || t < hit.t))
        hit = { index: j, t, point: [a[0] + t * dx, a[1] + t * dy] };
    }
    if (hit) {
      addLoop([hit.point, ...path.slice(hit.index + 1)]);
      path = [...path.slice(0, hit.index + 1), hit.point];
    }
    path.push(next);
    const start = path[0]!;
    const distance = Math.hypot(next[0] - start[0], next[1] - start[1]);
    if (distance > 2 * stroke.radius) leftStart = true;
    if (leftStart && path.length >= 3 && distance <= 2 * stroke.radius) {
      addLoop(path);
      path = [next];
      leftStart = false;
    }
  }
  return loops;
}
function inPolygon(x: number, y: number, polygon: [number, number][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!;
    if (
      a[1] > y !== b[1] > y &&
      x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function prepareBrush(strokes: BrushStroke[]) {
  const loops = strokes.flatMap(brushLoops);
  const segments = strokes.flatMap((s) =>
    s.points.slice(1).map((b, i) => {
      const a = s.points[i]!,
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      return {
        a,
        b,
        dx,
        dy,
        length: dx * dx + dy * dy,
        r: s.radius,
        west: Math.min(a[0], b[0]) - s.radius,
        east: Math.max(a[0], b[0]) + s.radius,
        north: Math.min(a[1], b[1]) - s.radius,
        south: Math.max(a[1], b[1]) + s.radius,
      };
    }),
  );
  const north = Math.min(...segments.map((s) => s.north)),
    south = Math.max(...segments.map((s) => s.south));
  const west = Math.min(...segments.map((s) => s.west)),
    east = Math.max(...segments.map((s) => s.east));
  const sw = unproject(west, south),
    ne = unproject(east, north);
  return {
    bounds: [sw[0], sw[1], ne[0], ne[1]] as [number, number, number, number],
    contains(lat: number, lng: number) {
      const [x, y] = project(lat, lng);
      return (
        loops.some((p) => inPolygon(x, y, p)) ||
        segments.some((s) => {
          if (x < s.west || x > s.east || y < s.north || y > s.south)
            return false;
          const t = s.length
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((x - s.a[0]) * s.dx + (y - s.a[1]) * s.dy) / s.length,
                ),
              )
            : 0;
          return (
            (x - s.a[0] - t * s.dx) ** 2 + (y - s.a[1] - t * s.dy) ** 2 <=
            s.r * s.r
          );
        })
      );
    },
  };
}
