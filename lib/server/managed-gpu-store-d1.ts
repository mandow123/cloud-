import { createManagedGpuStore, type ManagedGpuDatabaseAdapter, type ManagedGpuSql } from "./managed-gpu-store-core.ts";
type Result<T> = { results?: T[]; meta?: { changes?: number } };
type Statement = { bind(...values: unknown[]): Statement; run<T = unknown>(): Promise<Result<T>>; all<T = unknown>(): Promise<Result<T>>; first<T = unknown>(): Promise<T | null> };
type Database = { prepare(sql: string): Statement; batch<T = unknown>(statements: Statement[]): Promise<Array<Result<T>>> };
const statement = (db: Database, item: ManagedGpuSql) => item.values?.length ? db.prepare(item.sql).bind(...item.values) : db.prepare(item.sql);
function adapter(db: Database): ManagedGpuDatabaseAdapter {
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) { const prepared = db.prepare(sql); return (values.length ? prepared.bind(...values) : prepared).first<T>(); },
    async all<T>(sql: string, values: readonly unknown[] = []) { const prepared = db.prepare(sql); return (await (values.length ? prepared.bind(...values) : prepared).all<T>()).results ?? []; },
    async run(sql: string, values: readonly unknown[] = []) { const prepared = db.prepare(sql); const result = await (values.length ? prepared.bind(...values) : prepared).run(); return { changes: Number(result.meta?.changes ?? 0) }; },
    async batch(items: readonly ManagedGpuSql[]) { return (await db.batch(items.map((item) => statement(db, item)))).map((result) => ({ changes: Number(result.meta?.changes ?? 0) })); },
    async ensureSchema(statements: readonly string[], version: number) {
      await db.batch(statements.map((sql: string) => db.prepare(sql)));
      const row = await db.prepare("SELECT MAX(version) AS version FROM managed_gpu_schema_migrations").first<{ version: number | null }>();
      if (row?.version != null && row.version > version) throw new Error("MANAGED_GPU_SCHEMA_TOO_NEW");
      await db.prepare("INSERT OR IGNORE INTO managed_gpu_schema_migrations(version,applied_at) VALUES(?,?)").bind(version, new Date().toISOString()).run();
    },
  };
}
export async function createD1ManagedGpuStore(value: unknown) {
  if (!value || typeof value !== "object" || !("prepare" in value) || !("batch" in value)) throw new Error("MANAGED_GPU_D1_BINDING_INVALID");
  return createManagedGpuStore(adapter(value as Database));
}
