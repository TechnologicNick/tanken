export {};
try {
  const r = await fetch(
    `http://127.0.0.1:${process.env.PORT || 3000}/healthz`,
    { signal: AbortSignal.timeout(4000) },
  );
  process.exit(r.ok ? 0 : 1);
} catch {
  process.exit(1);
}
