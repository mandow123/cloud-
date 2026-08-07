import { createAccountAuthStore, type AccountAuthDatabaseAdapter, type AuthSql } from "./account-auth-store.ts";

type Result<T> = { results?: T[]; meta?: { changes?: number } };
type Statement = { bind(...values: unknown[]): Statement; first<T>(): Promise<T | null>; all<T>(): Promise<Result<T>>; run<T>(): Promise<Result<T>> };
type D1 = { prepare(sql: string): Statement; batch<T>(statements: Statement[]): Promise<Array<Result<T>>> };
function prepared(db: D1, sql: string, values: readonly unknown[] = []) { const item = db.prepare(sql); return values.length ? item.bind(...values) : item; }

export async function createD1AccountAuthStore(value: unknown) {
  if (!value || typeof value !== "object" || !("prepare" in value) || !("batch" in value)) throw new Error("ADMIN_AUTH_D1_BINDING_INVALID");
  const db = value as D1;
  const adapter: AccountAuthDatabaseAdapter = {
    async first<T>(sql: string, values = []) { return prepared(db, sql, values).first<T>(); },
    async all<T>(sql: string, values = []) { return (await prepared(db, sql, values).all<T>()).results ?? []; },
    async run(sql: string, values = []) { return { changes: Number((await prepared(db, sql, values).run()).meta?.changes ?? 0) }; },
    async batch(statements: readonly AuthSql[]) { return (await db.batch(statements.map((item) => prepared(db, item.sql, item.values)))).map((result) => ({ changes: Number(result.meta?.changes ?? 0) })); },
    async ensureSchema(statements, version) {
      await db.batch(statements.map((sql) => db.prepare(sql)));
      const row = await db.prepare("SELECT MAX(version) AS version FROM admin_identity_schema_migrations").first<{ version: number | null }>();
      if (row?.version != null && Number(row.version) > version) throw new Error("ADMIN_IDENTITY_SCHEMA_TOO_NEW");
      await db.prepare("INSERT OR IGNORE INTO admin_identity_schema_migrations(version,applied_at) VALUES(?,?)").bind(version, new Date().toISOString()).run();
    },
  };
  return createAccountAuthStore(adapter);
}

