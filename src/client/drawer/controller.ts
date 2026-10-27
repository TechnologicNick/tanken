import { createNesting } from './nesting.ts';
import { drawerStyles } from './styles.ts';
import { createLifecycle, type CSSProperties } from './lifecycle.ts';
import { renderViewport } from './viewport.ts';
import { createChangeEventDetails, type ChangeDetails } from './platform.ts';
import { modalStack, type ModalEntry } from './modal.ts';
import type { DrawerSnapPoint, DrawerState, NativeContext, NativeHandlers } from './context.ts';
import type { SwipeDirection } from './swipe.ts';

export interface DrawerOptions {
  open?: boolean;
  defaultOpen?: boolean;
  modal?: boolean | 'trap-focus';
  swipeDirection?: SwipeDirection;
  snapPoints?: DrawerSnapPoint[];
  snapPoint?: DrawerSnapPoint | null;
  defaultSnapPoint?: DrawerSnapPoint | null;
  snapToSequentialPoints?: boolean;
  disablePointerDismissal?: boolean;
  closeOnEscape?: boolean;
  initialFocus?: boolean | string | HTMLElement;
  finalFocus?: boolean | string | HTMLElement;
  keepMounted?: boolean;
  container?: HTMLElement;
  parent?: DrawerController;
  onOpenChange?: (open: boolean, details: ChangeDetails) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  onSnapPointChange?: (point: DrawerSnapPoint | null, details: ChangeDetails) => void;
}
export interface DrawerController {
  open(triggerId?: string): void;
  close(): void;
  toggle(): void;
  setSnapPoint(point: DrawerSnapPoint | null): void;
  unmount(): void;
  destroy(): void;
  readonly isOpen: boolean;
  readonly snapPoint: DrawerSnapPoint | null;
  readonly triggerId: string | null;
}
interface Entry {
  popup: HTMLElement;
  parent?: Entry;
  children: Set<Entry>;
  present: boolean;
  height: number;
  nesting: ReturnType<typeof createNesting>;
  controller: DrawerController;
  update(): void;
}
const entries = new Set<Entry>();
const controllers = new WeakMap<DrawerController, Entry>();
const bindings = new WeakMap<HTMLElement, DrawerController>();
let nextId = 0;

// Base UI leaves animation/layout to consumers. Shared styles are lazy, so
// desktop/initial bundles pay no cost. Gesture rules live in the ported files.
function installStyles(doc: Document) {
  if (doc.getElementById('native-drawer-styles')) return;
  const style = doc.createElement('style');
  style.id = 'native-drawer-styles';
  style.textContent = drawerStyles;
  doc.head.append(style);
  if (typeof CSS !== 'undefined' && 'registerProperty' in CSS) {
    for (const name of ['--drawer-swipe-movement-x', '--drawer-swipe-movement-y', '--drawer-snap-point-offset', '--drawer-swipe-strength', '--drawer-swipe-progress']) {
      const length = name.includes('movement') || name.includes('offset');
      try { CSS.registerProperty({ name, syntax: length ? '<length>' : '<number>', inherits: false, initialValue: length ? '0px' : name.endsWith('strength') ? '1' : '0' }); } catch { /* already registered */ }
    }
  }
}
function descendants(entry: Entry): Entry[] {
  return [...entry.children].flatMap(child => [child, ...descendants(child)]);
}
function refreshAncestors(entry: Entry) {
  for (let parent = entry.parent; parent; parent = parent.parent) parent.update();
}
export function createDrawer(root: HTMLElement, options: DrawerOptions = {}): DrawerController {
  const bound = bindings.get(root);
  if (bound) return bound;
  const doc = root.ownerDocument;
  const owned = <T extends HTMLElement>(slot: string) => Array.from(root.querySelectorAll<T>(`[data-slot="drawer-${slot}"]`)).find(el => el.closest('[data-slot=drawer]') === root);
  const popup = owned('popup') || (() => { throw new Error('Drawer requires a drawer-popup'); })();
  const viewport = owned('viewport') || popup;
  const backdrop = owned('backdrop');
  const portal = owned('portal') || viewport;
  const title = owned('title');
  const description = owned('description');
  const content = owned('content');
  const direction = options.swipeDirection || (root.dataset.swipeDirection as SwipeDirection) || 'down';
  const modal = options.modal ?? true;
  const defaultSnap = options.defaultSnapPoint ?? options.snapPoints?.[0] ?? null;
  let snapPoint = options.snapPoint ?? defaultSnap;
  let open = false, mounted = false, destroyed = false, generation = 0;
  let trigger: HTMLElement | null = null, previousFocus: HTMLElement | null = null;
  let handlers: NativeHandlers;
  let lifecycle: ReturnType<typeof createLifecycle>;
  let frame = 0;
  let animation: AbortController | undefined;
  let placeholder: Comment | undefined;
  let preserving = false;
  const restore: (() => void)[] = [];
  for (const element of new Set([root, popup, viewport, backdrop, portal, title, description, content, ...triggers()])) {
    if (!element) continue;
    const attrs = Array.from(element.attributes, attr => [attr.name, attr.value] as const);
    restore.push(() => { for (const attr of Array.from(element.attributes)) element.removeAttribute(attr.name); for (const [name, value] of attrs) element.setAttribute(name, value); });
  }
  popup.id ||= `drawer-popup-${++nextId}`;
  if (!popup.hasAttribute('tabindex')) popup.tabIndex = -1;
  popup.setAttribute('role', 'dialog');
  if (modal) popup.setAttribute('aria-modal', 'true');
  if (title) { title.id ||= `drawer-title-${++nextId}`; popup.setAttribute('aria-labelledby', title.id); }
  if (description) { description.id ||= `drawer-description-${++nextId}`; popup.setAttribute('aria-describedby', description.id); }
  popup.dataset.nativeDrawer = '';
  content?.setAttribute('data-base-ui-drawer-content', '');
  backdrop?.setAttribute('data-native-drawer-backdrop', '');
  popup.dataset.swipeAxis = direction === 'down' || direction === 'up' ? 'y' : 'x';
  if (options.snapPoints?.length) { popup.toggleAttribute('data-snap-points', true); backdrop?.toggleAttribute('data-snap-points', true); }
  installStyles(doc);
  const parent = options.parent ? controllers.get(options.parent) : [...entries].filter(item => item.popup.contains(root)).at(-1);
  // React batches the root's nested-state setters within an event. Commit their
  // DOM equivalents together: measuring between progress=0 and swiping=false
  // would flush the resting transform while transitions are still disabled.
  let nestingUpdatePending = false;
  function scheduleNestingUpdate() {
    if (nestingUpdatePending) return;
    nestingUpdatePending = true;
    queueMicrotask(() => { nestingUpdatePending = false; update(); });
  }
  const entry: Entry = { popup, parent, children: new Set(), present: false, height: 0, nesting: createNesting(parent?.nesting, scheduleNestingUpdate), controller: undefined!, update };
  parent?.children.add(entry);
  entries.add(entry);
  const state: DrawerState = { open: false, mounted: false, nested: !!parent, nestedOpenDrawerCount: 0, viewportElement: viewport, popupElement: popup };
  const context: NativeContext = {
    store: {
      context: { popupRef: { current: popup }, backdropRef: { current: backdrop || null } },
      useState: key => state[key], select: key => state[key], setOpen: (value, details) => change(value, details),
    },
    root: {
      swipeDirection: direction, frontmostHeight: 0, popupHeight: 0,
      snapToSequentialPoints: options.snapToSequentialPoints ?? false,
      swipeAreaActiveRef: { current: false }, snapPoints: options.snapPoints,
      activeSnapPoint: snapPoint,
      setActiveSnapPoint: setSnapPoint,
      notifyParentSwipingChange: parent?.nesting.onNestedSwipingChange,
      notifyParentSwipeProgressChange: parent?.nesting.onNestedSwipeProgressChange,
    },
  };
  const stack = modalStack(doc);
  const modalEntry: ModalEntry = { popup, portal, modal, dismissible: !options.disablePointerDismissal, escape: options.closeOnEscape ?? true, present: false,
    close: (reason, event) => change(false, createChangeEventDetails(reason, event)) };
  let notifiedHeight = 0, notifiedPresence = false;
  function update() {
    if (destroyed || !lifecycle) return;
    // Dialog's open count excludes ending drawers. DrawerRoot's separate
    // presence flag retains their measured height until the exit completes.
    const children = descendants(entry).filter(child => child.present && child.controller.isOpen);
    state.open = open; state.mounted = mounted;
    state.nestedOpenDrawerCount = children.length;
    const { hasNestedDrawer } = entry.nesting;
    const offsetHeight = mounted ? popup.offsetHeight : 0;
    const stretched = entry.height > 0 && context.root.frontmostHeight > entry.height && offsetHeight > entry.height;
    if (!mounted) entry.height = 0;
    else if (!stretched && !(entry.height > 0 && hasNestedDrawer)) entry.height = offsetHeight;
    entry.nesting.onPopupHeightChange(entry.height);
    context.root.popupHeight = entry.height;
    context.root.frontmostHeight = entry.nesting.frontmostHeight;
    context.root.activeSnapPoint = snapPoint;
    popup.toggleAttribute('data-nested', !!parent);
    popup.toggleAttribute('data-nested-drawer-open', !!children.length);
    popup.toggleAttribute('data-nested-drawer-swiping', entry.nesting.nestedSwiping);
    popup.style.setProperty('--nested-drawers', `${children.length}`);
    if (entry.height && (hasNestedDrawer || popup.hasAttribute('data-ending-style'))) popup.style.setProperty('--drawer-height', `${entry.height}px`);
    else popup.style.removeProperty('--drawer-height');
    popup.style.setProperty('--drawer-frontmost-height', `${context.root.frontmostHeight}px`);
    popup.style.setProperty('--drawer-swipe-progress', `${entry.nesting.progress}`);
    lifecycle.update(); lifecycle.flush();
    syncNestingParent();
  }
  function syncNestingParent() {
    // DrawerPopup layout effects: height is forwarded only while open; presence
    // includes the ending transition. Dedupe like React effect dependencies.
    const height = open ? entry.nesting.frontmostHeight : 0;
    if (height !== notifiedHeight) {
      notifiedHeight = height;
      parent?.nesting.onNestedFrontmostHeightChange(height);
    }
    if (entry.present !== notifiedPresence) {
      notifiedPresence = entry.present;
      parent?.nesting.onNestedDrawerPresenceChange(entry.present);
    }
  }
  function applyStyles(styles: CSSProperties) {
    for (const [key, value] of Object.entries(styles)) {
      if (value == null) popup.style.removeProperty(key);
      else popup.style.setProperty(key, String(value));
    }
  }
  lifecycle = createLifecycle(() => {
    const result = renderViewport(context);
    handlers = result.handlers;
    popup.toggleAttribute('data-swiping', result.swipe.swiping);
    applyStyles(result.swipe.getDragStyles());
    popup.style.setProperty('--drawer-swipe-strength', `${result.swipe.swipeStrength ?? 1}`);
    popup.style.setProperty('--drawer-snap-point-offset', `${(result.snapPointOffset || 0) * (direction === 'up' ? -1 : 1)}px`);
  });
  function setSnapPoint(value: DrawerSnapPoint | null, details = createChangeEventDetails('imperative-action')) {
    if (destroyed) return;
    options.onSnapPointChange?.(value, details);
    if (details.isCanceled) return;
    snapPoint = value; update();
  }
  function focus(value: DrawerOptions['initialFocus'], fallback: HTMLElement | null) {
    if (value === false) return;
    const target = typeof value === 'string' ? doc.querySelector<HTMLElement>(value) : value instanceof HTMLElement ? value : fallback;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  function sync() {
    for (const element of new Set([root, portal, viewport, popup, backdrop])) {
      if (!element) continue;
      element.dataset.state = open ? 'open' : 'closed';
      element.toggleAttribute('data-open', open);
      element.toggleAttribute('data-closed', !open);
      element.dataset.swipeDirection = direction;
    }
    for (const button of triggers()) {
      button.setAttribute('aria-controls', popup.id);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-haspopup', 'dialog');
    }
  }
  function mount() {
    if (mounted) return;
    if (!placeholder) { placeholder = doc.createComment('drawer-portal'); portal.before(placeholder); }
    (options.container || doc.body).append(portal);
    mounted = true;
    for (const element of [portal, viewport, popup, backdrop]) if (element) element.hidden = false;
    resize.observe(popup);
    entry.present = modalEntry.present = true;
    stack.add(modalEntry);
  }
  function unmount() {
    animation?.abort(); animation = undefined;
    if (!mounted) return;
    mounted = false;
    resize.disconnect();
    for (const element of [viewport, popup, backdrop]) if (element) element.hidden = true;
    for (const element of [popup, backdrop]) { element?.removeAttribute('data-starting-style'); element?.removeAttribute('data-ending-style'); }
    entry.present = modalEntry.present = false;
    stack.remove(modalEntry);
    if (!options.keepMounted && placeholder?.parentNode) { placeholder.replaceWith(portal); placeholder = undefined; }
    update(); syncNestingParent(); refreshAncestors(entry);
    if (!destroyed) focus(options.finalFocus, trigger || previousFocus);
  }
  async function complete(value: boolean, id: number) {
    const abort = new AbortController();
    animation?.abort(); animation = abort;
    await Promise.all([popup, backdrop].flatMap(element => element?.getAnimations().map(item => item.finished.catch(() => {})) || []));
    if (destroyed || id !== generation || abort.signal.aborted) return;
    if (!value && !preserving) unmount();
    options.onOpenChangeComplete?.(value);
  }
  function change(value: boolean, details = createChangeEventDetails('imperative-action')) {
    if (destroyed || value === open) return;
    options.onOpenChange?.(value, details);
    if (details.isCanceled) return;
    preserving = details.keepMounted;
    ++generation;
    cancelAnimationFrame(frame);
    animation?.abort();
    open = value;
    if (value) {
      previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      popup.removeAttribute('data-ending-style'); backdrop?.removeAttribute('data-ending-style');
      popup.setAttribute('data-starting-style', ''); backdrop?.setAttribute('data-starting-style', '');
      mount(); sync(); update(); refreshAncestors(entry);
      popup.getBoundingClientRect();
      const id = generation;
      frame = requestAnimationFrame(() => {
        if (!open || destroyed || generation !== id) return;
        popup.removeAttribute('data-starting-style'); backdrop?.removeAttribute('data-starting-style');
        focus(options.initialFocus, popup);
        void complete(true, id);
      });
    } else {
      for (const child of [...entry.children]) child.controller.close();
      popup.removeAttribute('data-starting-style'); backdrop?.removeAttribute('data-starting-style');
      popup.setAttribute('data-ending-style', ''); backdrop?.setAttribute('data-ending-style', '');
      if (options.snapPoints?.length) snapPoint = defaultSnap;
      sync(); update(); refreshAncestors(entry);
      void complete(false, generation);
    }
  }
  const resize = new ResizeObserver(() => { update(); refreshAncestors(entry); });
  const disposers: (() => void)[] = [];
  // Preserve nativeEvent/currentTarget access without synthetic events.
  for (const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchend','touchcancel'] as const) {
    const names = { pointerdown: 'onPointerDown', pointermove: 'onPointerMove', pointerup: 'onPointerUp', pointercancel: 'onPointerCancel', touchstart: 'onTouchStart', touchend: 'onTouchEnd', touchcancel: 'onTouchCancel' } as const;
    const listener = (event: Event) => {
      if (stack.top() !== modalEntry) return;
      const facade = new Proxy(event, { get(target, property) {
        if (property === 'nativeEvent') return event;
        if (property === 'currentTarget') return viewport;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      (handlers[names[type]] as (event: Event) => void)?.(facade);
      lifecycle.flush();
    };
    viewport.addEventListener(type, listener, { passive: false });
    disposers.push(() => viewport.removeEventListener(type, listener));
  }
  function triggers() {
    return [...doc.querySelectorAll<HTMLElement>('[data-slot=drawer-trigger]')].filter(el => el.closest('[data-slot=drawer]') === root || !!root.id && el.dataset.drawerTarget === root.id);
  }
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-slot=drawer-trigger],[data-slot=drawer-close]') : null;
    if (!target || target.matches(':disabled,[aria-disabled=true]')) return;
    if (target.dataset.slot === 'drawer-trigger' && triggers().includes(target)) {
      trigger = target; change(true, createChangeEventDetails('trigger-press', event, target));
    } else if (target.dataset.slot === 'drawer-close' && popup.contains(target) && target.closest('[data-slot=drawer-popup]') === popup) {
      change(false, createChangeEventDetails('close-press', event, target));
    }
  };
  doc.addEventListener('click', click);
  disposers.push(() => doc.removeEventListener('click', click));
  const controller: DrawerController = {
    open(id) { if (id) trigger = doc.getElementById(id); change(true); }, close() { change(false); }, toggle() { change(!open); },
    setSnapPoint, unmount,
    get isOpen() { return open; }, get snapPoint() { return snapPoint; }, get triggerId() { return trigger?.id || null; },
    destroy() {
      if (destroyed) return;
      const shouldRestoreFocus = mounted && popup.contains(doc.activeElement);
      for (const child of [...entry.children]) child.controller.destroy();
      destroyed = true; open = false; ++generation;
      cancelAnimationFrame(frame); unmount(); resize.disconnect(); lifecycle.destroy();
      for (const dispose of disposers) dispose();
      if (placeholder?.parentNode) placeholder.replaceWith(portal);
      for (const reset of restore) reset();
      parent?.children.delete(entry); entries.delete(entry); bindings.delete(root); controllers.delete(controller);
      refreshAncestors(entry);
      if (shouldRestoreFocus) focus(options.finalFocus, trigger || previousFocus);
    },
  };
  entry.controller = controller;
  controllers.set(controller, entry); bindings.set(root, controller);
  if (options.open ?? options.defaultOpen) {
    // An initially open root mounts in its resting state, like the React root;
    // it does not perform an imperative open/enter transition on first render.
    const transition = popup.style.getPropertyValue('transition');
    const priority = popup.style.getPropertyPriority('transition');
    popup.style.setProperty('transition', 'none', 'important');
    previousFocus = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    open = true;
    mount(); sync(); update(); refreshAncestors(entry);
    popup.getBoundingClientRect();
    if (transition) popup.style.setProperty('transition', transition, priority);
    else popup.style.removeProperty('transition');
    focus(options.initialFocus, popup);
    void complete(true, generation);
  } else {
    sync(); update();
  }
  return controller;
}
