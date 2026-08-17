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
  "app/guides/guides.module.css": "5e12ca1ab83f648e5ea59508f851f739f6a16bc1734bdc23bf60d83cf8cca88b",
  "app/guides/page.tsx": "359d797ba915fa057490c4df7152debfc509f20df74943659641e4a9856f9f61",
  "app/hosting/page.tsx": "fc74f511a198159a4f4f6fa395202a6ce25a9ac33599d2695a82375133668925",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx": "61414d5988494518b096ec8d8e07095851481bc42fad6f62e63a401634ab3b6a",
  "app/kai-cloud.css": "59ca9cf3620c5f482fc3cf9d1c1fdde5b5ef0420fc3c797f9bdd16a1c1bd5027",
  "app/layout.tsx": "1b6ea3757ed0b4da7d7838356b1aeb3c529244e2ec2c4e7aa1057bc4e921394c",
  "app/page.tsx": "83cc208dd90376a9a9c1738fea99a2c247f0c52b16e15355f3d49831255048cf",
  "app/methodology/page.tsx": "8a45698146e2cd9b526e2d6d2226308362ff598324993fc6a8a6d66fdc84442c",
  "app/request/page.tsx": "29b26ddcd028966bcd41b40650a27a02ade4b7942a421569adf58e47b26d5ab3",
  "app/checkout/[resourceId]/page.tsx": "1d74adc839f54519e4914080f71e09fc50eb2660bff582c4cd71310ecdfc12b9",
  "app/login/page.tsx": "026689be202766d6cbcfae7b18b9ea7c7b86bf6a514d848184c84025899437e3",
  "app/member/page.tsx": "89f1c5e35b946cdf0a6cf6b59c7e81e93f15cc7936971a4c88b11e42b5891d48",
  "app/partners/page.tsx": "93cd20f90ebf8f6271b1b69fd79521b00497b02975beab97019b7bce121f2b52",
  "components/account-login.tsx": "2bbf68579e3c122d007861546462a072a1b84e98df47ecd315b0cdfa9c7b6cfc",
  "components/account-required.tsx": "eba4b05ead04f06c54a4863f0da123c8ded8d21e3071a5a3b609074f7d4cef04",
  "components/buyer-order-list.tsx": "ff91b904c975b1dde89e0ecf09caa07d09a05b6217837556512865a2ff812fbd",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "e3188f907d18f2b920239b157362994f775eafdaef05138bd3706d6f8da13aeb",
  "components/admin-login.tsx": "0ec4b26ed6e04d40422f14d6c6b471265ff65f49d78df61c99c6c20bcb7f0567",
  "components/admin-resource-page.tsx": "026788b741fd20de28fe0095722822edcc5ae20305e2335d2217a66b70b70c4d",
  "components/card-hour-account-panel.tsx": "ca36b7a159049ea169daa34c32b43a5ab2f563425fa34c1c2fedff2fe0eab378",
  "components/email-login.tsx": "43f6a8f1edc18b23ec099ba476c51d45b79e165bcd0f4a7778b5b78151874cb6",
  "components/gpu-cloud-lab.module.css": "379628eb1340717c0cefcc515cc281f7564b37870c5e8c89776fe9e3df9013c9",
  "components/gpu-cloud-lab.tsx": "64f60d95f596b7f0aa076575c2fed87ac19985aaaf021e21e0acaf0fe2334725",
  "components/live-home-market-hero.tsx": "087df106763e362423622ebdd22a5e18ef3fc61dee3ab1cc452fef0fcace127d",
  "components/member-workspace.tsx": "2991a12d3e6dd3b0635117bda6c5af1591d94d0725e4ccabf4e5a0361adf2731",
  "components/mobile-demand-cta.tsx": "de0d4913ee24e1cbfc375ac8ce518f19c820efc0a4fc3ab5f677d6e2d7b56acc",
  "components/nav-links.tsx": "6c1013b447f225e6f8d2c6db462c74cca8fe25b4c83b5d0e204beadafd9359e5",
  "components/kai-standard-state.tsx": "9bdca04d4da3c14e68ced4915c0bc7af44cc8abf4c4a95c02eb2d4ed57bcabef",
  "components/personal-center-overview.tsx": "89f031d46092ad91738b88b32cb4fafb40792ef74c453b8e1caa0824357025e2",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "041faa99c5f6f6e7f59f49b7639397ef05a6edff7778d5577d8abd369e0e7926",
  "components/resource-explorer.tsx": "15a19133271daabbfd7fa8a2d78f432055dfe1738cace06fa9d83464aa3c54d9",
  "components/resource-detail-actions.tsx": "e0b85851d955b1eed95756e520274f7462a29a5b4e4e46ab01d1d1204f50de53",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/site-footer.tsx": "323a6233a7e26f38935f2f854f5d3fa2b3b086512d07bccd87205bbd0bf178d5",
  "components/site-header.tsx": "6cb13d63b22522ef1471c343db061e8b148a3f49a34914923cea31cc61a37a74",
  "components/supply-api-client.tsx": "60292f9e3e4a141f3a69be788b3d627f3969f67aeecb6153dc5fbc1f02a97825",
  "components/supply-listings-dashboard.tsx": "e5a24ab251eed94562f51f523590bba70a041b1551c11bdaa5234ae300a6f0d4",
  "components/supply-order-workspace.tsx": "771eca38029a65863d3012b5bc21babd084339307a9fad1c9a53e74c6b005375",
  "lib/catalog.mjs": "cc7df54eb25b186aa25529ac89719a70af54bc67c86f82270d483e3268b2817a",
  "public/og-home-v2.png": "9ab58389125a32bbe84a29a6f73f7f7f75cdb04c717c58c82233f7ec09d63d5d",
});
const APPROVED_DATA_TRUTHFULNESS_FILES = new Set([
  "app/market/page.tsx",
  "app/resources/[id]/page.tsx",
  "app/resources/page.tsx",
  "components/live-model-price-board.tsx",
  "components/market-dashboard.tsx",
  "components/model-price-board.tsx",
  "components/order-detail.tsx",
  "components/request-workbench.tsx",
]);
const APPROVED_HOSTING_V2_ROUTES = new Set([
  "app/buy/page.tsx",
  "app/buyer/orders/[id]/page.tsx",
  "app/buyer/orders/page.tsx",
  "app/campaigns/dgx-spark/page.tsx",
  "app/guides/host-agent/page.tsx",
  "app/gpu/contracts/[contractId]/page.tsx",
  "app/gpu/contracts/page.tsx",
  "app/gpu/offers/[offerId]/page.tsx",
  "app/hosting/cloud/page.tsx",
  "app/hosting/earnings/page.tsx",
  "app/hosting/partners/page.tsx",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx",
  "app/hosting/personal-gpu/page.tsx",
  "app/market/listings/page.tsx",
  "app/member/assets/page.tsx",
  "app/supply/layout.tsx",
  "app/supply/earnings/page.tsx",
  "app/supply/devices/[deviceId]/page.tsx",
  "app/supply/devices/new/page.tsx",
  "app/supply/devices/page.tsx",
  "app/supply/listings/new/page.tsx",
  "app/supply/listings/page.tsx",
  "app/supply/onboarding/page.tsx",
  "app/supply/orders/[contractId]/page.tsx",
  "app/supply/orders/page.tsx",
  "app/supply/page.tsx",
  "app/supply/resources/[deviceId]/page.tsx",
  "app/supply/resources/new/page.tsx",
  "app/supply/resources/page.tsx",
  "app/supply/tasks/page.tsx",
]);
const APPROVED_HOSTING_V2_COMPONENTS = new Set([
  "components/hosting-launchpad.tsx",
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
  for (const path of [...baselineFiles(), ...EXTRA_FROZEN_FILES].filter((item) => !(item in APPROVED_PUBLIC_FILES) && !APPROVED_DATA_TRUTHFULNESS_FILES.has(item))) {
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
  assert.equal((explorer.match(/<span>提交需求<\/span>/gu) ?? []).length, 2);
  assert.match(explorer, /历史初始化样本/u);
  assert.match(explorer, /报价已过期/u);
  assert.doesNotMatch(explorer, /\/checkout\//u);
  for (const path of ["components/account-required.tsx", "components/kai-standard-state.tsx", "components/personal-center-overview.tsx"]) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.match(source, /统一账号登录/u);
    assert.doesNotMatch(source, /邮箱验证码登录/u);
  }
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

test("approved Hosting V2 components stay narrowly scoped to the additive product", () => {
  for (const path of APPROVED_HOSTING_V2_COMPONENTS) assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);
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

  assert.equal(existsSync(join(ROOT, "app/supplier/page.tsx")), false, "the legacy supplier page must not be publicly exposed");

  const buyerOrderDetail = readFileSync(join(ROOT, "app/buyer/orders/[id]/page.tsx"), "utf8");
  assert.match(buyerOrderDetail, /<AccountRequired purpose="查看采购订单">/u);
  assert.match(readFileSync(join(ROOT, "app/buyer/orders/page.tsx"), "utf8"), /redirect\("\/member#orders"\)/u);
  const legacyMarketListings = readFileSync(join(ROOT, "app/market/listings/page.tsx"), "utf8");
  assert.match(legacyMarketListings, /LEGACY_PRODUCT_REDIRECTS/u);
  assert.match(legacyMarketListings, /redirect\(LEGACY_PRODUCT_REDIRECTS\.marketListings\)/u);

  for (const path of APPROVED_HOSTING_V2_ROUTES) assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);
  const supplyLayout = readFileSync(join(ROOT, "app/supply/layout.tsx"), "utf8");
  assert.match(supplyLayout, /new URL\("\/hosting", origin\)\.toString\(\)/u);
  assert.match(supplyLayout, /if \(!isHostingV2SetupEnabled\(\)\) redirect\(hostingLandingUrl\(\)\)/u);
  assert.match(supplyLayout, /configurationMode=\{!isHostingV2Enabled\(\)\}/u);
  assert.match(supplyLayout, /<AccountRequired purpose="管理供应资源">/u);

  assert.ok(existsSync(join(ROOT, "app/checkout/[resourceId]/page.tsx")), "legacy checkout redirect is missing");
  const legacyCheckout = readFileSync(join(ROOT, "app/checkout/[resourceId]/page.tsx"), "utf8");
  assert.match(legacyCheckout, /permanentRedirect\(`\/request\?/u);
  assert.doesNotMatch(legacyCheckout, /CatalogPurchase/u);
});
