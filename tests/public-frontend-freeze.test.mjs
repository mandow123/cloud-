import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import test from "node:test";

const BASELINE = "bb7fd3211fdff28a448af85f53e9f40839ffa843";
const ROOT = join(import.meta.dirname, "..");
const EXTRA_FROZEN_FILES = ["data/model-market.snapshot.json", "lib/catalog.mjs"];
const APPROVED_PUBLIC_FILES = Object.freeze({
  "app/checkout/[resourceId]/page.tsx": "3bebbc74d265d24dd67a2d1c54816fbae604188ed57d1eeabe27bc6669c3693c",
  "app/login/page.tsx": "703ea83d1d8c970ae50ae92c866a447392f9687bfb1a0856c205bef4f53aff46",
  "app/member/page.tsx": "26a6e73ba5ab053d0aedd9e3c7f4d7ab5ffe6e24ae74448cbc5ce9434ce8a510",
  "components/account-login.tsx": "df5cb9c7800b6d2ba79a08b5c820bd002d8786fd2c9d3269797936795aa79dfa",
  "components/account-required.tsx": "20b2a1330e872904e8d6ba73442e24bd2c8bd53f47c8619448cd9cfacc77b755",
  "components/buyer-order-list.tsx": "fa15cbb70d18d19074633efc5d9fe60acd276ae4a45ab9df1e99dc3f6092d31a",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "af1fc2c0033003ca0dba671790e1950a1e62ff0d17873a9f1b9ff73ea07adaba",
  "components/member-workspace.tsx": "0f6c0827d710e851ab9f7ca35760ce5b1df771b6741302d049d206a3c0bb8745",
  "components/personal-center-overview.tsx": "c11de061d8efb74e3e86a1a5a555bdd1e19c30730cb73b56b3a65638bfff52f8",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "257acf460a7a68a55c04d668787b4d86e291eaa9522b8f456ede8666e3c3c05f",
  "components/resource-explorer.tsx": "aedd1b56606181b818b1a5c3b7bf123ba050c3333a56984d9c36778f524da7d0",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/site-header.tsx": "f0df0aac0be794e3030aea2d1f98cad48f8a7c94cb5276a6bcd48fca9390b44e",
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

test("the public frontend stays frozen outside the approved purchase and personal-account additions", () => {
  const changed = [];
  for (const path of [...baselineFiles(), ...EXTRA_FROZEN_FILES].filter((item) => !(item in APPROVED_PUBLIC_FILES))) {
    const currentPath = join(ROOT, path);
    if (!existsSync(currentPath)) {
      changed.push({ path, reason: "missing" });
      continue;
    }
    if (!sameContent(path, readFileSync(currentPath), baselineContent(path))) changed.push({ path, reason: "content differs" });
  }
  assert.deepEqual(changed, []);
});

test("the approved purchase and personal-account files are pinned", () => {
  for (const [path, expected] of Object.entries(APPROVED_PUBLIC_FILES)) {
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
    .filter((path) => path !== "app/login/page.tsx")
    .filter((path) => !baseline.has(path));
  assert.deepEqual(unexpected, []);
});

test("the admin panel stays isolated and the backend transaction entry points remain implemented", () => {
  for (const path of [
    "app/admin/layout.tsx",
    "app/admin/login/page.tsx",
    "app/admin/page.tsx",
    "app/login/page.tsx",
    "app/api/v1/admin/dashboard/route.ts",
    "app/api/v1/catalog-purchase-intents/route.ts",
    "app/api/v1/checkouts/route.ts",
    "app/api/v1/orders/route.ts",
    "app/api/v1/payments/alipay/readiness/route.ts",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  for (const path of [
    "app/buyer/orders/page.tsx",
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
  assert.match(purchase, /登录后提交购买/u);
  assert.match(purchase, /完善交易主体后提交/u);
  assert.match(purchase, /accountState === "loading" \? "正在核对账户…" : busy \? "正在提交…" : "提交购买"/u);
});
