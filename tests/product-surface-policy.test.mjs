import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("buyer, inventory, catalog and intelligence surfaces have one explicit owner", () => {
  const policy = read("lib/product-surface-policy.ts");
  for (const [key, path, owner, mode] of [
    ["buy", "/buy", "LEGACY_BUY_WORKSPACE", "ROLLBACK_ONLY"],
    ["gpu", "/gpu", "LIVE_BUYER_MARKET", "LIVE_CONTRACTS"],
    ["resources", "/resources", "REFERENCE_CATALOG", "INQUIRY_ONLY"],
    ["market", "/market", "MARKET_INTELLIGENCE", "READ_ONLY"],
    ["supply", "/supply", "HOSTING_V2_SUPPLIER_CONSOLE", "AUTHENTICATED_SUPPLY"],
  ]) {
    assert.ok(policy.includes(`${key}: "${path}"`));
    assert.ok(policy.includes(`owner: "${owner}"`));
    assert.ok(policy.includes(`transactionMode: "${mode}"`));
  }
  assert.match(policy, /只接受询价，不承诺即时库存/u);
  assert.match(policy, /不创建订单/u);
  assert.equal((policy.match(/owner:\s*"LIVE_BUYER_MARKET"/gu) ?? []).length, 1);
  assert.match(policy, /marketListings:\s*PRODUCT_PATHS\.gpu/u);
});

test("compute quotes stay in KAI card-hours and fiat is isolated to account top-up", () => {
  const policy = read("lib/product-surface-policy.ts");
  assert.ok(policy.includes('quoteUnit: "KAI_STANDARD_CARD_HOUR"'));
  assert.ok(policy.includes("fiatReferenceAllowed: false"));
  assert.ok(policy.includes('cardHourAssets: "/member/assets"'));
  assert.ok(policy.includes('cardHourTopUp: "/member/assets#topup"'));
  assert.ok(policy.includes("path: PRODUCT_PATHS.cardHourTopUp"));
  assert.doesNotMatch(policy, /\/member#card-hours/u);
  assert.ok(policy.includes('scope: "ACCOUNT_TOP_UP_ONLY"'));
});

test("shipped legacy entry points delegate to the centralized redirect policy", () => {
  const market = read("app/market/listings/page.tsx");
  const supplyList = read("app/supply/resources/page.tsx");
  const supplyNew = read("app/supply/resources/new/page.tsx");
  const supplyDetail = read("app/supply/resources/[deviceId]/page.tsx");

  assert.match(market, /redirect\(LEGACY_PRODUCT_REDIRECTS\.marketListings\)/u);
  assert.match(supplyList, /permanentRedirect\(LEGACY_PRODUCT_REDIRECTS\.supplyResources\)/u);
  assert.match(supplyNew, /permanentRedirect\(LEGACY_PRODUCT_REDIRECTS\.supplyResourceNew\)/u);
  assert.match(supplyDetail, /permanentRedirect\(LEGACY_PRODUCT_REDIRECTS\.supplyResourceDetail\(deviceId\)\)/u);
});

test("deprecated supply implementations stay present for rollback but are not mounted by App Router", () => {
  const policy = read("lib/product-surface-policy.ts");
  const legacyModules = [...policy.matchAll(/^\s+"(components\/(?:live-exchange-market|supply-|supplier-)[^"]+\.tsx)",?$/gmu)]
    .map((match) => match[1]);
  assert.ok(legacyModules.length >= 10, "the audited legacy module inventory must remain explicit");

  const appSources = walk(join(ROOT, "app"))
    .filter((path) => /\.(?:ts|tsx)$/u.test(path))
    .map((path) => ({
      path: relative(ROOT, path).split(sep).join("/"),
      source: readFileSync(path, "utf8"),
    }));

  for (const modulePath of legacyModules) {
    assert.equal(existsSync(join(ROOT, modulePath)), true, `${modulePath} must remain available for rollback`);
    const importPath = `@/${modulePath.replace(/\.tsx$/u, "")}`;
    const mountedBy = appSources.filter(({ source }) => source.includes(importPath)).map(({ path }) => path);
    assert.deepEqual(mountedBy, [], `${modulePath} must not be mounted by production pages`);
  }
});
