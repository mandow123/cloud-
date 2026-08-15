import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";
import { isHostingV2DeviceRetirementEnabled } from "../lib/server/hosting-v2-feature.ts";
import { POST as requestSupplierRetirement } from "../app/api/v2/supply/devices/[deviceId]/retirement/route.ts";
import { POST as requestEmergencyRetirement } from "../app/api/v2/admin/hosting/devices/[deviceId]/retirement/route.ts";

const NOW = "2026-08-15T05:00:00.000Z";
const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function mutation(actorId, key, hash = `${key}-hash`) {
  return { actorId, idempotencyKey: key, payloadHash: hash, now: NOW };
}

function seedDevice(path, suffix, { withOffer = true, withContract = false, withCommand = false } = {}) {
  const db = new DatabaseSync(path);
  const deviceId = `had_retirement_${suffix}`;
  const offerId = `hofr_retirement_${suffix}`;
  try {
    db.prepare(`INSERT INTO hosting_v2_devices(
      id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,
      inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,
      verified_until,last_sequence,last_seen_at,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'VERIFIED','PASSED',?,?,1,?,1,?,?)`).run(
      deviceId,
      "org-retirement-owner",
      "acct-retirement-owner",
      `Retirement ${suffix}`,
      `sha256:${suffix.padEnd(64, "1").slice(0, 64)}`,
      suffix.toUpperCase().padEnd(43, "A").slice(0, 43),
      "1.9.7",
      JSON.stringify({ gpuModel: "RTX_4090" }),
      `sha256:${suffix.padEnd(64, "2").slice(0, 64)}`,
      `sha256:${suffix.padEnd(64, "3").slice(0, 64)}`,
      "2026-08-16T05:00:00.000Z",
      NOW,
      NOW,
      NOW,
    );
    if (withOffer) {
      db.prepare(`INSERT INTO hosting_v2_offers(
        id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,
        min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
      ) VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,?, 'PUBLISHED',1,?,?)`).run(
        offerId,
        "org-retirement-owner",
        deviceId,
        "hfee-retirement",
        `Retirement ${suffix}`,
        "2026-08-14T05:00:00.000Z",
        "2026-08-16T05:00:00.000Z",
        process.env.KAI_HOSTING_APPROVED_IMAGES,
        "KAI_HOSTING_TERMS_2026_08",
        NOW,
        NOW,
      );
    }
    if (withContract) {
      db.prepare(`INSERT INTO hosting_v2_contracts(
        id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,
        snapshot_json,reserved_seconds,held_micros,status,idempotency_key,payload_hash,version,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,'{}',180,180000,'RESERVED',?,?,1,?,?)`).run(
        `hctr_retirement_${suffix}`,
        offerId,
        deviceId,
        "org-retirement-buyer",
        "acct-retirement-buyer",
        "org-retirement-owner",
        "hfee-retirement",
        `seed-contract-${suffix}`,
        `seed-contract-${suffix}-hash`,
        NOW,
        NOW,
      );
    }
    if (withCommand) {
      db.prepare(`INSERT INTO hosting_v2_agent_commands(
        id,device_id,contract_id,command_type,payload_json,status,attempt,created_at
      ) VALUES(?,?,NULL,'VERIFY','{}','PENDING',0,?)`).run(`hcmd_retirement_${suffix}`, deviceId, NOW);
    }
  } finally {
    db.close();
  }
  return { deviceId, offerId, contractId: `hctr_retirement_${suffix}`, commandId: `hcmd_retirement_${suffix}` };
}

async function withStore(prefix, body) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  const path = join(directory, "hosting.sqlite");
  const store = await createSqliteHostingV2Store(path);
  try {
    return await body({ store, path });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("supplier graceful retirement is owner-scoped, idempotent and Root-finalized", async () => withStore("kai-retirement-graceful-", async ({ store, path }) => {
  const seeded = seedDevice(path, "graceful", { withCommand: true });
  const input = {
    mode: "GRACEFUL",
    expectedDeviceVersion: 1,
    reasonCode: "SUPPLIER_REQUEST",
    reason: "供应方确认设备本轮订单结束后永久退出托管。",
    evidenceDigest: null,
  };
  const requestMutation = mutation("acct-retirement-owner", "retirement-graceful-request");
  const requested = await store.requestDeviceRetirement("org-retirement-owner", seeded.deviceId, input, requestMutation);
  assert.equal(requested.retirement.status, "DRAINING");
  assert.equal(requested.retirement.mode, "GRACEFUL");
  assert.equal(requested.device.status, "DRAINING");
  assert.equal(requested.device.verificationStatus, "EXPIRED");
  assert.equal((await store.getOffer(seeded.offerId)).status, "SUSPENDED");
  assert.equal((await store.getCommand(seeded.deviceId, seeded.commandId)).status, "FAILED");
  assert.equal((await store.getCommand(seeded.deviceId, seeded.commandId)).errorCode, "DEVICE_RETIREMENT_REQUESTED");
  assert.equal((await store.getDeviceRetirement("org-other", seeded.deviceId)), null);

  const replayed = await store.requestDeviceRetirement("org-retirement-owner", seeded.deviceId, input, requestMutation);
  assert.equal(replayed.retirement.id, requested.retirement.id);
  await assert.rejects(
    store.requestDeviceRetirement("org-retirement-owner", seeded.deviceId, { ...input, reason: `${input.reason}篡改` }, { ...requestMutation, payloadHash: "tampered-hash" }),
    (error) => error.name === "ExchangeIdempotencyConflictError",
  );

  const evidenceDigest = "a".repeat(64);
  const finalized = await store.finalizeDeviceRetirement(seeded.deviceId, {
    expectedDeviceVersion: 2,
    expectedRetirementVersion: 1,
    evidenceDigest,
    finalizationReason: "Root 已核验 Agent 撤权、端口关闭和设备离场证据。",
  }, mutation("admin-root", "retirement-graceful-finalize"));
  assert.equal(finalized.retirement.status, "FINALIZED");
  assert.equal(finalized.retirement.evidenceDigest, evidenceDigest);
  assert.equal(finalized.retirement.finalizedBy, "admin-root");
  assert.equal(finalized.device.status, "REVOKED");
  const replayedFinalization = await store.finalizeDeviceRetirement(seeded.deviceId, {
    expectedDeviceVersion: 2,
    expectedRetirementVersion: 1,
    evidenceDigest,
    finalizationReason: "Root 已核验 Agent 撤权、端口关闭和设备离场证据。",
  }, mutation("admin-root", "retirement-graceful-finalize"));
  assert.equal(replayedFinalization.retirement.id, finalized.retirement.id);

  const db = new DatabaseSync(path);
  try {
    const eventTypes = db.prepare("SELECT event_type FROM hosting_v2_events WHERE entity_type='DEVICE' AND entity_id=? ORDER BY occurred_at,id").all(seeded.deviceId).map((row) => row.event_type);
    assert.ok(eventTypes.includes("DEVICE_RETIREMENT_REQUESTED"));
    assert.ok(eventTypes.includes("DEVICE_CREDENTIAL_REVOKED"));
    assert.ok(eventTypes.includes("DEVICE_RETIREMENT_FINALIZED"));
    assert.equal(db.prepare("SELECT COUNT(*) count FROM hosting_v2_command_receipts WHERE entity_type='DEVICE_RETIREMENT'").get().count, 2);
  } finally {
    db.close();
  }
}));

test("graceful retirement fails closed while a contract is unfinished", async () => withStore("kai-retirement-contract-", async ({ store, path }) => {
  const seeded = seedDevice(path, "contract", { withContract: true });
  await assert.rejects(
    store.requestDeviceRetirement("org-retirement-owner", seeded.deviceId, {
      mode: "GRACEFUL",
      expectedDeviceVersion: 1,
      reasonCode: "SUPPLIER_REQUEST",
      reason: "供应方申请退出，但当前仍有未完成合同。",
    }, mutation("acct-retirement-owner", "retirement-blocked-contract")),
    (error) => error.code === "EXCHANGE_STATE_CONFLICT",
  );
  assert.equal((await store.getDevice(seeded.deviceId)).status, "VERIFIED");
  assert.equal(await store.getDeviceRetirement("org-retirement-owner", seeded.deviceId), null);
}));

test("concurrent retirement requests persist one record and preserve idempotent replay", async () => withStore("kai-retirement-race-", async ({ store, path }) => {
  const sameRequest = seedDevice(path, "same_request");
  const input = {
    mode: "GRACEFUL",
    expectedDeviceVersion: 1,
    reasonCode: "HARDWARE_FAILURE",
    reason: "设备硬件故障，申请结束托管并完成受控退场。",
  };
  const context = mutation("acct-retirement-owner", "retirement-same-request");
  const sameResults = await Promise.all([
    store.requestDeviceRetirement("org-retirement-owner", sameRequest.deviceId, input, context),
    store.requestDeviceRetirement("org-retirement-owner", sameRequest.deviceId, input, context),
  ]);
  assert.equal(sameResults[0].retirement.id, sameResults[1].retirement.id);

  const competing = seedDevice(path, "competing");
  const competingResults = await Promise.allSettled([
    store.requestDeviceRetirement("org-retirement-owner", competing.deviceId, input, mutation("acct-retirement-owner", "retirement-competing-a")),
    store.requestDeviceRetirement("org-retirement-owner", competing.deviceId, input, mutation("acct-retirement-owner", "retirement-competing-b")),
  ]);
  assert.equal(competingResults.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = competingResults.find((result) => result.status === "rejected");
  assert.ok(rejected && ["EXCHANGE_STATE_CONFLICT", "EXCHANGE_VERSION_CONFLICT"].includes(rejected.reason.code));
  const db = new DatabaseSync(path);
  try {
    assert.equal(db.prepare("SELECT COUNT(*) count FROM hosting_v2_device_retirements WHERE device_id=?").get(competing.deviceId).count, 1);
  } finally {
    db.close();
  }
}));

test("Root emergency retirement revokes credentials, terminates queued commands and requires manual closeout", async () => withStore("kai-retirement-emergency-", async ({ store, path }) => {
  const seeded = seedDevice(path, "emergency", { withContract: true, withCommand: true });
  const evidenceDigest = "b".repeat(64);
  await assert.rejects(
    store.requestDeviceRetirement("org-retirement-owner", seeded.deviceId, {
      mode: "EMERGENCY",
      expectedDeviceVersion: 1,
      reasonCode: "SECURITY_INCIDENT",
      reason: "检测到设备私钥可能泄露，立即撤销。",
      evidenceDigest,
    }, mutation("acct-retirement-owner", "retirement-emergency-forbidden")),
    (error) => error.code === "EXCHANGE_ROLE_FORBIDDEN",
  );
  const requested = await store.requestDeviceRetirement(null, seeded.deviceId, {
    mode: "EMERGENCY",
    expectedDeviceVersion: 1,
    reasonCode: "SECURITY_INCIDENT",
    reason: "检测到设备私钥可能泄露，立即撤销并转人工处理。",
    evidenceDigest,
  }, mutation("admin-root", "retirement-emergency-request"));
  assert.equal(requested.retirement.status, "MANUAL_ACTION_REQUIRED");
  assert.equal(requested.device.status, "REVOKED");
  assert.equal((await store.getCommand(seeded.deviceId, seeded.commandId)).status, "FAILED");
  assert.equal((await store.getCommand(seeded.deviceId, seeded.commandId)).errorCode, "DEVICE_CREDENTIAL_REVOKED");
  await assert.rejects(
    store.finalizeDeviceRetirement(seeded.deviceId, {
      expectedDeviceVersion: 2,
      expectedRetirementVersion: 1,
      evidenceDigest,
      finalizationReason: "Root 尝试在活动合同未关闭时完成退场。",
    }, mutation("admin-root", "retirement-emergency-finalize-blocked")),
    (error) => error.code === "EXCHANGE_STATE_CONFLICT",
  );

  const db = new DatabaseSync(path);
  db.prepare("UPDATE hosting_v2_contracts SET status='CANCELLED',version=version+1,updated_at=? WHERE id=?").run(NOW, seeded.contractId);
  db.close();
  const finalized = await store.finalizeDeviceRetirement(seeded.deviceId, {
    expectedDeviceVersion: 2,
    expectedRetirementVersion: 1,
    evidenceDigest,
    finalizationReason: "Root 已人工关闭关联合同并确认设备访问全部撤销。",
  }, mutation("admin-root", "retirement-emergency-finalize"));
  assert.equal(finalized.retirement.status, "FINALIZED");
  assert.equal(finalized.device.status, "REVOKED");
}));

test("retirement HTTP boundaries keep supplier ownership and emergency/finalization Root-only", async () => {
  const previousSetup = process.env.KAI_HOSTING_V2_SETUP;
  const previousRetirement = process.env.KAI_HOSTING_DEVICE_RETIREMENT;
  process.env.KAI_HOSTING_V2_SETUP = "1";
  process.env.KAI_HOSTING_DEVICE_RETIREMENT = "1";
  try {
    assert.equal(isHostingV2DeviceRetirementEnabled(), true);
    const supplierResponse = await requestSupplierRetirement(new Request("https://cloud.kai.com/api/v2/supply/devices/had_retirement_http/retirement", {
      method: "POST",
      headers: { origin: "https://cloud.kai.com", "sec-fetch-site": "same-origin", "content-type": "application/json", "idempotency-key": "retirement-http-supplier" },
      body: JSON.stringify({ expectedDeviceVersion: 1, reasonCode: "SUPPLIER_REQUEST", reason: "供应方发起受控退场测试。" }),
    }), { params: Promise.resolve({ deviceId: "had_retirement_http" }) });
    assert.equal(supplierResponse.status, 401);

    const adminResponse = await requestEmergencyRetirement(new Request("https://cloud.kai.com/api/v2/admin/hosting/devices/had_retirement_http/retirement", {
      method: "POST",
      headers: { origin: "https://cloud.kai.com", "sec-fetch-site": "same-origin", "content-type": "application/json", "idempotency-key": "retirement-http-emergency" },
      body: JSON.stringify({ expectedDeviceVersion: 1, reasonCode: "ADMIN_EMERGENCY", reason: "Root 紧急撤权边界测试。", evidenceDigest: "c".repeat(64) }),
    }), { params: Promise.resolve({ deviceId: "had_retirement_http" }) });
    assert.equal(adminResponse.status, 401);
  } finally {
    if (previousSetup === undefined) delete process.env.KAI_HOSTING_V2_SETUP; else process.env.KAI_HOSTING_V2_SETUP = previousSetup;
    if (previousRetirement === undefined) delete process.env.KAI_HOSTING_DEVICE_RETIREMENT; else process.env.KAI_HOSTING_DEVICE_RETIREMENT = previousRetirement;
  }

  const supplier = source("app/api/v2/supply/devices/[deviceId]/retirement/route.ts");
  assert.match(supplier, /requireTradingAccountSession\(request\)/u);
  assert.match(supplier, /requestDeviceRetirement\(account\.activeOrganization\.id/u);
  assert.match(supplier, /mode: "GRACEFUL"/u);
  assert.doesNotMatch(supplier, /x-kai-workspace-role/u);
  const emergency = source("app/api/v2/admin/hosting/devices/[deviceId]/retirement/route.ts");
  const finalize = source("app/api/v2/admin/hosting/devices/[deviceId]/retirement/finalize/route.ts");
  for (const route of [emergency, finalize]) {
    assert.ok(route.indexOf("assertAccountAuthSameOrigin(request)") < route.indexOf("requireAdminPermission(request"));
    assert.match(route, /principal\.roles\.includes\("ROOT"\)/u);
    assert.doesNotMatch(route, /x-kai-workspace-role/u);
  }
});
