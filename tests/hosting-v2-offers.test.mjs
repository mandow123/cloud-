import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { assertHostingV2ApprovedImage, hostingV2ApprovedImages, hostingV2CurrentTermsVersion } from "../lib/server/hosting-v2-image-policy.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";
import { hostingAgentDigest } from "../lib/server/hosting-agent-crypto.ts";

const approvedImage = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"a".repeat(64)}`;
const termsVersion = "KAI_HOSTING_TERMS_2026_08";

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

function successfulVerificationDetails(inventoryDigest, observedAt, challengeDigest) {
  const tests = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: tests.map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}`, ...(name === "WORKLOAD_IMAGE" ? { summary: { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: [approvedImage], allPresent: true } } : {}), ...(name === "PORT_REACHABILITY" ? { summary: { port: 23_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}) })),
  };
}

test("only approved, verified and fee-backed GPU offers enter the public market", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-offers-"));
  const databasePath = join(directory, "hosting.sqlite");
  const store = await createSqliteHostingV2Store(databasePath);
  try {
    const clock = new Date();
    const now = clock.toISOString();
    await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 报价测试", contactEmail: "offer@example.com", expectedVersion: 0 }, mutation(account.account.id, "offer-profile-save", "offer-profile-save-hash", now));
    await store.submitProfile(account.activeOrganization.id, 1, termsVersion, mutation(account.account.id, "offer-profile-submit", "offer-profile-submit-hash", now));
    await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "允许内部挂牌测试", evidenceDigest: "c".repeat(64) }, mutation("admin-offer-reviewer", "offer-profile-review", "offer-profile-review-hash", now));
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
    const device = await store.registerDevice(challenge.id, { displayName: "4090 报价机", deviceKeyId: `sha256:${"4".repeat(64)}`, devicePublicKey: "A".repeat(43), agentVersion: "1.9.5", inventory, inventoryDigest }, mutation("agent-offer", "offer-device-register", "offer-device-register-hash", now));
    await store.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now }, mutation(`agent:${device.id}`, "offer-heartbeat-1", "offer-heartbeat-hash", now));
    const verification = await store.queueVerification(account.activeOrganization.id, device.id, mutation(account.account.id, "offer-verify", "offer-verify-hash", now));
    await store.pollCommand(device.id, now);
    const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: verification.id, publicHost: inventory.publicHost, publicPort: inventory.sshPortStart, challenge: verification.payload.reachabilityChallenge });
    await store.completeCommand(device.id, verification.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"5".repeat(64)}`, controlPlaneReachabilityDigest: challengeDigest, details: successfulVerificationDetails(inventoryDigest, now, challengeDigest) }, mutation(`agent:${device.id}`, "offer-verify-result", "offer-verify-result-hash", now));

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
      approvedImage,
      termsVersion,
    };
    await assert.rejects(store.createOffer(account.activeOrganization.id, offerInput, mutation(account.account.id, "offer-before-fee", "offer-before-fee-hash", now)), (error) => error.code === "EXCHANGE_STATE_CONFLICT" && error.status === 503);
    await assert.rejects(store.createFeeSchedule({ platformFeeBps: 500, referralRewardBps: 600, activate: true, effectiveFrom: now }, mutation("admin-market", "fee-invalid", "fee-invalid-hash", now)), (error) => error.name === "ExchangeInputError");
    await assert.rejects(store.createFeeSchedule({ platformFeeBps: 100, referralRewardBps: 101, activate: true, effectiveFrom: now }, mutation("admin-market", "fee-referral-over-platform", "fee-referral-over-platform-hash", now)), (error) => error.name === "ExchangeInputError" && error.field === "referralRewardBps");
    const allFeeMayFundReferral = await store.createFeeSchedule({ platformFeeBps: 100, referralRewardBps: 100, activate: false, effectiveFrom: now }, mutation("admin-market", "fee-referral-equals-platform", "fee-referral-equals-platform-hash", now));
    assert.deepEqual({ platformFeeBps: allFeeMayFundReferral.platformFeeBps, referralRewardBps: allFeeMayFundReferral.referralRewardBps, status: allFeeMayFundReferral.status }, { platformFeeBps: 100, referralRewardBps: 100, status: "DRAFT" });
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
    const originalImagePolicy = process.env.KAI_HOSTING_APPROVED_IMAGES;
    const rotatedImage = `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"c".repeat(64)}`;
    try {
      process.env.KAI_HOSTING_APPROVED_IMAGES = rotatedImage;
      assert.equal((await store.listPublicOffers(now)).length, 0, "a policy rotation must hide an offer backed only by stale image proof");
      await assert.rejects(store.createOffer(account.activeOrganization.id, { ...offerInput, title: "未重新验真的新镜像", approvedImage: rotatedImage }, mutation(account.account.id, "offer-rotated-unverified", "offer-rotated-unverified-hash", now)), (error) => error.code === "EXCHANGE_VERIFICATION_REQUIRED");
      await assert.rejects(store.reserveContract(account, offer.id, 180, 180_000, mutation(account.account.id, "offer-rotated-reserve", "offer-rotated-reserve-hash", now)), (error) => error.code === "EXCHANGE_CAPACITY_CONFLICT");
    } finally {
      process.env.KAI_HOSTING_APPROVED_IMAGES = originalImagePolicy;
    }
    assert.equal((await store.listPublicOffers(now)).length, 1);
    await assert.rejects(store.updateOfferStatus("org-other", offer.id, { status: "PAUSED", expectedVersion: 2 }, mutation("acct-other", "offer-cross-org", "offer-cross-org-hash", now)), (error) => error.code === "EXCHANGE_NOT_FOUND");

    const downgrade = new DatabaseSync(databasePath);
    downgrade.prepare("UPDATE hosting_v2_devices SET agent_version='1.5.0' WHERE id=?").run(device.id);
    downgrade.close();
    assert.equal((await store.listPublicOffers(now)).length, 0, "an offer backed by an obsolete Agent must disappear immediately");
    assert.equal((await store.readiness(now)).activeAgentCount, 0, "readiness must not count an obsolete Agent as delivery capacity");
    await assert.rejects(store.createOffer(account.activeOrganization.id, { ...offerInput, title: "旧版 Agent 不得新增挂牌" }, mutation(account.account.id, "offer-old-agent-create", "offer-old-agent-create-hash", now)), (error) => error.code === "HOSTING_AGENT_UPGRADE_REQUIRED");
    await assert.rejects(store.reserveContract(account, offer.id, 180, 180_000, mutation(account.account.id, "offer-old-agent-reserve", "offer-old-agent-reserve-hash", now)), (error) => error.code === "EXCHANGE_CAPACITY_CONFLICT");
    const paused = await store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PAUSED", expectedVersion: 2 }, mutation(account.account.id, "offer-pause-0001", "offer-pause-hash", now));
    assert.equal(paused.status, "PAUSED");
    assert.equal((await store.listPublicOffers(now)).length, 0);
    await assert.rejects(store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 3 }, mutation(account.account.id, "offer-old-agent-republish", "offer-old-agent-republish-hash", now)), (error) => error.code === "HOSTING_AGENT_UPGRADE_REQUIRED");
    const upgrade = new DatabaseSync(databasePath);
    upgrade.prepare("UPDATE hosting_v2_devices SET agent_version='1.9.5' WHERE id=?").run(device.id);
    upgrade.close();
    const republished = await store.updateOfferStatus(account.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 3 }, mutation(account.account.id, "offer-republish-0001", "offer-republish-hash", now));
    assert.equal(republished.status, "PUBLISHED");
    assert.equal((await store.listPublicOffers(now)).length, 1);

    await store.reviewProfile(account.activeOrganization.id, { decision: "SUSPEND", expectedVersion: 3, reviewNote: "暂停供应资格进行复核" }, mutation("admin-offer-reviewer", "offer-supplier-suspend", "offer-supplier-suspend-hash", now));
    assert.equal((await store.listPublicOffers(now)).length, 0);
    assert.equal((await store.getOffer(offer.id)).status, "SUSPENDED");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("hosting image policy fails closed when operations has not configured immutable images", () => {
  assert.throws(() => assertHostingV2ApprovedImage(approvedImage, {}), (error) => error.code === "HOSTING_IMAGE_POLICY_UNAVAILABLE" && error.status === 503);
  assert.throws(() => assertHostingV2ApprovedImage("ghcr.io/kai-cloud/cuda-pytorch:latest", { KAI_HOSTING_APPROVED_IMAGES: approvedImage }), (error) => error.name === "ExchangeInputError");
});

test("hosting image policy permits only the two explicitly controlled repositories", () => {
  const productionWorkloadImage = `ghcr.io/mandow123/kai-cloud-gpu-workload@sha256:${"b".repeat(64)}`;
  assert.deepEqual([...hostingV2ApprovedImages({ KAI_HOSTING_APPROVED_IMAGES: productionWorkloadImage })], [productionWorkloadImage]);
  assert.throws(
    () => hostingV2ApprovedImages({ KAI_HOSTING_APPROVED_IMAGES: `ghcr.io/mandow123/other@sha256:${"b".repeat(64)}` }),
    (error) => error.code === "HOSTING_IMAGE_POLICY_INVALID",
  );
});

test("hosting terms policy is server-configured and fails closed", () => {
  assert.equal(hostingV2CurrentTermsVersion({ KAI_HOSTING_TERMS_VERSION: "KAI_HOSTING_TERMS_2026_08" }), "KAI_HOSTING_TERMS_2026_08");
  assert.throws(() => hostingV2CurrentTermsVersion({}), (error) => error.code === "HOSTING_TERMS_POLICY_UNAVAILABLE" && error.status === 503);
  assert.throws(() => hostingV2CurrentTermsVersion({ KAI_HOSTING_TERMS_VERSION: "terms-latest" }), (error) => error.code === "HOSTING_TERMS_POLICY_UNAVAILABLE");
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
  const offerCreate = readFileSync(supplyRoutes[0], "utf8").slice(readFileSync(supplyRoutes[0], "utf8").indexOf("export async function POST"));
  assert.match(offerCreate, /"gpuModel", "termsVersion"/u);
  assert.match(offerCreate, /gpuModel: device\.inventory\.gpuModel/u);
  assert.match(offerCreate, /termsVersion: hostingV2CurrentTermsVersion\(\)/u);
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
