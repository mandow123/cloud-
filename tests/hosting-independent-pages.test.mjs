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

test("hosting v2 exposes five independent public pages behind the rollback switch", () => {
  for (const [route, path] of publicRoutes) {
    assert.equal(existsSync(path), true, `${route} must have a route file`);
    const source = readFileSync(path, "utf8");
    assert.match(source, /isHostingV2Enabled/u);
    assert.match(source, new RegExp(`activePath=["']${route.replaceAll("/", "\\/")}["']`, "u"));
  }

  const overview = readFileSync("app/hosting/page.tsx", "utf8");
  assert.match(overview, /if \(!isHostingV2Enabled\(\)\) return <GpuHostingLab \/>/u);
  for (const [, path] of publicRoutes.slice(1)) {
    assert.match(readFileSync(path, "utf8"), /if \(!isHostingV2Enabled\(\)\) redirect\("\/hosting"\)/u);
  }
});

test("hosting v2 menu is a vertical list of real routes without page anchors", () => {
  const source = readFileSync("components/nav-links.tsx", "utf8");
  const start = source.indexOf("const hostingV2Group");
  const end = source.indexOf("const legacyHostingGroup");
  const v2Menu = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(v2Menu, /href:\s*["'][^"']*#/u);
  for (const [route] of publicRoutes) assert.match(v2Menu, new RegExp(`href: ["']${route.replaceAll("/", "\\/")}["']`, "u"));

  const css = readFileSync("app/globals.css", "utf8");
  assert.match(css, /\.nav-popover-links\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(css, /\.nav-popover-links a\[aria-current="page"\]/u);
});

test("legacy entry points route into the independent hosting pages", () => {
  const partnerSource = readFileSync("app/partners/page.tsx", "utf8");
  assert.match(partnerSource, /permanentRedirect\("\/hosting\/partners"\)/u);
  assert.ok(partnerSource.indexOf("isHostingV2Enabled()") < partnerSource.indexOf("permanentRedirect("));

  const guides = readFileSync("app/guides/page.tsx", "utf8");
  assert.doesNotMatch(guides, /\/hosting#/u);
  assert.match(guides, /\/hosting\/personal-gpu/u);
  assert.match(guides, /\/hosting\/cloud/u);

  const redirectSource = readFileSync("components/hosting-legacy-hash-redirect.tsx", "utf8");
  assert.match(redirectSource, /"#personal-gpu": "\/hosting\/personal-gpu"/u);
  assert.match(redirectSource, /"#cloud-provider": "\/hosting\/cloud"/u);
  assert.match(redirectSource, /"#earnings": "\/hosting\/earnings"/u);
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
