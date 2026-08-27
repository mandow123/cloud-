import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createManagedGpuStore, type ManagedGpuDatabaseAdapter, type ManagedGpuSql } from "./managed-gpu-store-core.ts";

function openDatabase(overridePath?: string) {
  const directory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const path = overridePath ?? join(directory, "kai-cloud.sqlite");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
const values = (items: readonly unknown[] = []) => items as never[];
function adapter(db: DatabaseSync): ManagedGpuDatabaseAdapter {
  return {
    async first<T>(sql: string, items: readonly unknown[] = []) { return (db.prepare(sql).get(...values(items)) as T | undefined) ?? null; },
    async all<T>(sql: string, items: readonly unknown[] = []) { return db.prepare(sql).all(...values(items)) as T[]; },
    async run(sql: string, items: readonly unknown[] = []) { const result = db.prepare(sql).run(...values(items)); return { changes: Number(result.changes) }; },
    async batch(statements: readonly ManagedGpuSql[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map((item) => ({ changes: Number(db.prepare(item.sql).run(...values(item.values)).changes) }));
        db.exec("COMMIT"); return result;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async ensureSchema(statements: readonly string[], version: number) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) db.exec(sql);
        const row = db.prepare("SELECT MAX(version) AS version FROM managed_gpu_schema_migrations").get() as { version: number | null };
        if (row.version != null && row.version > version) throw new Error("MANAGED_GPU_SCHEMA_TOO_NEW");
        db.prepare("INSERT OR IGNORE INTO managed_gpu_schema_migrations(version,applied_at) VALUES(?,?)").run(version, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}
export async function createSqliteManagedGpuStore(overridePath?: string) { return createManagedGpuStore(adapter(openDatabase(overridePath))); }
