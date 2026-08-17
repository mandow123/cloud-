import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  HOSTING_V2_SCHEMA_COMPATIBILITY_VERSION,
  HOSTING_V2_SCHEMA_VERSION,
  hostingV2SchemaStatements,
} from "../db/hosting-v2-schema.ts";

const localMigration = readFileSync(new URL("../drizzle/0028_hosting_device_retirements.sql", import.meta.url), "utf8");
const hostedMigration = readFileSync(new URL("../.openai/drizzle/0028_hosting_device_retirements.sql", import.meta.url), "utf8");

function insertRetirement(db, overrides = {}) {
  const value = {
    id: "hdrt_migration",
    deviceId: "hdev_migration",
    organizationId: "org_migration",
    mode: "GRACEFUL",
    status: "DRAINING",
    reasonCode: "SUPPLIER_REQUEST",
    reason: "Supplier requested a controlled retirement.",
    evidenceDigest: null,
    requestedBy: "acct_migration",
    requestedAt: "2026-08-15T04:30:00.000Z",
    finalizedBy: null,
    finalizedAt: null,
    version: 1,
    ...overrides,
  };
  return db.prepare(`INSERT INTO hosting_v2_device_retirements(
    id,device_id,organization_id,mode,status,reason_code,reason,evidence_digest,
    requested_by,requested_at,finalized_by,finalized_at,version
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    value.id,
    value.deviceId,
    value.organizationId,
    value.mode,
    value.status,
    value.reasonCode,
    value.reason,
    value.evidenceDigest,
    value.requestedBy,
    value.requestedAt,
    value.finalizedBy,
    value.finalizedAt,
    value.version,
  );
}

function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE hosting_v2_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  db.prepare("INSERT INTO hosting_v2_schema_migrations(version,applied_at) VALUES(13,?)").run("2026-08-15T04:00:00.000Z");
  db.exec(localMigration);
  return db;
}

test("device retirement migration remains additive and registered in the current schema", () => {
  assert.equal(localMigration, hostedMigration);
  assert.match(localMigration, /CREATE TABLE IF NOT EXISTS hosting_v2_device_retirements/u);
  assert.match(localMigration, /device_id TEXT NOT NULL UNIQUE/u);
  assert.match(localMigration, /organization_id TEXT NOT NULL/u);
  assert.match(localMigration, /mode TEXT NOT NULL CHECK \(mode IN \('GRACEFUL','EMERGENCY'\)\)/u);
  assert.match(localMigration, /status TEXT NOT NULL CHECK \(status IN \('DRAINING','MANUAL_ACTION_REQUIRED','FINALIZED'\)\)/u);
  assert.match(localMigration, /requested_at TEXT NOT NULL/u);
  assert.match(localMigration, /finalized_at TEXT/u);
  assert.match(localMigration, /retirement_identity_immutable/u);
  assert.match(localMigration, /retirement_status_guard/u);
  assert.match(localMigration, /retirement_immutable_delete/u);
  assert.match(localMigration, /VALUES\(14,datetime\('now'\)\)/u);
  assert.doesNotMatch(localMigration, /\bDROP\b|\bDELETE\s+FROM\b|\bALTER\s+TABLE\s+\w+\s+DROP\b/iu);

  assert.equal(HOSTING_V2_SCHEMA_VERSION, 16);
  assert.equal(HOSTING_V2_SCHEMA_COMPATIBILITY_VERSION, 16);
  const runtimeSchema = hostingV2SchemaStatements.join("\n");
  assert.match(runtimeSchema, /CREATE TABLE IF NOT EXISTS hosting_v2_device_retirements/u);
  assert.match(runtimeSchema, /hosting_v2_device_retirement_status_guard/u);
});

test("schema 14 retirement records enforce required columns, uniqueness and terminal finalization", () => {
  const db = migratedDatabase();
  try {
    const columns = db.prepare("PRAGMA table_info(hosting_v2_device_retirements)").all().map((row) => row.name);
    for (const field of ["device_id", "organization_id", "mode", "status", "requested_at", "finalized_at"]) {
      assert.ok(columns.includes(field), `missing bridge-critical field ${field}`);
    }
    assert.equal(db.prepare("SELECT MAX(version) version FROM hosting_v2_schema_migrations").get().version, 14);

    insertRetirement(db);
    assert.throws(() => insertRetirement(db, { id: "hdrt_duplicate" }), /UNIQUE constraint failed/u);
    assert.throws(() => insertRetirement(db, { id: "hdrt_bad_mode", deviceId: "hdev_bad_mode", mode: "FORCE" }), /CHECK constraint failed/u);
    assert.throws(() => insertRetirement(db, { id: "hdrt_bad_status", deviceId: "hdev_bad_status", status: "CANCELLED" }), /CHECK constraint failed/u);
    assert.throws(() => insertRetirement(db, {
      id: "hdrt_bad_finalization",
      deviceId: "hdev_bad_finalization",
      status: "FINALIZED",
    }), /CHECK constraint failed/u);

    assert.throws(
      () => db.prepare("UPDATE hosting_v2_device_retirements SET device_id='hdev_replaced',version=2 WHERE id='hdrt_migration'").run(),
      /identity immutable/u,
    );
    db.prepare(`UPDATE hosting_v2_device_retirements
      SET status='MANUAL_ACTION_REQUIRED',evidence_digest=?,version=2
      WHERE id='hdrt_migration'`).run(`sha256:${"a".repeat(64)}`);
    assert.throws(
      () => db.prepare("UPDATE hosting_v2_device_retirements SET status='DRAINING',version=3 WHERE id='hdrt_migration'").run(),
      /status transition invalid/u,
    );
    assert.throws(
      () => db.prepare("UPDATE hosting_v2_device_retirements SET status='FINALIZED',version=3 WHERE id='hdrt_migration'").run(),
      /CHECK constraint failed/u,
    );
    db.prepare(`UPDATE hosting_v2_device_retirements
      SET status='FINALIZED',finalized_by='admin_root',finalized_at='2026-08-15T05:00:00.000Z',version=3
      WHERE id='hdrt_migration'`).run();
    assert.throws(
      () => db.prepare("UPDATE hosting_v2_device_retirements SET version=4 WHERE id='hdrt_migration'").run(),
      /status transition invalid/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM hosting_v2_device_retirements WHERE id='hdrt_migration'").run(),
      /retirement immutable/u,
    );
  } finally {
    db.close();
  }
});
