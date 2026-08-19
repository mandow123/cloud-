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
  "app/gpu/page.tsx": "69910888faf0c640cf17f419a102acdb5b9520fa4d3a96ca27bd0433dfcd0ab3",
  "app/guides/guides.module.css": "5e12ca1ab83f648e5ea59508f851f739f6a16bc1734bdc23bf60d83cf8cca88b",
  "app/guides/page.tsx": "7953719256414cacfb75e38f12707a67e511fbcb94aa19ef8ae9c9e5e03391db",
  "app/hosting/page.tsx": "fc74f511a198159a4f4f6fa395202a6ce25a9ac33599d2695a82375133668925",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx": "61414d5988494518b096ec8d8e07095851481bc42fad6f62e63a401634ab3b6a",
  "app/kai-cloud.css": "59ca9cf3620c5f482fc3cf9d1c1fdde5b5ef0420fc3c797f9bdd16a1c1bd5027",
  "app/layout.tsx": "1b6ea3757ed0b4da7d7838356b1aeb3c529244e2ec2c4e7aa1057bc4e921394c",
  "app/page.tsx": "3f68b8c3587d187148946c3317dbe6675b70649ebbd423e864f552a5410cb382",
  "app/methodology/page.tsx": "07f6c0547cc216903715e626548e1d2801a0cb829df12411f522e43cae7e5135",
  "app/request/page.tsx": "29b26ddcd028966bcd41b40650a27a02ade4b7942a421569adf58e47b26d5ab3",
  "app/resources/[id]/page.tsx": "12d153a6251b7a18c104837e2da88949765517a10c33508d81a52694c71484cd",
  "app/checkout/[resourceId]/page.tsx": "1b8eb402de18d01b908aa8a32d6391ab6c10e55b537bdfd01b5b886f9424edf3",
  "app/login/page.tsx": "026689be202766d6cbcfae7b18b9ea7c7b86bf6a514d848184c84025899437e3",
  "app/member/page.tsx": "162e46638546d9b381d47e9952cac503a7f1c2597a41ce5743bb273f8235bf5f",
  "app/partners/page.tsx": "93cd20f90ebf8f6271b1b69fd79521b00497b02975beab97019b7bce121f2b52",
  "components/account-login.tsx": "2bbf68579e3c122d007861546462a072a1b84e98df47ecd315b0cdfa9c7b6cfc",
  "components/account-required.tsx": "eba4b05ead04f06c54a4863f0da123c8ded8d21e3071a5a3b609074f7d4cef04",
  "components/buyer-order-list.tsx": "fa15cbb70d18d19074633efc5d9fe60acd276ae4a45ab9df1e99dc3f6092d31a",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "e3c58f93c7ca0610d9fde2e460cbf631a1ad9c1e6892b1e617284a4046a9dcb0",
  "components/admin-login.tsx": "0ec4b26ed6e04d40422f14d6c6b471265ff65f49d78df61c99c6c20bcb7f0567",
  "components/admin-resource-page.tsx": "b11613794dbb9c8bafff882a9686bbe70b030b07b87d17011d40fd8ec719809a",
  "components/card-hour-account-panel.tsx": "bad8cbe4908decf2c6a08e1e4cb597d23e30e62947067ed233204a240019c206",
  "components/email-login.tsx": "43f6a8f1edc18b23ec099ba476c51d45b79e165bcd0f4a7778b5b78151874cb6",
  "components/gpu-cloud-lab.module.css": "379628eb1340717c0cefcc515cc281f7564b37870c5e8c89776fe9e3df9013c9",
  "components/gpu-cloud-lab.tsx": "64f60d95f596b7f0aa076575c2fed87ac19985aaaf021e21e0acaf0fe2334725",
  "components/live-home-market-hero.tsx": "03c532364110a7d47231cdf2622fae762ccfe69255b8b0b84e0ac8fb19739cbc",
  "components/member-workspace.tsx": "162d82572481ffa772fcbace13713cf984ec8e22e5eb132e703a91720c7e7d13",
  "components/mobile-demand-cta.tsx": "3a4f4380061044797d394031f782cb05b8b7ef3fa88c31449cef28e5bbc08539",
  "components/nav-links.tsx": "46d599cfbac150452c764b9c4bbc073dbce6fa2d5ba52dc544f3c854b700d620",
  "components/kai-standard-state.tsx": "9bdca04d4da3c14e68ced4915c0bc7af44cc8abf4c4a95c02eb2d4ed57bcabef",
  "components/personal-center-overview.tsx": "89f031d46092ad91738b88b32cb4fafb40792ef74c453b8e1caa0824357025e2",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "31a492a0fdfa2e9f972f4ca5fd9d52ea094d96fdb5c8b7e1b53f29352b128fbe",
  "components/resource-explorer.tsx": "8b03f75f7b66f631990ee1910767a826d62e0027033a5c551920e3700fe29fd1",
  "components/resource-detail-actions.tsx": "e0b85851d955b1eed95756e520274f7462a29a5b4e4e46ab01d1d1204f50de53",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/site-footer.tsx": "323a6233a7e26f38935f2f854f5d3fa2b3b086512d07bccd87205bbd0bf178d5",
  "components/site-header.tsx": "0d91f9aa0a9ed18877aaa7483c0c51142e058a19a17edc36aff7f452fd192354",
  "components/supply-api-client.tsx": "60292f9e3e4a141f3a69be788b3d627f3969f67aeecb6153dc5fbc1f02a97825",
  "components/supply-listings-dashboard.tsx": "e5a24ab251eed94562f51f523590bba70a041b1551c11bdaa5234ae300a6f0d4",
  "components/supply-order-workspace.tsx": "771eca38029a65863d3012b5bc21babd084339307a9fad1c9a53e74c6b005375",
  "lib/catalog.mjs": "814608044dda4a2b9e25902b1c07963d43a675ab8d3d42ab8f8aff89db0ca568",
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
  assert.equal((explorer.match(/className=\{purchaseStyles\.purchaseLink\}/gu) ?? []).length, 2);
  assert.match(explorer, /加入对比[\s\S]{0,700}className=\{purchaseStyles\.purchaseLink\}[\s\S]{0,400}<span>提交询价<\/span>/u);
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
  assert.match(supplyLayout, /if \(!isHostingV2SetupEnabled\(\)\) redirect\(hostingLandingUrl\(\)\)/u);
  assert.match(supplyLayout, /configurationMode=\{!isHostingV2Enabled\(\)\}/u);
  assert.match(supplyLayout, /<AccountRequired purpose="管理供应资源">/u);

  for (const path of [
    "app/checkout/[resourceId]/page.tsx",
    "components/catalog-purchase.tsx",
    "components/catalog-purchase.module.css",
    "components/resource-purchase.module.css",
  ]) assert.ok(existsSync(join(ROOT, path)), `${path} is missing`);

  const purchase = readFileSync(join(ROOT, "components/catalog-purchase.tsx"), "utf8");
  assert.match(purchase, /确认目录资源与询价范围/u);
  assert.doesNotMatch(purchase, /人民币参考价|¥/u);
  assert.match(purchase, /卡时参考范围/u);
  assert.match(purchase, /预计支付卡时/u);
  assert.match(purchase, /平台确认库存与正式价格/u);
  assert.match(purchase, /登录后提交询价/u);
  assert.match(purchase, /完善交易主体后提交/u);
  assert.match(purchase, /accountState === "loading" \? "正在核对账户…" : busy \? "正在提交…" : "提交询价"/u);
});
