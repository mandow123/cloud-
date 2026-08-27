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
  "app/globals.css": "c2c5e75a9f6d955d8145781557e3bb798cd1dca826544ac6e6ba3d0a62c8c60d",
  "app/gpu/page.tsx": "70838ea765a886ca7313cb4b2e00914f8a616a907e0a9e9499c3f5be9d713fdd",
  "app/guides/guides.module.css": "5e12ca1ab83f648e5ea59508f851f739f6a16bc1734bdc23bf60d83cf8cca88b",
  "app/guides/page.tsx": "7953719256414cacfb75e38f12707a67e511fbcb94aa19ef8ae9c9e5e03391db",
  "app/hosting/page.tsx": "fc74f511a198159a4f4f6fa395202a6ce25a9ac33599d2695a82375133668925",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx": "61414d5988494518b096ec8d8e07095851481bc42fad6f62e63a401634ab3b6a",
  "app/kai-cloud.css": "0b3252e02a8ab8050cb8da87ac0ec407e0fcd51285c7d856f4c3fdc28b63eac8",
  "app/layout.tsx": "5b58d109269961a697ffa3068f7f134d6e2bc56691cd1a569b1749fe53791dd7",
  "app/page.tsx": "3f68b8c3587d187148946c3317dbe6675b70649ebbd423e864f552a5410cb382",
  "app/methodology/page.tsx": "07f6c0547cc216903715e626548e1d2801a0cb829df12411f522e43cae7e5135",
  "app/request/page.tsx": "29b26ddcd028966bcd41b40650a27a02ade4b7942a421569adf58e47b26d5ab3",
  "app/resources/page.tsx": "1640b7ca93e113f2411c6f232094f4a08429584254e74de3537412cc7b1b2a86",
  "app/resources/[id]/page.tsx": "311e9a64a75cc8c35b8c9ea8ac572dd75f376a1c394439d26eb8d6da698f2846",
  "app/checkout/[resourceId]/page.tsx": "42eca4156fbd4f2625f7f18b7163233c3ca1fbda02b60d746ecb4902a50e8799",
  "app/login/page.tsx": "026689be202766d6cbcfae7b18b9ea7c7b86bf6a514d848184c84025899437e3",
  "app/member/page.tsx": "86f020c26af8956409caa9216c8bf29e61871109a7c237bf28d8c79c464441ff",
  "app/partners/page.tsx": "93cd20f90ebf8f6271b1b69fd79521b00497b02975beab97019b7bce121f2b52",
  "components/account-login.tsx": "2bbf68579e3c122d007861546462a072a1b84e98df47ecd315b0cdfa9c7b6cfc",
  "components/account-required.tsx": "eba4b05ead04f06c54a4863f0da123c8ded8d21e3071a5a3b609074f7d4cef04",
  "components/buyer-order-list.tsx": "fa15cbb70d18d19074633efc5d9fe60acd276ae4a45ab9df1e99dc3f6092d31a",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "06a5136e7e7cce354d02dfcc88f971c0e30aab7750e7fefd2c28b53b337f83bf",
  "components/admin-login.tsx": "0ec4b26ed6e04d40422f14d6c6b471265ff65f49d78df61c99c6c20bcb7f0567",
  "components/admin-resource-page.tsx": "b11613794dbb9c8bafff882a9686bbe70b030b07b87d17011d40fd8ec719809a",
  "components/card-hour-account-panel.tsx": "266bbcd889a3253fd33296ea22b7255efcde7700071da23451ec4abbce5651b6",
  "components/email-login.tsx": "43f6a8f1edc18b23ec099ba476c51d45b79e165bcd0f4a7778b5b78151874cb6",
  "components/gpu-cloud-lab.module.css": "379628eb1340717c0cefcc515cc281f7564b37870c5e8c89776fe9e3df9013c9",
  "components/gpu-cloud-lab.tsx": "64f60d95f596b7f0aa076575c2fed87ac19985aaaf021e21e0acaf0fe2334725",
  "components/live-home-market-hero.tsx": "03c532364110a7d47231cdf2622fae762ccfe69255b8b0b84e0ac8fb19739cbc",
  "components/member-workspace.tsx": "162d82572481ffa772fcbace13713cf984ec8e22e5eb132e703a91720c7e7d13",
  "components/mobile-demand-cta.tsx": "0fddd0e6043db5cfc7bb926c88a74481c18d3e9588a6c20b457c1ab5cca78ba3",
  "components/nav-links.tsx": "daca87be4b1269ffc15585c52d8ba98760c66f8e5d5424261f4bb5c7c40d5b21",
  "components/kai-standard-state.tsx": "9bdca04d4da3c14e68ced4915c0bc7af44cc8abf4c4a95c02eb2d4ed57bcabef",
  "components/personal-center-overview.tsx": "89f031d46092ad91738b88b32cb4fafb40792ef74c453b8e1caa0824357025e2",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "31a492a0fdfa2e9f972f4ca5fd9d52ea094d96fdb5c8b7e1b53f29352b128fbe",
  "components/resource-explorer.tsx": "368671c9dd31505009ea6a10b521767b12c2b497f9bf2d5d805b76d03d47c050",
  "components/resource-detail-actions.tsx": "be0f197a8c5e9580f9fa89425cb3a6f029b1aeed9f125339b62f068878a36c7c",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/language-control.tsx": "60ef4529327c666522617a5c61ab1b910b8acb343ee64aeb90261a9680179b18",
  "components/locale-provider.tsx": "09ff154d579021216b5acd170ef9bf3ab9a3345d3187b885a0aa38a6fe090709",
  "components/site-footer-view.tsx": "ead5d5d36fea877831e0d1df33f8f38bc121ffee96d83f61e81f7b9075273a87",
  "components/site-footer.tsx": "48314604150577a62fa8a334c0690be47ff72a48615f9d0ad393c441a44f5e9a",
  "components/site-header.tsx": "5bcb4e1cda1f2305dbc06673b5cb1cd641119e1fdacf4298910d7a3275821512",
  "components/theme-control.tsx": "cd99267af248143ef8a6e3a488b53878de2e3d144e49ca3bd0deb263ab9d9c59",
  "components/supply-api-client.tsx": "60292f9e3e4a141f3a69be788b3d627f3969f67aeecb6153dc5fbc1f02a97825",
  "components/supply-listings-dashboard.tsx": "e5a24ab251eed94562f51f523590bba70a041b1551c11bdaa5234ae300a6f0d4",
  "components/supply-order-workspace.tsx": "771eca38029a65863d3012b5bc21babd084339307a9fad1c9a53e74c6b005375",
  "lib/catalog.mjs": "814608044dda4a2b9e25902b1c07963d43a675ab8d3d42ab8f8aff89db0ca568",
  "lib/i18n.ts": "c90c60e8419efc11064957154f91507608b7da6b4c3f57fa289f00fc955afcda",
  "public/og-home-v2.png": "9ab58389125a32bbe84a29a6f73f7f7f75cdb04c717c58c82233f7ec09d63d5d",
  "public/assets/suppliers/shanghai-honghuan.jpg": "db1ed9e4cddc31f4b6e641bbc9179443e5a5d251a31abe28109c3fa55f32a70f",
});
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
  "app/member/purchases/[demandId]/page.tsx",
  "app/member/purchases/page.tsx",
  "app/member/card-hours/page.tsx",
  "app/member/card-hours/topups/[orderId]/return/page.tsx",
  "app/member/card-hours/topups/[orderId]/appeal/page.tsx",
  "app/member/layout.tsx",
  "app/supply/layout.tsx",
  "app/supply/apply/page.tsx",
  "app/supply/applications/page.tsx",
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
  assert.match(explorer, /classification === "PRIMARY_INQUIRY"[\s\S]*!inquiryEnabled[\s\S]*人工询价维护中/u);
  assert.match(explorer, /classification === "REFERENCE_LEAD" \? "提交相关需求" : "提交算力需求"/u);
  assert.match(explorer, /classifications\[resource\.id\] \?\? "EXCLUDED"/u);
  const buttonCss = readFileSync(join(ROOT, "components/resource-purchase.module.css"), "utf8");
  assert.match(buttonCss, /background:\s*#117f7b/u);
  assert.match(buttonCss, /justify-content:\s*space-between/u);
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
  assert.match(readFileSync(join(ROOT, "app/market/listings/page.tsx"), "utf8"), /redirect\("\/buy"\)/u);

  for (const path of APPROVED_HOSTING_V2_ROUTES) assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);
  const supplyLayout = readFileSync(join(ROOT, "app/supply/layout.tsx"), "utf8");
  assert.match(supplyLayout, /new URL\("\/hosting", origin\)\.toString\(\)/u);
  assert.match(supplyLayout, /const accountConsoleV2Enabled = isAccountConsoleV2Enabled\(\)/u);
  assert.match(supplyLayout, /if \(!accountConsoleV2Enabled && !isHostingV2SetupEnabled\(\)\) redirect\(hostingLandingUrl\(\)\)/u);
  assert.match(supplyLayout, /const configurationMode = !isHostingV2Enabled\(\)/u);
  assert.match(supplyLayout, /configurationMode=\{configurationMode\}/u);
  assert.match(supplyLayout, /<AccountRequired purpose="管理供应资源">/u);

  for (const path of [
    "app/checkout/[resourceId]/page.tsx",
    "components/catalog-purchase.tsx",
    "components/catalog-purchase.module.css",
    "components/resource-purchase.module.css",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  const purchase = readFileSync(join(ROOT, "components/catalog-purchase.tsx"), "utf8");
  assert.match(purchase, /确认算力套餐与询价信息/u);
  assert.doesNotMatch(purchase, /人民币参考价|¥/u);
  assert.match(purchase, /卡时参考范围/u);
  assert.match(purchase, /询价参考总计/u);
  assert.match(purchase, /平台人工确认库存与正式卡时报价/u);
  assert.match(purchase, /登录后提交询价/u);
  assert.match(purchase, /完善交易主体后提交/u);
  assert.match(purchase, /accountState === "loading" \? "正在核对账户…" : busy \? "正在提交…" : "提交询价"/u);
});
