import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { acceptHostingContract } from "../lib/server/hosting-contract-service.ts";
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

function seedStoppedContract(path, suffix, buyer, supplier, now) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  const deviceId = `had_settlement_${suffix}`;
  const offerId = `hofr_settlement_${suffix}`;
  const contractId = `hctr_settlement_${suffix}`;
  const feeId = "hfee_settlement";
  const inventory = { hostnameDigest: `sha256:${"1".repeat(64)}`, gpuModel: "RTX_4090", gpuUuidDigest: `sha256:${suffix.padEnd(64, "2").slice(0, 64)}`, gpuMemoryMiB: 24_576, driverVersion: "580.10", cudaVersion: "13.0", cpuModel: "AMD Ryzen 9 9950X", memoryMiB: 65_536, storageGiB: 2_048, publicHost: `${suffix}.settlement-gpu.example.com`, sshPortStart: 26_000, sshPortEnd: 26_019 };
  db.prepare("INSERT OR IGNORE INTO hosting_v2_supplier_profiles(organization_id,account_id,supplier_type,legal_display_name,contact_email,agreement_version,status,version,created_at,updated_at) VALUES(?,?,'INDIVIDUAL','结算测试供应方',?,'KAI_HOSTING_2026_08','APPROVED',3,?,?)").run(supplier.activeOrganization.id, supplier.account.id, supplier.account.primaryEmail, now, now);
  db.prepare("INSERT OR IGNORE INTO hosting_v2_fee_schedules(id,platform_fee_bps,referral_reward_bps,status,effective_from,created_by,created_at) VALUES(?,1000,300,'ACTIVE',?,'admin-market',?)").run(feeId, now, now);
  db.prepare(`INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,verified_until,last_sequence,last_seen_at,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED','PASSED',?,?,1,?,1,?,?)`).run(deviceId, supplier.activeOrganization.id, supplier.account.id, `Settlement GPU ${suffix}`, `sha256:${suffix.padEnd(64, "3").slice(0, 64)}`, "A".repeat(43), "1.3.0", JSON.stringify(inventory), `sha256:${suffix.padEnd(64, "4").slice(0, 64)}`, `sha256:${suffix.padEnd(64, "5").slice(0, 64)}`, new Date(Date.parse(now) + 86_400_000).toISOString(), now, now, now);
  db.prepare(`INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
    VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,'KAI_HOSTING_TERMS_2026_08','RESERVED',2,?,?)`).run(offerId, supplier.activeOrganization.id, deviceId, feeId, `Settlement RTX 4090 ${suffix}`, new Date(Date.parse(now) - 60_000).toISOString(), new Date(Date.parse(now) + 86_400_000).toISOString(), process.env.KAI_HOSTING_APPROVED_IMAGES, now, now);
  const snapshot = { title: `Settlement RTX 4090 ${suffix}`, gpuModel: "RTX_4090", region: "中国·北京", cardHourMicrosPerGpuHour: 3_600_000, approvedImage: process.env.KAI_HOSTING_APPROVED_IMAGES, termsVersion: "KAI_HOSTING_TERMS_2026_08", platformFeeBps: 1_000, referralRewardBps: 300 };
  db.prepare(`INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,status,started_at,stopped_at,idempotency_key,payload_hash,version,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,3600,600,3600000,'AWAITING_ACCEPTANCE',?,?,?, ?,5,?,?)`).run(contractId, offerId, deviceId, buyer.activeOrganization.id, buyer.account.id, supplier.activeOrganization.id, feeId, JSON.stringify(snapshot), new Date(Date.parse(now) - 600_000).toISOString(), now, `seed-settlement-${suffix}`, `seed-settlement-hash-${suffix}`, now, now);
  db.close();
  return { contractId, deviceId, offerId };
}

test("buyer acceptance settles actual card-hours, vests income and relists only after cleanup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-hosting-settlement-"));
  const path = join(directory, "settlement.sqlite");
  const hosting = await createSqliteHostingV2Store(path);
  const cardHours = await createSqliteCardHourStore(path);
  const buyer = account("settlement-buyer");
  const supplier = account("settlement-supplier");
  const referrer = account("settlement-referrer");
  const stores = { hosting, cardHours };
  try {
    const now = new Date().toISOString();
    const seeded = seedStoppedContract(path, "success", buyer, supplier, now);
    const grant = await cardHours.requestTrialGrant({ organizationId: buyer.activeOrganization.id, amountMicros: 5_000_000, reason: "内部结算清理闭环验收", requestedBy: "admin-settlement-requester", idempotencyKey: "settlement-trial-grant", payloadHash: "settlement-trial-grant-hash", now });
    await cardHours.decideTrialGrant({ grantId: grant.id, decision: "APPROVE", approvedBy: "admin-settlement-approver", payloadHash: "settlement-trial-approval-hash", now });
    const referral = await cardHours.dashboard(referrer.activeOrganization.id, now);
    await cardHours.attachReferral({ account: buyer, code: referral.referral.code, now });
    await cardHours.holdHostingOrder({ account: buyer, orderId: seeded.contractId, amountMicros: 3_600_000, idempotencyKey: `hosting-hold:${seeded.contractId}`, payloadHash: "settlement-hold-hash", now });

    await assert.rejects(acceptHostingContract({ account: supplier, contractId: seeded.contractId, mutation: mutation(supplier.account.id, "supplier-cannot-accept", "supplier-cannot-accept-hash", now) }, stores), (error) => error.code === "EXCHANGE_OWNERSHIP_FORBIDDEN");
    const acceptInput = { account: buyer, contractId: seeded.contractId, mutation: mutation(buyer.account.id, "buyer-accept-0001", "buyer-accept-hash", now) };
    const accepted = await acceptHostingContract(acceptInput, stores);
    assert.equal(accepted.contract.status, "CLEANING");
    assert.deepEqual(accepted.settlement, { heldMicros: 3_600_000, settledMicros: 600_000, releasedMicros: 3_000_000, supplierIncomeMicros: 540_000, commissionMicros: 18_000, platformFeeMicros: 60_000 });
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

    const expiredSeed = seedStoppedContract(path, "expired", buyer, supplier, now);
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
