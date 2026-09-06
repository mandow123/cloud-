const target = new URL(process.env.KAI_INTERNAL_RECONCILIATION_URL || "http://127.0.0.1:3051/api/internal/card-hour-reconciliation");
const token = process.env.KAI_INTERNAL_RECONCILIATION_TOKEN;
if (target.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(target.hostname) || target.username || target.password || target.pathname !== "/api/internal/card-hour-reconciliation" || target.search || target.hash) throw new Error("RECONCILIATION_WORKER_LOOPBACK_REQUIRED");
if (!token || !/^[A-Za-z0-9_-]{32,128}$/u.test(token) || token.startsWith("REPLACE_")) throw new Error("RECONCILIATION_WORKER_TOKEN_REQUIRED");
try {
  const response = await fetch(target, { method: "POST", headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`RECONCILIATION_WORKER_HTTP_${response.status}`);
  const value = await response.json();
  const counts = Object.fromEntries(["scanned", "claimed", "captured", "deferred"].map((key) => [key, Number.isSafeInteger(value[key]) ? value[key] : 0]));
  console.log(JSON.stringify({ event: "card_hour_reconciliation_tick", occurredAt: new Date().toISOString(), ...counts, skipped: value.skipped === true }));
} catch {
  // Never print the request, bearer token, response body or credentials.
  console.error(JSON.stringify({ event: "card_hour_reconciliation_tick_failed", occurredAt: new Date().toISOString() }));
  process.exitCode = 1;
}
