import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createSupplyStore, type SupplyDatabaseAdapter, type SupplySql } from "./supply-store-core.ts";

function openSupplyDatabase(overridePath?: string) {
  const dataDirectory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const databasePath = overridePath ?? join(dataDirectory, "kai-cloud.sqlite");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

function bindValues(values: readonly unknown[] = []) {
  return values as never[];
}

function sqliteAdapter(db: DatabaseSync): SupplyDatabaseAdapter {
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) {
      return (db.prepare(sql).get(...bindValues(values)) as T | undefined) ?? null;
    },
    async all<T>(sql: string, values: readonly unknown[] = []) {
      return db.prepare(sql).all(...bindValues(values)) as T[];
    },
    async batch(statements: readonly SupplySql[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map(({ sql, values = [] }) => {
          const result = db.prepare(sql).run(...bindValues(values));
          return { changes: Number(result.changes) };
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    async ensureSchema(statements, version) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) db.exec(sql);
        const row = db.prepare("SELECT MAX(version) AS version FROM supply_schema_migrations").get() as { version: number | null };
        if (row.version != null && Number(row.version) > version) throw new Error("SUPPLY_SCHEMA_TOO_NEW");
        db.prepare("INSERT OR IGNORE INTO supply_schema_migrations (version,applied_at) VALUES (?,?)").run(version, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export async function createSqliteSupplyStore(overridePath?: string) {
  return createSupplyStore(sqliteAdapter(openSupplyDatabase(overridePath)));
}
