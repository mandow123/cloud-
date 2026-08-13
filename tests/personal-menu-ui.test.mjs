import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("the personal entry is the rightmost action after demand publishing", async () => {
  const header = await source("components/site-header.tsx");
  assert.match(header, /<ThemeControl\s*\/>[\s\S]*href="\/request"[\s\S]*<PersonalMenu\s*\/>/u);
});

test("the personal menu reads only the member summary and local comparison contracts", async () => {
  const menu = await source("components/personal-menu.tsx");
  assert.match(menu, /\/api\/v1\/member\/personal-summary/u);
  assert.match(menu, /kai-cloud-compare-v1/u);
  assert.match(menu, /kai-compare-changed/u);
  assert.match(menu, /credentials:\s*"same-origin"/u);
  for (const field of ["maskedEmail", "purchaseRequests", "pendingPayment", "orders", "pendingAcceptance", "paymentSource.ready"]) {
    assert.match(menu, new RegExp(field, "u"));
  }
});

test("the member workspace exposes GPU contracts through the same personal order entry", async () => {
  const [page, summary, contracts] = await Promise.all([
    source("app/member/page.tsx"),
    source("components/personal-center-overview.tsx"),
    source("components/hosting-contract-list.tsx"),
  ]);
  assert.match(page, /id="orders"[\s\S]*<HostingContractList embedded \/>[\s\S]*<BuyerOrderList \/>/u);
  assert.match(page, /isHostingV2Enabled\(\)/u);
  assert.match(summary, /gpuContracts/u);
  assert.match(summary, /gpuPendingAcceptance/u);
  assert.match(contracts, /marketplaceGet<\{ records: BuyerHostingContract\[\] \}>\("\/api\/v2\/contracts"\)/u);
  assert.match(contracts, /if \(embedded\)/u);
  assert.match(contracts, /进入工作台/u);
});

test("signed-in and signed-out personal actions stay buyer-facing", async () => {
  const menu = await source("components/personal-menu.tsx");
  for (const label of ["登录后查看个人业务", "卡时账户", "购买记录", "我的对比", "我的回购", "租金与佣金", "邀请奖励"]) {
    assert.match(menu, new RegExp(label, "u"));
  }
  assert.doesNotMatch(menu, /href="\/admin|运营管理|管理员/u);
  assert.doesNotMatch(menu, /<button[^>]*>[\s\S]{0,80}(?:立即支付|去支付|付款)/u);
  assert.match(menu, /支付服务尚未就绪/u);
  assert.match(menu, /\/api\/auth\/logout/u);
  assert.match(menu, /退出登录/u);
});

test("the personal menu supports keyboard dismissal and a mobile drawer", async () => {
  const [menu, css] = await Promise.all([
    source("components/personal-menu.tsx"),
    source("components/personal-menu.module.css"),
  ]);
  assert.match(menu, /event\.key === "Escape"/u);
  assert.match(menu, /event\.key !== "Tab" \|\| !mobile/u);
  assert.match(menu, /document\.addEventListener\("pointerdown"/u);
  assert.match(menu, /triggerRef\.current\?\.focus/u);
  assert.match(css, /\.trigger\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/su);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.panel\s*\{[^}]*position:\s*fixed;[^}]*bottom:\s*0;/su);
  assert.match(css, /\.closeButton\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/su);
});
