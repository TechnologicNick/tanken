// Native lifecycle adapter for the ported interaction functions. No renderer or
// virtual DOM: updates only refresh callbacks, effects and imperative DOM styles.
export type RefObject<T> = { current: T };
export type CSSProperties = Record<string, string | number | undefined>;
export type PointerEvent<T = HTMLElement> = globalThis.PointerEvent & { currentTarget: T; nativeEvent: globalThis.PointerEvent };
export type TouchEvent<T = HTMLElement> = globalThis.TouchEvent & { currentTarget: T; nativeEvent: globalThis.TouchEvent };
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
let current: Scope | undefined;
const scopes = new Set<Scope>();
class Scope {
  slots: Slot[] = [];
  cursor = 0;
  pending: (() => void)[] = [];
  dirty = true;
  disposed = false;
  running = false;
  constructor(readonly render: () => void) { scopes.add(this); }
  update = () => {
    if (this.disposed) return;
    this.dirty = true;
    queueMicrotask(() => this.flush());
  };
  flush() {
    if (this.disposed || this.running || !this.dirty) return;
    this.running = true;
    let passes = 0;
    try {
      while (this.dirty) {
        if (++passes > 50) throw new Error("Drawer lifecycle did not settle");
        this.dirty = false;
        this.cursor = 0;
        const previous = current;
        current = this;
        try { this.render(); } finally { current = previous; }
        const effects = this.pending.splice(0);
        for (const effect of effects) effect();
      }
    } finally { this.running = false; }
  }
  destroy() {
    this.disposed = true;
    scopes.delete(this);
    for (const slot of this.slots) slot.cleanup?.();
    this.slots.length = this.pending.length = 0;
  }
}
export function createLifecycle(render: () => void) { return new Scope(render); }
export function flushSync(fn: () => void) {
  fn();
  for (const scope of scopes) scope.flush();
}
function slot() {
  if (!current) throw new Error("No drawer lifecycle");
  const scope = current;
  return { scope, slot: scope.slots[scope.cursor++] ||= {} };
}
export function useRef<T>(initial: T): RefObject<T> {
  const item = slot().slot;
  return (item.value ||= { current: initial }) as RefObject<T>;
}
export function useState<T>(initial: T | (() => T)): [T, (value: T | ((old: T) => T)) => void] {
  const { scope, slot: item } = slot();
  if (!("value" in item)) item.value = typeof initial === "function" ? (initial as () => T)() : initial;
  return [item.value as T, value => {
    const next = typeof value === "function" ? (value as (old: T) => T)(item.value as T) : value;
    if (Object.is(next, item.value)) return;
    item.value = next;
    scope.update();
  }];
}
const changed = (old: readonly unknown[] | undefined, next: readonly unknown[]) =>
  !old || old.length !== next.length || next.some((value, i) => !Object.is(value, old[i]));
export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  const item = slot().slot;
  if (changed(item.deps, deps)) { item.value = factory(); item.deps = deps; }
  return item.value as T;
}
export function useCallback<T extends (...args: never[]) => unknown>(fn: T, deps: readonly unknown[]): T {
  return useMemo(() => fn, deps);
}
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const ref = useRef(fn);
  ref.current = fn;
  return useMemo(() => ((...args: never[]) => ref.current(...args)) as T, []);
}
export function useEffect(effect: () => void | (() => void), deps: readonly unknown[]) {
  const { scope, slot: item } = slot();
  if (!changed(item.deps, deps)) return;
  item.deps = deps;
  scope.pending.push(() => { item.cleanup?.(); item.cleanup = effect() || undefined; });
}
export const useIsoLayoutEffect = useEffect;
export function useAnimationFrame() {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return useMemo(() => ({
    request(fn: FrameRequestCallback) { cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(fn); },
    cancel() { cancelAnimationFrame(frame.current); },
  }), []);
}
