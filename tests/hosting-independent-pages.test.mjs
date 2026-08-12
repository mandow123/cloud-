import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const publicRoutes = [
  ["/hosting", "app/hosting/page.tsx"],
  ["/hosting/personal-gpu", "app/hosting/personal-gpu/page.tsx"],
  ["/hosting/cloud", "app/hosting/cloud/page.tsx"],
  ["/hosting/earnings", "app/hosting/earnings/page.tsx"],
  ["/hosting/partners", "app/hosting/partners/page.tsx"],
];

test("hosting exposes five independent public pages even while transactions remain feature-gated", () => {
  for (const [route, path] of publicRoutes) {
    assert.equal(existsSync(path), true, `${route} must have a route file`);
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /isHostingV2Enabled|redirect\("\/hosting"\)|GpuHostingLab|LOCAL_TEST/u);
    assert.match(source, new RegExp(`activePath=["']${route.replaceAll("/", "\\/")}["']`, "u"));
  }
});

test("hosting v2 menu is a vertical list of real routes without page anchors", () => {
  const source = readFileSync("components/nav-links.tsx", "utf8");
  const start = source.indexOf("const hostingV2Group");
  const end = source.indexOf("function groupsFor");
  const v2Menu = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source, /legacyHostingGroup|\/hosting#/u);
  assert.doesNotMatch(v2Menu, /href:\s*["'][^"']*#/u);
  for (const [route] of publicRoutes) assert.match(v2Menu, new RegExp(`href: ["']${route.replaceAll("/", "\\/")}["']`, "u"));

  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.nav-popover-links\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(css, /\.nav-popover-links a\[aria-current="page"\]/u);
});

test("legacy entry points route into the independent hosting pages", () => {
  const partnerSource = readFileSync("app/partners/page.tsx", "utf8");
  assert.match(partnerSource, /KAI_PUBLIC_ORIGIN/u);
  assert.match(partnerSource, /permanentRedirect\(new URL\("\/hosting\/partners", origin\)\.toString\(\)\)/u);
  assert.doesNotMatch(partnerSource, /isHostingV2Enabled|PartnerForm/u);

  const guides = readFileSync("app/guides/page.tsx", "utf8");
  assert.doesNotMatch(guides, /\/hosting#/u);
  assert.match(guides, /\/hosting\/personal-gpu/u);
  assert.match(guides, /\/hosting\/cloud/u);

  const redirectSource = readFileSync("components/hosting-legacy-hash-redirect.tsx", "utf8");
  assert.match(redirectSource, /"#personal-gpu": "\/hosting\/personal-gpu"/u);
  assert.match(redirectSource, /"#cloud-provider": "\/hosting\/cloud"/u);
  assert.match(redirectSource, /"#earnings": "\/hosting\/earnings"/u);
});

test("the obsolete LOCAL_TEST GPU loop exists only in a local Root administrator route", () => {
  const page = readFileSync("app/admin/hosting/lab/page.tsx", "utf8");
  assert.match(page, /KAI_ENVIRONMENT !== "LOCAL"/u);
  assert.match(page, /KAI_GPU_LAB_ENABLED !== "1"/u);
  assert.match(page, /notFound\(\)/u);

  const adminLab = readFileSync("components/admin-gpu-lab.tsx", "utf8");
  assert.match(adminLab, /adminGetSession/u);
  assert.match(adminLab, /roles\.includes\("ROOT"\)/u);
  assert.match(adminLab, /<GpuHostingLab/u);

  const api = readFileSync("app/api/v1/lab/gpu-loop/route.ts", "utf8");
  assert.match(api, /requireAdminPermission\(request, \["ADMIN_PANEL_READ"\]\)/u);
  assert.match(api, /requireAdminPermission\(request, \["FULFILLMENT_OPERATE"\]\)/u);
  assert.match(api, /assertAccountAuthSameOrigin\(request\)/u);
});

test("hosting public styles use the shared light and dark design tokens", () => {
  const css = readFileSync("components/hosting-public.module.css", "utf8");
  assert.match(css, /var\(--canvas\)/u);
  assert.match(css, /var\(--surface\)/u);
  assert.match(css, /var\(--ink\)/u);
  assert.match(css, /var\(--text\)/u);
  assert.match(css, /var\(--border\)/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);

  const earnings = readFileSync("app/hosting/earnings/page.tsx", "utf8");
  assert.match(earnings, /¥31\.20/u);
  assert.match(earnings, /31\.137725 KAI 标准卡时/u);
});

test("the configured supplier agreement has an immutable public document", () => {
  const terms = readFileSync("app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx", "utf8");
  assert.match(terms, /const version = "KAI_HOSTING_TERMS_2026_08"/u);
  assert.match(terms, /Host Agent 与最小权限/u);
  assert.match(terms, /不是法定货币、存款、证券或无条件兑付承诺/u);
  assert.match(terms, /清理失败时设备进入 DRAINING/u);
  const onboarding = readFileSync("components/supplier-onboarding-form.tsx", "utf8");
  assert.match(onboarding, /`\/hosting\/partners\/terms\/\$\{agreementVersion\}`/u);
});
