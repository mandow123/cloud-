import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

import { formatCardHourDisplayMicros, formatCardHourValue } from "../lib/card-hours.ts";
import { formatKaiSchDisplay } from "../lib/kai-standard-view-models.ts";

const ROOT = join(import.meta.dirname, "..");

function source(path) {
  const absolutePath = join(ROOT, path);
  assert.equal(existsSync(absolutePath), true, `${path} is missing`);
  return readFileSync(absolutePath, "utf8");
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("desktop header presents purchase and demand as adjacent, distinct actions", () => {
  const header = source("components/site-header.tsx");
  const buyHref = header.indexOf('href="/buy"');
  const buyLabel = header.indexOf("购买算力", buyHref);
  const requestHref = header.indexOf('href="/request"', buyLabel);
  const requestLabel = header.indexOf("提交算力需求", requestHref);

  assert.ok(buyHref >= 0, "the desktop header must link to /buy");
  assert.ok(buyLabel > buyHref, "the /buy action must be labelled 购买算力");
  assert.ok(requestHref > buyLabel, "提交算力需求 must immediately follow the purchase action");
  assert.ok(requestLabel > requestHref, "the /request action must be labelled 提交算力需求");
  assert.doesNotMatch(header, /发布算力需求/u);
  assert.match(header, /button-primary[\s\S]*href="\/buy"[\s\S]*购买算力[\s\S]*button-secondary[\s\S]*href="\/request"[\s\S]*提交算力需求/u);
});

test("mobile navigation keeps both purchase and demand entry points usable", () => {
  const mobile = source("components/mobile-demand-cta.tsx");
  const css = source("app/kai-cloud.css");

  assert.match(mobile, /<nav[^>]+className="mobile-demand-cta"[^>]+aria-label="购买与需求操作"/u);
  assert.match(mobile, /pathname !== "\/buy"[\s\S]*href="\/buy"[\s\S]*购买算力/u);
  assert.match(mobile, /pathname !== "\/request"[\s\S]*href="\/request"[\s\S]*提交算力需求/u);
  assert.doesNotMatch(mobile, /发布算力需求/u);
  assert.match(css, /\.mobile-demand-cta\s*\{\s*display:\s*none;/u);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.mobile-demand-cta\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:/u);
  assert.match(css, /\.mobile-purchase-cta\s*\{[\s\S]*background:/u);
  assert.match(css, /\.mobile-request-cta\s*\{[\s\S]*background:/u);
});

test("/buy is publicly browsable, feature-gated, and uses the shared buy catalog boundary", () => {
  const buyPage = source("app/buy/page.tsx");
  const buyWorkspace = source("components/buy-workspace.tsx");
  const combined = `${buyPage}\n${buyWorkspace}`;

  assert.match(buyPage, /partitionBuyCatalog\(resourceListings, suppliers\)/u);
  assert.match(buyPage, /!isBuyCatalogV2Enabled\(\)[\s\S]*redirect\("\/gpu"\)/u);
  assert.doesNotMatch(buyPage, /AccountRequired/u);
  assert.match(combined, /\/checkout\/\$\{encodeURIComponent\(listing\.id\)\}/u);
  assert.match(combined, /\/api\/ready/u);
  assert.match(combined, /\/api\/v2\/offers/u);
  assert.match(combined, /更多供应商资源线索/u);
});

test("/request requires a signed-in trading subject before rendering the demand form", () => {
  const requestPage = source("app/request/page.tsx");

  assert.match(requestPage, /<AccountRequired[^>]+purpose="提交算力需求"[^>]+redirectOnSignedOut/u);
  assert.match(requestPage, /登录主体 · 服务端留存/u);
  assert.doesNotMatch(requestPage, /匿名会话 · 服务端留存/u);
});

test("the offer checkout uses the same exact card-hour calculation as the server", () => {
  const checkout = source("components/hosting-offer-checkout.tsx");
  assert.match(checkout, /hostingCardHourMicrosForSeconds\(offer\.pricing\.cardHourMicrosPerGpuHour, reservedSeconds\)/u);
  assert.doesNotMatch(checkout, /Math\.ceil\(offer\.pricing\.cardHourMicrosPerGpuHour/u);
  assert.match(checkout, /disabled=\{busy \|\| heldMicros === null/u);
});

test("the static resource directory synchronizes catalog eligibility and never sends leads to checkout", () => {
  const explorer = source("components/resource-explorer.tsx");
  const resourcesPage = source("app/resources/page.tsx");
  const gpuPage = source("app/gpu/page.tsx");
  const inquiry = source("components/catalog-purchase.tsx");
  const checkoutPage = source("app/checkout/[resourceId]/page.tsx");

  assert.match(explorer, /classification === "PRIMARY_INQUIRY"[\s\S]*!inquiryEnabled[\s\S]*人工询价维护中[\s\S]*href=\{`\/checkout\/\$\{encodeURIComponent\(resource\.id\)\}`\}/u);
  assert.match(explorer, /classification === "PRIMARY_INQUIRY"[\s\S]*formatCardHourValue\(resource\.quote\.median \/ 1\.002\)[\s\S]*KAI 标准卡时 \/ 套·小时/u);
  assert.match(explorer, /catalogDisplayQuote\(item, classifications\[item\.id\] \?\? "EXCLUDED"\)/u);
  assert.equal((explorer.match(/catalogDisplayQuote\(resource, classifications\[resource\.id\] \?\? "EXCLUDED"\)/gu) ?? []).length, 2);
  assert.match(explorer, /href=\{`\/request\?listing=\$\{encodeURIComponent\(resource\.id\)\}`\}[\s\S]*classification === "REFERENCE_LEAD" \? "提交相关需求" : "提交算力需求"/u);
  assert.match(explorer, /classifications\[resource\.id\] \?\? "EXCLUDED"/u);
  assert.match(resourcesPage, /classifyBuyCatalogListing\(listing, suppliers\)/u);
  assert.match(resourcesPage, /inquiryEnabled=\{isBuyCatalogV2Enabled\(\) && manualDeliveryIntakeEnabled\(\)\}/u);
  assert.match(gpuPage, /classifications=\{gpuClassifications\}/u);
  assert.match(gpuPage, /inquiryEnabled=\{isBuyCatalogV2Enabled\(\) && manualDeliveryIntakeEnabled\(\)\}/u);
  assert.match(gpuPage, /if \(await hostingMarketReady\(\)\) return <HostingGpuMarketplace \/>;[\s\S]*<ResourceExplorer/u);
  assert.doesNotMatch(explorer, /<span>购买<\/span>/u);
  assert.match(inquiry, /本页不创建成交订单/u);
  assert.match(inquiry, /不锁库存、不扣卡时/u);
  assert.match(inquiry, /登录后提交询价/u);
  assert.match(inquiry, /正在提交…"\s*:\s*"提交询价"/u);
  assert.doesNotMatch(inquiry, /登录后提交购买|提交购买/u);
  assert.match(checkoutPage, /title:\s*`询价/u);
});

test("all user-facing card-hour formatters emit exactly two decimals while the fixed exchange rate stays 1.002", () => {
  assert.equal(formatCardHourDisplayMicros(0), "0.00");
  assert.equal(formatCardHourDisplayMicros(5_000), "0.01");
  assert.equal(formatCardHourDisplayMicros(31_137_725), "31.14");
  assert.equal(formatCardHourValue(1_234.5), "1,234.50");
  assert.equal(formatKaiSchDisplay("31.137725"), "31.14");

  const displayFiles = [
    "components/admin-hosting-operations.tsx",
    "components/card-hour-account-panel.tsx",
    "components/hosting-offer-checkout.tsx",
    "components/kai-standard-account.tsx",
    "components/kai-standard-equivalent-line.tsx",
    "components/kai-standard-market.tsx",
    "components/supply-dashboard.tsx",
    "components/supply-order-workspace.tsx",
  ];
  for (const path of displayFiles) {
    assert.doesNotMatch(source(path), /\bformatCardHourMicros\b/u, `${path} must not expose exact micro-ledger precision in the UI`);
  }
  const hostingClient = source("lib/hosting-v2-client.ts");
  assert.match(hostingClient, /import \{ formatCardHourDisplayMicros \} from "\.\/card-hours\.ts"/u);
  assert.match(hostingClient, /return formatCardHourDisplayMicros\(micros\)/u);
  assert.match(source("components/supply-offer-create.tsx"), /pattern="\\d\{1,9\}\(\\\.\\d\{1,2\}\)\?"/u);

  const publicSources = [...walk(join(ROOT, "app")), ...walk(join(ROOT, "components")), join(ROOT, "lib/catalog.mjs")]
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .filter((path) => !relative(ROOT, path).split(sep).join("/").startsWith("app/api/"))
    .map((path) => ({ path: relative(ROOT, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));

  const violations = [];
  for (const { path, text } of publicSources) {
    for (const match of text.matchAll(/(?<![\w.])(\d[\d,]*\.\d{3,})\s*(KAI(?:-SCH)?|卡时)/gu)) {
      if (match[1] === "1.002") continue;
      violations.push(`${path}: ${match[0]}`);
    }
  }
  assert.deepEqual(violations, [], "user-visible card-hour amount literals must have exactly two decimals");

  const rateSources = [source("components/card-hour-account-panel.tsx"), source("components/supply-earnings.tsx")].join("\n");
  assert.match(rateSources, /1(?:\.00)?\s+(?:KAI 标准)?卡时\s*=\s*¥1\.002|1\.00 卡时[\s\S]*¥1\.002/u);
});
