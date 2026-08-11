import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertHostingV2ApprovedImage } from "../lib/server/hosting-v2-image-policy.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const account = {
  account: { id: "acct-offer-supplier", displayName: "Offer Supplier", primaryEmail: "offer@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-offer-supplier", name: "Offer Supplier", externalKey: "OFFER_SUPPLIER", status: "ACTIVE" },
  membership: { id: "mbr-offer-supplier", accountId: "acct-offer-supplier", organizationId: "org-offer-supplier", status: "ACTIVE", roles: [] },
  sessionId: "session-offer-supplier",
  authMethod: "KAI_IDENTITY_OIDC",
};

function mutation(actorId, key, hash, now) {
  return { actorId, idempotencyKey: key, payloadHash: hash, now };
}

function successfulVerificationDetails(inventoryDigest, observedAt) {
  const tests = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: tests.map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}` })),
  };
}

test("only approved, verified and fee-backed GPU offers enter the public market", async () => {
  const store = await createSqliteHostingV2Store(":memory:");
  try {
    const clock = new Date();
    const now = clock.toISOString();
    await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 报价测试", contactEmail: "offer@example.com", expectedVersion: 0 }, mutation(account.account.id, "offer-profile-save", "offer-profile-save-hash", now));
    await store.submitProfile(account.activeOrganization.id, 1, mutation(account.account.id, "offer-profile-submit", "offer-profile-submit-hash", now));
    await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "允许内部挂牌测试" }, mutation("admin-offer-reviewer", "offer-profile-review", "offer-profile-review-hash", now));
    const challenge = await store.issueAgentChallenge(account, mutation(account.account.id, "offer-agent-challenge", "offer-agent-challenge-hash", now));
    const inventory = {
      hostnameDigest: `sha256:${"1".repeat(64)}`,
      gpuModel: "RTX_4090",
      gpuUuidDigest: `sha256:${"2".repeat(64)}`,
      gpuMemoryMiB: 24_576,
      driverVersion: "580.10",
      cudaVersion: "13.0",
      cpuModel: "AMD Ryzen 9 9950X",
      memoryMiB: 65_536,
      storageGiB: 2_048,
      publicHost: "offer-gpu.example.com",
      sshPortStart: 23_000,
      sshPortEnd: 23_019,
    };
    const inventoryDigest = `sha256:${"3".repeat(64)}`;
    const device = await store.registerDevice(challenge.id, { displayName: "4090 报价机", deviceKeyId: `sha256:${"4".repeat(64)}`, devicePublicKey: "A".repeat(43), agentVersion: "1.1.0", inventory, inventoryDigest }, mutation("agent-offer", "offer-device-register", "offer-device-register-hash", now));
    await store.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now }, mutation(`agent:${device.id}`, "offer-heartbeat-1", "offer-heartbeat-hash", now));
    const verification = await store.queueVerification(account.activeOrganization.id, device.id, mutation(account.account.id, "offer-verify", "offer-verify-hash", now));
    await store.pollCommand(device.id, now);
    await store.completeCommand(device.id, verification.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"5".repeat(64)}`, details: successfulVerificationDetails(inventoryDigest, now) }, mutation(`agent:${device.id}`, "offer-verify-result", "offer-verify-result-hash", now));

    const offerInput = {
      deviceId: device.id,
      title: "北京单卡 RTX 4090 24GB",
      gpuModel: "RTX_4090",
      region: "中国·北京",
      cardHourMicrosPerGpuHour: 850_000,
      minRentalSeconds: 180,
      maxRentalSeconds: 86_400,
      availableFrom: new Date(clock.getTime() - 60_000).toISOString(),
      availableUntil: new Date(clock.getTime() + 86_400_000).toISOString(),
      approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES,
      termsVersion: "KAI_HOSTING_TERMS_2026_08",
    };
    await assert.rejects(store.createOffer(account.activeOrganization.id, offerInput, mutation(account.account.id, "offer-before-fee", "offer-before-fee-hash", now)), (error) => error.code === "EXCHANGE_STATE_CONFLICT" && error.status === 503);
    await assert.rejects(store.createFeeSchedule({ platformFeeBps: 500, referralRewardBps: 600, activate: true, effectiveFrom: now }, mutation("admin-market", "fee-invalid", "fee-invalid-hash", now)), (error) => error.name === "ExchangeInputError");
    const fee = await store.createFeeSchedule({ platformFeeBps: 1_000, referralRewardBps: 300, activate: true, effectiveFrom: now }, mutation("admin-market", "fee-active-0001", "fee-active-hash", now));
    assert.equal(fee.status, "ACTIVE");

    await assert.rejects(store.createOffer(account.activeOrganization.id, { ...offerInput, approvedImage: "ghcr.io/kai-cloud/cuda-pytorch:latest" }, mutation(account.account.id, "offer-mutable-image", "offer-mutable-image-hash", now)), (error) => error.name === "ExchangeInputError");
    await assert.rejects(store.createOffer(account.activeOrganization.id, { ...offerInput, approvedImage: `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"b".repeat(64)}` }, mutation(account.account.id, "offer-unapproved-image", "offer-unapproved-image-hash", now)), (error) => error.name === "ExchangeInputError");

    const offer = await store.createOffer(account.activeOrganization.id, offerInput, mutation(account.account.id, "offer-create-0001", "offer-create-hash", now));
    assert.equal(offer.status, "DRAFT");
    assert.equal((await store.listPublicOffers(now)).length, 0);
    const published = await store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 1 }, mutation(account.account.id, "offer-publish-0001", "offer-publish-hash", now));
    assert.equal(published.status, "PUBLISHED");
    assert.equal((await store.listPublicOffers(now)).length, 1);
    await assert.rejects(store.updateOfferStatus("org-other", offer.id, { status: "PAUSED", expectedVersion: 2 }, mutation("acct-other", "offer-cross-org", "offer-cross-org-hash", now)), (error) => error.code === "EXCHANGE_NOT_FOUND");
    const paused = await store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PAUSED", expectedVersion: 2 }, mutation(account.account.id, "offer-pause-0001", "offer-pause-hash", now));
    assert.equal(paused.status, "PAUSED");
    assert.equal((await store.listPublicOffers(now)).length, 0);
    const republished = await store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 3 }, mutation(account.account.id, "offer-republish-0001", "offer-republish-hash", now));
    assert.equal(republished.status, "PUBLISHED");
    assert.equal((await store.listPublicOffers(now)).length, 1);

    await store.reviewProfile(account.activeOrganization.id, { decision: "SUSPEND", expectedVersion: 3, reviewNote: "暂停供应资格进行复核" }, mutation("admin-offer-reviewer", "offer-supplier-suspend", "offer-supplier-suspend-hash", now));
    assert.equal((await store.listPublicOffers(now)).length, 0);
    assert.equal((await store.getOffer(offer.id)).status, "SUSPENDED");
  } finally {
    store.close();
  }
});

test("hosting image policy fails closed when operations has not configured immutable images", () => {
  assert.throws(() => assertHostingV2ApprovedImage(process.env.KAI_HOSTING_APPROVED_IMAGES, {}), (error) => error.code === "HOSTING_IMAGE_POLICY_UNAVAILABLE" && error.status === 503);
  assert.throws(() => assertHostingV2ApprovedImage("ghcr.io/kai-cloud/cuda-pytorch:latest", { KAI_HOSTING_APPROVED_IMAGES: process.env.KAI_HOSTING_APPROVED_IMAGES }), (error) => error.name === "ExchangeInputError");
});

test("offer APIs enforce server-owned identities and public responses omit internal IDs", () => {
  const supplyRoutes = [
    "app/api/v2/supply/offers/route.ts",
    "app/api/v2/supply/offers/[offerId]/status/route.ts",
  ];
  for (const path of supplyRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.match(source, /assertAccountAuthSameOrigin\(request\)/u);
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
  const adminFees = readFileSync("app/api/v2/admin/hosting/fees/route.ts", "utf8");
  assert.match(adminFees, /requireAdminPermission\(request, \["MARKET_PUBLISH", "SETTLEMENT_OPERATE"\]\)/u);
  const adminWrite = adminFees.slice(adminFees.indexOf("export async function POST"));
  assert.ok(adminWrite.indexOf("assertAccountAuthSameOrigin(request)") < adminWrite.indexOf("requireAdminPermission(request"));

  const publicOffers = readFileSync("app/api/v2/offers/route.ts", "utf8");
  assert.match(publicOffers, /listPublicOffers/u);
  assert.doesNotMatch(publicOffers, /organizationId|deviceId|feeScheduleId/u);
  assert.match(publicOffers, /assetCode: "KAI_CREDIT_HOUR"/u);
  assert.match(publicOffers, /cnyReferenceRate: "1\.002"/u);
});
