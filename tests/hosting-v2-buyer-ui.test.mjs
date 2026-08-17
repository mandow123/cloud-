import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");

test("GPU public routes use the real Hosting V2 buyer flow on separate pages", () => {
  const marketPage = read("app/gpu/page.tsx");
  assert.match(marketPage, /HostingGpuMarketplace/u);
  assert.doesNotMatch(marketPage, /GpuMarketplaceLab|gpu-cloud-lab|LOCAL_TEST/u);

  for (const path of [
    "app/gpu/offers/[offerId]/page.tsx",
    "app/gpu/contracts/page.tsx",
    "app/gpu/contracts/[contractId]/page.tsx",
  ]) assert.equal(existsSync(join(ROOT, path)), true, `${path} is missing`);

  const market = read("components/hosting-gpu-marketplace.tsx");
  assert.match(market, /marketplaceGet<\{ records: PublicHostingOffer\[\] \}>\("\/api\/v2\/offers"\)/u);
  assert.match(market, /parseHostingTransactionAvailability/u);
  assert.match(market, /仅浏览 · 交易关闭/u);
  assert.match(market, /transaction\?\.ready \? "查看并租用" : "查看报价"/u);
  assert.match(market, /cause instanceof MarketplaceApiError && cause\.code === "HOSTING_V2_DISABLED"/u);
  assert.doesNotMatch(market, /marketplaceGet<HostingReadinessEnvelope>\("\/api\/ready"\)/u);
  assert.match(market, /GPU 市场尚未开放/u);
  assert.match(market, /href=\{`\/gpu\/offers\/\$\{encodeURIComponent\(offer\.id\)\}`\}/u);
  assert.match(market, /href="\/gpu\/contracts"/u);
  assert.doesNotMatch(market, /\/api\/v1\/lab|#personal-gpu/u);
  assert.doesNotMatch(market, /<main/u);
});

test("checkout locks the selected public offer version and requested duration", () => {
  const checkout = read("components/hosting-offer-checkout.tsx");
  assert.match(checkout, /marketplaceGet<\{ record: PublicHostingOffer \}>\(`\/api\/v2\/offers\/\$\{encodeURIComponent\(offerId\)\}`\)/u);
  assert.match(checkout, /marketplacePost<BuyerHostingContract>\("\/api\/v2\/contracts", \{ offerId: offer\.id, offerVersion: offer\.version, reservedSeconds \}/u);
  assert.match(checkout, /if \(!offer \|\| !transaction\?\.ready/u, "closed market must not invoke the contract writer");
  assert.match(checkout, /disabled=\{!transaction\?\.ready \|\| busy/u);
  assert.match(checkout, /交易关闭 · 仅浏览/u);
  assert.doesNotMatch(checkout, /\{ offerId: offer\.id, reservedSeconds, (?:heldMicros|price|supplierOrganizationId|deviceId)/u);
  assert.match(checkout, /router\.push\(`\/gpu\/contracts\/\$\{encodeURIComponent\(result\.record\.id\)\}`\)/u);
  assert.doesNotMatch(checkout, /<main/u);
});

test("offer APIs project the exact transaction gate used by contract writes", () => {
  const collection = read("app/api/v2/offers/route.ts");
  const detail = read("app/api/v2/offers/[offerId]/route.ts");
  const gate = read("lib/server/hosting-v2-transaction-gate.ts");
  const contractWriter = read("app/api/v2/contracts/route.ts");
  for (const route of [collection, detail]) {
    assert.match(route, /readHostingV2TransactionAvailability\(\)/u);
    assert.match(route, /transaction/u);
  }
  assert.match(gate, /const availability = await readHostingV2TransactionAvailability\(\)/u);
  assert.match(contractWriter, /await requireHostingV2TransactionCapability\(\)/u);
});

test("buyer workspace drives every lifecycle action through its server endpoint", () => {
  const workspace = read("components/hosting-contract-workspace.tsx");
  for (const action of ["ssh-key", "start", "stop", "accept", "dispute", "cancel"]) {
    assert.match(workspace, new RegExp(`/api/v2/contracts/\\$\\{encodeURIComponent\\(contract\\.id\\)\\}/${action}`, "u"));
  }
  assert.match(workspace, /争议处理中，卡时继续冻结/u);
  assert.match(workspace, /争议已裁决并全额退回/u);
  assert.match(workspace, /POLLED_STATUSES[^;]+DISPUTED/u);
  assert.match(workspace, /marketplaceGet<\{ record: BuyerHostingContract \}>\(`\/api\/v2\/contracts\/\$\{encodeURIComponent\(contractId\)\}`\)/u);
  assert.match(workspace, /浏览器不能提交运行时长或金额/u);
  assert.match(workspace, /DELIVERY EVIDENCE/u);
  assert.match(workspace, /逾期且未发起争议/u);
  assert.match(workspace, /containerRemoved/u);
  assert.doesNotMatch(workspace, /marketplacePost[^\n]+(?:measuredSeconds|settledMicros|heldMicros|supplierIncomeMicros)/u);
  assert.match(workspace, /window\.setInterval\(\(\) => \{ void load\(true\); \}, 5_000\)/u);
  assert.doesNotMatch(workspace, /<main/u);
});

test("buyer contract collection is scoped to the signed-in buyer organization", () => {
  const route = read("app/api/v2/contracts/route.ts");
  assert.match(route, /requireTradingAccountSession\(request\)/u);
  assert.match(route, /contract\.buyerOrganizationId === account\.activeOrganization\.id/u);
  assert.match(route, /\.map\(\(contract\) => hostingContractClientView\(contract\)\)/u);
});
