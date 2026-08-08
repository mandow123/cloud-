import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

const BASELINE = "bb7fd3211fdff28a448af85f53e9f40839ffa843";
const ROOT = join(import.meta.dirname, "..");
const EXTRA_FROZEN_FILES = ["data/model-market.snapshot.json", "lib/catalog.mjs"];
const APPROVED_PURCHASE_FILES = Object.freeze({
  "components/resource-explorer.tsx": "5dc85613ee44d521687a7e9c6aef4775457af459102a093259394c412a9e938a",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/catalog-purchase.tsx": "e403a5436923898971fda1484326ee47aa088e4fc8fe193d60cf833354fc6602",
});

function git(args, encoding = "utf8") {
  return execFileSync("git", args, { cwd: ROOT, encoding, maxBuffer: 16 * 1024 * 1024 });
}

function baselineFiles() {
  return git(["ls-tree", "-r", "--name-only", BASELINE, "app", "components", "public"])
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((path) => !path.startsWith("app/api/"));
}

function baselineContent(path) {
  return git(["show", `${BASELINE}:${path}`], "buffer");
}

function sameContent(path, current, baseline) {
  if (current.equals(baseline)) return true;
  if (!/\.(?:css|json|mjs|ts|tsx|txt)$/u.test(path)) return false;
  return current.toString("utf8").replaceAll("\r\n", "\n")
    === baseline.toString("utf8").replaceAll("\r\n", "\n");
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test("the complete public frontend is byte-identical to the deployed bb7fd32 baseline", () => {
  const changed = [];
  for (const path of [...baselineFiles(), ...EXTRA_FROZEN_FILES].filter((item) => item !== "components/resource-explorer.tsx")) {
    const currentPath = join(ROOT, path);
    if (!existsSync(currentPath)) {
      changed.push({ path, reason: "missing" });
      continue;
    }
    if (!sameContent(path, readFileSync(currentPath), baselineContent(path))) changed.push({ path, reason: "content differs" });
  }
  assert.deepEqual(changed, []);
});

test("the only approved existing-frontend change is the pinned purchase control under compare", () => {
  for (const [path, expected] of Object.entries(APPROVED_PURCHASE_FILES)) {
    const actual = createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
    assert.equal(actual, expected, `${path} changed outside the approved purchase design`);
  }
  const explorer = readFileSync(join(ROOT, "components/resource-explorer.tsx"), "utf8");
  assert.equal((explorer.match(/className=\{purchaseStyles\.purchaseLink\}/gu) ?? []).length, 2);
  assert.match(explorer, /加入对比[\s\S]{0,700}className=\{purchaseStyles\.purchaseLink\}[\s\S]{0,400}<span>购买<\/span>/u);
  const buttonCss = readFileSync(join(ROOT, "components/resource-purchase.module.css"), "utf8");
  assert.match(buttonCss, /background:\s*#117f7b/u);
  assert.match(buttonCss, /justify-content:\s*space-between/u);
});

test("no new public page or layout is exposed outside the isolated admin panel", () => {
  const baseline = new Set(baselineFiles());
  const unexpected = walk(join(ROOT, "app"))
    .map((path) => relative(ROOT, path).split(sep).join("/"))
    .filter((path) => /\/(?:page|layout)\.tsx$/u.test(path))
    .filter((path) => !path.startsWith("app/api/"))
    .filter((path) => !path.startsWith("app/admin/"))
    .filter((path) => path !== "app/checkout/[resourceId]/page.tsx")
    .filter((path) => !baseline.has(path));
  assert.deepEqual(unexpected, []);
});

test("the admin panel stays isolated and the backend transaction entry points remain implemented", () => {
  for (const path of [
    "app/admin/layout.tsx",
    "app/admin/login/page.tsx",
    "app/admin/page.tsx",
    "app/api/v1/admin/dashboard/route.ts",
    "app/api/v1/catalog-purchase-intents/route.ts",
    "app/api/v1/checkouts/route.ts",
    "app/api/v1/orders/route.ts",
    "app/api/v1/payments/alipay/readiness/route.ts",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  for (const path of [
    "app/buyer/orders/page.tsx",
    "app/login/page.tsx",
    "app/market/listings/page.tsx",
    "app/supplier/page.tsx",
    "app/supply/page.tsx",
  ]) assert.equal(existsSync(join(ROOT, path)), false, `${path} must not be publicly exposed`);

  for (const path of [
    "app/checkout/[resourceId]/page.tsx",
    "components/catalog-purchase.tsx",
    "components/catalog-purchase.module.css",
    "components/resource-purchase.module.css",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  const purchase = readFileSync(join(ROOT, "components/catalog-purchase.tsx"), "utf8");
  assert.match(purchase, /确认资源与购买价格/u);
  assert.match(purchase, /预计金额/u);
  assert.match(purchase, /平台确认库存与正式价格/u);
  assert.match(purchase, /<span>\{busy \? "正在提交…" : "提交购买"\}<\/span><span aria-hidden="true">→<\/span>/u);
});
