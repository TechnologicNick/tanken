import { createDrawer, type DrawerOptions } from './drawer/controller.ts';

// This styling travels with the optional drawer asset, rather than initial CSS.
export function createStationDrawer(root: HTMLElement, options: DrawerOptions = {}) {
  if (!document.getElementById('station-list-styles')) {
    const style = document.createElement('style');
    style.id = 'station-list-styles';
    style.textContent = `@media(max-width:600px){
#list-viewport,#station-card-viewport{position:fixed;inset:0;width:100%;display:flex;align-items:end;pointer-events:none;z-index:950}
#list-viewport[data-expanded]{z-index:1001}
#station-card-viewport{z-index:1100}
#list-drawer,#station-card{display:flex;flex-direction:column;position:relative;width:100%;height:100dvh;max-height:none;padding:18px 16px clamp(0px,calc(var(--drawer-snap-point-offset,0px) + var(--drawer-swipe-movement-y,0px)),calc(100dvh - 100px));background:#f8f9f5;border-radius:20px 20px 0 0;pointer-events:auto}
[data-expanded] #list-drawer,[data-expanded] #station-card{border-radius:0;padding-top:calc(18px + env(safe-area-inset-top))}
#list-body,#station-card-body{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain}
#station-card-title{flex-shrink:0}
#station-card-content{display:flex;flex-direction:column;min-height:0;flex:1;overflow:hidden;overscroll-behavior:contain}
#list-drawer[data-nested-drawer-open],#station-card[data-nested-drawer-open]{height:var(--stack-height)}
@media(prefers-reduced-motion:reduce){#list-drawer,#station-card{transition:none}}
#list-close{display:block;position:absolute;top:6px;right:8px;padding:3px 10px;background:transparent;color:var(--green);font-size:24px}
[data-expanded] #list-close,[data-expanded] #station-card-close{top:calc(6px + env(safe-area-inset-top))}
#station-backdrop{display:none}
}`;
    document.head.append(style);
  }
  const viewport = root.querySelector<HTMLElement>('[data-slot="drawer-viewport"]')!;
  return createDrawer(root, {
    ...options,
    // The former 65vh opening height, reduced by 30%, plus a full-screen stop.
    snapPoints: [0.455, 1],
    defaultSnapPoint: 0.455,
    snapToSequentialPoints: true,
    onSnapPointChange(point, details) {
      options.onSnapPointChange?.(point, details);
      if (!details.isCanceled) viewport.toggleAttribute('data-expanded', point === 1);
    },
    onOpenChange(open, details) {
      options.onOpenChange?.(open, details);
      if (!details.isCanceled && !open) viewport.removeAttribute('data-expanded');
    },
  });
}
