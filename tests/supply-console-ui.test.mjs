import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("supplier console exposes only implemented routes and keeps future areas disabled", () => {
  for (const path of ["app/supply/layout.tsx", "app/supply/page.tsx", "app/supply/onboarding/page.tsx"]) {
    assert.equal(existsSync(path), true, `${path} must exist`);
  }

  const layout = readFileSync("app/supply/layout.tsx", "utf8");
  assert.match(layout, /isHostingV2Enabled\(\)/u);
  assert.match(layout, /redirect\("\/hosting"\)/u);
  assert.match(layout, /<AccountRequired purpose="管理供应资源">/u);

  const shell = readFileSync("components/supply-console-shell.tsx", "utf8");
  assert.match(shell, /href: "\/supply"/u);
  assert.match(shell, /href: "\/supply\/onboarding"/u);
  assert.match(shell, /const upcomingRoutes = \["资源", "挂牌", "订单", "收益"\]/u);
  assert.match(shell, /aria-disabled="true"/u);
  assert.doesNotMatch(shell, /href: "\/supply\/(resources|listings|orders|earnings)/u);
});

test("supplier pages read and mutate through the authenticated hosting v2 APIs", () => {
  const dashboard = readFileSync("components/supply-dashboard.tsx", "utf8");
  assert.match(dashboard, /marketplaceGet<\{ dashboard: HostingDashboard \}>\("\/api\/v2\/supply\/dashboard"\)/u);

  const onboarding = readFileSync("components/supplier-onboarding-form.tsx", "utf8");
  assert.match(onboarding, /marketplaceGet<\{ record: HostingSupplierProfile \| null \}>\("\/api\/v2\/supply\/profile"\)/u);
  assert.match(onboarding, /marketplacePut<HostingSupplierProfile>\("\/api\/v2\/supply\/profile"/u);
  assert.match(onboarding, /marketplacePost<HostingSupplierProfile>\("\/api\/v2\/supply\/profile\/submit"/u);
  assert.match(onboarding, /agreementAccepted: true/u);
  assert.match(onboarding, /expectedVersion: profile\.version/u);
  assert.doesNotMatch(`${dashboard}\n${onboarding}`, /x-kai-workspace-role|localStorage|sessionStorage/u);
});

test("authenticated PUT helper sends CSRF and idempotency protection", () => {
  const client = readFileSync("lib/client/marketplace-client.ts", "utf8");
  const start = client.indexOf("export async function marketplacePut");
  const end = client.indexOf("export async function exchangePost");
  const put = client.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(put, /method: "PUT"/u);
  assert.match(put, /"x-kai-csrf": session\.csrfToken/u);
  assert.match(put, /"Idempotency-Key": idempotencyKey/u);
  assert.match(put, /getMarketplaceSession\(true\)/u);
  assert.doesNotMatch(put, /x-kai-workspace-role/u);
});

test("supplier console uses the shared light and dark tokens", () => {
  const css = readFileSync("components/supply-console.module.css", "utf8");
  for (const token of ["canvas", "surface", "ink", "text", "muted", "border", "accent", "error", "warning"]) {
    assert.match(css, new RegExp(`var\\(--${token}`, "u"));
  }
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);
});
