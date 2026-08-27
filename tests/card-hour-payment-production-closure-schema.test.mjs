import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applyCardHourPaymentProductionClosureMigration, assertCardHourPaymentProductionClosureSchemaReady, verifyCardHourPaymentProductionClosureMigrationMirrors } from "../scripts/ops/verify-card-hour-payment-production-closure-schema.mjs";

const migration = readFileSync(new URL("../drizzle/0039_card_hour_payment_production_closure.sql", import.meta.url), "utf8");

function versionSixDatabase() {
  const database = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  database.exec("CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)");
  database.exec("INSERT INTO card_hour_schema_migrations(version,applied_at) VALUES(6,'2026-08-22T00:00:00Z')");
  database.exec("CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY)");
  return database;
}

test("0039 payment closure migration mirrors and applies only from marker v6", () => {
  assert.equal(verifyCardHourPaymentProductionClosureMigrationMirrors().ready, true);
  const database = versionSixDatabase();
  try {
    assert.equal(applyCardHourPaymentProductionClosureMigration(database, migration).schemaMarker, 7);
    assert.equal(assertCardHourPaymentProductionClosureSchemaReady(database).ready, true);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM card_hour_qixiang_query_protection").get().count, 0);
  } finally { database.close(); }
});

test("0039 gate rejects a partial payment closure schema", () => {
  const database = versionSixDatabase();
  try {
    database.exec("CREATE TABLE card_hour_qixiang_query_protection(credential_id TEXT PRIMARY KEY)");
    assert.throws(() => applyCardHourPaymentProductionClosureMigration(database, migration), /PARTIAL_MIGRATION/u);
  } finally { database.close(); }
});
