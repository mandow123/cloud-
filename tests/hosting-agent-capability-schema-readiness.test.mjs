import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  applyHostingAgentCapabilityMigration,
  assertHostingAgentCapabilitySchemaReady,
  inspectHostingAgentCapabilitySchema,
  verifyHostingAgentCapabilityDatabase,
} from "../scripts/ops/verify-hosting-agent-capability-schema.mjs";

function oldV14Database(path) {
  const database = new DatabaseSync(path);
  database.exec(`CREATE TABLE hosting_v2_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO hosting_v2_schema_migrations VALUES(14,'2026-08-21T00:00:00.000Z');
    CREATE TABLE hosting_v2_agent_challenges(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,nonce TEXT NOT NULL,
      minimum_agent_version TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL);
    CREATE TABLE hosting_v2_devices(
      id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,account_id TEXT NOT NULL,display_name TEXT NOT NULL,
      device_key_id TEXT NOT NULL,device_public_key TEXT NOT NULL,agent_version TEXT NOT NULL,inventory_json TEXT NOT NULL,
      inventory_digest TEXT NOT NULL,status TEXT NOT NULL,verification_status TEXT NOT NULL,last_sequence INTEGER NOT NULL,
      version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  return database;
}

test("0032 pre-deploy gate blocks an old v14 database even when telemetry is disabled, then passes after migration", () => {
  const previous = process.env.KAI_AGENT_TELEMETRY_V1;
  process.env.KAI_AGENT_TELEMETRY_V1 = "0";
  const directory = mkdtempSync(join(tmpdir(), "kai-capability-gate-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const database = oldV14Database(databasePath);
  try {
    const before = inspectHostingAgentCapabilitySchema(database);
    assert.equal(before.marker, 14);
    assert.equal(before.missingColumns.length, 4);
    assert.throws(() => assertHostingAgentCapabilitySchemaReady(database), /HOSTING_AGENT_CAPABILITY_SCHEMA_NOT_READY/u);
    assert.throws(() => verifyHostingAgentCapabilityDatabase({ databasePath }), /HOSTING_AGENT_CAPABILITY_SCHEMA_NOT_READY/u);

    const migration = readFileSync(new URL("../drizzle/0032_hosting_agent_capability_modes.sql", import.meta.url), "utf8");
    const result = applyHostingAgentCapabilityMigration(database, migration);
    assert.equal(result.schemaMarker, 14, "the additive migration must retain the rollback-compatible v14 marker");
  } finally {
    database.close();
  }
  try {
    const verified = verifyHostingAgentCapabilityDatabase({ databasePath });
    assert.equal(verified.ready, true);
    assert.equal(verified.schemaMarker, 14);
  } finally {
    if (previous === undefined) delete process.env.KAI_AGENT_TELEMETRY_V1;
    else process.env.KAI_AGENT_TELEMETRY_V1 = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production startup runs the 0032 gate before the default server command", () => {
  const entrypoint = readFileSync(new URL("../scripts/ops/production-entrypoint.sh", import.meta.url), "utf8");
  const gate = entrypoint.indexOf("verify-hosting-agent-capability-schema.mjs --allow-uninitialized");
  const server = entrypoint.lastIndexOf('exec "$@"');
  assert.ok(gate >= 0 && gate < server);
  assert.doesNotMatch(entrypoint.slice(gate, server), /KAI_AGENT_TELEMETRY_V1/u);
});

test("runbook branches before migration and never applies 0032 to an uninitialized Hosting database", () => {
  const runbook = readFileSync(new URL("../deploy/PRODUCTION_RUNBOOK.md", import.meta.url), "utf8");
  const section = runbook.slice(runbook.indexOf("### 0032 预部署门禁"), runbook.indexOf("## 备份格式"));
  const classification = section.indexOf("--allow-uninitialized");
  const apply = section.indexOf("--apply --confirm APPLY_0032_HOSTING_AGENT_CAPABILITY_MODES");
  assert.ok(classification >= 0 && classification < apply, "read-only classification must precede the migration command");
  assert.match(section, /hostingInitialized=false[^\n]+不得执行 0032/u);
  assert.match(section, /让应用一次性创建完整 Hosting schema/u);
  assert.match(section, /HOSTING_AGENT_CAPABILITY_SCHEMA_PARTIAL[^\n]+立即停止发布/u);
});

test("allow-uninitialized accepts a shared business database only when Hosting is entirely absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "kai-capability-uninitialized-"));
  const databasePath = join(directory, "kai-cloud.sqlite");
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("CREATE TABLE marketplace_requests(id TEXT PRIMARY KEY)");
  } finally {
    database.close();
  }
  try {
    const result = verifyHostingAgentCapabilityDatabase({ databasePath, allowUninitialized: true });
    assert.equal(result.ready, true);
    assert.equal(result.initialized, true);
    assert.equal(result.hostingInitialized, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allow-uninitialized rejects every partial Hosting initialization", () => {
  for (const partialSql of [
    "CREATE TABLE hosting_v2_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)",
    "CREATE TABLE hosting_v2_agent_challenges(id TEXT PRIMARY KEY)",
    "CREATE TABLE hosting_v2_devices(id TEXT PRIMARY KEY)",
  ]) {
    const directory = mkdtempSync(join(tmpdir(), "kai-capability-partial-"));
    const databasePath = join(directory, "kai-cloud.sqlite");
    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`CREATE TABLE marketplace_requests(id TEXT PRIMARY KEY);${partialSql}`);
    } finally {
      database.close();
    }
    try {
      assert.throws(
        () => verifyHostingAgentCapabilityDatabase({ databasePath, allowUninitialized: true }),
        /HOSTING_AGENT_CAPABILITY_SCHEMA_PARTIAL/u,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});
