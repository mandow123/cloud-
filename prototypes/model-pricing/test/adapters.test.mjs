import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectOfficialJsonFeed,
  collectReviewedRegistry,
  createPublicationCandidate,
  parseOfficialJsonFeed,
  reviewedRegionHash,
  runAtomicCollection,
} from "../src/index.mjs";

const fixture = (name) => new URL(`../fixtures/${name}`, import.meta.url);
const readFixture = (name) => readFile(fixture(name), "utf8");
const fetchedAt = "2026-08-03T05:45:00+08:00";

const jsonConfig = {
  endpointUrl: "https://api.vendor.example/model-prices.json",
  sourceUrl: "https://docs.vendor.example/model-pricing",
  expectedProvider: "Fixture JSON Cloud",
  fetchedAt,
};

const reviewedConfig = {
  sourceUrl: "https://pricing.vendor.example/models",
  expectedProvider: "Fixture Reviewed Cloud",
  fetchedAt,
};

function responseFetch(text, contentType = "application/json") {
  return async () => new Response(text, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

test("official JSON adapter emits complete normalized model quotes", async () => {
  const body = await readFixture("json/valid-feed.json");
  const quotes = parseOfficialJsonFeed(body, jsonConfig);
  assert.equal(quotes.length, 3);
  assert.deepEqual(Object.keys(quotes[0]), [
    "provider",
    "model",
    "version",
    "inputPrice",
    "cachedInputPrice",
    "outputPrice",
    "currency",
    "pricingUnit",
    "sourceUrl",
    "fetchedAt",
    "effectiveAt",
    "status",
    "sourceKind",
    "sourceContentHash",
  ]);
  assert.equal(quotes[0].status, "verified");
  assert.equal(quotes[0].pricingUnit, "per_million_tokens");
  assert.equal(quotes[1].cachedInputPrice, null);
  assert.match(quotes[0].sourceContentHash, /^[a-f0-9]{64}$/);
});

test("official JSON collector fetches a machine-readable endpoint", async () => {
  const body = await readFixture("json/valid-feed.json");
  const quotes = await collectOfficialJsonFeed({ ...jsonConfig, fetchImpl: responseFetch(body) });
  assert.equal(quotes.length, 3);
  assert.equal(quotes[2].model, "fixture-multimodal");
});

test("JSON schema version drift blocks the entire source batch", async () => {
  const body = await readFixture("json/schema-changed-feed.json");
  const batch = await runAtomicCollection({
    provider: jsonConfig.expectedProvider,
    sourceKind: "official_json",
    sourceUrl: jsonConfig.sourceUrl,
    fetchedAt,
  }, () => Promise.resolve(parseOfficialJsonFeed(body, jsonConfig)));
  assert.equal(batch.state, "blocked");
  assert.equal(batch.failure.code, "SCHEMA_VERSION_CHANGED");
  assert.deepEqual(batch.quotes, []);
});

test("one malformed JSON price prevents partial publication", async () => {
  const body = await readFixture("json/partial-invalid-feed.json");
  const batch = await runAtomicCollection({
    provider: jsonConfig.expectedProvider,
    sourceKind: "official_json",
    sourceUrl: jsonConfig.sourceUrl,
    fetchedAt,
  }, () => Promise.resolve(parseOfficialJsonFeed(body, jsonConfig)));
  assert.equal(batch.state, "blocked");
  assert.equal(batch.failure.code, "INVALID_PRICE");
  assert.equal(batch.quotes.length, 0);
});

test("renamed or missing cached-input field is treated as schema drift", async () => {
  const document = JSON.parse(await readFixture("json/valid-feed.json"));
  document.items[0].pricing.cacheRead = document.items[0].pricing.cachedInput;
  delete document.items[0].pricing.cachedInput;
  const batch = await runAtomicCollection({
    provider: jsonConfig.expectedProvider,
    sourceKind: "official_json",
    sourceUrl: jsonConfig.sourceUrl,
    fetchedAt,
  }, () => Promise.resolve(parseOfficialJsonFeed(JSON.stringify(document), jsonConfig)));
  assert.equal(batch.state, "blocked");
  assert.equal(batch.failure.code, "SCHEMA_MISMATCH");
  assert.deepEqual(batch.quotes, []);
});

test("network failure is retryable and cannot produce quotes", async () => {
  const batch = await runAtomicCollection({
    provider: jsonConfig.expectedProvider,
    sourceKind: "official_json",
    sourceUrl: jsonConfig.sourceUrl,
    fetchedAt,
  }, () => collectOfficialJsonFeed({
    ...jsonConfig,
    fetchImpl: async () => { throw new Error("offline"); },
  }));
  assert.equal(batch.state, "blocked");
  assert.equal(batch.failure.code, "NETWORK_FAILURE");
  assert.equal(batch.failure.retryable, true);
  assert.deepEqual(batch.quotes, []);
});

test("reviewed-page registry publishes only for the approved pricing-region hash", async () => {
  const [registryText, pageHtml] = await Promise.all([
    readFixture("reviewed-page/review-registry.json"),
    readFixture("reviewed-page/pricing-page.html"),
  ]);
  const quotes = await collectReviewedRegistry({
    ...reviewedConfig,
    registryText,
    fetchImpl: responseFetch(pageHtml, "text/html; charset=utf-8"),
  });
  assert.equal(quotes.length, 2);
  assert.equal(quotes[0].sourceKind, "official_page_reviewed");
  assert.equal(quotes[0].sourceContentHash, reviewedRegionHash(pageHtml));
  assert.equal(quotes[1].cachedInputPrice, null);
});

test("changes outside the approved pricing region do not create false alarms", async () => {
  const pageHtml = await readFixture("reviewed-page/pricing-page.html");
  const changedChrome = pageHtml
    .replace("Navigation that may change without invalidating prices", "New navigation")
    .replace("Footer may also change independently", "New footer");
  assert.equal(reviewedRegionHash(changedChrome), reviewedRegionHash(pageHtml));
});

test("price-page content changes require human review and publish nothing", async () => {
  const [registryText, pageHtml] = await Promise.all([
    readFixture("reviewed-page/review-registry.json"),
    readFixture("reviewed-page/pricing-page-changed.html"),
  ]);
  const batch = await runAtomicCollection({
    provider: reviewedConfig.expectedProvider,
    sourceKind: "official_page_reviewed",
    sourceUrl: reviewedConfig.sourceUrl,
    fetchedAt,
  }, () => collectReviewedRegistry({
    ...reviewedConfig,
    registryText,
    fetchImpl: responseFetch(pageHtml, "text/html"),
  }));
  assert.equal(batch.state, "review_required");
  assert.equal(batch.failure.code, "CONTENT_CHANGED");
  assert.deepEqual(batch.quotes, []);
});

test("missing reviewed-page marker blocks publication", async () => {
  const registryText = await readFixture("reviewed-page/review-registry.json");
  const batch = await runAtomicCollection({
    provider: reviewedConfig.expectedProvider,
    sourceKind: "official_page_reviewed",
    sourceUrl: reviewedConfig.sourceUrl,
    fetchedAt,
  }, () => collectReviewedRegistry({
    ...reviewedConfig,
    registryText,
    fetchImpl: responseFetch("<html><body>redesigned</body></html>", "text/html"),
  }));
  assert.equal(batch.state, "blocked");
  assert.equal(batch.failure.code, "PAGE_MARKER_MISSING");
  assert.deepEqual(batch.quotes, []);
});

test("publication candidate contains verified sources only", async () => {
  const [body, registryText, changedPage] = await Promise.all([
    readFixture("json/valid-feed.json"),
    readFixture("reviewed-page/review-registry.json"),
    readFixture("reviewed-page/pricing-page-changed.html"),
  ]);
  const jsonBatch = await runAtomicCollection({
    provider: jsonConfig.expectedProvider,
    sourceKind: "official_json",
    sourceUrl: jsonConfig.sourceUrl,
    fetchedAt,
  }, () => Promise.resolve(parseOfficialJsonFeed(body, jsonConfig)));
  const reviewBatch = await runAtomicCollection({
    provider: reviewedConfig.expectedProvider,
    sourceKind: "official_page_reviewed",
    sourceUrl: reviewedConfig.sourceUrl,
    fetchedAt,
  }, () => collectReviewedRegistry({
    ...reviewedConfig,
    registryText,
    fetchImpl: responseFetch(changedPage, "text/html"),
  }));
  const candidate = createPublicationCandidate([jsonBatch, reviewBatch]);
  assert.equal(candidate.state, "publishable");
  assert.equal(candidate.quotes.length, 3);
  assert.ok(candidate.quotes.every((quote) => quote.provider === "Fixture JSON Cloud"));
  assert.deepEqual(candidate.sourceSummary, [
    { provider: "Fixture JSON Cloud", state: "publishable", failureCode: null },
    { provider: "Fixture Reviewed Cloud", state: "review_required", failureCode: "CONTENT_CHANGED" },
  ]);
});
