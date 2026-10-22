import { openingClock } from '../hours.ts';
function refreshHours() {
  const clock = openingClock();
  for (const graph of document.querySelectorAll('.opening-hours')) {
    const marker = graph.querySelector<HTMLElement>('.hours-clock');
    if (!marker) continue;
    marker.setAttribute('aria-label', `Huidige tijd: ${clock.label}`);
    const line = marker.firstElementChild as HTMLElement;
    line.style.left = `${clock.percent}%`;
    line.title = clock.label;
    graph.querySelectorAll('li').forEach((row, day) => row.classList.toggle('today', day === clock.day));
  }
}
refreshHours();
setInterval(refreshHours, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshHours(); });
const card = document.getElementById('station-card-body');
if (card) new MutationObserver(refreshHours).observe(card, { childList: true });
function connection() {
  const el = document.getElementById("connection");
  if (el) {
    el.hidden = navigator.onLine;
    el.textContent =
      "Offline · je bekijkt eerder opgehaalde gegevens. Controleer de waarnemingstijd.";
  }
}
addEventListener("online", connection);
addEventListener("offline", connection);
connection();
if ("serviceWorker" in navigator && isSecureContext)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
