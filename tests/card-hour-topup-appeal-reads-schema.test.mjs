import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyCardHourTopupAppealReadMigration,
  assertCardHourTopupAppealReadSchemaReady,
  verifyCardHourTopupAppealReadDatabase,
  verifyCardHourTopupAppealReadMigrationMirrors,
} from "../scripts/ops/verify-card-hour-topup-appeal-reads-schema.mjs";

const migration = readFileSync(new URL("../drizzle/0037_card_hour_topup_appeal_reads.sql", import.meta.url), "utf8");

function createVersionFourDatabase(path) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  database.exec("CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO card_hour_schema_migrations VALUES(4,datetime('now')); CREATE TABLE card_hour_topup_appeals(id TEXT PRIMARY KEY);");
  return database;
}

test("0037 migration mirrors are exact and apply only from complete marker v4", () => {
  assert.equal(verifyCardHourTopupAppealReadMigrationMirrors().ready, true);
  const directory = mkdtempSync(join(tmpdir(), "kai-appeal-reads-gate-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createVersionFourDatabase(path);
    assert.equal(applyCardHourTopupAppealReadMigration(database, migration).schemaMarker, 5);
    assert.equal(assertCardHourTopupAppealReadSchemaReady(database).ready, true);
    database.close();
    assert.equal(verifyCardHourTopupAppealReadDatabase({ databasePath: path }).schemaMarker, 5);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("0037 verifier is read-only and rejects missing or partial read receipts", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-appeal-reads-partial-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createVersionFourDatabase(path);
    database.close();
    assert.throws(() => verifyCardHourTopupAppealReadDatabase({ databasePath: path }), /MARKER_INVALID/u);
    const write = new DatabaseSync(path);
    assert.equal(Number(write.prepare("SELECT MAX(version) version FROM card_hour_schema_migrations").get().version), 4);
    write.exec("CREATE TABLE card_hour_topup_appeal_member_reads(appeal_id TEXT PRIMARY KEY)");
    write.close();
    assert.throws(() => verifyCardHourTopupAppealReadDatabase({ databasePath: path }), /MARKER_INVALID|NOT_READY/u);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
