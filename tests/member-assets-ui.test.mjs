import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), "utf8");

test("member assets is the canonical four-section card-hour surface", async () => {
  const [page, panel] = await Promise.all([
    source("app/member/assets/page.tsx"),
    source("components/card-hour-account-panel.tsx"),
  ]);
  assert.match(page, /title:\s*"我的资产"/u);
  assert.match(page, /<AccountRequired purpose="查看我的资产">[\s\S]*<CardHourAccountPanel\s*\/>/u);
  const sections = ["asset-overview", "card-hour-ledger", "income", "topup"];
  let previous = -1;
  for (const id of sections) {
    const index = panel.indexOf(`id="${id}"`);
    assert.ok(index > previous, `${id} must exist in approved order`);
    previous = index;
  }
  assert.doesNotMatch(panel, /id="buybacks"|我的回购|自动回购/u);
});

test("legacy card-hour hash redirects to the canonical assets route", async () => {
  const [legacy, member] = await Promise.all([
    source("components/legacy-member-asset-redirect.tsx"),
    source("app/member/page.tsx"),
  ]);
  assert.match(legacy, /window\.location\.hash === "#card-hours"/u);
  assert.match(legacy, /window\.location\.replace\("\/member\/assets"\)/u);
  assert.match(member, /<LegacyMemberAssetRedirect\s*\/>/u);
  assert.doesNotMatch(member, /<CardHourAccountPanel\s*\/>/u);
});

test("all card-hour values reuse two-decimal formatting and ordinary purchases contain no fiat reference", async () => {
  const panel = await source("components/card-hour-account-panel.tsx");
  assert.match(panel, /formatCardHourDisplayMicros/u);
  assert.doesNotMatch(panel, /cnyReferenceCents|参考价/u);
  assert.match(panel, /<th className="p-4 text-right">支付卡时<\/th>/u);
  const rendered = panel.slice(panel.indexOf("return ("));
  const topupIndex = rendered.indexOf('id="topup"');
  assert.ok(topupIndex > 0);
  assert.doesNotMatch(rendered.slice(0, topupIndex), /人民币|¥/u);
});

test("fiat is isolated to a closed top-up section with no amount or payment controls", async () => {
  const panel = await source("components/card-hour-account-panel.tsx");
  const topup = panel.slice(panel.indexOf('id="topup"'));
  assert.match(topup, /1\.00 KAI 标准卡时 = ¥1\.002/u);
  assert.match(topup, /TOPUP_CLOSED/u);
  assert.match(topup, /关闭期间不展示充值数量输入、快捷金额或支付按钮/u);
  assert.doesNotMatch(topup, /card-hour-topup|onSubmit=|type="submit"|marketplacePost/u);
});

test("the personal menu exposes assets and removes V1 buyback navigation", async () => {
  const menu = await source("components/personal-menu.tsx");
  for (const destination of ["/member/assets", "/member/assets#card-hour-ledger", "/member/assets#income", "/member/assets#topup"]) {
    assert.match(menu, new RegExp(destination.replaceAll("/", "\\/"), "u"));
  }
  assert.match(menu, /label:\s*"我的资产"/u);
  assert.doesNotMatch(menu, /我的回购|#buybacks/u);
});
