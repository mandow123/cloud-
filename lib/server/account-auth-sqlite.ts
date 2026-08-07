import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAccountAuthStore, type AccountAuthDatabaseAdapter, type AuthSql } from "./account-auth-store.ts";

function bind(values: readonly unknown[] = []) { return values as never[]; }

function adapter(db: DatabaseSync): AccountAuthDatabaseAdapter {
  return {
    async first<T>(sql: string, values = []) { return (db.prepare(sql).get(...bind(values)) as T | undefined) ?? null; },
    async all<T>(sql: string, values = []) { return db.prepare(sql).all(...bind(values)) as T[]; },
    async run(sql: string, values = []) { return { changes: Number(db.prepare(sql).run(...bind(values)).changes) }; },
    async batch(statements: readonly AuthSql[]) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((item) => ({ changes: Number(db.prepare(item.sql).run(...bind(item.values)).changes) }));
        db.exec("COMMIT"); return results;
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    async ensureSchema(statements, version) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of statements) db.exec(sql);
        const row = db.prepare("SELECT MAX(version) AS version FROM admin_identity_schema_migrations").get() as { version: number | null };
        if (row.version != null && Number(row.version) > version) throw new Error("ADMIN_IDENTITY_SCHEMA_TOO_NEW");
        db.prepare("INSERT OR IGNORE INTO admin_identity_schema_migrations(version,applied_at) VALUES(?,?)").run(version, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}

export async function createSqliteAccountAuthStore(overridePath?: string) {
  const dataDirectory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const databasePath = overridePath ?? join(dataDirectory, "kai-cloud.sqlite");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  db.exec("PRAGMA journal_mode = WAL"); db.exec("PRAGMA synchronous = FULL"); db.exec("PRAGMA busy_timeout = 5000");
  const store=await createAccountAuthStore(adapter(db));
  return Object.assign(store,{close(){db.close();}});
}
