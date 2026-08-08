import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const lifecycleSections = [
  "capacity-lots",
  "listings",
  "withdrawals",
  "swaps",
  "metering",
  "settlements",
  "commissions",
  "standardization",
];

test("admin navigation and pages expose the complete backend lifecycle", () => {
  const viewModels = source("lib/admin-view-models.ts");
  for (const section of lifecycleSections) {
    assert.match(viewModels, new RegExp(`key: "${section}"`, "u"), `${section} needs a typed admin section`);
    assert.match(viewModels, new RegExp(`href: "/admin/${section}"`, "u"), `${section} needs admin navigation`);
    const page = source(`app/admin/${section}/page.tsx`);
    assert.match(page, new RegExp(`section="${section}"`, "u"));
  }
  assert.doesNotMatch(viewModels, /path: "\/api\/v1\/admin\/(?:delivery|exceptions)"[^\n]*fallbackPath/u);
});

test("admin lifecycle pages stay isolated from the frozen public frontend", () => {
  const frozen = source("tests/public-frontend-freeze.test.mjs");
  assert.match(frozen, /complete public frontend is byte-identical to the deployed bb7fd32 baseline/u);
  assert.match(frozen, /only approved existing-frontend change is the pinned purchase control under compare/u);
  for (const path of [
    "app/page.tsx",
    "app/market/page.tsx",
    "app/member/page.tsx",
    "app/partners/page.tsx",
    "app/globals.css",
    "app/kai-cloud.css",
  ]) {
    assert.doesNotMatch(source(path), /AdminResourcePage|adminSectionConfigs|\/api\/v1\/admin\//u, `${path} must remain outside the admin surface`);
  }
});
