import assert from "node:assert/strict";
import test from "node:test";

import {
  buyCatalogExclusionReason,
  classifyBuyCatalogListing,
  isPrimaryInquiryListing,
  partitionBuyCatalog,
} from "../lib/buy-catalog.ts";
import { resourceListings, suppliers } from "../lib/catalog.mjs";

const NOW = "2026-08-20T08:00:00.000Z";

function changed(listing, overrides) {
  return { ...listing, ...overrides };
}

test("buy catalog partitions current supplier offers, workbook leads and excluded samples", () => {
  const result = partitionBuyCatalog(resourceListings, suppliers, NOW);
  assert.equal(result.primary.length, 10);
  assert.equal(result.referenceLeads.length, 100);
  assert.equal(result.excluded.length, 24);
  assert.ok(result.primary.every((listing) => listing.supplierId === "supplier-shanghai-honghuan"));
  assert.ok(result.referenceLeads.every((listing) => listing.source?.kind === "USER_PROVIDED_WORKBOOK_REFERENCE"));
  assert.ok(result.excluded.every((listing) => !isPrimaryInquiryListing(listing, suppliers, NOW)));
});

test("primary inquiry eligibility fails closed on attribution, price, expiry and delivery", () => {
  const primary = resourceListings.find((listing) => listing.id === "gpu-honghuan-h200-nvl-1");
  assert.ok(primary);
  assert.equal(classifyBuyCatalogListing(primary, suppliers, NOW), "PRIMARY_INQUIRY");

  assert.equal(
    buyCatalogExclusionReason(changed(primary, { supplierId: "supplier-missing" }), suppliers, NOW),
    "SUPPLIER_UNRESOLVED",
  );
  assert.equal(
    buyCatalogExclusionReason(changed(primary, { supplierName: "伪造供应商" }), suppliers, NOW),
    "SUPPLIER_IDENTITY_MISMATCH",
  );
  assert.equal(
    buyCatalogExclusionReason(changed(primary, { quote: { ...primary.quote, median: 0 } }), suppliers, NOW),
    "QUOTE_INVALID",
  );
  assert.equal(
    buyCatalogExclusionReason(primary, suppliers, primary.quote.validUntil),
    "QUOTE_EXPIRED",
  );
  assert.equal(
    buyCatalogExclusionReason(changed(primary, { deliveryForm: "API 服务" }), suppliers, NOW),
    "NOT_MANUAL_SSH_DELIVERY",
  );
  assert.equal(
    buyCatalogExclusionReason(changed(primary, { category: "token_model" }), suppliers, NOW),
    "NOT_GPU",
  );
});

test("workbook entries remain non-executable reference leads", () => {
  const lead = resourceListings.find((listing) => listing.id === "gpu-supplier-reference-001");
  const sample = resourceListings.find((listing) => listing.id === "gpu-h100-sxm-8-bj");
  assert.ok(lead);
  assert.ok(sample);
  assert.equal(classifyBuyCatalogListing(lead, suppliers, NOW), "REFERENCE_LEAD");
  assert.equal(buyCatalogExclusionReason(lead, suppliers, NOW), "REFERENCE_LEAD");
  assert.equal(classifyBuyCatalogListing(sample, suppliers, NOW), "EXCLUDED");
  assert.equal(buyCatalogExclusionReason(sample, suppliers, NOW), "NOT_SUPPLIER_QUOTE");
});
