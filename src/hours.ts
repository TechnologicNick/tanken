const days = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
const labels = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
const minutes = (v: unknown) =>
  typeof v === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(v)
    ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3))
    : null;
const clock = (v: number) =>
  `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
export function openingHours(hours: any[]) {
  if (!hours?.length) return "<p>Openingstijden niet bekend.</p>";
  const intervals: [number, number][][] = days.map(() => []);
  const known = new Set<number>();
  for (const h of hours) {
    const start = minutes(h.opens),
      end = minutes(h.closes);
    for (const day of Array.isArray(h.dayOfWeek) ? h.dayOfWeek : []) {
      const i = days.indexOf(day);
      if (i < 0 || start === null || end === null) continue;
      known.add(i);
      if (start === end) continue;
      if (end > start) intervals[i]!.push([start, end]);
      else {
        intervals[i]!.push([start, 1440]);
        intervals[(i + 1) % 7]!.push([0, end]);
      }
    }
  }
  const today = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Amsterdam",
      weekday: "short",
    }).format(new Date()),
  );
  return `<div class="opening-hours"><div class="hours-axis" aria-hidden="true"><span>00</span><span>12</span><span>24</span></div><ol>${days
    .map((_, i) => {
      const merged: [number, number][] = [];
      for (const interval of intervals[i]!.sort((a, b) => a[0] - b[0])) {
        const prev = merged.at(-1);
        if (prev && prev[1] >= interval[0])
          prev[1] = Math.max(prev[1], interval[1]);
        else merged.push([...interval]);
      }
      const text = merged.length
        ? merged
            .map(([a, b]) =>
              a === 0 && b === 1440 ? "24 uur open" : `${clock(a)}–${clock(b)}`,
            )
            .join(", ")
        : known.has(i)
          ? "Gesloten"
          : "Niet bekend";
      return `<li${i === today ? ' class="today"' : ""}><span>${labels[i]}</span><div class="hours-track" aria-hidden="true">${merged.map(([a, b]) => `<i style="left:${a / 14.4}%;width:${(b - a) / 14.4}%"></i>`).join("")}</div><span>${text}</span></li>`;
    })
    .join("")}</ol></div>`;
}
