import type { DrawerController } from './drawer.ts';

export function stationList(drawerAsset: string) {
  const root = document.getElementById('list-panel')!;
  const popup = document.getElementById('list-drawer')!;
  const viewport = document.getElementById('list-viewport')!;
  const toggle = document.getElementById('mobile-toggle')!;
  const closeButton = document.getElementById('list-close')!;
  const mobile = matchMedia('(max-width: 600px)');
  let drawer: DrawerController | undefined;
  let library: Promise<typeof import('./drawer.ts')> | undefined;
  let desired = false;
  let revision = 0;
  document.body.classList.add('map-ready');
  toggle.hidden = false;
  function sync() {
    document.body.classList.toggle('list-open', desired && mobile.matches);
    toggle.setAttribute('aria-expanded', String(desired));
    toggle.setAttribute('aria-controls', popup.id);
    toggle.textContent = 'Bekijk tankstations';
  }
  function clearFallback() {
    viewport.style.cssText = closeButton.style.cssText = '';
  }
  async function show(show: boolean) {
    desired = show;
    const id = ++revision;
    sync();
    if (!mobile.matches) return;
    if (!show) { clearFallback(); drawer?.close(); return; }
    try {
      const { createStationListDrawer }: typeof import('./drawer.ts') = await (library ||= import(drawerAsset));
      if (!desired || id !== revision || !mobile.matches) return;
      clearFallback();
      drawer ||= createStationListDrawer(root, {
        modal: false,
        initialFocus: false,
        disablePointerDismissal: true,
        finalFocus: toggle,
        onOpenChange(open) { desired = open; sync(); },
      });
      drawer.open('mobile-toggle');
    } catch {
      library = undefined;
      if (!desired || id !== revision || !mobile.matches) return;
      // Keep the SSR list accessible if the optional offline asset isn't cached.
      viewport.hidden = popup.hidden = false;
      viewport.style.cssText = 'position:fixed;inset:auto 0 0;z-index:950;max-height:45.5dvh;overflow:auto;background:#f8f9f5;padding:16px 16px 0';
      closeButton.style.display = 'block';
    }
  }
  toggle.addEventListener('click', () => { void show(!desired); });
  closeButton.addEventListener('click', () => {
    if (!drawer?.isOpen) void show(false);
  });
  mobile.addEventListener('change', () => {
    ++revision;
    clearFallback();
    drawer?.destroy(); drawer = undefined;
    viewport.hidden = popup.hidden = false;
    desired = false; sync();
  });
  sync();
  return {
    show,
    async parent() {
      if (!mobile.matches || !desired) return;
      await show(true);
      return drawer;
    },
  };
}
