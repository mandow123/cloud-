import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseAgentProof, parseHostingDeviceInventory, verifyExistingDeviceProof } from "../lib/server/hosting-agent-api.ts";
import { hostingAgentCanonicalJson, hostingAgentDigest, hostingAgentKeyId, verifyHostingAgentSignature } from "../lib/server/hosting-agent-crypto.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const account = {
  account: { id: "acct-agent-supplier", displayName: "Agent Supplier", primaryEmail: "agent@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-agent-supplier", name: "Agent Supplier", externalKey: "AGENT_SUPPLIER", status: "ACTIVE" },
  membership: { id: "mbr-agent-supplier", accountId: "acct-agent-supplier", organizationId: "org-agent-supplier", status: "ACTIVE", roles: [] },
  sessionId: "session-agent-supplier",
  authMethod: "KAI_IDENTITY_OIDC",
};

function mutation(actorId, key, hash, now = new Date().toISOString()) {
  return { actorId, idempotencyKey: key, payloadHash: hash, now };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

async function sign(privateKey, payload) {
  return base64url(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(hostingAgentCanonicalJson(payload))));
}

async function approvedSupplier(store, now) {
  await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 供应方", contactEmail: "agent@example.com", expectedVersion: 0 }, mutation(account.account.id, "agent-profile-save", "agent-profile-save-hash", now));
  await store.submitProfile(account.activeOrganization.id, 1, mutation(account.account.id, "agent-profile-submit", "agent-profile-submit-hash", now));
  await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "内部设备验真测试通过" }, mutation("admin-agent-reviewer", "agent-profile-review", "agent-profile-review-hash", now));
}

test("signed Host Agent registration, heartbeat and verification close without replay", async () => {
  const store = await createSqliteHostingV2Store(":memory:");
  try {
    const now = new Date();
    await approvedSupplier(store, now.toISOString());
    const challenge = await store.issueAgentChallenge(account, mutation(account.account.id, "agent-challenge-0001", "agent-challenge-hash", now.toISOString()));
    const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const devicePublicKey = base64url(await crypto.subtle.exportKey("raw", keys.publicKey));
    const inventory = parseHostingDeviceInventory({
      hostnameDigest: `sha256:${"1".repeat(64)}`,
      gpuModel: "RTX_4090",
      gpuUuidDigest: `sha256:${"2".repeat(64)}`,
      gpuMemoryMiB: 24_576,
      driverVersion: "580.10",
      cudaVersion: "13.0",
      cpuModel: "AMD Ryzen 9 9950X",
      memoryMiB: 65_536,
      storageGiB: 2_048,
      publicHost: "gpu-4090.example.com",
      sshPortStart: 22_000,
      sshPortEnd: 22_019,
    });
    const inventoryDigest = await hostingAgentDigest(inventory);
    const issuedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    const registration = { operation: "REGISTER_DEVICE", challengeId: challenge.id, nonce: challenge.nonce, displayName: "4090 工作站 01", devicePublicKey, agentVersion: "1.0.0", inventory, inventoryDigest, issuedAt, expiresAt };
    const registrationSignature = await sign(keys.privateKey, registration);
    await verifyHostingAgentSignature(devicePublicKey, registration, registrationSignature);
    await assert.rejects(verifyHostingAgentSignature(devicePublicKey, { ...registration, displayName: "tampered" }, registrationSignature), (error) => error.code === "AGENT_SIGNATURE_INVALID");

    const device = await store.registerDevice(challenge.id, { displayName: registration.displayName, deviceKeyId: await hostingAgentKeyId(devicePublicKey), devicePublicKey, agentVersion: registration.agentVersion, inventory, inventoryDigest }, mutation(`agent:${await hostingAgentKeyId(devicePublicKey)}`, "agent-register-0001", await hostingAgentDigest(registration), now.toISOString()));
    assert.equal(device.verificationStatus, "NOT_RUN");
    await assert.rejects(store.registerDevice(challenge.id, { displayName: registration.displayName, deviceKeyId: await hostingAgentKeyId(devicePublicKey), devicePublicKey, agentVersion: registration.agentVersion, inventory, inventoryDigest }, mutation("other-agent", "agent-register-replay", "other-registration", now.toISOString())), (error) => error.code === "EXCHANGE_STATE_CONFLICT");

    const heartbeatFields = { sequence: 1, inventoryDigest, capacityState: "ONLINE", observedAt: now.toISOString() };
    const heartbeatProof = parseAgentProof({ issuedAt, expiresAt, signature: await sign(keys.privateKey, { operation: "HEARTBEAT", deviceId: device.id, ...heartbeatFields, issuedAt, expiresAt }) }, now);
    await verifyExistingDeviceProof(device, "HEARTBEAT", heartbeatFields, heartbeatProof);
    await store.acceptHeartbeat(device.id, heartbeatFields, mutation(`agent:${device.id}`, "heartbeat:1", await hostingAgentDigest(heartbeatFields), now.toISOString()));
    await assert.rejects(store.acceptHeartbeat(device.id, heartbeatFields, mutation(`agent:${device.id}`, "heartbeat:1", await hostingAgentDigest(heartbeatFields), now.toISOString())), (error) => error.code === "EXCHANGE_STATE_CONFLICT");

    const queued = await store.queueVerification(account.activeOrganization.id, device.id, mutation(account.account.id, "verify-device-0001", "verify-device-hash", now.toISOString()));
    const command = await store.pollCommand(device.id, now.toISOString());
    assert.equal(command.id, queued.id);
    assert.equal(command.type, "VERIFY");
    const completed = await store.completeCommand(device.id, command.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"3".repeat(64)}`, details: { testsPassed: 6 } }, mutation(`agent:${device.id}`, `command:${command.id}:SUCCEEDED`, "verify-result-hash", now.toISOString()));
    assert.equal(completed.device.status, "VERIFIED");
    assert.equal(completed.device.verificationStatus, "PASSED");
    assert.equal((await store.dashboard(account.activeOrganization.id, now.toISOString())).readiness.onlineVerifiedDevices, 1);
  } finally {
    store.close();
  }
});

test("agent routes require signed device proofs and never accept workspace roles", () => {
  const agentRoutes = [
    "app/api/v2/agent/register/route.ts",
    "app/api/v2/agent/devices/[deviceId]/heartbeat/route.ts",
    "app/api/v2/agent/devices/[deviceId]/commands/poll/route.ts",
    "app/api/v2/agent/devices/[deviceId]/commands/[commandId]/complete/route.ts",
  ];
  for (const path of agentRoutes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireHostingV2Enabled\(\)/u);
    assert.match(source, /requireHostingAgentTransport\(request\)/u);
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
  assert.match(readFileSync(agentRoutes[0], "utf8"), /verifyHostingAgentSignature\(/u);
  for (const path of agentRoutes.slice(1)) assert.match(readFileSync(path, "utf8"), /verifyExistingDeviceProof\(/u);

  for (const path of ["app/api/v2/supply/agent-challenges/route.ts", "app/api/v2/supply/devices/[deviceId]/verify/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
});
