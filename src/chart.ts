import { priceParts } from "./price.ts";

export function historyChart(data: {
  points: any[];
  gaps: number[];
  presence: any[];
  from: number;
  to: number;
}) {
  const gaps = new Set(data.gaps);
  const samples: { hour: number; value: number }[] = [];
  let index = -1,
    presenceIndex = -1,
    present = true;
  for (let hour = data.from; hour < data.to; hour++) {
    while (
      index + 1 < data.points.length &&
      data.points[index + 1].observed_hour <= hour
    )
      index++;
    while (
      presenceIndex + 1 < data.presence.length &&
      data.presence[presenceIndex + 1].observed_hour <= hour
    )
      present = data.presence[++presenceIndex].present;
    const p = data.points[index];
    if (present && p?.state === 0 && !gaps.has(hour))
      samples.push({ hour, value: Number(p.price_milli) });
  }
  if (!samples.length) return "<p>Geen bevestigde prijzen in deze periode.</p>";
  // Fit the available history, rather than squeezing a few observations into 30 days.
  const start = samples[0]!.hour,
    end = Math.max(start + 1, samples.at(-1)!.hour + 1);
  const minValue = Math.min(...samples.map((p) => p.value)),
    maxValue = Math.max(...samples.map((p) => p.value));
  const margin = Math.max(10, (maxValue - minValue) * 0.15),
    min = minValue - margin,
    max = maxValue + margin;
  const x = (h: number) => 76 + ((h - start) / (end - start)) * 380;
  const y = (v: number) => 176 - ((v - min) / (max - min)) * 140;
  let path = "";
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i]!,
      previous = samples[i - 1];
    path +=
      previous && p.hour === previous.hour + 1
        ? `H${x(p.hour).toFixed(1)}V${y(p.value).toFixed(1)}`
        : `M${x(p.hour).toFixed(1)},${y(p.value).toFixed(1)}`;
    path += `H${x(p.hour + 1).toFixed(1)}`;
  }
  const label = (h: number) =>
    new Date(h * 3600000).toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  const price = (v: number) => {
    const p = priceParts(Math.round(v), "EUR");
    return `${p.before.replace("€", "").trim()}<tspan font-size=".68em" dy="-3">${p.last}</tspan><tspan dy="3">${p.after}</tspan>`;
  };
  const ticks = [maxValue, ...(minValue === maxValue ? [] : [minValue])]
    .map(
      (v) =>
        `<line x1="76" x2="456" y1="${y(v)}" y2="${y(v)}" stroke="#dce3d7"/><text x="65" y="${y(v) + 4}" text-anchor="end">${price(v)}</text>`,
    )
    .join("");
  // A dot keeps an isolated observation visible; missing hours never get connected.
  const dots = samples
    .filter(
      (p, i) =>
        !samples[i - 1] ||
        samples[i - 1]!.hour !== p.hour - 1 ||
        !samples[i + 1] ||
        samples[i + 1]!.hour !== p.hour + 1 ||
        samples[i - 1]!.value !== p.value,
    )
    .map(
      (p) =>
        `<circle cx="${x(p.hour).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="currentColor"><title>${label(p.hour)}: ${(p.value / 1000).toFixed(3)}</title></circle>`,
    )
    .join("");
  return `<svg class="history-chart" viewBox="0 0 480 220" role="img" aria-label="Prijsverloop van ${label(start)} tot ${label(end)}; onderbrekingen betekenen ontbrekende waarnemingen"><title>Bevestigde prijswaarnemingen</title>${ticks}<path d="${path}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>${dots}<text x="76" y="207">${label(start)}</text><text x="456" y="207" text-anchor="end">${label(end)}</text></svg><p class="chart-note">${samples.length} bevestigde waarnemingsuren. Onderbrekingen zijn ontbrekende waarnemingen; punten zijn waargenomen prijzen.</p>`;
}
