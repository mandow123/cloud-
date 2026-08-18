import assert from "node:assert/strict";
import test from "node:test";

import {
  DEAL_MODES,
  MARKET_REFERENCE_NOTICE,
  PRICING_UNITS,
  RESOURCE_CATEGORIES,
  createInitializationRequestId,
  filterAndSortResources,
  filterResources,
  findServiceAlias,
  formatPrice,
  marketSeries,
  parseResourceQuery,
  regions,
  resourceListings,
  serviceAliases,
  sortResources,
  suppliers,
} from "../lib/catalog.mjs";
import { SUPPLIER_LISTING_PRICE_MULTIPLIER } from "../lib/pricing-policy.mjs";

test("catalog has the planned initialization inventory shape", () => {
  assert.equal(resourceListings.length, 124);
  assert.equal(suppliers.length, 8);
  assert.equal(regions.length, 8);
  assert.equal(new Set(resourceListings.map((item) => item.id)).size, 124);
  assert.equal(new Set(suppliers.map((item) => item.id)).size, 8);

  for (const category of RESOURCE_CATEGORIES) {
    assert.equal(
      resourceListings.filter((item) => item.category === category).length,
      category === "gpu" ? 106 : 6,
      `${category} should include the curated catalog plus approved source directory records`,
    );
  }
  assert.doesNotMatch(
    JSON.stringify({ resourceListings, suppliers }),
    /"(?:demo|fictional)":true|supplierId":"demo-/iu,
  );
});

test("user-provided supplier directory is complete, attributed and explicitly unverified", () => {
  const sourced = resourceListings.filter((item) => item.source?.kind === "USER_PROVIDED_WORKBOOK_REFERENCE");
  assert.equal(sourced.length, 100);
  assert.equal(new Set(sourced.map((item) => item.supplierName)).size, 100);
  assert.equal(sourced.filter((item) => item.region === "全国").length, 65);
  assert.equal(sourced.filter((item) => item.region === "海外").length, 35);
  assert.equal(sourced.filter((item) => item.specs["源报价 B300 时租参考"] !== "报价单未提供").length, 4);
  for (const listing of sourced) {
    assert.equal(listing.source.documentTitle, "GPU算力租赁报价单_100家供应商.xlsx");
    assert.equal(listing.source.observedAt, "2026-08-17");
    assert.equal(listing.source.verificationStatus, "UNVERIFIED");
    assert.equal(listing.source.supplierName, listing.supplierName);
    assert.match(listing.source.notice, /不代表 KAI 已完成供应商入驻、库存验真或价格确认/u);
    assert.match(listing.capacity, /未经 KAI 验真/u);
    assert.match(listing.specs["源报价 H100 时租参考"], /^\d+\.\d{2} KAI 标准卡时 \/ GPU 小时$/u);
    assert.equal(listing.source.listingPriceMultiplier, SUPPLIER_LISTING_PRICE_MULTIPLIER);
    assert.match(listing.quote.scopeNote, /150%/u);
  }
});

test("every supplier listing applies the unified 50 percent platform markup", () => {
  assert.equal(SUPPLIER_LISTING_PRICE_MULTIPLIER, 1.5);
  const curatedH100 = resourceListings.find((item) => item.id === "gpu-h100-sxm-8-bj");
  const sourcedAlibaba = resourceListings.find((item) => item.id === "gpu-supplier-reference-001");

  assert.deepEqual(
    [curatedH100.quote.rangeMin, curatedH100.quote.median, curatedH100.quote.rangeMax],
    [41.7, 46.8, 51.9],
  );
  assert.deepEqual(
    [sourcedAlibaba.quote.rangeMin, sourcedAlibaba.quote.median, sourcedAlibaba.quote.rangeMax],
    [25.2, 25.2, 25.2],
  );
  assert.equal(sourcedAlibaba.specs["源报价 H100 时租参考"], "16.77 KAI 标准卡时 / GPU 小时");
  assert.ok(resourceListings.every((item) => item.quote.scopeNote.includes("上调 50%") || item.quote.scopeNote.includes("150%")));
});

test("all ten business aliases map to valid category, deal and unit values", () => {
  const expectedNames = [
    "算力置换",
    "算力租赁",
    "GPU置换",
    "GPU租赁",
    "Token小时服务",
    "模型小时服务",
    "模型容量小时服务",
    "算力容量小时服务",
    "算力容量租赁",
    "算力容量置换",
  ];
  assert.equal(serviceAliases.length, 10);
  assert.deepEqual(serviceAliases.map((alias) => alias.label), expectedNames);
  for (const alias of serviceAliases) {
    assert.ok(RESOURCE_CATEGORIES.includes(alias.category));
    assert.ok(DEAL_MODES.includes(alias.dealMode));
    assert.ok(PRICING_UNITS.includes(alias.pricingUnit));
    assert.equal(findServiceAlias(alias.slug), alias);
    assert.equal(findServiceAlias(alias.label), alias);
  }
  assert.equal(findServiceAlias("GPU 租赁")?.label, "GPU租赁");
});

test("every listing quote declares price range, scope, freshness and reference status", () => {
  for (const listing of resourceListings) {
    const quote = listing.quote;
    assert.equal(quote.currency, "CNY");
    assert.ok(PRICING_UNITS.includes(quote.pricingUnit));
    assert.equal(quote.pricingUnit, listing.pricingUnit);
    assert.ok(quote.rangeMin <= quote.median);
    assert.ok(quote.median <= quote.rangeMax);
    assert.equal(typeof quote.taxIncluded, "boolean");
    assert.equal(typeof quote.energyIncluded, "boolean");
    assert.equal(typeof quote.networkIncluded, "boolean");
    assert.ok(quote.scopeNote.length > 8);
    assert.ok(quote.sampleCount > 0);
    assert.ok(Number.isFinite(Date.parse(quote.updatedAt)));
    assert.ok(Number.isFinite(Date.parse(quote.validUntil)));
    assert.ok(Date.parse(quote.validUntil) > Date.parse(quote.updatedAt));
    assert.equal(quote.disclaimer, MARKET_REFERENCE_NOTICE);
    assert.match(quote.disclaimer, /市场参考报价/);
    assert.match(quote.disclaimer, /询价确认/);
    assert.doesNotMatch(JSON.stringify(listing), /演示|虚构|非实时成交价|模拟/u);
  }
});

test("market series provide deterministic 90-day quartiles for four categories", () => {
  assert.equal(marketSeries.length, 4);
  assert.deepEqual(
    marketSeries.map((series) => series.category),
    RESOURCE_CATEGORIES,
  );
  for (const series of marketSeries) {
    assert.equal(series.points.length, 90);
    assert.equal(series.points[0].date, "2026-05-04");
    assert.equal(series.points.at(-1).date, "2026-08-01");
    assert.ok(series.points.every((point) => point.p25 <= point.p50 && point.p50 <= point.p75));
    assert.ok(series.points.every((point) => point.sampleCount > 0));
    assert.equal(series.disclaimer, MARKET_REFERENCE_NOTICE);
  }
});

test("URL query parsing validates enum values and filtering combines dimensions", () => {
  const filters = parseResourceQuery(
    "?category=gpu&deal=rental&region=北京&delivery=裸金属&unit=卡时&sort=price_asc",
  );
  assert.deepEqual(filters, {
    category: "gpu",
    dealMode: "rental",
    region: "北京",
    deliveryForm: "裸金属",
    pricingUnit: "卡时",
    sort: "price_asc",
  });
  const matches = filterAndSortResources(resourceListings, filters);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, "gpu-h100-sxm-8-bj");

  assert.deepEqual(parseResourceQuery("?category=unknown&sort=nope"), { sort: "featured" });
  assert.equal(filterResources(resourceListings, { region: "北京", pricingUnit: "kW 月" }).length, 0);
});

test("alias-aware search, sort and explicit empty state work", () => {
  const gpuRentals = filterResources(resourceListings, { q: "GPU租赁" });
  assert.ok(gpuRentals.length > 0);
  assert.ok(gpuRentals.every((item) => item.category === "gpu"));
  assert.ok(gpuRentals.every((item) => item.dealModes.includes("rental")));
  assert.ok(gpuRentals.every((item) => item.pricingUnit === "卡时"));

  const ascending = sortResources(gpuRentals, "price_asc");
  assert.ok(ascending.every((item, index) => index === 0 || ascending[index - 1].quote.median <= item.quote.median));
  assert.deepEqual(filterResources(resourceListings, { q: "不存在的资源XYZ" }), []);
});

test("all planned pricing units appear and prices are formatted with clear units", () => {
  const usedUnits = new Set(resourceListings.map((listing) => listing.pricingUnit));
  assert.deepEqual([...usedUnits].sort(), [...PRICING_UNITS].sort());
  assert.equal(formatPrice(31.2, "卡时"), "¥31.20 / 卡时");
  assert.match(formatPrice(22100, "机柜月"), /¥22,100 \/ 机柜月/);
  assert.equal(formatPrice(Number.NaN, "卡时"), "—");
});

test("initialization request IDs are stable, typed and collision-free for distinct seeds", () => {
  const first = createInitializationRequestId("rental", { listing: "gpu-h100", quantity: 8 });
  const same = createInitializationRequestId("rental", { quantity: 8, listing: "gpu-h100" });
  const second = createInitializationRequestId("rental", { listing: "gpu-h100", quantity: 16 });
  const swap = createInitializationRequestId("swap", { listing: "gpu-h100", quantity: 8 });
  assert.equal(first, same);
  assert.notEqual(first, second);
  assert.notEqual(first, swap);
  assert.match(first, /^KAI-RNT-INIT-[0-9A-Z]{7}$/);
  assert.match(swap, /^KAI-SWP-INIT-[0-9A-Z]{7}$/);
  assert.throws(() => createInitializationRequestId("invalid", "seed"), /Unsupported/);
});
