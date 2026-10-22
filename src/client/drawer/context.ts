import type { RefObject, PointerEvent, TouchEvent } from './lifecycle.ts';
import type { ChangeDetails } from './platform.ts';
import type { SwipeDirection } from './swipe.ts';
export type DrawerSnapPoint = number | string;
export type NativeHandlers = {
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): void;
  onPointerUp(event: PointerEvent): void;
  onPointerCancel(event: PointerEvent): void;
  onTouchStart(event: TouchEvent): void;
  onTouchEnd(event: TouchEvent): void;
  onTouchCancel(event: TouchEvent): void;
};
export interface NativeContext {
  store: {
    context: { popupRef: RefObject<HTMLElement | null>; backdropRef: RefObject<HTMLElement | null> };
    useState<K extends keyof DrawerState>(key: K): DrawerState[K];
    select<K extends keyof DrawerState>(key: K): DrawerState[K];
    setOpen(open: boolean, details: ChangeDetails): void;
  };
  root: {
    swipeDirection: SwipeDirection;
    notifyParentSwipingChange?: (value: boolean) => void;
    notifyParentSwipeProgressChange?: (value: number) => void;
    frontmostHeight: number;
    snapToSequentialPoints: boolean;
    swipeAreaActiveRef: RefObject<boolean>;
    snapPoints?: DrawerSnapPoint[];
    activeSnapPoint: DrawerSnapPoint | null;
    setActiveSnapPoint(value: DrawerSnapPoint | null, details?: ChangeDetails): void;
    popupHeight: number;
  };
  provider?: { visualStateStore: { set(value: { swipeProgress: number; frontmostHeight: number }): void } };
  virtualKeyboard?: {
    onTouchMove(event: globalThis.TouchEvent): void;
    onTouchStart(event: TouchEvent): void;
    onTouchEnd(event: TouchEvent): void;
    onTouchCancel(): void;
  };
}
export interface DrawerState {
  open: boolean;
  mounted: boolean;
  nested: boolean;
  nestedOpenDrawerCount: number;
  viewportElement: HTMLElement;
  popupElement: HTMLElement;
}
