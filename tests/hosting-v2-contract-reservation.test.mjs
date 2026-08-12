import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cancelHostingContract, reserveHostingContract } from "../lib/server/hosting-contract-service.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";
import { normalizeSshPublicKey } from "../lib/server/ssh-public-key.ts";
import { hostingAgentDigest } from "../lib/server/hosting-agent-crypto.ts";

function account(id) {
  return {
    account: { id: `acct-${id}`, displayName: id, primaryEmail: `${id}@example.com`, status: "ACTIVE" },
    activeOrganization: { id: `org-${id}`, name: id, externalKey: id.toUpperCase(), status: "ACTIVE" },
    membership: { id: `mbr-${id}`, accountId: `acct-${id}`, organizationId: `org-${id}`, status: "ACTIVE", roles: [] },
    sessionId: `session-${id}`,
    authMethod: "KAI_IDENTITY_OIDC",
  };
}

function mutation(actorId, key, hash, now) {
  return { actorId, idempotencyKey: key, payloadHash: hash, now };
}

function sshString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function testPublicKey() {
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.alloc(32, 11))]);
  return `ssh-ed25519 ${blob.toString("base64")} cancellation-boundary`;
}

function successfulVerificationDetails(inventoryDigest, observedAt, challengeDigest) {
  const tests = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: tests.map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}`, ...(name === "PORT_REACHABILITY" ? { summary: { port: 24_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}) })),
  };
}

async function publishedOffer(store, supplier, clock) {
  const now = clock.toISOString();
  await store.saveProfile(supplier, { supplierType: "INDIVIDUAL", legalDisplayName: "预留测试 4090 供应方", contactEmail: supplier.account.primaryEmail, expectedVersion: 0 }, mutation(supplier.account.id, "reserve-profile-save", "reserve-profile-save-hash", now));
  await store.submitProfile(supplier.activeOrganization.id, 1, process.env.KAI_HOSTING_TERMS_VERSION, mutation(supplier.account.id, "reserve-profile-submit", "reserve-profile-submit-hash", now));
  await store.reviewProfile(supplier.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "允许内部预留闭环测试" }, mutation("admin-reserve-reviewer", "reserve-profile-review", "reserve-profile-review-hash", now));
  const challenge = await store.issueAgentChallenge(supplier, mutation(supplier.account.id, "reserve-agent-challenge", "reserve-agent-challenge-hash", now));
  const inventoryDigest = `sha256:${"3".repeat(64)}`;
  const device = await store.registerDevice(challenge.id, {
    displayName: "预留测试 4090",
    deviceKeyId: `sha256:${"4".repeat(64)}`,
    devicePublicKey: "A".repeat(43),
    agentVersion: "1.8.0",
    inventory: { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: `sha256:${"2".repeat(64)}`, gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen 9 9950X", memoryMiB: 65_536, storageGiB: 2_048, publicHost: "reserve-gpu.example.com", sshPortStart: 24_000, sshPortEnd: 24_019 },
    inventoryDigest,
  }, mutation("agent-reserve", "reserve-device-register", "reserve-device-register-hash", now));
  await store.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now }, mutation(`agent:${device.id}`, "reserve-heartbeat", "reserve-heartbeat-hash", now));
  const verification = await store.queueVerification(supplier.activeOrganization.id, device.id, mutation(supplier.account.id, "reserve-verify", "reserve-verify-hash", now));
  await store.pollCommand(device.id, now);
  const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: verification.id, publicHost: device.inventory.publicHost, publicPort: device.inventory.sshPortStart, challenge: verification.payload.reachabilityChallenge });
  await store.completeCommand(device.id, verification.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"5".repeat(64)}`, controlPlaneReachabilityDigest: challengeDigest, details: successfulVerificationDetails(inventoryDigest, now, challengeDigest) }, mutation(`agent:${device.id}`, "reserve-verify-result", "reserve-verify-result-hash", now));
  await store.createFeeSchedule({ platformFeeBps: 1_000, referralRewardBps: 300, activate: true, effectiveFrom: now }, mutation("admin-market", "reserve-fee", "reserve-fee-hash", now));
  const offer = await store.createOffer(supplier.activeOrganization.id, { deviceId: device.id, title: "北京 RTX 4090 三分钟起租", gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, minRentalSeconds: 180, maxRentalSeconds: 3_600, availableFrom: new Date(clock.getTime() - 60_000).toISOString(), availableUntil: new Date(clock.getTime() + 86_400_000).toISOString(), approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08" }, mutation(supplier.account.id, "reserve-offer-create", "reserve-offer-create-hash", now));
  return store.updateOfferStatus(supplier.activeOrganization.id, offer.id, { status: "PUBLISHED", expectedVersion: 1 }, mutation(supplier.account.id, "reserve-offer-publish", "reserve-offer-publish-hash", now));
}

test("GPU reservation locks exact card-hours once and cancellation releases them", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-reservation-"));
  const path = join(directory, "reservation.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const supplier = account("reserve-supplier");
  const buyer = account("reserve-buyer");
  const emptyBuyer = account("reserve-empty-buyer");
  const stores = { hosting, cardHours };
  try {
    const clock = new Date();
    const now = clock.toISOString();
    const offer = await publishedOffer(hosting, supplier, clock);
    const grant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 10_000_000, reason: "内部 GPU 预留闭环验收", requestedBy: "admin-grant-requester", idempotencyKey: "reserve-trial-grant", payloadHash: "reserve-trial-grant-hash", now });
    await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "admin-grant-approver", payloadHash: "reserve-trial-approval-hash", now });

    const reservationInput = { account: buyer, offerId: offer.id, reservedSeconds: 180, mutation: mutation(buyer.account.id, "buyer-reserve-0001", "buyer-reserve-hash", now) };
    const reserved = await reserveHostingContract(reservationInput, stores);
    assert.equal(reserved.contract.status, "CARD_HOURS_HELD");
    assert.equal(reserved.heldMicros, 180_000);
    assert.equal(reserved.replayed, false);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, now)).balance, { availableMicros: 9_820_000, heldMicros: 180_000, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 0 });
    const replay = await reserveHostingContract(reservationInput, stores);
    assert.equal(replay.contract.id, reserved.contract.id);
    assert.equal(replay.replayed, true);
    assert.equal((await cardHours.dashboard(buyer.activeOrganization.id, now)).balance.heldMicros, 180_000);

    const cancelInput = { account: buyer, contractId: reserved.contract.id, reason: "买家取消内部预留测试", mutation: mutation(buyer.account.id, "buyer-cancel-0001", "buyer-cancel-hash", now) };
    const cancelled = await cancelHostingContract(cancelInput, stores);
    assert.equal(cancelled.contract.status, "CANCELLED");
    assert.equal(cancelled.hold.status, "RELEASED");
    await cancelHostingContract(cancelInput, stores);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, now)).balance, { availableMicros: 10_000_000, heldMicros: 0, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 0 });
    assert.equal((await hosting.listPublicOffers(now)).length, 1);

    await assert.rejects(reserveHostingContract({ account: emptyBuyer, offerId: offer.id, reservedSeconds: 180, mutation: mutation(emptyBuyer.account.id, "empty-buyer-reserve", "empty-buyer-reserve-hash", now) }, stores), (error) => error.code === "CARD_HOUR_BALANCE_INSUFFICIENT");
    assert.equal((await cardHours.dashboard(emptyBuyer.activeOrganization.id, now)).balance.heldMicros, 0);
    assert.equal((await hosting.listPublicOffers(now)).length, 1, "failed card-hour hold must republish the GPU offer");

    const provisionReservation = await reserveHostingContract({ account: buyer, offerId: offer.id, reservedSeconds: 180, mutation: mutation(buyer.account.id, "buyer-reserve-provision", "buyer-reserve-provision-hash", now) }, stores);
    const key = await normalizeSshPublicKey(testPublicKey());
    await hosting.attachSshKey(buyer.activeOrganization.id, provisionReservation.contract.id, key, mutation(buyer.account.id, "buyer-provision-key", "buyer-provision-key-hash", now));
    await assert.rejects(cancelHostingContract({ account: buyer, contractId: provisionReservation.contract.id, reason: "开通以后不能绕过清理", mutation: mutation(buyer.account.id, "buyer-cancel-after-provision", "buyer-cancel-after-provision-hash", now) }, stores), (error) => error.code === "EXCHANGE_STATE_CONFLICT");
    assert.equal((await hosting.contractForViewer(buyer.activeOrganization.id, provisionReservation.contract.id)).status, "PROVISIONING");
    assert.equal((await cardHours.dashboard(buyer.activeOrganization.id, now)).balance.heldMicros, 180_000, "unsafe cancellation must not release held card-hours");
    assert.equal((await hosting.listPublicOffers(now)).length, 0, "an instance awaiting cleanup must never return to the market");
  } finally {
    cardHours.close();
    hosting.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("buyer contract APIs use formal ownership and hide supplier infrastructure identifiers", () => {
  const routes = [
    "app/api/v2/contracts/route.ts",
    "app/api/v2/contracts/[contractId]/route.ts",
    "app/api/v2/contracts/[contractId]/cancel/route.ts",
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
  for (const path of [routes[0], routes[2]]) {
    const source = readFileSync(path, "utf8");
    assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
  }
  const apiHelpers = readFileSync("lib/server/hosting-v2-api.ts", "utf8");
  const view = apiHelpers.slice(apiHelpers.indexOf("export function hostingContractClientView"), apiHelpers.indexOf("export function hostingSupplierContractClientView"));
  assert.doesNotMatch(view, /deviceId|supplierOrganizationId|buyerAccountId|feeScheduleId/u);
  assert.match(view, /heldMicros/u);
});

test("buyer UI only offers direct cancellation before provisioning begins", () => {
  const workspace = readFileSync("components/hosting-contract-workspace.tsx", "utf8");
  assert.match(workspace, /new Set\(\["RESERVED", "CARD_HOURS_HELD", "PAID"\]\)/u);
  assert.doesNotMatch(workspace, /CANCELLABLE_STATUSES[^\n]+PROVISIONING|CANCELLABLE_STATUSES[^\n]+READY/u);
});
