const formats = new Map<string, Intl.NumberFormat>();
export function priceParts(amount: number, currency = "EUR") {
  if (!formats.has(currency))
    formats.set(
      currency,
      new Intl.NumberFormat("nl-NL", {
        style: "currency",
        currency,
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
    );
  const parts = formats.get(currency)!.formatToParts(amount / 1000);
  const fraction = parts.findIndex((p) => p.type === "fraction");
  return {
    before:
      parts
        .slice(0, fraction)
        .map((p) => p.value)
        .join("") + parts[fraction]!.value.slice(0, -1),
    last: parts[fraction]!.value.slice(-1),
    after: parts
      .slice(fraction + 1)
      .map((p) => p.value)
      .join(""),
  };
}
export function priceHTML(amount: number, currency = "EUR") {
  const p = priceParts(amount, currency);
  return `<span class="money">${p.before}<sup class="price-last">${p.last}</sup>${p.after}</span>`;
}
