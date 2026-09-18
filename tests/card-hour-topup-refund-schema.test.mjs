import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
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
