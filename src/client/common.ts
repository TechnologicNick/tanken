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
