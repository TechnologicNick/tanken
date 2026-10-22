// Isolated browser fixture: no database, map or production debug endpoints.
export {};
const built = await Bun.build({ entrypoints: ['scripts/drawer-fixture-client.ts'], target: 'browser', format: 'esm' });
if (!built.success) throw new AggregateError(built.logs);
const script = await built.outputs[0].text();
const drawer = (id: string, child = ''): string => `<div id="${id}" data-slot="drawer">
  <button id="${id}-trigger" data-slot="drawer-trigger">Open ${id}</button>
  <div data-slot="drawer-portal">
    <div data-slot="drawer-backdrop" hidden></div>
    <div data-slot="drawer-viewport" hidden><section id="${id}-popup" data-slot="drawer-popup" hidden>
      <div id="${id}-handle" class="handle">Drag ${id}</div>
      <h2 data-slot="drawer-title">${id}</h2>
      <button id="${id}-close" data-slot="drawer-close">Close ${id}</button>
      <div id="${id}-content" data-slot="drawer-content" tabindex="0" aria-label="${id} content">
        <input aria-label="${id} input"><button id="${id}-ignore" data-base-ui-swipe-ignore>Ignored</button>
        <input type="range" aria-label="${id} range">
        ${child}<div class="spacer">Scrollable text</div>
      </div>
    </section></div>
  </div>
</div>`;
const html = `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui}button{min-height:36px}
[hidden]{display:none!important}[data-slot=drawer-backdrop]{position:fixed;inset:0;background:#0003}
[data-slot=drawer-viewport]{position:fixed;inset:0;display:flex;align-items:end;pointer-events:none}
[data-slot=drawer-popup]{position:relative;display:flex;flex-direction:column;width:100%;height:520px;max-height:85dvh;background:white;padding:12px;pointer-events:auto;border-radius:16px 16px 0 0}
[data-slot=drawer-content]{overflow:auto;min-height:0;overscroll-behavior:contain}.handle{flex-shrink:0;height:40px;cursor:grab;background:#ddd}.spacer{height:1200px}
[data-swipe-direction=left][data-slot=drawer-popup],[data-swipe-direction=right][data-slot=drawer-popup]{width:300px;height:100%;max-height:100dvh}
[data-swipe-direction=right][data-slot=drawer-viewport]{justify-content:end}
[data-swipe-direction=up][data-slot=drawer-viewport]{align-items:start}
</style><button id="outside">Outside</button>${drawer('parent', drawer('child', drawer('grandchild')))}${drawer('snap')}${drawer('side')}
<script type="module" src="/fixture.js"></script></html>`;
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request) {
  return new URL(request.url).pathname === '/fixture.js' ? new Response(script, { headers: { 'content-type': 'text/javascript' } }) : new Response(html, { headers: { 'content-type': 'text/html' } });
} });
console.log(JSON.stringify({ ready: server.url.href }));
for await (const _ of Bun.stdin.stream()) break;
server.stop(true);
