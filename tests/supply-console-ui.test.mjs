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
  assert.match(shell, /href: "\/supply\/onboarding"/u);
  assert.match(shell, /href: "\/supply\/resources"/u);
  assert.match(shell, /href: "\/supply\/listings"/u);
  assert.match(shell, /href: "\/supply\/orders"/u);
  assert.match(shell, /href: "\/supply\/earnings"/u);
  assert.match(shell, /configurationMode/u);
  assert.match(shell, /预上线配置模式/u);
  assert.match(shell, /aria-disabled="true"/u);
});

test("resource registration issues a short-lived server challenge without client identity fields", () => {
  const source = readFileSync("components/supply-resource-registration.tsx", "utf8");
  const agentPackage = JSON.parse(readFileSync("host-agent/package.json", "utf8"));
  assert.match(source, /marketplacePost<HostingAgentChallenge>\("\/api\/v2\/supply\/agent-challenges", \{\}/u);
  assert.match(source, /marketplaceGet<\{ policy: SupplierHostingPolicy \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(source, /policy\?\.approvedImages\.length/u);
  assert.match(source, /\/etc\/kai-host-actuator\.env/u);
  assert.match(source, /challengeId: challenge\.id/u);
  assert.match(source, /nonce: challenge\.nonce/u);
  assert.match(source, /minimumAgentVersion: challenge\.minimumAgentVersion/u);
  assert.match(source, /expiresAt: challenge\.expiresAt/u);
  assert.match(source, /navigator\.clipboard\.writeText\(pairingBundle\)/u);
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
  assert.doesNotMatch(`${list}\n${detail}`, /x-kai-workspace-role|localStorage|sessionStorage|\/bin\/sh|sudo/u);
});

test("supplier pages read and mutate through the authenticated hosting v2 APIs", () => {
  const dashboard = readFileSync("components/supply-dashboard.tsx", "utf8");
  assert.match(dashboard, /marketplaceGet<\{ dashboard: SupplierHostingDashboard \}>\("\/api\/v2\/supply\/dashboard"\)/u);

  const onboarding = readFileSync("components/supplier-onboarding-form.tsx", "utf8");
  assert.match(onboarding, /marketplaceGet<\{ record: HostingSupplierProfile \| null \}>\("\/api\/v2\/supply\/profile"\)/u);
  assert.match(onboarding, /marketplacePut<HostingSupplierProfile>\("\/api\/v2\/supply\/profile"/u);
  assert.match(onboarding, /marketplacePost<HostingSupplierProfile>\("\/api\/v2\/supply\/profile\/submit"/u);
  assert.match(onboarding, /marketplaceGet<\{ policy: \{ termsVersion: string \} \}>\("\/api\/v2\/supply\/policy"\)/u);
  assert.match(onboarding, /agreementVersion \|\| "读取中"/u);
  assert.match(onboarding, /agreementAccepted: true/u);
  assert.match(onboarding, /expectedVersion: profile\.version/u);
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
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}/iu);
});
