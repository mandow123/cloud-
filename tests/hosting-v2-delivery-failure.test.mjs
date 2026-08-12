import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { reconcileFailedHostingDelivery } from "../lib/server/hosting-delivery-failure-service.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const buyer = {
  account: { id: "acct-failure-buyer", displayName: "Failure Buyer", primaryEmail: null, status: "ACTIVE" },
  activeOrganization: { id: "org-failure-buyer", name: "Failure Buyer", externalKey: "FAILURE_BUYER", status: "ACTIVE" },
  membership: { id: "mbr-failure-buyer", accountId: "acct-failure-buyer", organizationId: "org-failure-buyer", status: "ACTIVE", roles: [] },
  sessionId: "session-failure-buyer",
  authMethod: "KAI_IDENTITY_OIDC",
};

const mutation = (actorId, key, now) => ({ actorId, idempotencyKey: key, payloadHash: `${key}-payload`, now });

function cleanupDetails(contractId, containerDigest, now) {
  return {
    protocolVersion: 1,
    contractId,
    containerDigest,
    cleanupDigest: `sha256:${"c".repeat(64)}`,
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanedAt: now,
    cleanupStatus: "CLEANED",
    observedAt: now,
  };
}

async function fixture(stage) {
  const directory = mkdtempSync(join(tmpdir(), `kai-hosting-${stage.toLowerCase()}-failure-`));
  const path = join(directory, "failure.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const now = "2026-08-12T08:00:00.000Z";
  const contractId = `hctr_failure${stage.toLowerCase()}0001`;
  const deviceId = `had_failure${stage.toLowerCase()}0001`;
  const offerId = `hofr_failure${stage.toLowerCase()}0001`;
  const commandId = `hcmd_failure${stage.toLowerCase()}0001`;
  const grant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 10_000_000, reason: "交付失败退款闭环测试", requestedBy: `root-${stage}`, idempotencyKey: `grant-${stage}`, payloadHash: `grant-${stage}-hash`, now });
  await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: `finance-${stage}`, payloadHash: `grant-${stage}-approve`, now });
  await cardHours.holdHostingOrder({ account: buyer, orderId: contractId, amountMicros: 3_600_000, idempotencyKey: `hold-${stage}`, payloadHash: `hold-${stage}-hash`, now });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const inventory = { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: `sha256:${"2".repeat(64)}`, gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen", memoryMiB: 65_536, storageGiB: 2_048, publicHost: "failure-gpu.example.com", sshPortStart: 25_000, sshPortEnd: 25_019 };
  const snapshot = { title: `Failure ${stage}`, gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300, acceptanceWindowSeconds: 1_800 };
  db.prepare(`INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,verified_until,last_sequence,last_seen_at,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'BUSY','PASSED',?,?,1,?,1,?,?)`).run(deviceId, "org-failure-supplier", "acct-failure-supplier", "Failure 4090", `sha256:${(stage === "PROVISION" ? "3" : "4").repeat(64)}`, "A".repeat(43), "1.9.1", JSON.stringify(inventory), `sha256:${"5".repeat(64)}`, `sha256:${"6".repeat(64)}`, "2026-08-13T08:00:00.000Z", now, now, now);
  const verificationCommandId = `hcmd_verify${stage.toLowerCase()}0001`;
  db.prepare("INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,evidence_digest,created_at,delivered_at,completed_at) VALUES(?,?,NULL,'VERIFY',?,'SUCCEEDED',1,?,?,?,?)").run(verificationCommandId, deviceId, JSON.stringify({ expectedInventoryDigest: `sha256:${"5".repeat(64)}`, tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"], approvedImages: [process.env.KAI_HOSTING_APPROVED_IMAGES], reachabilityChallenge: "1".repeat(32) }), `sha256:${"6".repeat(64)}`, now, now, now);
  db.prepare("INSERT INTO hosting_v2_verification_proofs(command_id,device_id,agent_evidence_digest,control_plane_reachability_digest,public_host,public_port,recorded_at) VALUES(?,?,?,?,?,?,?)").run(verificationCommandId, deviceId, `sha256:${"6".repeat(64)}`, `sha256:${"f".repeat(64)}`, inventory.publicHost, inventory.sshPortStart, now);
  db.prepare(`INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
    VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,?, 'RESERVED',1,?,?)`).run(offerId, "org-failure-supplier", deviceId, "hfee-failure", `Failure ${stage}`, now, "2026-08-13T08:00:00.000Z", process.env.KAI_HOSTING_APPROVED_IMAGES, "KAI_HOSTING_TERMS_2026_08", now, now);
  db.prepare(`INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,held_micros,status,ssh_public_key_fingerprint,endpoint_display,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,3600,3600000,?,?,?,?,?,1,?,?)`).run(contractId, offerId, deviceId, buyer.activeOrganization.id, buyer.account.id, "org-failure-supplier", "hfee-failure", JSON.stringify(snapshot), stage === "PROVISION" ? "PROVISIONING" : "READY", `SHA256:${"A".repeat(43)}`, stage === "START" ? "failure-gpu.example.com:25000" : null, `seed-${stage}`, `seed-${stage}-hash`, now, now);
  const containerDigest = `sha256:${"7".repeat(64)}`;
  if (stage === "START") db.prepare(`INSERT INTO hosting_v2_instances(contract_id,device_id,provision_command_id,approved_image,endpoint_display,container_digest,workspace_digest,status,provision_evidence_digest,provisioned_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'READY',?,?,?)`).run(contractId, deviceId, `hcmd_provision${stage.toLowerCase()}0001`, process.env.KAI_HOSTING_APPROVED_IMAGES, "failure-gpu.example.com:25000", containerDigest, `sha256:${"8".repeat(64)}`, `sha256:${"9".repeat(64)}`, now, now);
  db.prepare(`INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,?,?,'PENDING',1,?)`).run(commandId, deviceId, contractId, stage, JSON.stringify(stage === "PROVISION" ? { contractId, image: process.env.KAI_HOSTING_APPROVED_IMAGES, publicKey: "redacted", reservedSeconds: 3_600, gpuCount: 1 } : { contractId, endpointDisplay: "failure-gpu.example.com:25000" }), now);
  db.close();
  return { directory, path, hosting, cardHours, now, contractId, deviceId, offerId, commandId, containerDigest };
}

for (const stage of ["PROVISION", "START"]) test(`${stage} failure refunds once, cleans residual access and only then relists`, async () => {
  const state = await fixture(stage);
  try {
    const errorCode = stage === "START" ? "SSH_READINESS_TIMEOUT" : "PROVISION_FAILED";
    const evidenceDigest = `sha256:${(stage === "START" ? "a" : "b").repeat(64)}`;
    const failed = await state.hosting.completeCommand(state.deviceId, state.commandId, { outcome: "FAILED", errorCode, evidenceDigest, details: { errorCode } }, mutation(`agent:${state.deviceId}`, `fail-${stage}`, state.now));
    assert.equal(failed.contract.status, "FAILED");
    assert.equal(failed.device.status, "DRAINING");
    const recovery = await reconcileFailedHostingDelivery(failed.command, state.now, { hosting: state.hosting, cardHours: state.cardHours });
    assert.equal(recovery.refund.applied, true);
    assert.equal(recovery.cleanup.contract.status, "CLEANING");
    assert.equal(recovery.cleanup.command.type, "CLEANUP");
    assert.deepEqual((await state.cardHours.dashboard(buyer.activeOrganization.id, state.now)).balance, { availableMicros: 10_000_000, heldMicros: 0, lifetimeTopupMicros: 10_000_000, lifetimeSpentMicros: 0 });
    const replay = await reconcileFailedHostingDelivery(failed.command, state.now, { hosting: state.hosting, cardHours: state.cardHours });
    assert.equal(replay.refund.applied, false);
    assert.equal(replay.cleanup.command.id, recovery.cleanup.command.id);
    const cleanup = await state.hosting.pollCommand(state.deviceId, state.now, ["CLEANUP"]);
    const cleaned = await state.hosting.completeCommand(state.deviceId, cleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"d".repeat(64)}`, details: cleanupDetails(state.contractId, state.containerDigest, state.now) }, mutation(`agent:${state.deviceId}`, `clean-${stage}`, state.now));
    assert.equal(cleaned.contract.status, "REFUNDED");
    assert.equal(cleaned.device.status, "VERIFIED");
    assert.equal((await state.hosting.getOffer(state.offerId)).status, "PUBLISHED");
    const evidence = await state.hosting.contractEvidenceForViewer(buyer.activeOrganization.id, state.contractId);
    assert.deepEqual({ stage: evidence.deliveryFailure.stage, errorCode: evidence.deliveryFailure.errorCode }, { stage, errorCode });
    assert.equal(evidence.cleanup.containerRemoved, true);
    await assert.rejects(state.hosting.completeCommand(state.deviceId, state.commandId, { outcome: "FAILED", errorCode: "DIFFERENT_FAILURE", evidenceDigest: `sha256:${"e".repeat(64)}`, details: { errorCode: "DIFFERENT_FAILURE" } }, mutation(`agent:${state.deviceId}`, `tamper-${stage}`, state.now)), (error) => error.name === "ExchangeIdempotencyConflictError");
    const db = new DatabaseSync(state.path, { enableForeignKeyConstraints: true });
    assert.equal(db.prepare("SELECT COUNT(*) count FROM card_hour_ledger_batches WHERE business_key=?").get(`delivery-failure-refund:HOSTING_V2:${state.contractId}`).count, 1);
    assert.equal(db.prepare("SELECT status FROM hosting_v2_delivery_failures WHERE command_id=?").get(state.commandId).status, "CLEANED");
    assert.throws(() => db.prepare("UPDATE hosting_v2_agent_commands SET error_code='TAMPERED' WHERE id=?").run(state.commandId), /hosting terminal command immutable/u);
    db.close();
  } finally {
    state.cardHours.close(); state.hosting.close(); rmSync(state.directory, { recursive: true, force: true });
  }
});
