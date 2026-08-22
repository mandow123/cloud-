import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyCardHourTopupReconciliationMigration,
  assertCardHourTopupReconciliationSchemaReady,
  verifyCardHourTopupReconciliationDatabase,
  verifyCardHourTopupReconciliationMigrationMirrors,
} from "../scripts/ops/verify-card-hour-topup-reconciliation-schema.mjs";

const migration = readFileSync(new URL("../drizzle/0038_card_hour_topup_reconciliation_claims.sql", import.meta.url), "utf8");

function createVersionFiveDatabase(path) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  database.exec("CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO card_hour_schema_migrations VALUES(5,datetime('now')); CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY);");
  return database;
}

test("0038 migration mirrors are exact and apply only from complete marker v5", () => {
  assert.equal(verifyCardHourTopupReconciliationMigrationMirrors().ready, true);
  const directory = mkdtempSync(join(tmpdir(), "kai-reconciliation-gate-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createVersionFiveDatabase(path);
    assert.equal(applyCardHourTopupReconciliationMigration(database, migration).schemaMarker, 6);
    assert.equal(assertCardHourTopupReconciliationSchemaReady(database).ready, true);
    database.close();
    assert.equal(verifyCardHourTopupReconciliationDatabase({ databasePath: path }).schemaMarker, 6);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("0038 verifier is read-only and rejects missing or partial durable claims", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-reconciliation-partial-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createVersionFiveDatabase(path);
    database.close();
    assert.throws(() => verifyCardHourTopupReconciliationDatabase({ databasePath: path }), /MARKER_INVALID/u);
    const write = new DatabaseSync(path);
    assert.equal(Number(write.prepare("SELECT MAX(version) version FROM card_hour_schema_migrations").get().version), 5);
    write.exec("CREATE TABLE card_hour_topup_reconciliation_claims(topup_order_id TEXT PRIMARY KEY)");
    write.close();
    assert.throws(() => verifyCardHourTopupReconciliationDatabase({ databasePath: path }), /MARKER_INVALID|NOT_READY/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
