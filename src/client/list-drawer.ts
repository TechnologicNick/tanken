import { createDrawer, type DrawerOptions } from './drawer/controller.ts';

// This styling travels with the optional drawer asset, rather than initial CSS.
export function createStationListDrawer(root: HTMLElement, options: DrawerOptions) {
  if (!document.getElementById('station-list-styles')) {
    const style = document.createElement('style');
    style.id = 'station-list-styles';
    style.textContent = `@media(max-width:600px){
.map-ready #list-viewport{position:fixed;inset:0;display:flex;align-items:end;pointer-events:none;z-index:950}
.map-ready #list-viewport[data-expanded]{z-index:1001}
.map-ready #list-drawer{display:flex;flex-direction:column;position:relative;width:100%;height:100dvh;padding:18px 16px calc(12px + env(safe-area-inset-bottom));background:#f8f9f5;border-radius:20px 20px 0 0;pointer-events:auto}
#list-viewport[data-expanded] #list-drawer{border-radius:0;padding-top:calc(18px + env(safe-area-inset-top))}
#list-body{min-height:0;flex-shrink:0;height:calc(100% - var(--drawer-snap-point-offset,0px) - var(--drawer-swipe-movement-y,0px) - 15px);overflow-y:auto;overscroll-behavior:contain;transition:height calc(360ms * var(--drawer-swipe-strength,1)) cubic-bezier(.32,.72,0,1)}
#list-drawer[data-swiping] #list-body{transition:none}
@media(prefers-reduced-motion:reduce){#list-body{transition:none}}
#list-close{display:block;position:absolute;top:6px;right:8px;padding:3px 10px;background:transparent;color:var(--green);font-size:24px}
#list-viewport[data-expanded] #list-close{top:calc(6px + env(safe-area-inset-top))}
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
