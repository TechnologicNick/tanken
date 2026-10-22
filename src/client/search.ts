type Location = { label: string; lat: number; lng: number };

export function locationSearch(select: (location: Location) => void) {
  const form = document.getElementById("search-form") as HTMLFormElement,
    input = document.getElementById("search") as HTMLInputElement,
    country = form.elements.namedItem("country") as HTMLSelectElement,
    results = document.getElementById("search-results")!,
    clear = document.getElementById("search-clear")!,
    message = document.getElementById("search-status")!;
  let pending: AbortController | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    active = -1,
    composing = false;
  const cache = new Map<string, Location[]>();
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", results.id);
  input.setAttribute("aria-expanded", "false");
  results.setAttribute("role", "listbox");
  results.replaceChildren();
  clear.hidden = !input.value;
  clear.addEventListener("click", () => {
    input.value = "";
    changed();
    input.focus({ preventScroll: true });
  });

  function cancel() {
    clearTimeout(timer);
    pending?.abort();
    pending = undefined;
    results.removeAttribute("aria-busy");
  }
  function close() {
    cancel();
    message.textContent = "";
    results.replaceChildren();
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function render(locations: Location[]) {
    results.replaceChildren();
    active = -1;
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", String(locations.length > 0));
    message.textContent = locations.length
      ? (country.value === "eu" ? "© OpenStreetMap-bijdragers" : "")
      : "Geen locatie gevonden. Probeer een andere plaats of postcode.";
    for (const [index, location] of locations.entries()) {
      const item = document.createElement("li"),
        button = document.createElement("button");
      item.setAttribute("role", "presentation");
      button.type = "button";
      button.id = `search-option-${index}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;
      button.textContent = location.label;
      button.onclick = () => {
        close();
        input.value = location.label;
        clear.hidden = false;
        input.blur();
        select(location);
      };
      item.append(button);
      results.append(item);
    }
  }
  async function search() {
    cancel();
    const q = input.value.trim();
    if (q.length < 2) { close(); message.textContent = ""; return; }
    const query = new URLSearchParams({ q, country: country.value }),
      key = query.toString(),
      saved = cache.get(key);
    if (saved) { render(saved); return; }
    const controller = pending = new AbortController();
    results.setAttribute("aria-busy", "true");
    message.textContent = "Locaties zoeken…";
    try {
      const response = await fetch(`/api/search?${query}`, { signal: controller.signal });
      if (!response.ok) throw new Error("Search failed");
      const locations = ((await response.json()) as Location[]).slice(0, 5);
      if (pending !== controller) return;
      if (cache.size >= 20) cache.delete(cache.keys().next().value!);
      cache.set(key, locations);
      render(locations);
    } catch {
      if (pending === controller && !controller.signal.aborted)
        message.textContent = "Zoeken niet beschikbaar. Probeer het opnieuw wanneer je verbinding hebt.";
    } finally {
      if (pending === controller) {
        pending = undefined;
        results.removeAttribute("aria-busy");
      }
    }
  }
  function changed() {
    clear.hidden = !input.value;
    close();
    message.textContent = "";
    // Public Nominatim forbids autocomplete; European searches remain explicit.
    if (!composing && country.value === "nl" && input.value.trim().length >= 2)
      timer = setTimeout(search, 300);
  }
  input.addEventListener("input", changed);
  input.addEventListener("compositionstart", () => { composing = true; close(); });
  input.addEventListener("compositionend", () => { composing = false; changed(); });
  country.addEventListener("change", changed);
  form.addEventListener("submit", (event) => { event.preventDefault(); void search(); });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || composing) return;
    const options = Array.from(results.querySelectorAll("button"));
    if (event.key === "Escape") { event.preventDefault(); close(); }
    else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
      event.preventDefault();
      active = (active + (event.key === "ArrowDown" ? 1 : active < 0 ? 0 : -1) + options.length) % options.length;
      options.forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
      input.setAttribute("aria-activedescendant", options[active]!.id);
      options[active]!.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && active >= 0 && options[active]) {
      event.preventDefault();
      options[active]!.click();
    }
  });
  // Click (rather than blur) keeps touch selection reliable in Safari.
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target as Node)) close();
  });
  form.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !form.contains(event.relatedTarget as Node)) close();
  });
}
