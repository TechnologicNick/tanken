# Vanilla Base UI drawer port

Pinned upstream: [mui/base-ui at `74292641148d992ada69807559ececcb7d9dafb8`](https://github.com/mui/base-ui/tree/74292641148d992ada69807559ececcb7d9dafb8), whose React package declares version 1.9.0. MIT copyright and terms are preserved in `LICENSE.base-ui` and appended to the production drawer bundle.

Pinned visual implementation: [shadcn/ui's Base UI drawer at `96da9cc7f1aa10580a3741664e2a77c721206c00`](https://github.com/shadcn-ui/ui/blob/96da9cc7f1aa10580a3741664e2a77c721206c00/apps/v4/registry/bases/base/ui/drawer.tsx), as used by its nested drawer example. Its MIT notice is preserved in `LICENSE.shadcn`; the distributed bundle includes both copyrights and their shared MIT terms.

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
| `nesting.ts` | `DrawerRoot.tsx` nested state, height/presence handlers, swipe notifications and progress store | React setters become assignments and an explicit update callback. Progress normalization and propagation follow the source; CSS clamps visual progress. |
| `controller.ts` measurement and parent notifications | `DrawerPopup.tsx` measurement and layout effects | Retains measured height while children are present, guards stretched measurements, forwards frontmost height only while open, and retains presence through the ending transition. Effect dependencies and cleanup become deduplicated DOM notifications. |
| `styles.ts` | shadcn Base UI `drawer.tsx`, popup, content, handle and overlay classes | Tailwind utilities become CSS selectors. Stack formulas remain active even without children; all four directions, 450ms opening easing, strength-scaled 400ms exits, height/brightness transitions, content/handle fading and bleed follow the reference. |

`lifecycle.ts` implements the small state/ref/memo/effect contract needed by those functions. It refreshes callbacks and runs imperative effects; it has no element renderer, virtual DOM or framework runtime. Updates are batched in microtasks, with synchronous flushes for pointer handlers and release styles. Disposal cancels effects and animation frames.

The controller also batches nested root notifications into one microtask, matching React's event batching. In particular, release progress and the nested-swiping flag must reach the DOM together: a height measurement between those changes would flush the reset transform while transitions are disabled, making the parent jump instead of settling with the reference easing.

`controller.ts`, `context.ts`, `platform.ts` and `modal.ts` replace React context, DialogRoot, portals, presence and FloatingFocusManager with DOM lifecycle ownership. These integration layers are adaptations, not verbatim ports. Parent/child relationships survive portalling. A document-wide stack owns dismissal, focus trapping, original inert states and reference-counted scroll locking. Nested state and transitions follow the pinned sources rather than independently tuned behavior. Open descendant count and ending-child presence are separate, as upstream.

Application configuration remains in `list-drawer.ts`: nonmodal drawers, colors, viewport positioning and scroll regions. Station details retain their 45.5% and full-height snap points. The persistent mobile stations list adds a measured compact snap point showing the fuel pills, first row and 24px of the next row. Dismissal is canceled through the public open/snap callbacks, settling at that compact point; the vendored gesture algorithm is unchanged. A ResizeObserver follows the visible drawer height during dragging and settling. Crossing the midpoint between the compact and 45.5% positions starts a CSS grid/opacity transition for the count and sorting controls; crossing back hides them. Hidden controls are inert, and the observer disconnects when the drawer is destroyed. Padding compensates for the translated full-height panel, following the same transition duration/easing; it adds no visible bottom gap. The station title and body share the reference content wrapper so they fade together. The handle and application close button stay outside it and share the handle's 200ms nested-state opacity transition. Reduced-motion support is retained. The optional drawer has a 17 KiB gzip ceiling. Mobile loads it for the persistent list and explicitly asks the service worker to cache it after activation; desktop still loads it only when needed.

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

Each root uses `data-slot="drawer"`, containing `drawer-portal`, `drawer-backdrop`, `drawer-viewport`, `drawer-popup`, `drawer-swipe-handle`, `drawer-title`, optional `drawer-description`, `drawer-content`, `drawer-trigger` and `drawer-close` parts. Backdrop, viewport and popup start hidden. Create ancestors before descendants or pass the explicit `parent` controller. The portal mounts into `document.body` by default. CSS supplies positioning and visual appearance; the lazy module supplies shared transitions and nested stack transforms. Keep scrolling inside a flex child with `min-height: 0; overflow: auto`.

The controller provides `open`, `close`, `toggle`, `setSnapPoint`, `unmount`, `destroy`, and readonly `isOpen`, `snapPoint`, `triggerId`. Options include modal/non-modal/trap-focus, directions, snap points, sequential snapping, focus destinations, cancelable open/snap callbacks, completion callbacks, outside/Escape dismissal and portal container. `data-base-ui-swipe-ignore`, including its `x`/`y` variants, follows upstream arbitration. Mouse gestures leave content text selectable; touch gestures arbitrate content scrolling against drawer dismissal.

## Scope and verification

This is a port of the interaction core and DOM integration, not a claim of full Base UI API equivalence. React render props, contexts, controlled props, payload handles and the React actions/ref APIs are replaced by the controller. Optional swipe-to-open areas, page-indent providers and virtual-keyboard providers are not implemented. The current station drawer has no editable fields. Browser-native keyboard behavior remains in place.

`bun run test:drawer` runs isolated Chromium and WebKit scenarios for three-level nesting, nested pointer/touch dragging, parent progress, focus restoration, background inertness, scroll ownership, all four directions, snap sizes/reset, canceled swipes, interrupted transitions and ancestor destruction. `bun run test:touch` verifies actual Chromium touch injection and equivalent synthetic events in Windows WebKit, including station content scrolling and dismissal. `bun run test:browser` checks the application, both card origins, desktop behavior and offline caching.

Windows WebKit is not physical Safari on iOS 17. Device testing is still needed before claiming exact iOS gesture/keyboard parity. Future updates should diff the pinned upstream algorithm bodies and rerun all three browser suites; avoid independently tuning their gesture thresholds.
