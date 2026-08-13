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
import { checkConnection, completeCommand as completeHostAgentCommand, heartbeat, pairDevice } from "../host-agent/src/client.mjs";
import { digestJson, signedProof } from "../host-agent/src/protocol.mjs";
import { AgentError } from "../host-agent/src/protocol.mjs";

import { GET as openMarketplaceSession } from "../app/api/session/route.ts";
import { PUT as saveSupplierProfile } from "../app/api/v2/supply/profile/route.ts";
import { POST as submitSupplierProfile } from "../app/api/v2/supply/profile/submit/route.ts";
import { POST as issueAgentChallenge } from "../app/api/v2/supply/agent-challenges/route.ts";
import { GET as getAgentChallengeStatus } from "../app/api/v2/supply/agent-challenges/[challengeId]/route.ts";
import { POST as registerHostAgent } from "../app/api/v2/agent/register/route.ts";
import { POST as acceptHostAgentHeartbeat } from "../app/api/v2/agent/devices/[deviceId]/heartbeat/route.ts";
import { POST as completeHostAgentCommandRoute } from "../app/api/v2/agent/devices/[deviceId]/commands/[commandId]/complete/route.ts";
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
import { GET as auditGoldenLoop } from "../app/api/v2/admin/hosting/golden-loop/[contractId]/route.ts";

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
    tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"]
      .map((name, index) => ({ name, status: "PASSED", evidenceDigest: `sha256:${String(index + 1).repeat(64)}`, ...(name === "WORKLOAD_IMAGE" ? { summary: { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: [process.env.KAI_HOSTING_APPROVED_IMAGES], allPresent: true } } : {}), ...(name === "PORT_REACHABILITY" ? { summary: { port: 27_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}) })),
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

async function hostAgentPost(url, body, options = {}) {
  const endpoint = new URL(url);
  const request = new Request(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "KAI-Host-Agent/1.9.5",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
  let response;
  if (endpoint.pathname === "/api/v2/agent/register") {
    response = await registerHostAgent(request);
  } else {
    const heartbeatMatch = /^\/api\/v2\/agent\/devices\/(had_[a-z0-9]+)\/heartbeat$/u.exec(endpoint.pathname);
    const completionMatch = /^\/api\/v2\/agent\/devices\/(had_[a-z0-9]+)\/commands\/(hcmd_[a-z0-9]+)\/complete$/u.exec(endpoint.pathname);
    if (heartbeatMatch) response = await acceptHostAgentHeartbeat(request, { params: Promise.resolve({ deviceId: heartbeatMatch[1] }) });
    else if (completionMatch) response = await completeHostAgentCommandRoute(request, { params: Promise.resolve({ deviceId: completionMatch[1], commandId: completionMatch[2] }) });
    else throw new Error(`Unexpected Host Agent endpoint: ${endpoint.pathname}`);
  }
  const payload = await response.json();
  if (!response.ok) throw new AgentError(payload?.error?.code ?? `HTTP_${response.status}`, payload?.error?.message ?? "Host Agent request failed.");
  return payload;
}

test("fresh supplier and buyer browsers complete the real three-minute GPU lifecycle through V2 APIs", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-golden-loop-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const previousDirectory = process.env.KAI_DB_DIR;
  const previousFlag = process.env.KAI_HOSTING_V2;
  const previousEnvironment = process.env.KAI_ENVIRONMENT;
  const previousLocalAcceptance = process.env.KAI_HOSTING_LOCAL_ACCEPTANCE;
  const previousLegacyWrites = process.env.KAI_ALLOW_LEGACY_ANON_WRITES;
  const previousAccount = globalThis.__kaiAccountAuthStorePromise;
  const previousCardHours = globalThis.__kaiCardHourStorePromise;
  const previousMarketplace = globalThis.__kaiMarketplaceStorePromise;
  process.env.KAI_DB_DIR = directory;
  process.env.KAI_HOSTING_V2 = "1";
  process.env.KAI_ENVIRONMENT = "LOCAL";
  process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = "1";
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
    await hosting.reviewProfile(supplier.context.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "内部真实 GPU 黄金闭环验收", evidenceDigest: "c".repeat(64) }, mutation("golden-admin-reviewer", "golden-profile-approve", now));

    const challenge = await json(await issueAgentChallenge(browserRequest(supplier, "/api/v2/supply/agent-challenges", "POST", {}, "golden-agent-challenge")), 201);
    const agentStateFile = join(directory, "golden-host-agent", "identity.json");
    const paired = await pairDevice({
      bundle: {
        version: 1,
        registerEndpoint: `${ORIGIN}/api/v2/agent/register`,
        challengeId: challenge.record.id,
        nonce: challenge.record.nonce,
        minimumAgentVersion: challenge.record.minimumAgentVersion,
        expiresAt: challenge.record.expiresAt,
      },
      displayName: "黄金闭环 RTX 4090",
      publicHost: "golden-loop-gpu.example.com",
      sshPortStart: 27_000,
      sshPortEnd: 27_019,
      stateFile: agentStateFile,
      allowInsecureLocal: true,
      inventoryCollector: async () => inventory(),
      post: hostAgentPost,
    });
    const device = await hosting.getDevice(paired.deviceId);
    assert.ok(device);
    const inventoryDigest = device.inventoryDigest;
    assert.equal((await hosting.getAgentRegistration(supplier.context.activeOrganization.id, challenge.record.id))?.device?.id, device.id);
    const registeredStatus = await json(await getAgentChallengeStatus(browserRead(supplier, `/api/v2/supply/agent-challenges/${challenge.record.id}`), { params: Promise.resolve({ challengeId: challenge.record.id }) }), 200);
    assert.equal(registeredStatus.record.device.id, device.id);
    assert.equal(registeredStatus.record.device.lastSequence, 0);
    assert.equal(registeredStatus.record.device.lastSeenAt, null);
    assert.equal("nonce" in registeredStatus.record, false);
    assert.equal("organizationId" in registeredStatus.record.device, false);
    const crossOrganizationStatus = await json(await getAgentChallengeStatus(browserRead(buyer, `/api/v2/supply/agent-challenges/${challenge.record.id}`), { params: Promise.resolve({ challengeId: challenge.record.id }) }), 404);
    assert.equal(crossOrganizationStatus.error.code, "HOSTING_AGENT_CHALLENGE_NOT_FOUND");
    const connection = await checkConnection({ stateFile: agentStateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory(), post: hostAgentPost });
    assert.equal(connection.capacityState, "OFFLINE");
    const checkedStatus = await json(await getAgentChallengeStatus(browserRead(supplier, `/api/v2/supply/agent-challenges/${challenge.record.id}`), { params: Promise.resolve({ challengeId: challenge.record.id }) }), 200);
    assert.equal(checkedStatus.record.device.status, "OFFLINE");
    assert.equal(checkedStatus.record.device.lastSequence, 1);
    const liveHeartbeat = await heartbeat({ stateFile: agentStateFile, allowInsecureLocal: true, inventoryCollector: async () => inventory(), post: hostAgentPost });
    assert.equal(liveHeartbeat.capacityState, "ONLINE");
    const onlineStatus = await json(await getAgentChallengeStatus(browserRead(supplier, `/api/v2/supply/agent-challenges/${challenge.record.id}`), { params: Promise.resolve({ challengeId: challenge.record.id }) }), 200);
    assert.equal(onlineStatus.record.device.status, "ONLINE");
    assert.equal(onlineStatus.record.device.lastSequence, 2);
    assert.ok(Date.parse(onlineStatus.record.device.lastSeenAt) >= Date.parse(now));
    const queuedVerification = await json(await queueDeviceVerification(browserRequest(supplier, `/api/v2/supply/devices/${device.id}/verify`, "POST", {}, "golden-device-verify"), { params: Promise.resolve({ deviceId: device.id }) }), 201);
    const verificationCommand = await hosting.pollCommand(device.id, now);
    assert.equal(verificationCommand.id, queuedVerification.record.id);
    const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: verificationCommand.id, publicHost: device.inventory.publicHost, publicPort: device.inventory.sshPortStart, challenge: verificationCommand.payload.reachabilityChallenge });
    const verificationEvidence = verificationDetails(inventoryDigest, now, challengeDigest);
    const verificationInput = { outcome: "SUCCEEDED", evidenceDigest: digestJson(verificationEvidence), errorCode: null, details: verificationEvidence };
    const verificationProof = await signedProof(paired.state.privateKeyPkcs8, "COMPLETE_COMMAND", device.id, { commandId: verificationCommand.id, ...verificationInput }, new Date(now));
    const verificationSignedPayload = { operation: "COMPLETE_COMMAND", deviceId: device.id, commandId: verificationCommand.id, ...verificationInput, issuedAt: verificationProof.issuedAt, expiresAt: verificationProof.expiresAt };
    await hosting.completeCommand(device.id, verificationCommand.id, { ...verificationInput, controlPlaneReachabilityDigest: challengeDigest, transportAttestation: { signedPayload: verificationSignedPayload, signature: verificationProof.signature } }, mutation(`agent:${device.id}`, "golden-verify-result", now));
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
    const incompleteAudit = await hosting.auditGoldenLoop(contractId, now);
    assert.equal(incompleteAudit.verdict, "FAIL");
    assert.equal(incompleteAudit.checks.find((check) => check.key === "delivery")?.status, "FAIL");
    const ssh = await json(await attachBuyerSshKey(browserRequest(buyer, `/api/v2/contracts/${contractId}/ssh-key`, "POST", { publicKey: publicKey() }, "golden-contract-ssh"), { params: Promise.resolve({ contractId }) }), 202);
    assert.equal(ssh.record.status, "PROVISIONING");
    const provisionCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(provisionCommand.type, "PROVISION");
    const provisionedAt = new Date().toISOString();
    const provisionEvidence = provisionDetails(contractId, process.env.KAI_HOSTING_APPROVED_IMAGES, provisionedAt);
    await completeHostAgentCommand(provisionCommand, { outcome: "SUCCEEDED", evidenceDigest: digestJson(provisionEvidence), details: provisionEvidence }, { stateFile: agentStateFile, allowInsecureLocal: true, post: hostAgentPost });

    const start = await json(await startBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/start`, "POST", {}, "golden-contract-start"), { params: Promise.resolve({ contractId }) }), 202);
    const startCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(startCommand.id, start.operation.commandId);
    const startedAt = new Date().toISOString();
    const startEvidence = startDetails(contractId, startedAt);
    await completeHostAgentCommand(startCommand, { outcome: "SUCCEEDED", evidenceDigest: digestJson(startEvidence), details: startEvidence }, { stateFile: agentStateFile, allowInsecureLocal: true, post: hostAgentPost });

    const stop = await json(await stopBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/stop`, "POST", {}, "golden-contract-stop"), { params: Promise.resolve({ contractId }) }), 202);
    const stopCommand = await hosting.pollCommand(device.id, new Date().toISOString());
    assert.equal(stopCommand.id, stop.operation.commandId);
    const stoppedAt = new Date().toISOString();
    const stopEvidence = stopDetails(contractId, startedAt, stoppedAt);
    await completeHostAgentCommand(stopCommand, { outcome: "SUCCEEDED", evidenceDigest: digestJson(stopEvidence), details: stopEvidence }, { stateFile: agentStateFile, allowInsecureLocal: true, post: hostAgentPost });
    const stopped = await hosting.contractForViewer(buyer.context.activeOrganization.id, contractId);
    assert.equal(stopped.status, "AWAITING_ACCEPTANCE");
    assert.equal(stopped.measuredSeconds, 180, "the platform enforces the published three-minute minimum");

    const accepted = await json(await acceptBuyerContract(browserRequest(buyer, `/api/v2/contracts/${contractId}/accept`, "POST", {}, "golden-contract-accept"), { params: Promise.resolve({ contractId }) }), 202);
    assert.equal(accepted.record.status, "CLEANING");
    assert.deepEqual(accepted.settlement, { heldMicros: 180_000, settledMicros: 180_000, releasedMicros: 0, supplierIncomeMicros: 162_000, commissionMicros: 5_400, platformFeeMicros: 18_000 });
    const heartbeatAt = new Date().toISOString();
    await hosting.acceptHeartbeat(device.id, { sequence: 3, inventoryDigest, capacityState: "BUSY", observedAt: heartbeatAt }, mutation(`agent:${device.id}`, "golden-heartbeat-3", heartbeatAt));
    const cleanupCommand = await hosting.pollCommand(device.id, heartbeatAt);
    assert.equal(cleanupCommand.type, "CLEANUP");
    const cleanedAt = new Date().toISOString();
    const cleanupEvidence = cleanupDetails(contractId, cleanedAt);
    const cleanupEvidenceDigest = digestJson(cleanupEvidence);
    await completeHostAgentCommand(cleanupCommand, { outcome: "SUCCEEDED", evidenceDigest: cleanupEvidenceDigest, details: cleanupEvidence }, { stateFile: agentStateFile, allowInsecureLocal: true, post: hostAgentPost });
    const cleaned = await hosting.contractForViewer(supplier.context.activeOrganization.id, contractId);
    assert.equal(cleaned.status, "CLEANED");
    assert.equal((await hosting.getDevice(device.id)).status, "VERIFIED");

    const buyerDetail = await json(await getBuyerContract(browserRead(buyer, `/api/v2/contracts/${contractId}`), { params: Promise.resolve({ contractId }) }), 200);
    assert.equal(buyerDetail.record.evidence.instance.status, "CLEANED");
    assert.equal(buyerDetail.record.evidence.metering.serverMeasuredSeconds, 180);
    assert.deepEqual({ container: buyerDetail.record.evidence.cleanup.containerRemoved, key: buyerDetail.record.evidence.cleanup.authorizedKeyRemoved, workspace: buyerDetail.record.evidence.cleanup.workspaceRemoved }, { container: true, key: true, workspace: true });
    assert.equal("supplierOrganizationId" in buyerDetail.record, false);

    const supplierDetail = await json(await getSupplierContract(browserRead(supplier, `/api/v2/supply/contracts/${contractId}`), { params: Promise.resolve({ contractId }) }), 200);
    assert.equal(supplierDetail.record.evidence.cleanup.evidenceDigest, cleanupEvidenceDigest);
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
    assert.equal(operations.schemaVersion, 11);
    assert.match(operations.activeFeeScheduleId, /^hfee_/u);
    assert.deepEqual({
      approvedSupplierCount: operations.approvedSupplierCount,
      activeAgentCount: operations.activeAgentCount,
      drainingDeviceCount: operations.drainingDeviceCount,
      failedCleanupCount: operations.failedCleanupCount,
      cleaningContractCount: operations.cleaningContractCount,
    }, { approvedSupplierCount: 1, activeAgentCount: 1, drainingDeviceCount: 0, failedCleanupCount: 0, cleaningContractCount: 0 });
    const audit = await hosting.auditGoldenLoop(contractId, cleanedAt);
    assert.equal(audit.verdict, "PASS", JSON.stringify(audit.checks.filter((check) => check.status === "FAIL")));
    assert.equal(audit.passedChecks, audit.totalChecks);
    assert.equal(audit.totalChecks, 13);

    const rootSeed = await auth.resolveOrCreatePasswordAdministrator({ username: "golden-root", displayName: "黄金订单验收管理员", createdAt: cleanedAt });
    await auth.activateMembership(rootSeed.membership.id, ["ROOT"], cleanedAt);
    const root = await auth.resolveOrCreatePasswordAdministrator({ username: "golden-root", displayName: "黄金订单验收管理员", createdAt: cleanedAt });
    const rootSession = await createAccountSession(new Request(`${ORIGIN}/api/auth/admin/password`), root, "ADMIN_PASSWORD", { store: auth, now: new Date(cleanedAt) });
    const auditResponse = await json(await auditGoldenLoop(new Request(`${ORIGIN}/api/v2/admin/hosting/golden-loop/${contractId}`, { headers: { cookie: rootSession.cookie.split(";", 1)[0] } }), { params: Promise.resolve({ contractId }) }), 200);
    assert.equal(auditResponse.record.verdict, "PASS");
    assert.equal(auditResponse.record.checks.length, 13);
  } finally {
    globalThis.__kaiAccountAuthStorePromise = previousAccount;
    globalThis.__kaiCardHourStorePromise = previousCardHours;
    globalThis.__kaiMarketplaceStorePromise = previousMarketplace;
    if (typeof cardHours.close === "function") await cardHours.close();
    if (typeof hosting.close === "function") await hosting.close();
    auth.close();
    if (previousDirectory === undefined) delete process.env.KAI_DB_DIR; else process.env.KAI_DB_DIR = previousDirectory;
    if (previousFlag === undefined) delete process.env.KAI_HOSTING_V2; else process.env.KAI_HOSTING_V2 = previousFlag;
    if (previousEnvironment === undefined) delete process.env.KAI_ENVIRONMENT; else process.env.KAI_ENVIRONMENT = previousEnvironment;
    if (previousLocalAcceptance === undefined) delete process.env.KAI_HOSTING_LOCAL_ACCEPTANCE; else process.env.KAI_HOSTING_LOCAL_ACCEPTANCE = previousLocalAcceptance;
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

  const admin = readFileSync("components/admin-hosting-operations.tsx", "utf8");
  assert.match(admin, /\/api\/v2\/admin\/hosting\/golden-loop\//u);
  assert.match(admin, /真实 GPU 黄金订单验收/u);
  assert.match(admin, /goldenAudit\.checks\.map/u);
});
