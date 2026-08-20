import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createKaiPublicApiStore } from "./public-api-store-core.ts";
import type { KaiPublicApiDatabaseAdapter, KaiPublicApiSql } from "./public-api-store.ts";

function open(path?: string) {
  const directory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const file = path ?? join(directory, "kai-cloud.sqlite");
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

function adapter(db: DatabaseSync): KaiPublicApiDatabaseAdapter {
  const bind = (values: readonly unknown[] = []) => values as never[];
  const run = (item: KaiPublicApiSql) => db.prepare(item.sql).run(...bind(item.values));
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) { return (db.prepare(sql).get(...bind(values)) as T | undefined) ?? null; },
    async all<T>(sql: string, values: readonly unknown[] = []) { return db.prepare(sql).all(...bind(values)) as T[]; },
    async batch(items) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = items.map((item) => ({ changes: Number(run(item).changes) }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
        throw error;
      }
    },
    async ensureSchema(statements, version) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) db.prepare(sql).run();
        const row = db.prepare("SELECT MAX(version) version FROM kai_public_api_schema_migrations").get() as { version?: number | null } | undefined;
        if (row?.version != null && Number(row.version) > version) throw new Error("KAI_PUBLIC_API_SCHEMA_TOO_NEW");
        db.prepare("INSERT OR IGNORE INTO kai_public_api_schema_migrations(version,applied_at) VALUES(?,?)").run(version, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* transaction already closed */ }
        throw error;
      }
    },
  };
}

export async function createSqliteKaiPublicApiStore(path?: string) {
  const db = open(path);
  const store = await createKaiPublicApiStore(adapter(db));
  return Object.assign(store, { close() { db.close(); } });
}
