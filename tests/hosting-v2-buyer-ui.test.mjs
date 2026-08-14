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
  assert.match(market, /marketplaceGet<HostingReadinessEnvelope>\("\/api\/ready"\)/u);
  assert.match(market, /!readiness\.hostingV2\.enabled \|\| !readiness\.hostingV2\.ready/u);
  assert.match(market, /marketplaceGet<\{ records: PublicHostingOffer\[\] \}>\("\/api\/v2\/offers"\)/u);
  assert.match(market, /GPU 市场尚未开放/u);
  assert.match(market, /href=\{`\/gpu\/offers\/\$\{encodeURIComponent\(offer\.id\)\}`\}/u);
  assert.match(market, /href="\/gpu\/contracts"/u);
  assert.doesNotMatch(market, /\/api\/v1\/lab|#personal-gpu/u);
  assert.doesNotMatch(market, /<main/u);
});

test("checkout only submits the selected offer and requested duration", () => {
  const checkout = read("components/hosting-offer-checkout.tsx");
  assert.match(checkout, /marketplacePost<BuyerHostingContract>\("\/api\/v2\/contracts", \{ offerId: offer\.id, reservedSeconds \}/u);
  assert.doesNotMatch(checkout, /\{ offerId: offer\.id, reservedSeconds, (?:heldMicros|price|supplierOrganizationId|deviceId)/u);
  assert.match(checkout, /router\.push\(`\/gpu\/contracts\/\$\{encodeURIComponent\(result\.record\.id\)\}`\)/u);
  assert.doesNotMatch(checkout, /<main/u);
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
