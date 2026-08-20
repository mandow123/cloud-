import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { partitionBuyCatalog } from "../lib/buy-catalog.ts";
import { resourceListings, suppliers } from "../lib/data.ts";
import { isBuyCatalogV2EnabledForEnvironment } from "../lib/server/buy-catalog-feature.ts";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("/buy uses the shared catalog boundary and defaults the new experience off", () => {
  const page = read("app/buy/page.tsx");
  const compose = read("deploy/compose.production.yml");
  const environment = read("deploy/kai-cloud-app.env.example");
  const runbook = read("deploy/PRODUCTION_RUNBOOK.md");
  assert.match(page, /partitionBuyCatalog\(resourceListings, suppliers\)/u);
  assert.match(page, /!isBuyCatalogV2Enabled\(\)/u);
  assert.match(page, /redirect\("\/gpu"\)/u);
  assert.doesNotMatch(page, /AccountRequired/u);
  assert.match(compose, /KAI_BUY_CATALOG_V2: "\$\{KAI_BUY_CATALOG_V2:-0\}"/u);
  assert.match(environment, /^KAI_BUY_CATALOG_V2=0$/mu);
  assert.match(runbook, /KAI_BUY_CATALOG_V2=0/u);
});

test("buy catalog feature defaults closed and only accepts the explicit production value", () => {
  assert.equal(isBuyCatalogV2EnabledForEnvironment({}), false);
  assert.equal(isBuyCatalogV2EnabledForEnvironment({ KAI_BUY_CATALOG_V2: "0" }), false);
  assert.equal(isBuyCatalogV2EnabledForEnvironment({ KAI_BUY_CATALOG_V2: "true" }), false);
  assert.equal(isBuyCatalogV2EnabledForEnvironment({ KAI_BUY_CATALOG_V2: "1" }), true);
});

test("shared boundary yields 10 primary packages and 100 reference leads at launch", () => {
  const partition = partitionBuyCatalog(resourceListings, suppliers, "2026-08-20T00:00:00+08:00");
  assert.equal(partition.primary.length, 10);
  assert.equal(partition.referenceLeads.length, 100);
  assert.ok(partition.primary.every((listing) => listing.supplierName === "上海鸿欢网络科技有限公司"));
});

test("primary buy cards answer supplier, specification, delivery and card-hour questions", () => {
  const workspace = read("components/buy-workspace.tsx");
  for (const copy of ["供应商 GPU 套餐", "GPU 套餐", "地域与网络", "交付方式", "卡时", "每套 · 每小时", "每套 GPU 数", "价格排序", "查看详情", "登录询价", "人工询价维护中"]) {
    assert.match(workspace, new RegExp(copy, "u"));
  }
  assert.match(workspace, /supplierLogoUrl/u);
  assert.match(workspace, /sourceDate\(listing\)/u);
  assert.match(workspace, /href=\{`\/checkout\/\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
  assert.match(workspace, /href=\{`\/resources\/\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
  assert.match(workspace, /inquiryEnabled \? <Link[\s\S]*人工询价维护中/u);
  assert.doesNotMatch(workspace, /SETUP|可成交|已验真/u);
});

test("reference leads stay folded and only enter demand collection", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /<details className=\{styles\.leadDirectory\}>/u);
  assert.match(workspace, /\{referenceLeads\.length\} 家报价线索/u);
  assert.match(workspace, /\/request\?listing=/u);
  assert.match(workspace, /不代表当前库存或可购买套餐/u);
});

test("live Hosting inventory is an additive section only", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /showLiveInventory \? <LiveInventory \/> : null/u);
  assert.match(workspace, /\/api\/ready/u);
  assert.match(workspace, /\/api\/v2\/offers/u);
  assert.match(workspace, /平台实时库存/u);
});

test("responsive buy catalog keeps tokenized styling and 44px controls", () => {
  const path = join(ROOT, "components/buy-workspace.module.css");
  assert.equal(existsSync(path), true);
  const css = read("components/buy-workspace.module.css");
  for (const token of ["--canvas", "--surface", "--ink", "--text", "--border", "--accent"]) assert.match(css, new RegExp(`var\\(${token}\\)`, "u"));
  assert.match(css, /@media \(max-width: 640px\)/u);
  assert.match(css, /min-height: 2\.75rem/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);
});
