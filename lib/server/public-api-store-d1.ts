import { createKaiPublicApiStore } from "./public-api-store-core.ts";
import type { KaiPublicApiDatabaseAdapter, KaiPublicApiSql } from "./public-api-store.ts";

type Result<T> = { results?: T[]; meta?: { changes?: number } };
type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null>; all<T>(): Promise<Result<T>>; run<T>(): Promise<Result<T>> };
type D1 = { prepare(sql: string): Statement; batch<T>(statements: Statement[]): Promise<Array<Result<T>>> };
const prepared = (db: D1, sql: string, values: readonly unknown[] = []) => values.length ? db.prepare(sql).bind(...values) : db.prepare(sql);

function adapter(db: D1): KaiPublicApiDatabaseAdapter {
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) { return prepared(db, sql, values).first<T>(); },
    async all<T>(sql: string, values: readonly unknown[] = []) { return (await prepared(db, sql, values).all<T>()).results ?? []; },
    async batch(items: readonly KaiPublicApiSql[]) { return (await db.batch(items.map((item) => prepared(db, item.sql, item.values)))).map((result) => ({ changes: Number(result.meta?.changes ?? 0) })); },
    async ensureSchema(statements, version) {
      await db.batch(statements.map((sql) => db.prepare(sql)));
      const row = await db.prepare("SELECT MAX(version) version FROM kai_public_api_schema_migrations").first<{ version: number | null }>();
      if (row?.version != null && Number(row.version) > version) throw new Error("KAI_PUBLIC_API_SCHEMA_TOO_NEW");
      await db.prepare("INSERT OR IGNORE INTO kai_public_api_schema_migrations(version,applied_at) VALUES(?,?)").bind(version, new Date().toISOString()).run();
    },
  };
}

export function createD1KaiPublicApiStore(value: unknown) {
  if (!value || typeof value !== "object" || !("prepare" in value) || !("batch" in value)) throw new Error("KAI_PUBLIC_API_D1_BINDING_INVALID");
  return createKaiPublicApiStore(adapter(value as D1));
}
