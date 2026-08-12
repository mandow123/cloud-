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
  "app/globals.css": "ec7a571de1736342b040373ae9c612cf1d1bd31a2850b7de060868b5513daca1",
  "app/gpu/page.tsx": "c9e67a55dee7a2b08458871420f2c6f7dabec6c8a837da22fd637eb0150e75f9",
  "app/guides/guides.module.css": "d3320f7eb17ca8e79f0e6d6a9bf1858ddf61b680bcb0d10cea96ddf820de7daf",
  "app/guides/page.tsx": "7953719256414cacfb75e38f12707a67e511fbcb94aa19ef8ae9c9e5e03391db",
  "app/hosting/page.tsx": "d7ec17cc41d4a89f12c676a01b07a75b739ae327605c9d33aec2bebaa60a6871",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx": "ca6dc0a0e7044815a3bc1ced810ce6e32064dd0b55d37056f970846274c72966",
  "app/kai-cloud.css": "8628368856b22f036f57cc5b9cc8cc80c91b39309b4be7115109562ac0ffddd0",
  "app/layout.tsx": "1b6ea3757ed0b4da7d7838356b1aeb3c529244e2ec2c4e7aa1057bc4e921394c",
  "app/page.tsx": "f45d9ccae1045825e60883945c3ab8b1090f2aae719866a24db51c3eb320851a",
  "app/checkout/[resourceId]/page.tsx": "3bebbc74d265d24dd67a2d1c54816fbae604188ed57d1eeabe27bc6669c3693c",
  "app/login/page.tsx": "17e80a16d3d45df1843ffc54f0b824b63c7e8f0ed344f9fb571304dd04103f22",
  "app/member/page.tsx": "c72c258a8266554e939f686f7f9e3b26539a37d174fbfb8ab6b5f7a7a6edb272",
  "app/partners/page.tsx": "93cd20f90ebf8f6271b1b69fd79521b00497b02975beab97019b7bce121f2b52",
  "components/account-login.tsx": "8096ca1e7921f2326038335df6000c693e23df03f6def5a9918ba90086dedd51",
  "components/account-required.tsx": "20b2a1330e872904e8d6ba73442e24bd2c8bd53f47c8619448cd9cfacc77b755",
  "components/buyer-order-list.tsx": "fa15cbb70d18d19074633efc5d9fe60acd276ae4a45ab9df1e99dc3f6092d31a",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "8ac8b649b82789a0b7c12212c1e0a139f4c6c5f464c7897a974b5fc6730c7555",
  "components/admin-login.tsx": "0ec4b26ed6e04d40422f14d6c6b471265ff65f49d78df61c99c6c20bcb7f0567",
  "components/admin-resource-page.tsx": "026788b741fd20de28fe0095722822edcc5ae20305e2335d2217a66b70b70c4d",
  "components/card-hour-account-panel.tsx": "b46e420489f7d023c26b640446a28150be0a68b91a340e238f5f0eddf81497d9",
  "components/email-login.tsx": "43f6a8f1edc18b23ec099ba476c51d45b79e165bcd0f4a7778b5b78151874cb6",
  "components/gpu-cloud-lab.module.css": "379628eb1340717c0cefcc515cc281f7564b37870c5e8c89776fe9e3df9013c9",
  "components/gpu-cloud-lab.tsx": "c772136928bbddea80d12f10cb9c928429b7422110578f9d3eb13127bc310899",
  "components/live-home-market-hero.tsx": "12b5174eb3b58c9bbcd37215876e47c08e37e782b216536cc344cdd8e2a5bc7a",
  "components/member-workspace.tsx": "0f6c0827d710e851ab9f7ca35760ce5b1df771b6741302d049d206a3c0bb8745",
  "components/nav-links.tsx": "289714aa4a7a54ebe92988f7c3f417d1de7af386915eece4dea18ee5cac98ece",
  "components/personal-center-overview.tsx": "c11de061d8efb74e3e86a1a5a555bdd1e19c30730cb73b56b3a65638bfff52f8",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "31a492a0fdfa2e9f972f4ca5fd9d52ea094d96fdb5c8b7e1b53f29352b128fbe",
  "components/resource-explorer.tsx": "aedd1b56606181b818b1a5c3b7bf123ba050c3333a56984d9c36778f524da7d0",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/site-footer.tsx": "323a6233a7e26f38935f2f854f5d3fa2b3b086512d07bccd87205bbd0bf178d5",
  "components/site-header.tsx": "1fdf92590f59af37232c8c16b99fc163798fa135bfbed5663129b3908c16cad5",
  "components/supply-api-client.tsx": "60292f9e3e4a141f3a69be788b3d627f3969f67aeecb6153dc5fbc1f02a97825",
  "components/supply-listings-dashboard.tsx": "e5a24ab251eed94562f51f523590bba70a041b1551c11bdaa5234ae300a6f0d4",
  "components/supply-order-workspace.tsx": "2a38d9534b85d17b4b493673aa3f0c327db22d1bed0c8a0a8afdd20b4e0fdffa",
  "public/og-home-v2.png": "9ab58389125a32bbe84a29a6f73f7f7f75cdb04c717c58c82233f7ec09d63d5d",
});
const APPROVED_HOSTING_V2_ROUTES = new Set([
  "app/gpu/contracts/[contractId]/page.tsx",
  "app/gpu/contracts/page.tsx",
  "app/gpu/offers/[offerId]/page.tsx",
  "app/hosting/cloud/page.tsx",
  "app/hosting/earnings/page.tsx",
  "app/hosting/partners/page.tsx",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx",
  "app/hosting/personal-gpu/page.tsx",
  "app/supply/layout.tsx",
  "app/supply/earnings/page.tsx",
  "app/supply/listings/new/page.tsx",
  "app/supply/listings/page.tsx",
  "app/supply/onboarding/page.tsx",
  "app/supply/orders/[contractId]/page.tsx",
  "app/supply/orders/page.tsx",
  "app/supply/page.tsx",
  "app/supply/resources/[deviceId]/page.tsx",
  "app/supply/resources/new/page.tsx",
  "app/supply/resources/page.tsx",
]);

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

test("the established public frontend stays frozen outside explicitly approved additions", () => {
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

test("approved shared public files are pinned", () => {
  for (const [path, expected] of Object.entries(APPROVED_PUBLIC_FILES)) {
    const actual = createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
    assert.equal(actual, expected, `${path} changed outside the approved public design`);
  }
  const explorer = readFileSync(join(ROOT, "components/resource-explorer.tsx"), "utf8");
  assert.equal((explorer.match(/className=\{purchaseStyles\.purchaseLink\}/gu) ?? []).length, 2);
  assert.match(explorer, /加入对比[\s\S]{0,700}className=\{purchaseStyles\.purchaseLink\}[\s\S]{0,400}<span>购买<\/span>/u);
  const buttonCss = readFileSync(join(ROOT, "components/resource-purchase.module.css"), "utf8");
  assert.match(buttonCss, /background:\s*#117f7b/u);
  assert.match(buttonCss, /justify-content:\s*space-between/u);
});

test("only approved Hosting V2 pages and gated supplier pages extend the public route tree", () => {
  const baseline = new Set(baselineFiles());
  const unexpected = walk(join(ROOT, "app"))
    .map((path) => relative(ROOT, path).split(sep).join("/"))
    .filter((path) => /\/(?:page|layout)\.tsx$/u.test(path))
    .filter((path) => !path.startsWith("app/api/"))
    .filter((path) => !path.startsWith("app/admin/"))
    .filter((path) => path !== "app/checkout/[resourceId]/page.tsx")
    .filter((path) => path !== "app/login/page.tsx")
    .filter((path) => !["app/gpu/page.tsx", "app/guides/page.tsx", "app/hosting/page.tsx"].includes(path))
    .filter((path) => !APPROVED_HOSTING_V2_ROUTES.has(path))
    .filter((path) => !baseline.has(path));
  assert.deepEqual(unexpected, []);
});

test("the admin panel stays isolated, supplier pages stay gated and transaction entry points remain implemented", () => {
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
  ]) assert.equal(existsSync(join(ROOT, path)), false, `${path} must not be publicly exposed`);

  for (const path of APPROVED_HOSTING_V2_ROUTES) assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);
  const supplyLayout = readFileSync(join(ROOT, "app/supply/layout.tsx"), "utf8");
  assert.match(supplyLayout, /if \(!isHostingV2Enabled\(\)\) redirect\("\/hosting"\)/u);
  assert.match(supplyLayout, /<AccountRequired purpose="管理供应资源">/u);

  for (const path of [
    "app/checkout/[resourceId]/page.tsx",
    "components/catalog-purchase.tsx",
    "components/catalog-purchase.module.css",
    "components/resource-purchase.module.css",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  const purchase = readFileSync(join(ROOT, "components/catalog-purchase.tsx"), "utf8");
  assert.match(purchase, /确认资源与购买价格/u);
  assert.match(purchase, /人民币参考价/u);
  assert.match(purchase, /预计支付卡时/u);
  assert.match(purchase, /平台确认库存与正式价格/u);
  assert.match(purchase, /登录后提交购买/u);
  assert.match(purchase, /完善交易主体后提交/u);
  assert.match(purchase, /accountState === "loading" \? "正在核对账户…" : busy \? "正在提交…" : "提交购买"/u);
});
