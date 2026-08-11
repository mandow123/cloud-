import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";
import { normalizeSshPublicKey } from "../lib/server/ssh-public-key.ts";

const buyer = {
  account: { id: "acct-lifecycle-buyer", displayName: "Lifecycle Buyer", primaryEmail: "buyer@example.com", status: "ACTIVE" },
  activeOrganization: { id: "org-lifecycle-buyer", name: "Lifecycle Buyer", externalKey: "LIFECYCLE_BUYER", status: "ACTIVE" },
  membership: { id: "mbr-lifecycle-buyer", accountId: "acct-lifecycle-buyer", organizationId: "org-lifecycle-buyer", status: "ACTIVE", roles: [] },
  sessionId: "session-lifecycle-buyer",
  authMethod: "KAI_IDENTITY_OIDC",
};

function mutation(key, hash, now) {
  return { actorId: buyer.account.id, idempotencyKey: key, payloadHash: hash, now };
}

function sshString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function testEd25519PublicKey() {
  const blob = Buffer.concat([sshString("ssh-ed25519"), sshString(Buffer.alloc(32, 7))]);
  return `ssh-ed25519 ${blob.toString("base64")} lifecycle-test`;
}

function provisionDetails(endpointDisplay, observedAt) {
  return {
    protocolVersion: 1,
    contractId: "hctr_lifecycle",
    image: process.env.KAI_HOSTING_APPROVED_IMAGES,
    endpointDisplay,
    containerDigest: `sha256:${"6".repeat(64)}`,
    workspaceDigest: `sha256:${"7".repeat(64)}`,
    observedAt,
  };
}

function startDetails(endpointDisplay, observedAt) {
  return {
    protocolVersion: 1,
    contractId: "hctr_lifecycle",
    containerDigest: `sha256:${"8".repeat(64)}`,
    runtimeStateDigest: `sha256:${"9".repeat(64)}`,
    startedAt: observedAt,
    endpointDisplay,
    runtimeStatus: "RUNNING",
    sshBannerDigest: `sha256:${"a".repeat(64)}`,
    observedAt,
  };
}

function stopDetails(startedAt, stoppedAt, runtimeSeconds) {
  return {
    protocolVersion: 1,
    contractId: "hctr_lifecycle",
    containerDigest: `sha256:${"b".repeat(64)}`,
    runtimeStateDigest: `sha256:${"c".repeat(64)}`,
    startedAt,
    stoppedAt,
    runtimeSeconds,
    runtimeStatus: "STOPPED",
    observedAt: stoppedAt,
  };
}

function seedLifecycleContract(path, now) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const inventory = { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: `sha256:${"2".repeat(64)}`, gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen 9 9950X", memoryMiB: 65_536, storageGiB: 2_048, publicHost: "lifecycle-gpu.example.com", sshPortStart: 25_000, sshPortEnd: 25_019 };
  db.prepare(`INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,verified_until,last_sequence,last_seen_at,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED','PASSED',?,?,1,?,1,?,?)`).run("had_lifecycle", "org-lifecycle-supplier", "acct-lifecycle-supplier", "Lifecycle 4090", `sha256:${"3".repeat(64)}`, "A".repeat(43), "1.2.0", JSON.stringify(inventory), `sha256:${"4".repeat(64)}`, `sha256:${"5".repeat(64)}`, new Date(Date.parse(now) + 86_400_000).toISOString(), now, now, now);
  const snapshot = { title: "Lifecycle RTX 4090", gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300 };
  db.prepare(`INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,held_micros,status,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,'CARD_HOURS_HELD',?,?,1,?,?)`).run("hctr_lifecycle", "hofr_lifecycle", "had_lifecycle", buyer.activeOrganization.id, buyer.account.id, "org-lifecycle-supplier", "hfee_lifecycle", JSON.stringify(snapshot), 3_600, 3_600_000, "seed-lifecycle", "seed-lifecycle-hash", now, now);
  db.close();
}

test("SSH provisioning, start and stop remain inside verified device boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-lifecycle-"));
  const path = join(directory, "lifecycle.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const started = new Date();
    const now = started.toISOString();
    seedLifecycleContract(path, now);
    const rawPublicKey = testEd25519PublicKey();
    const key = await normalizeSshPublicKey(rawPublicKey);
    assert.match(key.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/u);
    await assert.rejects(normalizeSshPublicKey(`${rawPublicKey}\nmalicious`), (error) => error.code === "SSH_PUBLIC_KEY_INVALID");

    const provisioning = await store.attachSshKey(buyer.activeOrganization.id, "hctr_lifecycle", key, mutation("lifecycle-ssh-key", "lifecycle-ssh-key-hash", now));
    assert.equal(provisioning.contract.status, "PROVISIONING");
    assert.equal(provisioning.contract.sshPublicKeyFingerprint, key.fingerprint);
    const provisionCommand = await store.pollCommand("had_lifecycle", now);
    assert.equal(provisionCommand.type, "PROVISION");
    await assert.rejects(store.completeCommand("had_lifecycle", provisionCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("attacker.example.com:25000", now) }, mutation("lifecycle-provision-bad", "lifecycle-provision-bad-hash", now)), (error) => error.name === "ExchangeInputError");
    const ready = await store.completeCommand("had_lifecycle", provisionCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("lifecycle-gpu.example.com:25000", now) }, mutation("lifecycle-provision-good", "lifecycle-provision-good-hash", now));
    assert.equal(ready.contract.status, "READY");
    assert.equal(ready.contract.endpointDisplay, "lifecycle-gpu.example.com:25000");

    const start = await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-start", "lifecycle-start-hash", now));
    const startCommand = await store.pollCommand("had_lifecycle", now);
    assert.equal(startCommand.id, start.command.id);
    assert.deepEqual(startCommand.payload, { contractId: "hctr_lifecycle", endpointDisplay: "lifecycle-gpu.example.com:25000" });
    await assert.rejects(store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("attacker.example.com:25000", now) }, mutation("lifecycle-start-bad", "lifecycle-start-bad-hash", now)), (error) => error.name === "ExchangeInputError");
    const running = await store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("lifecycle-start-result", "lifecycle-start-result-hash", now));
    assert.equal(running.contract.status, "IN_SERVICE");

    const stopRequestedAt = new Date(started.getTime() + 600_000).toISOString();
    const stop = await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-stop", "lifecycle-stop-hash", stopRequestedAt));
    const stopCommand = await store.pollCommand("had_lifecycle", stopRequestedAt);
    assert.equal(stopCommand.id, stop.command.id);
    const agentStartedAt = new Date(started.getTime() - 200_000).toISOString();
    await assert.rejects(store.completeCommand("had_lifecycle", stopCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: stopDetails(agentStartedAt, stopRequestedAt, 799) }, mutation("lifecycle-stop-invalid", "lifecycle-stop-invalid-hash", stopRequestedAt)), (error) => error.name === "ExchangeInputError");
    const stopped = await store.completeCommand("had_lifecycle", stopCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: stopDetails(agentStartedAt, stopRequestedAt, 800) }, mutation("lifecycle-stop-result", "lifecycle-stop-result-hash", stopRequestedAt));
    assert.equal(stopped.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal(stopped.contract.measuredSeconds, 600, "supplier Agent cannot bill beyond server wall-clock time");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("instance lifecycle APIs require buyer ownership and never accept client metering", () => {
  const routes = [
    "app/api/v2/contracts/[contractId]/ssh-key/route.ts",
    "app/api/v2/contracts/[contractId]/start/route.ts",
    "app/api/v2/contracts/[contractId]/stop/route.ts",
  ];
  for (const path of routes) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /requireTradingAccountSession\(request\)/u);
    assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
    assert.doesNotMatch(source, /x-kai-workspace-role/u);
  }
  const sshRoute = readFileSync(routes[0], "utf8");
  assert.match(sshRoute, /normalizeSshPublicKey\(body\.publicKey\)/u);
  assert.match(sshRoute, /"fingerprint"/u);
  assert.doesNotMatch(sshRoute.slice(sshRoute.indexOf("return jsonResponse")), /publicKey/u);
  const stopRoute = readFileSync(routes[2], "utf8");
  assert.match(stopRoute, /Object\.keys\(body\)\.length/u);
  assert.match(stopRoute, /buyerOrganizationId !== account\.activeOrganization\.id/u);
  assert.doesNotMatch(stopRoute, /measuredSeconds\s*:/u);
});
