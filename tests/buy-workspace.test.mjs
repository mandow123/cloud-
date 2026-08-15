import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("/buy is a signed-in buyer workspace with a hard login redirect", () => {
  const page = read("app/buy/page.tsx");
  assert.match(page, /<AccountRequired[^>]+purpose="进入购买算力工作台"[^>]+redirectOnSignedOut/u);
  assert.match(page, /<BuyWorkspace catalogListings=\{resourceListings\}/u);
});

test("the primary purchase list is driven only by readiness and real offers", () => {
  const workspace = read("components/buy-workspace.tsx");
  for (const endpoint of ["/api/ready", "/api/v2/offers", "/api/v1/member/card-hours"]) {
    assert.match(workspace, new RegExp(endpoint.replaceAll("/", "\\/"), "u"));
  }
  assert.match(workspace, /readyBody\.hostingV2\.enabled \|\| !readyBody\.hostingV2\.ready/u);
  assert.match(workspace, /href=\{`\/gpu\/offers\/\$\{encodeURIComponent\(offer\.id\)\}`\}/u);
  assert.match(workspace, /SETUP：真实交易尚未开放/u);
  assert.doesNotMatch(workspace, /\/checkout\//u);
});

test("card-hour amounts keep two decimal places and the workspace links related buyer routes", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /formatCardHourDisplayMicros/u);
  for (const href of ["/gpu", "/member#orders", "/member#card-hours", "/resources"]) {
    assert.match(workspace, new RegExp(`href=["']${href.replaceAll("/", "\\/")}["']`, "u"));
  }
});

test("live-offer comparison stays isolated from static catalog IDs and is capped at three", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /kai-cloud-live-offer-compare-v1/u);
  assert.doesNotMatch(workspace, /["']kai-cloud-compare-v1["']/u);
  assert.match(workspace, /\.slice\(0, 3\)/u);
  assert.match(workspace, /current\.length >= 3/u);
  assert.match(workspace, /kai-live-offer-compare-changed/u);
});

test("minimum card-hour hold uses exact integer arithmetic", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /BigInt\(rate\) \* BigInt\(seconds\)/u);
  assert.match(workspace, /\+ 3_599n\) \/ 3_600n/u);
  assert.doesNotMatch(workspace, /Math\.ceil\(offer\.pricing\.cardHourMicrosPerGpuHour/u);
});

test("static catalog entries are clearly inquiry-only and never presented as inventory", () => {
  const workspace = read("components/buy-workspace.tsx");
  assert.match(workspace, /目录资源需平台核验，不是即时库存/u);
  assert.match(workspace, /href=\{`\/request\?listing=\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
  assert.match(workspace, /href=\{`\/resources\/\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
  assert.doesNotMatch(workspace, /href=\{`\/checkout\/\$\{encodeURIComponent\(listing\.id\)\}`\}/u);
});

test("the new responsive module uses only shared design tokens", () => {
  const path = join(ROOT, "components/buy-workspace.module.css");
  assert.equal(existsSync(path), true);
  const css = read("components/buy-workspace.module.css");
  for (const token of ["--canvas", "--surface", "--ink", "--text", "--border", "--accent"]) {
    assert.match(css, new RegExp(`var\\(${token}\\)`, "u"));
  }
  assert.match(css, /@media \(max-width: 640px\)/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);
});
