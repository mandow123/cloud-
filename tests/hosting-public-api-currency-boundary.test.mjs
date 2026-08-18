import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { formatCardHourDisplayMicros } from "../lib/card-hours.ts";
import { createCardHourTopupOrder } from "../lib/server/card-hour-topup-service.ts";
import {
  hostingContractClientView,
  hostingPublicOfferClientView,
  hostingSettlementClientView,
  hostingSupplierContractClientView,
  hostingSupplierEarningsClientView,
} from "../lib/server/hosting-v2-api.ts";

const account = {
  account: { id: "acct-currency-boundary", displayName: "Currency Boundary", primaryEmail: null, status: "ACTIVE" },
  activeOrganization: { id: "org-currency-boundary", name: "Currency Boundary", externalKey: "CURRENCY_BOUNDARY", status: "ACTIVE" },
  membership: { id: "mbr-currency-boundary", accountId: "acct-currency-boundary", organizationId: "org-currency-boundary", status: "ACTIVE", roles: [] },
  sessionId: "session-currency-boundary",
  authMethod: "EMAIL_OTP",
};

function fiatLeaks(value, path = "response", leaks = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => fiatLeaks(item, `${path}[${index}]`, leaks));
    return leaks;
  }
  if (!value || typeof value !== "object") return leaks;
  for (const [key, child] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (/cny|amountcents/iu.test(key) || (key.toLowerCase() === "currency" && String(child).toUpperCase() === "CNY")) leaks.push(field);
    fiatLeaks(child, field, leaks);
  }
  return leaks;
}

function contractFixture() {
  return {
    id: "hctr_currency_boundary",
    offerId: "hofr_currency_boundary",
    deviceId: "had_currency_boundary",
    buyerOrganizationId: "org_buyer",
    buyerAccountId: "acct_buyer",
    supplierOrganizationId: "org_supplier",
    feeScheduleId: "hfee_currency_boundary",
    snapshot: {
      offerVersion: 2,
      title: "卡时公开合同",
      gpuModel: "RTX_4090",
      region: "中国·北京",
      cardHourMicrosPerGpuHour: 31_137_725,
      approvedImage: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`,
      termsVersion: "KAI_HOSTING_TERMS_2026_08",
      platformFeeBps: 100,
      referralRewardBps: 30,
      feeQualification: { model: "LIFETIME_SUPPLIER_SETTLED_GROSS_V1", tierCode: "STARTER", asOf: "2026-08-17T00:00:00.000Z", qualifyingVolumeMicros: 0, platformFeeBps: 100, referralRewardBps: 30 },
      acceptanceWindowSeconds: 1_800,
      cnyReferenceRate: "1.002",
      amountCents: 3_120,
      currency: "CNY",
    },
    reservedSeconds: 180,
    measuredSeconds: 180,
    heldMicros: 1_556_887,
    settledMicros: 1_556_887,
    supplierIncomeMicros: 1_541_319,
    commissionMicros: 4_670,
    status: "CLEANED",
    sshPublicKeyFingerprint: null,
    endpointDisplay: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    stoppedAt: "2026-08-17T00:03:00.000Z",
    acceptedAt: "2026-08-17T00:04:00.000Z",
    version: 8,
    createdAt: "2026-08-16T23:59:00.000Z",
    updatedAt: "2026-08-17T00:05:00.000Z",
  };
}

test("public offer, contract, settlement and supplier earnings projections contain card hours but no fiat fields", () => {
  const offer = hostingPublicOfferClientView({
    id: "hofr_currency_boundary",
    organizationId: "org_supplier",
    deviceId: "had_currency_boundary",
    feeScheduleId: "hfee_currency_boundary",
    title: "北京 RTX 4090",
    gpuModel: "RTX_4090",
    region: "中国·北京",
    cardHourMicrosPerGpuHour: 31_137_725,
    minRentalSeconds: 180,
    maxRentalSeconds: 3_600,
    availableFrom: "2026-08-17T00:00:00.000Z",
    availableUntil: "2026-08-18T00:00:00.000Z",
    approvedImage: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`,
    termsVersion: "KAI_HOSTING_TERMS_2026_08",
    status: "PUBLISHED",
    version: 2,
    verificationSummary: { status: "PASSED", checks: ["GPU_IDENTITY", "WORKLOAD_IMAGE", "PORT_REACHABILITY"] },
    verifiedUntil: "2026-08-18T00:00:00.000Z",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    cnyReferenceRate: "1.002",
    amountCents: 3_120,
  });
  assert.deepEqual({ dataClass: offer.dataClass, source: offer.source, version: offer.version }, { dataClass: "LIVE_INVENTORY", source: "HOSTING_V2", version: 2 });
  assert.equal(offer.verificationSummary.status, "PASSED");
  assert.equal(offer.verifiedUntil, "2026-08-18T00:00:00.000Z");
  assert.equal("deviceId" in offer, false);
  assert.deepEqual(Object.keys(offer.pricing).sort(), ["assetCode", "cardHourMicrosPerGpuHour"]);

  const contract = contractFixture();
  const buyerContract = hostingContractClientView(contract);
  const supplierContract = hostingSupplierContractClientView(contract);
  const settlement = hostingSettlementClientView({
    heldMicros: contract.heldMicros,
    settledMicros: contract.settledMicros,
    releasedMicros: 0,
    supplierIncomeMicros: contract.supplierIncomeMicros,
    commissionMicros: contract.commissionMicros,
    platformFeeMicros: 15_568,
    cnyReferenceCents: 156,
    amountCents: 156,
  });

  const dashboard = {
    assetCode: "KAI_CREDIT_HOUR",
    rate: { cardHours: "1", cny: "1.002", topupBlockCardHours: "5", topupBlockCny: "5.01" },
    balance: { availableMicros: 1_541_319, heldMicros: 0, lifetimeTopupMicros: 0, lifetimeSpentMicros: 0, cnyReferenceCents: 154 },
    topups: [],
    purchases: [],
    buybacks: [],
    income: { rentalPendingMicros: 0, rentalVestedMicros: 1_541_319, commissionPendingMicros: 0, commissionVestedMicros: 0, amountCents: 154 },
    referral: { code: "KAITEST", invitedOrganizations: 0 },
    ledger: [{ operation: "RENTAL_INCOME", business_key: "hosting:hctr_currency_boundary", account_code: "USER_AVAILABLE", side: "CREDIT", amount_micros: 1_541_319, balance_after_micros: 1_541_319, created_at: "2026-08-17T00:05:00.000Z", cny_reference_cents: 154 }],
  };
  const feePreview = {
    activeFeeScheduleId: "hfee_currency_boundary",
    model: "LIFETIME_SUPPLIER_SETTLED_GROSS_V1",
    tierCode: "STARTER",
    asOf: "2026-08-17T00:05:00.000Z",
    qualifyingVolumeMicros: 1_556_887,
    platformFeeBps: 100,
    referralRewardBps: 30,
    tiers: [{ code: "STARTER", minimumQualifyingMicros: 0, platformFeeBps: 100, referralRewardBps: 30, cnyReferenceRate: "1.002" }],
    nextTierCode: "GROWTH",
    nextTierMinimumMicros: 10_000_000_000,
    remainingToNextTierMicros: 9_998_443_113,
    amountCents: 156,
  };
  const monthlySettlement = {
    period: { key: "2026-08", startAt: "2026-07-31T16:00:00.000Z", endAt: "2026-08-31T16:00:00.000Z", timeZone: "Asia/Shanghai", currency: "CNY" },
    grossMicros: 1_556_887,
    platformFeeMicros: 15_568,
    supplierIncomeMicros: 1_541_319,
    inFeeReferralCommissionMicros: 4_670,
    platformNetMicros: 10_898,
    cnyReferenceCents: 156,
  };
  const earnings = hostingSupplierEarningsClientView(dashboard, feePreview, monthlySettlement, "2026-08-17T00:05:00.000Z");

  for (const [name, response] of Object.entries({ offer, buyerContract, supplierContract, settlement, earnings })) {
    assert.deepEqual(fiatLeaks(response), [], `${name} public projection leaked fiat fields`);
  }
});

test("buyer and supplier Hosting API source boundaries contain no CNY or amount-cent response fields", () => {
  const routes = [
    "app/api/v2/offers/route.ts",
    "app/api/v2/contracts/route.ts",
    "app/api/v2/contracts/[contractId]/route.ts",
    "app/api/v2/contracts/[contractId]/accept/route.ts",
    "app/api/v2/supply/contracts/route.ts",
    "app/api/v2/supply/contracts/[contractId]/route.ts",
    "app/api/v2/supply/earnings/route.ts",
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /cnyReference|amountCents|currency\s*:\s*["']CNY["']/iu, `${path} must remain card-hour-only`);
  }
});

test("card-hour API amounts round half-up to exactly two visible decimals at boundaries", () => {
  for (const [micros, expected] of [
    [0, "0.00"],
    [4_999, "0.00"],
    [5_000, "0.01"],
    [1_004_999, "1.00"],
    [1_005_000, "1.01"],
    [31_137_725, "31.14"],
  ]) {
    const rendered = formatCardHourDisplayMicros(micros);
    assert.equal(rendered, expected);
    assert.match(rendered, /^\d[\d,]*\.\d{2}$/u);
  }
});

test("TOPUP_CLOSED fails before resolving the store or creating a pending payment order", async () => {
  let storeLookups = 0;
  await assert.rejects(createCardHourTopupOrder({
    account,
    cardHourMicros: 5_000_000,
    idempotencyKey: "topup-closed-boundary",
    now: new Date("2026-08-17T00:00:00.000Z"),
  }, {
    environment: { KAI_ALIPAY_ENABLED: "0" },
    getStore: async () => {
      storeLookups += 1;
      throw new Error("store must not be resolved while top-up is closed");
    },
  }), (error) => error?.code === "TOPUP_CLOSED" && error?.status === 503);
  assert.equal(storeLookups, 0);

  const route = readFileSync("app/api/v1/member/card-hours/topups/route.ts", "utf8");
  assert.match(route, /createCardHourTopupOrder/u);
  assert.doesNotMatch(route, /createTopup\(/u, "the route must not create a payment row before the closed gate");
});
