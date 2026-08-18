import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { resourceListings } from "../lib/catalog.mjs";
import { summarizeResourceCatalog } from "../lib/resource-freshness.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("all 24 bundled resource records are disclosed as expired historical references", () => {
  const summary = summarizeResourceCatalog(resourceListings, Date.parse("2026-08-17T00:00:00.000Z"));
  assert.equal(summary.total, 24);
  assert.equal(summary.current, 0);
  assert.equal(summary.expiring, 0);
  assert.equal(summary.expired, 24);
  assert.ok(resourceListings.every((listing) => listing.dataClass === "STATIC_SAMPLE" && listing.quote.dataClass === "MARKET_REFERENCE"));

  const home = read("app/page.tsx");
  const explorer = read("components/resource-explorer.tsx");
  const detail = read("app/resources/[id]/page.tsx");
  for (const source of [home, explorer, detail]) {
    assert.match(source, /历史初始化样本/u);
    assert.match(source, /报价已过期/u);
  }
  assert.doesNotMatch(explorer, /MATCHED INVENTORY|\/checkout\//u);
  assert.match(explorer, /提交需求后重新核验/u);
});

test("model directory prices are never presented as verified resources or inventory", () => {
  const hero = read("components/live-home-market-hero.tsx");
  const liveBoard = read("components/live-model-price-board.tsx");
  const board = read("components/model-price-board.tsx");
  assert.match(hero, /模型价格档位不是已核验资源、库存或可成交报价/u);
  assert.doesNotMatch(hero, /可交易报价|条已核验资源/u);
  assert.match(liveBoard, /不是已核验资源或可购买库存/u);
  assert.match(board, /不是 KAI 已核验算力资源、库存或可成交报价/u);
  assert.match(board, /数据格式校验通过/u);
  assert.doesNotMatch(board, /已通过自动校验/u);
});

test("GPU purchase surfaces use two-decimal KAI card-hours without fiat equivalents", () => {
  const paths = [
    "components/hosting-gpu-marketplace.tsx",
    "components/hosting-offer-checkout.tsx",
    "components/supply-offer-create.tsx",
    "components/supply-earnings.tsx",
    "app/hosting/earnings/page.tsx",
  ];
  for (const path of paths) {
    const source = read(path);
    assert.doesNotMatch(source, /¥|人民币参考|1\.002/u, `${path} must not expose a fiat transaction equivalent`);
  }
  assert.match(read("lib/card-hours.ts"), /minimumFractionDigits:\s*2, maximumFractionDigits:\s*2/u);
  assert.match(read("components/hosting-gpu-marketplace.tsx"), /KAI 标准卡时 \/ GPU 小时/u);
  assert.match(read("components/hosting-offer-checkout.tsx"), /实际按秒计量 · 多退少补/u);
});

test("mounted public and member trading surfaces never expose fiat quote copy", () => {
  const paths = [
    "app/guides/page.tsx",
    "app/methodology/page.tsx",
    "app/hosting/earnings/page.tsx",
    "components/live-home-market-hero.tsx",
    "components/live-model-price-board.tsx",
    "components/market-dashboard.tsx",
    "components/model-price-board.tsx",
    "components/resource-explorer.tsx",
    "components/request-workbench.tsx",
    "components/member-workspace.tsx",
    "components/buyer-order-list.tsx",
    "components/order-detail.tsx",
    "components/buy-workspace.tsx",
    "components/hosting-gpu-marketplace.tsx",
    "components/hosting-offer-checkout.tsx",
    "components/supply-offer-create.tsx",
    "components/supply-earnings.tsx",
  ];
  for (const path of paths) {
    assert.doesNotMatch(read(path), /¥|￥|人民币|折合人民币|参考人民币|网站人民币价/u, `${path} must quote and settle only in card-hours`);
  }
});

test("/gpu is the only live market, /buy is a flag-controlled rollback workspace, and /resources is discovery only", () => {
  const home = read("components/live-home-market-hero.tsx");
  const buy = read("components/buy-workspace.tsx");
  const buyPage = read("app/buy/page.tsx");
  const explorer = read("components/resource-explorer.tsx");
  const legacyCheckout = read("app/checkout/[resourceId]/page.tsx");
  assert.match(home, /href="\/gpu"/u);
  assert.match(buyPage, /if \(isMarketV1Enabled\(\)\) redirect\(PRODUCT_PATHS\.gpu\)/u);
  assert.match(buyPage, /redirectOnSignedOut/u);
  assert.match(buy, /\/api\/v2\/offers/u);
  assert.doesNotMatch(buy, /ResourceListing|catalogListings|catalogSuggestions/u);
  assert.match(explorer, /directoryRequestHref/u);
  assert.doesNotMatch(explorer, /\/checkout\//u);
  assert.match(legacyCheckout, /permanentRedirect\(`\/request\?/u);
});
