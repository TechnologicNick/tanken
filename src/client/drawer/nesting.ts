// DrawerRoot.tsx's nested state and callbacks; React setters become assignments.
// DrawerPopup's parent notifications are synchronized by the DOM controller.
interface NestedNotifications {
  onNestedSwipeProgressChange(value: number): void;
  onNestedSwipingChange(value: boolean): void;
}
export function createNesting(parent: NestedNotifications | undefined, changed: () => void) {
  let popupHeight = 0, frontmostHeight = 0, hasNestedDrawer = false;
  let isNestedDrawerOpen = false, nestedSwiping = false, progress = 0;
  return {
    get frontmostHeight() { return frontmostHeight; },
    get hasNestedDrawer() { return hasNestedDrawer; },
    get nestedSwiping() { return nestedSwiping; },
    get progress() { return progress; },
    onPopupHeightChange(height: number) {
      popupHeight = height;
      if (!isNestedDrawerOpen && height > 0) frontmostHeight = height;
    },
    onNestedFrontmostHeightChange(height: number) {
      if (height > 0) {
        isNestedDrawerOpen = true;
        frontmostHeight = height;
      } else {
        isNestedDrawerOpen = false;
        if (popupHeight > 0) frontmostHeight = popupHeight;
      }
      changed();
    },
    onNestedDrawerPresenceChange(present: boolean) {
      hasNestedDrawer = present;
      changed();
    },
    onNestedSwipeProgressChange(value: number) {
      const resolved = Number.isFinite(value) ? value : 0;
      if (resolved !== progress) {
        progress = resolved;
        changed();
      }
      parent?.onNestedSwipeProgressChange(value);
    },
    onNestedSwipingChange(swiping: boolean) {
      nestedSwiping = swiping;
      changed();
      parent?.onNestedSwipingChange(swiping);
    },
  };
}
