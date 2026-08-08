import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the visible resource catalog exposes the real purchasable-listings entry", () => {
  const detailActions = source("components/resource-detail-actions.tsx");
  assert.match(detailActions, /href="\/market\/listings"/u);
  assert.match(detailActions, /查看可购买的在售资源/u);
  assert.match(source("components/kai-standard-market.tsx"), /href="\/market\/listings">购买在售资源/u);
});

test("listing cards reach an implemented checkout route", () => {
  assert.ok(existsSync(new URL("../app/market/listings/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../app/checkout/[listingVersionId]/page.tsx", import.meta.url)));
  assert.match(source("app/market/listings/page.tsx"), /<LiveExchangeMarket\s*\/>/u);
  assert.match(source("components/live-exchange-market.tsx"), /href=\{`\/checkout\/\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
  assert.match(source("app/checkout/[listingVersionId]/page.tsx"), /<CapacityCheckout listingVersionId=\{listingVersionId\}\s*\/>/u);
});

test("checkout success and order lists reach implemented buyer order pages", () => {
  assert.ok(existsSync(new URL("../app/buyer/orders/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../app/buyer/orders/[id]/page.tsx", import.meta.url)));
  assert.match(source("components/capacity-checkout.tsx"), /href=\{`\/buyer\/orders\/\$\{encodeURIComponent\(order\.id\)\}`\}/u);
  assert.match(source("app/buyer/orders/[id]/page.tsx"), /<OrderDetail orderId=\{id\} role="buyer"\s*\/>/u);
});

test("the general checkout remains explicitly TEST-only until real payment is separately authorized", () => {
  const detail = source("components/order-detail.tsx");
  assert.match(detail, /测试支付 · 不会扣款/u);
  assert.match(detail, /\/test-payment/u);
  assert.doesNotMatch(detail, /\/payment-intents/u);
});
