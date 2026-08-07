import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

async function loadBuiltD1Store() {
  const candidateDirectories = ["dist/server/assets", "dist/server/_next/static"];
  for (const directory of candidateDirectories) {
    const assets = await readdir(directory).catch(() => []);
    const filename = assets.find((entry) => /^marketplace-store-d1-[A-Za-z0-9_-]+\.js$/u.test(entry));
    if (filename) return import(pathToFileURL(resolve(directory, filename)).href);
  }
  assert.fail("the production build must contain the D1 store chunk");
}

async function migrationMetadata() {
  const source = await readFile("db/schema.ts", "utf8");
  const version = Number(source.match(/MARKETPLACE_MIGRATION_VERSION\s*=\s*(\d+)/u)?.[1]);
  const checksum = source.match(/MARKETPLACE_MIGRATION_CHECKSUM\s*=\s*"([0-9a-f]+)"/u)?.[1];
  assert.ok(Number.isInteger(version));
  assert.match(checksum ?? "", /^[0-9a-f]{64}$/u);
  return { version, checksum };
}

class FakeD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  run() {
    return this.database.run(this);
  }

  all() {
    return this.database.all(this);
  }

  first() {
    return this.database.first(this);
  }
}

class FakeD1Database {
  constructor({ migration, quoteResults, versionAfterBatch, demandQuoteCount = 0, totalQuoteCount = 0 }) {
    this.migration = migration;
    this.quoteResults = quoteResults;
    this.versionAfterBatch = versionAfterBatch;
    this.demandQuoteCount = demandQuoteCount;
    this.totalQuoteCount = totalQuoteCount;
    this.quoteBatch = null;
    this.curatedBatch = null;
    this.quoteBatchCompleted = false;
    this.demand = {
      id: "KAI-R-20260803-ABCDEF0123456789",
      owner_actor_id: "buyer:actor",
      idempotency_key: "request-idempotency-key",
      payload_hash: "request-payload-hash",
      visibility: "market",
      request_type: "procurement",
      kind: "rental",
      title: "GPU 算力需求",
      category: "gpu",
      region: "北京",
      pricing_unit: "卡时",
      quantity: 8,
      duration_hours: 168,
      delivery_date: "2026-08-20",
      summary: "容器交付并提供服务保障。",
      offered_json: null,
      wanted_json: null,
      cash_direction: "none",
      cash_amount: null,
      status: "已记录",
      created_at: "2026-08-03T00:00:00.000Z",
      updated_at: "2026-08-03T00:00:00.000Z",
      version: 7,
    };
  }

  prepare(sql) {
    return new FakeD1Statement(this, sql);
  }

  async batch(statements) {
    if (statements[0]?.sql.includes("INSERT INTO marketplace_requests_v2")) {
      this.curatedBatch = statements;
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    }
    if (statements[0]?.sql.includes("INSERT INTO marketplace_quotes_v2")) {
      this.quoteBatch = statements;
      this.quoteBatchCompleted = true;
      return this.quoteResults;
    }
    return statements.map(() => ({ success: true, meta: { changes: 0 } }));
  }

  async run() {
    return { success: true, meta: { changes: 1 } };
  }

  async all() {
    return { success: true, results: [] };
  }

  async first(statement) {
    if (statement.sql.includes("marketplace_schema_migrations")) return this.migration;
    if (statement.sql.includes("marketplace_quotes_v2 WHERE supplier_actor_id")) return null;
    if (statement.sql.includes("SELECT * FROM marketplace_requests_v2")) {
      return {
        ...this.demand,
        version: this.quoteBatchCompleted ? this.versionAfterBatch : this.demand.version,
      };
    }
    if (statement.sql.includes("WHERE demand_id = ? AND valid_until > ?")) {
      return { count: this.demandQuoteCount };
    }
    if (statement.sql.includes("COUNT(*) AS count FROM marketplace_quotes_v2")) {
      return { count: this.totalQuoteCount };
    }
    return null;
  }
}

function context() {
  return {
    actorId: "supplier:actor",
    idempotencyKey: "quote-idempotency-1234567890",
    payloadHash: "quote-payload-hash",
  };
}

function input(demandId) {
  return {
    demandId,
    unitPrice: 18.5,
    leadTime: "48 小时内",
    validDays: 7,
    scopeNote: "人民币含税并包含基础网络与服务保障。",
  };
}

test("D1 quote batch couples conditional insert to expected demand version", async () => {
  const [{ createD1MarketplaceStore }, migration] = await Promise.all([loadBuiltD1Store(), migrationMetadata()]);
  const database = new FakeD1Database({
    migration,
    quoteResults: [
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
    ],
    versionAfterBatch: 8,
  });

  const result = await createD1MarketplaceStore(database).createQuote(context(), input(database.demand.id));
  assert.equal(result.replayed, false);
  assert.equal(result.record.demandId, database.demand.id);
  assert.equal(database.quoteBatch.length, 4);
  assert.equal(database.curatedBatch.length, 10);
  assert.match(database.curatedBatch[0].sql, /updated_at = CASE[\s\S]*marketplace_requests_v2\.updated_at > \?/u);
  assert.match(database.curatedBatch[0].sql, /duration_hours IS NOT excluded\.duration_hours/u);
  assert.match(database.curatedBatch[1].sql, /@superseded:/u);
  assert.match(database.curatedBatch[1].sql, /EXISTS \([\s\S]*payload_hash = \?/u);

  const [insert, update, submittedEvent, normalizedEvent] = database.quoteBatch;
  assert.match(insert.sql, /WHERE id = \? AND visibility = 'market' AND version = \?/u);
  assert.deepEqual(insert.values.slice(-6), [
    database.demand.id,
    7,
    database.demand.id,
    result.record.createdAt,
    25,
    50_000,
  ]);
  assert.match(update.sql, /WHERE id = \? AND version = \?/u);
  assert.match(update.sql, /updated_at = CASE WHEN updated_at > \? THEN updated_at ELSE \? END/u);
  assert.match(update.sql, /EXISTS \(SELECT 1 FROM marketplace_quotes_v2 WHERE id = \?\)/u);
  assert.equal(update.values[0], result.record.createdAt);
  assert.equal(update.values[1], result.record.createdAt);
  assert.equal(update.values[3], 7);
  assert.equal(update.values[4], result.record.id);
  assert.equal(submittedEvent.values.at(-1), result.record.id);
  assert.equal(normalizedEvent.values.at(-1), result.record.id);
});

test("D1 lost update returns state conflict with a no-op atomic batch", async () => {
  const [{ createD1MarketplaceStore }, migration] = await Promise.all([loadBuiltD1Store(), migrationMetadata()]);
  const database = new FakeD1Database({
    migration,
    quoteResults: [
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
      { success: true, meta: { changes: 0 } },
    ],
    versionAfterBatch: 8,
  });

  await assert.rejects(
    createD1MarketplaceStore(database).createQuote(context(), input(database.demand.id)),
    (error) => error?.name === "MarketplaceStateConflictError" && error?.message === "STATE_CONFLICT",
  );
  assert.equal(database.quoteBatch[0].values.at(-5), 7, "the insert must use the version read before the batch");
  assert.equal(database.quoteBatch[1].values[3], 7, "the status update must use the same expected version");
  assert.deepEqual(database.quoteResults.map((result) => result.meta.changes), [0, 0, 0, 0]);
});

test("D1 conditional no-op distinguishes per-demand and global capacity", async () => {
  const [{ createD1MarketplaceStore }, migration] = await Promise.all([loadBuiltD1Store(), migrationMetadata()]);
  const noOpResults = [
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 0 } },
    { success: true, meta: { changes: 0 } },
  ];
  const perDemand = new FakeD1Database({
    migration,
    quoteResults: noOpResults,
    versionAfterBatch: 7,
    demandQuoteCount: 25,
  });
  await assert.rejects(
    createD1MarketplaceStore(perDemand).createQuote(context(), input(perDemand.demand.id)),
    (error) => error?.name === "MarketplaceDemandQuoteLimitError" && error?.message === "DEMAND_QUOTE_LIMIT_REACHED",
  );

  const global = new FakeD1Database({
    migration,
    quoteResults: noOpResults,
    versionAfterBatch: 7,
    totalQuoteCount: 50_000,
  });
  await assert.rejects(
    createD1MarketplaceStore(global).createQuote(context(), input(global.demand.id)),
    (error) => error?.name === "MarketplaceCapacityError" && error?.message === "MARKETPLACE_CAPACITY_REACHED",
  );
});
