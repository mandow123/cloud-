import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("the personal entry is placed between theme control and demand publishing", async () => {
  const header = await source("components/site-header.tsx");
  assert.match(header, /<ThemeControl\s*\/>[\s\S]*<PersonalMenu\s*\/>[\s\S]*href="\/request"/u);
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

test("signed-in and signed-out personal actions stay buyer-facing", async () => {
  const menu = await source("components/personal-menu.tsx");
  for (const label of ["登录后查看个人业务", "购买申请", "待支付", "我的订单", "待验收", "我的对比", "基础信息"]) {
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
