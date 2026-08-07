import { createSupplyStore, type SupplyDatabaseAdapter, type SupplySql } from "./supply-store-core.ts";

type D1Result<T> = { results?: T[]; success?: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
};
type D1Database = {
  prepare(sql: string): D1Statement;
  batch<T = unknown>(statements: D1Statement[]): Promise<Array<D1Result<T>>>;
};

function statement(db: D1Database, item: SupplySql) {
  const prepared = db.prepare(item.sql);
  return item.values?.length ? prepared.bind(...item.values) : prepared;
}

function d1Adapter(db: D1Database): SupplyDatabaseAdapter {
  return {
    async first<T>(sql: string, values: readonly unknown[] = []) {
      const prepared = db.prepare(sql);
      return (values.length ? prepared.bind(...values) : prepared).first<T>();
    },
    async all<T>(sql: string, values: readonly unknown[] = []) {
      const prepared = db.prepare(sql);
      const result = await (values.length ? prepared.bind(...values) : prepared).all<T>();
      return result.results ?? [];
    },
    async batch(statements) {
      if (statements.length === 0) return [];
      const results = await db.batch(statements.map((item) => statement(db, item)));
      return results.map((result) => ({ changes: Number(result.meta?.changes ?? 0) }));
    },
    async ensureSchema(statements, version) {
      await db.batch(statements.map((sql) => db.prepare(sql)));
      const row = await db.prepare("SELECT MAX(version) AS version FROM supply_schema_migrations").first<{ version: number | null }>();
      if (row?.version != null && Number(row.version) > version) throw new Error("SUPPLY_SCHEMA_TOO_NEW");
      await db.prepare("INSERT OR IGNORE INTO supply_schema_migrations (version,applied_at) VALUES (?,?)")
        .bind(version, new Date().toISOString()).run();
    },
  };
}

export async function createD1SupplyStore(value: unknown) {
  if (!value || typeof value !== "object" || !("prepare" in value) || !("batch" in value)) throw new Error("SUPPLY_D1_BINDING_INVALID");
  return createSupplyStore(d1Adapter(value as D1Database));
}
