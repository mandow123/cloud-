import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("supplier console exposes the implemented resource, listing, order and earnings routes", () => {
  for (const path of [
    "app/supply/layout.tsx",
    "app/supply/page.tsx",
    "app/supply/onboarding/page.tsx",
    "app/supply/resources/page.tsx",
    "app/supply/resources/new/page.tsx",
    "app/supply/resources/[deviceId]/page.tsx",
    "app/supply/listings/page.tsx",
    "app/supply/listings/new/page.tsx",
    "app/supply/orders/page.tsx",
    "app/supply/orders/[contractId]/page.tsx",
    "app/supply/earnings/page.tsx",
    "app/supply/devices/page.tsx",
    "app/supply/devices/new/page.tsx",
    "app/supply/devices/[deviceId]/page.tsx",
    "app/supply/tasks/page.tsx",
  ]) {
    assert.equal(existsSync(path), true, `${path} must exist`);
  }

  const layout = readFileSync("app/supply/layout.tsx", "utf8");
  assert.match(layout, /isHostingV2SetupEnabled\(\)/u);
  assert.match(layout, /process\.env\.KAI_PUBLIC_ORIGIN/u);
  assert.match(layout, /new URL\("\/hosting", origin\)\.toString\(\)/u);
  assert.match(layout, /redirect\(hostingLandingUrl\(\)\)/u);
  assert.match(layout, /<AccountRequired purpose="管理供应资源">/u);

  const shell = readFileSync("components/supply-console-shell.tsx", "utf8");
  assert.match(shell, /href: "\/supply"/u);
  assert.doesNotMatch(shell, /href: "\/supply\/onboarding"/u);
  assert.match(shell, /href: "\/supply\/applications"/u);
  assert.match(shell, /href: "\/supply\/devices"/u);
  assert.match(shell, /href: "\/supply\/listings"/u);
  assert.match(shell, /href: "\/supply\/orders"/u);
  assert.match(shell, /href: "\/supply\/earnings"/u);
  assert.match(shell, /href: "\/supply\/tasks"/u);
  assert.match(shell, /taskCount/u);
  assert.match(shell, /configurationMode/u);
  assert.match(shell, /预上线配置模式/u);
  assert.match(shell, /aria-disabled="true"/u);
  const routes = shell.slice(shell.indexOf("const availableRoutes"), shell.indexOf("] as const"));
  assert.equal((routes.match(/href:/gu) ?? []).length, 7);
});

test("manual supply applications persist through the authenticated API and remain separate from Agent delivery", () => {
  const createPage = readFileSync("app/supply/resources/new/page.tsx", "utf8");
  const listPage = readFileSync("app/supply/resources/page.tsx", "utf8");
  const uncachedCreatePage = readFileSync("app/supply/apply/page.tsx", "utf8");
  const uncachedListPage = readFileSync("app/supply/applications/page.tsx", "utf8");
  const form = readFileSync("components/supply-offer-form.tsx", "utf8");
  const records = readFileSync("components/supply-offer-records.tsx", "utf8");
  const admin = readFileSync("lib/admin-view-models.ts", "utf8");

  assert.match(createPage, /<SupplyOfferForm \/>/u);
  assert.match(listPage, /<SupplyOfferRecords \/>/u);
  assert.match(uncachedCreatePage, /<SupplyOfferForm \/>/u);
  assert.match(uncachedListPage, /<SupplyOfferRecords \/>/u);
  assert.match(form, /createSupplyOffer/u);
  assert.match(form, /提交上架申请/u);
  assert.match(form, /不要求安装 Agent/u);
  assert.match(records, /getSupplyOffers\(\)/u);
  assert.match(records, /不会自动验真、公开发布、成交或交付/u);
  assert.match(admin, /"ownership\.organizationId"/u);
  assert.match(admin, /"ownership\.accountId"/u);
});

test("resource registration issues a short-lived server challenge without client identity fields", () => {
  const source = readFileSync("components/supply-resource-registration.tsx", "utf8");
  const agentPackage = JSON.parse(readFileSync("host-agent/package.json", "utf8"));
  assert.match(source, /marketplacePost<HostingAgentChallenge>\("\/api\/v2\/supply\/agent-challenges", \{\}/u);
  assert.match(source, /marketplaceGet<\{ policy: SupplierHostingPolicy \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(source, /policy\?\.approvedImages\.length/u);
  assert.match(source, /\/etc\/kai-host-actuator\.env/u);
  assert.match(source, /challengeId: challenge\.id/u);
  assert.match(source, /registerEndpoint: agentRegistrationEndpoint\(\)/u);
  assert.match(source, /origin\.hostname = "supplier\.localhost"/u);
  assert.match(source, /nonce: challenge\.nonce/u);
  assert.match(source, /minimumAgentVersion: challenge\.minimumAgentVersion/u);
  assert.match(source, /expiresAt: challenge\.expiresAt/u);
  assert.match(source, /navigator\.clipboard\.writeText\(pairingBundle\)/u);
  assert.match(source, /new Blob/u);
  assert.match(source, /type: "application\/json"/u);
  assert.match(source, /anchor\.download = `kai-host-pairing-\$\{challenge\.id\}\.json`/u);
  assert.match(source, /URL\.revokeObjectURL\(url\)/u);
  assert.match(source, /下载私有配对文件/u);
  assert.match(source, /废弃这份凭证/u);
  assert.doesNotMatch(source, /废弃页面中的凭证/u);
  assert.match(source, /`\/api\/v2\/supply\/agent-challenges\/\$\{encodeURIComponent\(challenge\.id\)\}\/revoke`/u);
  assert.match(source, /await marketplacePost<HostingAgentChallenge>/u);
  assert.match(source, /旧文件不能再登记设备/u);
  assert.match(source, /`\/api\/v2\/supply\/agent-challenges\/\$\{encodeURIComponent\(challenge\.id\)\}`/u);
  assert.match(source, /window\.setInterval\(\(\) => \{ void check\(\); \}, 3_000\)/u);
  assert.match(source, /进入设备验真/u);
  assert.match(source, /const connectionVerified = Boolean\(pairedDevice && pairedDevice\.lastSequence > 0\)/u);
  assert.match(source, /签名连接已验证/u);
  assert.match(source, new RegExp(`const HOST_AGENT_VERSION = "${agentPackage.version.replaceAll(".", "\\.")}"`, "u"));
  assert.match(source, /const HOST_AGENT_ARCHIVE = `kai-host-agent-\$\{HOST_AGENT_VERSION\}\.tgz`/u);
  assert.match(source, /href=\{`\/downloads\/\$\{HOST_AGENT_ARCHIVE\}`\}/u);
  assert.match(source, /href="\/guides\/host-agent"/u);
  assert.doesNotMatch(source, /actorId|x-kai-workspace-role|localStorage|sessionStorage/u);
});

test("resource details are selected from the current organization dashboard and verification uses the constrained API", () => {
  const list = readFileSync("components/supply-resources.tsx", "utf8");
  const detail = readFileSync("components/supply-resource-detail.tsx", "utf8");
  assert.match(list, /marketplaceGet<\{ dashboard: SupplierHostingDashboard \}>\("\/api\/v2\/supply\/dashboard"\)/u);
  assert.match(detail, /result\.dashboard\.devices\.find\(\(item\) => item\.id === deviceId\)/u);
  assert.match(detail, /`\/api\/v2\/supply\/devices\/\$\{encodeURIComponent\(device\.id\)\}\/verify`/u);
  assert.match(detail, /marketplacePost<HostingAgentCommand>/u);
  assert.match(detail, /const verificationPending = device\?\.status === "VERIFYING" \|\| device\?\.verificationStatus === "PENDING"/u);
  assert.match(detail, /window\.setInterval\(\(\) => \{ void load\(\); \}, 2_000\)/u);
  assert.doesNotMatch(`${list}\n${detail}`, /x-kai-workspace-role|localStorage|sessionStorage|\/bin\/sh|sudo/u);
});

test("managed-device console uses the server projection, compact filters and truthful folded history", () => {
  const list = readFileSync("components/supply-resources.tsx", "utf8");
  const fee = readFileSync("components/supply-fee-preview.tsx", "utf8");
  const route = readFileSync("app/api/v2/supply/dashboard/route.ts", "utf8");
  const projection = readFileSync("lib/server/hosting-v2-api.ts", "utf8");
  assert.match(route, /hostingSupplierDeviceWorkspaceView/u);
  assert.match(list, /const workspace = dashboard\.deviceWorkspace/u);
  for (const label of ["托管设备", "待租", "运营中", "部署中", "待处理", "离线", "已停用", "待办队列", "资产生命周期能力", "已恢复运营"]) assert.match(list, new RegExp(label, "u"));
  assert.match(list, /<details className=\{styles\.taskFold\}/u);
  assert.match(list, /<details className=\{styles\.historyFold\}/u);
  assert.match(list, /device\.primaryAction\.href/u);
  assert.match(list, /device\.primaryAction\.label/u);
  assert.match(list, /marketplaceGet<\{ policy: SupplierHostingPolicy \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(list, /<SupplyFeeTierFold preview=\{policy\.feePreview\} \/>/u);
  assert.match(list, /<SupplyFeeUnavailableFold message=\{feeError/u);
  assert.match(list, /Promise\.allSettled/u);
  assert.match(fee, /<details className=\{styles\.feeFold\}>/u);
  assert.doesNotMatch(fee, /<details className=\{styles\.feeFold\} open/u);
  assert.match(fee, /preview\.tiers\.map/u);
  assert.match(fee, /preview\.remainingToNextTierMicros/u);
  assert.match(fee, /preview\.asOf/u);
  assert.match(fee, /累计有效成交口径/u);
  assert.match(fee, /href="\/supply\/earnings"/u);
  assert.match(fee, /页面不会推算或缓存费率/u);
  const filters = list.slice(list.indexOf("const filters = ["), list.indexOf("] as const;", list.indexOf("const filters = [")));
  for (const state of ["ALL", "AVAILABLE", "OPERATING", "DEPLOYING", "TASKS", "OFFLINE", "DISABLED"]) assert.match(filters, new RegExp(`"${state}"`, "u"));
  assert.equal((filters.match(/^\s+\[/gmu) ?? []).length, 7);
  assert.doesNotMatch(filters, /FEE|费率|成交量/u);
  assert.match(projection, /renewal: \{ enabled: false/u);
  assert.match(projection, /buyback: \{ enabled: false/u);
  assert.match(projection, /decommission: \{ enabled: false/u);
  assert.doesNotMatch(list, /device\.status\}|device\.verificationStatus\}/u);
  const lifecycle = list.slice(list.indexOf('<details className={styles.historyFold}'), list.indexOf("</details>", list.indexOf('<details className={styles.historyFold}')));
  assert.doesNotMatch(lifecycle, /<button|<Link|数量|\bcount\b/u);
});

test("supplier fee UI reads lifetime cumulative fields and preserves legacy contract wording", () => {
  const fee = readFileSync("components/supply-fee-preview.tsx", "utf8");
  const create = readFileSync("components/supply-offer-create.tsx", "utf8");
  const detail = readFileSync("components/supply-contract-detail.tsx", "utf8");
  const earnings = readFileSync("components/supply-earnings.tsx", "utf8");
  const combined = `${fee}\n${create}\n${detail}\n${earnings}`;

  for (const field of ["qualifyingVolumeMicros", "platformFeeBps", "tierCode", "tiers", "nextTierCode", "remainingToNextTierMicros", "asOf"]) {
    assert.match(fee, new RegExp(`preview\\.${field}`, "u"));
  }
  for (const tier of ["STARTER", "GROWTH", "SCALE", "VOLUME", "STRATEGIC"]) assert.match(fee, new RegExp(tier, "u"));
  assert.match(fee, /LIFETIME_SUPPLIER_SETTLED_GROSS_V1/u);
  assert.match(fee, /旧版月度档位/u);
  assert.match(create, /<SupplyFeePreviewStrip preview=\{policy\.feePreview\} \/>/u);
  assert.match(earnings, /<SupplyFeePreviewStrip preview=\{earnings\.feePreview\} \/>/u);
  assert.match(detail, /feeQualificationDescription\(contract\.snapshot\.feeQualification\)/u);
  assert.doesNotMatch(combined, /上月合格成交|本月服务费|nextRecalculationAt|feePreview\.period/u);
});

test("supplier pages read and mutate through the authenticated hosting v2 APIs", () => {
  const dashboard = readFileSync("components/supply-dashboard.tsx", "utf8");
  assert.match(dashboard, /marketplaceGet<\{ dashboard: SupplierHostingDashboard \}>\("\/api\/v2\/supply\/dashboard"\)/u);
  assert.match(dashboard, /dashboard\.readiness\.supplierApproved && isHostingSupplierProfileReady\(profile\)/u);
  assert.match(dashboard, /审核记录不完整/u);

  const onboarding = readFileSync("components/supplier-onboarding-form.tsx", "utf8");
  assert.match(onboarding, /marketplaceGet<\{ record: HostingSupplierProfile \| null \}>\("\/api\/v2\/supply\/profile"\)/u);
  assert.match(onboarding, /marketplacePut<HostingSupplierProfile>\("\/api\/v2\/supply\/profile"/u);
  assert.match(onboarding, /marketplacePost<HostingSupplierProfile>\("\/api\/v2\/supply\/profile\/submit"/u);
  assert.match(onboarding, /marketplaceGet<\{ policy: \{ termsVersion: string \} \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(onboarding, /agreementVersion \|\| "读取中"/u);
  assert.match(onboarding, /agreementAccepted: true/u);
  assert.match(onboarding, /expectedVersion: profile\.version/u);
  assert.match(onboarding, /!isHostingSupplierProfileReady\(profile\)/u);
  assert.match(onboarding, /后端不会签发 Agent 凭证或允许挂牌/u);
  assert.doesNotMatch(`${dashboard}\n${onboarding}`, /x-kai-workspace-role|localStorage|sessionStorage/u);
});

test("listing UI uses only authenticated Hosting V2 offer APIs and server-owned terms", () => {
  const list = readFileSync("components/supply-listings-v2.tsx", "utf8");
  const create = readFileSync("components/supply-offer-create.tsx", "utf8");
  assert.match(list, /marketplaceGet<\{ records: SupplierHostingOffer\[\] \}>\("\/api\/v2\/supply\/offers"\)/u);
  assert.match(list, /Date\.parse\(offer\.availableFrom\) > now[^\n]+已发布 · 等待开售/u);
  assert.match(list, /HOSTING_V2_AGENT_STALE_SECONDS/u);
  assert.match(list, /已发布 · Agent 离线/u);
  assert.match(list, /window\.setInterval\(\(\) => \{ void load\(\); \}, 30_000\)/u);
  assert.match(list, /`\/api\/v2\/supply\/offers\/\$\{encodeURIComponent\(offer\.id\)\}\/status`/u);
  assert.match(list, /\{ status, expectedVersion: offer\.version \}/u);
  assert.match(create, /marketplaceGet<\{ policy: SupplierHostingPolicy \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(create, /marketplacePost<SupplierHostingOffer>\("\/api\/v2\/supply\/offers", payload/u);
  assert.match(create, /dashboard\?\.readiness\.supplierApproved/u);
  assert.match(create, /HOSTING_V2_AGENT_STALE_SECONDS/u);
  assert.match(create, /Date\.parse\(device\.verifiedUntil\) > now/u);
  assert.match(create, /Date\.parse\(device\.lastSeenAt\) >= now - HOSTING_V2_AGENT_STALE_SECONDS \* 1_000/u);
  assert.match(create, /window\.setInterval\(\(\) => setEligibilityNow\(Date\.now\(\)\), 30_000\)/u);
  assert.match(create, /policy\.feePreview\.activeFeeScheduleId/u);
  assert.match(create, /policy\.feePreview\.tierCode/u);
  assert.match(create, /policy\.feePreview\.platformFeeBps !== null/u);
  const payload = create.slice(create.indexOf("const payload = {"), create.indexOf("const serialized"));
  assert.doesNotMatch(payload, /gpuModel|termsVersion|organizationId|accountId|feeScheduleId/u);
  assert.match(create, /approvedImage/u);
  assert.doesNotMatch(`${list}\n${create}`, /x-kai-workspace-role|localStorage|sessionStorage|\/api\/v1\/supply/u);
});

test("supplier order and earnings pages read scoped V2 projections without buyer identities", () => {
  const contracts = readFileSync("components/supply-contracts.tsx", "utf8");
  const detail = readFileSync("components/supply-contract-detail.tsx", "utf8");
  const earnings = readFileSync("components/supply-earnings.tsx", "utf8");
  assert.match(contracts, /marketplaceGet<\{ records: SupplierHostingContract\[\] \}>\("\/api\/v2\/supply\/contracts"\)/u);
  assert.match(detail, /marketplaceGet<\{ record: SupplierHostingContract \}>\(`\/api\/v2\/supply\/contracts\/\$\{encodeURIComponent\(contractId\)\}`\)/u);
  assert.match(detail, /window\.setInterval\(\(\) => \{ void load\(true\); \}, 5_000\)/u);
  assert.match(earnings, /marketplaceGet<\{ earnings: SupplierEarningsDashboard \}>\("\/api\/v2\/supply\/earnings"\)/u);
  assert.match(earnings, /变现申请暂未开放/u);
  assert.doesNotMatch(`${contracts}\n${detail}\n${earnings}`, /buyerOrganizationId|buyerAccountId|marketplacePost|x-kai-workspace-role/u);
});

test("supplier APIs scope contracts, sanitize projections and expose immutable ledger facts", () => {
  const collection = readFileSync("app/api/v2/supply/contracts/route.ts", "utf8");
  const detail = readFileSync("app/api/v2/supply/contracts/[contractId]/route.ts", "utf8");
  const helper = readFileSync("lib/server/hosting-v2-api.ts", "utf8");
  const view = helper.slice(helper.indexOf("export function hostingSupplierContractClientView"), helper.indexOf("export function hostingSupplierOfferClientView"));
  assert.match(collection, /contract\.supplierOrganizationId === account\.activeOrganization\.id/u);
  assert.match(detail, /contract\.supplierOrganizationId !== account\.activeOrganization\.id/u);
  assert.doesNotMatch(view, /buyerOrganizationId|buyerAccountId|feeScheduleId/u);
  assert.match(view, /supplierIncomeMicros/u);

  const earnings = readFileSync("app/api/v2/supply/earnings/route.ts", "utf8");
  assert.match(earnings, /getCardHourStore\(\)/u);
  assert.match(earnings, /dashboard\.ledger\.map\(safeLedgerEntry\)/u);
  assert.match(earnings, /requireTradingAccountSession\(request\)/u);
});

test("authenticated PUT helper sends CSRF and idempotency protection", () => {
  const client = readFileSync("lib/client/marketplace-client.ts", "utf8");
  const start = client.indexOf("export async function marketplacePut");
  const end = client.indexOf("export async function exchangePost");
  const put = client.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(put, /method: "PUT"/u);
  assert.match(put, /"x-kai-csrf": session\.csrfToken/u);
  assert.match(put, /"Idempotency-Key": idempotencyKey/u);
  assert.match(put, /getMarketplaceSession\(true\)/u);
  assert.doesNotMatch(put, /x-kai-workspace-role/u);
});

test("supplier console uses the shared light and dark tokens", () => {
  const css = readFileSync("components/supply-console.module.css", "utf8");
  for (const token of ["canvas", "surface", "ink", "text", "muted", "border", "accent", "error", "warning"]) {
    assert.match(css, new RegExp(`var\\(--${token}`, "u"));
  }
  for (const selector of ["feeFold", "feeFoldBody", "feeTierTable", "feeTierCurrent", "feeFoldMeta"]) assert.match(css, new RegExp(`\\.${selector}`, "u"));
  assert.match(css, /@media \(max-width: 640px\)[\s\S]+\.feeFold > summary/u);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);
});
