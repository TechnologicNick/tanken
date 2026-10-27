import type { StationListDrawer } from './list-drawer.ts';

export function stationList(drawerAsset: string) {
  const root = document.getElementById('list-panel')!;
  const popup = document.getElementById('list-drawer')!;
  const viewport = document.getElementById('list-viewport')!;
  const mobile = matchMedia('(max-width: 600px)');
  let drawer: StationListDrawer | undefined;
  let library: Promise<typeof import('./drawer.ts')> | undefined;
  let revision = 0;
  document.body.classList.add('map-ready');
  function clearFallback() {
    viewport.style.cssText = '';
  }
  async function show(expand: boolean) {
    if (!mobile.matches) return;
    if (drawer) {
      if (!expand) drawer.setSnapPoint(drawer.compactSnapPoint);
      return;
    }
    const id = ++revision;
    popup.toggleAttribute('data-compact', true);
    try {
      const { createStationListDrawer }: typeof import('./drawer.ts') = await (library ||= import(drawerAsset));
      if (id !== revision || !mobile.matches) return;
      // The persistent drawer can load before the first worker controls the page.
      // Ask the worker to retain this mobile-only asset once it becomes ready.
      if ('serviceWorker' in navigator)
        void navigator.serviceWorker.ready.then(registration => registration.active?.postMessage({ type: 'drawer' }));
      clearFallback();
      drawer = createStationListDrawer(root, {
        defaultOpen: true,
        modal: false,
        initialFocus: false,
        disablePointerDismissal: true,
        finalFocus: false,
        onOpenChange(open, details) {
          if (!open) {
            details.cancel();
            drawer?.setSnapPoint(drawer.compactSnapPoint);
          }
        },
      });
    } catch {
      library = undefined;
      if (id !== revision || !mobile.matches) return;
      // Keep the SSR preview accessible if the optional offline asset is absent.
      viewport.hidden = popup.hidden = false;
      viewport.style.cssText = 'position:fixed;inset:auto 0 0;z-index:950;height:var(--list-peek-height,200px);overflow:auto;background:#f8f9f5';
    }
  }
  mobile.addEventListener('change', () => {
    ++revision;
    clearFallback();
    drawer?.destroy(); drawer = undefined;
    viewport.hidden = popup.hidden = false;
    popup.removeAttribute('data-compact');
    popup.querySelector<HTMLElement>('.list-summary')!.inert = false;
    if (mobile.matches) void show(false);
  });
  const ready = show(false);
  return {
    show,
    ready,
    async parent() {
      if (!mobile.matches) return;
      await show(true);
      return drawer;
    },
  };
}
