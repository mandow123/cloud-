import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createSqliteHostingV2Store } from "../lib/server/hosting-v2-store-sqlite.ts";

const NOW = "2026-08-15T04:00:00.000Z";
const VERIFIED_UNTIL = "2026-08-16T04:00:00.000Z";
const APPROVED_IMAGE = process.env.KAI_HOSTING_APPROVED_IMAGES;

function mutation(key) {
  return {
    actorId: "agent:had_retirement_bridge",
    idempotencyKey: key,
    payloadHash: `${key}-payload`,
    now: NOW,
  };
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
    publicHost: "retirement-bridge.example.com",
    sshPortStart: 25_000,
    sshPortEnd: 25_019,
  };
}

function temporaryDatabase(prefix) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { directory, path: join(directory, "hosting.sqlite") };
}

function seedMigrationVersion(path, version, { retirementTable = false } = {}) {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE hosting_v2_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.prepare("INSERT INTO hosting_v2_schema_migrations(version,applied_at) VALUES(13,?)").run(NOW);
  if (retirementTable) {
    db.exec(`CREATE TABLE hosting_v2_device_retirements (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL UNIQUE,
      organization_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('GRACEFUL','EMERGENCY')),
      status TEXT NOT NULL CHECK (status IN ('DRAINING','MANUAL_ACTION_REQUIRED','FINALIZED')),
      reason_code TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_digest TEXT,
      requested_by TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      finalized_by TEXT,
      finalized_at TEXT,
      version INTEGER NOT NULL DEFAULT 1
    )`);
  }
  if (version !== 13) db.prepare("INSERT INTO hosting_v2_schema_migrations(version,applied_at) VALUES(?,?)").run(version, NOW);
  db.close();
}

async function withStore(prefix, body) {
  const state = temporaryDatabase(prefix);
  const store = await createSqliteHostingV2Store(state.path);
  try {
    return await body({ ...state, store });
  } finally {
    store.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
}

function seedDevice(db, { status, verificationStatus = "PASSED", deviceId = "had_retirement_bridge" }) {
  db.prepare(`INSERT INTO hosting_v2_devices(
      id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,
      inventory_json,inventory_digest,status,verification_status,verification_evidence_digest,
      verified_until,last_sequence,last_seen_at,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,1,?,?)`).run(
    deviceId,
    "org-retirement-bridge",
    "acct-retirement-bridge",
    "Retirement Bridge 4090",
    `sha256:${"3".repeat(64)}`,
    "A".repeat(43),
    "1.9.5",
    JSON.stringify(inventory()),
    `sha256:${"4".repeat(64)}`,
    status,
    verificationStatus,
    verificationStatus === "PASSED" ? `sha256:${"5".repeat(64)}` : null,
    verificationStatus === "PASSED" ? VERIFIED_UNTIL : null,
    NOW,
    NOW,
    NOW,
  );
}

function seedCommand(db, { id, type, status = "PENDING", contractId = null, payload = {}, createdAt = NOW }) {
  db.prepare(`INSERT INTO hosting_v2_agent_commands(
      id,device_id,contract_id,command_type,payload_json,status,attempt,created_at
    ) VALUES(?,?,?,?,?,?,0,?)`).run(
    id,
    "had_retirement_bridge",
    contractId,
    type,
    JSON.stringify(payload),
    status,
    createdAt,
  );
}

function seedRetirementEvent(db) {
  db.prepare(`INSERT INTO hosting_v2_events(
      id,organization_id,entity_type,entity_id,event_type,actor_id,payload_digest,metadata_json,occurred_at
    ) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    "hve_retirement_bridge",
    "org-retirement-bridge",
    "DEVICE",
    "had_retirement_bridge",
    "DEVICE_RETIREMENT_REQUESTED",
    "acct-retirement-bridge",
    `sha256:${"6".repeat(64)}`,
    JSON.stringify({ mode: "GRACEFUL" }),
    NOW,
  );
}

function seedSuspendedOffer(db) {
  db.prepare(`INSERT INTO hosting_v2_offers(
      id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,
      card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,
      available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,'RTX_4090','中国·北京',3600000,180,3600,?,?,?,?, 'SUSPENDED',2,?,?)`).run(
    "hofr_retirement_bridge",
    "org-retirement-bridge",
    "had_retirement_bridge",
    "hfee_retirement_bridge",
    "Retirement Bridge RTX 4090",
    "2026-08-14T04:00:00.000Z",
    "2026-08-17T04:00:00.000Z",
    APPROVED_IMAGE,
    "KAI_HOSTING_TERMS_2026_08",
    NOW,
    NOW,
  );
}

function verificationDetails(challengeDigest) {
  const names = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"];
  return {
    protocolVersion: 1,
    inventoryDigest: `sha256:${"4".repeat(64)}`,
    observedAt: NOW,
    tests: names.map((name, index) => ({
      name,
      status: "PASSED",
      evidenceDigest: `sha256:${String(index + 1).repeat(64)}`,
      ...(name === "WORKLOAD_IMAGE" ? { summary: { protocolVersion: 1, scope: "APPROVED_WORKLOAD_IMAGES", images: [APPROVED_IMAGE], allPresent: true } } : {}),
      ...(name === "PORT_REACHABILITY" ? { summary: { port: 25_000, scope: "CONTROL_PLANE_CHALLENGE", challengeDigest } } : {}),
    })),
  };
}

function cleanupDetails() {
  return {
    protocolVersion: 1,
    contractId: "hctr_retirement_bridge",
    containerDigest: `sha256:${"7".repeat(64)}`,
    cleanupDigest: `sha256:${"8".repeat(64)}`,
    containerRemoved: true,
    authorizedKeyRemoved: true,
    workspaceRemoved: true,
    cleanedAt: NOW,
    cleanupStatus: "CLEANED",
    observedAt: NOW,
  };
}

test("schema14 runtime safely upgrades a schema13 bridge database and creates the additive retirement table", async () => {
  const state = temporaryDatabase("kai-hosting-retirement-schema13-");
  seedMigrationVersion(state.path, 13);
  const store = await createSqliteHostingV2Store(state.path);
  try {
    const snapshot = await store.readiness(NOW);
    assert.equal(snapshot.schemaVersion, 14);
    const db = new DatabaseSync(state.path);
    assert.equal(db.prepare("SELECT MAX(version) version FROM hosting_v2_schema_migrations").get().version, 14);
    const columns = db.prepare("PRAGMA table_info(hosting_v2_device_retirements)").all().map((row) => row.name);
    for (const field of ["device_id", "organization_id", "mode", "status", "requested_at", "finalized_at"]) {
      assert.ok(columns.includes(field), `missing bridge-critical field ${field}`);
    }
    db.close();
  } finally {
    store.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("schema14 runtime accepts an already migrated additive retirement database", async () => {
  const state = temporaryDatabase("kai-hosting-retirement-schema14-");
  seedMigrationVersion(state.path, 14, { retirementTable: true });
  let store;
  try {
    store = await createSqliteHostingV2Store(state.path);
    const snapshot = await store.readiness(NOW);
    assert.equal(snapshot.schemaVersion, 14);
    const db = new DatabaseSync(state.path);
    assert.equal(db.prepare("SELECT MAX(version) version FROM hosting_v2_schema_migrations").get().version, 14);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM hosting_v2_device_retirements").get().count, 0);
    db.close();
  } finally {
    store?.close();
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("schema13 bridge rejects an unknown schema15 database", async () => {
  const state = temporaryDatabase("kai-hosting-retirement-schema15-");
  seedMigrationVersion(state.path, 15, { retirementTable: true });
  try {
    await assert.rejects(
      createSqliteHostingV2Store(state.path),
      (error) => error instanceof Error && /HOSTING_V2_SCHEMA_(?:TOO_NEW|MISMATCH)/u.test(error.message),
    );
  } finally {
    rmSync(state.directory, { recursive: true, force: true });
  }
});

test("a REVOKED device cannot poll commands", async () => withStore("kai-hosting-retirement-revoked-poll-", async ({ path, store }) => {
  const db = new DatabaseSync(path);
  seedDevice(db, { status: "REVOKED", verificationStatus: "EXPIRED" });
  seedCommand(db, { id: "hcmd_revoked_poll", type: "VERIFY" });
  db.close();

  await assert.rejects(store.pollCommand("had_retirement_bridge", NOW));
}));

test("a REVOKED device cannot complete commands", async () => withStore("kai-hosting-retirement-revoked-complete-", async ({ path, store }) => {
  const db = new DatabaseSync(path);
  seedDevice(db, { status: "REVOKED", verificationStatus: "EXPIRED" });
  seedCommand(db, { id: "hcmd_revoked_complete", type: "VERIFY" });
  db.close();

  await assert.rejects(store.completeCommand(
    "had_retirement_bridge",
    "hcmd_revoked_complete",
    { outcome: "FAILED", evidenceDigest: `sha256:${"9".repeat(64)}`, errorCode: "DEVICE_REVOKED", details: { errorCode: "DEVICE_REVOKED" } },
    mutation("revoked-complete"),
  ));
}));

test("a DRAINING device polls only STOP or CLEANUP even when an older unsafe command is pending", async () => withStore("kai-hosting-retirement-draining-poll-", async ({ path, store }) => {
  const db = new DatabaseSync(path);
  seedDevice(db, { status: "DRAINING" });
  seedCommand(db, { id: "hcmd_draining_verify", type: "VERIFY", createdAt: "2026-08-15T03:57:00.000Z" });
  seedCommand(db, { id: "hcmd_draining_start", type: "START", createdAt: "2026-08-15T03:58:00.000Z" });
  seedCommand(db, { id: "hcmd_draining_stop", type: "STOP", createdAt: "2026-08-15T03:59:00.000Z" });
  seedCommand(db, { id: "hcmd_draining_cleanup", type: "CLEANUP", createdAt: NOW });
  db.close();

  const command = await store.pollCommand("had_retirement_bridge", NOW);
  assert.ok(command && ["STOP", "CLEANUP"].includes(command.type), `DRAINING device received unsafe ${command?.type ?? "null"} command`);
}));

test("a DRAINING device cannot complete VERIFY, PROVISION, or START", async () => {
  for (const type of ["VERIFY", "PROVISION", "START"]) {
    await withStore(`kai-hosting-retirement-draining-${type.toLowerCase()}-`, async ({ path, store }) => {
      const db = new DatabaseSync(path);
      seedDevice(db, { status: "DRAINING" });
      const commandId = `hcmd_draining_${type.toLowerCase()}`;
      seedCommand(db, { id: commandId, type });
      db.close();

      await assert.rejects(store.completeCommand(
        "had_retirement_bridge",
        commandId,
        { outcome: "FAILED", evidenceDigest: `sha256:${"a".repeat(64)}`, errorCode: "DEVICE_DRAINING", details: { errorCode: "DEVICE_DRAINING" } },
        mutation(`draining-complete-${type.toLowerCase()}`),
      ));
    });
  }
});

test("late VERIFY after DEVICE_RETIREMENT_REQUESTED cannot revive the device or its offer", async () => withStore("kai-hosting-retirement-late-verify-", async ({ path, store }) => {
  const db = new DatabaseSync(path);
  seedDevice(db, { status: "DRAINING", verificationStatus: "PENDING" });
  seedSuspendedOffer(db);
  seedRetirementEvent(db);
  const challenge = "b".repeat(32);
  const challengeDigest = `sha256:${"c".repeat(64)}`;
  seedCommand(db, {
    id: "hcmd_late_verify",
    type: "VERIFY",
    payload: {
      expectedInventoryDigest: `sha256:${"4".repeat(64)}`,
      tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"],
      approvedImages: [APPROVED_IMAGE],
      reachabilityChallenge: challenge,
    },
  });
  db.close();

  try {
    await store.completeCommand(
      "had_retirement_bridge",
      "hcmd_late_verify",
      { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"d".repeat(64)}`, controlPlaneReachabilityDigest: challengeDigest, details: verificationDetails(challengeDigest) },
      mutation("late-verify"),
    );
  } catch (error) {
    assert.match(String(error?.code ?? error?.message), /AGENT_DEVICE_INVALID|EXCHANGE_(?:NOT_FOUND|STATE_CONFLICT)/u);
  }

  const device = await store.getDevice("had_retirement_bridge");
  assert.ok(device && ["DRAINING", "REVOKED"].includes(device.status), `late VERIFY revived device as ${device?.status ?? "missing"}`);
  assert.equal((await store.getOffer("hofr_retirement_bridge")).status, "SUSPENDED");
}));

test("late CLEANUP after DEVICE_RETIREMENT_REQUESTED records cleanup without reviving or relisting", async () => withStore("kai-hosting-retirement-late-cleanup-", async ({ path, store }) => {
  const db = new DatabaseSync(path);
  seedDevice(db, { status: "DRAINING" });
  seedSuspendedOffer(db);
  seedRetirementEvent(db);

  db.prepare(`INSERT INTO hosting_v2_agent_commands(
      id,device_id,contract_id,command_type,payload_json,status,attempt,evidence_digest,
      created_at,delivered_at,completed_at
    ) VALUES(?,?,NULL,'VERIFY',?,'SUCCEEDED',1,?,?,?,?)`).run(
    "hcmd_prior_verification",
    "had_retirement_bridge",
    JSON.stringify({ approvedImages: [APPROVED_IMAGE] }),
    `sha256:${"5".repeat(64)}`,
    "2026-08-15T03:00:00.000Z",
    "2026-08-15T03:00:00.000Z",
    "2026-08-15T03:01:00.000Z",
  );
  db.prepare(`INSERT INTO hosting_v2_verification_proofs(
      command_id,device_id,agent_evidence_digest,control_plane_reachability_digest,public_host,public_port,recorded_at
    ) VALUES(?,?,?,?,?,?,?)`).run(
    "hcmd_prior_verification",
    "had_retirement_bridge",
    `sha256:${"5".repeat(64)}`,
    `sha256:${"f".repeat(64)}`,
    "retirement-bridge.example.com",
    25_000,
    "2026-08-15T03:01:00.000Z",
  );

  const snapshot = {
    title: "Retirement Bridge RTX 4090",
    gpuModel: "RTX_4090",
    region: "中国·北京",
    cardHourMicrosPerGpuHour: 3_600_000,
    approvedImage: APPROVED_IMAGE,
    termsVersion: "KAI_HOSTING_TERMS_2026_08",
    platformFeeBps: 100,
    referralRewardBps: 0,
    acceptanceWindowSeconds: 1_800,
  };
  db.prepare(`INSERT INTO hosting_v2_contracts(
      id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,
      fee_schedule_id,snapshot_json,reserved_seconds,measured_seconds,held_micros,settled_micros,
      supplier_income_micros,commission_micros,status,idempotency_key,payload_hash,version,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,3600,600,3600000,600000,594000,6000,'CLEANING',?,?,4,?,?)`).run(
    "hctr_retirement_bridge",
    "hofr_retirement_bridge",
    "had_retirement_bridge",
    "org-retirement-buyer",
    "acct-retirement-buyer",
    "org-retirement-bridge",
    "hfee_retirement_bridge",
    JSON.stringify(snapshot),
    "seed-retirement-contract",
    "seed-retirement-contract-payload",
    NOW,
    NOW,
  );
  db.prepare(`INSERT INTO hosting_v2_instances(
      contract_id,device_id,provision_command_id,approved_image,endpoint_display,container_digest,
      workspace_digest,status,provision_evidence_digest,start_evidence_digest,stop_evidence_digest,
      provisioned_at,started_at,stopped_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'STOPPED',?,?,?,?,?,?,?)`).run(
    "hctr_retirement_bridge",
    "had_retirement_bridge",
    "hcmd_retirement_provision",
    APPROVED_IMAGE,
    "retirement-bridge.example.com:25000",
    `sha256:${"7".repeat(64)}`,
    `sha256:${"e".repeat(64)}`,
    `sha256:${"1".repeat(64)}`,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    "2026-08-15T02:00:00.000Z",
    "2026-08-15T02:05:00.000Z",
    "2026-08-15T03:05:00.000Z",
    NOW,
  );
  seedCommand(db, {
    id: "hcmd_late_cleanup",
    type: "CLEANUP",
    contractId: "hctr_retirement_bridge",
    payload: { contractId: "hctr_retirement_bridge", removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true },
  });
  db.close();

  const result = await store.completeCommand(
    "had_retirement_bridge",
    "hcmd_late_cleanup",
    { outcome: "SUCCEEDED", evidenceDigest: `sha256:${"8".repeat(64)}`, details: cleanupDetails() },
    mutation("late-cleanup"),
  );

  assert.equal(result.command.status, "SUCCEEDED", "trusted graceful cleanup evidence should still be recorded");
  assert.ok(["DRAINING", "REVOKED"].includes(result.device.status), `late CLEANUP revived device as ${result.device.status}`);
  assert.equal((await store.getOffer("hofr_retirement_bridge")).status, "SUSPENDED");
}));
