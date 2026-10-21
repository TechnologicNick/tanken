/* global L */
window.addEventListener('load', () => {
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3 }).format(value);
const names = { EURO95: 'Benzine · E10', DIESEL: 'Diesel · B7', EURO98: 'Euro 98 · E5', AUTOGAS: 'LPG', DIESEL_SPECIAL: 'Premium diesel', CNG: 'CNG' };
let saved = {};
try { saved = JSON.parse(localStorage.getItem('tanken') || '{}'); } catch {}
let fuel = names[saved.fuel] ? saved.fuel : 'EURO95';
const validCenter = Array.isArray(saved.center) && saved.center.length === 2 && saved.center.every(Number.isFinite) && Math.abs(saved.center[0]) < 85 && Math.abs(saved.center[1]) < 180;
const map = L.map('map', { zoomControl: false, minZoom: 7, maxZoom: 18 }).setView(validCenter ? saved.center : [52.09, 5.12], Number.isFinite(saved.zoom) ? Math.max(7, Math.min(18, saved.zoom)) : 12);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Prijzen: ANWB' }).addTo(map);
const markers = L.layerGroup().addTo(map);
let stations = [], requestId = 0, detailId = 0, loadedBounds = '', loadedFuel = '', locationMarker, averages = [], searchId = 0;
let controller;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function api(path, signal) { const r = await fetch(path, { signal }); const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Ophalen mislukt.'); return data; }
function boundsKey() { const b = map.getBounds(); return [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(n => n.toFixed(4)).join(','); }
function persist() { try { const c = map.getCenter(); localStorage.setItem('tanken', JSON.stringify({ fuel, center: [c.lat, c.lng], zoom: map.getZoom() })); } catch {} }
function distance(s) { return map.getCenter().distanceTo([s.coordinates.latitude, s.coordinates.longitude]) / 1000; }
function price(s) { return s.prices?.find(p => p.fuelType === fuel && Number.isFinite(p.value) && p.value > 0); }
function updateFuel() {
  document.querySelectorAll('[data-fuel]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fuel === fuel)));
  $('more-fuel').value = ['EURO95', 'DIESEL'].includes(fuel) ? '' : fuel;
  $('more-fuel').classList.toggle('active', !['EURO95', 'DIESEL'].includes(fuel));
  $('map-label').textContent = names[fuel] + ' · prijs ' + (fuel === 'CNG' ? 'per kg' : 'per liter');
}
function render() {
  markers.clearLayers();
  const visible = stations.filter(s => s.coordinates && price(s));
  visible.sort((a, b) => $('sort').value === 'distance' ? distance(a) - distance(b) : price(a).value - price(b).value || distance(a) - distance(b));
  const lowest = Math.min(...visible.map(s => price(s).value));
  $('count').textContent = `${visible.length} tankstation${visible.length === 1 ? '' : 's'}`;
  $('stations').replaceChildren();
  for (const s of visible) {
    const p = price(s), best = p.value === lowest, address = [s.address?.streetAddress, s.address?.city].filter(Boolean).join(', ');
    const card = document.createElement('button'); card.className = 'station' + (best ? ' best' : '');
    card.innerHTML = `<span class="brand">${escapeHtml(s.title?.slice(0, 2).toUpperCase())}</span><span class="info">${best ? '<span class="best-label">LAAGSTE OP DE KAART</span>' : ''}<strong>${escapeHtml(s.title)}</strong><span class="address">${escapeHtml(address)}</span></span><span class="price">${money(p.value)}<small>${distance(s).toFixed(1).replace('.', ',')} km van kaartmidden</small></span>`;
    card.onclick = () => showDetails(s);
    $('stations').append(card);
    const marker = L.marker([s.coordinates.latitude, s.coordinates.longitude], { icon: L.divIcon({ className: 'pin', iconSize: [76, 32], iconAnchor: [38, 16], html: `<div class="pin-label tier-${Number(p.priceTier?.value) || 2}${best ? ' cheapest' : ''}">${money(p.value)}</div>` }), zIndexOffset: best ? 1000 : 0 }).addTo(markers);
    const popup = document.createElement('div');
    popup.innerHTML = `<strong>${escapeHtml(s.title)}</strong><br>${escapeHtml(address)}<br><b>${money(p.value)}</b> · ${escapeHtml(names[fuel])}<br><button class="popup-details">Bekijk tankstation →</button>`;
    popup.querySelector('button').onclick = () => showDetails(s); marker.bindPopup(popup);
  }
  if (!visible.length) status('Geen stations met een bekende prijs gevonden. Verplaats de kaart of kies een andere brandstof.');
}
async function loadStations() {
  const id = ++requestId;
  controller?.abort(); controller = new AbortController();
  const bounds = boundsKey(), selectedFuel = fuel;
  if (map.getZoom() < 10) { stations = []; render(); status('Zoom verder in om tankstations te bekijken.'); $('refresh').disabled = false; return; }
  status('Actuele prijzen ophalen…'); $('refresh').disabled = true;
  try {
    const data = await api(`/api/stations?${new URLSearchParams({ bounds, fuel: selectedFuel })}`, controller.signal);
    if (id !== requestId) return;
    stations = data.value || []; loadedBounds = bounds; loadedFuel = selectedFuel;
    status(''); render();
    if (data.totalResults > stations.length) status('Er zijn meer stations in dit gebied. Zoom in voor een volledig overzicht.');
    const average = averages.find(a => a.type === fuel);
    $('area-label').textContent = average ? `Landelijk gemiddelde: ${money(average.price)}` : 'In dit kaartgebied';
    $('updated').textContent = `Opgehaald om ${new Date(data.retrievedAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })} · bron: ANWB`;
    $('refresh').textContent = '↻ Vernieuw prijzen'; persist();
  } catch (e) { if (e.name !== 'AbortError' && id === requestId) { stations = []; render(); status(e.message, true); $('count').textContent = 'Ophalen mislukt'; } }
  finally { if (id === requestId) $('refresh').disabled = false; }
}
async function showDetails(station) {
  const id = ++detailId;
  $('detail-content').innerHTML = '<p>Tankstation laden…</p>';
  if (!$('details').open) $('details').showModal();
  try {
    const { value: s } = await api(`/api/stations/${encodeURIComponent(station.id)}`);
    if (id !== detailId || !$('details').open) return;
    const days = { MONDAY: 'ma', TUESDAY: 'di', WEDNESDAY: 'wo', THURSDAY: 'do', FRIDAY: 'vr', SATURDAY: 'za', SUNDAY: 'zo' };
    const address = [s.address?.streetAddress, s.address?.postalCode, s.address?.city].filter(Boolean).join(', ');
    const nav = `https://maps.apple.com/?daddr=${s.coordinates.latitude},${s.coordinates.longitude}&dirflg=d`;
    $('detail-content').innerHTML = `<div class="eyebrow">TANKSTATION</div><h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(address)}</p><div class="detail-prices">${(s.prices || []).filter(p => p.value > 0).map(p => `<div><span>${escapeHtml(p.fuelName)}</span><strong>${money(p.value)}</strong></div>`).join('')}</div><h3>Openingstijden</h3><div class="hours">${(s.openingHours || []).map(h => `${(h.dayOfWeek || []).map(d => days[d] || escapeHtml(d)).join(', ')}: ${escapeHtml(h.opens)} – ${escapeHtml(h.closes)}`).join('<br>') || 'Niet bekend'}</div><p class="facilities">${(s.facilities || []).map(f => `<span>${escapeHtml(f.name)}</span>`).join('')}</p><a class="navigate" href="${nav}" target="_blank" rel="noopener">Navigeer met Apple Kaarten ↗</a><p>Bron: ANWB. De prijs aan de pomp is leidend. De API geeft geen tijdstip van de laatste prijswijziging.</p>`;
  } catch (e) { if (id === detailId) $('detail-content').textContent = e.message; }
}
$('details').addEventListener('close', () => ++detailId);
$('close-details').onclick = () => $('details').close();
$('details').addEventListener('click', e => { if (e.target === $('details') && (e.clientX < $('details').getBoundingClientRect().left || e.clientX > $('details').getBoundingClientRect().right || e.clientY < $('details').getBoundingClientRect().top || e.clientY > $('details').getBoundingClientRect().bottom)) $('details').close(); });
document.querySelectorAll('[data-fuel]').forEach(b => b.onclick = () => { fuel = b.dataset.fuel; updateFuel(); loadStations(); });
$('more-fuel').onchange = e => { if (e.target.value) { fuel = e.target.value; updateFuel(); loadStations(); } };
$('sort').onchange = render;
$('refresh').onclick = loadStations;
map.on('moveend', () => { if (boundsKey() !== loadedBounds || fuel !== loadedFuel) { $('refresh').textContent = '↻ Zoek in dit gebied'; if (stations.length) status('Kaart verplaatst. Zoek opnieuw voor prijzen in dit gebied.'); } persist(); });
$('locate').onclick = () => {
  if (!navigator.geolocation) return status('Je browser ondersteunt geen locatie. Zoek op plaats of postcode.', true);
  status('Je locatie bepalen…');
  navigator.geolocation.getCurrentPosition(pos => {
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    locationMarker?.remove(); locationMarker = L.circleMarker(latlng, { radius: 8, color: '#fff', fillColor: '#347dbb', fillOpacity: 1, weight: 3 }).addTo(map);
    map.setView(latlng, 13); loadStations();
  }, () => status('Locatie niet beschikbaar. Gebruik HTTPS voor locatie op je telefoon, of zoek op plaats of postcode.', true), { timeout: 10000, maximumAge: 60000 });
};
$('search-form').onsubmit = async e => {
  e.preventDefault(); const id = ++searchId; $('search-results').textContent = 'Zoeken…';
  try {
    const results = await api(`/api/search?${new URLSearchParams({ q: $('search').value })}`);
    if (id !== searchId) return;
    $('search-results').replaceChildren();
    if (!results.length) $('search-results').textContent = 'Geen locatie gevonden.';
    for (const result of results) {
      const button = document.createElement('button'); button.textContent = result.label;
      button.onclick = () => { $('search-results').replaceChildren(); $('search').value = result.label; map.setView([result.lat, result.lng], 13); loadStations(); $('search').blur(); };
      $('search-results').append(button);
    }
  } catch (e) { if (id === searchId) $('search-results').textContent = e.message; }
};
$('mobile-toggle').onclick = () => { const showing = document.body.classList.toggle('show-map'); $('mobile-toggle').textContent = showing ? 'Bekijk tankstations ☰' : 'Bekijk kaart ↗'; map.invalidateSize(); };
updateFuel();
api('/api/averages').then(data => { averages = data.value || []; const average = averages.find(a => a.type === fuel); if (average) $('area-label').textContent = `Landelijk gemiddelde: ${money(average.price)}`; }).catch(() => {});
requestAnimationFrame(() => { map.invalidateSize(); loadStations(); });
});
