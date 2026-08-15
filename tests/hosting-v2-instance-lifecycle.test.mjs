import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";
import { normalizeSshPublicKey } from "../lib/server/ssh-public-key.ts";
import { reconcileFailedHostingStop } from "../lib/server/hosting-stop-recovery-service.ts";

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
    containerDigest: `sha256:${"6".repeat(64)}`,
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
    containerDigest: `sha256:${"6".repeat(64)}`,
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
    VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED','PASSED',?,?,1,?,1,?,?)`).run("had_lifecycle", "org-lifecycle-supplier", "acct-lifecycle-supplier", "Lifecycle 4090", `sha256:${"3".repeat(64)}`, "A".repeat(43), "1.9.6", JSON.stringify(inventory), `sha256:${"4".repeat(64)}`, `sha256:${"5".repeat(64)}`, new Date(Date.parse(now) + 86_400_000).toISOString(), now, now, now);
  const snapshot = { title: "Lifecycle RTX 4090", gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300, acceptanceWindowSeconds: 1_800 };
  db.prepare(`INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
    VALUES('hofr_lifecycle','org-lifecycle-supplier','had_lifecycle','hfee_lifecycle','Lifecycle RTX 4090','RTX_4090','中国·北京',3600000,180,3600,?,?,?,'KAI_HOSTING_TERMS_2026_08','RESERVED',2,?,?)`).run(new Date(Date.parse(now) - 60_000).toISOString(), new Date(Date.parse(now) + 86_400_000).toISOString(), process.env.KAI_HOSTING_APPROVED_IMAGES, now, now);
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
    assert.equal((await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle")).instance.status, "READY");

    const start = await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-start", "lifecycle-start-hash", now));
    const duplicateStart = await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-start-second-tab", "lifecycle-start-second-tab-hash", now));
    assert.equal(duplicateStart.command.id, start.command.id, "a second tab must reuse the pending START command");
    const startCommand = await store.pollCommand("had_lifecycle", now);
    assert.equal(startCommand.id, start.command.id);
    assert.deepEqual(startCommand.payload, { contractId: "hctr_lifecycle", endpointDisplay: "lifecycle-gpu.example.com:25000" });
    await assert.rejects(store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("attacker.example.com:25000", now) }, mutation("lifecycle-start-bad", "lifecycle-start-bad-hash", now)), (error) => error.name === "ExchangeInputError");
    await assert.rejects(store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: { ...startDetails("lifecycle-gpu.example.com:25000", now), containerDigest: `sha256:${"f".repeat(64)}` } }, mutation("lifecycle-start-wrong-container", "lifecycle-start-wrong-container-hash", now)), (error) => error.name === "ExchangeInputError");
    const running = await store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("lifecycle-start-result", "lifecycle-start-result-hash", now));
    assert.equal(running.contract.status, "IN_SERVICE");

    const stopRequestedAt = new Date(started.getTime() + 600_000).toISOString();
    const stop = await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-stop", "lifecycle-stop-hash", stopRequestedAt));
    const duplicateStop = await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("lifecycle-stop-second-tab", "lifecycle-stop-second-tab-hash", stopRequestedAt));
    assert.equal(duplicateStop.command.id, stop.command.id, "a second tab must reuse the pending STOP command");
    const stopCommand = await store.pollCommand("had_lifecycle", stopRequestedAt);
    assert.equal(stopCommand.id, stop.command.id);
    const pendingEvidence = await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle");
    assert.deepEqual({ status: pendingEvidence.runtimeControl.stopCommandStatus, attempt: pendingEvidence.runtimeControl.stopAttempt, lastSeenAt: pendingEvidence.runtimeControl.agentLastSeenAt }, { status: "DELIVERED", attempt: 1, lastSeenAt: now });
    const agentStartedAt = new Date(started.getTime() - 200_000).toISOString();
    await assert.rejects(store.completeCommand("had_lifecycle", stopCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: stopDetails(agentStartedAt, stopRequestedAt, 799) }, mutation("lifecycle-stop-invalid", "lifecycle-stop-invalid-hash", stopRequestedAt)), (error) => error.name === "ExchangeInputError");
    const stopped = await store.completeCommand("had_lifecycle", stopCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: stopDetails(agentStartedAt, stopRequestedAt, 800) }, mutation("lifecycle-stop-result", "lifecycle-stop-result-hash", stopRequestedAt));
    assert.equal(stopped.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal(stopped.contract.measuredSeconds, 600, "supplier Agent cannot bill beyond server wall-clock time");
    const evidence = await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle");
    assert.equal(evidence.instance.status, "STOPPED");
    assert.equal(evidence.instance.containerDigest, `sha256:${"6".repeat(64)}`);
    assert.deepEqual({ agent: evidence.metering.agentRuntimeSeconds, server: evidence.metering.serverMeasuredSeconds }, { agent: 800, server: 600 });
    assert.equal(evidence.runtimeControl.stopCommandStatus, "SUCCEEDED");
    assert.equal(await store.contractEvidenceForViewer("org-not-owner", "hctr_lifecycle"), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("expired contracts queue one automatic STOP without buyer interaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-expiry-"));
  const path = join(directory, "expiry.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const started = new Date("2026-08-11T08:00:00.000Z");
    const now = started.toISOString();
    seedLifecycleContract(path, now);
    const rawPublicKey = testEd25519PublicKey();
    const key = await normalizeSshPublicKey(rawPublicKey);
    const provisioning = await store.attachSshKey(buyer.activeOrganization.id, "hctr_lifecycle", key, mutation("expiry-ssh-key", "expiry-ssh-key-hash", now));
    const provisionCommand = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", provisionCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("lifecycle-gpu.example.com:25000", now) }, mutation("expiry-provision", "expiry-provision-hash", now));
    await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("expiry-start", "expiry-start-hash", now));
    const startCommand = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", startCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("expiry-start-result", "expiry-start-result-hash", now));

    assert.equal(await store.pollCommand("had_lifecycle", new Date(started.getTime() + 3_599_000).toISOString()), null, "lease must not stop early");
    assert.equal(await store.pollCommand("had_lifecycle", new Date(started.getTime() + 3_600_000).toISOString(), ["VERIFY"]), null, "setup filters must not queue a STOP they cannot deliver");
    const expiredAt = new Date(started.getTime() + 3_600_000).toISOString();
    const stop = await store.pollCommand("had_lifecycle", expiredAt, ["STOP"]);
    assert.equal(stop.type, "STOP");
    assert.deepEqual(stop.payload, { contractId: "hctr_lifecycle", startedAt: now, maximumSeconds: 3_600 });
    const replay = await store.pollCommand("had_lifecycle", new Date(started.getTime() + 3_661_000).toISOString(), ["STOP"]);
    assert.equal(replay.id, stop.id, "lease redelivery must reuse the same automatic STOP");

    const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='STOP'").get("hctr_lifecycle").count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM hosting_v2_events WHERE entity_id=? AND event_type='LEASE_EXPIRED_STOP_QUEUED'").get("hctr_lifecycle").count, 1);
    db.close();
    assert.equal(provisioning.contract.status, "PROVISIONING");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an offline Agent cannot settle or relist and resumes only with watchdog stop proof", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-agent-offline-"));
  const path = join(directory, "agent-offline.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const started = new Date("2026-08-11T08:00:00.000Z");
    const now = started.toISOString();
    seedLifecycleContract(path, now);
    const key = await normalizeSshPublicKey(testEd25519PublicKey());
    await store.attachSshKey(buyer.activeOrganization.id, "hctr_lifecycle", key, mutation("offline-ssh", "offline-ssh-hash", now));
    const provision = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", provision.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("lifecycle-gpu.example.com:25000", now) }, mutation("offline-provision", "offline-provision-hash", now));
    await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("offline-start", "offline-start-hash", now));
    const start = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", start.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("offline-start-result", "offline-start-result-hash", now));

    const stoppedAt = new Date(started.getTime() + 3_600_000).toISOString();
    await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("offline-stop", "offline-stop-hash", stoppedAt));
    const originalStop = await store.pollCommand("had_lifecycle", stoppedAt);
    assert.equal(originalStop.type, "STOP");

    const returnedAt = new Date(started.getTime() + 3_900_000).toISOString();
    const whileOffline = await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle");
    assert.equal((await store.contractForViewer(buyer.activeOrganization.id, "hctr_lifecycle")).status, "IN_SERVICE");
    assert.equal(whileOffline.runtimeControl.stopCommandStatus, "DELIVERED");
    assert.equal(whileOffline.metering, null, "no Agent proof means no metering or supplier settlement");
    assert.equal((await store.getOffer("hofr_lifecycle")).status, "RESERVED", "offline inventory cannot return to market");
    assert.equal((await store.readiness(returnedAt)).activeAgentCount, 0, "a stale Agent fails readiness instead of appearing online");

    await store.acceptHeartbeat("had_lifecycle", { sequence: 2, inventoryDigest: `sha256:${"4".repeat(64)}`, capacityState: "BUSY", observedAt: returnedAt }, mutation("agent:had_lifecycle", "offline-heartbeat-2", "offline-heartbeat-2-hash", returnedAt));
    const redelivered = await store.pollCommand("had_lifecycle", returnedAt, ["STOP"]);
    assert.equal(redelivered.id, originalStop.id, "returning Agent must resume the original signed STOP command");
    const watchdogProof = { ...stopDetails(now, stoppedAt, 3_600), observedAt: returnedAt };
    const recovered = await store.completeCommand("had_lifecycle", redelivered.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"e".repeat(64)}`, details: watchdogProof }, mutation("offline-stop-result", "offline-stop-result-hash", returnedAt));
    assert.equal(recovered.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal(recovered.contract.measuredSeconds, 3_600);
    assert.equal((await store.getOffer("hofr_lifecycle")).status, "RESERVED", "stop proof still does not bypass acceptance and cleanup");
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a failed STOP is isolated, retried with a new command and recovers into metered acceptance", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-stop-recovery-"));
  const path = join(directory, "stop-recovery.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const started = new Date("2026-08-11T08:00:00.000Z");
    const now = started.toISOString();
    seedLifecycleContract(path, now);
    const key = await normalizeSshPublicKey(testEd25519PublicKey());
    await store.attachSshKey(buyer.activeOrganization.id, "hctr_lifecycle", key, mutation("recovery-ssh", "recovery-ssh-hash", now));
    const provision = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", provision.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("lifecycle-gpu.example.com:25000", now) }, mutation("recovery-provision", "recovery-provision-hash", now));
    await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("recovery-start", "recovery-start-hash", now));
    const start = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", start.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("recovery-start-result", "recovery-start-result-hash", now));

    const stopAt = new Date(started.getTime() + 600_000).toISOString();
    await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("recovery-stop", "recovery-stop-hash", stopAt));
    const firstStop = await store.pollCommand("had_lifecycle", stopAt);
    const failed = await store.completeCommand("had_lifecycle", firstStop.id, { outcome: "FAILED", evidenceDigest: `sha256:${"d".repeat(64)}`, errorCode: "ACTUATOR_TIMEOUT", details: { protocolVersion: 1, commandType: "STOP", observedAt: stopAt, errorCode: "ACTUATOR_TIMEOUT" } }, mutation("recovery-stop-failed", "recovery-stop-failed-hash", stopAt));
    assert.equal(failed.contract.status, "FAILED");
    assert.equal(failed.device.status, "DRAINING");
    assert.equal((await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle")).stopFailure.status, "RECORDED");

    const recovered = await reconcileFailedHostingStop(failed.command, stopAt, store);
    assert.equal(recovered.exhausted, false);
    assert.equal(recovered.command.type, "STOP");
    assert.notEqual(recovered.command.id, firstStop.id);
    assert.equal((await reconcileFailedHostingStop(failed.command, stopAt, store)).command.id, recovered.command.id, "recovery scheduling must replay exactly once");
    const recoveryStop = await store.pollCommand("had_lifecycle", stopAt);
    const stoppedAt = new Date(started.getTime() + 601_000).toISOString();
    const result = await store.completeCommand("had_lifecycle", recoveryStop.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"e".repeat(64)}`, details: stopDetails(now, stoppedAt, 601) }, mutation("recovery-stop-success", "recovery-stop-success-hash", stoppedAt));
    assert.equal(result.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal(result.contract.measuredSeconds, 601);
    assert.equal(result.device.status, "DRAINING", "recovered machines stay isolated until settlement cleanup succeeds");
    const evidence = await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle");
    assert.equal(evidence.stopFailure.status, "RECOVERED");
    assert.equal(evidence.metering.serverMeasuredSeconds, 601);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("four failed STOP commands exhaust automation and Root recovery still requires real stop evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-stop-exhausted-"));
  const path = join(directory, "stop-exhausted.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    const started = new Date("2026-08-11T08:00:00.000Z");
    const now = started.toISOString();
    seedLifecycleContract(path, now);
    const key = await normalizeSshPublicKey(testEd25519PublicKey());
    await store.attachSshKey(buyer.activeOrganization.id, "hctr_lifecycle", key, mutation("exhaust-ssh", "exhaust-ssh-hash", now));
    const provision = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", provision.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: provisionDetails("lifecycle-gpu.example.com:25000", now) }, mutation("exhaust-provision", "exhaust-provision-hash", now));
    await store.requestContractStart(buyer.activeOrganization.id, "hctr_lifecycle", mutation("exhaust-start", "exhaust-start-hash", now));
    const start = await store.pollCommand("had_lifecycle", now);
    await store.completeCommand("had_lifecycle", start.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"7".repeat(64)}`, details: startDetails("lifecycle-gpu.example.com:25000", now) }, mutation("exhaust-start-result", "exhaust-start-result-hash", now));
    const stopAt = new Date(started.getTime() + 600_000).toISOString();
    await store.requestContractStop(buyer.activeOrganization.id, "hctr_lifecycle", mutation("exhaust-stop", "exhaust-stop-hash", stopAt));
    let stop = await store.pollCommand("had_lifecycle", stopAt);
    for (let sequence = 1; sequence <= 4; sequence += 1) {
      const failed = await store.completeCommand("had_lifecycle", stop.id, { outcome: "FAILED", evidenceDigest: `sha256:${String(sequence).repeat(64)}`, errorCode: "ACTUATOR_TIMEOUT", details: { protocolVersion: 1, commandType: "STOP", observedAt: stopAt, errorCode: "ACTUATOR_TIMEOUT" } }, mutation(`exhaust-fail-${sequence}`, `exhaust-fail-hash-${sequence}`, stopAt));
      const recovery = await reconcileFailedHostingStop(failed.command, stopAt, store);
      assert.equal(recovery.exhausted, sequence === 4);
      if (sequence < 4) {
        assert.ok(recovery.command);
        stop = await store.pollCommand("had_lifecycle", stopAt);
      } else {
        assert.equal(recovery.command, null);
      }
    }
    const incidents = await store.listStopIncidents();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].failureStatus, "EXHAUSTED");
    assert.equal(incidents[0].retrySequence, 4);
    const manual = await store.retryFailedStop("hctr_lifecycle", { expectedContractVersion: incidents[0].contractVersion, expectedDeviceVersion: incidents[0].deviceVersion, reason: "现场确认 Actuator 已恢复且容器仍由平台管理" }, { actorId: "admin-root", idempotencyKey: "manual-stop-recovery", payloadHash: "manual-stop-recovery-hash", now: stopAt });
    assert.equal(manual.command.type, "STOP");
    assert.equal(manual.contract.status, "FAILED");
    assert.equal(manual.device.status, "DRAINING");
    const manualReplay = await store.retryFailedStop("hctr_lifecycle", { expectedContractVersion: incidents[0].contractVersion, expectedDeviceVersion: incidents[0].deviceVersion, reason: "现场确认 Actuator 已恢复且容器仍由平台管理" }, { actorId: "admin-root", idempotencyKey: "manual-stop-recovery", payloadHash: "manual-stop-recovery-hash", now: stopAt });
    assert.equal(manualReplay.command.id, manual.command.id);
    const delivered = await store.pollCommand("had_lifecycle", stopAt);
    const stoppedAt = new Date(started.getTime() + 605_000).toISOString();
    const recovered = await store.completeCommand("had_lifecycle", delivered.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"f".repeat(64)}`, details: stopDetails(now, stoppedAt, 605) }, mutation("manual-stop-success", "manual-stop-success-hash", stoppedAt));
    assert.equal(recovered.contract.status, "AWAITING_ACCEPTANCE");
    assert.equal((await store.contractEvidenceForViewer(buyer.activeOrganization.id, "hctr_lifecycle")).stopFailure.status, "RECOVERED");
    assert.equal((await store.listStopIncidents()).length, 0);
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
