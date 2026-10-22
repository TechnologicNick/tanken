import type { DrawerController } from "./drawer.ts";
import type { MapStation } from "../map-markers.ts";

export function stationPanel(
  drawerAsset: string,
  showMap: (show: boolean) => void,
  highlight: (station: MapStation | null) => void,
) {
  const list = document.getElementById("stations")!;
  const root = document.getElementById("station-panel")!;
  const viewport = document.getElementById("station-card-viewport")!;
  const popup = document.getElementById("station-card")!;
  const title = document.getElementById("station-card-title")!;
  const body = document.getElementById("station-card-body")!;
  const closeButton = document.getElementById("station-card-close")!;
  const mobile = matchMedia("(max-width: 600px)");
  let drawer: DrawerController | undefined;
  let library: Promise<typeof import("./drawer.ts")> | undefined;
  let selected: MapStation | null = null,
    hovered: MapStation | null = null;
  let returnToMap = true,
    open = false,
    revision = 0,
    pending: AbortController | undefined;
  const linkAt = (target: EventTarget | null) =>
    target instanceof Element
      ? target.closest<HTMLAnchorElement>("a.station")
      : null;
  const station = (link: HTMLAnchorElement): MapStation => ({
    kind: "station",
    id: Number(link.dataset.id),
    lat: Number(link.dataset.lat),
    lng: Number(link.dataset.lng),
    amount: Number(link.dataset.amount),
    currency: link.dataset.currency!,
    tier: Number(link.dataset.tier),
    title: link.querySelector("strong")!.textContent!,
  });
  function sync() {
    for (const link of list.querySelectorAll<HTMLAnchorElement>("a.station")) {
      const active = Number(link.dataset.id) === selected?.id;
      link.classList.toggle("is-selected", active);
      link.setAttribute("aria-expanded", String(active));
      link.setAttribute("aria-controls", "station-card");
    }
  }
  function finish() {
    if (open && mobile.matches) showMap(returnToMap);
    open = false;
    ++revision;
    pending?.abort();
    selected = hovered = null;
    document.body.classList.remove("station-card-open");
    highlight(null);
    sync();
  }
  function close() {
    if (drawer?.isOpen) drawer.close();
    else {
      finish();
      viewport.hidden = popup.hidden = true;
    }
  }
  async function present() {
    if (mobile.matches) {
      library ||= import(drawerAsset);
      let createDrawer: typeof import("./drawer.ts").createDrawer;
      try {
        ({ createDrawer } = await library);
      } catch {
        // If this optional asset was never cached, keep the offline card usable.
        library = undefined;
        if (open) {
          viewport.hidden = popup.hidden = false;
          closeButton.focus();
        }
        return;
      }
      if (!open || !mobile.matches) return;
      drawer ||= createDrawer(root, {
        modal: true,
        swipeDirection: "down",
        finalFocus: "#mobile-toggle",
        onOpenChange(value) {
          if (!value) finish();
        },
      });
      drawer.open();
    } else {
      viewport.hidden = popup.hidden = false;
      popup.setAttribute("role", "region");
      popup.removeAttribute("aria-modal");
      closeButton.focus({ preventScroll: true });
    }
  }
  async function select(value: MapStation, href: string, fromMap: boolean) {
    const id = ++revision;
    pending?.abort();
    pending = new AbortController();
    selected = value;
    returnToMap = fromMap;
    hovered = null;
    open = true;
    title.textContent = selected.title;
    body.textContent = "Stationinformatie laden…";
    body.setAttribute("aria-busy", "true");
    showMap(true);
    document.body.classList.add("station-card-open");
    sync();
    highlight(selected);
    try {
      const url = new URL(href, location.href);
      url.searchParams.set("card", "1");
      const [, response] = await Promise.all([
        present(),
        fetch(url, { signal: pending.signal }),
      ]);
      const html = await response.text();
      if (id !== revision) return;
      const content = new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector("article[data-station-name]");
      if (!response.ok || !content)
        throw new Error("Stationinformatie niet beschikbaar.");
      title.textContent = (content as HTMLElement).dataset.stationName!;
      body.replaceChildren(document.importNode(content, true));
      body.scrollTop = 0;
    } catch (error) {
      if (id !== revision) return;
      body.textContent = navigator.onLine
        ? "Stationinformatie kon niet worden opgehaald. "
        : "Offline · deze stationinformatie is nog niet opgeslagen. ";
      const fallback = document.createElement("a");
      fallback.href = href;
      fallback.textContent = "Open stationspagina →";
      body.append(fallback);
    } finally {
      if (id === revision) body.removeAttribute("aria-busy");
    }
  }
  list.addEventListener("click", (event) => {
    const link = linkAt(event.target);
    if (
      !link ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    void select(station(link), link.href, false);
  });
  const enter = (event: Event) => {
    const link = linkAt(event.target);
    if (!link || hovered?.id === Number(link.dataset.id)) return;
    hovered = station(link);
    highlight(hovered);
  };
  const leave = (event: MouseEvent | FocusEvent) => {
    if (linkAt(event.target) === linkAt(event.relatedTarget)) return;
    hovered = null;
    highlight(selected);
  };
  list.addEventListener("pointerover", enter);
  list.addEventListener("pointerout", leave);
  list.addEventListener("focusin", enter);
  list.addEventListener("focusout", leave);
  closeButton.addEventListener("click", () => {
    if (!drawer?.isOpen) close();
  });
  addEventListener("keydown", (event) => {
    if (
      event instanceof KeyboardEvent &&
      event.key === "Escape" &&
      !mobile.matches &&
      open
    )
      close();
  });
  mobile.addEventListener("change", () => {
    drawer?.destroy();
    drawer = undefined;
    if (open) void present();
  });
  sync();
  return {
    sync, close,
    select(station: MapStation, fuel: string) {
      void select(station, `/stations/${station.id}?fuel=${encodeURIComponent(fuel)}`, true);
    },
  };
}
