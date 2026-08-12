import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { parseAgentProof, parseHostingDeviceInventory, verifyExistingDeviceProof } from "../lib/server/hosting-agent-api.ts";
import { hostingAgentCanonicalJson, hostingAgentDigest, hostingAgentKeyId, verifyHostingAgentSignature } from "../lib/server/hosting-agent-crypto.ts";
import { verifyControlPlaneReachability } from "../lib/server/hosting-agent-reachability.ts";
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

function successfulVerificationDetails(inventoryDigest, observedAt, challengeDigest) {
  const tests = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest,
    observedAt,
    tests: tests.map((name, index) => ({
      name,
      status: "PASSED",
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
      ...(name === "PORT_REACHABILITY" ? { summary: { port: 22_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}),
    })),
  };
}

async function sign(privateKey, payload) {
  return base64url(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(hostingAgentCanonicalJson(payload))));
}

async function approvedSupplier(store, now) {
  await store.saveProfile(account, { supplierType: "INDIVIDUAL", legalDisplayName: "个人 4090 供应方", contactEmail: "agent@example.com", expectedVersion: 0 }, mutation(account.account.id, "agent-profile-save", "agent-profile-save-hash", now));
  await store.submitProfile(account.activeOrganization.id, 1, process.env.KAI_HOSTING_TERMS_VERSION, mutation(account.account.id, "agent-profile-submit", "agent-profile-submit-hash", now));
  await store.reviewProfile(account.activeOrganization.id, { decision: "APPROVE", expectedVersion: 2, reviewNote: "内部设备验真测试通过" }, mutation("admin-agent-reviewer", "agent-profile-review", "agent-profile-review-hash", now));
}

test("signed Host Agent registration, heartbeat and verification close without replay", async () => {
  const store = await createSqliteHostingV2Store(":memory:");
  try {
    const now = new Date();
    await approvedSupplier(store, now.toISOString());
    const challenge = await store.issueAgentChallenge(account, mutation(account.account.id, "agent-challenge-0001", "agent-challenge-hash", now.toISOString()));
    assert.equal(challenge.minimumAgentVersion, "1.8.0");
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
    const registration = { operation: "REGISTER_DEVICE", challengeId: challenge.id, nonce: challenge.nonce, displayName: "4090 工作站 01", devicePublicKey, agentVersion: "1.8.0", inventory, inventoryDigest, issuedAt, expiresAt };
    const registrationSignature = await sign(keys.privateKey, registration);
    await verifyHostingAgentSignature(devicePublicKey, registration, registrationSignature);
    await assert.rejects(verifyHostingAgentSignature(devicePublicKey, { ...registration, displayName: "tampered" }, registrationSignature), (error) => error.code === "AGENT_SIGNATURE_INVALID");
    await assert.rejects(
      store.registerDevice(challenge.id, { displayName: registration.displayName, deviceKeyId: await hostingAgentKeyId(devicePublicKey), devicePublicKey, agentVersion: "1.5.0", inventory, inventoryDigest }, mutation(`agent:${await hostingAgentKeyId(devicePublicKey)}`, "agent-register-old-version", "agent-register-old-version-hash", now.toISOString())),
      (error) => error.code === "HOSTING_AGENT_UPGRADE_REQUIRED" && error.status === 409,
    );

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
    assert.equal(await store.pollCommand(device.id, new Date(now.getTime() + 30_000).toISOString()), null);
    const redelivered = await store.pollCommand(device.id, new Date(now.getTime() + 61_000).toISOString());
    assert.equal(redelivered.id, command.id);
    assert.equal(redelivered.attempt, 2);
    await assert.rejects(
      store.completeCommand(device.id, command.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"3".repeat(64)}`, details: { tests: [] } }, mutation(`agent:${device.id}`, `command:${command.id}:invalid`, "verify-invalid-hash", new Date(now.getTime() + 61_000).toISOString())),
      (error) => error.name === "ExchangeInputError",
    );
    const challengeDigest = await hostingAgentDigest({ protocolVersion: 1, deviceId: device.id, commandId: command.id, publicHost: inventory.publicHost, publicPort: inventory.sshPortStart, challenge: command.payload.reachabilityChallenge });
    const completed = await store.completeCommand(device.id, command.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"3".repeat(64)}`, controlPlaneReachabilityDigest: challengeDigest, details: successfulVerificationDetails(inventoryDigest, new Date(now.getTime() + 61_000).toISOString(), challengeDigest) }, mutation(`agent:${device.id}`, `command:${command.id}:SUCCEEDED`, "verify-result-hash", new Date(now.getTime() + 61_000).toISOString()));
    assert.equal(completed.device.status, "VERIFIED");
    assert.equal(completed.device.verificationStatus, "PASSED");
    assert.equal((await store.dashboard(account.activeOrganization.id, now.toISOString())).readiness.onlineVerifiedDevices, 1);
  } finally {
    store.close();
  }
});

test("control-plane reachability pins a public address and binds the one-time challenge", async () => {
  const device = { id: "had_reachability", inventory: { publicHost: "gpu.example.com", sshPortStart: 22_000 } };
  const command = { id: "hcmd_reachability", payload: { reachabilityChallenge: "a".repeat(32) } };
  const reads = [];
  const digest = await verifyControlPlaneReachability(device, command, {
    resolveAddresses: async () => [{ address: "203.0.114.10", family: 4 }],
    readResponse: async (...args) => reads.push(args),
  });
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(reads, [["203.0.114.10", 4, 22_000, `KAI-HOST-VERIFY/1 ${"a".repeat(32)}\n`]]);

  await assert.rejects(verifyControlPlaneReachability({ ...device, inventory: { ...device.inventory, publicHost: "127.0.0.1" } }, command), (error) => error.code === "AGENT_PUBLIC_HOST_NOT_GLOBAL");
  await assert.rejects(verifyControlPlaneReachability(device, { ...command, payload: { reachabilityChallenge: "invalid" } }), (error) => error.code === "AGENT_REACHABILITY_CHALLENGE_INVALID");
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
    assert.match(source, /requireHostingV2SetupEnabled\(\)/u);
    assert.match(source, /requireHostingAgentTransport\(request\)/u);
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
  assert.match(readFileSync(agentRoutes[0], "utf8"), /verifyHostingAgentSignature\(/u);
  for (const path of agentRoutes.slice(1)) assert.match(readFileSync(path, "utf8"), /verifyExistingDeviceProof\(/u);
  assert.match(readFileSync(agentRoutes[3], "utf8"), /AGENT_EVIDENCE_DIGEST_MISMATCH/u);
  assert.match(readFileSync(agentRoutes[2], "utf8"), /\["VERIFY", "STOP", "CLEANUP"\]/u);
  assert.match(readFileSync(agentRoutes[3], "utf8"), /HOSTING_V2_TRADING_DISABLED/u);

  for (const path of ["app/api/v2/supply/agent-challenges/route.ts", "app/api/v2/supply/devices/[deviceId]/verify/route.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
});

test("setup-mode Agent polling leases only verification and safe shutdown commands", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-setup-filter-"));
  const path = join(directory, "hosting.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    const now = new Date().toISOString();
    // Command filtering is performed inside the store transaction so a setup Agent cannot lease provisioning work.
    db.prepare("INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,last_sequence,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'ONLINE','PENDING',0,1,?,?)").run("had_setup_filter", "org-setup", "acct-setup", "Setup Agent", `sha256:${"1".repeat(64)}`, "A".repeat(43), "1.3.0", JSON.stringify({}), `sha256:${"2".repeat(64)}`, now, now);
    db.prepare("INSERT INTO hosting_v2_agent_commands(id,device_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?, 'PROVISION','{}','PENDING',0,?)").run("hcmd_setup_provision", "had_setup_filter", now);
    db.prepare("INSERT INTO hosting_v2_agent_commands(id,device_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?, 'VERIFY','{}','PENDING',0,?)").run("hcmd_setup_verify", "had_setup_filter", now);
    db.close();
    const command = await store.pollCommand("had_setup_filter", now, ["VERIFY", "STOP", "CLEANUP"]);
    assert.equal(command?.type, "VERIFY");
    assert.equal((await store.getCommand("had_setup_filter", "hcmd_setup_provision"))?.status, "PENDING");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
