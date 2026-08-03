import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  USD_CNY_FALLBACK,
  modelRegistry,
} from "../data/model-market-registry.mjs";

const expectedKeys = [
  "id",
  "vendor",
  "model",
  "market",
  "categories",
  "originalCurrency",
  "inputPerMillion",
  "cachedInputPerMillion",
  "outputPerMillion",
  "officialSourceName",
  "officialSourceUrl",
  "sourceGrade",
  "serviceTier",
  "contextBand",
  "availabilityNote",
  "litellmCandidates",
  "indexMember",
].sort();

const expectedVendors = [
  "DeepSeek",
  "阿里云百炼 / Qwen",
  "火山方舟 / 豆包",
  "百度千帆 / ERNIE",
  "腾讯云 TokenHub / 混元",
  "智谱",
  "Moonshot / Kimi",
  "MiniMax",
  "百川",
  "讯飞星火",
  "OpenAI",
  "Anthropic",
  "Google",
  "xAI",
  "Mistral",
  "Cohere",
].sort();

const publishedSnapshot = JSON.parse(
  readFileSync(new URL("../data/model-market.snapshot.json", import.meta.url), "utf8"),
);

test("registry covers the complete researched mainstream vendor matrix", () => {
  const vendors = [...new Set(modelRegistry.map((row) => row.vendor))].sort();
  const models = new Set(modelRegistry.map((row) => `${row.vendor}|${row.model}`));

  assert.equal(modelRegistry.length, 55);
  assert.deepEqual(vendors, expectedVendors);
  assert.equal(models.size, 43);
  assert.ok(vendors.length >= 14);
  assert.ok(models.size >= 30);
  assert.ok(modelRegistry.some((row) => row.market === "domestic"));
  assert.ok(modelRegistry.some((row) => row.market === "international"));
});

test("every row has the exact public schema and a unique id", () => {
  const ids = new Set();

  for (const row of modelRegistry) {
    assert.deepEqual(Object.keys(row).sort(), expectedKeys, row.id);
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(ids.has(row.id), false, `duplicate id: ${row.id}`);
    ids.add(row.id);

    for (const field of [
      "vendor",
      "model",
      "officialSourceName",
      "officialSourceUrl",
      "serviceTier",
      "contextBand",
      "availabilityNote",
    ]) {
      assert.equal(typeof row[field], "string", `${row.id}.${field}`);
      assert.ok(row[field].length > 0, `${row.id}.${field}`);
    }

    assert.match(row.officialSourceUrl, /^https:\/\//, row.id);
    assert.ok(["domestic", "international"].includes(row.market), row.id);
    assert.ok(["A", "B", "C"].includes(row.sourceGrade), row.id);
    assert.equal(row.originalCurrency, row.market === "domestic" ? "CNY" : "USD");
    assert.equal(typeof row.indexMember, "boolean", row.id);
  }
});

test("categories, prices, and LiteLLM candidates are structurally valid", () => {
  const allowedCategories = new Set([
    "text",
    "reasoning",
    "multimodal",
    "embedding",
  ]);

  for (const row of modelRegistry) {
    assert.ok(Array.isArray(row.categories) && row.categories.length > 0, row.id);
    assert.equal(new Set(row.categories).size, row.categories.length, row.id);
    for (const category of row.categories) {
      assert.ok(allowedCategories.has(category), `${row.id}: ${category}`);
    }

    for (const field of [
      "inputPerMillion",
      "cachedInputPerMillion",
      "outputPerMillion",
    ]) {
      const value = row[field];
      assert.ok(
        value === null || (Number.isFinite(value) && value >= 0),
        `${row.id}.${field}`,
      );
    }

    assert.ok(Array.isArray(row.litellmCandidates), row.id);
    assert.ok(
      row.litellmCandidates.every(
        (candidate) => typeof candidate === "string" && candidate.length > 0,
      ),
      row.id,
    );

    if (row.indexMember) {
      assert.notEqual(row.inputPerMillion, null, row.id);
      assert.notEqual(row.outputPerMillion, null, row.id);
    }
  }
});

test("unstable unpriced models remain visible but never enter the index", () => {
  const unpriced = modelRegistry.filter(
    (row) => row.inputPerMillion === null || row.outputPerMillion === null,
  );

  assert.deepEqual(
    unpriced.map((row) => row.model).sort(),
    ["Spark Ultra", "Spark X2", "Spark X2 Flash"].sort(),
  );
  assert.ok(unpriced.every((row) => row.sourceGrade === "C"));
  assert.ok(unpriced.every((row) => row.indexMember === false));
});

test("different context and service price tiers are represented as separate rows", () => {
  const rowsFor = (vendor, model) =>
    modelRegistry.filter((row) => row.vendor === vendor && row.model === model);

  assert.equal(rowsFor("阿里云百炼 / Qwen", "qwen3.7-plus-2026-05-26").length, 2);
  assert.equal(rowsFor("百度千帆 / ERNIE", "ERNIE-5.1").length, 2);
  assert.equal(rowsFor("腾讯云 TokenHub / 混元", "Hy3 Preview").length, 3);
  assert.equal(rowsFor("智谱", "GLM-5.1").length, 2);
  assert.equal(rowsFor("Moonshot / Kimi", "kimi-k2.7-code").length, 2);
  assert.equal(rowsFor("MiniMax", "MiniMax-M3").length, 2);
  assert.equal(rowsFor("Google", "Gemini 3.1 Pro Preview").length, 2);
  assert.equal(rowsFor("Google", "Gemini 3.1 Flash-Lite").length, 2);
  assert.equal(rowsFor("xAI", "Grok 4.5").length, 2);

  const accessibleVariants = modelRegistry.map((row) => (
    `${row.vendor}|${row.model}|${row.serviceTier}|${row.contextBand}`
  ));
  assert.equal(
    new Set(accessibleVariants).size,
    accessibleVariants.length,
    "vendor, model, service tier and context band must identify every visible price row",
  );
});

test("official research spot prices are preserved in original currency", () => {
  const byId = new Map(modelRegistry.map((row) => [row.id, row]));

  assert.deepEqual(
    [
      byId.get("deepseek-v4-flash-0731-standard").inputPerMillion,
      byId.get("deepseek-v4-flash-0731-standard").cachedInputPerMillion,
      byId.get("deepseek-v4-flash-0731-standard").outputPerMillion,
    ],
    [0.14, 0.0028, 0.28],
  );
  assert.deepEqual(
    [
      byId.get("openai-gpt-56-terra-standard").inputPerMillion,
      byId.get("openai-gpt-56-terra-standard").cachedInputPerMillion,
      byId.get("openai-gpt-56-terra-standard").outputPerMillion,
    ],
    [2, 0.2, 12],
  );
  assert.deepEqual(
    [
      byId.get("google-gemini-31-pro-preview-over-200k").inputPerMillion,
      byId.get("google-gemini-31-pro-preview-over-200k").cachedInputPerMillion,
      byId.get("google-gemini-31-pro-preview-over-200k").outputPerMillion,
    ],
    [4, 0.4, 18],
  );
});

test("USD/CNY fallback matches the locked ECB 2026-07-31 calculation", () => {
  assert.equal(USD_CNY_FALLBACK, 6.751328);
  assert.equal(Number.isFinite(USD_CNY_FALLBACK), true);
  assert.ok(USD_CNY_FALLBACK > 0);
});

test("every published quote remains traceable to its reviewed registry row", () => {
  const quoteById = new Map(publishedSnapshot.quotes.map((quote) => [quote.id, quote]));

  assert.equal(quoteById.size, modelRegistry.length);
  for (const row of modelRegistry) {
    const quote = quoteById.get(row.id);
    assert.ok(quote, `missing published quote: ${row.id}`);
    assert.equal(quote.vendor, row.vendor, row.id);
    assert.equal(quote.model, row.model, row.id);
    assert.equal(quote.originalCurrency, row.originalCurrency, row.id);
    assert.equal(quote.officialSourceName, row.officialSourceName, row.id);
    assert.equal(quote.officialSourceUrl, row.officialSourceUrl, row.id);
    assert.equal(quote.serviceTier, row.serviceTier, row.id);
    assert.equal(quote.contextBand, row.contextBand, row.id);
    if (quote.sourceStatus === "official_page") {
      assert.equal(quote.originalInputPerMillion, row.inputPerMillion, row.id);
      assert.equal(quote.originalCachedInputPerMillion, row.cachedInputPerMillion, row.id);
      assert.equal(quote.originalOutputPerMillion, row.outputPerMillion, row.id);
      assert.equal(quote.sourceName, row.officialSourceName, row.id);
      assert.equal(quote.sourceUrl, row.officialSourceUrl, row.id);
    } else {
      assert.equal(quote.sourceStatus, "aggregated", row.id);
      assert.match(quote.sourceName, /LiteLLM/, row.id);
      assert.equal(quote.sourceUrl, quote.secondarySource?.sourceUrl, row.id);
      for (const [actual, reviewed] of [
        [quote.originalInputPerMillion, row.inputPerMillion],
        [quote.originalOutputPerMillion, row.outputPerMillion],
      ]) {
        assert.ok(Math.abs(actual - reviewed) / reviewed <= 0.25, row.id);
      }
    }
    assert.match(quote.sourceUrl, /^https:\/\//, row.id);
  }
});
