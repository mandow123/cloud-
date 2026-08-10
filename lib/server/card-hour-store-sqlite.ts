import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createCardHourStore, type CardHourDatabaseAdapter, type CardHourSql } from "./card-hour-store-core.ts";

const bind = (values: readonly unknown[] = []) => values as never[];
function adapter(db: DatabaseSync): CardHourDatabaseAdapter {
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) { return (db.prepare(sql).get(...bind(values)) as T | undefined) ?? null; },
    async all<T>(sql: string, values: readonly unknown[] = []) { return db.prepare(sql).all(...bind(values)) as T[]; },
    async batch(items: readonly CardHourSql[]) { db.exec("BEGIN IMMEDIATE"); try { const results = items.map(({ sql, values = [] }) => ({ changes: Number(db.prepare(sql).run(...bind(values)).changes) })); db.exec("COMMIT"); return results; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    async ensureSchema(statements, version) { db.exec("BEGIN IMMEDIATE"); try { for (const sql of statements) db.exec(sql); const row = db.prepare("SELECT MAX(version) AS version FROM card_hour_schema_migrations").get() as { version: number | null }; if (row.version != null && Number(row.version) > version) throw new Error("CARD_HOUR_SCHEMA_TOO_NEW"); db.prepare("INSERT OR IGNORE INTO card_hour_schema_migrations(version,applied_at) VALUES(?,?)").run(version, new Date().toISOString()); db.exec("COMMIT"); } catch (error) { db.exec("ROLLBACK"); throw error; } },
  };
}
export async function createSqliteCardHourStore(path?: string) { const directory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace"); const file = path ?? join(directory, "kai-cloud.sqlite"); if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true }); const db = new DatabaseSync(file, { enableForeignKeyConstraints: true }); db.exec("PRAGMA journal_mode=WAL"); db.exec("PRAGMA synchronous=FULL"); db.exec("PRAGMA busy_timeout=5000"); const store = await createCardHourStore(adapter(db)); return Object.assign(store, { close() { db.close(); } }); }
