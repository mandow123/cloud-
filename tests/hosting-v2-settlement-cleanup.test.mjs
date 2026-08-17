import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { acceptHostingContract, advanceExpiredHostingAcceptance } from "../lib/server/hosting-contract-service.ts";
import { decideAndExecuteHostingDispute } from "../lib/server/hosting-dispute-service.ts";
import { createSqliteCardHourStore } from "../lib/server/card-hour-store-sqlite.ts";
import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

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

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function cleanupDetails(contractId, now) {
  return {
    protocolVersion: 1,
    contractId,
    containerDigest: `sha256:${"6".repeat(64)}`,
    cleanupDigest: `sha256:${"7".repeat(64)}`,
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanedAt: now,
    cleanupStatus: "CLEANED",
    observedAt: now,
  };
}

function seedStoppedContract(path, suffix, buyer, supplier, now, withMeteringProof = true) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const deviceId = `had_settlement_${suffix}`;
  const offerId = `hofr_settlement_${suffix}`;
  const contractId = `hctr_settlement_${suffix}`;
  const feeId = "hfee_settlement";
  const inventory = { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: sha256(`settlement-gpu-${suffix}`), gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen 9 9950X", memoryMiB: 65_536, storageGiB: 2_048, publicHost: `${suffix}.settlement-gpu.example.com`, sshPortStart: 26_000, sshPortEnd: 26_019 };
  db.prepare("INSERT OR IGNORE INTO hosting_v2_supplier_profiles(organization_id,account_id,supplier_type,legal_display_name,contact_email,agreement_version,evidence_digest,status,version,created_at,updated_at) VALUES(?,?,'INDIVIDUAL','结算测试供应方',?,'KAI_HOSTING_2026_08',?,'APPROVED',3,?,?)").run(supplier.activeOrganization.id, supplier.account.id, supplier.account.primaryEmail, `sha256:${"f".repeat(64)}`, now, now);
  db.prepare("INSERT OR IGNORE INTO hosting_v2_fee_schedules(id,platform_fee_bps,referral_reward_bps,status,effective_from,created_by,created_at) VALUES(?,1000,300,'ACTIVE',?,'admin-market',?)").run(feeId, now, now);
  db.prepare(`INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,verified_until,last_sequence,last_seen_at,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED','PASSED',?,?,1,?,1,?,?)`).run(deviceId, supplier.activeOrganization.id, supplier.account.id, `Settlement GPU ${suffix}`, `sha256:${suffix.padEnd(64, "3").slice(0, 64)}`, "A".repeat(43), "1.11.0", JSON.stringify(inventory), `sha256:${suffix.padEnd(64, "4").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "5").slice(0, 64)}`, new Date(Date.parse(now) + 86_400_000).toISOString(), now, now, now);
  const verificationCommandId = `hcmd_seed_verify_${suffix}`;
  db.prepare("INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,evidence_digest,created_at,delivered_at,completed_at) VALUES(?,?,NULL,'VERIFY',?,'SUCCEEDED',1,?,?,?,?)").run(verificationCommandId, deviceId, JSON.stringify({ expectedInventoryDigest: `sha256:${suffix.padEnd(64, "4").slice(0, 64)}`, tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"], approvedImages: [process.env.KAI_HOSTING_APPROVED_IMAGES], reachabilityChallenge: "1".repeat(32) }), `sha256:${suffix.padEnd(64, "5").slice(0, 64)}`, now, now, now);
  db.prepare("INSERT INTO hosting_v2_verification_proofs(command_id,device_id,agent_evidence_digest,control_plane_reachability_digest,public_host,public_port,recorded_at) VALUES(?,?,?,?,?,?,?)").run(verificationCommandId, deviceId, `sha256:${suffix.padEnd(64, "5").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "6").slice(0, 64)}`, inventory.publicHost, inventory.sshPortStart, now);
  db.prepare(`INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
    VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,'KAI_HOSTING_TERMS_2026_08','RESERVED',2,?,?)`).run(offerId, supplier.activeOrganization.id, deviceId, feeId, `Settlement RTX 4090 ${suffix}`, new Date(Date.parse(now) - 60_000).toISOString(), new Date(Date.parse(now) + 86_400_000).toISOString(), process.env.KAI_HOSTING_APPROVED_IMAGES, now, now);
  const snapshot = { title: `Settlement RTX 4090 ${suffix}`, gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300, acceptanceWindowSeconds: 1_800 };
  db.prepare(`INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,status,started_at,stopped_at,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,3600,600,3600000,'AWAITING_ACCEPTANCE',?,?,?, ?,5,?,?)`).run(contractId, offerId, deviceId, buyer.activeOrganization.id, buyer.account.id, supplier.activeOrganization.id, feeId, JSON.stringify(snapshot), new Date(Date.parse(now) - 600_000).toISOString(), now, `seed-settlement-${suffix}`, `seed-settlement-hash-${suffix}`, now, now);
  db.prepare(`INSERT INTO hosting_v2_instances(contract_id,device_id,provision_command_id,approved_image,endpoint_display,container_digest,workspace_digest,status,provision_evidence_digest,start_evidence_digest,stop_evidence_digest,provisioned_at,started_at,stopped_at,updated_at)
    VALUES(?,?,?,?,?,?,?,'STOPPED',?,?,?,?,?,?,?)`).run(contractId, deviceId, `hcmd_seed_provision_${suffix}`, process.env.KAI_HOSTING_APPROVED_IMAGES, `${suffix}.settlement-gpu.example.com:26000`, `sha256:${"6".repeat(64)}`, `sha256:${suffix.padEnd(64, "8").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "9").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "a").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "b").slice(0, 64)}`, new Date(Date.parse(now) - 700_000).toISOString(), new Date(Date.parse(now) - 600_000).toISOString(), now, now);
  if (withMeteringProof) db.prepare(`INSERT INTO hosting_v2_metering_proofs(id,contract_id,command_id,container_digest,runtime_state_digest,agent_started_at,agent_stopped_at,agent_runtime_seconds,server_measured_seconds,evidence_digest,recorded_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(`hmp_seed_${suffix}`, contractId, `hcmd_seed_stop_${suffix}`, `sha256:${"6".repeat(64)}`, `sha256:${suffix.padEnd(64, "c").slice(0, 64)}`, new Date(Date.parse(now) - 600_000).toISOString(), now, 600, 600, `sha256:${suffix.padEnd(64, "d").slice(0, 64)}`, now);
  db.close();
  return { contractId, deviceId, offerId };
}

function seedAcceptanceDecision(path, contractId, now, mode = "BUYER") {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const row = db.prepare("SELECT stopped_at,snapshot_json FROM hosting_v2_contracts WHERE id=?").get(contractId);
  const snapshot = JSON.parse(row.snapshot_json);
  const deadlineAt = new Date(Date.parse(row.stopped_at) + snapshot.acceptanceWindowSeconds * 1_000).toISOString();
  db.prepare("UPDATE hosting_v2_contracts SET status='SETTLED',accepted_at=?,version=version+1,updated_at=? WHERE id=? AND status='AWAITING_ACCEPTANCE'").run(now, now, contractId);
  db.prepare("INSERT INTO hosting_v2_acceptance_proofs(contract_id,decision_mode,acceptance_window_seconds,deadline_at,decided_at,actor_id,payload_digest) VALUES(?,?,?,?,?,?,?)").run(contractId, mode, snapshot.acceptanceWindowSeconds, deadlineAt, now, "buyer-cleanup-test", `sha256:${"e".repeat(64)}`);
  db.close();
}

function refreshDevicePresence(path, deviceId, now) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.prepare("UPDATE hosting_v2_devices SET last_seen_at=?,updated_at=? WHERE id=?").run(now, now, deviceId);
  db.close();
}

test("buyer acceptance settles actual card-hours, vests income and relists only after cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-settlement-"));
  const path = join(directory, "settlement.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const buyer = account("settlement-buyer");
    const supplier = account("settlement-supplier");
    const referrer = account("settlement-referrer");
    const missingProofBuyer = account("missing-proof-buyer");
  const stores = { hosting, cardHours };
  try {
    const now = new Date().toISOString();
    const seeded = seedStoppedContract(path, "success", buyer, supplier, now);
    const grant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 5_000_000, reason: "内部结算清理闭环验收", requestedBy: "admin-settlement-requester", idempotencyKey: "settlement-trial-grant", payloadHash: "settlement-trial-grant-hash", now });
    await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "admin-settlement-approver", payloadHash: "settlement-trial-approval-hash", now });
    const referral = await cardHours.dashboard(referrer.activeOrganization.id, now);
    await cardHours.attachReferral({ account: buyer, code: referral.referral.code, now });
    await cardHours.holdHostingOrder({ account: buyer, orderId: seeded.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${seeded.contractId}`, payloadHash: "settlement-hold-hash", now });

    const missingProof = seedStoppedContract(path, "missingproof", missingProofBuyer, supplier, now, false);
    const missingProofGrant = await cardHours.requestTrialGrant({ organizationId: missingProofBuyer.activeOrganization.id, amountMicros: 1_000_000, reason: "计量凭证缺失保护测试", requestedBy: "admin-missing-proof-requester", idempotencyKey: "missing-proof-trial-grant", payloadHash: "missing-proof-trial-grant-hash", now });
    await cardHours.decideTrialGrant({ grantId: missingProofGrant.id, decision: "APPROVE", approvedBy: "admin-missing-proof-approver", payloadHash: "missing-proof-trial-approval-hash", now });
    await cardHours.holdHostingOrder({ account: missingProofBuyer, orderId: missingProof.contractId, amountMicros: 600_000, idempotencyKey: `hosting-hold:${missingProof.contractId}`, payloadHash: "missing-proof-hold-hash", now });
    const beforeMissingProofAcceptance = await cardHours.dashboard(missingProofBuyer.activeOrganization.id, now);
    await assert.rejects(acceptHostingContract({ account: missingProofBuyer, contractId: missingProof.contractId, mutation: mutation(missingProofBuyer.account.id, "missing-proof-accept", "missing-proof-accept-hash", now) }, stores), (error) => error.code === "HOSTING_INSTANCE_EVIDENCE_MISSING");
    const afterMissingProofAcceptance = await cardHours.dashboard(missingProofBuyer.activeOrganization.id, now);
    assert.deepEqual(afterMissingProofAcceptance.balance, beforeMissingProofAcceptance.balance, "missing evidence must fail before card-hours move");
    assert.equal((await hosting.contractForViewer(missingProofBuyer.activeOrganization.id, missingProof.contractId)).status, "AWAITING_ACCEPTANCE");

    await assert.rejects(acceptHostingContract({ account: supplier, contractId: seeded.contractId, mutation: mutation(supplier.account.id, "supplier-cannot-accept", "supplier-cannot-accept-hash", now) }, stores), (error) => error.code === "EXCHANGE_OWNERSHIP_FORBIDDEN");
    const acceptInput = { account: buyer, contractId: seeded.contractId, mutation: mutation(buyer.account.id, "buyer-accept-0001", "buyer-accept-hash", now) };
    const accepted = await acceptHostingContract(acceptInput, stores);
    assert.equal(accepted.contract.status, "CLEANING");
    assert.deepEqual(accepted.settlement, { heldMicros: 3_600_000, settledMicros: 600_000, releasedMicros: 3_000_000, supplierIncomeMicros: 540_000, commissionMicros: 18_000, platformFeeMicros: 60_000 });
    const platformNetMicros = accepted.settlement.platformFeeMicros - accepted.settlement.commissionMicros;
    assert.equal(accepted.settlement.supplierIncomeMicros, accepted.settlement.settledMicros - accepted.settlement.platformFeeMicros, "supplier income subtracts the platform fee exactly once");
    assert.equal(accepted.settlement.settledMicros, accepted.settlement.supplierIncomeMicros + accepted.settlement.commissionMicros + platformNetMicros, "gross equals supplier income plus in-fee commission plus platform net");
    assert.notEqual(accepted.settlement.supplierIncomeMicros, accepted.settlement.settledMicros - accepted.settlement.platformFeeMicros - accepted.settlement.commissionMicros, "commission must not be deducted from the supplier a second time");
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, now)).balance, { availableMicros: 4_400_000, heldMicros: 0, lifetimeTopupMicros: 5_000_000, lifetimeSpentMicros: 600_000 });
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, now)).income.rentalVestedMicros, 540_000);
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, now)).balance.availableMicros, 540_000);
    assert.equal((await cardHours.dashboard(referrer.activeOrganization.id, now)).income.commissionVestedMicros, 18_000);
    assert.equal((await hosting.listPublicOffers(now)).length, 0);

    const cleanup = await hosting.pollCommand(seeded.deviceId, now);
    assert.equal(cleanup.type, "CLEANUP");
    await assert.rejects(hosting.completeCommand(seeded.deviceId, cleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: { ...cleanupDetails(seeded.contractId, now), workspaceRemoved: false } }, mutation(`agent:${seeded.deviceId}`, "cleanup-invalid", "cleanup-invalid-hash", now)), (error) => error.name === "ExchangeInputError");
    const cleaned = await hosting.completeCommand(seeded.deviceId, cleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"6".repeat(64)}`, details: cleanupDetails(seeded.contractId, now) }, mutation(`agent:${seeded.deviceId}`, "cleanup-success", "cleanup-success-hash", now));
    assert.equal(cleaned.contract.status, "CLEANED");
    assert.equal(cleaned.device.status, "VERIFIED");
    assert.equal((await hosting.listPublicOffers(now)).length, 1);
    assert.equal((await acceptHostingContract(acceptInput, stores)).replayed, true);
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, now)).balance.availableMicros, 540_000, "replayed acceptance must not credit rent twice");

    const failedSeed = seedStoppedContract(path, "failure", buyer, supplier, now);
    seedAcceptanceDecision(path, failedSeed.contractId, now);
    const cleanupQueued = await hosting.markContractSettled(failedSeed.contractId, { measuredSeconds: 600, settledMicros: 600_000, supplierIncomeMicros: 540_000, commissionMicros: 0 }, mutation("admin-failure-test", "cleanup-failure-queue", "cleanup-failure-queue-hash", now));
    const failedCleanup = await hosting.pollCommand(failedSeed.deviceId, now);
    assert.equal(failedCleanup.id, cleanupQueued.command.id);
    const failed = await hosting.completeCommand(failedSeed.deviceId, failedCleanup.id, { outcome: "FAILED", evidenceDigest: `sha256:${"7".repeat(64)}`, errorCode: "WORKSPACE_DELETE_FAILED", details: {} }, mutation(`agent:${failedSeed.deviceId}`, "cleanup-failure", "cleanup-failure-hash", now));
    assert.equal(failed.contract.status, "CLEANING");
    assert.equal(failed.device.status, "DRAINING");
    assert.equal((await hosting.getOffer(failedSeed.offerId)).status, "SUSPENDED");
    const degraded = await hosting.readiness(now);
    assert.equal(degraded.drainingDeviceCount, 1);
    assert.equal(degraded.failedCleanupCount, 1);
    assert.equal(degraded.cleaningContractCount, 1);

    const incidents = await hosting.listCleanupIncidents();
    assert.equal(incidents.length, 1);
    assert.deepEqual({
      contractId: incidents[0].contractId,
      deviceId: incidents[0].deviceId,
      cleanupCommandId: incidents[0].cleanupCommandId,
      cleanupCommandStatus: incidents[0].cleanupCommandStatus,
      errorCode: incidents[0].errorCode,
    }, {
      contractId: failedSeed.contractId,
      deviceId: failedSeed.deviceId,
      cleanupCommandId: failedCleanup.id,
      cleanupCommandStatus: "FAILED",
      errorCode: "WORKSPACE_DELETE_FAILED",
    });
    const recoveryNow = new Date(Date.parse(now) + 1_000).toISOString();
    const recoveryMutation = mutation("root-cleanup-operator", "cleanup-retry-0001", "cleanup-retry-hash", recoveryNow);
    const retriedCleanup = await hosting.retryCleanup(failedSeed.contractId, {
      expectedContractVersion: failed.contract.version,
      expectedDeviceVersion: failed.device.version,
      reason: "Agent 已恢复在线并完成清理故障排查",
    }, recoveryMutation);
    assert.equal(retriedCleanup.command.status, "PENDING");
    assert.equal(retriedCleanup.contract.status, "CLEANING");
    assert.equal(retriedCleanup.device.status, "DRAINING");
    assert.equal((await hosting.getOffer(failedSeed.offerId)).status, "SUSPENDED");
    assert.equal((await hosting.retryCleanup(failedSeed.contractId, {
      expectedContractVersion: failed.contract.version,
      expectedDeviceVersion: failed.device.version,
      reason: "Agent 已恢复在线并完成清理故障排查",
    }, recoveryMutation)).command.id, retriedCleanup.command.id, "same recovery request must replay one command");
    await assert.rejects(hosting.retryCleanup(failedSeed.contractId, {
      expectedContractVersion: failed.contract.version,
      expectedDeviceVersion: failed.device.version,
      reason: "重复管理员不能同时创建第二条清理任务",
    }, mutation("other-root-operator", "cleanup-retry-concurrent", "cleanup-retry-concurrent-hash", recoveryNow)), (error) => error.code === "EXCHANGE_STATE_CONFLICT");
    const recovering = await hosting.listCleanupIncidents();
    assert.equal(recovering[0].cleanupCommandStatus, "PENDING");
    assert.equal((await hosting.readiness(recoveryNow)).failedCleanupCount, 0, "a queued recovery supersedes historical failure without declaring the device clean");
    const recoveryCommand = await hosting.pollCommand(failedSeed.deviceId, recoveryNow);
    assert.equal(recoveryCommand.id, retriedCleanup.command.id);
    const recovered = await hosting.completeCommand(failedSeed.deviceId, recoveryCommand.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"9".repeat(64)}`, details: cleanupDetails(failedSeed.contractId, recoveryNow) }, mutation(`agent:${failedSeed.deviceId}`, "cleanup-retry-success", "cleanup-retry-success-hash", recoveryNow));
    assert.equal(recovered.contract.status, "CLEANED");
    assert.equal(recovered.device.status, "VERIFIED");
    assert.equal((await hosting.getOffer(failedSeed.offerId)).status, "PUBLISHED");
    assert.equal((await hosting.listCleanupIncidents()).length, 0);
    const recoveredReadiness = await hosting.readiness(recoveryNow);
    assert.deepEqual({ draining: recoveredReadiness.drainingDeviceCount, failed: recoveredReadiness.failedCleanupCount, cleaning: recoveredReadiness.cleaningContractCount }, { draining: 0, failed: 0, cleaning: 0 });

    const expiredSeed = seedStoppedContract(path, "expired", buyer, supplier, now);
    seedAcceptanceDecision(path, expiredSeed.contractId, now);
    const raw = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    raw.prepare("UPDATE hosting_v2_devices SET verified_until=? WHERE id=?").run(new Date(Date.parse(now) - 1_000).toISOString(), expiredSeed.deviceId);
    raw.close();
    await hosting.markContractSettled(expiredSeed.contractId, { measuredSeconds: 600, settledMicros: 600_000, supplierIncomeMicros: 540_000, commissionMicros: 0 }, mutation("admin-expired-test", "cleanup-expired-queue", "cleanup-expired-queue-hash", now));
    const expiredCleanup = await hosting.pollCommand(expiredSeed.deviceId, now);
    const expired = await hosting.completeCommand(expiredSeed.deviceId, expiredCleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: cleanupDetails(expiredSeed.contractId, now) }, mutation(`agent:${expiredSeed.deviceId}`, "cleanup-expired", "cleanup-expired-hash", now));
    assert.equal(expired.contract.status, "CLEANED");
    assert.equal(expired.device.status, "ONLINE");
    assert.equal(expired.device.verificationStatus, "EXPIRED");
    assert.equal((await hosting.getOffer(expiredSeed.offerId)).status, "SUSPENDED", "expired verification must not auto-relist after cleanup");

    const rotatedSeed = seedStoppedContract(path, "image-rotated", buyer, supplier, now);
    seedAcceptanceDecision(path, rotatedSeed.contractId, now);
    await hosting.markContractSettled(rotatedSeed.contractId, { measuredSeconds: 600, settledMicros: 600_000, supplierIncomeMicros: 540_000, commissionMicros: 0 }, mutation("admin-image-rotation", "cleanup-image-rotation-queue", "cleanup-image-rotation-queue-hash", now));
    const rotatedCleanup = await hosting.pollCommand(rotatedSeed.deviceId, now);
    const originalImagePolicy = process.env.KAI_HOSTING_APPROVED_IMAGES;
    try {
      process.env.KAI_HOSTING_APPROVED_IMAGES = `ghcr.io/kai-cloud/cuda-pytorch@sha256:${"b".repeat(64)}`;
      const rotated = await hosting.completeCommand(rotatedSeed.deviceId, rotatedCleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"a".repeat(64)}`, details: cleanupDetails(rotatedSeed.contractId, now) }, mutation(`agent:${rotatedSeed.deviceId}`, "cleanup-image-rotated", "cleanup-image-rotated-hash", now));
      assert.equal(rotated.contract.status, "CLEANED");
      assert.equal(rotated.device.status, "ONLINE");
      assert.equal(rotated.device.verificationStatus, "EXPIRED");
      assert.equal((await hosting.getOffer(rotatedSeed.offerId)).status, "SUSPENDED", "an image policy change must require fresh evidence before relisting");
    } finally {
      process.env.KAI_HOSTING_APPROVED_IMAGES = originalImagePolicy;
    }
  } finally {
    cardHours.close();
    hosting.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("acceptance timeout settles once while a timely dispute freezes money and reuse", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-auto-acceptance-"));
  const path = join(directory, "auto-acceptance.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const buyer = account("timeout-buyer");
  const supplier = account("timeout-supplier");
  const stores = { hosting, cardHours };
  try {
    const stoppedAt = "2026-08-11T08:00:00.000Z";
    const beforeDeadline = "2026-08-11T08:29:59.000Z";
    const deadline = "2026-08-11T08:30:00.000Z";
    const timed = seedStoppedContract(path, "timeout", buyer, supplier, stoppedAt);
    const grant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 5_000_000, reason: "超时验收真实账本测试", requestedBy: "timeout-requester", idempotencyKey: "timeout-grant", payloadHash: "timeout-grant-hash", now: stoppedAt });
    await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "timeout-approver", payloadHash: "timeout-approval-hash", now: stoppedAt });
    await cardHours.holdHostingOrder({ account: buyer, orderId: timed.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${timed.contractId}`, payloadHash: "timeout-hold-hash", now: stoppedAt });
    assert.equal(await advanceExpiredHostingAcceptance(timed.deviceId, beforeDeadline, stores), null);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, beforeDeadline)).balance, { availableMicros: 1_400_000, heldMicros: 3_600_000, lifetimeTopupMicros: 5_000_000, lifetimeSpentMicros: 0 });
    const settled = await advanceExpiredHostingAcceptance(timed.deviceId, deadline, stores);
    assert.equal(settled.contract.status, "CLEANING");
    assert.equal(settled.settlement.settledMicros, 600_000);
    assert.equal((await hosting.contractEvidenceForViewer(buyer.activeOrganization.id, timed.contractId)).acceptance.mode, "TIMEOUT");
    assert.equal((await advanceExpiredHostingAcceptance(timed.deviceId, "2026-08-11T08:31:00.000Z", stores)), null);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, deadline)).balance, { availableMicros: 4_400_000, heldMicros: 0, lifetimeTopupMicros: 5_000_000, lifetimeSpentMicros: 600_000 });
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, deadline)).balance.availableMicros, 540_000);

    const disputed = seedStoppedContract(path, "disputed", buyer, supplier, stoppedAt);
    const disputedGrant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 3_600_000, reason: "争议冻结真实账本测试", requestedBy: "dispute-requester", idempotencyKey: "dispute-grant", payloadHash: "dispute-grant-hash", now: stoppedAt });
    await cardHours.decideTrialGrant({ grantId: disputedGrant.id, decision: "APPROVE", approvedBy: "dispute-approver", payloadHash: "dispute-approval-hash", now: stoppedAt });
    await cardHours.holdHostingOrder({ account: buyer, orderId: disputed.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${disputed.contractId}`, payloadHash: "dispute-hold-hash", now: stoppedAt });
    const beforeDispute = await cardHours.dashboard(buyer.activeOrganization.id, beforeDeadline);
    const frozen = await hosting.disputeContract(buyer.activeOrganization.id, disputed.contractId, "SSH 连接持续失败，无法完成约定的算力服务", mutation(buyer.account.id, "dispute-timeout-contract", "dispute-timeout-hash", beforeDeadline));
    assert.equal(frozen.status, "DISPUTED");
    assert.equal((await hosting.getDevice(disputed.deviceId)).status, "DRAINING");
    assert.equal((await hosting.getOffer(disputed.offerId)).status, "SUSPENDED");
    assert.equal(await advanceExpiredHostingAcceptance(disputed.deviceId, deadline, stores), null);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, deadline)).balance, beforeDispute.balance);
    assert.equal(await hosting.pollCommand(disputed.deviceId, deadline), null, "a disputed machine must not receive cleanup or relist automatically");
  } finally {
    cardHours.close();
    hosting.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("independent dispute resolution refunds or settles card-hours before evidence-backed cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-dispute-resolution-"));
  const path = join(directory, "dispute-resolution.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const buyer = account("resolution-buyer");
  const supplier = account("resolution-supplier");
  const stores = { hosting, cardHours };
  const stoppedAt = "2026-08-11T10:00:00.000Z";
  const openedAt = "2026-08-11T10:10:00.000Z";
  try {
    const refundSeed = seedStoppedContract(path, "resolution-refund", buyer, supplier, stoppedAt);
    const refundGrant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 3_600_000, reason: "争议全额退回账本测试", requestedBy: "refund-grant-requester", idempotencyKey: "refund-resolution-grant", payloadHash: "refund-resolution-grant-hash", now: stoppedAt });
    await cardHours.decideTrialGrant({ grantId: refundGrant.id, decision: "APPROVE", approvedBy: "refund-grant-approver", payloadHash: "refund-resolution-grant-approval", now: stoppedAt });
    await cardHours.holdHostingOrder({ account: buyer, orderId: refundSeed.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${refundSeed.contractId}`, payloadHash: "refund-resolution-hold", now: stoppedAt });
    const disputedRefund = await hosting.disputeContract(buyer.activeOrganization.id, refundSeed.contractId, "实例入口持续无法连接，申请全额退回锁定卡时", mutation(buyer.account.id, "open-refund-dispute", "open-refund-dispute-hash", openedAt));
    const refundProposal = await hosting.requestDisputeResolution(refundSeed.contractId, { resolution: "REFUND", expectedContractVersion: disputedRefund.version, requestReason: "连接证据显示整个服务窗口均不可用，应全额退回", evidenceDigest: "1".repeat(64) }, mutation("root-resolution", "request-refund-resolution", "request-refund-resolution-hash", openedAt));
    assert.equal(refundProposal.proposalStatus, "REQUESTED");
    await assert.rejects(
      hosting.decideDisputeResolution(refundProposal.proposalId, { decision: "APPROVE", decisionReason: "申请人不能复核自己的争议裁决方案" }, mutation("root-resolution", "self-approve-refund", "self-approve-refund-hash", openedAt)),
      (error) => error.code === "EXCHANGE_ROLE_FORBIDDEN",
    );
    const refunded = await decideAndExecuteHostingDispute({ proposalId: refundProposal.proposalId, decision: "APPROVE", decisionReason: "独立复核连接和计量证据，同意全额退回并清理", mutation: mutation("finance-resolution", "approve-refund-resolution", "approve-refund-resolution-hash", openedAt) }, stores);
    assert.equal(refunded.record.proposalStatus, "APPLIED");
    assert.equal(refunded.ledger.resolution, "REFUND");
    assert.equal(refunded.ledger.settledMicros, 0);
    assert.equal(refunded.cleanup.contract.status, "CLEANING");
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, openedAt)).balance, { availableMicros: 3_600_000, heldMicros: 0, lifetimeTopupMicros: 3_600_000, lifetimeSpentMicros: 0 });
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, openedAt)).balance.availableMicros, 0);
    const refundReplay = await decideAndExecuteHostingDispute({ proposalId: refundProposal.proposalId, decision: "APPROVE", decisionReason: "独立复核连接和计量证据，同意全额退回并清理", mutation: mutation("finance-resolution", "approve-refund-resolution-retry", "approve-refund-resolution-hash", openedAt) }, stores);
    assert.equal(refundReplay.ledger.applied, false);
    assert.equal(refundReplay.cleanup.command.id, refunded.cleanup.command.id);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, openedAt)).balance, { availableMicros: 3_600_000, heldMicros: 0, lifetimeTopupMicros: 3_600_000, lifetimeSpentMicros: 0 });
    refreshDevicePresence(path, refundSeed.deviceId, openedAt);
    const refundCleanup = await hosting.pollCommand(refundSeed.deviceId, openedAt);
    assert.equal(refundCleanup.type, "CLEANUP");
    const refundClosed = await hosting.completeCommand(refundSeed.deviceId, refundCleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"2".repeat(64)}`, details: cleanupDetails(refundSeed.contractId, openedAt) }, mutation(`agent:${refundSeed.deviceId}`, "complete-refund-cleanup", "complete-refund-cleanup-hash", openedAt));
    assert.equal(refundClosed.contract.status, "REFUNDED", "cleanup must preserve the refund terminal state");
    assert.equal(refundClosed.device.status, "VERIFIED");
    assert.equal((await hosting.getOffer(refundSeed.offerId)).status, "PUBLISHED");

    const settleSeed = seedStoppedContract(path, "resolution-settle", buyer, supplier, stoppedAt);
    const settleGrant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 3_600_000, reason: "争议按计量结算账本测试", requestedBy: "settle-grant-requester", idempotencyKey: "settle-resolution-grant", payloadHash: "settle-resolution-grant-hash", now: stoppedAt });
    await cardHours.decideTrialGrant({ grantId: settleGrant.id, decision: "APPROVE", approvedBy: "settle-grant-approver", payloadHash: "settle-resolution-grant-approval", now: stoppedAt });
    await cardHours.holdHostingOrder({ account: buyer, orderId: settleSeed.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${settleSeed.contractId}`, payloadHash: "settle-resolution-hold", now: stoppedAt });
    const disputedSettle = await hosting.disputeContract(buyer.activeOrganization.id, settleSeed.contractId, "连接中断后恢复，申请平台复核实际有效运行时长", mutation(buyer.account.id, "open-settle-dispute", "open-settle-dispute-hash", openedAt));
    const settleProposal = await hosting.requestDisputeResolution(settleSeed.contractId, { resolution: "SETTLE", expectedContractVersion: disputedSettle.version, requestReason: "Agent 与控制面均证明有六百秒有效服务，应按冻结费率结算", evidenceDigest: "3".repeat(64) }, mutation("root-resolution", "request-settle-resolution", "request-settle-resolution-hash", openedAt));
    const rejected = await hosting.decideDisputeResolution(settleProposal.proposalId, { decision: "REJECT", decisionReason: "证据摘要与控制面记录不完整，请补充后重新提案" }, mutation("finance-resolution", "reject-settle-resolution", "reject-settle-resolution-hash", openedAt));
    assert.equal(rejected.proposalStatus, "REJECTED");
    const revisedProposal = await hosting.requestDisputeResolution(settleSeed.contractId, { resolution: "SETTLE", expectedContractVersion: disputedSettle.version, requestReason: "已补齐 Agent 与控制面双端证据，六百秒有效服务一致", evidenceDigest: "5".repeat(64) }, mutation("root-resolution", "request-settle-resolution-v2", "request-settle-resolution-v2-hash", openedAt));
    assert.equal(revisedProposal.proposalVersion, 2);
    const settled = await decideAndExecuteHostingDispute({ proposalId: revisedProposal.proposalId, decision: "APPROVE", decisionReason: "独立复核双端计量一致，同意按六百秒实际服务结算", mutation: mutation("finance-resolution", "approve-settle-resolution", "approve-settle-resolution-hash", openedAt) }, stores);
    assert.equal(settled.ledger.resolution, "SETTLE");
    assert.equal(settled.ledger.settledMicros, 600_000);
    assert.equal(settled.ledger.supplierIncomeMicros, 540_000);
    const disputePlatformFeeMicros = settled.ledger.settledMicros - settled.ledger.supplierIncomeMicros;
    const disputePlatformNetMicros = disputePlatformFeeMicros - settled.ledger.commissionMicros;
    assert.equal(settled.ledger.settledMicros, settled.ledger.supplierIncomeMicros + settled.ledger.commissionMicros + disputePlatformNetMicros);
    assert.deepEqual((await cardHours.dashboard(buyer.activeOrganization.id, openedAt)).balance, { availableMicros: 6_600_000, heldMicros: 0, lifetimeTopupMicros: 7_200_000, lifetimeSpentMicros: 600_000 });
    assert.equal((await cardHours.dashboard(supplier.activeOrganization.id, openedAt)).balance.availableMicros, 540_000);
    refreshDevicePresence(path, settleSeed.deviceId, openedAt);
    const settleCleanup = await hosting.pollCommand(settleSeed.deviceId, openedAt);
    const settleClosed = await hosting.completeCommand(settleSeed.deviceId, settleCleanup.id, { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"4".repeat(64)}`, details: cleanupDetails(settleSeed.contractId, openedAt) }, mutation(`agent:${settleSeed.deviceId}`, "complete-settle-cleanup", "complete-settle-cleanup-hash", openedAt));
    assert.equal(settleClosed.contract.status, "CLEANED");
  } finally {
    cardHours.close();
    hosting.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("acceptance API never accepts client settlement or supplier identity fields", () => {
  const source = readFileSync("app/api/v2/contracts/[contractId]/accept/route.ts", "utf8");
  assert.match(source, /requireTradingAccountSession\(request\)/u);
  assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
  assert.match(source, /Object\.keys\(body\)\.length/u);
  assert.doesNotMatch(source, /x-kai-workspace-role/u);
  assert.doesNotMatch(source, /body\.(?:measuredSeconds|settledMicros|supplierIncomeMicros|commissionMicros|supplierOrganizationId)/u);
});

test("dispute API is buyer-scoped and accepts only a bounded reason", () => {
  const source = readFileSync("app/api/v2/contracts/[contractId]/dispute/route.ts", "utf8");
  assert.match(source, /requireTradingAccountSession\(request\)/u);
  assert.ok(source.indexOf("assertAccountAuthSameOrigin(request)") < source.indexOf("requireTradingAccountSession(request)"));
  assert.match(source, /Object\.keys\(body\)\.sort\(\)\.join\(","\) !== "reason"/u);
  assert.doesNotMatch(source, /x-kai-workspace-role|measuredSeconds|settledMicros|supplierOrganizationId/u);
});
