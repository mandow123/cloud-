import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatCardHourDisplayMicros } from "../lib/card-hours.ts";
import { getDgxSparkCampaignConfig } from "../lib/server/dgx-spark-campaign.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("DGX Spark campaign defaults to fail-closed and enabled campaigns default to PENDING interest only", () => {
  const disabled = getDgxSparkCampaignConfig({});
  assert.equal(disabled.status, "HIDDEN");
  assert.equal(disabled.purchasable, false);
  assert.equal(disabled.bannerVisible, false);

  const pending = getDgxSparkCampaignConfig({ KAI_DGX_SPARK_CAMPAIGN_ENABLED: "1" });
  assert.equal(pending.status, "PENDING");
  assert.equal(pending.interestRegistrationEnabled, true);
  assert.equal(pending.purchasable, false);
  assert.equal(pending.priceCardHoursMicros, null);
  assert.equal(pending.verifiedTerms, null);
});

test("VERIFIED remains PENDING until supplier, terms, price and a real product path are all server verified", () => {
  const incomplete = getDgxSparkCampaignConfig({
    KAI_DGX_SPARK_CAMPAIGN_ENABLED: "1",
    KAI_DGX_SPARK_CAMPAIGN_STATUS: "VERIFIED",
    KAI_DGX_SPARK_TOTAL_UNITS: "200",
    KAI_DGX_SPARK_DISCOUNT_PERCENT: "50",
    KAI_DGX_SPARK_COUNTDOWN_SECONDS: "60",
    KAI_DGX_SPARK_ESTIMATED_SHIPPING_MONTHS: "3",
  });
  assert.equal(incomplete.status, "PENDING");
  assert.equal(incomplete.verificationReason, "VERIFIED_CONFIGURATION_INCOMPLETE");
  assert.equal(incomplete.purchasable, false);

  const verified = getDgxSparkCampaignConfig({
    KAI_DGX_SPARK_CAMPAIGN_ENABLED: "1",
    KAI_DGX_SPARK_CAMPAIGN_STATUS: "VERIFIED",
    KAI_DGX_SPARK_SUPPLIER_REVIEW_STATUS: "APPROVED",
    KAI_DGX_SPARK_TOTAL_UNITS: "200",
    KAI_DGX_SPARK_DISCOUNT_PERCENT: "50",
    KAI_DGX_SPARK_COUNTDOWN_SECONDS: "60",
    KAI_DGX_SPARK_ESTIMATED_SHIPPING_MONTHS: "3",
    KAI_DGX_SPARK_PRICE_CARD_HOURS_MICROS: "123456789",
    KAI_DGX_SPARK_PURCHASE_PATH: "/gpu/offers/dgx-spark-02672",
  });
  assert.equal(verified.status, "VERIFIED");
  assert.equal(verified.purchasable, true);
  assert.deepEqual(verified.verifiedTerms, { totalUnits: 200, discountPercent: 50, countdownSeconds: 60, estimatedShippingMonths: 3 });
  assert.equal(formatCardHourDisplayMicros(verified.priceCardHoursMicros), "123.46");
});

test("campaign only accepts a same-origin real Hosting V2 offer path", () => {
  const env = {
    KAI_DGX_SPARK_CAMPAIGN_ENABLED: "1",
    KAI_DGX_SPARK_CAMPAIGN_STATUS: "VERIFIED",
    KAI_DGX_SPARK_SUPPLIER_REVIEW_STATUS: "APPROVED",
    KAI_DGX_SPARK_TOTAL_UNITS: "200",
    KAI_DGX_SPARK_DISCOUNT_PERCENT: "50",
    KAI_DGX_SPARK_COUNTDOWN_SECONDS: "60",
    KAI_DGX_SPARK_ESTIMATED_SHIPPING_MONTHS: "3",
    KAI_DGX_SPARK_PRICE_CARD_HOURS_MICROS: "1000000",
    KAI_DGX_SPARK_PURCHASE_PATH: "https://example.com/fake-order",
  };
  assert.equal(getDgxSparkCampaignConfig(env).status, "PENDING");
  assert.equal(getDgxSparkCampaignConfig(env).purchasePath, null);
  assert.equal(getDgxSparkCampaignConfig({ ...env, KAI_DGX_SPARK_PURCHASE_PATH: "/checkout/dgx-spark-02672" }).status, "PENDING");
});

test("the 02672 label stays scoped to its independent Spark page and never enters global layout", () => {
  const layout = source("app/layout.tsx");
  const page = source("app/campaigns/dgx-spark/page.tsx");
  const buyWorkspace = source("components/buy-workspace.tsx");
  assert.doesNotMatch(layout, /DgxSparkCampaign|白鸽在线|02672/u);
  assert.match(page, /02672 白鸽在线特供/u);
  assert.match(buyWorkspace, /href="\/campaigns\/dgx-spark">\{copy\.hero\.sparkCampaign\}/u);
  assert.doesNotMatch(buyWorkspace, /白鸽在线|02672/u);
});

test("campaign page uses the formal account gate and only verified DGX Spark facts", () => {
  const page = source("app/campaigns/dgx-spark/page.tsx");
  assert.match(page, /<AccountRequired purpose="登记 DGX Spark 活动兴趣">/u);
  assert.match(page, /<AccountRequired purpose="预约购买 DGX Spark">/u);
  assert.match(page, /NVIDIA Grace Blackwell/u);
  assert.match(page, /128GB/u);
  assert.match(page, /4TB NVMe/u);
  assert.match(page, /最高 1 PFLOP FP4/u);
  assert.match(page, /10GbE \/ ConnectX-7/u);
  assert.match(page, /不会创建报价、锁定库存或生成订单/u);
  assert.match(page, /不代表 NVIDIA 官方授权或背书/u);
  assert.doesNotMatch(page, /NVIDIA 官方特供/u);
});
