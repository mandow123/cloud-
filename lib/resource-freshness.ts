import type { ResourceListing } from "@/lib/types";

export type ResourceQuoteFreshness = "current" | "expiring" | "expired";

export function resourceQuoteFreshness(validUntil: string, now = Date.now()): ResourceQuoteFreshness {
  const expiresAt = Date.parse(validUntil);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return "expired";
  if (expiresAt - now <= 48 * 60 * 60 * 1_000) return "expiring";
  return "current";
}

export function summarizeResourceCatalog(listings: readonly ResourceListing[], now = Date.now()) {
  const counts = { current: 0, expiring: 0, expired: 0 };
  let latestUpdatedAt: string | null = null;
  for (const listing of listings) {
    counts[resourceQuoteFreshness(listing.quote.validUntil, now)] += 1;
    if (!latestUpdatedAt || Date.parse(listing.quote.updatedAt) > Date.parse(latestUpdatedAt)) {
      latestUpdatedAt = listing.quote.updatedAt;
    }
  }
  return { ...counts, latestUpdatedAt, total: listings.length };
}

