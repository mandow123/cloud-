import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const MIGRATION_PATH = "drizzle/0001_secure_marketplace.sql";

test("fresh Sites migration executes on an empty database and matches its runtime checksum", async () => {
  const [sql, schemaSource, packagedSql] = await Promise.all([
    readFile(MIGRATION_PATH, "utf8"),
    readFile("db/schema.ts", "utf8"),
    readFile("dist/.openai/drizzle/0001_secure_marketplace.sql", "utf8"),
  ]);
  assert.equal(packagedSql, sql, "Sites build must package the exact reviewed migration");
  assert.ok(!sql.includes("FROM marketplace_requests;"), "fresh migration must not read an optional legacy table");
  assert.ok(!sql.includes("FROM marketplace_quotes"), "fresh migration must not read an optional legacy table");
  assert.ok(!sql.includes("FROM marketplace_drafts;"), "fresh migration must not read an optional legacy table");

  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) db.exec(statement);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    for (const table of [
      "marketplace_schema_migrations",
      "marketplace_requests_v2",
      "marketplace_quotes_v2",
      "marketplace_drafts_v2",
      "marketplace_events_v2",
      "marketplace_write_limits_v2",
      "marketplace_sessions_v2",
    ]) {
      assert.ok(tables.includes(table), `fresh migration must create ${table}`);
    }
  } finally {
    db.close();
  }

  const checksum = createHash("sha256").update(await readFile(MIGRATION_PATH)).digest("hex");
  const declared = schemaSource.match(/MARKETPLACE_MIGRATION_CHECKSUM = "([0-9a-f]{64})"/u)?.[1];
  assert.equal(declared, checksum, "runtime migration ledger checksum must match the packaged SQL bytes");
});
