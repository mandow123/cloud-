import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAccountSession } from "../lib/server/account-auth.ts";
import { createSqliteAccountAuthStore } from "../lib/server/account-auth-sqlite.ts";
import { getCardHourStore } from "../lib/server/card-hour-store.ts";
import { getHostingV2Store } from "../lib/server/hosting-v2-store.ts";
import { hostingAgentDigest } from "../lib/server/hosting-agent-crypto.ts";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { PUT as saveSupplierProfile } from "../app/api/v2/supply/profile/route.ts";
import { POST as submitSupplierProfile } from "../app/api/v2/supply/profile/submit/route.ts";
import { POST as issueAgentChallenge } from "../app/api/v2/supply/agent-challenges/route.ts";
import { POST as queueDeviceVerification } from "../app/api/v2/supply/devices/[deviceId]/verify/route.ts";
import { GET as getSupplyPolicy } from "../app/api/v2/supply/policy/route.ts";
import { POST as createSupplyOffer } from "../app/api/v2/supply/offers/route.ts";
import { POST as changeSupplyOfferStatus } from "../app/api/v2/supply/offers/[offerId]/status/route.ts";
import { GET as listPublicOffers } from "../app/api/v2/offers/route.ts";
import { GET as listBuyerContracts, POST as reserveBuyerContract } from "../app/api/v2/contracts/route.ts";
import { GET as getBuyerContract } from "../app/api/v2/contracts/[contractId]/route.ts";
import { POST as attachBuyerSshKey } from "../app/api/v2/contracts/[contractId]/ssh-key/route.ts";
import { POST as startBuyerContract } from "../app/api/v2/contracts/[contractId]/start/route.ts";
import { POST as stopBuyerContract } from "../app/api/v2/contracts/[contractId]/stop/route.ts";
import { POST as acceptBuyerContract } from "../app/api/v2/contracts/[contractId]/accept/route.ts";
import { GET as listSupplierContracts } from "../app/api/v2/supply/contracts/route.ts";
import { GET as getSupplierContract } from "../app/api/v2/supply/contracts/[contractId]/route.ts";
import { GET as getSupplierEarnings } from "../app/api/v2/supply/earnings/route.ts";

const ORIGIN = "http://localhost:3014";

function mutation(actorId, key, now) {
  return { actorId, idempotencyKey: key, payloadHash: `sha256:${key.padEnd(64, "0").slice(0, 64)}`, now };
}

function sshString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function publicKey() {
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.alloc(32, 9))]);
  return `ssh-ed25519 ${blob.toString("base64")} golden-loop`;
}

function inventory() {
  return {
    hostnameDigest: `sha256:${"1".repeat(64)}`,
    gpuModel: "RTX_4090",
    gpuUuidDigest: `sha256:${"2".repeat(64)}`,
    gpuMemoryMiB: 24_576,
    driverVersion: "580.10",
    cudaVersion: "13.0",
    cpuModel: "AMD Ryzen 9 9950X",
    memoryMiB: 65_536,
    storageGiB: 2_048,
    publicHost: "golden-loop-gpu.example.com",
    sshPortStart: 27_000,
    sshPortEnd: 27_019,
  };
}

function verificationDetails(inventoryDigest, observedAt, challengeDigest) {
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"]
      .map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}`, ...(name === "PORT_REACHABILITY" ? { summary: { port: 27_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}) })),
  };
}

function provisionDetails(contractId, image, observedAt) {
  return {
    protocolVersion: 1,
    contractId,
    image,
    endpointDisplay: "golden-loop-gpu.example.com:27000",
    containerDigest: `sha256:${"7".repeat(64)}`,
    workspaceDigest: `sha256:${"8".repeat(64)}`,
    observedAt,
  };
}

function startDetails(contractId, startedAt) {
  return {
    protocolVersion: 1,
    contractId,
    endpointDisplay: "golden-loop-gpu.example.com:27000",
    containerDigest: `sha256:${"7".repeat(64)}`,
    runtimeStateDigest: `sha256:${"a".repeat(64)}`,
    sshBannerDigest: `sha256:${"b".repeat(64)}`,
    runtimeStatus: "RUNNING",
    startedAt,
    observedAt: startedAt,
  };
}

function stopDetails(contractId, startedAt, stoppedAt) {
  return {
    protocolVersion: 1,
    contractId,
    containerDigest: `sha256:${"7".repeat(64)}`,
    runtimeStateDigest: `sha256:${"d".repeat(64)}`,
    runtimeStatus: "STOPPED",
    startedAt,
    stoppedAt,
    runtimeSeconds: Math.max(0, Math.ceil((Date.parse(stoppedAt) - Date.parse(startedAt)) / 1_000)),
    observedAt: stoppedAt,
  };
}

function cleanupDetails(contractId, observedAt) {
  return {
    protocolVersion: 1,
    contractId,
    containerDigest: `sha256:${"7".repeat(64)}`,
    cleanupDigest: `sha256:${"f".repeat(64)}`,
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanupStatus: "CLEANED",
    cleanedAt: observedAt,
    observedAt,
  };
}

async function json(response, expectedStatus) {
  const body = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(body));
  return body;
}

function browserRequest(session, path, method, payload, idempotencyKey) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-kai-csrf": session.csrfToken,
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
}

function browserRead(session, path) {
  return new Request(`${ORIGIN}${path}`, { headers: { cookie: session.cookie } });
}

async function createBrowserSession(auth, subject, now) {
  const identity = await auth.resolveOrCreateKaiIdentity({
    issuer: "https://account.kai.com/connect",
    subject,
    displayName: subject,
    verifiedEmail: `${subject}@example.com`,
    verifiedAt: now,
  });
  const issued = await createAccountSession(new Request(`${ORIGIN}/api/auth/kai/callback`), identity, "KAI_IDENTITY_OIDC", { store: auth, now: new Date(now) });
  const accountCookie = issued.cookie.split(";", 1)[0];
  const sessionResponse = await openMarketplaceSession(new Request(`${ORIGIN}/api/session`, { headers: { cookie: accountCookie } }));
  const sessionBody = await json(sessionResponse, 200);
  const marketplaceCookie = sessionResponse.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(marketplaceCookie);
  return {
    context: issued.context,
    cookie: `${accountCookie}; ${marketplaceCookie}`,
    csrfToken: sessionBody.session.csrfToken,
  };
}

test("fresh supplier and buyer browsers complete the real three-minute GPU lifecycle through V2 APIs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-golden-loop-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const previousDirectory = process.env.KAI_DB_DIR;
  const previousFlag = process.env.KAI_HOSTING_V2;
  const previousLegacyWrites = process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  const previousAccount = globalThis.__kaiAccountAuthStorePromise;
  const previousCardHours = globalThis.__kaiCardHourStorePromise;
  const previousMarketplace = globalThis.__kaiMarketplaceStorePromise;
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_HOSTING_V2 = "1";
  delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  globalThis.__kaiCardHourStorePromise = undefined;
  globalThis.__kaiMarketplaceStorePromise = undefined;

  const auth = await createSqliteAccountAuthStore(databasePath);
  globalThis.__kaiAccountAuthStorePromise = Promise.resolve(auth);
  const hosting = await getHostingV2Store();
  const cardHours = await getCardHourStore();
  try {
    const now = new Date().toISOString();
    const supplier = await createBrowserSession(auth, "golden-supplier", now);
    const buyer = await createBrowserSession(auth, "golden-buyer", now);
    const referrer = await createBrowserSession(auth, "golden-referrer", now);

    const csrfRejected = await json(await saveSupplierProfile(new Request(`${ORIGIN}/api/v2/supply/profile`, {
      method: "PUT",
      headers: {
        cookie: supplier.cookie,
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
        "content-type": "application/json",
        "Idempotency-Key": "golden-profile-without-csrf",
      },
      body: JSON.stringify({
        supplierType: "INDIVIDUAL",
        legalDisplayName: "这笔请求不应写入",
        contactEmail: supplier.context.account.primaryEmail,
        expectedVersion: 0,
      }),
    })), 403);
    assert.equal(csrfRejected.error.code, "CSRF_REJECTED");
    assert.equal((await hosting.dashboard(supplier.context.activeOrganization.id, now)).profile, null);

    const saved = await json(await saveSupplierProfile(browserRequest(supplier, "/api/v2/supply/profile", "PUT", {
      supplierType: "INDIVIDUAL",
      legalDisplayName: "黄金闭环个人 4090 供应方",
      contactEmail: supplier.context.account.primaryEmail,
      expectedVersion: 0,
    }, "golden-profile-save")), 200);
    assert.equal(saved.record.status, "DRAFT");
    const submitted = await json(await submitSupplierProfile(browserRequest(supplier, "/api/v2/supply/profile/submit", "POST", { expectedVersion: 1, agreementAccepted: true }, "golden-profile-submit")), 200);
    assert.equal(submitted.record.status, "SUBMITTED");
    await hosting.reviewProfile(supplier.context.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "内部真实 GPU 黄金闭环验收" }, mutation("golden-admin-reviewer", "golden-profile-approve", now));

    const challenge = await json(await issueAgentChallenge(browserRequest(supplier, "/api/v2/supply/agent-challenges", "POST", {}, "golden-agent-challenge")), 201);
    const inventoryDigest = `sha256:${"3".repeat(64)}`;
    const device = await hosting.registerDevice(challenge.record.id, {
      displayName: "黄金闭环 RTX 4090",
      deviceKeyId: `sha256:${"4".repeat(64)}`,
      devicePublicKey: "A".repeat(43),
      agentVersion: "1.8.0",
      inventory: inventory(),
      inventoryDigest,
    }, mutation("agent:golden", "golden-device-register", now));
    await hosting.acceptHeartbeat(device.id, { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now }, mutation(`agent:${device.id}`, "golden-heartbeat-1", now));
    const queuedVerification = await json(await queueDeviceVerification(browserRequest(supplier, `/api/v2/supply/devices/${device.id}/verify`, "POST", {}, "golden-device-verify"), { params: Promise.resolve({ deviceId: device.id }) }), 201);
    const verificationCommand = await hosting.pollCommand(device.id, now);
    assert.equal(verificationCommand.id, queuedVerification.record.id);
    const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: verificationCommand.id, publicHost: device.inventory.publicHost, publicPort: device.inventory.sshPortStart, challenge: verificationCommand.payload.reachabilityChallenge });
    await hosting.completeCommand(device.id, verificationCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"5".repeat(64)}`, controlPlaneReachabilityDigest: challengeDigest, details: verificationDetails(inventoryDigest, now, challengeDigest) }, mutation(`agent:${device.id}`, "golden-verify-result", now));
    await hosting.createFeeSchedule({ platformFeeBps: 1_000, referralRewardBps: 300, activate: true, effectiveFrom: now }, mutation("golden-admin-market", "golden-fee-schedule", now));

    const policy = await json(await getSupplyPolicy(browserRead(supplier, "/api/v2/supply/policy")), 200);
    assert.deepEqual(policy.policy, { approvedImages: [process.env.KAI_HOSTING_APPROVED_IMAGES], termsVersion: process.env.KAI_HOSTING_TERMS_VERSION });
    const availableFrom = new Date(Date.parse(now) - 60_000).toISOString();
    const availableUntil = new Date(Date.parse(now) + 86_400_000).toISOString();
    const createdOffer = await json(await createSupplyOffer(browserRequest(supplier, "/api/v2/supply/offers", "POST", {
      deviceId: device.id,
      title: "黄金闭环 RTX 4090 三分钟",
      region: "中国·北京",
      cardHourMicrosPerGpuHour: 3_600_000,
      minRentalSeconds: 180,
      maxRentalSeconds: 3_600,
      availableFrom,
      availableUntil,
      approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES,
    }, "golden-offer-create")), 201);
    assert.equal(createdOffer.record.gpuModel, "RTX_4090", "GPU model must come from the signed device inventory");
    assert.equal(createdOffer.record.termsVersion, process.env.KAI_HOSTING_TERMS_VERSION, "terms must come from server policy");
    const published = await json(await changeSupplyOfferStatus(browserRequest(supplier, `/api/v2/supply/offers/${createdOffer.record.id}/status`, "POST", { status: "PUBLISHED", expectedVersion: 1 }, "golden-offer-publish"), { params: Promise.resolve({ offerId: createdOffer.record.id }) }), 200);
    assert.equal(published.record.status, "PUBLISHED");
    const publicBefore = await json(await listPublicOffers(new Request(`${ORIGIN}/api/v2/offers`)), 200);
    assert.equal(publicBefore.records.length, 1);
    assert.equal("deviceId" in publicBefore.records[0], false);

    const grant = await cardHours.requestTrialGrant({ organizationId: buyer.context.activeOrganization.id, amountMicros: 1_000_000, reason: "黄金闭环买家试运行卡时", requestedBy: "golden-grant-requester", idempotencyKey: "golden-trial-grant", payloadHash: "golden-trial-grant-hash", now });
    await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "golden-grant-approver", payloadHash: "golden-trial-approval-hash", now });
    const referral = await cardHours.dashboard(referrer.context.activeOrganization.id, now);
    await cardHours.attachReferral({ account: buyer.context, code: referral.referral.code, now });

    const reservation = await json(await reserveBuyerContract(browserRequest(buyer, "/api/v2/contracts", "POST", { offerId: published.record.id, reservedSeconds: 180 }, "golden-contract-reserve")), 201);
    assert.equal(reservation.record.status, "CARD_HOURS_HELD");
    assert.equal(reservation.record.heldMicros, 180_000);
    const buyerContracts = await json(await listBuyerContracts(browserRead(buyer, "/api/v2/contracts")), 200);
    assert.equal(buyerContracts.records.length, 1);
    assert.equal("deviceId" in buyerContracts.records[0], false);

    const contractId = reservation.record.id;
    const ssh = await json(await attachBuyerSshKey(browserRequest(buyer, `/api/v2/contracts/${contractId}/ssh-key`, "POST", { publicKey: publicKey() }, "golden-contract-ssh"), { params: Promise.resolve({ contractId }) }), 202);
    assert.equal(ssh.record.status, "PROVISIONING");
    const provisionCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(provisionCommand.type, "PROVISION");
    const provisionedAt = new Date().toISOString();
    await hosting.completeCommand(device.id, provisionCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails(contractId, process.env.KAI_HOSTING_APPROVED_IMAGES, provisionedAt) }, mutation(`agent:${device.id}`, "golden-provision-result", provisionedAt));

    const start = await json(await startBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/start`, "POST", {}, "golden-contract-start"), { params: Promise.resolve({ contractId }) }), 202);
    const startCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(startCommand.id, start.operation.commandId);
    const startedAt = new Date().toISOString();
    await hosting.completeCommand(device.id, startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails(contractId, startedAt) }, mutation(`agent:${device.id}`, "golden-start-result", startedAt));

    const stop = await json(await stopBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/stop`, "POST", {}, "golden-contract-stop"), { params: Promise.resolve({ contractId }) }), 202);
    const stopCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(stopCommand.id, stop.operation.commandId);
    const stoppedAt = new Date().toISOString();
    const stopped = await hosting.completeCommand(device.id, stopCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: stopDetails(contractId, startedAt, stoppedAt) }, mutation(`agent:${device.id}`, "golden-stop-result", stoppedAt));
    assert.equal(stopped.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal(stopped.contract.measuredSeconds, 180, "the platform enforces the published three-minute minimum");

    const accepted = await json(await acceptBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/accept`, "POST", {}, "golden-contract-accept"), { params: Promise.resolve({ contractId }) }), 202);
    assert.equal(accepted.record.status, "CLEANING");
    assert.deepEqual(accepted.settlement, { heldMicros: 180_000, settledMicros: 180_000, releasedMicros: 0, supplierIncomeMicros: 162_000, commissionMicros: 5_400, platformFeeMicros: 18_000 });
    const heartbeatAt = new Date().toISOString();
    await hosting.acceptHeartbeat(device.id, { sequence: 2, inventoryDigest, capacityState: "BUSY", observedAt: heartbeatAt }, mutation(`agent:${device.id}`, "golden-heartbeat-2", heartbeatAt));
    const cleanupCommand = await hosting.pollCommand(device.id, heartbeatAt);
    assert.equal(cleanupCommand.type, "CLEANUP");
    const cleanedAt = new Date().toISOString();
    const cleaned = await hosting.completeCommand(device.id, cleanupCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"9".repeat(64)}`, details: cleanupDetails(contractId, cleanedAt) }, mutation(`agent:${device.id}`, "golden-cleanup-result", cleanedAt));
    assert.equal(cleaned.contract.status, "CLEANED");
    assert.equal(cleaned.device.status, "VERIFIED");

    const buyerDetail = await json(await getBuyerContract(browserRead(buyer, `/api/v2/contracts/${contractId}`), { params: Promise.resolve({ contractId }) }), 200);
    assert.equal(buyerDetail.record.evidence.instance.status, "CLEANED");
    assert.equal(buyerDetail.record.evidence.metering.serverMeasuredSeconds, 180);
    assert.deepEqual({ container: buyerDetail.record.evidence.cleanup.containerRemoved, key: buyerDetail.record.evidence.cleanup.authorizedKeyRemoved, workspace: buyerDetail.record.evidence.cleanup.workspaceRemoved }, { container: true, key: true, workspace: true });
    assert.equal("supplierOrganizationId" in buyerDetail.record, false);

    const supplierDetail = await json(await getSupplierContract(browserRead(supplier, `/api/v2/supply/contracts/${contractId}`), { params: Promise.resolve({ contractId }) }), 200);
    assert.equal(supplierDetail.record.evidence.cleanup.evidenceDigest, `sha256:${"9".repeat(64)}`);
    assert.equal("buyerOrganizationId" in supplierDetail.record, false);
    assert.equal("buyerAccountId" in supplierDetail.record, false);

    const supplierContracts = await json(await listSupplierContracts(browserRead(supplier, "/api/v2/supply/contracts")), 200);
    assert.equal(supplierContracts.records[0].status, "CLEANED");
    assert.equal(supplierContracts.records[0].supplierIncomeMicros, 162_000);
    assert.equal("buyerOrganizationId" in supplierContracts.records[0], false);
    assert.equal("buyerAccountId" in supplierContracts.records[0], false);
    const earnings = await json(await getSupplierEarnings(browserRead(supplier, "/api/v2/supply/earnings")), 200);
    assert.equal(earnings.earnings.income.rentalVestedMicros, 162_000);
    assert.equal(earnings.earnings.balance.availableMicros, 162_000);
    assert.ok(earnings.earnings.ledger.some((entry) => entry.operation === "RENTAL_INCOME" && entry.businessKey.endsWith(contractId)));
    const referrerEarnings = await cardHours.dashboard(referrer.context.activeOrganization.id, cleanedAt);
    assert.equal(referrerEarnings.income.commissionVestedMicros, 5_400);
    const publicAfter = await json(await listPublicOffers(new Request(`${ORIGIN}/api/v2/offers`)), 200);
    assert.equal(publicAfter.records.length, 1, "cleaned and freshly verified inventory must become sellable again");
    const operations = await hosting.readiness(cleanedAt);
    assert.equal(operations.schemaVersion, 9);
    assert.match(operations.activeFeeScheduleId, /^hfee_/u);
    assert.deepEqual({
      approvedSupplierCount: operations.approvedSupplierCount,
      activeAgentCount: operations.activeAgentCount,
      drainingDeviceCount: operations.drainingDeviceCount,
      failedCleanupCount: operations.failedCleanupCount,
      cleaningContractCount: operations.cleaningContractCount,
    }, { approvedSupplierCount: 1, activeAgentCount: 1, drainingDeviceCount: 0, failedCleanupCount: 0, cleaningContractCount: 0 });
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previousAccount;
    globalThis.__kaiCardHourStorePromise = previousCardHours;
    globalThis.__kaiMarketplaceStorePromise = previousMarketplace;
    if (typeof cardHours.close === "function") await cardHours.close();
    if (typeof hosting.close === "function") await hosting.close();
    auth.close();
    if (previousDirectory === undefined) delete process.env.KAI_DB_DIR; else process.env.KAI_DB_DIR = previousDirectory;
    if (previousFlag === undefined) delete process.env.KAI_HOSTING_V2; else process.env.KAI_HOSTING_V2 = previousFlag;
    if (previousLegacyWrites === undefined) delete process.env.KAI_ALLOW_LEGACY_ANON_WRITES; else process.env.KAI_ALLOW_LEGACY_ANON_WRITES = previousLegacyWrites;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("buyer and supplier interfaces expose every API used by the golden loop", () => {
  const sources = [
    "components/supplier-onboarding-form.tsx",
    "components/supply-resource-registration.tsx",
    "components/supply-resource-detail.tsx",
    "components/supply-offer-create.tsx",
    "components/supply-listings-v2.tsx",
    "components/hosting-offer-checkout.tsx",
    "components/hosting-contract-workspace.tsx",
    "components/supply-contracts.tsx",
    "components/supply-contract-detail.tsx",
    "components/supply-earnings.tsx",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  for (const endpoint of [
    "/api/v2/supply/profile",
    "/api/v2/supply/profile/submit",
    "/api/v2/supply/agent-challenges",
    "/api/v2/supply/devices/",
    "/api/v2/supply/policy",
    "/api/v2/supply/offers",
    "/api/v2/contracts",
    "/ssh-key",
    "/start",
    "/stop",
    "/accept",
    "/api/v2/supply/contracts",
    "/api/v2/supply/earnings",
  ]) assert.ok(sources.includes(endpoint), `${endpoint} is not reachable from the interface`);
  assert.doesNotMatch(sources, /\/api\/v1\/lab\/gpu-loop|GpuMarketplaceLab|LOCAL_TEST/u);
});
