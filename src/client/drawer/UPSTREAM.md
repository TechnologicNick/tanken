# Vanilla Base UI drawer port

Pinned upstream: [mui/base-ui at `74292641148d992ada69807559ececcb7d9dafb8`](https://github.com/mui/base-ui/tree/74292641148d992ada69807559ececcb7d9dafb8), whose React package declares version 1.9.0. MIT copyright and terms are preserved in `LICENSE.base-ui` and appended to the production drawer bundle.

The interaction code is vendored here, rather than approximating Base UI's gestures or wrapping React. The only runtime dependency is `@floating-ui/utils/dom`, also used by upstream. There is no React or React DOM dependency.

## Source correspondence

| Local file | Upstream source | Adaptation |
| --- | --- | --- |
| `swipe.ts` | `packages/react/src/utils/useSwipeDismiss.ts` | Algorithm body retained; imports and React state/ref/callback calls point to the local lifecycle adapter. |
| `viewport.ts` | `packages/react/src/drawer/viewport/DrawerViewport.tsx` | Touch arbitration, release decisions, snap selection, native capture listener, and nested swipe notifications retained. Context comes from an explicit argument; JSX becomes native event handlers. The return also exposes the calculated snap offset. The pending snap ref explicitly includes `undefined`. |
| `snapPoints.ts` | `packages/react/src/drawer/root/useDrawerSnapPoints.ts` | Resolution, clamping, duplicate-height handling, damping and measurement retained; context becomes an argument and the value resolver is exported. |
| `scrollable.ts`, `getElementAtPoint.ts`, `getElementTransform.ts` | Corresponding files in `packages/react/src/utils/` | Imports adapted only. |
| `shadowDom.ts` | `packages/utils/src/shadowDom.ts` | Unchanged implementation. |
| `popupCssVars.ts`, `popupDataAttributes.ts`, `backdropCssVars.ts` | Corresponding drawer part files | Shared transition attribute constants are defined locally. |

`lifecycle.ts` implements the small state/ref/memo/effect contract needed by those functions. It refreshes callbacks and runs imperative effects; it has no element renderer, virtual DOM or framework runtime. Updates are batched in microtasks, with synchronous flushes for pointer handlers and release styles. Disposal cancels effects and animation frames.

`controller.ts`, `context.ts`, `platform.ts` and `modal.ts` replace React context, DialogRoot, portals, presence and FloatingFocusManager with DOM lifecycle ownership. These are adaptations, not verbatim ports. Parent/child relationships survive portalling. A document-wide stack owns dismissal, focus trapping, original inert states and reference-counted scroll locking. Parents retain their measured height while children are present and receive descendant counts, frontmost height and live swipe progress. Child closing animations finish before the parent becomes interactive again. The nested stack CSS derives from upstream's nested drawer demo; appearance remains application-owned, as with Base UI.

## Usage

```ts
import { createDrawer } from './drawer.ts';

const parent = createDrawer(document.querySelector('#parent')!, {
  swipeDirection: 'down',
  onOpenChange(open, details) {
    // details.cancel() can reject either opening or closing.
  },
});
const child = createDrawer(document.querySelector('#child')!, {
  // Optional when #child starts inside the parent's popup.
  parent,
  snapPoints: ['200px', '400px', 1],
});
parent.open();
child.open();
child.close(); // Restores the parent, its scroll lock and previous focus.
parent.destroy(); // Also destroys descendants and restores original DOM state.
```

Each root uses `data-slot="drawer"`, containing `drawer-portal`, `drawer-backdrop`, `drawer-viewport`, `drawer-popup`, `drawer-title`, optional `drawer-description`, `drawer-content`, `drawer-trigger` and `drawer-close` parts. Backdrop, viewport and popup start hidden. Create ancestors before descendants or pass the explicit `parent` controller. The portal mounts into `document.body` by default. CSS supplies positioning and visual appearance; the lazy module supplies shared transitions and nested stack transforms. Keep a scrollable `drawer-content` flex child with `min-height: 0; overflow: auto`.

The controller provides `open`, `close`, `toggle`, `setSnapPoint`, `unmount`, `destroy`, and readonly `isOpen`, `snapPoint`, `triggerId`. Options include modal/non-modal/trap-focus, directions, snap points, sequential snapping, focus destinations, cancelable open/snap callbacks, completion callbacks, outside/Escape dismissal and portal container. `data-base-ui-swipe-ignore`, including its `x`/`y` variants, follows upstream arbitration. Mouse gestures leave content text selectable; touch gestures arbitrate content scrolling against drawer dismissal.

## Scope and verification

This is a port of the interaction core and DOM integration, not a claim of full Base UI API equivalence. React render props, contexts, controlled props, payload handles and the React actions/ref APIs are replaced by the controller. Optional swipe-to-open areas, page-indent providers and virtual-keyboard providers are not implemented. The current station drawer has no editable fields. Browser-native keyboard behavior remains in place.

`bun run test:drawer` runs isolated Chromium and WebKit scenarios for three-level nesting, nested pointer/touch dragging, parent progress, focus restoration, background inertness, scroll ownership, all four directions, snap sizes/reset, canceled swipes, interrupted transitions and ancestor destruction. `bun run test:touch` verifies actual Chromium touch injection and equivalent synthetic events in Windows WebKit, including station content scrolling and dismissal. `bun run test:browser` checks the application, both card origins, desktop behavior and offline caching.

Windows WebKit is not physical Safari on iOS 17. Device testing is still needed before claiming exact iOS gesture/keyboard parity. Future updates should diff the pinned upstream algorithm bodies and rerun all three browser suites; avoid independently tuning their gesture thresholds.
