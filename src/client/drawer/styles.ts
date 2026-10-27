// Direct CSS translation of shadcn/ui's Base UI drawer, pinned in UPSTREAM.md.
// Position, colors, sizes and scroll containers remain consumer-owned.
export const drawerStyles = `
[data-native-drawer]{--bleed:3rem;--peek:1rem;--stack-step:.05;--stack-height:var(--drawer-frontmost-height,var(--drawer-height,0px));--stack-progress:clamp(0,var(--drawer-swipe-progress),1);--stack-peek-offset:max(0px,calc((var(--nested-drawers) - var(--stack-progress))*var(--peek)));--stack-scale-base:max(0,calc(1 - var(--nested-drawers)*var(--stack-step)));--stack-scale:clamp(0,calc(var(--stack-scale-base) + var(--stack-step)*var(--stack-progress)),1);--stack-shrink:calc(1 - var(--stack-scale));transform:translate3d(var(--translate-x,0px),var(--translate-y,0px),0) scale(var(--stack-scale));transition-property:transform,height,opacity,filter,padding-bottom;transition-duration:450ms;transition-timing-function:cubic-bezier(.22,1,.36,1);will-change:transform;outline:none;user-select:none;interpolate-size:allow-keywords}
[data-native-drawer][data-swipe-direction=down]{transform-origin:bottom;--closed-transform:translate3d(0,calc(100% + var(--drawer-inset,0px) + 2px),0);--translate-y:calc(var(--drawer-snap-point-offset) + var(--drawer-swipe-movement-y) - var(--stack-peek-offset) - var(--stack-shrink)*var(--stack-height))}
[data-native-drawer][data-swipe-direction=up]{transform-origin:top;--closed-transform:translate3d(0,calc(-100% - var(--drawer-inset,0px) - 2px),0);--translate-y:calc(var(--drawer-snap-point-offset) + var(--drawer-swipe-movement-y) + var(--stack-peek-offset) + var(--stack-shrink)*var(--stack-height))}
[data-native-drawer][data-swipe-direction=left]{transform-origin:left;--closed-transform:translate3d(calc(-100% - var(--drawer-inset,0px) - 2px),0,0);--translate-x:calc(var(--drawer-swipe-movement-x) + var(--stack-peek-offset) + var(--stack-shrink)*100%)}
[data-native-drawer][data-swipe-direction=right]{transform-origin:right;--closed-transform:translate3d(calc(100% + var(--drawer-inset,0px) + 2px),0,0);--translate-x:calc(var(--drawer-swipe-movement-x) - var(--stack-peek-offset) - var(--stack-shrink)*100%)}
[data-native-drawer][data-nested-drawer-open]{overflow:hidden;filter:brightness(.95)}
[data-native-drawer][data-swipe-axis=y][data-nested-drawer-open]{height:var(--stack-height)}
[data-native-drawer]:is([data-starting-style],[data-ending-style]){transform:var(--closed-transform)}
[data-native-drawer]:is([data-swiping],[data-nested-drawer-swiping]){transition-duration:0s}
[data-native-drawer][data-ending-style]{opacity:.9999;transition-duration:calc(var(--drawer-swipe-strength)*400ms)}
[data-native-drawer]::after{content:'';position:absolute;pointer-events:none;background:var(--drawer-bleed-background,var(--color-popover,#f8f9f5))}
[data-native-drawer][data-swipe-axis=y]::after{inset-inline:0;height:var(--bleed)}
[data-native-drawer][data-swipe-axis=x]::after{inset-block:0;width:var(--bleed)}
[data-native-drawer][data-swipe-direction=down]::after{top:100%}
[data-native-drawer][data-swipe-direction=up]::after{bottom:100%}
[data-native-drawer][data-swipe-direction=left]::after{right:100%}
[data-native-drawer][data-swipe-direction=right]::after{left:100%}
[data-native-drawer]>[data-slot=drawer-content]{transition:opacity 300ms cubic-bezier(.45,1.005,0,1.005);user-select:text}
[data-native-drawer]>[data-slot=drawer-swipe-handle]{position:relative;z-index:10;flex-shrink:0;cursor:grab;transition:opacity 200ms}
[data-native-drawer]>[data-slot=drawer-close]{transition:opacity 200ms}
[data-native-drawer]>[data-slot=drawer-swipe-handle]:active{cursor:grabbing}
[data-native-drawer]:is([data-swipe-direction=left],[data-swipe-direction=up])>[data-slot=drawer-swipe-handle]{order:9999}
[data-native-drawer][data-nested-drawer-open]>:is([data-slot=drawer-content],[data-slot=drawer-swipe-handle],[data-slot=drawer-close]){opacity:0}
[data-native-drawer][data-nested-drawer-swiping]>:is([data-slot=drawer-content],[data-slot=drawer-swipe-handle],[data-slot=drawer-close]){opacity:1}
[data-native-drawer][data-swiping]>[data-slot=drawer-content]{user-select:none}
[data-native-drawer-backdrop]{opacity:max(var(--drawer-overlay-min-opacity,0),calc(1 - var(--drawer-swipe-progress,0)));transition:opacity 450ms cubic-bezier(.32,.72,0,1)}
[data-native-drawer-backdrop][data-snap-points]{--drawer-overlay-min-opacity:.5}
[data-native-drawer-backdrop][data-swiping]{transition-duration:0s}
[data-native-drawer-backdrop]:is([data-starting-style],[data-ending-style]){opacity:0}
[data-native-drawer-backdrop][data-ending-style]{pointer-events:none;transition-duration:calc(var(--drawer-swipe-strength,1)*400ms)}
@media(prefers-reduced-motion:reduce){:is([data-native-drawer],[data-native-drawer-backdrop]){transition:none!important}}
`;
