// DOM ownership replaces DialogRoot/FloatingFocusManager. Each document has one
// stack, so nested/portalled drawers share scroll locking, focus and inertness.
import { activeElement, contains } from './shadowDom.ts';
export interface ModalEntry {
  popup: HTMLElement;
  portal: HTMLElement;
  modal: boolean | 'trap-focus';
  dismissible: boolean;
  escape: boolean;
  present: boolean;
  close(reason: string, event?: Event): void;
}
const stacks = new WeakMap<Document, ReturnType<typeof createStack>>();
export function modalStack(doc: Document) {
  let stack = stacks.get(doc);
  if (!stack) { stack = createStack(doc); stacks.set(doc, stack); }
  return stack;
}
function createStack(doc: Document) {
  const entries: ModalEntry[] = [];
  const inert = new Map<HTMLElement, boolean>();
  let scroll: { overflow: string; paddingRight: string; x: number; y: number } | undefined;
  let observer: MutationObserver | undefined;
  const top = () => entries.at(-1);
  const tabbables = (popup: HTMLElement) => Array.from(popup.querySelectorAll<HTMLElement>(
    'a[href],button,input,select,textarea,[tabindex],[contenteditable="true"]',
  )).filter(el => el.tabIndex >= 0 && !el.matches(':disabled,[hidden]') && !el.closest('[inert]') && el.getClientRects().length > 0);
  function keydown(event: KeyboardEvent) {
    const entry = top();
    if (!entry) return;
    if (event.key === 'Escape' && entry.escape && !event.defaultPrevented) {
      event.preventDefault(); event.stopPropagation();
      entry.close('escape-key', event);
    } else if (event.key === 'Tab' && entry.modal) {
      const items = tabbables(entry.popup);
      const index = items.indexOf(activeElement(doc) as HTMLElement);
      if (!items.length || (event.shiftKey ? index <= 0 : index === items.length - 1 || index < 0)) {
        event.preventDefault();
        (event.shiftKey ? items.at(-1) : items[0] || entry.popup)?.focus({ preventScroll: true });
      }
    }
  }
  function pointerdown(event: PointerEvent) {
    const entry = top();
    if (!entry?.present || !entry.dismissible || event.button !== 0 || contains(entry.popup, event.composedPath()[0] as Element)) return;
    entry.close('outside-press', event);
  }
  function focusin(event: FocusEvent) {
    const entry = top();
    if (!entry || contains(entry.popup, event.composedPath()[0] as Element)) return;
    if (entry.modal) entry.popup.focus({ preventScroll: true });
    else if (entry.dismissible) entry.close('focus-out', event);
  }
  function sync() {
    for (const [el, original] of inert) el.inert = original;
    inert.clear();
    const entry = top();
    const locking = entries.some(item => item.modal === true);
    if (locking && !scroll) {
      const win = doc.defaultView!;
      scroll = { overflow: doc.body.style.overflow, paddingRight: doc.body.style.paddingRight, x: win.scrollX, y: win.scrollY };
      const gap = win.innerWidth - doc.documentElement.clientWidth;
      doc.body.style.overflow = 'hidden';
      if (gap > 0) doc.body.style.paddingRight = `${parseFloat(win.getComputedStyle(doc.body).paddingRight) + gap}px`;
    } else if (!locking && scroll) {
      doc.body.style.overflow = scroll.overflow;
      doc.body.style.paddingRight = scroll.paddingRight;
      doc.defaultView!.scrollTo(scroll.x, scroll.y);
      scroll = undefined;
    }
    if (entry?.modal === true) {
      // Walk outwards from the active portal; never inert a portal's ancestor.
      let child: HTMLElement = entry.portal;
      while (child.parentElement) {
        for (const sibling of child.parentElement.children) {
          if (!(sibling instanceof HTMLElement) || sibling === child || sibling.matches('script,style,link')) continue;
          inert.set(sibling, sibling.inert);
          sibling.inert = true;
        }
        if (child.parentElement === doc.body) break;
        child = child.parentElement;
      }
    }
  }
  return {
    top,
    add(entry: ModalEntry) {
      if (entries.includes(entry)) return;
      if (!entries.length) {
        doc.addEventListener('keydown', keydown);
        doc.addEventListener('pointerdown', pointerdown);
        doc.addEventListener('focusin', focusin);
        observer = new MutationObserver(sync);
        observer.observe(doc.body, { childList: true });
      }
      entries.push(entry); sync();
    },
    remove(entry: ModalEntry) {
      const index = entries.indexOf(entry);
      if (index < 0) return;
      entries.splice(index, 1); sync();
      if (!entries.length) {
        doc.removeEventListener('keydown', keydown);
        doc.removeEventListener('pointerdown', pointerdown);
        doc.removeEventListener('focusin', focusin);
        observer?.disconnect(); observer = undefined;
      }
    },
  };
}
