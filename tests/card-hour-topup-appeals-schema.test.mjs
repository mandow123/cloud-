import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyCardHourTopupAppealMigration,
  assertCardHourTopupAppealSchemaReady,
  verifyCardHourTopupAppealDatabase,
  verifyCardHourTopupAppealMigrationMirrors,
} from "../scripts/ops/verify-card-hour-topup-appeals-schema.mjs";

const migration = await import("node:fs").then(({ readFileSync }) => readFileSync(new URL("../drizzle/0036_card_hour_topup_appeals.sql", import.meta.url), "utf8"));

function createBaseDatabase(path) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  database.exec("CREATE TABLE card_hour_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL); INSERT INTO card_hour_schema_migrations VALUES(3,datetime('now')); CREATE TABLE card_hour_topup_orders(id TEXT PRIMARY KEY);");
  return database;
}

test("0036 SQLite and D1 migrations are exact mirrors and apply only from complete v3", () => {
  assert.equal(verifyCardHourTopupAppealMigrationMirrors().ready, true);
  const directory = mkdtempSync(join(tmpdir(), "kai-appeal-gate-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createBaseDatabase(path);
    assert.equal(applyCardHourTopupAppealMigration(database, migration).schemaMarker, 4);
    assert.equal(assertCardHourTopupAppealSchemaReady(database).ready, true);
    database.close();
    assert.equal(verifyCardHourTopupAppealDatabase({ databasePath: path }).schemaMarker, 4);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test("0036 verifier is read-only by default and rejects partial sidecars", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-appeal-partial-"));
  const path = join(directory, "kai-cloud.sqlite");
  try {
    const database = createBaseDatabase(path);
    database.exec("CREATE TABLE card_hour_topup_appeals(id TEXT PRIMARY KEY)");
    database.close();
    assert.throws(() => verifyCardHourTopupAppealDatabase({ databasePath: path }), /MARKER_INVALID|NOT_READY/u);
    const write = new DatabaseSync(path);
    assert.equal(Number(write.prepare("SELECT MAX(version) version FROM card_hour_schema_migrations").get().version), 3);
    write.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
