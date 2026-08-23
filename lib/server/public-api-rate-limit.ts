import { AccountAuthError } from "./account-auth.ts";

type Bucket = { window: number; count: number };
const buckets = new Map<string, Bucket>();

export function enforceKaiPublicApiRateLimit(key: string, now = Date.now(), maximum = 120) {
  const window = Math.floor(now / 60_000);
  const bucket = buckets.get(key);
  if (!bucket || bucket.window !== window) {
    buckets.set(key, { window, count: 1 });
    return;
  }
  bucket.count += 1;
  if (bucket.count > maximum) throw new AccountAuthError("RATE_LIMITED", 429, "请求过于频繁，请稍后重试。 ");
  if (buckets.size > 10_000) {
    for (const [candidate, value] of buckets) if (value.window < window - 1) buckets.delete(candidate);
  }
}
