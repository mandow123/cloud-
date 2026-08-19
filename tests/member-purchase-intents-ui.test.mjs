import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("member compute pages expose truthful buyer details without payment or key claims", () => {
  const component = readFileSync(new URL("../components/member-purchase-intents.tsx", import.meta.url), "utf8");
  const listPage = readFileSync(new URL("../app/member/purchases/page.tsx", import.meta.url), "utf8");
  const detailPage = readFileSync(new URL("../app/member/purchases/[demandId]/page.tsx", import.meta.url), "utf8");
  assert.match(component, /我的算力申请|算力申请记录/u);
  assert.match(component, /等待平台人工确认与交付/u);
  assert.match(component, /尚未锁定库存、尚未付款、尚未扣卡时/u);
  assert.match(component, /SSH 公钥指纹/u);
  assert.match(component, /formatCardHourDisplayMicros/u);
  assert.doesNotMatch(component, /canonicalSshPublicKey|查看公钥|复制公钥|人民币|¥|已支付|运行中/u);
  assert.match(listPage, /redirectOnSignedOut/u);
  assert.match(detailPage, /redirectOnSignedOut/u);
});

test("catalog submission links directly to the immutable member detail", () => {
  const purchase = readFileSync(new URL("../components/catalog-purchase.tsx", import.meta.url), "utf8");
  assert.match(purchase, /查看本次算力详情/u);
  assert.match(purchase, /\/member\/purchases\/\$\{encodeURIComponent\(intent\.id\)\}/u);
});
