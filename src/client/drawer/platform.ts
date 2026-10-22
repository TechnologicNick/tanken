export { getWindow as ownerWindow } from '@floating-ui/utils/dom';
export const ownerDocument = (node: Element | null) => node?.ownerDocument || document;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function addEventListener<K extends keyof DocumentEventMap>(target: Document, type: K, listener: (event: DocumentEventMap[K]) => void, options?: AddEventListenerOptions) {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}
export const BASE_UI_SWIPE_IGNORE_ATTRIBUTE = 'data-base-ui-swipe-ignore';
export const BASE_UI_SWIPE_IGNORE_SELECTOR = `[${BASE_UI_SWIPE_IGNORE_ATTRIBUTE}]`;
export const REASONS = { swipe: 'swipe' } as const;
export interface ChangeDetails {
  reason: string;
  event?: Event;
  trigger?: HTMLElement;
  isCanceled: boolean;
  cancel(): void;
  preventUnmountOnClose(): void;
  keepMounted: boolean;
}
export function createChangeEventDetails(reason: string, event?: Event, trigger?: HTMLElement): ChangeDetails {
  return { reason, event, trigger, isCanceled: false, keepMounted: false,
    cancel() { this.isCanceled = true; },
    preventUnmountOnClose() { this.keepMounted = true; },
  };
}
