export const fuels = new Set(['EURO95', 'EURO98', 'DIESEL', 'DIESEL_SPECIAL', 'AUTOGAS', 'CNG']);

export function stationQuery(params) {
  const fuel = params.get('fuel') || 'EURO95';
  if (!fuels.has(fuel)) throw new Error('Onbekende brandstof.');
  const parts = (params.get('bounds') || '').split(',');
  const bounds = parts.map(Number);
  if (parts.length !== 4 || parts.some(p => !p.trim()) || bounds.some(n => !Number.isFinite(n))) throw new Error('Ongeldige kaartgrenzen.');
  const [south, west, north, east] = bounds;
  if (south < -85 || north > 85 || west < -180 || east > 180 || south >= north || west >= east) throw new Error('Ongeldige kaartgrenzen.');
  if (north - south > 1.5 || east - west > 2.5) throw new Error('Zoom verder in om tankstations te bekijken.');
  return new URLSearchParams({ 'type-filter': 'FUEL_STATION', 'bounding-box-filter': bounds.join(','), 'fuel-types-filter': fuel });
}
