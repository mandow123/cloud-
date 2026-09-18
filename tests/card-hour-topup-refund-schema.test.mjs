import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyCardHourTopupRefundMigration,
  assertCardHourTopupRefundSchemaReady,
  verifyCardHourTopupRefundDatabase,
  verifyCardHourTopupRefundMigrationMirrors,
} from "../scripts/ops/verify-card-hour-topup-refund-schema.mjs";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "kai-topup-refund-schema-"));
  const path = join(directory, "cloud.sqlite");
  const database = new DatabaseSync(path);
  database.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO card_hour_schema_migrations VALUES(6,'2026-09-18T00:00:00Z');
    CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY);`);
  return { directory, path, database };
}

test("0042 migration mirrors and upgrades only a complete marker-six database", () => {
  assert.equal(verifyCardHourTopupRefundMigrationMirrors().ready, true);
  const value = fixture();
  try {
    assert.equal(applyCardHourTopupRefundMigration(value.database).schemaMarker, 7);
    assert.equal(assertCardHourTopupRefundSchemaReady(value.database).ready, true);
    value.database.close();
    assert.equal(verifyCardHourTopupRefundDatabase({ databasePath: value.path }).schemaMarker, 7);
  } finally {
    try { value.database.close(); } catch {}
    rmSync(value.directory, { recursive: true });
  }
});

test("0042 gate rejects partial or wrong-version structures", () => {
  for (const setup of [
    "UPDATE card_hour_schema_migrations SET version=5",
    "CREATE TABLE card_hour_topup_refunds(id TEXT PRIMARY KEY)",
  ]) {
    const value = fixture();
    try {
      value.database.exec(setup);
      assert.throws(() => applyCardHourTopupRefundMigration(value.database), /CARD_HOUR_TOPUP_REFUND_SCHEMA_PARTIAL/u);
    } finally {
      value.database.close();
      rmSync(value.directory, { recursive: true });
    }
  }
});

test("0042 gate rejects lookalike tables and same-name non-unique indexes", () => {
  const value = fixture();
  try {
    const migration = readFileSync(new URL("../drizzle/0042_card_hour_topup_refunds.sql", import.meta.url), "utf8");
    value.database.exec(migration
      .replace("topup_order_id TEXT NOT NULL UNIQUE", "topup_order_id TEXT NOT NULL")
      .replace("provider_refund_request_id TEXT NOT NULL UNIQUE", "provider_refund_request_id TEXT NOT NULL")
      .replace("CREATE UNIQUE INDEX IF NOT EXISTS card_hour_topup_refunds_provider_tx_unique_idx", "CREATE INDEX IF NOT EXISTS card_hour_topup_refunds_provider_tx_unique_idx"));
    assert.throws(() => assertCardHourTopupRefundSchemaReady(value.database), /CARD_HOUR_TOPUP_REFUND_SCHEMA_NOT_READY/u);
  } finally {
    value.database.close();
    rmSync(value.directory, { recursive: true });
  }
});

test("0042 gate verifies the provider transaction index is unique and partial", () => {
  const value = fixture();
  try {
    applyCardHourTopupRefundMigration(value.database);
    value.database.exec(`DROP INDEX card_hour_topup_refunds_provider_tx_unique_idx;
      CREATE INDEX card_hour_topup_refunds_provider_tx_unique_idx ON card_hour_topup_refunds(provider,provider_transaction_id);`);
    assert.throws(() => assertCardHourTopupRefundSchemaReady(value.database), /CARD_HOUR_TOPUP_REFUND_SCHEMA_NOT_READY/u);
  } finally {
    value.database.close();
    rmSync(value.directory, { recursive: true });
  }
});
