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
  "app/gpu/page.tsx": "c24f5e788d1680e67c91a05ff50d017b871365871948385015ffeb02d16dbf9f",
  "app/guides/guides.module.css": "5e12ca1ab83f648e5ea59508f851f739f6a16bc1734bdc23bf60d83cf8cca88b",
  "app/guides/page.tsx": "777cd2f199fd91e0b722377a782e3a05b4b4141e855951a6373472d3e7cd2c4b",
  "app/hosting/page.tsx": "44102018b40ec1de2c2a983c76c53e80c31d8eac78c5835bf4a72b2ae62e4596",
  "app/hosting/partners/terms/KAI_HOSTING_TERMS_2026_08/page.tsx": "61414d5988494518b096ec8d8e07095851481bc42fad6f62e63a401634ab3b6a",
  "app/kai-cloud.css": "0b3252e02a8ab8050cb8da87ac0ec407e0fcd51285c7d856f4c3fdc28b63eac8",
  "app/layout.tsx": "a91926edead71be3ae680ee4070e0e096aebeadc746482f7666b1c4b7a6e3cee",
  "app/page.tsx": "20f8ad3d1743cadcc163d50982439dbd65d5f6e96c79c87c32307266bbaddb24",
  "app/methodology/page.tsx": "1e941fd3ce4769b65ad208f8e8b6191927cde72fd505c002e6d49b2b50e2af4b",
  "app/request/page.tsx": "d75d4f13bdbf2f2fb5d11cb01e39d1b961e5eed8244236c35da2bb57c739496e",
  "app/resources/page.tsx": "172b120f772981346b5d59dea2f530c130f053feb8adbbdbc52f79a2371d848f",
  "app/resources/[id]/page.tsx": "65d8aa387712f77025fc4429d787b72105caf88588b612da433a9652ee06ac9c",
  "app/checkout/[resourceId]/page.tsx": "318b7b7d4d90b33e32e83a524fc698f6a79ca2fa13da5cf69d82c6717bf60353",
  "app/login/page.tsx": "34ad84461470ef60c3acaea63de73bf4ab360feee1797b2be6833b18915d276c",
  "app/member/page.tsx": "8238fb8e999e57c67f590c21d1c50121713487b3ff5bd56d01820f2f368096d1",
  "app/market/page.tsx": "b6d6e24eb585660d5ea3b2b48dd871898507734b1b676c01c2d4e54385718e0f",
  "app/not-found.tsx": "b75a5fe7c8a2477c21ed2f74198fe91e19cf4dd60c3b654f7e812e142d56a7d9",
  "app/partners/page.tsx": "93cd20f90ebf8f6271b1b69fd79521b00497b02975beab97019b7bce121f2b52",
  "components/account-login.tsx": "652f8efed773bb8d01d867a5054618e771b63be5e6e5d8f920c881588502fd45",
  "components/account-required.tsx": "8412ccfc996d22995642fd4510e6c702a40e75e5efeb700addbf8ba08968953a",
  "components/buyer-order-list.tsx": "a1d71716bc7e8def3c13be2b70abdef2aa807e6d8d4720bf7d67860d1e6ea3a7",
  "components/catalog-purchase.module.css": "d9e451203cbbfcb4b13a1c8f91267309cfe4be895e7ee225afb52cdfbc99d0a7",
  "components/catalog-purchase.tsx": "8ba38b6dc0e2a6b0065b8a9e79834a4292d8fcf99afb59a9d3495544dc31a43f",
  "components/admin-login.tsx": "0ad6638587a4a975ec118dbe6174d20cfa8b51b183a9a50261014060f52ad86e",
  "components/admin-resource-page.tsx": "b11613794dbb9c8bafff882a9686bbe70b030b07b87d17011d40fd8ec719809a",
  "components/card-hour-account-panel.tsx": "0551952b5a3aa803ed0b8735145bdba66955365b4ba2c5e53a5e0774cdc14ed5",
  "components/email-login.tsx": "43f6a8f1edc18b23ec099ba476c51d45b79e165bcd0f4a7778b5b78151874cb6",
  "components/gpu-cloud-lab.module.css": "379628eb1340717c0cefcc515cc281f7564b37870c5e8c89776fe9e3df9013c9",
  "components/gpu-cloud-lab.tsx": "64f60d95f596b7f0aa076575c2fed87ac19985aaaf021e21e0acaf0fe2334725",
  "components/live-home-market-hero.tsx": "25b32e4d682fdc715e44ff0f72d51123186f8f88d5ec1205c16fcdfd79990945",
  "components/live-model-price-board.tsx": "687d017a332597ac67fe1b28fcd621e469f588a4f4c9f9fcaab757340289dc8e",
  "components/market-dashboard.tsx": "c55e7b4d981d581195288561399af2243af88bd250a7c694439300aec79b8aca",
  "components/member-workspace.tsx": "8996b8ad40627bcdb97ac956db5ef2b2fd8bba18edb7f37b540ba7b04af551c7",
  "components/model-price-board.tsx": "dfbe3fdfc3e1865704a9c1dae2d67f14aa0a32762b83da6623f0f3a3067298f5",
  "components/mobile-demand-cta.tsx": "0fddd0e6043db5cfc7bb926c88a74481c18d3e9588a6c20b457c1ab5cca78ba3",
  "components/nav-links.tsx": "daca87be4b1269ffc15585c52d8ba98760c66f8e5d5424261f4bb5c7c40d5b21",
  "components/kai-standard-state.tsx": "9bdca04d4da3c14e68ced4915c0bc7af44cc8abf4c4a95c02eb2d4ed57bcabef",
  "components/personal-center-overview.tsx": "16f9ab0f99c141c0f4b43ddc5e18b928d973050ae8f0726d3020f12d0cb5ca8e",
  "components/personal-menu.module.css": "0813b8a2fa3d164922add93de17daf66adc0dd9c1859427097c36975708f90f2",
  "components/personal-menu.tsx": "d9cb93b164779cdaa5c300b8a3a0c1df500933ae22e46e8b68770cf266d375d2",
  "components/request-workbench.tsx": "ebcf76e8a9403dfa83b457e8b9eee2ad10fb0c3e31c6dcc6ffd3ae13ebcfc66a",
  "components/resource-explorer.tsx": "fcb894bafb20363694d8ad5dbcd3aeef98d428f5d5e789a63989595f9725eb1e",
  "components/resource-detail-actions.tsx": "1f7898b9a00ed5d09dc44030d69dc325665ea1503406d1f6241ee960be643364",
  "components/resource-purchase.module.css": "6569ca7f4f35c5cd6f731ee97dba34567d002d5bb370aa9b3058c33628bc6669",
  "components/language-control.tsx": "60ef4529327c666522617a5c61ab1b910b8acb343ee64aeb90261a9680179b18",
  "components/locale-provider.tsx": "93a5f7ac21cbac8bae2ac9e04a4f9e49124fafe967d4ceed5f3aa171678891a1",
  "components/site-footer-view.tsx": "ead5d5d36fea877831e0d1df33f8f38bc121ffee96d83f61e81f7b9075273a87",
  "components/site-footer.tsx": "48314604150577a62fa8a334c0690be47ff72a48615f9d0ad393c441a44f5e9a",
  "components/site-header.tsx": "142cf6419ff57eecb45077d1d17d1ef43f06349a0d84cde37fb89fd45c97fe89",
  "components/theme-control.tsx": "cd99267af248143ef8a6e3a488b53878de2e3d144e49ca3bd0deb263ab9d9c59",
  "components/supply-api-client.tsx": "60292f9e3e4a141f3a69be788b3d627f3969f67aeecb6153dc5fbc1f02a97825",
  "components/supply-listings-dashboard.tsx": "e5a24ab251eed94562f51f523590bba70a041b1551c11bdaa5234ae300a6f0d4",
  "components/supply-order-workspace.tsx": "771eca38029a65863d3012b5bc21babd084339307a9fad1c9a53e74c6b005375",
  "lib/catalog.mjs": "814608044dda4a2b9e25902b1c07963d43a675ab8d3d42ab8f8aff89db0ca568",
  "lib/i18n.ts": "545ac2ad237da6939625a4c78510c063d0c52a25b0bd225b341639b44304a76a",
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
  "app/managed-gpu/configure/page.tsx",
  "app/managed-gpu/page.tsx",
  "app/member/gpu-assets/page.tsx",
  "app/member/gpu-assets/[assetId]/page.tsx",
  "app/member/gpu-hosting/earnings/page.tsx",
  "app/member/gpu-hosting/orders/page.tsx",
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
  assert.match(explorer, /classification === "PRIMARY_INQUIRY"[\s\S]*!inquiryEnabled[\s\S]*copy\.maintenance/u);
  assert.match(explorer, /classification === "REFERENCE_LEAD" \? copy\.submitRelated : copy\.submitDemand/u);
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
  assert.match(purchase, /title: "确认算力套餐与询价信息"/u);
  assert.doesNotMatch(purchase, /人民币参考价|¥/u);
  assert.match(purchase, /referenceRange: "卡时参考范围"/u);
  assert.match(purchase, /estimatedTotal: "询价参考总计"/u);
  assert.match(purchase, /"平台人工确认库存与正式卡时报价"/u);
  assert.match(purchase, /loginSubmit: "登录后提交询价"/u);
  assert.match(purchase, /inactiveSubmit: "完善交易主体后提交"/u);
  assert.match(purchase, /accountState === "loading" \? copy\.checking : busy \? copy\.submitting : copy\.submit/u);
});
