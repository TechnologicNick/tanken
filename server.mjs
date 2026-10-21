import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { stationQuery } from './lib.mjs';

let local = {};
try { local = JSON.parse(await readFile(new URL('./.anwb-local.json', import.meta.url), 'utf8')); } catch {}
const clientId = process.env.ANWB_CLIENT_ID || local.clientId;
const apiKey = process.env.ANWB_API_KEY || local.apiKey;
const cache = new Map();
const pending = new Map();
const base = 'https://api.anwb.nl/routing/points-of-interest/v3/';

async function cached(key, ttl, request) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const promise = request().then(value => {
    if (cache.size >= 200) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

async function anwb(path) {
  if (!clientId || !apiKey) throw Object.assign(new Error('API-instellingen ontbreken. Zie README.md.'), { status: 503 });
  return cached(path, 120_000, async () => {
    const response = await fetch(base + path, { headers: {
      'x-anwb-client-id': clientId, APIKEY: apiKey, 'x-anwb-caller-id': 'onderweg-app/android', Accept: 'application/json',
    }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Object.assign(new Error(`ANWB geeft HTTP ${response.status}. Probeer later opnieuw.`), { status: 502 });
    return { ...await response.json(), retrievedAt: new Date().toISOString() };
  });
}

const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/manifest.webmanifest', ['public/manifest.webmanifest', 'application/manifest+json']],
  ['/icon.svg', ['public/icon.svg', 'image/svg+xml']],
  ['/vendor/leaflet.js', ['node_modules/leaflet/dist/leaflet.js', 'text/javascript']],
  ['/vendor/leaflet.css', ['node_modules/leaflet/dist/leaflet.css', 'text/css']],
]);
const server = http.createServer(async (req, res) => {
  const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    if (req.method !== 'GET') return json(405, { error: 'Alleen GET is toegestaan.' });
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/stations') {
      let query;
      try { query = stationQuery(url.searchParams); } catch (e) { return json(400, { error: e.message }); }
      return json(200, await anwb(`all?${query}`));
    }
    if (url.pathname === '/api/averages') return json(200, await anwb('fuel-prices'));
    if (url.pathname.startsWith('/api/stations/')) {
      const id = url.pathname.slice('/api/stations/'.length);
      if (!/^[\w-]{1,100}$/.test(id)) return json(400, { error: 'Ongeldig station.' });
      return json(200, await anwb(`details/FUEL_STATION/${id}`));
    }
    if (url.pathname === '/api/search') {
      const q = url.searchParams.get('q')?.trim();
      if (!q || q.length > 120) return json(400, { error: 'Vul een plaats of postcode in.' });
      const result = await cached(`search:${q}`, 3600_000, async () => {
        const upstream = new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
        upstream.search = new URLSearchParams({ q, rows: '5', fq: 'type:(woonplaats OR postcode OR adres)' });
        const r = await fetch(upstream, { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error('Zoeken is tijdelijk niet beschikbaar.');
        const data = await r.json();
        return data.response.docs.map(d => { const [lng, lat] = d.centroide_ll.match(/[\d.]+/g).map(Number); return { label: d.weergavenaam, lat, lng }; });
      });
      return json(200, result);
    }
    const file = files.get(url.pathname);
    if (!file) return json(404, { error: 'Niet gevonden.' });
    res.writeHead(200, { 'Content-Type': file[1], 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
    res.end(await readFile(new URL(file[0], import.meta.url)));
  } catch (e) { json(e.status || 502, { error: e.name === 'TimeoutError' ? 'De verbinding duurt te lang. Probeer opnieuw.' : e.message }); }
});
const port = Number(process.env.PORT || 3000);
server.listen(port, process.env.HOST || '0.0.0.0', () => {
  console.log(`Tanken: http://localhost:${port}`);
  for (const entries of Object.values(networkInterfaces())) for (const item of entries || []) if (item.family === 'IPv4' && !item.internal) console.log(`Op je telefoon (zelfde wifi): http://${item.address}:${port}`);
});
