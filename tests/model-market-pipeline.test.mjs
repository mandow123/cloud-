import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPendingSnapshot,
  createPromotedSnapshot,
  fetchTextWithRetry,
  parseEcbUsdCny,
  promoteModelMarket,
  stageModelMarket,
} from "../scripts/model-market/index.mjs";
import { runCli } from "../scripts/model-market/cli.mjs";
import { calendarIndexChange } from "../scripts/model-market/history.mjs";

const fixtureUrl = (name) => new URL(`../scripts/model-market/fixtures/${name}`, import.meta.url);
const fixture = (name) => readFile(fixtureUrl(name), "utf8");
const STAGED_AT = "2026-08-03T05:45:00+08:00";
const PROMOTED_AT = "2026-08-03T06:00:00+08:00";

function registry(count = 36) {
  return Array.from({ length: count }, (_, index) => ({
    id: `model-${String(index).padStart(2, "0")}`,
    vendor: `Vendor ${index % 12}`,
    model: `Fixture Model ${index}`,
    market: index % 2 === 0 ? "global" : "china",
    categories: [index % 3 === 0 ? "reasoning" : "general"],
    originalCurrency: "USD",
    inputPerMillion: 1,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 2,
    officialSourceName: "Fixture official pricing",
    officialSourceUrl: `https://vendor-${index % 12}.example/pricing`,
    sourceGrade: "A",
    serviceTier: "standard",
    contextBand: "32K-128K",
    availabilityNote: "fixture only",
    litellmCandidates: index === 0
      ? ["fixture/model-current"]
      : index === 1
        ? ["fixture/model-outlier"]
        : index === 2
          ? ["fixture/model-missing"]
          : [],
    indexMember: index < 4,
  }));
}

async function sourceFixtures() {
  return {
    ecb: await fixture("ecb-daily.xml"),
    litellm: await fixture("litellm-catalog.json"),
  };
}

function fixtureFetch({ ecb, litellm }) {
  return async (url) => {
    if (String(url).includes("ecb")) {
      return new Response(ecb, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response(litellm, { status: 200, headers: { "content-type": "application/json" } });
  };
}

async function validPending(options = {}) {
  const sources = await sourceFixtures();
  const cleanRegistry = registry();
  cleanRegistry[1].litellmCandidates = [];
  return buildPendingSnapshot({
    modelRegistry: cleanRegistry,
    usdCnyFallback: 7,
    now: STAGED_AT,
    fetchImpl: fixtureFetch(sources),
    ...options,
  });
}

test("HTTP collection retries retryable failures with exponential backoff and a timeout signal", async () => {
  let attempt = 0;
  const delays = [];
  const result = await fetchTextWithRetry("https://fixture.example/data", {
    attempts: 3,
    baseDelayMs: 5,
    timeoutMs: 100,
    sleepImpl: async (milliseconds) => delays.push(milliseconds),
    fetchImpl: async (_url, options) => {
      attempt += 1;
      assert.ok(options.signal instanceof AbortSignal);
      if (attempt < 3) return new Response("retry", { status: 503 });
      return new Response("ok", { status: 200 });
    },
  });
  assert.equal(result.text, "ok");
  assert.equal(result.attempts, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("ECB cross rate is derived from official EUR reference rates", async () => {
  const xml = await fixture("ecb-daily.xml");
  assert.equal(parseEcbUsdCny(xml), 7);
});

test("stage updates only an exact safe LiteLLM match and retains reviewed values for exceptions", async () => {
  const sources = await sourceFixtures();
  const previousSnapshot = {
    exchangeRate: { usdCny: 6.9 },
    quotes: [{
      id: "model-01",
      prices: { original: { currency: "USD", input: 1.1, cachedInput: 0.55, output: 2.2 } },
      sourceStatus: "aggregated",
      secondarySource: {
        catalog: "LiteLLM",
        exactKey: "fixture/model-previous",
        sourceUrl: "https://example.test/litellm.json",
      },
    }],
  };
  const pending = await buildPendingSnapshot({
    modelRegistry: registry(),
    usdCnyFallback: 6.8,
    previousSnapshot,
    now: STAGED_AT,
    fetchImpl: fixtureFetch(sources),
  });

  assert.equal(pending.quotes.length, 36);
  assert.equal(pending.validation.vendorCount, 12);
  assert.equal(pending.exchangeRate.usdCny, 7);

  const current = pending.quotes[0];
  assert.equal(current.freshness.state, "current");
  assert.equal(current.secondarySource.exactKey, "fixture/model-current");
  assert.equal(current.originalInputPerMillion, 1.05);
  assert.equal(current.inputCnyPerMillion, 7.35);
  assert.equal(current.sourceStatus, "aggregated");
  assert.equal(current.aggregationScope, "single_model");
  assert.equal(current.serviceTier, "standard");
  assert.equal(current.contextBand, "32K-128K");

  const outlier = pending.quotes[1];
  assert.equal(outlier.freshness.state, "review_required");
  assert.equal(outlier.originalInputPerMillion, 1.1);
  assert.equal(outlier.isStale, true);
  assert.equal(outlier.sourceStatus, "aggregated");
  assert.match(outlier.sourceName, /LiteLLM/);

  const missing = pending.quotes[2];
  assert.equal(missing.freshness.state, "stale");
  assert.equal(missing.originalInputPerMillion, 1);
  assert.ok(pending.quotes.every((quote) => quote.inputCnyPerMillion > 0 && quote.outputCnyPerMillion > 0));
});

test("secondary-source failure produces a complete stale table and never a zero or partial table", async () => {
  const { ecb } = await sourceFixtures();
  let litellmAttempts = 0;
  const pending = await buildPendingSnapshot({
    modelRegistry: registry(),
    usdCnyFallback: 7,
    now: STAGED_AT,
    attempts: 2,
    baseDelayMs: 1,
    sleepImpl: async () => {},
    fetchImpl: async (url) => {
      if (String(url).includes("ecb")) return new Response(ecb, { status: 200 });
      litellmAttempts += 1;
      throw new Error("offline");
    },
  });
  assert.equal(litellmAttempts, 2);
  assert.equal(pending.sources.litellm.state, "stale");
  assert.equal(pending.quotes.length, 36);
  assert.equal(pending.quotes[0].freshness.state, "stale");
  assert.equal(pending.quotes[0].originalInputPerMillion, 1);
  assert.ok(pending.quotes.every((quote) => quote.originalInputPerMillion > 0 && quote.originalOutputPerMillion > 0));
  assert.throws(
    () => createPromotedSnapshot(pending, { now: PROMOTED_AT }),
    (error) => error.code === "SOURCE_UNAVAILABLE",
  );
});

test("an out-of-threshold previous aggregate falls back to official values and official provenance", async () => {
  const single = registry(1);
  const previousSnapshot = {
    exchangeRate: { usdCny: 7 },
    quotes: [{
      id: single[0].id,
      sourceStatus: "aggregated",
      prices: { original: { currency: "USD", input: 10, cachedInput: 5, output: 20 } },
      secondarySource: {
        catalog: "LiteLLM",
        exactKey: "fixture/old",
        sourceUrl: "https://example.test/old-catalog.json",
      },
    }],
  };
  const pending = await buildPendingSnapshot({
    modelRegistry: single,
    usdCnyFallback: 7,
    previousSnapshot,
    now: STAGED_AT,
    attempts: 1,
    fetchImpl: async () => { throw new Error("offline"); },
  });
  const quote = pending.quotes[0];
  assert.equal(quote.originalInputPerMillion, single[0].inputPerMillion);
  assert.equal(quote.originalOutputPerMillion, single[0].outputPerMillion);
  assert.equal(quote.sourceStatus, "official_page");
  assert.equal(quote.sourceName, single[0].officialSourceName);
  assert.equal(quote.sourceUrl, single[0].officialSourceUrl);
});

test("an invalid registry cannot overwrite an existing pending file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-model-stage-"));
  const pendingPath = join(directory, "model-market.pending.json");
  const sentinel = "{\"safe\":true}\n";
  await writeFile(pendingPath, sentinel, "utf8");
  const broken = registry();
  broken[7].outputPerMillion = 0;
  await assert.rejects(
    stageModelMarket({
      modelRegistry: broken,
      usdCnyFallback: 7,
      now: STAGED_AT,
      pendingPath,
      fetchImpl: async () => { throw new Error("must not fetch"); },
    }),
    (error) => error.code === "INVALID_PRICE",
  );
  assert.equal(await readFile(pendingPath, "utf8"), sentinel);
});

test("promote accepts a fresh 30+/12-vendor table and starts a fixed basket at 100", async () => {
  const pending = await validPending();
  const snapshot = createPromotedSnapshot(pending, { now: PROMOTED_AT });
  assert.equal(snapshot.quotes.length, 36);
  assert.equal(snapshot.index.kind, "fixed_basket_index");
  assert.equal(snapshot.index.value, 100);
  assert.equal(snapshot.index.baseDate, "2026-08-03");
  assert.equal(snapshot.index.sampleSize, 4);
  assert.equal(snapshot.index.change1d, null);
  assert.equal(snapshot.index.change30d, null);
  assert.equal(snapshot.index.history.length, 1);
  assert.equal(snapshot.quotes[0].serviceTier, "standard");
  assert.equal(snapshot.quotes[0].contextBand, "32K-128K");
  assert.equal(snapshot.index.isProcurementPrice, false);
  assert.equal(Object.hasOwn(snapshot, "averagePrice"), false);
});

test("index changes require complete 1, 7 and 30 calendar-day boundaries", () => {
  const changeAtSpan = (span, interval) => calendarIndexChange([
    { date: "2026-08-01", value: 100 },
    { date: new Date(Date.UTC(2026, 7, 1 + span)).toISOString().slice(0, 10), value: 110 },
  ], new Date(Date.UTC(2026, 7, 1 + span)).toISOString().slice(0, 10), 110, interval);

  assert.equal(changeAtSpan(1, 1), 10, "one complete calendar day enables 1-day change");
  assert.equal(changeAtSpan(6, 7), null, "six days cannot stand in for seven days");
  assert.equal(changeAtSpan(7, 7), 10, "seven complete calendar days enable 7-day change");
  assert.equal(changeAtSpan(29, 30), null, "twenty-nine days cannot stand in for thirty days");
  assert.equal(changeAtSpan(30, 30), 10, "thirty complete calendar days enable 30-day change");
});

test("promote rejects stale, incomplete, negative, zero and cross-model-average candidates", async () => {
  const pending = await validPending();

  const stale = structuredClone(pending);
  stale.generatedAt = "2026-08-03T04:59:59+08:00";
  assert.throws(() => createPromotedSnapshot(stale, { now: PROMOTED_AT }), (error) => error.code === "STALE_PENDING");

  const incomplete = structuredClone(pending);
  incomplete.quotes = incomplete.quotes.slice(0, 29);
  incomplete.validation.quoteCount = 29;
  incomplete.validation.vendorCount = new Set(incomplete.quotes.map((quote) => quote.vendor)).size;
  assert.throws(() => createPromotedSnapshot(incomplete, { now: PROMOTED_AT }), (error) => error.code === "INSUFFICIENT_QUOTES");

  const negative = structuredClone(pending);
  negative.quotes[0].prices.cny.input = -1;
  negative.quotes[0].inputCnyPerMillion = -1;
  assert.throws(() => createPromotedSnapshot(negative, { now: PROMOTED_AT }), (error) => error.code === "INVALID_PRICE");

  const zero = structuredClone(pending);
  zero.quotes[0].prices.original.output = 0;
  zero.quotes[0].originalOutputPerMillion = 0;
  zero.quotes[0].outputPerMillion = 0;
  zero.quotes[0].prices.cny.output = 0;
  zero.quotes[0].outputCnyPerMillion = 0;
  assert.throws(() => createPromotedSnapshot(zero, { now: PROMOTED_AT }), (error) => error.code === "INVALID_PRICE");

  const averaged = structuredClone(pending);
  averaged.averagePrice = 12.34;
  assert.throws(() => createPromotedSnapshot(averaged, { now: PROMOTED_AT }), (error) => error.code === "CROSS_MODEL_AVERAGE");

  const disguisedHalfTable = structuredClone(pending);
  const trustedIds = disguisedHalfTable.sources.officialRegistry.registeredIds;
  disguisedHalfTable.quotes = disguisedHalfTable.quotes.slice(0, 35);
  disguisedHalfTable.validation.quoteCount = 35;
  disguisedHalfTable.validation.registeredModelCount = 35;
  disguisedHalfTable.validation.pricedQuoteCount = 35;
  disguisedHalfTable.validation.vendorCount = new Set(disguisedHalfTable.quotes.map((quote) => quote.vendor)).size;
  disguisedHalfTable.sources.officialRegistry.registeredIds = trustedIds.slice(0, 35);
  disguisedHalfTable.sources.officialRegistry.registeredModelCount = 35;
  disguisedHalfTable.sources.officialRegistry.quoteCount = 35;
  disguisedHalfTable.sources.officialRegistry.pricedQuoteCount = 35;
  assert.throws(
    () => createPromotedSnapshot(disguisedHalfTable, { now: PROMOTED_AT, expectedRegistryIds: trustedIds }),
    (error) => error.code === "REGISTRY_CONTRACT_MISMATCH",
  );

  for (const mutate of [
    (quote) => { quote.sourceStatus = "corrupt"; },
    (quote) => { quote.sourceUrl = "not-a-url"; },
    (quote) => { quote.freshness.state = "stale"; quote.isStale = false; },
  ]) {
    const corrupt = structuredClone(pending);
    mutate(corrupt.quotes[0]);
    assert.throws(
      () => createPromotedSnapshot(corrupt, { now: PROMOTED_AT }),
      (error) => error.code === "INVALID_PROVENANCE",
    );
  }
});

test("promote writes atomically only after validation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-model-promote-"));
  const snapshotPath = join(directory, "model-market.snapshot.json");
  const pending = await validPending();
  const snapshot = await promoteModelMarket({ pending, snapshotPath, now: PROMOTED_AT });
  assert.deepEqual(JSON.parse(await readFile(snapshotPath, "utf8")), snapshot);

  const broken = structuredClone(pending);
  broken.quotes[0].outputCnyPerMillion = -1;
  broken.quotes[0].prices.cny.output = -1;
  await assert.rejects(
    promoteModelMarket({ pending: broken, snapshotPath, now: PROMOTED_AT }),
    (error) => error.code === "INVALID_PRICE",
  );
  assert.deepEqual(JSON.parse(await readFile(snapshotPath, "utf8")), snapshot);
});

test("subsequent promotion keeps the original basket and caps history at 90 Beijing dates", async () => {
  const firstPending = await validPending();
  const first = createPromotedSnapshot(firstPending, { now: PROMOTED_AT });
  first.index.history = Array.from({ length: 90 }, (_, index) => ({
    date: new Date(Date.UTC(2026, 4, 1 + index)).toISOString().slice(0, 10),
    value: 100,
  }));

  const next = structuredClone(firstPending);
  next.generatedAt = "2026-08-04T05:45:00+08:00";
  for (const quote of next.quotes) {
    quote.prices.cny.input *= 1.1;
    quote.prices.cny.output *= 1.1;
    quote.inputCnyPerMillion *= 1.1;
    quote.outputCnyPerMillion *= 1.1;
  }
  const second = createPromotedSnapshot(next, {
    now: "2026-08-04T06:00:00+08:00",
    previousSnapshot: first,
  });
  assert.equal(second.index.value, 110);
  assert.equal(second.index.history.length, 90);
  assert.equal(second.index.history.at(-1).date, "2026-08-04");
  assert.equal(second.index.baseDate, "2026-08-03");
  assert.deepEqual(second.index.basket, first.index.basket);
});

test("the reviewed production registry can stage and promote as a complete offline fallback", async () => {
  const [{ modelRegistry, USD_CNY_FALLBACK }, sources] = await Promise.all([
    import("../data/model-market-registry.mjs"),
    sourceFixtures(),
  ]);
  const pending = await buildPendingSnapshot({
    modelRegistry,
    usdCnyFallback: USD_CNY_FALLBACK,
    now: STAGED_AT,
    fetchImpl: fixtureFetch(sources),
  });
  assert.equal(pending.quotes.length, modelRegistry.length);
  assert.ok(pending.quotes.length >= 30);
  assert.ok(new Set(pending.quotes.map((quote) => quote.vendor)).size >= 12);
  assert.equal(pending.quotes.filter((quote) => quote.hasReviewedPrice === false).length, 3);
  assert.ok(pending.quotes.filter((quote) => quote.hasReviewedPrice === false).every((quote) => (
    quote.inputCnyPerMillion === null
      && quote.outputCnyPerMillion === null
      && quote.isStale === true
      && quote.indexMember === false
  )));
  const snapshot = createPromotedSnapshot(pending, { now: PROMOTED_AT });
  assert.equal(snapshot.quotes.length, modelRegistry.length);
  assert.equal(snapshot.index.value, 100);
  assert.ok(snapshot.index.sampleSize > 0);
});

test("stage and promote CLI commands share the validated pending/snapshot contract", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-model-cli-"));
  const pendingPath = join(directory, "model-market.pending.json");
  const snapshotPath = join(directory, "model-market.snapshot.json");
  const sources = await sourceFixtures();
  const cliRegistry = registry();
  cliRegistry[1].litellmCandidates = [];
  const registryModule = { modelRegistry: cliRegistry, USD_CNY_FALLBACK: 7 };
  const staged = await runCli("stage", {
    registryModule,
    pendingPath,
    snapshotPath,
    now: STAGED_AT,
    fetchImpl: fixtureFetch(sources),
  });
  assert.equal(staged.quoteCount, 36);
  const promoted = await runCli("promote", { registryModule, pendingPath, snapshotPath, now: PROMOTED_AT });
  assert.equal(promoted.quoteCount, 36);
  assert.equal(promoted.index, 100);
});

test("update CLI command stages and promotes in one scheduler-safe run", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kai-model-update-cli-"));
  const pendingPath = join(directory, "model-market.pending.json");
  const snapshotPath = join(directory, "model-market.snapshot.json");
  const sources = await sourceFixtures();
  const cliRegistry = registry();
  cliRegistry[1].litellmCandidates = [];
  const result = await runCli("update", {
    registryModule: { modelRegistry: cliRegistry, USD_CNY_FALLBACK: 7 },
    pendingPath,
    snapshotPath,
    now: STAGED_AT,
    fetchImpl: fixtureFetch(sources),
  });
  assert.equal(result.command, "update");
  assert.equal(result.quoteCount, 36);
  assert.equal(result.index, 100);
});
