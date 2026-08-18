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
  const buyHref = header.indexOf('href="/gpu"');
  const buyLabel = header.indexOf("购买算力", buyHref);
  const requestHref = header.indexOf('href="/request"', buyLabel);
  const requestLabel = header.indexOf("提交算力需求", requestHref);

  assert.ok(buyHref >= 0, "the desktop header must link to the canonical /gpu market");
  assert.ok(buyLabel > buyHref, "the /gpu action must be labelled 购买算力");
  assert.ok(requestHref > buyLabel, "提交算力需求 must immediately follow the purchase action");
  assert.ok(requestLabel > requestHref, "the /request action must be labelled 提交算力需求");
  assert.doesNotMatch(header, /发布算力需求/u);
  assert.match(header, /button-primary[\s\S]*href="\/gpu"[\s\S]*购买算力[\s\S]*button-secondary[\s\S]*href="\/request"[\s\S]*提交算力需求/u);
  assert.doesNotMatch(header, /href="\/buy"/u);
});

test("mobile navigation keeps both purchase and demand entry points usable", () => {
  const mobile = source("components/mobile-demand-cta.tsx");
  const css = source("app/kai-cloud.css");

  assert.match(mobile, /<nav[^>]+className="mobile-demand-cta"[^>]+aria-label="购买与需求操作"/u);
  assert.match(mobile, /pathname !== "\/gpu"[\s\S]*href="\/gpu"[\s\S]*购买算力/u);
  assert.doesNotMatch(mobile, /href="\/buy"/u);
  assert.match(mobile, /pathname !== "\/request"[\s\S]*href="\/request"[\s\S]*提交算力需求/u);
  assert.doesNotMatch(mobile, /发布算力需求/u);
  assert.match(css, /\.mobile-demand-cta\s*\{\s*display:\s*none;/u);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.mobile-demand-cta\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:/u);
  assert.match(css, /\.mobile-purchase-cta\s*\{[\s\S]*background:/u);
  assert.match(css, /\.mobile-request-cta\s*\{[\s\S]*background:/u);
});

test("/buy redirects to the canonical market when KAI_MARKET_V1 is enabled and preserves the gated rollback workspace", () => {
  const buyPage = source("app/buy/page.tsx");
  const buyWorkspace = source("components/buy-workspace.tsx");
  const accountGate = source("components/account-required.tsx");
  const combined = `${buyPage}\n${buyWorkspace}`;

  assert.match(buyPage, /if \(isMarketV1Enabled\(\)\) redirect\(PRODUCT_PATHS\.gpu\)/u);
  assert.match(combined, /<AccountRequired[^>]+redirectOnSignedOut(?:=\{true\})?/u);
  assert.match(combined, /\/api\/auth\/session|AccountRequired/u);
  assert.match(combined, /\/api\/ready/u, "the buy workspace must fail closed when purchase services are not ready");
  assert.match(combined, /\/api\/v2\/offers/u, "the buy workspace must use real Hosting V2 offers");
  assert.match(combined, /\/api\/v1\/member\/card-hours/u, "the buy workspace must show the authenticated subject's real card-hour balance");
  assert.match(combined, /\/gpu\/offers\/\$\{|`\/gpu\/offers\//u, "a real offer must enter the existing contract checkout route");
  assert.doesNotMatch(combined, /from ["']@\/lib\/catalog|from ["']\.\.\/lib\/catalog|\/checkout\//u, "static catalog entries must not masquerade as purchasable offers");
  assert.match(accountGate, /window\.location\.pathname \+ window\.location\.search/u);
  assert.match(accountGate, /window\.location\.replace\(`\/login\?returnTo=\$\{encodeURIComponent\(returnTo\)\}`\)/u);
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
  assert.match(checkout, /disabled=\{!transaction\?\.ready \|\| busy \|\| heldMicros === null/u);
});

test("the static resource directory is inquiry-only, not a fake purchase flow", () => {
  const explorer = source("components/resource-explorer.tsx");
  const checkoutPage = source("app/checkout/[resourceId]/page.tsx");

  assert.equal((explorer.match(/<span>提交需求<\/span>/gu) ?? []).length, 2);
  assert.doesNotMatch(explorer, /<span>购买<\/span>/u);
  assert.doesNotMatch(explorer, /\/checkout\//u);
  assert.match(explorer, /directoryRequestHref/u);
  assert.match(explorer, /报价已过期/u);
  assert.match(checkoutPage, /permanentRedirect\(`\/request\?/u);
  assert.doesNotMatch(checkoutPage, /CatalogPurchase/u);
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
