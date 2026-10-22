import { createDrawer, type DrawerController, type DrawerOptions } from '../src/client/drawer.ts';
declare global {
  interface Window {
    drawers: Record<string, DrawerController>;
    configureDrawer(name: string, options: DrawerOptions): void;
    preventDrawerClose: boolean;
    drawerEvents: { name: string; open: boolean; reason: string }[];
  }
}
window.drawers = {};
window.drawerEvents = [];
window.preventDrawerClose = false;
window.configureDrawer = (name, options) => {
  window.drawers[name]?.destroy();
  window.drawers[name] = createDrawer(document.getElementById(name)!, {
    ...options,
    onOpenChange(open, details) {
      window.drawerEvents.push({ name, open, reason: details.reason });
      if (!open && window.preventDrawerClose) details.cancel();
    },
  });
};
for (const name of ['parent', 'child', 'grandchild', 'side']) window.configureDrawer(name, {});
window.configureDrawer('snap', { snapPoints: ['200px', '400px', 1] });
