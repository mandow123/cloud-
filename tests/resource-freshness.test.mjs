import assert from "node:assert/strict";
import test from "node:test";

import { resourceListings } from "../lib/data.ts";
import { resourceQuoteFreshness, summarizeResourceCatalog } from "../lib/resource-freshness.ts";

test("resource quote freshness has exact expiry and 48-hour warning boundaries", () => {
  const expiry = Date.parse("2026-08-08T15:59:59.000Z");
  assert.equal(resourceQuoteFreshness("2026-08-08T15:59:59.000Z", expiry - 48 * 60 * 60 * 1_000 - 1), "current");
  assert.equal(resourceQuoteFreshness("2026-08-08T15:59:59.000Z", expiry - 48 * 60 * 60 * 1_000), "expiring");
  assert.equal(resourceQuoteFreshness("2026-08-08T15:59:59.000Z", expiry), "expired");
  assert.equal(resourceQuoteFreshness("invalid", expiry), "expired");
});

test("resource catalog summary reports validity without rewriting source timestamps", () => {
  const before = JSON.stringify(resourceListings);
  const summary = summarizeResourceCatalog(resourceListings, Date.parse("2026-08-06T00:00:00.000Z"));
  assert.equal(summary.total, 24);
  assert.equal(summary.current + summary.expiring + summary.expired, 24);
  assert.equal(summary.latestUpdatedAt, "2026-08-01T04:00:00.000Z");
  assert.equal(JSON.stringify(resourceListings), before);
});

