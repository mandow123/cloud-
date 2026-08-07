import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CNY_MICROS_PER_CENT,
  deriveCapacityAmountCents,
  deriveCapacityBaseUnits,
  deriveCommissionEstimateCents,
  GPU_HOUR_PRICE_BASIS_BASE_UNITS,
  MODEL_INSTANCE_HOUR_PRICE_BASIS_BASE_UNITS,
  M_TOKEN_CAPACITY_HOUR_PRICE_BASIS_BASE_UNITS,
  parseCreateCapacityLot,
  parseCreateCheckout,
  parseCreateListingVersion,
  parseCreateResourceAsset,
  parseCreateVerificationRun,
  parseWithdrawCapacityLot,
  parseCreateSwapQuote,
  parseTransitionSwapQuote,
  parseGenerateReferralCode,
  parseSupplierConfirmation,
  parseSubmitDeliveryPackage,
  parseReviewDeliveryPackage,
  parseClaimDeliveryPackage,
  parseTestDeliveryConnection,
  parseTestServiceStart,
  parseTestMeterComplete,
  parseSubmitOrderAcceptance,
  parseTestRecordSettlement,
} from "../lib/exchange.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError, ExchangeInputError } from "../lib/server/exchange-errors.ts";
import { createSqliteExchangeStore, ensureSqliteExchangeSchema } from "../lib/server/exchange-store-sqlite.ts";
import { createD1ExchangeStore } from "../lib/server/exchange-store-d1.ts";
import { newCheckoutRecords } from "../lib/server/exchange-records.ts";

const TEST_SHA256 = `sha256:${"a".repeat(64)}`;

function iso(offsetMs) {
  const date = new Date(Date.now() + offsetMs);
  date.setUTCMilliseconds(0);
  return date.toISOString();
}

function context(actorId, key, hash = key) {
  return { actorId, idempotencyKey: key.padEnd(16, "0"), payloadHash: hash };
}

function assertModelPayloadClean(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertModelPayloadClean(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/gpu|parallel/iu.test(key), `${path}.${key} is a forbidden MODEL alias`);
      assertModelPayloadClean(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") assert.ok(!/gpu|卡/iu.test(value), `${path} contains forbidden MODEL wording`);
}

function assertTokenPayloadClean(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTokenPayloadClean(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/gpu|parallel|model_instance/iu.test(key), `${path}.${key} is a forbidden TOKEN alias`);
      assertTokenPayloadClean(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    assert.ok(!/gpu|卡|model_instance|实例/iu.test(value), `${path} contains forbidden TOKEN wording`);
  }
}

function assertNasPayloadClean(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNasPayloadClean(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/gpu|parallel|rack|token|model_instance/iu.test(key), `${path}.${key} is a forbidden NAS alias`);
      assertNasPayloadClean(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    assert.ok(!/gpu|卡|token|模型实例|机柜/iu.test(value), `${path} contains forbidden NAS wording`);
  }
}

function assertRackPayloadClean(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRackPayloadClean(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!/gpu|parallel|nas|token|model_instance/iu.test(key), `${path}.${key} is a forbidden RACK alias`);
      assertRackPayloadClean(child, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string") {
    assert.ok(!/gpu|卡|nas|token|模型实例/iu.test(value), `${path} contains forbidden RACK wording`);
  }
}

function d1BackedBySqlite() {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  let beforeNextBatch = null;
  let zeroNextBatchStatementIndex = null;
  const prepare = (sql) => {
    let values = [];
    const wrapper = {
      bind(...nextValues) { values = nextValues; return wrapper; },
      async run() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
      async all() { return { success: true, results: db.prepare(sql).all(...values) }; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      rawRun() {
        const result = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
    return wrapper;
  };
  return {
    db,
    adapter: {
      prepare,
      beforeNextBatch(operation) { beforeNextBatch = operation; },
      zeroNextBatchStatement(index) { zeroNextBatchStatementIndex = index; },
      async batch(statements) {
        const operation = beforeNextBatch;
        beforeNextBatch = null;
        const zeroIndex = zeroNextBatchStatementIndex;
        zeroNextBatchStatementIndex = null;
        operation?.(db);
        db.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map((statement, index) => index === zeroIndex
            ? { success: true, meta: { changes: 0 } }
            : statement.rawRun());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  };
}

const exchangeMigrationFilesThroughV7 = [
  "0002_cloud_exchange.sql",
  "0003_gpu_checkout.sql",
  "0004_payment_delivery.sql",
  "0005_delivery_package.sql",
  "0006_metering_acceptance_settlement.sql",
  "0007_general_capacity_core.sql",
];

function applyExchangeMigrationFile(db, fileName) {
  const source = readFileSync(join("drizzle", fileName), "utf8");
  for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

function createV7CloneFromV8(sourceDb) {
  const clone = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  for (const fileName of exchangeMigrationFilesThroughV7) applyExchangeMigrationFile(clone, fileName);
  const tables = [
    "exchange_product_versions",
    "exchange_resource_assets",
    "exchange_verification_runs",
    "exchange_capacity_lots",
    "exchange_listing_versions",
    "exchange_orders",
    "exchange_reservations",
    "exchange_capacity_transfers",
    "exchange_command_receipts",
    "exchange_domain_events",
    "exchange_order_lifecycle",
    "exchange_payment_intents",
    "exchange_payment_events",
    "exchange_delivery_tasks",
    "exchange_delivery_packages",
    "exchange_delivery_reviews",
    "exchange_delivery_claims",
    "exchange_connection_checks",
    "exchange_metering_sessions",
    "exchange_service_facts",
    "exchange_metering_finals",
    "exchange_acceptances",
    "exchange_settlements",
    "exchange_ledger_batches",
    "exchange_ledger_entries",
    "exchange_product_capacity_policies",
    "exchange_order_contract_snapshots",
    "exchange_meter_intervals",
    "exchange_meter_evidence",
  ];
  for (const table of tables) {
    const sourceColumns = new Set(sourceDb.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    const columns = clone.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
      .filter((column) => sourceColumns.has(column));
    const rows = sourceDb.prepare(`SELECT ${columns.join(", ")} FROM ${table}`).all();
    if (!rows.length) continue;
    const placeholders = columns.map(() => "?").join(", ");
    const insert = clone.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);
    for (const row of rows) insert.run(...columns.map((column) => row[column]));
  }
  return clone;
}

function tableRows(db, table) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  return db.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY 1`).all().map((row) => ({ ...row }));
}

function copyRowUsingSharedColumns(source, target, table, where, values, overrides = {}) {
  const sourceColumns = new Set(source.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
  const columns = target.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
    .filter((column) => sourceColumns.has(column));
  const row = source.prepare(`SELECT * FROM ${table} WHERE ${where}`).get(...values);
  assert.ok(row, `${table} source row missing`);
  target.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...columns.map((column) => Object.hasOwn(overrides, column) ? overrides[column] : row[column]));
}

const migrationsThroughV10 = [
  ...exchangeMigrationFilesThroughV7,
  "0008_model_instance_capacity.sql",
  "0009_token_throughput_capacity.sql",
  "0010_nas_rack_capacity.sql",
];

test("GPU capacity is derived from parallel cards and exact continuous time", () => {
  const startAt = "2026-09-01T00:00:00.000Z";
  const endAt = "2026-09-02T01:00:00.000Z";
  const input = parseCreateCapacityLot({
    resourceAssetId: "KAI-RA-EXAMPLE",
    verificationRunId: "KAI-VR-EXAMPLE",
    startAt,
    endAt,
    rateUnits: 4,
    interruptibility: "NON_INTERRUPTIBLE",
  });
  assert.equal(deriveCapacityBaseUnits(BigInt(input.rateUnits), BigInt(25 * 60 * 60)), BigInt(100 * 3_600));
  assert.throws(() => parseCreateCapacityLot({ ...input, endAt: startAt }), /endAt/);
  assert.throws(
    () => parseCreateCheckout({
      listingVersionId: "KAI-LV-MILLISECOND-WINDOW",
      parallelUnits: 1,
      startAt: "2027-01-01T00:00:00.123Z",
      endAt: "2027-01-01T01:00:00.123Z",
      interruptibility: "NON_INTERRUPTIBLE",
    }),
    (error) => error instanceof ExchangeInputError && /整秒/u.test(error.message),
  );
});

test("M6 capacity math stays integer-only and preserves every GPU cent", () => {
  const gpuCases = [
    { unitPriceCents: 1, capacityGpuSeconds: 1 },
    { unitPriceCents: 2_500, capacityGpuSeconds: 75 * 3_600 },
    { unitPriceCents: 2_690, capacityGpuSeconds: 100 * 3_600 },
    { unitPriceCents: 999_999, capacityGpuSeconds: 7_201 },
  ];
  for (const item of gpuCases) {
    const legacy = (BigInt(item.unitPriceCents) * BigInt(item.capacityGpuSeconds) + BigInt(3_599)) / BigInt(3_600);
    const generalized = deriveCapacityAmountCents({
      unitPriceMicros: BigInt(item.unitPriceCents) * CNY_MICROS_PER_CENT,
      capacityBaseUnits: BigInt(item.capacityGpuSeconds),
      priceBasisBaseUnits: GPU_HOUR_PRICE_BASIS_BASE_UNITS,
    });
    assert.equal(generalized, legacy, JSON.stringify(item));
  }

  const modelBase = deriveCapacityBaseUnits(BigInt(2), BigInt(3_600));
  assert.equal(modelBase, BigInt(7_200));
  assert.equal(deriveCapacityAmountCents({
    unitPriceMicros: BigInt(5_000_000),
    capacityBaseUnits: modelBase,
    priceBasisBaseUnits: MODEL_INSTANCE_HOUR_PRICE_BASIS_BASE_UNITS,
  }), BigInt(1_000));

  const tokenBase = deriveCapacityBaseUnits(BigInt(1_000), BigInt(5 * 3_600));
  assert.equal(tokenBase, BigInt(18_000_000));
  assert.equal(deriveCapacityAmountCents({
    unitPriceMicros: BigInt(2_000_000),
    capacityBaseUnits: tokenBase,
    priceBasisBaseUnits: M_TOKEN_CAPACITY_HOUR_PRICE_BASIS_BASE_UNITS,
  }), BigInt(1_000));

  assert.equal(
    deriveCapacityBaseUnits(BigInt("1000000000000"), BigInt("1000000000000")),
    BigInt("1000000000000000000000000"),
  );
  assert.throws(() => deriveCapacityBaseUnits(BigInt(0), BigInt(1)), /rateUnits/u);
  assert.throws(() => deriveCapacityAmountCents({
    unitPriceMicros: BigInt(1),
    capacityBaseUnits: BigInt(1),
    priceBasisBaseUnits: BigInt(0),
  }), /priceBasisBaseUnits/u);
});

test("M8 commission estimate floors 300 basis points without safe-integer precision loss", () => {
  for (const base of [0, 1, 33, 34, 100, 9_007_199_254_740_991]) {
    const expected = Number(BigInt(base) * BigInt(300) / BigInt(10_000));
    assert.equal(deriveCommissionEstimateCents(base), expected);
  }
  assert.throws(() => deriveCommissionEstimateCents(Number.MAX_SAFE_INTEGER + 1), /safe integer/u);
});

test("checkout amount rejects values beyond JavaScript's exact integer range", () => {
  const input = parseCreateCheckout({
    listingVersionId: "KAI-LV-AMOUNT-LIMIT",
    rateUnits: 100_000,
    startAt: "2027-01-01T00:00:00.000Z",
    endAt: "2028-01-02T00:00:00.000Z",
    interruptibility: "NON_INTERRUPTIBLE",
  });
  assert.throws(
    () => newCheckoutRecords("buyer", "supplier", {
      capacityLotId: "KAI-LOT-AMOUNT-LIMIT",
      listingValidUntil: "2027-01-02T00:00:00.000Z",
      descriptor: {
        productCode: "GPU_COMPUTE", rateUnitCode: "GPU", fulfillmentModel: "GPU_ALLOCATION",
        pricingUnitCode: "GPU_HOUR", priceBasisBaseUnits: 3_600,
      },
      unitPriceMicros: 10_000_000_000_000,
    }, input),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_AMOUNT_TOO_LARGE",
  );
});

test("exchange migration is packaged and creates the immutable supply layers", async () => {
  const [source, packaged, checkoutSource, packagedCheckout, paymentSource, packagedPayment, deliverySource, packagedDelivery, meteringSource, packagedMetering, capacityCoreSource, packagedCapacityCore, modelCapacitySource, packagedModelCapacity, tokenCapacitySource, packagedTokenCapacity, m7CapacitySource, packagedM7Capacity] = await Promise.all([
    readFile("drizzle/0002_cloud_exchange.sql", "utf8"),
    readFile("dist/.openai/drizzle/0002_cloud_exchange.sql", "utf8"),
    readFile("drizzle/0003_gpu_checkout.sql", "utf8"),
    readFile("dist/.openai/drizzle/0003_gpu_checkout.sql", "utf8"),
    readFile("drizzle/0004_payment_delivery.sql", "utf8"),
    readFile("dist/.openai/drizzle/0004_payment_delivery.sql", "utf8"),
    readFile("drizzle/0005_delivery_package.sql", "utf8"),
    readFile("dist/.openai/drizzle/0005_delivery_package.sql", "utf8"),
    readFile("drizzle/0006_metering_acceptance_settlement.sql", "utf8"),
    readFile("dist/.openai/drizzle/0006_metering_acceptance_settlement.sql", "utf8"),
    readFile("drizzle/0007_general_capacity_core.sql", "utf8"),
    readFile("dist/.openai/drizzle/0007_general_capacity_core.sql", "utf8"),
    readFile("drizzle/0008_model_instance_capacity.sql", "utf8"),
    readFile("dist/.openai/drizzle/0008_model_instance_capacity.sql", "utf8"),
    readFile("drizzle/0009_token_throughput_capacity.sql", "utf8"),
    readFile("dist/.openai/drizzle/0009_token_throughput_capacity.sql", "utf8"),
    readFile("drizzle/0010_nas_rack_capacity.sql", "utf8"),
    readFile("dist/.openai/drizzle/0010_nas_rack_capacity.sql", "utf8"),
  ]);
  assert.equal(packaged, source);
  assert.equal(packagedCheckout, checkoutSource);
  assert.equal(packagedPayment, paymentSource);
  assert.equal(packagedDelivery, deliverySource);
  assert.equal(packagedMetering, meteringSource);
  assert.equal(packagedCapacityCore, capacityCoreSource);
  assert.equal(packagedModelCapacity, modelCapacitySource);
  assert.equal(packagedTokenCapacity, tokenCapacitySource);
  assert.equal(packagedM7Capacity, m7CapacitySource);
  const [m8CapacitySource, packagedM8Capacity, builtM8Capacity] = await Promise.all([
    readFile("drizzle/0011_withdraw_swap_commission.sql", "utf8"),
    readFile(".openai/drizzle/0011_withdraw_swap_commission.sql", "utf8"),
    readFile("dist/.openai/drizzle/0011_withdraw_swap_commission.sql", "utf8"),
  ]);
  assert.equal(packagedM8Capacity, m8CapacitySource);
  assert.equal(builtM8Capacity, m8CapacitySource);
  assert.doesNotMatch(m8CapacitySource, /ALTER\s+TABLE[\s\S]*?\s+RENAME/iu);
  assert.doesNotMatch(m7CapacitySource, /ALTER\s+TABLE[\s\S]*?\s+RENAME/iu);
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of checkoutSource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of paymentSource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of deliverySource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of meteringSource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of capacityCoreSource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of modelCapacitySource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of tokenCapacitySource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    for (const statement of m7CapacitySource.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    for (const table of [
      "exchange_product_versions",
      "exchange_resource_assets",
      "exchange_verification_runs",
      "exchange_capacity_lots",
      "exchange_listing_versions",
      "exchange_domain_events",
      "exchange_orders",
      "exchange_reservations",
      "exchange_capacity_transfers",
      "exchange_payment_intents",
      "exchange_payment_events",
      "exchange_delivery_tasks",
      "exchange_delivery_packages",
      "exchange_delivery_reviews",
      "exchange_delivery_claims",
      "exchange_connection_checks",
      "exchange_metering_sessions",
      "exchange_service_facts",
      "exchange_metering_finals",
      "exchange_acceptances",
      "exchange_settlements",
      "exchange_ledger_batches",
      "exchange_ledger_entries",
      "exchange_product_capacity_policies",
      "exchange_order_contract_snapshots",
      "exchange_meter_intervals",
      "exchange_meter_evidence",
    ]) assert.ok(tables.has(table), `missing ${table}`);
    const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all().map((row) => row.name));
    for (const trigger of [
      "exchange_product_versions_immutable_update",
      "exchange_product_versions_immutable_delete",
      "exchange_product_capacity_policies_immutable_update",
      "exchange_product_capacity_policies_immutable_delete",
      "exchange_order_contract_snapshots_immutable_update",
      "exchange_order_contract_snapshots_immutable_delete",
      "exchange_meter_intervals_no_overlap",
      "exchange_meter_intervals_immutable_update",
      "exchange_meter_intervals_immutable_delete",
      "exchange_meter_evidence_observed_within_interval",
      "exchange_meter_evidence_immutable_update",
      "exchange_meter_evidence_immutable_delete",
    ]) assert.ok(triggers.has(trigger), `missing ${trigger}`);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_product_versions").get().count, 4);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_product_capacity_policies").get().count, 6);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_product_capacity_policies
      WHERE product_code = 'GPU_COMPUTE' AND feature_status = 'ENABLED' AND product_version_id IS NOT NULL`).get().count, 4);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_product_capacity_policies
      WHERE product_code IN ('MODEL_INSTANCE', 'TOKEN_THROUGHPUT')
        AND feature_status = 'DISABLED' AND product_version_id IS NULL`).get().count, 2);
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM exchange_schema_migrations").get().version, 10);
    assert.deepEqual(
      db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
      [1, 2, 3, 4, 6, 7, 8, 9, 10],
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m10_%'").get().count, 0);
    assert.deepEqual(
      db.prepare("PRAGMA table_info(exchange_orders)").all().map((column) => column.name),
      [
        "id", "buyer_actor_id", "supplier_actor_id", "idempotency_key", "payload_hash", "listing_version_id",
        "rate_unit_code", "rate_units", "parallel_units", "start_at", "end_at", "capacity_base_units",
        "capacity_gpu_seconds", "unit_price_micros", "unit_price_cents", "total_amount_cents", "currency",
        "status", "hold_expires_at", "accounting_schema_version", "version", "created_at", "updated_at",
      ],
    );
    const tokenPolicy = db.prepare(`SELECT * FROM exchange_product_capacity_policies
      WHERE product_code = 'TOKEN_THROUGHPUT'`).get();
    assert.equal(tokenPolicy.rate_unit_code, "MILLI_M_TOKEN_PER_HOUR");
    assert.equal(tokenPolicy.rate_unit_scale_denominator, 1_000);
    assert.equal(tokenPolicy.price_basis_base_units, 3_600_000);
    assert.throws(
      () => db.prepare("UPDATE exchange_product_capacity_policies SET feature_status = 'ENABLED' WHERE id = ?")
        .run(tokenPolicy.id),
      /EXCHANGE_CAPACITY_POLICY_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_product_capacity_policies WHERE id = ?").run(tokenPolicy.id),
      /EXCHANGE_CAPACITY_POLICY_IMMUTABLE/u,
    );
  } finally {
    db.close();
  }
});

test("M7 v9 to v10 migration fault after destructive drops restores the exact v9 schema and rows", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  const files = [...exchangeMigrationFilesThroughV7, "0008_model_instance_capacity.sql", "0009_token_throughput_capacity.sql"];
  try {
    for (const fileName of files) applyExchangeMigrationFile(db, fileName);
    const objectProjection = () => db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name LIKE 'exchange_%' ORDER BY type, name`).all().map((row) => ({ ...row }));
    const beforeObjects = objectProjection();
    const beforeVersions = tableRows(db, "exchange_schema_migrations");
    const beforeProducts = tableRows(db, "exchange_product_versions");
    const beforePolicies = tableRows(db, "exchange_product_capacity_policies");
    const statements = readFileSync(join("drizzle", "0010_nas_rack_capacity.sql"), "utf8")
      .split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    const destructiveDropIndex = statements.findIndex((statement) => /^DROP TABLE exchange_orders;/u.test(statement));
    assert.ok(destructiveDropIndex > 0);

    let fault;
    let destructiveDropObserved = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements.slice(0, destructiveDropIndex + 1)) db.exec(statement);
      destructiveDropObserved = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'exchange_orders'").get().count === 0;
      db.prepare("INSERT INTO exchange_m10_guard(label, ok) VALUES ('forced_fault_after_drop', 0)").run();
      db.exec("COMMIT");
    } catch (error) {
      fault = error;
      db.exec("ROLLBACK");
    }

    assert.equal(destructiveDropObserved, true);
    assert.match(String(fault), /constraint failed/u);
    assert.deepEqual(objectProjection(), beforeObjects);
    assert.deepEqual(tableRows(db, "exchange_schema_migrations"), beforeVersions);
    assert.deepEqual(tableRows(db, "exchange_product_versions"), beforeProducts);
    assert.deepEqual(tableRows(db, "exchange_product_capacity_policies"), beforePolicies);
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM exchange_schema_migrations").get().version, 9);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m10_%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get().count, 0);
  } finally {
    db.close();
  }
});

test("M8 v10 to v11 failure after the transfer-table drop restores every v10 object and row", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    for (const fileName of [
      ...exchangeMigrationFilesThroughV7,
      "0008_model_instance_capacity.sql",
      "0009_token_throughput_capacity.sql",
      "0010_nas_rack_capacity.sql",
    ]) applyExchangeMigrationFile(db, fileName);
    const objectProjection = () => db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name LIKE 'exchange_%' ORDER BY type, name`).all().map((row) => ({ ...row }));
    const beforeObjects = objectProjection();
    const beforeVersions = tableRows(db, "exchange_schema_migrations");
    const beforeProducts = tableRows(db, "exchange_product_versions");
    const beforePolicies = tableRows(db, "exchange_product_capacity_policies");
    const beforeTransfers = tableRows(db, "exchange_capacity_transfers");
    const statements = readFileSync(join("drizzle", "0011_withdraw_swap_commission.sql"), "utf8")
      .split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    const destructiveDropIndex = statements.findIndex((statement) => /^DROP TABLE exchange_capacity_transfers;/u.test(statement));
    assert.ok(destructiveDropIndex > 0);

    let fault;
    let destructiveDropObserved = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of statements.slice(0, destructiveDropIndex + 1)) db.exec(statement);
      destructiveDropObserved = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'exchange_capacity_transfers'`).get().count === 0;
      db.prepare("INSERT INTO exchange_m11_guard(label, ok) VALUES ('forced_fault_after_drop', 0)").run();
      db.exec("COMMIT");
    } catch (error) {
      fault = error;
      db.exec("ROLLBACK");
    }

    assert.equal(destructiveDropObserved, true);
    assert.match(String(fault), /constraint failed/u);
    assert.deepEqual(objectProjection(), beforeObjects);
    assert.deepEqual(tableRows(db, "exchange_schema_migrations"), beforeVersions);
    assert.deepEqual(tableRows(db, "exchange_product_versions"), beforeProducts);
    assert.deepEqual(tableRows(db, "exchange_product_capacity_policies"), beforePolicies);
    assert.deepEqual(tableRows(db, "exchange_capacity_transfers"), beforeTransfers);
    assert.equal(db.prepare("SELECT MAX(version) AS version FROM exchange_schema_migrations").get().version, 10);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m11_%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get().count, 0);
  } finally {
    db.close();
  }
});

test("fresh v10 runtime enables immutable model, throughput, storage and rack products while templates stay disabled", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const products = await store.listProductVersions();
    assert.equal(products.length, 8);
    assert.equal(products.filter((product) => product.productCode === "GPU_COMPUTE").length, 4);
    assert.deepEqual(
      products.filter((product) => product.productCode === "MODEL_INSTANCE").map((product) => product.id),
      ["PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1"],
    );
    assert.deepEqual(
      products.filter((product) => product.productCode === "TOKEN_THROUGHPUT").map((product) => product.id),
      ["PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1"],
    );
    assert.deepEqual(
      products.filter((product) => product.productCode === "NAS_STORAGE").map((product) => product.id),
      ["PV-NAS-NFS41-BALANCED-1TIB-V1"],
    );
    assert.deepEqual(
      products.filter((product) => product.productCode === "RACK_SPACE").map((product) => product.id),
      ["PV-RACK-42U-10KW-MANAGED-V1"],
    );
    assert.equal(products.filter((product) => product.productCode === "POWER_CAPACITY").length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_product_capacity_policies").get().count, 10);
    const templates = db.prepare(`SELECT product_code, product_version_id, feature_status
      FROM exchange_product_capacity_policies WHERE feature_status = 'DISABLED' ORDER BY product_code`).all()
      .map((row) => ({ ...row }));
    assert.deepEqual(templates, [
      { product_code: "MODEL_INSTANCE", product_version_id: null, feature_status: "DISABLED" },
      { product_code: "TOKEN_THROUGHPUT", product_version_id: null, feature_status: "DISABLED" },
    ]);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_product_versions
      WHERE product_code = 'MODEL_INSTANCE'`).get().count, 1);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_product_versions
      WHERE product_code = 'TOKEN_THROUGHPUT'`).get().count, 1);
  } finally {
    db.close();
  }
});

test("M8 D1 version gate fails closed for existing v7/v8/v9/v10 and accepts only signed v11 history", async () => {
  const legacy = d1BackedBySqlite();
  for (const fileName of exchangeMigrationFilesThroughV7) applyExchangeMigrationFile(legacy.db, fileName);
  legacy.db.prepare("DELETE FROM exchange_schema_migrations WHERE version <> 7").run();
  const legacyObjects = legacy.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
    .all().map((row) => ({ ...row }));
  const legacyStore = createD1ExchangeStore(legacy.adapter);
  await assert.rejects(legacyStore.listProductVersions(), /EXCHANGE_MIGRATION_REQUIRED/u);
  assert.deepEqual(
    legacy.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
      .all().map((row) => ({ ...row })),
    legacyObjects,
  );
  assert.deepEqual(legacy.db.prepare("SELECT version FROM exchange_schema_migrations").all().map((row) => row.version), [7]);
  assert.ok(!legacy.db.prepare("PRAGMA table_info(exchange_orders)").all().some((column) => column.name === "rate_unit_code"));
  legacy.db.close();

  const deployed = d1BackedBySqlite();
  for (const fileName of [...exchangeMigrationFilesThroughV7, "0008_model_instance_capacity.sql"]) {
    applyExchangeMigrationFile(deployed.db, fileName);
  }
  deployed.db.prepare("DELETE FROM exchange_schema_migrations WHERE version NOT IN (7, 8)").run();
  const deployedStore = createD1ExchangeStore(deployed.adapter);
  const deployedObjects = deployed.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
    .all().map((row) => ({ ...row }));
  await assert.rejects(deployedStore.listProductVersions(), /EXCHANGE_MIGRATION_REQUIRED/u);
  assert.deepEqual(
    deployed.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
      .all().map((row) => ({ ...row })),
    deployedObjects,
  );
  assert.deepEqual(
    deployed.db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
    [7, 8],
  );
  applyExchangeMigrationFile(deployed.db, "0009_token_throughput_capacity.sql");
  const v9Store = createD1ExchangeStore(deployed.adapter);
  const v9Objects = deployed.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
    .all().map((row) => ({ ...row }));
  await assert.rejects(v9Store.listProductVersions(), /EXCHANGE_MIGRATION_REQUIRED/u);
  assert.deepEqual(
    deployed.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name LIKE 'exchange_%' ORDER BY type, name")
      .all().map((row) => ({ ...row })),
    v9Objects,
  );
  assert.deepEqual(
    deployed.db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
    [7, 8, 9],
  );
  applyExchangeMigrationFile(deployed.db, "0010_nas_rack_capacity.sql");
  const v10Store = createD1ExchangeStore(deployed.adapter);
  await assert.rejects(v10Store.listProductVersions(), /EXCHANGE_MIGRATION_REQUIRED/u);
  assert.deepEqual(
    deployed.db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
    [7, 8, 9, 10],
  );
  applyExchangeMigrationFile(deployed.db, "0011_withdraw_swap_commission.sql");
  const v11Store = createD1ExchangeStore(deployed.adapter);
  assert.equal((await v11Store.listProductVersions()).length, 8);
  assert.deepEqual(
    deployed.db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
    [7, 8, 9, 10, 11],
  );
  deployed.db.close();

  const invalid = d1BackedBySqlite();
  for (const fileName of exchangeMigrationFilesThroughV7) applyExchangeMigrationFile(invalid.db, fileName);
  invalid.db.prepare("DELETE FROM exchange_schema_migrations").run();
  invalid.db.prepare("INSERT INTO exchange_schema_migrations(version, applied_at) VALUES (5, ?)").run(new Date().toISOString());
  await assert.rejects(createD1ExchangeStore(invalid.adapter).listProductVersions(), /EXCHANGE_SCHEMA_HISTORY_INVALID/u);
  invalid.db.close();

  const badSignature = d1BackedBySqlite();
  for (const fileName of exchangeMigrationFilesThroughV7) applyExchangeMigrationFile(badSignature.db, fileName);
  badSignature.db.prepare("DELETE FROM exchange_schema_migrations WHERE version <> 7").run();
  badSignature.db.exec("ALTER TABLE exchange_capacity_lots ADD COLUMN rate_unit_code TEXT");
  await assert.rejects(createD1ExchangeStore(badSignature.adapter).listProductVersions(), /EXCHANGE_SCHEMA_SIGNATURE_INVALID/u);
  badSignature.db.close();
});

test("M6-A3 v8 to v9 failure injection atomically restores every object and row", () => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    for (const fileName of [...exchangeMigrationFilesThroughV7, "0008_model_instance_capacity.sql"]) {
      applyExchangeMigrationFile(db, fileName);
    }
    const beforeObjects = db.prepare(`SELECT type, name, sql FROM sqlite_master
      WHERE name LIKE 'exchange_%' ORDER BY type, name`).all().map((row) => ({ ...row }));
    const beforeVersions = db.prepare("SELECT version, applied_at FROM exchange_schema_migrations ORDER BY version")
      .all().map((row) => ({ ...row }));
    const statements = readFileSync(join("drizzle", "0009_token_throughput_capacity.sql"), "utf8")
      .split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean);
    const firstCoreDrop = statements.findIndex((statement) => statement.startsWith("DROP TABLE exchange_metering_finals"));
    assert.ok(firstCoreDrop > 0);
    db.exec("BEGIN IMMEDIATE");
    assert.throws(() => {
      for (let index = 0; index <= firstCoreDrop + 2; index += 1) db.exec(statements[index]);
      db.prepare("INSERT INTO exchange_m9_guard(label, ok) VALUES ('injected_failure', 0)").run();
    }, /constraint failed/u);
    db.exec("ROLLBACK");
    assert.deepEqual(
      db.prepare(`SELECT type, name, sql FROM sqlite_master
        WHERE name LIKE 'exchange_%' ORDER BY type, name`).all().map((row) => ({ ...row })),
      beforeObjects,
    );
    assert.deepEqual(
      db.prepare("SELECT version, applied_at FROM exchange_schema_migrations ORDER BY version")
        .all().map((row) => ({ ...row })),
      beforeVersions,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m9_%'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get().count, 0);
  } finally {
    db.close();
  }
});

test("M6-A1 canonical capacity windows reject invalid dates, offsets and fractional seconds", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m8-time-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const { order } = await startedDeliveryOrder(store, "m8-time");
  const db = new DatabaseSync(databasePath);
  try {
    assert.throws(
      () => db.prepare("UPDATE exchange_capacity_lots SET start_at = ? WHERE id = ?")
        .run("2027-01-01T00:00:00.123Z", order.reservation.capacityLotId),
      /constraint failed/u,
    );
    assert.throws(
      () => db.prepare("UPDATE exchange_orders SET start_at = ? WHERE id = ?")
        .run("2027-01-01T00:00:00+00:00", order.id),
      /constraint failed/u,
    );
    assert.throws(
      () => db.prepare("UPDATE exchange_reservations SET end_at = ? WHERE order_id = ?")
        .run("2027-02-30T00:00:00.000Z", order.id),
      /constraint failed/u,
    );
    assert.throws(
      () => db.prepare("UPDATE exchange_metering_sessions SET scheduled_end_at = ? WHERE order_id = ?")
        .run("2027-01-01T01:00:00.123Z", order.id),
      /constraint failed/u,
    );
  } finally {
    db.close();
  }
});

async function publishedGpuListing(store, supplier, scope, totalParallelUnits = 4) {
  const resource = (await store.createResource(context(supplier, `${scope}-resource`), parseCreateResourceAsset({
    productVersionId: "PV-GPU-H100-SXM5-80GB",
    title: `${scope} H100 SXM5 连续资源池`,
    region: "北京",
    deliveryForm: "容器实例",
    totalParallelUnits,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "含基础公网出口和集群内网",
  }))).record;
  const verification = (await store.createVerification(resource.id, context(`${scope}-ops`, `${scope}-verify`), parseCreateVerificationRun({
    method: "MANUAL",
    result: "PASS",
    evidenceSummary: "已核对 GPU 型号、显存、数量、连续时间窗和交付形态。",
    evidenceDigest: `sha256:${scope.padEnd(32, "0")}`,
    validUntil: iso(120 * 60 * 60 * 1_000),
  }))).record;
  const lot = (await store.createCapacityLot(context(supplier, `${scope}-lot`), parseCreateCapacityLot({
    resourceAssetId: resource.id,
    verificationRunId: verification.id,
    startAt: iso(24 * 60 * 60 * 1_000),
    endAt: iso(73 * 60 * 60 * 1_000),
    parallelUnits: totalParallelUnits,
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const listing = (await store.createListing(context(supplier, `${scope}-listing`), parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    unitPriceCents: 2500,
    minParallelUnits: 1,
    maxParallelUnits: totalParallelUnits,
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: true,
    networkIncluded: true,
    scopeNote: "人民币含税，包含基础电力、网络和约定 SLA。",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: "容器实例",
    validFrom: iso(-60 * 1_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  }))).record;
  return { resource, verification, lot, listing };
}

async function publishedModelListing(store, supplier, scope, totalRateUnits = 4) {
  const resource = (await store.createResource(context(supplier, `${scope}-resource`), parseCreateResourceAsset({
    productVersionId: "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1",
    title: `${scope} DeepSeek V4 Pro 标准实例池`,
    region: "华北",
    deliveryForm: "托管模型服务端点",
    totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "包含服务端点连通与基础访问链路",
  }))).record;
  const verification = (await store.createVerification(resource.id, context(`${scope}-ops`, `${scope}-verify`), parseCreateVerificationRun({
    method: "MANUAL",
    result: "PASS",
    evidenceSummary: "已核对模型身份、服务等级、实例并发和连续交付时间窗。",
    evidenceDigest: `sha256:${scope.padEnd(32, "0")}`,
    validUntil: iso(120 * 60 * 60 * 1_000),
  }))).record;
  const lot = (await store.createCapacityLot(context(supplier, `${scope}-lot`), parseCreateCapacityLot({
    resourceAssetId: resource.id,
    verificationRunId: verification.id,
    startAt: iso(24 * 60 * 60 * 1_000),
    endAt: iso(73 * 60 * 60 * 1_000),
    rateUnits: totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const listing = (await store.createListing(context(supplier, `${scope}-listing`), parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    unitPriceMicros: 25_001,
    minRateUnits: 1,
    maxRateUnits: totalRateUnits,
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: true,
    networkIncluded: true,
    scopeNote: "人民币含税，包含模型实例、基础链路和约定服务等级。",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: "托管模型服务端点",
    validFrom: iso(-60 * 1_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  }))).record;
  return { resource, verification, lot, listing };
}

async function publishedTokenListing(store, supplier, scope, totalRateUnits = 2_000) {
  const resource = (await store.createResource(context(supplier, `${scope}-resource`), parseCreateResourceAsset({
    productVersionId: "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1",
    title: `${scope} DeepSeek V4 Pro 标准吞吐容量池`,
    region: "区域无关",
    deliveryForm: "托管 Token 吞吐端点",
    totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "包含服务端点连通、供应商 tokenizer 与计费吞吐核验",
  }))).record;
  const verification = (await store.createVerification(resource.id, context(`${scope}-ops`, `${scope}-verify`), parseCreateVerificationRun({
    method: "MANUAL",
    result: "PASS",
    evidenceSummary: "已核对模型身份、tokenizer、输入输出合计吞吐口径和连续服务时间窗。",
    evidenceDigest: `sha256:${scope.padEnd(32, "0")}`,
    validUntil: iso(120 * 60 * 60 * 1_000),
  }))).record;
  const lot = (await store.createCapacityLot(context(supplier, `${scope}-lot`), parseCreateCapacityLot({
    resourceAssetId: resource.id,
    verificationRunId: verification.id,
    startAt: iso(24 * 60 * 60 * 1_000),
    endAt: iso(73 * 60 * 60 * 1_000),
    rateUnits: totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const listing = (await store.createListing(context(supplier, `${scope}-listing`), parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    unitPriceMicros: 2_000_000,
    minRateUnits: 1_000,
    maxRateUnits: totalRateUnits,
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: true,
    networkIncluded: true,
    scopeNote: "人民币含税，按每百万 Token 容量小时计价，输入与输出使用供应商 tokenizer 合并核验。",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: "托管 Token 吞吐端点",
    validFrom: iso(-60 * 1_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  }))).record;
  return { resource, verification, lot, listing };
}

async function publishedM7Listing(store, supplier, scope, product) {
  const isNas = product === "NAS_STORAGE";
  const productVersionId = isNas
    ? "PV-NAS-NFS41-BALANCED-1TIB-V1"
    : "PV-RACK-42U-10KW-MANAGED-V1";
  const totalRateUnits = isNas ? 2_048 : 2;
  const resource = (await store.createResource(context(supplier, `${scope}-resource`), parseCreateResourceAsset({
    productVersionId,
    title: isNas ? `${scope} NFS 4.1 均衡存储资源` : `${scope} 42U 10kW 托管共址资源`,
    region: isNas ? "华东" : "华北",
    deliveryForm: isNas ? "托管 NFS 卷" : "托管共址空间",
    totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: isNas
      ? "包含挂载链路、静态配额与约定可用性"
      : "包含双上联、约定功率与受管工单入口",
  }))).record;
  const verification = (await store.createVerification(
    resource.id,
    context(`${scope}-ops`, `${scope}-verify`),
    parseCreateVerificationRun({
      method: "MANUAL",
      result: "PASS",
      evidenceSummary: isNas
        ? "已核对协议、容量、性能层级、冗余、加密与连续服务时间窗。"
        : "已核对空间规格、承诺功率、制冷、网络、访问方式与连续服务时间窗。",
      evidenceDigest: `sha256:${scope.padEnd(32, "0")}`,
      validUntil: iso(120 * 60 * 60 * 1_000),
    }),
  )).record;
  const lot = (await store.createCapacityLot(context(supplier, `${scope}-lot`), parseCreateCapacityLot({
    resourceAssetId: resource.id,
    verificationRunId: verification.id,
    startAt: iso(24 * 60 * 60 * 1_000),
    endAt: iso(73 * 60 * 60 * 1_000),
    rateUnits: totalRateUnits,
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const listing = (await store.createListing(context(supplier, `${scope}-listing`), parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    unitPriceMicros: isNas ? 1_000_000 : 8_000_000,
    minRateUnits: isNas ? 1_024 : 1,
    maxRateUnits: totalRateUnits,
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: !isNas,
    networkIncluded: true,
    scopeNote: isNas
      ? "人民币含税，按 TiB 小时计价，包含约定性能、冗余与挂载链路。"
      : "人民币含税，按空间小时计价，包含 10kW 内电力、制冷与双上联。",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: isNas ? "托管 NFS 卷" : "托管共址空间",
    validFrom: iso(-60 * 1_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  }))).record;
  return { resource, verification, lot, listing };
}

async function readyLotForProduct(store, supplier, scope, productCode) {
  const configuration = {
    GPU_COMPUTE: { productVersionId: "PV-GPU-H100-SXM5-80GB", rateUnits: 4, gpu: true },
    MODEL_INSTANCE: { productVersionId: "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1", rateUnits: 4 },
    TOKEN_THROUGHPUT: { productVersionId: "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1", rateUnits: 2_000 },
    NAS_STORAGE: { productVersionId: "PV-NAS-NFS41-BALANCED-1TIB-V1", rateUnits: 2_048 },
    RACK_SPACE: { productVersionId: "PV-RACK-42U-10KW-MANAGED-V1", rateUnits: 2 },
  }[productCode];
  assert.ok(configuration, productCode);
  const resourceInput = {
    productVersionId: configuration.productVersionId,
    title: `${scope} verified capacity resource`,
    region: "CN-North",
    deliveryForm: "Managed service endpoint",
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "Includes the declared network path and service boundary.",
    ...(configuration.gpu
      ? { totalParallelUnits: configuration.rateUnits }
      : { totalRateUnits: configuration.rateUnits }),
  };
  const resource = (await store.createResource(
    context(supplier, `${scope}-resource`),
    parseCreateResourceAsset(resourceInput),
  )).record;
  const verification = (await store.createVerification(
    resource.id,
    context(`${scope}-ops`, `${scope}-verification`),
    parseCreateVerificationRun({
      method: "MANUAL",
      result: "PASS",
      evidenceSummary: "Identity, quantity, time window, delivery form and service boundary verified.",
      evidenceDigest: TEST_SHA256,
      validUntil: iso(120 * 60 * 60 * 1_000),
    }),
  )).record;
  const lot = (await store.createCapacityLot(
    context(supplier, `${scope}-lot`),
    parseCreateCapacityLot({
      resourceAssetId: resource.id,
      verificationRunId: verification.id,
      startAt: iso(24 * 60 * 60 * 1_000),
      endAt: iso(72 * 60 * 60 * 1_000),
      interruptibility: "NON_INTERRUPTIBLE",
      ...(configuration.gpu
        ? { parallelUnits: configuration.rateUnits }
        : { rateUnits: configuration.rateUnits }),
    }),
  )).record;
  return { resource, verification, lot, configuration };
}

function listingInputForLot(lot, configuration, unitPriceMicros = 1_000_000) {
  return parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    ...(configuration.gpu ? { unitPriceCents: unitPriceMicros / 10_000 } : { unitPriceMicros }),
    ...(configuration.gpu
      ? { minParallelUnits: 1, maxParallelUnits: configuration.rateUnits }
      : { minRateUnits: 1, maxRateUnits: configuration.rateUnits }),
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: true,
    networkIncluded: true,
    scopeNote: "CNY price includes the declared service scope and delivery boundary.",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: "Managed service endpoint",
    validFrom: iso(-60_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  });
}

async function completeTokenClose(store, db, scope, setServerNow, referral, beforeSettlement) {
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  await assert.rejects(
    store.createResource(context(supplier, `${scope}-legacy-resource`), parseCreateResourceAsset({
      productVersionId: "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1",
      title: `${scope} legacy alias rejection`, region: "区域无关",
      deliveryForm: "托管吞吐端点", totalParallelUnits: 1_000,
      interruptibility: "NON_INTERRUPTIBLE", networkScope: "用于验证非规范容量字段被拒绝",
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_UNIT_MISMATCH",
  );
  const { resource, lot, listing } = await publishedTokenListing(store, supplier, scope);
  assert.equal(resource.productCode, "TOKEN_THROUGHPUT");
  assert.equal(resource.rateUnitCode, "MILLI_M_TOKEN_PER_HOUR");
  assert.equal(resource.fulfillmentModel, "TOKEN_THROUGHPUT_RESERVATION");
  assert.equal(listing.pricingUnitCode, "M_TOKEN_CAPACITY_HOUR");
  assert.equal(listing.priceBasisBaseUnits, 3_600_000);
  assertTokenPayloadClean(resource);
  assertTokenPayloadClean(lot);
  assertTokenPayloadClean(listing);

  let order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
    listingVersionId: listing.id,
    rateUnits: 1_000,
    startAt: lot.startAt,
    endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
    interruptibility: "NON_INTERRUPTIBLE",
  }), referral)).record;
  assert.equal(order.productCode, "TOKEN_THROUGHPUT");
  assert.equal(order.capacityBaseUnits, 3_600_000);
  assert.equal(order.unitPriceMicros, 2_000_000);
  assert.equal(order.totalAmountCents, 200);
  assertTokenPayloadClean(order);
  const snapshot = db.prepare("SELECT * FROM exchange_order_contract_snapshots WHERE order_id = ?").get(order.id);
  assert.equal(snapshot.product_version_id, "PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1");
  assert.equal(snapshot.capacity_policy_id, "PCP-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1");
  assert.equal(snapshot.rate_unit_code, "MILLI_M_TOKEN_PER_HOUR");
  assert.equal(snapshot.price_basis_base_units, 3_600_000);
  assert.equal(snapshot.gross_amount_cents, 200);

  order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
    action: "CONFIRM", expectedVersion: order.version, reason: "确认吞吐容量、模型身份和交付排期。",
  }))).record;
  order = (await store.applyPaymentEvent(
    context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
    capturedTestEvent(order, scope),
  )).record;
  order = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
    expectedVersion: order.version, reason: "开始准备托管吞吐服务端点。",
  })).record;
  const expiresAt = new Date(Date.parse(order.endAt) + 60 * 60 * 1_000).toISOString();
  const submitted = await store.submitDeliveryPackage(order.delivery.id, context(supplier, `${scope}-submit`), parseSubmitDeliveryPackage({
    expectedVersion: order.delivery.version,
    publicProfile: {
      protocol: "HTTPS", endpointDisplay: "throughput-***.example.test", port: 443,
      usernameHint: "kai-throughput-user", expiresAt,
      instructionsSummary: "领取一次性测试码后，使用平台连接检查验证吞吐服务端点。",
    },
    evidenceDigest: TEST_SHA256,
  }));
  await store.reviewDeliveryPackage(submitted.record.id, context(`${scope}-ops`, `${scope}-review`), parseReviewDeliveryPackage({
    expectedVersion: submitted.record.version, decision: "PASS", verificationMethod: "SIMULATED_TEST",
    reason: "模型身份和吞吐口径事实完整，允许进入固定服务窗计量。", evidenceDigest: TEST_SHA256,
  }));
  order = await store.getOrder(buyer, order.id, "buyer");
  const claimed = await store.claimDeliveryPackage(submitted.record.id, context(buyer, `${scope}-claim`), parseClaimDeliveryPackage({
    expectedVersion: order.delivery.package.version,
  }));
  await store.testDeliveryConnection(submitted.record.id, context(buyer, `${scope}-connection`), parseTestDeliveryConnection({
    expectedVersion: claimed.record.package.version,
  }));
  order = await store.getOrder(buyer, order.id, "buyer");
  setServerNow(Date.parse(order.startAt));
  const started = await store.testStartService(order.id, context(`${scope}-ops`, `${scope}-service-start`), parseTestServiceStart({
    expectedVersion: order.metering.version,
  }));
  setServerNow(Date.parse(order.endAt) + 1_000);
  const completed = await store.testCompleteMetering(order.id, context(`${scope}-ops`, `${scope}-meter-final`), parseTestMeterComplete({
    expectedVersion: started.record.metering.version,
  }));
  assert.equal(completed.record.metering.scheduledCapacityBaseUnits, 3_600_000);
  assert.equal(completed.record.metering.availableCapacityBaseUnits, 3_600_000);
  assertTokenPayloadClean(completed.record);
  const accepted = await store.submitAcceptance(order.id, context(buyer, `${scope}-accept`), parseSubmitOrderAcceptance({
    expectedVersion: completed.record.acceptance.version, decision: "ACCEPT",
    reason: "吞吐服务时间窗、模型身份和计量证据已核对。", evidenceDigest: TEST_SHA256,
  }));
  beforeSettlement?.(accepted.record.settlement);
  const settled = await store.testRecordSettlement(accepted.record.settlement.id, context(`${scope}-ops`, `${scope}-settle`), parseTestRecordSettlement({
    expectedVersion: accepted.record.settlement.version,
  }));
  assert.equal(settled.record.status, "TEST_RECORDED");
  assert.equal(settled.record.fundsMoved, false);

  const evidenceTypes = db.prepare(`SELECT me.evidence_type FROM exchange_meter_evidence me
    JOIN exchange_meter_intervals mi ON mi.id = me.meter_interval_id
    WHERE mi.order_id = ? ORDER BY me.evidence_type`).all(order.id).map((row) => row.evidence_type);
  assert.deepEqual(evidenceTypes, ["MODEL_IDENTITY", "THROUGHPUT"]);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_meter_evidence me
    JOIN exchange_meter_intervals mi ON mi.id = me.meter_interval_id
    WHERE mi.order_id = ? AND me.evidence_type = 'INSTANCE_HEARTBEAT'`).get(order.id).count, 0);
  const ledger = db.prepare(`SELECT
    SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END) AS debits,
    SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END) AS credits
    FROM exchange_ledger_entries WHERE settlement_id = ?`).get(settled.record.id);
  assert.equal(ledger.debits, ledger.credits);

  for (const [table, where] of [
    ["exchange_capacity_lots", "id = ?"],
    ["exchange_listing_versions", "id = ?"],
    ["exchange_orders", "id = ?"],
    ["exchange_reservations", "order_id = ?"],
    ["exchange_capacity_transfers", "order_id = ?"],
    ["exchange_metering_sessions", "order_id = ?"],
    ["exchange_service_facts", "order_id = ?"],
    ["exchange_metering_finals", "order_id = ?"],
  ]) {
    const key = table === "exchange_capacity_lots" ? lot.id : table === "exchange_listing_versions" ? listing.id : order.id;
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where} AND accounting_schema_version <> 4`).get(key).count, 0, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_lots WHERE id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL)").get(lot.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_listing_versions WHERE id = ? AND (min_parallel_units IS NOT NULL OR max_parallel_units IS NOT NULL OR unit_price_cents IS NOT NULL)").get(listing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_orders WHERE id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL OR unit_price_cents IS NOT NULL)").get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_reservations WHERE order_id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL)").get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id = ? AND capacity_gpu_seconds IS NOT NULL").get(order.id).count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_metering_sessions WHERE order_id = ?
    AND (scheduled_gpu_seconds IS NOT NULL OR available_gpu_seconds IS NOT NULL
      OR unavailable_gpu_seconds IS NOT NULL OR unproven_gpu_seconds IS NOT NULL)`).get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_service_facts WHERE order_id = ? AND available_gpu_seconds IS NOT NULL").get(order.id).count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_metering_finals WHERE order_id = ?
    AND (scheduled_gpu_seconds IS NOT NULL OR available_gpu_seconds IS NOT NULL
      OR unavailable_gpu_seconds IS NOT NULL OR unproven_gpu_seconds IS NOT NULL)`).get(order.id).count, 0);
  for (const table of ["exchange_domain_events", "exchange_command_receipts"]) {
    const column = table === "exchange_domain_events" ? "payload_json" : "response_json";
    for (const row of db.prepare(`SELECT ${column} AS payload FROM ${table}`).all()) {
      assertTokenPayloadClean(JSON.parse(row.payload), table);
    }
  }
  return { order: completed.record, settled: settled.record };
}

async function completeM7Close(store, db, scope, product, setServerNow) {
  const isNas = product === "NAS_STORAGE";
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  const productVersionId = isNas
    ? "PV-NAS-NFS41-BALANCED-1TIB-V1"
    : "PV-RACK-42U-10KW-MANAGED-V1";
  await assert.rejects(
    store.createResource(context(supplier, `${scope}-legacy-resource`), parseCreateResourceAsset({
      productVersionId,
      title: `${scope} legacy alias rejection`,
      region: "华北",
      deliveryForm: isNas ? "托管 NFS 卷" : "托管共址空间",
      totalParallelUnits: isNas ? 1_024 : 1,
      interruptibility: "NON_INTERRUPTIBLE",
      networkScope: "用于验证非规范容量字段被拒绝",
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_UNIT_MISMATCH",
  );
  const { resource, lot, listing } = await publishedM7Listing(store, supplier, scope, product);
  const clean = isNas ? assertNasPayloadClean : assertRackPayloadClean;
  const expected = isNas ? {
    policyId: "PCP-NAS-NFS41-BALANCED-1TIB-V1",
    rateUnitCode: "GIB_STORAGE",
    fulfillmentModel: "NAS_VOLUME_ALLOCATION",
    pricingUnitCode: "TIB_HOUR",
    rateUnits: 1_024,
    capacityBaseUnits: 3_686_400,
    priceBasisBaseUnits: 3_686_400,
    totalAmountCents: 100,
    evidenceTypes: ["STORAGE_AVAILABILITY", "STORAGE_IDENTITY"],
    protocol: "NFS",
  } : {
    policyId: "PCP-RACK-42U-10KW-MANAGED-V1",
    rateUnitCode: "RACK",
    fulfillmentModel: "RACK_COLOCATION_ALLOCATION",
    pricingUnitCode: "RACK_HOUR",
    rateUnits: 1,
    capacityBaseUnits: 3_600,
    priceBasisBaseUnits: 3_600,
    totalAmountCents: 800,
    evidenceTypes: ["FACILITY_IDENTITY", "RACK_AVAILABILITY"],
    protocol: "WORK_ORDER",
  };
  assert.equal(resource.productCode, product);
  assert.equal(resource.rateUnitCode, expected.rateUnitCode);
  assert.equal(resource.fulfillmentModel, expected.fulfillmentModel);
  assert.equal(listing.pricingUnitCode, expected.pricingUnitCode);
  assert.equal(listing.priceBasisBaseUnits, expected.priceBasisBaseUnits);
  clean(resource);
  clean(lot);
  clean(listing);

  const checkoutInput = parseCreateCheckout({
    listingVersionId: listing.id,
    rateUnits: expected.rateUnits,
    startAt: lot.startAt,
    endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
    interruptibility: "NON_INTERRUPTIBLE",
  });
  const checkoutContext = context(buyer, `${scope}-checkout`, `${scope}-checkout-payload`);
  let order = (await store.createCheckout(checkoutContext, checkoutInput)).record;
  const replay = await store.createCheckout(checkoutContext, checkoutInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, order.id);
  assert.equal(order.capacityBaseUnits, expected.capacityBaseUnits);
  assert.equal(order.totalAmountCents, expected.totalAmountCents);
  clean(order);
  clean(replay.record);
  const snapshot = db.prepare("SELECT * FROM exchange_order_contract_snapshots WHERE order_id = ?").get(order.id);
  assert.equal(snapshot.product_version_id, productVersionId);
  assert.equal(snapshot.capacity_policy_id, expected.policyId);
  assert.equal(snapshot.rate_unit_code, expected.rateUnitCode);
  assert.equal(snapshot.pricing_unit_code, expected.pricingUnitCode);
  assert.equal(snapshot.capacity_base_units, expected.capacityBaseUnits);
  assert.equal(snapshot.price_basis_base_units, expected.priceBasisBaseUnits);
  assert.equal(snapshot.gross_amount_cents, expected.totalAmountCents);
  const identity = JSON.parse(snapshot.product_identity_json);
  if (isNas) {
    assert.equal(identity.protocol, "NFS_4_1");
    assert.equal(identity.minIopsPerTiB, 3_000);
    assert.equal(identity.minThroughputMiBpsPerTiB, 200);
    assert.equal(identity.encryptionAtRest, true);
  } else {
    assert.equal(identity.rackUnits, 42);
    assert.equal(identity.committedPowerKw, 10);
    assert.equal(identity.access, "MANAGED_WORK_ORDER");
  }

  order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
    action: "CONFIRM",
    expectedVersion: order.version,
    reason: isNas ? "确认容量、挂载协议与交付排期。" : "确认空间、功率与交付排期。",
  }))).record;
  order = (await store.applyPaymentEvent(
    context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
    capturedTestEvent(order, scope),
  )).record;
  order = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
    expectedVersion: order.version,
    reason: isNas ? "开始准备挂载配额与服务端点。" : "开始准备共址工单与现场资源。",
  })).record;
  const expiresAt = new Date(Date.parse(order.endAt) + 60 * 60 * 1_000).toISOString();
  const baseProfile = {
    endpointDisplay: isNas ? "nfs-***.example.test:/tenant" : "work-order-***.example.test",
    port: isNas ? 2_049 : 443,
    usernameHint: isNas ? "volume-user" : "site-service",
    expiresAt,
    instructionsSummary: isNas
      ? "领取一次性测试码后，按说明校验挂载端点与只读配额。"
      : "领取一次性测试码后，按说明进入受管工单并核对空间与网络状态。",
  };
  await assert.rejects(
    store.submitDeliveryPackage(order.delivery.id, context(supplier, `${scope}-wrong-profile`), parseSubmitDeliveryPackage({
      expectedVersion: order.delivery.version,
      publicProfile: { ...baseProfile, protocol: "HTTPS" },
      evidenceDigest: TEST_SHA256,
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_UNIT_MISMATCH",
  );
  const submitted = await store.submitDeliveryPackage(
    order.delivery.id,
    context(supplier, `${scope}-submit`),
    parseSubmitDeliveryPackage({
      expectedVersion: order.delivery.version,
      publicProfile: { ...baseProfile, protocol: expected.protocol },
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(submitted.record.publicProfile.protocol, expected.protocol);
  assert.ok(!/password|private key|api[_ -]?key|secret/iu.test(JSON.stringify(submitted.record.publicProfile)));
  clean(submitted.record);
  await store.reviewDeliveryPackage(
    submitted.record.id,
    context(`${scope}-ops`, `${scope}-review`),
    parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version,
      decision: "PASS",
      verificationMethod: "SIMULATED_TEST",
      reason: isNas ? "挂载协议、配额与端点事实完整。" : "工单入口、空间、功率与网络事实完整。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  order = await store.getOrder(buyer, order.id, "buyer");
  const claimed = await store.claimDeliveryPackage(
    submitted.record.id,
    context(buyer, `${scope}-claim`),
    parseClaimDeliveryPackage({ expectedVersion: order.delivery.package.version }),
  );
  await store.testDeliveryConnection(
    submitted.record.id,
    context(buyer, `${scope}-connection`),
    parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version }),
  );
  order = await store.getOrder(buyer, order.id, "buyer");
  setServerNow(Date.parse(order.startAt));
  const started = await store.testStartService(
    order.id,
    context(`${scope}-ops`, `${scope}-service-start`),
    parseTestServiceStart({ expectedVersion: order.metering.version }),
  );
  setServerNow(Date.parse(order.endAt) + 1_000);
  const completed = await store.testCompleteMetering(
    order.id,
    context(`${scope}-ops`, `${scope}-meter-final`),
    parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
  );
  assert.equal(completed.record.metering.scheduledCapacityBaseUnits, expected.capacityBaseUnits);
  assert.equal(completed.record.metering.availableCapacityBaseUnits, expected.capacityBaseUnits);
  clean(completed.record);
  const evidenceTypes = db.prepare(`SELECT me.evidence_type FROM exchange_meter_evidence me
    JOIN exchange_meter_intervals mi ON mi.id = me.meter_interval_id
    WHERE mi.order_id = ? ORDER BY me.evidence_type`).all(order.id).map((row) => row.evidence_type);
  assert.deepEqual(evidenceTypes, expected.evidenceTypes);
  const accepted = await store.submitAcceptance(
    order.id,
    context(buyer, `${scope}-accept`),
    parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version,
      decision: "ACCEPT",
      reason: isNas ? "容量时间窗、挂载事实与计量证据已核对。" : "空间时间窗、工单事实与计量证据已核对。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  const settled = await store.testRecordSettlement(
    accepted.record.settlement.id,
    context(`${scope}-ops`, `${scope}-settle`),
    parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version }),
  );
  assert.equal(settled.record.status, "TEST_RECORDED");
  assert.equal(settled.record.fundsMoved, false);
  const ledger = db.prepare(`SELECT
    SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END) AS debits,
    SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END) AS credits
    FROM exchange_ledger_entries WHERE settlement_id = ?`).get(settled.record.id);
  assert.equal(ledger.debits, ledger.credits);

  for (const [table, where] of [
    ["exchange_capacity_lots", "id = ?"],
    ["exchange_listing_versions", "id = ?"],
    ["exchange_orders", "id = ?"],
    ["exchange_reservations", "order_id = ?"],
    ["exchange_capacity_transfers", "order_id = ?"],
    ["exchange_metering_sessions", "order_id = ?"],
    ["exchange_service_facts", "order_id = ?"],
    ["exchange_metering_finals", "order_id = ?"],
  ]) {
    const key = table === "exchange_capacity_lots" ? lot.id : table === "exchange_listing_versions" ? listing.id : order.id;
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where} AND accounting_schema_version <> 4`).get(key).count, 0, table);
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_lots WHERE id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL)").get(lot.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_listing_versions WHERE id = ? AND (min_parallel_units IS NOT NULL OR max_parallel_units IS NOT NULL OR unit_price_cents IS NOT NULL)").get(listing.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_orders WHERE id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL OR unit_price_cents IS NOT NULL)").get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_reservations WHERE order_id = ? AND (parallel_units IS NOT NULL OR capacity_gpu_seconds IS NOT NULL)").get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id = ? AND capacity_gpu_seconds IS NOT NULL").get(order.id).count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_metering_sessions WHERE order_id = ?
    AND (scheduled_gpu_seconds IS NOT NULL OR available_gpu_seconds IS NOT NULL
      OR unavailable_gpu_seconds IS NOT NULL OR unproven_gpu_seconds IS NOT NULL)`).get(order.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_service_facts WHERE order_id = ? AND available_gpu_seconds IS NOT NULL").get(order.id).count, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_metering_finals WHERE order_id = ?
    AND (scheduled_gpu_seconds IS NOT NULL OR available_gpu_seconds IS NOT NULL
      OR unavailable_gpu_seconds IS NOT NULL OR unproven_gpu_seconds IS NOT NULL)`).get(order.id).count, 0);
  for (const table of ["exchange_domain_events", "exchange_command_receipts"]) {
    const column = table === "exchange_domain_events" ? "payload_json" : "response_json";
    for (const row of db.prepare(`SELECT ${column} AS payload FROM ${table}`).all()) clean(JSON.parse(row.payload), table);
  }
  return { order: completed.record, settled: settled.record };
}

test("M6-A3 SQLite TOKEN_THROUGHPUT completes M0-M5 with canonical evidence and balanced settlement", async () => {
  let serverNowMs = Date.now();
  const databasePath = join(tmpdir(), `kai-cloud-m6-a3-token-close-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    await completeTokenClose(store, db, "m6-a3-token-close", (value) => { serverNowMs = value; });
  } finally {
    db.close();
  }
});

test("M6-A3 D1 TOKEN_THROUGHPUT completes M0-M5 without legacy aliases", async () => {
  let serverNowMs = Date.now();
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
  try {
    await completeTokenClose(store, db, "m6-a3-d1-token-close", (value) => { serverNowMs = value; });
  } finally {
    db.close();
  }
});

for (const product of ["NAS_STORAGE", "RACK_SPACE"]) {
  test(`M7 SQLite ${product} completes M0-M5 with immutable units and exact evidence`, async () => {
    let serverNowMs = Date.now();
    const databasePath = join(tmpdir(), `kai-cloud-m7-${product.toLowerCase()}-${crypto.randomUUID()}.sqlite`);
    const store = createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
    const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      await completeM7Close(store, db, `m7-sqlite-${product.toLowerCase()}`, product, (value) => { serverNowMs = value; });
    } finally {
      db.close();
    }
  });

  test(`M7 D1 ${product} completes M0-M5 with immutable units and exact evidence`, async () => {
    let serverNowMs = Date.now();
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
    try {
      await completeM7Close(store, db, `m7-d1-${product.toLowerCase()}`, product, (value) => { serverNowMs = value; });
    } finally {
      db.close();
    }
  });
}

for (const product of ["NAS_STORAGE", "RACK_SPACE"]) {
  test(`M7 D1 ${product} checkout 0-row guard rolls back every write and receipt replay fails closed without its snapshot`, async () => {
    const isNas = product === "NAS_STORAGE";
    const rateUnits = isNas ? 1_024 : 1;
    const clean = isNas ? assertNasPayloadClean : assertRackPayloadClean;

    {
      const { db, adapter } = d1BackedBySqlite();
      const store = createD1ExchangeStore(adapter);
      const scope = `m7-${product.toLowerCase()}-guard`;
      try {
        const { lot, listing } = await publishedM7Listing(store, `${scope}-supplier`, scope, product);
        const input = parseCreateCheckout({
          listingVersionId: listing.id,
          rateUnits,
          startAt: lot.startAt,
          endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
          interruptibility: "NON_INTERRUPTIBLE",
        });
        adapter.zeroNextBatchStatement(3);
        await assert.rejects(
          store.createCheckout(context(`${scope}-buyer`, `${scope}-checkout`), input),
          /integer overflow/u,
        );
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_orders").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_reservations").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id IS NOT NULL").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_order_contract_snapshots").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'CREATE_CHECKOUT'").get().count, 0);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'ORDER_CAPACITY_HELD'").get().count, 0);
      } finally {
        db.close();
      }
    }

    {
      const { db, adapter } = d1BackedBySqlite();
      const store = createD1ExchangeStore(adapter);
      const scope = `m7-${product.toLowerCase()}-replay`;
      try {
        const { lot, listing } = await publishedM7Listing(store, `${scope}-supplier`, scope, product);
        const input = parseCreateCheckout({
          listingVersionId: listing.id,
          rateUnits,
          startAt: lot.startAt,
          endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
          interruptibility: "NON_INTERRUPTIBLE",
        });
        const write = context(`${scope}-buyer`, `${scope}-checkout`, `${scope}-payload`);
        const first = await store.createCheckout(write, input);
        const replay = await store.createCheckout(write, input);
        assert.equal(replay.replayed, true);
        assert.equal(replay.record.id, first.record.id);
        assert.equal(db.prepare("SELECT accounting_schema_version FROM exchange_orders WHERE id = ?").get(first.record.id).accounting_schema_version, 4);
        clean(replay.record);
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'CREATE_CHECKOUT'").get(first.record.id).count, 1);

        db.exec("DROP TRIGGER exchange_order_contract_snapshots_immutable_delete");
        db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(first.record.id);
        await assert.rejects(
          store.createCheckout(write, input),
          /EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING/u,
        );
        assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'CREATE_CHECKOUT'").get(first.record.id).count, 1);
      } finally {
        db.close();
      }
    }
  });
}

test("M6-A3 D1 Token checkout guard rolls back v3 partial writes and receipt replay requires the DB snapshot", async () => {
  {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    try {
      const { lot, listing } = await publishedTokenListing(store, "m6-a3-token-guard-supplier", "m6-a3-token-guard");
      const input = parseCreateCheckout({
        listingVersionId: listing.id, rateUnits: 1_000, startAt: lot.startAt,
        endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
        interruptibility: "NON_INTERRUPTIBLE",
      });
      adapter.zeroNextBatchStatement(3);
      await assert.rejects(
        store.createCheckout(context("m6-a3-token-guard-buyer", "m6-a3-token-guard-checkout"), input),
        /integer overflow/u,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_orders").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_reservations").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id IS NOT NULL").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_order_contract_snapshots").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'CREATE_CHECKOUT'").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'ORDER_CAPACITY_HELD'").get().count, 0);
    } finally {
      db.close();
    }
  }

  {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    try {
      const { lot, listing } = await publishedTokenListing(store, "m6-a3-token-replay-supplier", "m6-a3-token-replay");
      const input = parseCreateCheckout({
        listingVersionId: listing.id, rateUnits: 1_000, startAt: lot.startAt,
        endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
        interruptibility: "NON_INTERRUPTIBLE",
      });
      const write = context("m6-a3-token-replay-buyer", "m6-a3-token-replay-checkout", "m6-a3-token-replay-payload");
      const first = await store.createCheckout(write, input);
      const replay = await store.createCheckout(write, input);
      assert.equal(replay.replayed, true);
      assert.equal(replay.record.id, first.record.id);
      assertTokenPayloadClean(replay.record);
      assert.equal(db.prepare("SELECT accounting_schema_version FROM exchange_orders WHERE id = ?").get(first.record.id).accounting_schema_version, 4);
      db.exec("DROP TRIGGER exchange_order_contract_snapshots_immutable_delete");
      db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(first.record.id);
      await assert.rejects(
        store.createCheckout(write, input),
        /EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING/u,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'CREATE_CHECKOUT'").get(first.record.id).count, 1);
    } finally {
      db.close();
    }
  }
});

test("M6-A2 SQLite MODEL M0-M2 publishes and atomically checks out canonical capacity with a snapshot", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m6-a2-model-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const supplier = "m6-a2-model-supplier";
  const { resource, lot, listing } = await publishedModelListing(store, supplier, "m6-a2-model", 4);
  assert.equal(resource.productCode, "MODEL_INSTANCE");
  assert.equal(resource.totalRateUnits, 4);
  assert.ok(!Object.hasOwn(resource, "totalParallelUnits"));
  assert.equal(lot.rateUnitCode, "MODEL_INSTANCE");
  assert.equal(lot.capacityBaseUnits, lot.rateUnits * lot.durationSeconds);
  assert.ok(!Object.hasOwn(lot, "parallelUnits"));
  assert.equal(listing.pricingUnitCode, "MODEL_INSTANCE_HOUR");
  assert.equal(listing.unitPriceMicros, 25_001);
  assert.ok(!Object.hasOwn(listing, "unitPriceCents"));
  const order = (await store.createCheckout(context("m6-a2-model-buyer", "m6-a2-model-checkout"), parseCreateCheckout({
    listingVersionId: listing.id,
    rateUnits: 2,
    startAt: lot.startAt,
    endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  assert.equal(order.productCode, "MODEL_INSTANCE");
  assert.equal(order.capacityBaseUnits, 7_200);
  assert.equal(order.totalAmountCents, 6);
  for (const key of ["parallelUnits", "capacityGpuSeconds", "capacityGpuHours", "unitPriceCents"]) {
    assert.ok(!Object.hasOwn(order, key), `${key} leaked from MODEL order`);
  }
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    const snapshot = db.prepare("SELECT * FROM exchange_order_contract_snapshots WHERE order_id = ?").get(order.id);
    assert.equal(snapshot.product_version_id, "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1");
    assert.equal(snapshot.rate_unit_code, "MODEL_INSTANCE");
    assert.equal(snapshot.unit_price_micros, 25_001);
    assert.equal(snapshot.gross_amount_cents, 6);
    db.exec("DROP TRIGGER exchange_order_contract_snapshots_immutable_delete");
    db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(order.id);
    db.prepare("UPDATE exchange_orders SET total_amount_cents = total_amount_cents + 1 WHERE id = ?").run(order.id);
    assert.throws(() => db.prepare(`INSERT INTO exchange_order_contract_snapshots (
      id, order_id, listing_version_id, product_version_id, capacity_policy_id,
      product_code, rate_unit_code, fulfillment_model, pricing_unit_code,
      rate_units, duration_seconds, capacity_base_units, unit_price_micros,
      price_basis_base_units, gross_amount_cents, currency, product_identity_json,
      sla_json, evidence_policy_version, snapshot_digest, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      snapshot.id, snapshot.order_id, snapshot.listing_version_id, snapshot.product_version_id,
      snapshot.capacity_policy_id, snapshot.product_code, snapshot.rate_unit_code, snapshot.fulfillment_model,
      snapshot.pricing_unit_code, snapshot.rate_units, snapshot.duration_seconds, snapshot.capacity_base_units,
      snapshot.unit_price_micros, snapshot.price_basis_base_units, snapshot.gross_amount_cents + 1,
      snapshot.currency, snapshot.product_identity_json, snapshot.sla_json, snapshot.evidence_policy_version,
      snapshot.snapshot_digest, snapshot.created_at,
    ), /EXCHANGE_ORDER_CONTRACT_TERMS_MISMATCH/u);
  } finally {
    db.close();
  }
  await assert.rejects(
    store.getOrder("m6-a2-model-buyer", order.id, "buyer"),
    /EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING/u,
  );
});

async function confirmedPaymentOrder(store, scope) {
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  const { lot, listing } = await publishedGpuListing(store, supplier, scope, 4);
  const order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
    listingVersionId: listing.id,
    parallelUnits: 4,
    startAt: lot.startAt,
    endAt: new Date(Date.parse(lot.startAt) + 25 * 60 * 60 * 1_000).toISOString(),
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const confirmed = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
    action: "CONFIRM",
    expectedVersion: order.version,
    reason: "已确认连续容量和交付排期，创建平台测试支付订单。",
  }))).record;
  assert.equal(confirmed.payment?.status, "PENDING");
  assert.equal(confirmed.payment?.provider, "SIMULATED");
  assert.equal(confirmed.payment?.environment, "TEST");
  return { supplier, buyer, order: confirmed };
}

function capturedTestEvent(order, scope) {
  const now = iso(0);
  return {
    provider: "SIMULATED",
    environment: "TEST",
    providerEventId: `SIM-EVT-${scope.padEnd(12, "0")}`,
    providerTransactionId: `SIM-TXN-${scope.padEnd(12, "0")}`,
    providerOrderId: order.payment.id,
    merchantAccountRef: order.payment.merchantAccountRef,
    eventType: "CAPTURED",
    amountCents: order.payment.amountCents,
    currency: "CNY",
    occurredAt: now,
    rawPayloadDigest: `sha256:${scope.padEnd(32, "0")}`,
    verificationMethod: "SERVER_GENERATED_TEST_EVENT",
    verifiedAt: now,
    fundsMoved: false,
  };
}

async function startedDeliveryOrder(store, scope) {
  const { supplier, buyer, order } = await confirmedPaymentOrder(store, scope);
  const paid = (await store.applyPaymentEvent(
    context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
    capturedTestEvent(order, scope),
  )).record;
  const supplierView = await store.getOrder(supplier, order.id, "supplier");
  const started = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
    expectedVersion: supplierView.version,
    reason: "供应商开始准备 GPU 测试交付信息。",
  })).record;
  return { supplier, buyer, order: started, paid };
}

function deliveryPackageInput(order, expiresAt = iso(6 * 60 * 60 * 1_000)) {
  return parseSubmitDeliveryPackage({
    expectedVersion: order.delivery.version,
    publicProfile: {
      protocol: "SSH",
      endpointDisplay: "gpu-***.example.test",
      port: 22,
      usernameHint: "kai-test-user",
      expiresAt,
      instructionsSummary: "领取一次性测试码后，在测试终端执行平台提供的连接检查。",
    },
    evidenceDigest: TEST_SHA256,
  });
}

test("checkout atomically reserves a time slice, forbids self-dealing, and releases a rejected hold", async () => {
  const store = createSqliteExchangeStore(":memory:");
  const supplier = "checkout-supplier";
  const { lot, listing } = await publishedGpuListing(store, supplier, "checkout", 4);
  const startAt = new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 25 * 60 * 60 * 1_000).toISOString();
  const buyThree = parseCreateCheckout({ listingVersionId: listing.id, parallelUnits: 3, startAt, endAt, interruptibility: "NON_INTERRUPTIBLE" });

  await assert.rejects(
    store.createCheckout(context(supplier, "self-checkout"), buyThree),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_OWNERSHIP_FORBIDDEN",
  );

  const buyerAContext = context("buyer-a", "checkout-buyer-a", "checkout-a-hash");
  const orderA = (await store.createCheckout(buyerAContext, buyThree)).record;
  assert.equal(orderA.capacityGpuHours, 75);
  assert.equal(orderA.totalAmountCents, 187_500);
  assert.equal(orderA.status, "PENDING_SUPPLIER_CONFIRMATION");
  assert.deepEqual(orderA.allowedActions, []);
  assert.deepEqual((await store.getOrder(supplier, orderA.id, "supplier")).allowedActions, ["SUPPLIER_CONFIRM", "SUPPLIER_REJECT"]);
  await assert.rejects(store.getOrder(supplier, orderA.id, "buyer"), /订单不存在/);
  await assert.rejects(store.getOrder("buyer-a", orderA.id, "supplier"), /订单不存在/);
  assert.equal((await store.createCheckout(buyerAContext, buyThree)).replayed, true);

  await assert.rejects(
    store.createCheckout(context("buyer-interrupt", "checkout-interrupt-mismatch"), parseCreateCheckout({
      listingVersionId: listing.id, parallelUnits: 1, startAt, endAt, interruptibility: "INTERRUPTIBLE",
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
  );

  await assert.rejects(
    store.createCheckout(context("buyer-b", "checkout-overbook"), parseCreateCheckout({
      listingVersionId: listing.id, parallelUnits: 2, startAt, endAt, interruptibility: "NON_INTERRUPTIBLE",
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_CAPACITY_CONFLICT",
  );

  const confirmationContext = context(supplier, "confirm-order-a", "confirm-a-hash");
  const confirmation = parseSupplierConfirmation({ action: "CONFIRM", expectedVersion: 1, reason: "已再次核对连续时间窗和交付排期。" });
  const confirmed = (await store.confirmOrder(orderA.id, confirmationContext, confirmation)).record;
  assert.equal(confirmed.status, "AWAITING_PAYMENT");
  assert.equal(confirmed.reservation.state, "SUPPLIER_CONFIRMED");
  assert.equal(confirmed.version, 2);
  assert.deepEqual((await store.getOrder("buyer-a", orderA.id, "buyer")).allowedActions, ["SIMULATE_PAYMENT"]);
  assert.equal((await store.confirmOrder(orderA.id, confirmationContext, confirmation)).replayed, true);
  await assert.rejects(
    store.confirmOrder(orderA.id, context(supplier, "confirm-stale-version"), confirmation),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_VERSION_CONFLICT",
  );

  const orderB = (await store.createCheckout(context("buyer-b", "checkout-one-card"), parseCreateCheckout({
    listingVersionId: listing.id, parallelUnits: 1, startAt, endAt, interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  const rejected = (await store.confirmOrder(orderB.id, context(supplier, "reject-order-b"), parseSupplierConfirmation({
    action: "REJECT", expectedVersion: 1, reason: "该时间窗临时进入维护，释放预留。",
  }))).record;
  assert.equal(rejected.status, "CANCELLED");
  assert.equal(rejected.reservation.state, "RELEASED");
  const orderC = (await store.createCheckout(context("buyer-c", "checkout-after-release"), parseCreateCheckout({
    listingVersionId: listing.id, parallelUnits: 1, startAt, endAt, interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  assert.equal(orderC.status, "PENDING_SUPPLIER_CONFIRMATION");
  await assert.rejects(store.getOrder("buyer-stranger", orderA.id, "buyer"), /订单不存在/);
});

async function assertInterleavedWindowsAreAccepted(store, scope) {
  const { lot, listing } = await publishedGpuListing(store, `${scope}-supplier`, scope, 4);
  const firstStart = new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString();
  const boundary = new Date(Date.parse(firstStart) + 60 * 60 * 1_000).toISOString();
  const secondEnd = new Date(Date.parse(boundary) + 60 * 60 * 1_000).toISOString();
  const common = { listingVersionId: listing.id, interruptibility: "NON_INTERRUPTIBLE" };
  await store.createCheckout(context(`${scope}-buyer-1`, `${scope}-checkout-1`), parseCreateCheckout({
    ...common, parallelUnits: 2, startAt: firstStart, endAt: boundary,
  }));
  await store.createCheckout(context(`${scope}-buyer-2`, `${scope}-checkout-2`), parseCreateCheckout({
    ...common, parallelUnits: 2, startAt: boundary, endAt: secondEnd,
  }));
  const spanning = await store.createCheckout(context(`${scope}-buyer-3`, `${scope}-checkout-3`), parseCreateCheckout({
    ...common, parallelUnits: 1, startAt: firstStart, endAt: secondEnd,
  }));
  assert.equal(spanning.record.parallelUnits, 1);
}

test("capacity checks use peak concurrency instead of summing non-simultaneous windows", async () => {
  await assertInterleavedWindowsAreAccepted(createSqliteExchangeStore(":memory:"), "peak-sqlite");
  const { db, adapter } = d1BackedBySqlite();
  try {
    await assertInterleavedWindowsAreAccepted(createD1ExchangeStore(adapter), "peak-d1");
  } finally {
    db.close();
  }
});

test("supplier supply flow requires verification, prevents overlapping over-allocation, and publishes one immutable listing", async () => {
  const store = createSqliteExchangeStore(":memory:");
  const supplier = "supplier-a";
  const resourceInput = parseCreateResourceAsset({
    productVersionId: "PV-GPU-H100-SXM5-80GB",
    title: "华北 H100 SXM5 连续资源池",
    region: "北京",
    deliveryForm: "容器实例",
    totalParallelUnits: 8,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "含基础公网出口与集群内网",
  });
  const resourceWrite = context(supplier, "resource-create-1", "resource-hash-1");
  const resource = (await store.createResource(resourceWrite, resourceInput)).record;
  const replay = await store.createResource(resourceWrite, resourceInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, resource.id);
  await assert.rejects(
    store.createResource({ ...resourceWrite, payloadHash: "different" }, resourceInput),
    ExchangeIdempotencyConflictError,
  );

  const startAt = iso(24 * 60 * 60 * 1_000);
  const endAt = iso(49 * 60 * 60 * 1_000);
  const lotBase = {
    resourceAssetId: resource.id,
    verificationRunId: "KAI-VR-NOT-VERIFIED",
    startAt,
    endAt,
    parallelUnits: 6,
    interruptibility: "NON_INTERRUPTIBLE",
  };
  await assert.rejects(
    store.createCapacityLot(context(supplier, "lot-before-verify"), parseCreateCapacityLot(lotBase)),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_VERIFICATION_REQUIRED",
  );

  const verificationInput = parseCreateVerificationRun({
    method: "MANUAL",
    result: "PASS",
    evidenceSummary: "运营已核对 GPU 型号、显存、节点数量与连续可用时间窗。",
    evidenceDigest: "sha256:8fba22d9579d4aacaec2d02e3ca349a7",
    validUntil: iso(72 * 60 * 60 * 1_000),
  });
  const verification = (await store.createVerification(
    resource.id,
    context("ops-a", "verification-pass"),
    verificationInput,
  )).record;

  const lot = (await store.createCapacityLot(
    context(supplier, "capacity-lot-one"),
    parseCreateCapacityLot({ ...lotBase, verificationRunId: verification.id }),
  )).record;
  assert.equal(lot.capacityGpuHours, 150);

  await assert.rejects(
    store.createCapacityLot(
      context(supplier, "capacity-lot-overlap"),
      parseCreateCapacityLot({ ...lotBase, verificationRunId: verification.id, parallelUnits: 3 }),
    ),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_CAPACITY_CONFLICT",
  );

  const listingInput = parseCreateListingVersion({
    capacityLotId: lot.id,
    expectedLotVersion: lot.version,
    unitPriceCents: 2690,
    minParallelUnits: 2,
    maxParallelUnits: 6,
    minDurationMinutes: 60,
    taxIncluded: true,
    energyIncluded: true,
    networkIncluded: true,
    scopeNote: "人民币含税，包含基础电力、网络与约定 SLA。",
    sla: { availabilityPercent: 99.5, responseMinutes: 30 },
    deliveryForm: "容器实例",
    validFrom: iso(-60 * 1_000),
    validUntil: iso(12 * 60 * 60 * 1_000),
  });
  const listing = (await store.createListing(context(supplier, "listing-publish-1"), listingInput)).record;
  assert.equal(listing.pricingUnitCode, "GPU_HOUR");
  assert.equal(listing.unitPriceCents, 2690);
  assert.equal((await store.listMarketListings()).length, 1);
  await assert.rejects(
    store.createListing(context(supplier, "listing-publish-2"), listingInput),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
  );
});

test("verification validity must cover the entire capacity window", async () => {
  const store = createSqliteExchangeStore(":memory:");
  const supplier = "supplier-expiry";
  const resource = (await store.createResource(context(supplier, "resource-expiry"), parseCreateResourceAsset({
    productVersionId: "PV-GPU-H100-PCIE-80GB",
    title: "华东 H100 PCIe 资源池",
    region: "上海",
    deliveryForm: "裸金属",
    totalParallelUnits: 4,
    interruptibility: "NON_INTERRUPTIBLE",
    networkScope: "专线另行确认，基础内网已包含",
  }))).record;
  const verification = (await store.createVerification(resource.id, context("ops-b", "verify-short"), parseCreateVerificationRun({
    method: "MANUAL",
    result: "PASS",
    evidenceSummary: "已核对节点与 GPU 硬件信息，验真仅覆盖短期窗口。",
    evidenceDigest: "sha256:0bca6dd1cbf44aa6bcfcd96a9f0ef31f",
    validUntil: iso(12 * 60 * 60 * 1_000),
  }))).record;
  await assert.rejects(
    store.createCapacityLot(context(supplier, "lot-after-expiry"), parseCreateCapacityLot({
      resourceAssetId: resource.id,
      verificationRunId: verification.id,
      startAt: iso(10 * 60 * 60 * 1_000),
      endAt: iso(20 * 60 * 60 * 1_000),
      parallelUnits: 4,
      interruptibility: "NON_INTERRUPTIBLE",
    })),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_VERIFICATION_EXPIRED",
  );
});

test("D1 implementation follows the same verified supply path and market projection", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    assert.equal((await store.listProductVersions()).length, 8);
    const supplier = "supplier-d1";
    const resource = (await store.createResource(context(supplier, "d1-resource"), parseCreateResourceAsset({
      productVersionId: "PV-GPU-H20-PCIE-96GB",
      title: "华南 H20 PCIe 连续资源池",
      region: "广东",
      deliveryForm: "容器实例",
      totalParallelUnits: 8,
      interruptibility: "NON_INTERRUPTIBLE",
      networkScope: "包含基础公网出口和集群内网",
    }))).record;
    const verification = (await store.createVerification(resource.id, context("ops-d1", "d1-verify"), parseCreateVerificationRun({
      method: "CONNECTOR",
      result: "PASS",
      evidenceSummary: "连接器已核对 GPU 标识、型号、显存、卡数和连续时间窗。",
      evidenceDigest: "sha256:d1f55db21c454fb9b17e9ef1cd9ee4e0",
      validUntil: iso(96 * 60 * 60 * 1_000),
    }))).record;
    const lot = (await store.createCapacityLot(context(supplier, "d1-lot"), parseCreateCapacityLot({
      resourceAssetId: resource.id,
      verificationRunId: verification.id,
      startAt: iso(24 * 60 * 60 * 1_000),
      endAt: iso(49 * 60 * 60 * 1_000),
      parallelUnits: 4,
      interruptibility: "NON_INTERRUPTIBLE",
    }))).record;
    assert.equal(lot.capacityGpuHours, 100);
    await store.createListing(context(supplier, "d1-listing"), parseCreateListingVersion({
      capacityLotId: lot.id,
      expectedLotVersion: lot.version,
      unitPriceCents: 1990,
      minParallelUnits: 1,
      maxParallelUnits: 4,
      minDurationMinutes: 60,
      taxIncluded: true,
      energyIncluded: true,
      networkIncluded: true,
      scopeNote: "人民币含税，含基础电力、网络和标准交付支持。",
      sla: { availabilityPercent: 99.5, responseMinutes: 30 },
      deliveryForm: "容器实例",
      validFrom: iso(-60 * 1_000),
      validUntil: iso(12 * 60 * 60 * 1_000),
    }));
    const market = await store.listMarketListings();
    assert.equal(market.length, 1);
    assert.equal(market[0].product.displayName, "NVIDIA H20 PCIe 96GB");
    assert.equal(market[0].lot.capacityGpuHours, 100);
    const checkout = (await store.createCheckout(context("buyer-d1", "d1-checkout"), parseCreateCheckout({
      listingVersionId: market[0].id,
      parallelUnits: 4,
      startAt: market[0].lot.startAt,
      endAt: market[0].lot.endAt,
      interruptibility: market[0].resource.interruptibility,
    }))).record;
    assert.equal(checkout.capacityGpuHours, 100);
    const confirmed = (await store.confirmOrder(checkout.id, context(supplier, "d1-confirm"), parseSupplierConfirmation({
      action: "CONFIRM", expectedVersion: 1, reason: "连接器已确认容量窗口。",
    }))).record;
    assert.equal(confirmed.status, "AWAITING_PAYMENT");
  } finally {
    db.close();
  }
});

test("D1 concurrent checkout with the same idempotency key returns one record and one replay", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { lot, listing } = await publishedGpuListing(store, "idem-supplier", "idem-d1", 4);
    const input = parseCreateCheckout({
      listingVersionId: listing.id,
      parallelUnits: 4,
      startAt: lot.startAt,
      endAt: new Date(Date.parse(lot.startAt) + 2 * 60 * 60 * 1_000).toISOString(),
      interruptibility: "NON_INTERRUPTIBLE",
    });
    const write = context("idem-buyer", "same-checkout-command", "same-checkout-payload");
    const results = await Promise.all([store.createCheckout(write, input), store.createCheckout(write, input)]);
    assert.equal(results[0].record.id, results[1].record.id);
    assert.equal(results.filter((result) => result.replayed).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_orders").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'CHECKOUT_RESERVED'").get().count, 1);
  } finally {
    db.close();
  }
});

test("D1 concurrent idempotency replays every conditional supply creation", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    await store.listProductVersions();
    const supplier = "supply-idem-supplier";
    const resourceInput = parseCreateResourceAsset({
      productVersionId: "PV-GPU-H100-SXM5-80GB",
      title: "华北 H100 幂等验证资源池",
      region: "北京",
      deliveryForm: "容器实例",
      totalParallelUnits: 4,
      interruptibility: "NON_INTERRUPTIBLE",
      networkScope: "包含基础公网出口和集群内网。",
    });
    const resourceWrite = context(supplier, "concurrent-resource", "concurrent-resource-payload");
    const resources = await Promise.all([
      store.createResource(resourceWrite, resourceInput),
      store.createResource(resourceWrite, resourceInput),
    ]);
    assert.equal(resources[0].record.id, resources[1].record.id);
    assert.equal(resources.filter((result) => result.replayed).length, 1);

    const verificationInput = parseCreateVerificationRun({
      method: "MANUAL",
      result: "PASS",
      evidenceSummary: "已核对 GPU 型号、显存、卡数、连续时间窗与交付形态。",
      evidenceDigest: "sha256:concurrent-verification-0000000000000000",
      validUntil: iso(96 * 60 * 60 * 1_000),
    });
    const verificationWrite = context("supply-idem-ops", "concurrent-verification", "concurrent-verification-payload");
    const verifications = await Promise.all([
      store.createVerification(resources[0].record.id, verificationWrite, verificationInput),
      store.createVerification(resources[0].record.id, verificationWrite, verificationInput),
    ]);
    assert.equal(verifications[0].record.id, verifications[1].record.id);
    assert.equal(verifications.filter((result) => result.replayed).length, 1);

    const lotInput = parseCreateCapacityLot({
      resourceAssetId: resources[0].record.id,
      verificationRunId: verifications[0].record.id,
      startAt: iso(24 * 60 * 60 * 1_000),
      endAt: iso(49 * 60 * 60 * 1_000),
      parallelUnits: 4,
      interruptibility: "NON_INTERRUPTIBLE",
    });
    const lotWrite = context(supplier, "concurrent-lot", "concurrent-lot-payload");
    const lots = await Promise.all([store.createCapacityLot(lotWrite, lotInput), store.createCapacityLot(lotWrite, lotInput)]);
    assert.equal(lots[0].record.id, lots[1].record.id);
    assert.equal(lots.filter((result) => result.replayed).length, 1);

    const listingInput = parseCreateListingVersion({
      capacityLotId: lots[0].record.id,
      expectedLotVersion: lots[0].record.version,
      unitPriceCents: 2_500,
      minParallelUnits: 1,
      maxParallelUnits: 4,
      minDurationMinutes: 60,
      taxIncluded: true,
      energyIncluded: true,
      networkIncluded: true,
      scopeNote: "人民币含税，包含基础电力、网络和约定 SLA。",
      sla: { availabilityPercent: 99.5, responseMinutes: 30 },
      deliveryForm: "容器实例",
      validFrom: iso(-60 * 1_000),
      validUntil: iso(12 * 60 * 60 * 1_000),
    });
    const listingWrite = context(supplier, "concurrent-listing", "concurrent-listing-payload");
    const listings = await Promise.all([store.createListing(listingWrite, listingInput), store.createListing(listingWrite, listingInput)]);
    assert.equal(listings[0].record.id, listings[1].record.id);
    assert.equal(listings.filter((result) => result.replayed).length, 1);
  } finally {
    db.close();
  }
});

test("M6-A2 D1 active guard rolls back when the first or last required resource write affects zero rows", async () => {
  for (const [scope, zeroIndex] of [["first", 0], ["last", 1]]) {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    try {
      await store.listProductVersions();
      adapter.zeroNextBatchStatement(zeroIndex);
      await assert.rejects(
        store.createResource(context(`guard-${scope}-supplier`, `guard-${scope}-resource`), parseCreateResourceAsset({
          productVersionId: "PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1",
          title: `guard-${scope} model resource`, region: "华北", deliveryForm: "托管模型服务端点",
          totalRateUnits: 2, interruptibility: "NON_INTERRUPTIBLE", networkScope: "基础访问链路",
        })),
        /integer overflow/u,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_resource_assets").get().count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events").get().count, 0);
    } finally {
      db.close();
    }
  }
});

test("D1 supplier rejection cannot double-release a concurrently expired hold", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const supplier = "race-supplier";
    const { lot, listing } = await publishedGpuListing(store, supplier, "reject-expiry-race", 4);
    const order = (await store.createCheckout(context("race-buyer", "race-checkout"), parseCreateCheckout({
      listingVersionId: listing.id,
      parallelUnits: 2,
      startAt: lot.startAt,
      endAt: new Date(Date.parse(lot.startAt) + 2 * 60 * 60 * 1_000).toISOString(),
      interruptibility: "NON_INTERRUPTIBLE",
    }))).record;
    adapter.beforeNextBatch((raceDb) => {
      const at = new Date().toISOString();
      raceDb.prepare("UPDATE exchange_reservations SET state = 'EXPIRED', version = version + 1, updated_at = ? WHERE order_id = ?")
        .run(at, order.id);
      raceDb.prepare("UPDATE exchange_orders SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?")
        .run(at, order.id);
      raceDb.prepare(`INSERT INTO exchange_capacity_transfers (
        id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
        rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
      ) VALUES (?, ?, ?, ?, 'HELD', 'AVAILABLE', 'GPU', ?, ?, 'RESERVATION_EXPIRED', ?)`)
        .run("KAI-CT-CONCURRENT-EXPIRY", lot.id, order.id, `order:${order.id}:expired`,
          order.capacityGpuSeconds, order.capacityGpuSeconds, at);
    });
    await assert.rejects(
      store.confirmOrder(order.id, context(supplier, "race-reject"), parseSupplierConfirmation({
        action: "REJECT", expectedVersion: 1, reason: "并发过期后的拒绝不能再次释放容量。",
      })),
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_VERSION_CONFLICT",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'RESERVATION_EXPIRED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'SUPPLIER_REJECTED'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'SUPPLIER_REJECT'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'SUPPLIER_CONFIRMATION'").get().count, 0);
  } finally {
    db.close();
  }
});

test("M6-A2 D1 expiry guards roll back reservation and delivery-package inner 0-row faults", async () => {
  {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    const scope = "a2-guard-reservation-expiry";
    const supplier = `${scope}-supplier`;
    try {
      const { lot, listing } = await publishedModelListing(store, supplier, scope, 2);
      const order = (await store.createCheckout(context(`${scope}-buyer`, `${scope}-checkout`), parseCreateCheckout({
        listingVersionId: listing.id, rateUnits: 1, startAt: lot.startAt,
        endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
        interruptibility: "NON_INTERRUPTIBLE",
      }))).record;
      const expiredAt = iso(-60_000);
      db.prepare("UPDATE exchange_orders SET hold_expires_at = ? WHERE id = ?").run(expiredAt, order.id);
      db.prepare("UPDATE exchange_reservations SET hold_expires_at = ? WHERE order_id = ?").run(expiredAt, order.id);
      const before = db.prepare(`SELECT o.status AS order_status, o.version AS order_version,
          r.state AS reservation_state, r.version AS reservation_version
        FROM exchange_orders o JOIN exchange_reservations r ON r.order_id = o.id WHERE o.id = ?`).get(order.id);
      adapter.zeroNextBatchStatement(1);
      await assert.rejects(
        store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
          action: "CONFIRM", expectedVersion: order.version, reason: "过期容量不能继续确认。",
        })),
        /integer overflow/u,
      );
      assert.deepEqual(db.prepare(`SELECT o.status AS order_status, o.version AS order_version,
          r.state AS reservation_state, r.version AS reservation_version
        FROM exchange_orders o JOIN exchange_reservations r ON r.order_id = o.id WHERE o.id = ?`).get(order.id), before);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id = ? AND reason = 'RESERVATION_EXPIRED'").get(order.id).count, 0);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'RESERVATION_EXPIRED'").get(order.id).count, 0);
    } finally {
      db.close();
    }
  }

  {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    const scope = "a2-guard-package-expiry";
    try {
      const started = await startedDeliveryOrder(store, scope);
      const submitted = await store.submitDeliveryPackage(
        started.order.delivery.id,
        context(started.supplier, `${scope}-submit`, `${scope}-submit-payload`),
        deliveryPackageInput(started.order),
      );
      db.prepare("UPDATE exchange_delivery_packages SET credential_expires_at = ? WHERE id = ?")
        .run(iso(-60_000), submitted.record.id);
      const beforePackage = db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id);
      const beforeTask = db.prepare("SELECT status, version, attempt FROM exchange_delivery_tasks WHERE id = ?").get(started.order.delivery.id);
      const beforeOrder = db.prepare("SELECT version FROM exchange_orders WHERE id = ?").get(started.order.id);
      const reviewWrite = context(`${scope}-ops`, `${scope}-review`, `${scope}-review-payload`);
      const reviewInput = parseReviewDeliveryPackage({
        expectedVersion: submitted.record.version, decision: "PASS", verificationMethod: "SIMULATED_TEST",
        reason: "过期交付包不能通过。", evidenceDigest: TEST_SHA256,
      });
      adapter.zeroNextBatchStatement(1);
      await assert.rejects(store.reviewDeliveryPackage(submitted.record.id, reviewWrite, reviewInput), /integer overflow/u);
      assert.deepEqual(db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id), beforePackage);
      assert.deepEqual(db.prepare("SELECT status, version, attempt FROM exchange_delivery_tasks WHERE id = ?").get(started.order.delivery.id), beforeTask);
      assert.deepEqual(db.prepare("SELECT version FROM exchange_orders WHERE id = ?").get(started.order.id), beforeOrder);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'DELIVERY_PACKAGE_EXPIRED'").get(submitted.record.id).count, 0);
    } finally {
      db.close();
    }
  }
});

test("SQLite test payment atomically captures, locks capacity, and creates a pending delivery task", async () => {
  const store = createSqliteExchangeStore(":memory:");
  const { supplier, order } = await confirmedPaymentOrder(store, "payment-sqlite");
  const event = capturedTestEvent(order, "payment-sqlite");
  const write = context("payment-sqlite-adapter", "payment-sqlite-event", "payment-sqlite-payload");
  const applied = await store.applyPaymentEvent(write, event);
  assert.equal(applied.record.userPhase, "开通中");
  assert.equal(applied.record.status, "FULFILLING");
  assert.equal(applied.record.payment.status, "CAPTURED");
  assert.equal(applied.record.payment.providerPaymentId, event.providerTransactionId);
  assert.equal(applied.record.reservation.state, "COMMITTED");
  assert.equal(applied.record.delivery.status, "PENDING");
  assert.deepEqual(applied.record.allowedActions, []);
  const supplierView = await store.getOrder(supplier, order.id, "supplier");
  assert.deepEqual(supplierView.allowedActions, ["START_PROVISIONING"]);
  const replay = await store.applyPaymentEvent(write, event);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.id, applied.record.id);
  const startWrite = context(supplier, "payment-sqlite-start", "payment-sqlite-start-payload");
  const started = await store.startProvisioning(order.id, startWrite, {
    expectedVersion: supplierView.version,
    reason: "供应商已领取任务并开始准备 GPU 运行环境。",
  });
  assert.equal(started.record.delivery.status, "PROVISIONING");
  assert.deepEqual(started.record.allowedActions, ["SUBMIT_DELIVERY_PACKAGE"]);
  assert.equal((await store.startProvisioning(order.id, startWrite, {
    expectedVersion: supplierView.version,
    reason: "供应商已领取任务并开始准备 GPU 运行环境。",
  })).replayed, true);
});

test("D1 concurrent test payment produces one capture, one lock transfer, and one delivery task", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { order } = await confirmedPaymentOrder(store, "payment-d1");
    const event = capturedTestEvent(order, "payment-d1");
    const write = context("payment-d1-adapter", "payment-d1-event", "payment-d1-payload");
    const results = await Promise.all([store.applyPaymentEvent(write, event), store.applyPaymentEvent(write, event)]);
    assert.equal(results[0].record.id, results[1].record.id);
    assert.equal(results.filter((result) => result.replayed).length, 1);
    assert.equal(results[0].record.userPhase, "开通中");
    assert.equal(results[0].record.reservation.state, "COMMITTED");
    assert.equal(results[0].record.delivery.status, "PENDING");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE outcome = 'APPLIED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'PAYMENT_CAPTURED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_tasks").get().count, 1);
  } finally {
    db.close();
  }
});

test("payment mismatch is recorded for review without changing order, capacity, or delivery", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { buyer, order } = await confirmedPaymentOrder(store, "payment-review");
    const event = { ...capturedTestEvent(order, "payment-review"), amountCents: order.payment.amountCents + 1 };
    const reviewWrite = context("payment-review-adapter", "payment-review-event", "payment-review-payload");
    const reviewResults = await Promise.allSettled([
      store.applyPaymentEvent(reviewWrite, event),
      store.applyPaymentEvent(reviewWrite, event),
    ]);
    assert.equal(reviewResults.every((result) => result.status === "rejected"
      && result.reason instanceof ExchangeDomainError
      && result.reason.code === "EXCHANGE_PAYMENT_REVIEW_REQUIRED"), true);
    await assert.rejects(
      store.applyPaymentEvent({ ...reviewWrite, payloadHash: "different-review-payload" }, event),
      ExchangeIdempotencyConflictError,
    );
    const unchanged = await store.getOrder(buyer, order.id, "buyer");
    assert.equal(unchanged.userPhase, "待支付");
    assert.equal(unchanged.payment.status, "PENDING");
    assert.equal(unchanged.reservation.state, "SUPPLIER_CONFIRMED");
    assert.equal(unchanged.delivery, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE outcome = 'REVIEW_REQUIRED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'PAYMENT_CAPTURED'").get().count, 0);
  } finally {
    db.close();
  }
});

test("a concurrent duplicate transaction event replays without a unique-key error", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { order } = await confirmedPaymentOrder(store, "payment-duplicate-txn");
    const first = capturedTestEvent(order, "payment-duplicate-txn");
    const second = {
      ...first,
      providerEventId: `${first.providerEventId}-SECOND`,
      rawPayloadDigest: `${first.rawPayloadDigest}-SECOND`,
    };
    const applied = await store.applyPaymentEvent(
      context("duplicate-adapter", "duplicate-event-one", "duplicate-payload-one"),
      first,
    );
    assert.equal(applied.replayed, false);
    const duplicateWrite = context("duplicate-adapter", "duplicate-event-two", "duplicate-payload-two");
    const results = await Promise.all([
      store.applyPaymentEvent(duplicateWrite, second),
      store.applyPaymentEvent(duplicateWrite, second),
    ]);
    assert.equal(results.every((result) => result.replayed), true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE outcome = 'APPLIED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE outcome = 'IGNORED_DUPLICATE_TRANSACTION'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_tasks").get().count, 1);
  } finally {
    db.close();
  }
});

test("payment racing with reservation expiry cannot revive or double-move capacity", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { order } = await confirmedPaymentOrder(store, "payment-expiry-race");
    const event = capturedTestEvent(order, "payment-expiry-race");
    adapter.beforeNextBatch((raceDb) => {
      const at = new Date().toISOString();
      raceDb.prepare("UPDATE exchange_reservations SET state = 'EXPIRED', version = version + 1, updated_at = ? WHERE order_id = ?")
        .run(at, order.id);
      raceDb.prepare("UPDATE exchange_orders SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?")
        .run(at, order.id);
      raceDb.prepare(`INSERT INTO exchange_capacity_transfers (
        id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
        rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
      ) SELECT 'KAI-CT-PAYMENT-EXPIRY-RACE', capacity_lot_id, order_id, ?, 'HELD', 'AVAILABLE',
          'GPU', capacity_gpu_seconds, capacity_gpu_seconds, 'RESERVATION_EXPIRED', ?
        FROM exchange_reservations WHERE order_id = ?`)
        .run(`order:${order.id}:expired`, at, order.id);
    });
    const lateWrite = context("expiry-race-adapter", "expiry-race-event", "expiry-race-payload");
    await assert.rejects(
      store.applyPaymentEvent(lateWrite, event),
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_PAYMENT_LATE_CAPTURE",
    );
    await assert.rejects(
      store.applyPaymentEvent(lateWrite, event),
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_PAYMENT_LATE_CAPTURE",
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'RESERVATION_EXPIRED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE reason = 'PAYMENT_CAPTURED'").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_tasks").get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE outcome = 'LATE_CAPTURE_REVIEW'").get().count, 1);
  } finally {
    db.close();
  }
});

test("D1 start provisioning is supplier-owned, idempotent, and rejects a concurrent payload conflict", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { supplier, buyer, order } = await confirmedPaymentOrder(store, "provisioning-d1");
    const event = capturedTestEvent(order, "provisioning-d1");
    const paid = await store.applyPaymentEvent(context("provisioning-adapter", "provisioning-payment", "provisioning-payment-payload"), event);
    await assert.rejects(
      store.startProvisioning(order.id, context(buyer, "buyer-cannot-provision"), {
        expectedVersion: paid.record.version,
        reason: "买方不能启动供应商交付任务。",
      }),
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_OWNERSHIP_FORBIDDEN",
    );
    const sameKey = "provisioning-race-key";
    const firstContext = context(supplier, sameKey, "provisioning-first-payload");
    const secondContext = context(supplier, sameKey, "provisioning-second-payload");
    const [first, second] = await Promise.allSettled([
      store.startProvisioning(order.id, firstContext, {
        expectedVersion: paid.record.version,
        reason: "供应商开始准备第一版 GPU 运行环境。",
      }),
      store.startProvisioning(order.id, secondContext, {
        expectedVersion: paid.record.version,
        reason: "冲突负载不得被当成同一命令重放。",
      }),
    ]);
    assert.equal([first, second].filter((result) => result.status === "fulfilled").length, 1);
    const rejected = [first, second].find((result) => result.status === "rejected");
    assert.ok(rejected && rejected.reason instanceof ExchangeIdempotencyConflictError);
    assert.equal(db.prepare("SELECT status FROM exchange_delivery_tasks WHERE order_id = ?").get(order.id).status, "PROVISIONING");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'PROVISIONING_STARTED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'START_PROVISIONING'").get().count, 1);
  } finally {
    db.close();
  }
});

test("M6-A2 D1 startProvisioning inner 0-row rolls back MODEL event, receipt and order version", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  const scope = "a2-guard-start-model";
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  try {
    const { lot, listing } = await publishedModelListing(store, supplier, scope, 2);
    let order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
      listingVersionId: listing.id, rateUnits: 2, startAt: lot.startAt,
      endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
      interruptibility: "NON_INTERRUPTIBLE",
    }))).record;
    order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
      action: "CONFIRM", expectedVersion: order.version, reason: "确认模型服务容量。",
    }))).record;
    order = (await store.applyPaymentEvent(
      context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
      capturedTestEvent(order, scope),
    )).record;
    const before = db.prepare(`SELECT o.version AS order_version, dt.status AS delivery_status, dt.version AS delivery_version
      FROM exchange_orders o JOIN exchange_delivery_tasks dt ON dt.order_id = o.id WHERE o.id = ?`).get(order.id);
    const write = context(supplier, `${scope}-start`, `${scope}-start-payload`);
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(
      store.startProvisioning(order.id, write, { expectedVersion: order.version, reason: "准备模型服务端点。" }),
      /integer overflow/u,
    );
    assert.deepEqual(db.prepare(`SELECT o.version AS order_version, dt.status AS delivery_status, dt.version AS delivery_version
      FROM exchange_orders o JOIN exchange_delivery_tasks dt ON dt.order_id = o.id WHERE o.id = ?`).get(order.id), before);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'PROVISIONING_STARTED'")
      .get(order.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'START_PROVISIONING'")
      .get(order.id).count, 0);
    const succeeded = await store.startProvisioning(order.id, write, { expectedVersion: order.version, reason: "准备模型服务端点。" });
    assert.equal(succeeded.replayed, false);
    assert.equal(succeeded.record.delivery.status, "PROVISIONING");
  } finally {
    db.close();
  }
});

test("delivery package parser accepts only a redacted public profile and no supplier secret", () => {
  const valid = {
    expectedVersion: 2,
    publicProfile: {
      protocol: "SSH",
      endpointDisplay: "gpu-***.example.test",
      port: 22,
      usernameHint: "kai-test-user",
      expiresAt: iso(60 * 60 * 1_000),
      instructionsSummary: "使用平台领取的一次性测试码执行连接检查。",
    },
    evidenceDigest: TEST_SHA256,
  };
  assert.equal(parseSubmitDeliveryPackage(valid).publicProfile.endpointDisplay, "gpu-***.example.test");
  assert.throws(
    () => parseSubmitDeliveryPackage({ ...valid, password: "must-not-be-accepted" }),
    /password 不是支持字段/u,
  );
  assert.throws(
    () => parseSubmitDeliveryPackage({ ...valid, evidenceDigest: "password=SUPPLIER-SECRET-123456" }),
    /evidenceDigest/u,
  );
  assert.throws(
    () => parseSubmitDeliveryPackage({
      ...valid,
      publicProfile: { ...valid.publicProfile, endpointDisplay: "gpu01.example.test" },
    }),
    /脱敏展示值/u,
  );
  assert.throws(
    () => parseSubmitDeliveryPackage({
      ...valid,
      publicProfile: { ...valid.publicProfile, instructionsSummary: "password=do-not-store-this-value" },
    }),
    /不能包含密码/u,
  );
  assert.throws(
    () => parseTestDeliveryConnection({ expectedVersion: 1, passed: true }),
    /passed 不是支持字段/u,
  );
});

test("SQLite delivery package closes submit, review, one-time claim, and readiness without starting service", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-delivery-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const { supplier, buyer, order } = await startedDeliveryOrder(store, "delivery-sqlite");
  assert.equal(order.status, "FULFILLING");
  assert.equal(order.delivery.status, "PROVISIONING");
  assert.deepEqual(order.allowedActions, ["SUBMIT_DELIVERY_PACKAGE"]);

  const submitContext = context(supplier, "delivery-package-submit", "delivery-package-submit-payload");
  const submitted = await store.submitDeliveryPackage(order.delivery.id, submitContext, deliveryPackageInput(order));
  assert.equal(submitted.record.status, "SUBMITTED");
  assert.equal(submitted.record.environment, "TEST");
  assert.equal(submitted.record.publicProfile.credentialKind, "ONE_TIME_TEST_CODE");
  assert.equal(submitted.record.publicProfile.region, "北京");
  assert.equal((await store.submitDeliveryPackage(order.delivery.id, submitContext, deliveryPackageInput(order))).replayed, true);
  const verifying = await store.getOrder(supplier, order.id, "supplier");
  assert.equal(verifying.delivery.status, "VERIFYING");
  assert.equal(verifying.delivery.package.id, submitted.record.id);
  assert.deepEqual(verifying.allowedActions, []);

  const opsPackages = await store.listOpsDeliveryPackages();
  assert.equal(opsPackages[0].id, submitted.record.id);
  assert.deepEqual(opsPackages[0].allowedActions, ["REVIEW_DELIVERY_PACKAGE"]);
  const reviewed = await store.reviewDeliveryPackage(
    submitted.record.id,
    context("delivery-ops", "delivery-package-review", "delivery-package-review-payload"),
    parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version,
      decision: "PASS",
      verificationMethod: "SIMULATED_TEST",
      reason: "脱敏连接档案结构完整，测试适配器可执行后续检查。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(reviewed.record.status, "VERIFIED");
  assert.equal(reviewed.record.review.decision, "PASS");

  const ready = await store.getOrder(buyer, order.id, "buyer");
  assert.equal(ready.delivery.status, "DELIVERED");
  assert.equal(ready.delivery.package.status, "VERIFIED");
  assert.deepEqual(ready.allowedActions, ["CLAIM_DELIVERY_PACKAGE"]);
  const claimContext = context(buyer, "delivery-package-claim", "delivery-package-claim-payload");
  const claimed = await store.claimDeliveryPackage(
    submitted.record.id,
    claimContext,
    parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version }),
  );
  assert.match(claimed.record.testCode, /^KAI-TEST-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/u);
  assert.equal(claimed.record.package.status, "CLAIMED");
  assert.deepEqual(claimed.record.package.allowedActions, ["TEST_CONNECTION"]);
  await assert.rejects(
    store.claimDeliveryPackage(
      submitted.record.id,
      claimContext,
      parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version }),
    ),
    (error) => error instanceof ExchangeDomainError
      && error.code === "EXCHANGE_DELIVERY_ALREADY_CLAIMED"
      && error.status === 410,
  );
  await assert.rejects(
    store.claimDeliveryPackage(
      submitted.record.id,
      context(buyer, "delivery-package-claim-new-key", "delivery-package-claim-new-payload"),
      parseClaimDeliveryPackage({ expectedVersion: claimed.record.package.version }),
    ),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_DELIVERY_ALREADY_CLAIMED",
  );

  const checkContext = context(buyer, "delivery-connection-test", "delivery-connection-test-payload");
  const checked = await store.testDeliveryConnection(
    submitted.record.id,
    checkContext,
    parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version }),
  );
  assert.equal(checked.record.adapter, "SIMULATED_TEST");
  assert.equal(checked.record.status, "PASSED");
  assert.match(checked.record.summary, /不代表开始计费、服务完成或最终验收/u);
  assert.equal((await store.testDeliveryConnection(
    submitted.record.id,
    checkContext,
    parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version }),
  )).replayed, true);

  const afterReadiness = await store.getOrder(buyer, order.id, "buyer");
  assert.equal(afterReadiness.status, "FULFILLING");
  assert.equal(afterReadiness.userPhase, "开通中");
  assert.equal(afterReadiness.delivery.status, "DELIVERED");
  assert.equal(afterReadiness.delivery.package.latestConnectionCheck.status, "PASSED");
  assert.equal(afterReadiness.reservation.state, "COMMITTED");
  assert.deepEqual(afterReadiness.allowedActions, []);

  const auditDb = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const claimRow = auditDb.prepare("SELECT claim_code_digest FROM exchange_delivery_claims WHERE package_id = ?")
      .get(submitted.record.id);
    assert.match(claimRow.claim_code_digest, /^sha256:[0-9a-f]{64}$/u);
    assert.notEqual(claimRow.claim_code_digest, claimed.record.testCode);
    const receiptText = auditDb.prepare("SELECT group_concat(response_json, '') AS value FROM exchange_command_receipts").get().value;
    const eventText = auditDb.prepare("SELECT group_concat(payload_json, '') AS value FROM exchange_domain_events").get().value;
    assert.equal(String(receiptText).includes(claimed.record.testCode), false);
    assert.equal(String(eventText).includes(claimed.record.testCode), false);
    assert.equal(auditDb.prepare("SELECT status FROM exchange_delivery_tasks WHERE id = ?").get(order.delivery.id).status, "DELIVERED");
    assert.equal(auditDb.prepare("SELECT state FROM exchange_reservations WHERE order_id = ?").get(order.id).state, "COMMITTED");
    assert.equal(auditDb.prepare("SELECT phase FROM exchange_order_lifecycle WHERE order_id = ?").get(order.id).phase, "FULFILLING");
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'DELIVERY_READINESS'").get().count, 1);
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE to_bucket = 'IN_SERVICE'").get().count, 0);
  } finally {
    auditDb.close();
  }
});

test("D1 delivery package is idempotent and one-time claim has one winner", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { supplier, buyer, order } = await startedDeliveryOrder(store, "delivery-d1");
    const submitWrite = context(supplier, "delivery-d1-submit", "delivery-d1-submit-payload");
    const submissions = await Promise.all([
      store.submitDeliveryPackage(order.delivery.id, submitWrite, deliveryPackageInput(order)),
      store.submitDeliveryPackage(order.delivery.id, submitWrite, deliveryPackageInput(order)),
    ]);
    assert.equal(submissions.filter((result) => result.replayed).length, 1);
    const deliveryPackage = submissions[0].record;
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_packages").get().count, 1);
    assert.equal(db.prepare("SELECT status FROM exchange_delivery_tasks WHERE id = ?").get(order.delivery.id).status, "VERIFYING");

    const reviewed = await store.reviewDeliveryPackage(
      deliveryPackage.id,
      context("delivery-d1-ops", "delivery-d1-review", "delivery-d1-review-payload"),
      parseReviewDeliveryPackage({
        expectedVersion: deliveryPackage.version,
        decision: "PASS",
        verificationMethod: "SIMULATED_TEST",
        reason: "脱敏连接档案结构完整，允许买方领取一次性测试码。",
        evidenceDigest: TEST_SHA256,
      }),
    );
    assert.equal(reviewed.record.status, "VERIFIED");
    const ready = await store.getOrder(buyer, order.id, "buyer");
    const claimWrite = context(buyer, "delivery-d1-claim", "delivery-d1-claim-payload");
    const claimInput = parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version });
    const claims = await Promise.allSettled([
      store.claimDeliveryPackage(deliveryPackage.id, claimWrite, claimInput),
      store.claimDeliveryPackage(deliveryPackage.id, claimWrite, claimInput),
    ]);
    const successfulClaim = claims.find((result) => result.status === "fulfilled");
    const rejectedClaim = claims.find((result) => result.status === "rejected");
    assert.ok(successfulClaim && rejectedClaim);
    assert.match(successfulClaim.value.record.testCode, /^KAI-TEST-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/u);
    assert.ok(rejectedClaim.reason instanceof ExchangeDomainError);
    assert.equal(rejectedClaim.reason.code, "EXCHANGE_DELIVERY_ALREADY_CLAIMED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_claims").get().count, 1);
    assert.match(db.prepare("SELECT claim_code_digest FROM exchange_delivery_claims").get().claim_code_digest, /^sha256:[0-9a-f]{64}$/u);

    const claimedOrder = await store.getOrder(buyer, order.id, "buyer");
    const checkWrite = context(buyer, "delivery-d1-check", "delivery-d1-check-payload");
    const checkInput = parseTestDeliveryConnection({ expectedVersion: claimedOrder.delivery.package.version });
    const checks = await Promise.all([
      store.testDeliveryConnection(deliveryPackage.id, checkWrite, checkInput),
      store.testDeliveryConnection(deliveryPackage.id, checkWrite, checkInput),
    ]);
    assert.equal(checks.filter((result) => result.replayed).length, 1);
    assert.equal(checks[0].record.status, "PASSED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_connection_checks").get().count, 1);
    assert.equal(db.prepare("SELECT phase FROM exchange_order_lifecycle WHERE order_id = ?").get(order.id).phase, "FULFILLING");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE to_bucket = 'IN_SERVICE'").get().count, 0);
    const allStoredText = [
      db.prepare("SELECT group_concat(response_json, '') AS value FROM exchange_command_receipts").get().value,
      db.prepare("SELECT group_concat(payload_json, '') AS value FROM exchange_domain_events").get().value,
    ].join("");
    assert.equal(allStoredText.includes(successfulClaim.value.record.testCode), false);
  } finally {
    db.close();
  }
});

test("D1 competing delivery commands return domain conflicts without partial receipts", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  try {
    const { supplier, buyer, order } = await startedDeliveryOrder(store, "delivery-d1-competition");
    const submitWrites = [
      context(supplier, "delivery-competition-submit-a", "delivery-competition-submit-payload-a"),
      context(supplier, "delivery-competition-submit-b", "delivery-competition-submit-payload-b"),
    ];
    const submissions = await Promise.allSettled(submitWrites.map((write) =>
      store.submitDeliveryPackage(order.delivery.id, write, deliveryPackageInput(order))));
    assert.equal(submissions.filter((result) => result.status === "fulfilled").length, 1);
    const rejectedSubmit = submissions.find((result) => result.status === "rejected");
    assert.ok(rejectedSubmit?.reason instanceof ExchangeDomainError);
    assert.equal(rejectedSubmit.reason.status, 409);
    const deliveryPackage = submissions.find((result) => result.status === "fulfilled").value.record;

    const reviewInput = parseReviewDeliveryPackage({
      expectedVersion: deliveryPackage.version,
      decision: "PASS",
      verificationMethod: "SIMULATED_TEST",
      reason: "并发核验只能产生一条通过结论，失败方必须得到领域冲突。",
      evidenceDigest: TEST_SHA256,
    });
    const reviewWrites = [
      context("delivery-competition-ops-a", "delivery-competition-review-a", "delivery-competition-review-payload-a"),
      context("delivery-competition-ops-b", "delivery-competition-review-b", "delivery-competition-review-payload-b"),
    ];
    const reviews = await Promise.allSettled(reviewWrites.map((write) =>
      store.reviewDeliveryPackage(deliveryPackage.id, write, reviewInput)));
    assert.equal(reviews.filter((result) => result.status === "fulfilled").length, 1);
    const rejectedReview = reviews.find((result) => result.status === "rejected");
    assert.ok(rejectedReview?.reason instanceof ExchangeDomainError);
    assert.equal(rejectedReview.reason.status, 409);

    const ready = await store.getOrder(buyer, order.id, "buyer");
    const claimInput = parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version });
    const claimWrites = [
      context(buyer, "delivery-competition-claim-a", "delivery-competition-claim-payload-a"),
      context(buyer, "delivery-competition-claim-b", "delivery-competition-claim-payload-b"),
    ];
    const claims = await Promise.allSettled(claimWrites.map((write) =>
      store.claimDeliveryPackage(deliveryPackage.id, write, claimInput)));
    assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
    const rejectedClaim = claims.find((result) => result.status === "rejected");
    assert.ok(rejectedClaim?.reason instanceof ExchangeDomainError);
    assert.equal(rejectedClaim.reason.code, "EXCHANGE_DELIVERY_ALREADY_CLAIMED");

    const claimed = await store.getOrder(buyer, order.id, "buyer");
    const checkInput = parseTestDeliveryConnection({ expectedVersion: claimed.delivery.package.version });
    const checkWrites = [
      context(buyer, "delivery-competition-check-a", "delivery-competition-check-payload-a"),
      context(buyer, "delivery-competition-check-b", "delivery-competition-check-payload-b"),
    ];
    const checks = await Promise.allSettled(checkWrites.map((write) =>
      store.testDeliveryConnection(deliveryPackage.id, write, checkInput)));
    assert.equal(checks.filter((result) => result.status === "fulfilled").length, 1);
    const rejectedCheck = checks.find((result) => result.status === "rejected");
    assert.ok(rejectedCheck?.reason instanceof ExchangeDomainError);
    assert.equal(rejectedCheck.reason.status, 409);
    const winningCheckIndex = checks.findIndex((result) => result.status === "fulfilled");
    assert.equal((await store.testDeliveryConnection(deliveryPackage.id, checkWrites[winningCheckIndex], checkInput)).replayed, true);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_packages").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_reviews").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_claims").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_connection_checks").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'SUBMIT_DELIVERY_PACKAGE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'REVIEW_DELIVERY_PACKAGE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'CLAIM_DELIVERY_PACKAGE'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'TEST_DELIVERY_CONNECTION'").get().count, 1);
  } finally {
    db.close();
  }
});

test("D1 expires submitted, verified, and claimed packages before allowing a new revision", async () => {
  for (const stage of ["SUBMITTED", "VERIFIED", "CLAIMED"]) {
    const { db, adapter } = d1BackedBySqlite();
    const store = createD1ExchangeStore(adapter);
    try {
      const scope = `delivery-d1-expiry-${stage.toLowerCase()}`;
      const { supplier, buyer, order } = await startedDeliveryOrder(store, scope);
      const submitted = await store.submitDeliveryPackage(
        order.delivery.id,
        context(supplier, `${scope}-submit`, `${scope}-submit-payload`),
        deliveryPackageInput(order),
      );
      if (stage === "VERIFIED" || stage === "CLAIMED") {
        await store.reviewDeliveryPackage(
          submitted.record.id,
          context(`${scope}-ops`, `${scope}-review`, `${scope}-review-payload`),
          parseReviewDeliveryPackage({
            expectedVersion: submitted.record.version,
            decision: "PASS",
            verificationMethod: "SIMULATED_TEST",
            reason: "到期迁移测试先建立通过核验的交付包状态。",
            evidenceDigest: TEST_SHA256,
          }),
        );
      }
      if (stage === "CLAIMED") {
        const ready = await store.getOrder(buyer, order.id, "buyer");
        await store.claimDeliveryPackage(
          submitted.record.id,
          context(buyer, `${scope}-claim`, `${scope}-claim-payload`),
          parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version }),
        );
      }
      db.prepare("UPDATE exchange_delivery_packages SET credential_expires_at = ? WHERE id = ?")
        .run(iso(-1_000), submitted.record.id);

      const expired = await store.getOrder(supplier, order.id, "supplier");
      assert.equal(expired.delivery.package.status, "EXPIRED", stage);
      assert.equal(expired.delivery.status, "PROVISIONING", stage);
      assert.deepEqual(expired.allowedActions, ["SUBMIT_DELIVERY_PACKAGE"], stage);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_delivery_packages
        WHERE delivery_task_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')`).get(order.delivery.id).count, 0, stage);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'DELIVERY_PACKAGE_EXPIRED'").get().count, 1, stage);

      const replacement = await store.submitDeliveryPackage(
        order.delivery.id,
        context(supplier, `${scope}-resubmit`, `${scope}-resubmit-payload`),
        { ...deliveryPackageInput(order), expectedVersion: expired.delivery.version },
      );
      assert.equal(replacement.record.revision, 2, stage);
      assert.equal(replacement.record.status, "SUBMITTED", stage);
    } finally {
      db.close();
    }
  }
});

async function deliveredOrder(store, scope) {
  const started = await startedDeliveryOrder(store, scope);
  const expiresAt = new Date(Date.parse(started.order.endAt) + 60 * 60 * 1_000).toISOString();
  const submitted = await store.submitDeliveryPackage(
    started.order.delivery.id,
    context(started.supplier, `${scope}-m5-submit`, `${scope}-m5-submit-payload`),
    deliveryPackageInput(started.order, expiresAt),
  );
  await store.reviewDeliveryPackage(
    submitted.record.id,
    context(`${scope}-m5-ops`, `${scope}-m5-review`, `${scope}-m5-review-payload`),
    parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version,
      decision: "PASS",
      verificationMethod: "SIMULATED_TEST",
      reason: "测试交付包事实完整，允许进入固定服务窗测试计量。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  const ready = await store.getOrder(started.buyer, started.order.id, "buyer");
  const claimed = await store.claimDeliveryPackage(
    submitted.record.id,
    context(started.buyer, `${scope}-m5-claim`, `${scope}-m5-claim-payload`),
    parseClaimDeliveryPackage({ expectedVersion: ready.delivery.package.version }),
  );
  await store.testDeliveryConnection(
    submitted.record.id,
    context(started.buyer, `${scope}-m5-connection`, `${scope}-m5-connection-payload`),
    parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version }),
  );
  return {
    ...started,
    order: await store.getOrder(started.buyer, started.order.id, "buyer"),
  };
}

test("M6-A2 SQLite MODEL completes M0-M5 with canonical metering, evidence and balanced TEST settlement", async () => {
  let serverNowMs = Date.now();
  const databasePath = join(tmpdir(), `kai-cloud-m6-a2-model-close-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
  const scope = "m6-a2-model-close";
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  const { lot, listing } = await publishedModelListing(store, supplier, scope, 4);
  let order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
    listingVersionId: listing.id,
    rateUnits: 4,
    startAt: lot.startAt,
    endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
    interruptibility: "NON_INTERRUPTIBLE",
  }))).record;
  order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
    action: "CONFIRM", expectedVersion: order.version, reason: "确认服务容量和交付排期。",
  }))).record;
  order = (await store.applyPaymentEvent(
    context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
    capturedTestEvent(order, scope),
  )).record;
  order = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
    expectedVersion: order.version, reason: "开始准备托管服务端点。",
  })).record;
  const expiresAt = new Date(Date.parse(order.endAt) + 60 * 60 * 1_000).toISOString();
  const submitted = await store.submitDeliveryPackage(order.delivery.id, context(supplier, `${scope}-submit`), parseSubmitDeliveryPackage({
    expectedVersion: order.delivery.version,
    publicProfile: {
      protocol: "HTTPS", endpointDisplay: "model-***.example.test", port: 443,
      usernameHint: "kai-service-user", expiresAt,
      instructionsSummary: "领取一次性测试码后，使用平台连接检查验证服务端点。",
    },
    evidenceDigest: TEST_SHA256,
  }));
  await store.reviewDeliveryPackage(submitted.record.id, context(`${scope}-ops`, `${scope}-review`), parseReviewDeliveryPackage({
    expectedVersion: submitted.record.version, decision: "PASS", verificationMethod: "SIMULATED_TEST",
    reason: "服务端点事实完整，允许进入固定服务窗计量。", evidenceDigest: TEST_SHA256,
  }));
  order = await store.getOrder(buyer, order.id, "buyer");
  const claimed = await store.claimDeliveryPackage(submitted.record.id, context(buyer, `${scope}-claim`), parseClaimDeliveryPackage({
    expectedVersion: order.delivery.package.version,
  }));
  await store.testDeliveryConnection(submitted.record.id, context(buyer, `${scope}-connection`), parseTestDeliveryConnection({
    expectedVersion: claimed.record.package.version,
  }));
  order = await store.getOrder(buyer, order.id, "buyer");
  serverNowMs = Date.parse(order.startAt);
  const started = await store.testStartService(order.id, context(`${scope}-ops`, `${scope}-service-start`), parseTestServiceStart({
    expectedVersion: order.metering.version,
  }));
  serverNowMs = Date.parse(order.endAt) + 1_000;
  const completed = await store.testCompleteMetering(order.id, context(`${scope}-ops`, `${scope}-meter-final`), parseTestMeterComplete({
    expectedVersion: started.record.metering.version,
  }));
  assert.equal(completed.record.metering.scheduledCapacityBaseUnits, 14_400);
  assert.equal(completed.record.metering.availableCapacityBaseUnits, 14_400);
  assert.ok(!Object.hasOwn(completed.record.metering, "scheduledGpuSeconds"));
  const accepted = await store.submitAcceptance(order.id, context(buyer, `${scope}-accept`), parseSubmitOrderAcceptance({
    expectedVersion: completed.record.acceptance.version, decision: "ACCEPT",
    reason: "服务时间窗和计量证据已核对。", evidenceDigest: TEST_SHA256,
  }));
  const settled = await store.testRecordSettlement(accepted.record.settlement.id, context(`${scope}-ops`, `${scope}-settle`), parseTestRecordSettlement({
    expectedVersion: accepted.record.settlement.version,
  }));
  assert.equal(settled.record.status, "TEST_RECORDED");
  assert.equal(settled.record.fundsMoved, false);

  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_meter_intervals WHERE order_id = ?").get(order.id).count, 1);
    const evidenceTypes = db.prepare(`SELECT me.evidence_type FROM exchange_meter_evidence me
      JOIN exchange_meter_intervals mi ON mi.id = me.meter_interval_id
      WHERE mi.order_id = ? ORDER BY me.evidence_type`).all(order.id).map((row) => row.evidence_type);
    assert.deepEqual(evidenceTypes, ["INSTANCE_HEARTBEAT", "MODEL_IDENTITY"]);
    const ledger = db.prepare(`SELECT
      SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END) AS debits,
      SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END) AS credits
      FROM exchange_ledger_entries WHERE settlement_id = ?`).get(settled.record.id);
    assert.equal(ledger.debits, ledger.credits);
    for (const table of ["exchange_domain_events", "exchange_command_receipts"]) {
      const column = table === "exchange_domain_events" ? "payload_json" : "response_json";
      for (const row of db.prepare(`SELECT ${column} AS payload FROM ${table}`).all()) {
        assertModelPayloadClean(JSON.parse(row.payload), `${table}`);
      }
    }
  } finally {
    db.close();
  }
  assertModelPayloadClean(completed.record);
});

test("M6-A2 D1 MODEL completes M0-M5 with atomic snapshot, canonical evidence and balanced settlement", async () => {
  let serverNowMs = Date.now();
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
  const scope = "m6-a2-d1-model-close";
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  try {
    const { lot, listing } = await publishedModelListing(store, supplier, scope, 4);
    let order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
      listingVersionId: listing.id,
      rateUnits: 4,
      startAt: lot.startAt,
      endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
      interruptibility: "NON_INTERRUPTIBLE",
    }))).record;
    assert.equal(order.productCode, "MODEL_INSTANCE");
    assert.equal(order.capacityBaseUnits, 14_400);
    assert.equal(order.totalAmountCents, 11);
    assertModelPayloadClean(order);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_order_contract_snapshots WHERE order_id = ?")
      .get(order.id).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_order_lifecycle WHERE order_id = ? AND phase = 'AWAITING_SUPPLIER'")
      .get(order.id).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'CREATE_CHECKOUT'")
      .get(order.id).count, 1);

    order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
      action: "CONFIRM", expectedVersion: order.version, reason: "确认服务容量和交付排期。",
    }))).record;
    order = (await store.applyPaymentEvent(
      context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
      capturedTestEvent(order, scope),
    )).record;
    order = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
      expectedVersion: order.version, reason: "开始准备托管服务端点。",
    })).record;
    const expiresAt = new Date(Date.parse(order.endAt) + 60 * 60 * 1_000).toISOString();
    const submitted = await store.submitDeliveryPackage(order.delivery.id, context(supplier, `${scope}-submit`), parseSubmitDeliveryPackage({
      expectedVersion: order.delivery.version,
      publicProfile: {
        protocol: "HTTPS", endpointDisplay: "model-***.example.test", port: 443,
        usernameHint: "kai-service-user", expiresAt,
        instructionsSummary: "领取一次性测试码后，使用平台连接检查验证服务端点。",
      },
      evidenceDigest: TEST_SHA256,
    }));
    await store.reviewDeliveryPackage(submitted.record.id, context(`${scope}-ops`, `${scope}-review`), parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version, decision: "PASS", verificationMethod: "SIMULATED_TEST",
      reason: "服务端点事实完整，允许进入固定服务窗计量。", evidenceDigest: TEST_SHA256,
    }));
    order = await store.getOrder(buyer, order.id, "buyer");
    const claimed = await store.claimDeliveryPackage(submitted.record.id, context(buyer, `${scope}-claim`), parseClaimDeliveryPackage({
      expectedVersion: order.delivery.package.version,
    }));
    await store.testDeliveryConnection(submitted.record.id, context(buyer, `${scope}-connection`), parseTestDeliveryConnection({
      expectedVersion: claimed.record.package.version,
    }));
    order = await store.getOrder(buyer, order.id, "buyer");
    serverNowMs = Date.parse(order.startAt);
    const started = await store.testStartService(order.id, context(`${scope}-ops`, `${scope}-service-start`), parseTestServiceStart({
      expectedVersion: order.metering.version,
    }));
    serverNowMs = Date.parse(order.endAt) + 1_000;
    const completed = await store.testCompleteMetering(order.id, context(`${scope}-ops`, `${scope}-meter-final`), parseTestMeterComplete({
      expectedVersion: started.record.metering.version,
    }));
    assert.equal(completed.record.metering.scheduledCapacityBaseUnits, 14_400);
    assert.equal(completed.record.metering.availableCapacityBaseUnits, 14_400);
    assertModelPayloadClean(completed.record);
    const accepted = await store.submitAcceptance(order.id, context(buyer, `${scope}-accept`), parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version, decision: "ACCEPT",
      reason: "服务时间窗和计量证据已核对。", evidenceDigest: TEST_SHA256,
    }));
    const settled = await store.testRecordSettlement(accepted.record.settlement.id, context(`${scope}-ops`, `${scope}-settle`), parseTestRecordSettlement({
      expectedVersion: accepted.record.settlement.version,
    }));
    assert.equal(settled.record.status, "TEST_RECORDED");
    assert.equal(settled.record.fundsMoved, false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_meter_intervals WHERE order_id = ?").get(order.id).count, 1);
    const evidenceTypes = db.prepare(`SELECT me.evidence_type FROM exchange_meter_evidence me
      JOIN exchange_meter_intervals mi ON mi.id = me.meter_interval_id
      WHERE mi.order_id = ? ORDER BY me.evidence_type`).all(order.id).map((row) => row.evidence_type);
    assert.deepEqual(evidenceTypes, ["INSTANCE_HEARTBEAT", "MODEL_IDENTITY"]);
    const ledger = db.prepare(`SELECT
      SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END) AS debits,
      SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END) AS credits
      FROM exchange_ledger_entries WHERE settlement_id = ?`).get(settled.record.id);
    assert.equal(ledger.debits, ledger.credits);
    for (const table of ["exchange_domain_events", "exchange_command_receipts"]) {
      const column = table === "exchange_domain_events" ? "payload_json" : "response_json";
      for (const row of db.prepare(`SELECT ${column} AS payload FROM ${table}`).all()) {
        assertModelPayloadClean(JSON.parse(row.payload), `${table}`);
      }
    }
  } finally {
    db.close();
  }
});

test("M6-A2 D1 active guard matrix rolls back delivery, readiness, acceptance and ledger inner 0-row faults", async () => {
  let serverNowMs = Date.now();
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
  const scope = "a2-guard-matrix";
  const supplier = `${scope}-supplier`;
  const buyer = `${scope}-buyer`;
  try {
    const { lot, listing } = await publishedModelListing(store, supplier, scope, 2);
    let order = (await store.createCheckout(context(buyer, `${scope}-checkout`), parseCreateCheckout({
      listingVersionId: listing.id, rateUnits: 2, startAt: lot.startAt,
      endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
      interruptibility: "NON_INTERRUPTIBLE",
    }))).record;
    order = (await store.confirmOrder(order.id, context(supplier, `${scope}-confirm`), parseSupplierConfirmation({
      action: "CONFIRM", expectedVersion: order.version, reason: "确认模型实例容量。",
    }))).record;
    order = (await store.applyPaymentEvent(
      context(`${scope}-adapter`, `${scope}-payment`, `${scope}-payment-payload`),
      capturedTestEvent(order, scope),
    )).record;
    order = (await store.startProvisioning(order.id, context(supplier, `${scope}-start`), {
      expectedVersion: order.version, reason: "准备模型服务端点。",
    })).record;

    const expiresAt = new Date(Date.parse(order.endAt) + 60 * 60 * 1_000).toISOString();
    const submitWrite = context(supplier, `${scope}-submit`, `${scope}-submit-payload`);
    const submitInput = parseSubmitDeliveryPackage({
      expectedVersion: order.delivery.version,
      publicProfile: {
        protocol: "HTTPS", endpointDisplay: "model-***.example.test", port: 443,
        usernameHint: "kai-service-user", expiresAt,
        instructionsSummary: "领取一次性测试码后执行连接检查。",
      },
      evidenceDigest: TEST_SHA256,
    });
    const beforeSubmit = db.prepare("SELECT status, version FROM exchange_delivery_tasks WHERE id = ?").get(order.delivery.id);
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.submitDeliveryPackage(order.delivery.id, submitWrite, submitInput), /integer overflow/u);
    assert.deepEqual(db.prepare("SELECT status, version FROM exchange_delivery_tasks WHERE id = ?").get(order.delivery.id), beforeSubmit);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_packages WHERE order_id = ?").get(order.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE event_type = 'DELIVERY_PACKAGE_SUBMITTED' AND entity_id IN (SELECT id FROM exchange_delivery_packages WHERE order_id = ?)").get(order.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'SUBMIT_DELIVERY_PACKAGE' AND entity_id = ?").get(order.delivery.id).count, 0);
    const submitted = await store.submitDeliveryPackage(order.delivery.id, submitWrite, submitInput);

    const reviewWrite = context(`${scope}-ops`, `${scope}-review`, `${scope}-review-payload`);
    const reviewInput = parseReviewDeliveryPackage({
      expectedVersion: submitted.record.version, decision: "PASS", verificationMethod: "SIMULATED_TEST",
      reason: "模型服务端点事实完整。", evidenceDigest: TEST_SHA256,
    });
    const beforeReview = db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id);
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.reviewDeliveryPackage(submitted.record.id, reviewWrite, reviewInput), /integer overflow/u);
    assert.deepEqual(db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id), beforeReview);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_reviews WHERE package_id = ?").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'DELIVERY_PACKAGE_VERIFIED'").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'REVIEW_DELIVERY_PACKAGE'").get(submitted.record.id).count, 0);
    await store.reviewDeliveryPackage(submitted.record.id, reviewWrite, reviewInput);

    order = await store.getOrder(buyer, order.id, "buyer");
    const claimWrite = context(buyer, `${scope}-claim`, `${scope}-claim-payload`);
    const claimInput = parseClaimDeliveryPackage({ expectedVersion: order.delivery.package.version });
    const beforeClaim = db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id);
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.claimDeliveryPackage(submitted.record.id, claimWrite, claimInput), /integer overflow/u);
    assert.deepEqual(db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?").get(submitted.record.id), beforeClaim);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_delivery_claims WHERE package_id = ?").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'DELIVERY_PACKAGE_CLAIMED'").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'CLAIM_DELIVERY_PACKAGE'").get(submitted.record.id).count, 0);
    const claimed = await store.claimDeliveryPackage(submitted.record.id, claimWrite, claimInput);

    const connectionWrite = context(buyer, `${scope}-connection`, `${scope}-connection-payload`);
    const connectionInput = parseTestDeliveryConnection({ expectedVersion: claimed.record.package.version });
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.testDeliveryConnection(submitted.record.id, connectionWrite, connectionInput), /integer overflow/u);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_connection_checks WHERE package_id = ?").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'DELIVERY_READINESS'").get(submitted.record.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'TEST_DELIVERY_CONNECTION'").get(submitted.record.id).count, 0);
    await store.testDeliveryConnection(submitted.record.id, connectionWrite, connectionInput);

    order = await store.getOrder(buyer, order.id, "buyer");
    serverNowMs = Date.parse(order.startAt);
    const started = await store.testStartService(order.id, context(`${scope}-ops`, `${scope}-service-start`), parseTestServiceStart({
      expectedVersion: order.metering.version,
    }));
    serverNowMs = Date.parse(order.endAt) + 1_000;
    const completed = await store.testCompleteMetering(order.id, context(`${scope}-ops`, `${scope}-meter-final`), parseTestMeterComplete({
      expectedVersion: started.record.metering.version,
    }));

    const acceptWrite = context(buyer, `${scope}-accept`, `${scope}-accept-payload`);
    const acceptInput = parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version, decision: "ACCEPT",
      reason: "模型服务履约事实已核对。", evidenceDigest: TEST_SHA256,
    });
    const beforeAcceptance = db.prepare("SELECT status, version FROM exchange_acceptances WHERE order_id = ?").get(order.id);
    adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.submitAcceptance(order.id, acceptWrite, acceptInput), /integer overflow/u);
    assert.deepEqual(db.prepare("SELECT status, version FROM exchange_acceptances WHERE order_id = ?").get(order.id), beforeAcceptance);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'BUYER_ACCEPTED'").get(order.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'SUBMIT_ACCEPTANCE'").get(order.id).count, 0);
    const accepted = await store.submitAcceptance(order.id, acceptWrite, acceptInput);

    const settleWrite = context(`${scope}-ops`, `${scope}-settle`, `${scope}-settle-payload`);
    const settleInput = parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version });
    const beforeSettlement = db.prepare("SELECT status, version, ledger_batch_id FROM exchange_settlements WHERE id = ?")
      .get(accepted.record.settlement.id);
    adapter.zeroNextBatchStatement(3);
    await assert.rejects(store.testRecordSettlement(accepted.record.settlement.id, settleWrite, settleInput), /integer overflow/u);
    assert.deepEqual(db.prepare("SELECT status, version, ledger_batch_id FROM exchange_settlements WHERE id = ?")
      .get(accepted.record.settlement.id), beforeSettlement);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_ledger_batches WHERE settlement_id = ?").get(accepted.record.settlement.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_ledger_entries WHERE settlement_id = ?").get(accepted.record.settlement.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'TEST_SETTLEMENT_RECORDED'").get(accepted.record.settlement.id).count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE entity_id = ? AND command_type = 'TEST_RECORD_SETTLEMENT'").get(accepted.record.settlement.id).count, 0);
    const settled = await store.testRecordSettlement(accepted.record.settlement.id, settleWrite, settleInput);
    assert.equal(settled.record.status, "TEST_RECORDED");
  } finally {
    db.close();
  }
});

test("M6-A2 D1 v2 receipt replay matrix fails closed when the immutable order snapshot is missing", async () => {
  let serverNowMs = Date.now();
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
  const scope = "a2-replay-snapshot";
  try {
    const delivered = await deliveredOrder(store, scope);
    const packageId = delivered.order.delivery.package.id;
    serverNowMs = Date.parse(delivered.order.startAt);
    const startWrite = context(`${scope}-ops`, `${scope}-service-start`, `${scope}-service-start-payload`);
    const startInput = parseTestServiceStart({ expectedVersion: delivered.order.metering.version });
    const started = await store.testStartService(delivered.order.id, startWrite, startInput);
    serverNowMs = Date.parse(delivered.order.endAt) + 1_000;
    const meterWrite = context(`${scope}-ops`, `${scope}-meter-final`, `${scope}-meter-final-payload`);
    const meterInput = parseTestMeterComplete({ expectedVersion: started.record.metering.version });
    const completed = await store.testCompleteMetering(delivered.order.id, meterWrite, meterInput);
    const acceptWrite = context(delivered.buyer, `${scope}-accept`, `${scope}-accept-payload`);
    const acceptInput = parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version, decision: "ACCEPT",
      reason: "模型服务事实已核对。", evidenceDigest: TEST_SHA256,
    });
    const accepted = await store.submitAcceptance(delivered.order.id, acceptWrite, acceptInput);
    const settlementId = accepted.record.settlement.id;
    const settleWrite = context(`${scope}-ops`, `${scope}-settle`, `${scope}-settle-payload`);
    const settleInput = parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version });
    await store.testRecordSettlement(settlementId, settleWrite, settleInput);

    db.exec("DROP TRIGGER exchange_order_contract_snapshots_immutable_delete");
    db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(delivered.order.id);
    const missingSnapshot = /EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING/u;
    const replayCases = [
      () => store.startProvisioning(
        delivered.order.id,
        context(delivered.supplier, `${scope}-start`),
        { expectedVersion: 1, reason: "replay" },
      ),
      () => store.submitDeliveryPackage(
        delivered.order.delivery.id,
        context(delivered.supplier, `${scope}-m5-submit`, `${scope}-m5-submit-payload`),
        deliveryPackageInput(delivered.order, iso(60 * 60 * 1_000)),
      ),
      () => store.reviewDeliveryPackage(
        packageId,
        context(`${scope}-m5-ops`, `${scope}-m5-review`, `${scope}-m5-review-payload`),
        parseReviewDeliveryPackage({
          expectedVersion: 1, decision: "PASS", verificationMethod: "SIMULATED_TEST",
          reason: "replay", evidenceDigest: TEST_SHA256,
        }),
      ),
      () => store.claimDeliveryPackage(
        packageId,
        context(delivered.buyer, `${scope}-m5-claim`, `${scope}-m5-claim-payload`),
        parseClaimDeliveryPackage({ expectedVersion: 1 }),
      ),
      () => store.testDeliveryConnection(
        packageId,
        context(delivered.buyer, `${scope}-m5-connection`, `${scope}-m5-connection-payload`),
        parseTestDeliveryConnection({ expectedVersion: 1 }),
      ),
      () => store.testStartService(delivered.order.id, startWrite, startInput),
      () => store.testCompleteMetering(delivered.order.id, meterWrite, meterInput),
      () => store.submitAcceptance(delivered.order.id, acceptWrite, acceptInput),
      () => store.testRecordSettlement(settlementId, settleWrite, settleInput),
    ];
    for (const replay of replayCases) await assert.rejects(replay, missingSnapshot);
  } finally {
    db.close();
  }
});

test("M6-A2 D1 does not trust a forged START_PROVISIONING receipt for a missing order", async () => {
  const { db, adapter } = d1BackedBySqlite();
  const store = createD1ExchangeStore(adapter);
  const actor = "a2-forged-receipt-supplier";
  const write = context(actor, "a2-forged-receipt", "a2-forged-receipt-payload");
  try {
    await store.listProductVersions();
    db.prepare(`INSERT INTO exchange_command_receipts (
      actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
    ) VALUES (?, ?, ?, 'START_PROVISIONING', 'KAI-ORD-V2-NO-SNAPSHOT', ?, ?)`)
      .run(actor, write.idempotencyKey, write.payloadHash, JSON.stringify({ productCode: "MODEL_INSTANCE", status: "FULFILLING" }), iso(0));
    await assert.rejects(
      store.startProvisioning("KAI-ORD-V2-NO-SNAPSHOT", write, { expectedVersion: 1, reason: "forged replay" }),
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_NOT_FOUND",
    );
  } finally {
    db.close();
  }
});

function appendFailedLatestConnection(db, packageId, scope) {
  const at = new Date().toISOString();
  db.prepare(`INSERT INTO exchange_connection_checks (
    id, package_id, delivery_task_id, order_id, buyer_actor_id, attempt, adapter,
    status, diagnostic_code, summary, evidence_digest, started_at, finished_at, created_at
  ) SELECT ?, package_id, delivery_task_id, order_id, buyer_actor_id, attempt + 1, adapter,
      'FAILED', 'FUTURE_CONNECTOR_FAILED', ?, ?, ?, ?, ?
    FROM exchange_connection_checks WHERE package_id = ?
    ORDER BY attempt DESC LIMIT 1`).run(
    `KAI-CC-${scope}-LATEST-FAILED`,
    "后续连接器复检失败，最新结果必须覆盖更早的通过结果。",
    TEST_SHA256,
    at,
    at,
    at,
    packageId,
  );
}

test("M6 additive facts enforce canonical time, rate, digest, observation and immutability constraints", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m6-integrity-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const { order } = await deliveredOrder(store, "m6-integrity");
  const db = new DatabaseSync(databasePath);
  const upperDigest = `sha256:${"A".repeat(64)}`;
  const payloadDigest = `sha256:${"b".repeat(64)}`;
  try {
    const contract = db.prepare(`SELECT o.listing_version_id, ra.product_version_id,
        pcp.id AS capacity_policy_id, pcp.immutable_hash AS policy_immutable_hash,
        pv.specs_json, lv.sla_json
      FROM exchange_orders o
      JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
      JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
      JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
      JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
      JOIN exchange_product_capacity_policies pcp ON pcp.product_version_id = ra.product_version_id
      WHERE o.id = ?`).get(order.id);
    const snapshotDeleteTrigger = db.prepare(`SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'exchange_order_contract_snapshots_immutable_delete'`).get().sql;
    db.exec("DROP TRIGGER exchange_order_contract_snapshots_immutable_delete");
    db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(order.id);
    db.exec(snapshotDeleteTrigger);
    const durationSeconds = (Date.parse(order.endAt) - Date.parse(order.startAt)) / 1_000;
    const snapshotStatement = db.prepare(`INSERT INTO exchange_order_contract_snapshots (
      id, order_id, listing_version_id, product_version_id, capacity_policy_id,
      product_code, rate_unit_code, fulfillment_model, pricing_unit_code,
      rate_units, duration_seconds, capacity_base_units, unit_price_micros,
      price_basis_base_units, gross_amount_cents, currency, product_identity_json,
      sla_json, evidence_policy_version, snapshot_digest, created_at
    ) VALUES (?, ?, ?, ?, ?, 'GPU_COMPUTE', 'GPU', 'GPU_ALLOCATION', 'GPU_HOUR',
      ?, ?, ?, ?, 3600, ?, 'CNY', ?, ?, ?, ?, ?)`);
    assert.throws(
      () => snapshotStatement.run(
        "KAI-OCS-M6-UPPERCASE", order.id, contract.listing_version_id, contract.product_version_id,
        contract.capacity_policy_id, order.parallelUnits, durationSeconds, order.capacityGpuSeconds,
        order.unitPriceCents * 10_000, order.totalAmountCents, contract.specs_json,
        contract.sla_json, contract.policy_immutable_hash, upperDigest, new Date().toISOString(),
      ),
      /constraint failed/u,
    );
    snapshotStatement.run(
      "KAI-OCS-M6-VALID", order.id, contract.listing_version_id, contract.product_version_id,
      contract.capacity_policy_id, order.parallelUnits, durationSeconds, order.capacityGpuSeconds,
      order.unitPriceCents * 10_000, order.totalAmountCents, contract.specs_json,
      contract.sla_json, contract.policy_immutable_hash, TEST_SHA256, new Date().toISOString(),
    );

    assert.throws(
      () => db.prepare("UPDATE exchange_product_versions SET display_name = display_name || ' changed' WHERE id = ?")
        .run(contract.product_version_id),
      /EXCHANGE_PRODUCT_VERSION_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_product_versions WHERE id = ?").run(contract.product_version_id),
      /EXCHANGE_PRODUCT_VERSION_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("UPDATE exchange_order_contract_snapshots SET gross_amount_cents = gross_amount_cents + 1 WHERE order_id = ?")
        .run(order.id),
      /EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_order_contract_snapshots WHERE order_id = ?").run(order.id),
      /EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE/u,
    );

    const at = (offsetSeconds, milliseconds = 0) => {
      const date = new Date(Date.parse(order.startAt) + offsetSeconds * 1_000 + milliseconds);
      return date.toISOString();
    };
    const intervalStatement = db.prepare(`INSERT INTO exchange_meter_intervals (
      id, metering_session_id, order_id, capacity_policy_id, sequence_number,
      interval_start_at, interval_end_at, duration_seconds, reserved_rate_units,
      proven_rate_units, scheduled_capacity_base_units, available_capacity_base_units,
      unavailable_capacity_base_units, unproven_capacity_base_units, evidence_status,
      adapter, evidence_digest, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TEST', ?, ?)`);
    const insertInterval = ({
      id, sequence, start, end, duration = 60, reserved = order.parallelUnits,
      proven = reserved, available = reserved * duration, unavailable = 0,
      unproven = 0, status = "PROVEN", digest = TEST_SHA256,
    }) => intervalStatement.run(
      id, order.metering.id, order.id, contract.capacity_policy_id, sequence,
      start, end, duration, reserved, proven, reserved * duration, available,
      unavailable, unproven, status, digest, new Date().toISOString(),
    );

    insertInterval({ id: "KAI-MI-M6-VALID-1", sequence: 1, start: at(0), end: at(60) });
    insertInterval({ id: "KAI-MI-M6-VALID-2", sequence: 2, start: at(60), end: at(120) });
    assert.throws(
      () => insertInterval({ id: "KAI-MI-M6-OVERLAP", sequence: 3, start: at(30), end: at(90) }),
      /EXCHANGE_METER_INTERVAL_OVERLAP/u,
    );
    assert.throws(
      () => insertInterval({ id: "KAI-MI-M6-DURATION", sequence: 4, start: at(180), end: at(240), duration: 59, available: order.parallelUnits * 59 }),
      /constraint failed/u,
    );
    assert.throws(
      () => insertInterval({ id: "KAI-MI-M6-MILLISECONDS", sequence: 5, start: at(300, 123), end: at(360, 123) }),
      /constraint failed/u,
    );
    assert.throws(
      () => insertInterval({ id: "KAI-MI-M6-RATE", sequence: 6, start: at(420), end: at(480), proven: order.parallelUnits + 1 }),
      /constraint failed/u,
    );
    assert.throws(
      () => insertInterval({ id: "KAI-MI-M6-DIGEST", sequence: 7, start: at(540), end: at(600), digest: upperDigest }),
      /constraint failed/u,
    );
    assert.throws(
      () => db.prepare("UPDATE exchange_meter_intervals SET interval_start_at = ? WHERE id = 'KAI-MI-M6-VALID-2'")
        .run(at(30)),
      /EXCHANGE_METER_INTERVAL_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_meter_intervals WHERE id = 'KAI-MI-M6-VALID-2'").run(),
      /EXCHANGE_METER_INTERVAL_IMMUTABLE/u,
    );

    const evidenceStatement = db.prepare(`INSERT INTO exchange_meter_evidence (
      id, meter_interval_id, evidence_type, source, model_identity_digest,
      payload_digest, observed_at, created_at
    ) VALUES (?, 'KAI-MI-M6-VALID-1', ?, 'TEST', ?, ?, ?, ?)`);
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-MISSING-MODEL", "MODEL_IDENTITY", null, payloadDigest, at(30), new Date().toISOString()),
      /constraint failed/u,
    );
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-UPPERCASE", "MODEL_IDENTITY", upperDigest, payloadDigest, at(30), new Date().toISOString()),
      /constraint failed/u,
    );
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-UPPERCASE-PAYLOAD", "MODEL_IDENTITY", TEST_SHA256, upperDigest, at(30), new Date().toISOString()),
      /constraint failed/u,
    );
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-BEFORE", "AVAILABILITY", null, payloadDigest, at(-1), new Date().toISOString()),
      /EXCHANGE_METER_EVIDENCE_OUTSIDE_INTERVAL/u,
    );
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-AFTER", "AVAILABILITY", null, payloadDigest, at(61), new Date().toISOString()),
      /EXCHANGE_METER_EVIDENCE_OUTSIDE_INTERVAL/u,
    );
    assert.throws(
      () => evidenceStatement.run("KAI-ME-M6-MILLISECONDS", "AVAILABILITY", null, payloadDigest, at(30, 123), new Date().toISOString()),
      /constraint failed/u,
    );
    evidenceStatement.run("KAI-ME-M6-MODEL", "MODEL_IDENTITY", TEST_SHA256, payloadDigest, at(0), new Date().toISOString());
    evidenceStatement.run("KAI-ME-M6-ENDPOINT", "AVAILABILITY", null, payloadDigest, at(60), new Date().toISOString());
    assert.throws(
      () => db.prepare("UPDATE exchange_meter_evidence SET observed_at = ? WHERE id = 'KAI-ME-M6-MODEL'").run(at(1)),
      /EXCHANGE_METER_EVIDENCE_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_meter_evidence WHERE id = 'KAI-ME-M6-MODEL'").run(),
      /EXCHANGE_METER_EVIDENCE_IMMUTABLE/u,
    );
  } finally {
    db.close();
  }
});

test("M6-A3 migrates a populated v7 GPU close through v8 to v9 without changing children, money or legacy facts", async () => {
  let serverNowMs = Date.now();
  const source = d1BackedBySqlite();
  const store = createD1ExchangeStore(source.adapter, () => new Date(serverNowMs));
  const delivered = await deliveredOrder(store, "m8-populated");
  serverNowMs = Date.parse(delivered.order.startAt) + 60 * 60 * 1_000;
  const started = await store.testStartService(
    delivered.order.id,
    context("m8-populated-ops", "m8-populated-start", "m8-populated-start-payload"),
    parseTestServiceStart({ expectedVersion: delivered.order.metering.version }),
  );
  serverNowMs = Date.parse(delivered.order.endAt) + 1_000;
  const completed = await store.testCompleteMetering(
    delivered.order.id,
    context("m8-populated-ops", "m8-populated-final", "m8-populated-final-payload"),
    parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
  );
  const accepted = await store.submitAcceptance(
    delivered.order.id,
    context(delivered.buyer, "m8-populated-accept", "m8-populated-accept-payload"),
    parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version,
      decision: "ACCEPT",
      reason: "完整 GPU 迁移样本已核对计量和金额。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  await store.testRecordSettlement(
    accepted.record.settlement.id,
    context("m8-populated-ops", "m8-populated-settle", "m8-populated-settle-payload"),
    parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version }),
  );

  const sourceDb = source.db;
  const contract = sourceDb.prepare(`SELECT o.*, lv.sla_json, ra.product_version_id,
      pcp.id AS capacity_policy_id, pcp.product_code, pcp.fulfillment_model,
      pcp.pricing_unit_code, pcp.price_basis_base_units,
      pcp.immutable_hash AS policy_immutable_hash, pv.specs_json
    FROM exchange_orders o
    JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
    JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
    JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
    JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
    JOIN exchange_product_capacity_policies pcp ON pcp.product_version_id = pv.id
    WHERE o.id = ? AND pcp.feature_status = 'ENABLED'`).get(delivered.order.id);
  const durationSeconds = (Date.parse(contract.end_at) - Date.parse(contract.start_at)) / 1_000;
  sourceDb.prepare(`INSERT OR IGNORE INTO exchange_order_contract_snapshots (
    id, order_id, listing_version_id, product_version_id, capacity_policy_id,
    product_code, rate_unit_code, fulfillment_model, pricing_unit_code,
    rate_units, duration_seconds, capacity_base_units, unit_price_micros,
    price_basis_base_units, gross_amount_cents, currency, product_identity_json,
    sla_json, evidence_policy_version, snapshot_digest, created_at
  ) VALUES ('KAI-OCS-M8-POPULATED', ?, ?, ?, ?, ?, 'GPU', ?, ?, ?, ?, ?, ?, ?, ?,
    'CNY', ?, ?, ?, ?, ?)`).run(
    contract.id, contract.listing_version_id, contract.product_version_id, contract.capacity_policy_id,
    contract.product_code, contract.fulfillment_model, contract.pricing_unit_code,
    contract.rate_units, durationSeconds, contract.capacity_base_units, contract.unit_price_micros,
    contract.price_basis_base_units, contract.total_amount_cents, contract.specs_json, contract.sla_json,
    contract.policy_immutable_hash, TEST_SHA256, new Date().toISOString(),
  );
  if (sourceDb.prepare("SELECT COUNT(*) AS count FROM exchange_meter_intervals WHERE order_id = ?")
    .get(contract.id).count === 0) {
    const intervalEnd = new Date(Date.parse(contract.start_at) + 60_000).toISOString();
    sourceDb.prepare(`INSERT INTO exchange_meter_intervals (
    id, metering_session_id, order_id, capacity_policy_id, sequence_number,
    interval_start_at, interval_end_at, duration_seconds, reserved_rate_units,
    proven_rate_units, scheduled_capacity_base_units, available_capacity_base_units,
    unavailable_capacity_base_units, unproven_capacity_base_units, evidence_status,
    adapter, evidence_digest, created_at
  ) VALUES ('KAI-MI-M8-POPULATED', ?, ?, ?, 1, ?, ?, 60, ?, ?, ?, ?, 0, 0,
    'PROVEN', 'TEST', ?, ?)`).run(
    delivered.order.metering.id, contract.id, contract.capacity_policy_id,
    contract.start_at, intervalEnd, contract.rate_units, contract.rate_units,
    contract.rate_units * 60, contract.rate_units * 60, TEST_SHA256, new Date().toISOString(),
  );
    sourceDb.prepare(`INSERT INTO exchange_meter_evidence (
    id, meter_interval_id, evidence_type, source, model_identity_digest,
    payload_digest, observed_at, created_at
    ) VALUES ('KAI-ME-M8-POPULATED', 'KAI-MI-M8-POPULATED', 'AVAILABILITY',
      'TEST', NULL, ?, ?, ?)`).run(TEST_SHA256, contract.start_at, new Date().toISOString());
  }

  const migrated = createV7CloneFromV8(sourceDb);
  const compact = createV7CloneFromV8(sourceDb);
  const failed = createV7CloneFromV8(sourceDb);
  migrated.prepare("DELETE FROM exchange_schema_migrations WHERE version <> 7").run();
  compact.prepare("DELETE FROM exchange_schema_migrations WHERE version NOT IN (6, 7)").run();
  failed.prepare("DELETE FROM exchange_schema_migrations WHERE version NOT IN (6, 7)").run();
  const rebuiltTables = [
    "exchange_capacity_lots",
    "exchange_listing_versions",
    "exchange_orders",
    "exchange_reservations",
    "exchange_capacity_transfers",
    "exchange_metering_sessions",
    "exchange_service_facts",
    "exchange_metering_finals",
  ];
  const externalTables = [
    "exchange_order_lifecycle",
    "exchange_payment_intents",
    "exchange_payment_events",
    "exchange_delivery_tasks",
    "exchange_delivery_packages",
    "exchange_delivery_reviews",
    "exchange_delivery_claims",
    "exchange_connection_checks",
    "exchange_acceptances",
    "exchange_settlements",
    "exchange_ledger_batches",
    "exchange_ledger_entries",
    "exchange_order_contract_snapshots",
    "exchange_meter_intervals",
    "exchange_meter_evidence",
    "exchange_command_receipts",
    "exchange_domain_events",
  ];
  const oldColumns = new Map(rebuiltTables.map((table) => [
    table,
    migrated.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name),
  ]));
  const oldRows = new Map(rebuiltTables.map((table) => {
    const columns = oldColumns.get(table);
    return [table, migrated.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY 1`).all().map((row) => ({ ...row }))];
  }));
  const externalBefore = new Map(externalTables.map((table) => [table, tableRows(migrated, table)]));
  const sourceMoney = migrated.prepare(`SELECT
      (SELECT SUM(total_amount_cents) FROM exchange_orders) AS order_total,
      (SELECT SUM(amount_cents) FROM exchange_payment_intents) AS payment_total,
      (SELECT SUM(gross_amount_cents) FROM exchange_metering_finals) AS final_total,
      (SELECT SUM(gross_amount_cents) FROM exchange_settlements) AS settlement_total,
      (SELECT SUM(amount_cents) FROM exchange_ledger_entries) AS ledger_total`).get();
  const fresh = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });

  try {
    ensureSqliteExchangeSchema(migrated);
    ensureSqliteExchangeSchema(compact);
    ensureSqliteExchangeSchema(fresh);
    assert.deepEqual(
      migrated.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
      [7, 8, 9, 10, 11],
    );
    assert.deepEqual(
      compact.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version").all().map((row) => row.version),
      [6, 7, 8, 9, 10, 11],
    );
    assert.equal(compact.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get().count, 0);
    assert.equal(compact.prepare("SELECT COUNT(*) AS count FROM exchange_order_contract_snapshots").get().count, 1);
    assert.equal(compact.prepare(`SELECT COUNT(*) AS count FROM exchange_orders
      WHERE rate_unit_code = 'GPU'
        AND rate_units = parallel_units
        AND capacity_base_units = capacity_gpu_seconds
        AND unit_price_micros = unit_price_cents * 10000`).get().count, 1);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get().count, 0);
    assert.equal(migrated.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m8_%' OR name LIKE 'exchange_m9_%' OR name LIKE 'exchange_m10_%' OR name LIKE 'exchange_m11_%'").get().count, 0);
    const objectProjection = (db) => db.prepare(`SELECT type, name FROM sqlite_master
      WHERE name LIKE 'exchange_%' ORDER BY type, name`).all().map((row) => ({ ...row }));
    assert.deepEqual(objectProjection(migrated), objectProjection(fresh));
    for (const table of rebuiltTables) {
      const columns = oldColumns.get(table);
      const after = migrated.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY 1`).all().map((row) => ({ ...row }));
      assert.deepEqual(after, oldRows.get(table), `${table} legacy columns changed`);
      assert.equal(migrated.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE accounting_schema_version <> 1`).get().count, 0);
      for (const pragma of ["table_info", "foreign_key_list", "index_list"]) {
        assert.deepEqual(
          migrated.prepare(`PRAGMA ${pragma}(${table})`).all().map((row) => ({ ...row })),
          fresh.prepare(`PRAGMA ${pragma}(${table})`).all().map((row) => ({ ...row })),
          `${table} ${pragma} differs from fresh v9`,
        );
      }
      const migratedSql = migrated.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql
        .replace(/\s+/gu, " ").trim();
      const freshSql = fresh.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table).sql
        .replace(/\s+/gu, " ").trim();
      assert.equal(migratedSql, freshSql, `${table} DDL differs from fresh v9`);
    }
    for (const table of ["exchange_product_versions", "exchange_product_capacity_policies"]) {
      assert.deepEqual(tableRows(migrated, table), tableRows(fresh, table));
    }
    for (const table of externalTables) {
      assert.deepEqual(tableRows(migrated, table), externalBefore.get(table), `${table} child rows changed`);
    }
    assert.deepEqual(migrated.prepare(`SELECT
        (SELECT SUM(total_amount_cents) FROM exchange_orders) AS order_total,
        (SELECT SUM(amount_cents) FROM exchange_payment_intents) AS payment_total,
        (SELECT SUM(gross_amount_cents) FROM exchange_metering_finals) AS final_total,
        (SELECT SUM(gross_amount_cents) FROM exchange_settlements) AS settlement_total,
        (SELECT SUM(amount_cents) FROM exchange_ledger_entries) AS ledger_total`).get(), sourceMoney);
    assert.equal(migrated.prepare(`SELECT COUNT(*) AS count FROM exchange_orders
      WHERE rate_unit_code <> 'GPU' OR rate_units <> parallel_units
        OR capacity_base_units <> capacity_gpu_seconds
        OR unit_price_micros <> unit_price_cents * 10000`).get().count, 0);
    assert.equal(migrated.prepare(`SELECT COUNT(*) AS count FROM exchange_metering_sessions
      WHERE rate_unit_code <> 'GPU'
        OR scheduled_capacity_base_units <> scheduled_gpu_seconds
        OR available_capacity_base_units <> available_gpu_seconds
        OR unavailable_capacity_base_units <> unavailable_gpu_seconds
        OR unproven_capacity_base_units <> unproven_gpu_seconds`).get().count, 0);
    assert.throws(
      () => migrated.prepare("UPDATE exchange_order_contract_snapshots SET gross_amount_cents = gross_amount_cents + 1").run(),
      /EXCHANGE_ORDER_CONTRACT_SNAPSHOT_IMMUTABLE/u,
    );
    assert.throws(
      () => migrated.prepare("DELETE FROM exchange_meter_intervals WHERE order_id = ?").run(contract.id),
      /EXCHANGE_METER_INTERVAL_IMMUTABLE/u,
    );

    failed.prepare("UPDATE exchange_capacity_lots SET capacity_gpu_seconds = capacity_gpu_seconds + 1").run();
    const failedChildren = new Map(externalTables.map((table) => [table, tableRows(failed, table)]));
    assert.throws(() => ensureSqliteExchangeSchema(failed), /constraint failed/u);
    assert.equal(failed.prepare("SELECT MAX(version) AS version FROM exchange_schema_migrations").get().version, 7);
    assert.ok(!failed.prepare("PRAGMA table_info(exchange_capacity_lots)").all().some((column) => column.name === "rate_unit_code"));
    assert.equal(failed.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name LIKE 'exchange_m8_%'").get().count, 0);
    for (const table of externalTables) assert.deepEqual(tableRows(failed, table), failedChildren.get(table));
  } finally {
    migrated.close();
    compact.close();
    failed.close();
    fresh.close();
    sourceDb.close();
  }
});

test("M5 parsers keep service, metering and settlement amounts server-derived", () => {
  assert.deepEqual(parseTestServiceStart({ expectedVersion: 1 }), { expectedVersion: 1 });
  assert.deepEqual(parseTestMeterComplete({ expectedVersion: 2 }), { expectedVersion: 2 });
  assert.deepEqual(parseTestRecordSettlement({ expectedVersion: 2 }), { expectedVersion: 2 });
  assert.throws(() => parseTestServiceStart({ expectedVersion: 1, startedAt: iso(0) }), /startedAt/);
  assert.throws(() => parseTestMeterComplete({ expectedVersion: 2, availableGpuSeconds: 3600 }), /availableGpuSeconds/);
  assert.throws(() => parseTestRecordSettlement({ expectedVersion: 2, amountCents: 100 }), /amountCents/);
  assert.throws(() => parseSubmitOrderAcceptance({
    expectedVersion: 1,
    decision: "ACCEPT",
    reason: "确认计量和金额口径。",
    evidenceDigest: "not-a-digest",
  }), /evidenceDigest/);
});

test("SQLite M5 closes TEST service, metering, acceptance and balanced settlement without moving funds", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m5-${crypto.randomUUID()}.sqlite`);
  let serverNowMs = Date.now();
  const store = createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
  const { buyer, order } = await deliveredOrder(store, "m5-golden");
  assert.equal(order.metering.status, "SCHEDULED");
  assert.equal(order.metering.unprovenGpuSeconds, order.capacityGpuSeconds);
  assert.equal(order.acceptance, null);
  assert.equal(order.settlement, null);

  serverNowMs = Date.parse(order.startAt) + 60 * 60 * 1_000;
  const startContext = context("m5-golden-ops", "m5-golden-service-start", "m5-golden-service-start-payload");
  const started = await store.testStartService(
    order.id,
    startContext,
    parseTestServiceStart({ expectedVersion: order.metering.version }),
  );
  assert.equal(started.record.metering.status, "ACTIVE");
  assert.equal(started.record.metering.actualStartAt, new Date(serverNowMs).toISOString());
  assert.equal(started.record.delivery.status, "IN_SERVICE");
  assert.equal(started.record.reservation.state, "IN_SERVICE");
  assert.deepEqual(started.record.allowedActions, ["TEST_COMPLETE_METERING"]);
  assert.equal((await store.testStartService(
    order.id,
    startContext,
    parseTestServiceStart({ expectedVersion: order.metering.version }),
  )).replayed, true);

  await assert.rejects(
    store.testCompleteMetering(
      order.id,
      context("m5-golden-ops", "m5-golden-too-early", "m5-golden-too-early-payload"),
      parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
    ),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
  );

  serverNowMs = Date.parse(order.endAt) + 1_000;
  const completed = await store.testCompleteMetering(
    order.id,
    context("m5-golden-ops", "m5-golden-meter-final", "m5-golden-meter-final-payload"),
    parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
  );
  assert.equal(completed.record.status, "AWAITING_ACCEPTANCE");
  assert.equal(completed.record.metering.status, "FINAL");
  assert.equal(completed.record.delivery.status, "COMPLETED");
  assert.equal(completed.record.reservation.state, "FULFILLED");
  assert.equal(
    completed.record.metering.availableGpuSeconds + completed.record.metering.unavailableGpuSeconds,
    completed.record.metering.scheduledGpuSeconds,
  );
  assert.equal(completed.record.metering.unprovenGpuSeconds, 4 * 60 * 60);
  assert.equal(completed.record.metering.availableGpuSeconds, 4 * 24 * 60 * 60);
  assert.equal(completed.record.acceptance.status, "PENDING");
  assert.equal(completed.record.settlement.status, "BLOCKED");
  assert.equal(
    completed.record.settlement.grossAmountCents,
    completed.record.settlement.baseCreditCents + completed.record.settlement.netSupplierPayableCents,
  );

  const accepted = await store.submitAcceptance(
    order.id,
    context(buyer, "m5-golden-accept", "m5-golden-accept-payload"),
    parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version,
      decision: "ACCEPT",
      reason: "已核对固定时间窗、GPU 秒和测试金额勾稽，确认验收。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(accepted.record.status, "COMPLETED");
  assert.equal(accepted.record.acceptance.status, "ACCEPTED");
  assert.equal(accepted.record.settlement.status, "ELIGIBLE");

  const recorded = await store.testRecordSettlement(
    accepted.record.settlement.id,
    context("m5-golden-ops", "m5-golden-settle", "m5-golden-settle-payload"),
    parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version }),
  );
  assert.equal(recorded.record.status, "TEST_RECORDED");
  assert.equal(recorded.record.fundsMoved, false);
  assert.ok(recorded.record.ledgerBatchId);

  const auditDb = new DatabaseSync(databasePath, { readOnly: true });
  try {
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_metering_sessions WHERE status = 'FINAL'").get().count, 1);
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE from_bucket = 'LOCKED' AND to_bucket = 'IN_SERVICE'").get().count, 1);
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE from_bucket = 'IN_SERVICE' AND to_bucket = 'CONSUMED'").get().count, 1);
    const final = auditDb.prepare("SELECT * FROM exchange_metering_finals WHERE order_id = ?").get(order.id);
    assert.equal(final.available_gpu_seconds + final.unavailable_gpu_seconds, final.scheduled_gpu_seconds);
    assert.equal(final.delivered_amount_cents + final.base_credit_cents, final.gross_amount_cents);
    const batch = auditDb.prepare("SELECT * FROM exchange_ledger_batches WHERE settlement_id = ?").get(recorded.record.id);
    assert.equal(batch.environment, "TEST");
    assert.equal(batch.funds_moved, 0);
    assert.equal(batch.debit_total_cents, batch.credit_total_cents);
    const totals = auditDb.prepare(`SELECT side, SUM(amount_cents) AS total
      FROM exchange_ledger_entries WHERE batch_id = ? GROUP BY side`).all(batch.id);
    assert.equal(totals.find((row) => row.side === "DEBIT").total, totals.find((row) => row.side === "CREDIT").total);
    assert.equal(auditDb.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE funds_moved <> 0").get().count, 0);
  } finally {
    auditDb.close();
  }
});

test("SQLite M5 rejects starts outside the window and keeps disputed settlement blocked", async () => {
  let serverNowMs = Date.now();
  const store = createSqliteExchangeStore(":memory:", () => new Date(serverNowMs));
  const { buyer, order } = await deliveredOrder(store, "m5-dispute");
  serverNowMs = Date.parse(order.startAt) - 1_000;
  await assert.rejects(
    store.testStartService(
      order.id,
      context("m5-dispute-ops", "m5-dispute-early-start", "m5-dispute-early-start-payload"),
      parseTestServiceStart({ expectedVersion: order.metering.version }),
    ),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
  );
  serverNowMs = Date.parse(order.startAt);
  const started = await store.testStartService(
    order.id,
    context("m5-dispute-ops", "m5-dispute-start", "m5-dispute-start-payload"),
    parseTestServiceStart({ expectedVersion: order.metering.version }),
  );
  serverNowMs = Date.parse(order.endAt);
  const completed = await store.testCompleteMetering(
    order.id,
    context("m5-dispute-ops", "m5-dispute-final", "m5-dispute-final-payload"),
    parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
  );
  assert.equal(completed.record.metering.availableGpuSeconds, completed.record.capacityGpuSeconds);
  assert.equal(completed.record.settlement.baseCreditCents, 0);
  const disputed = await store.submitAcceptance(
    order.id,
    context(buyer, "m5-dispute-submit", "m5-dispute-submit-payload"),
    parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version,
      decision: "DISPUTE",
      reason: "对测试计量证据来源提出争议，等待运营核对。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(disputed.record.status, "EXCEPTION");
  assert.equal(disputed.record.acceptance.status, "DISPUTED");
  assert.equal(disputed.record.settlement.status, "BLOCKED");
  await assert.rejects(
    store.testRecordSettlement(
      disputed.record.settlement.id,
      context("m5-dispute-ops", "m5-dispute-settle", "m5-dispute-settle-payload"),
      parseTestRecordSettlement({ expectedVersion: disputed.record.settlement.version }),
    ),
    (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
  );
});

test("D1 M5 matches the TEST metering and settlement close with single-winner idempotency", async () => {
  const { db, adapter } = d1BackedBySqlite();
  let serverNowMs = Date.now();
  const store = createD1ExchangeStore(adapter, () => new Date(serverNowMs));
  try {
    const { buyer, order } = await deliveredOrder(store, "m5-d1-golden");
    assert.equal(order.metering.status, "SCHEDULED");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_metering_sessions").get().count, 1);

    serverNowMs = Date.parse(order.startAt) + 30 * 60 * 1_000;
    const startWrite = context("m5-d1-ops", "m5-d1-service-start", "m5-d1-service-start-payload");
    const starts = await Promise.all([
      store.testStartService(order.id, startWrite, parseTestServiceStart({ expectedVersion: order.metering.version })),
      store.testStartService(order.id, startWrite, parseTestServiceStart({ expectedVersion: order.metering.version })),
    ]);
    assert.equal(starts.filter((result) => result.replayed).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_service_facts WHERE fact_type = 'TEST_SERVICE_STARTED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE from_bucket = 'LOCKED' AND to_bucket = 'IN_SERVICE'").get().count, 1);
    const active = await store.getOrder(buyer, order.id, "buyer");
    assert.equal(active.metering.status, "ACTIVE");

    serverNowMs = Date.parse(order.endAt);
    const finalWrite = context("m5-d1-ops", "m5-d1-meter-final", "m5-d1-meter-final-payload");
    const finals = await Promise.all([
      store.testCompleteMetering(order.id, finalWrite, parseTestMeterComplete({ expectedVersion: active.metering.version })),
      store.testCompleteMetering(order.id, finalWrite, parseTestMeterComplete({ expectedVersion: active.metering.version })),
    ]);
    assert.equal(finals.filter((result) => result.replayed).length, 1);
    const awaiting = await store.getOrder(buyer, order.id, "buyer");
    assert.equal(awaiting.status, "AWAITING_ACCEPTANCE");
    assert.equal(awaiting.metering.status, "FINAL");
    assert.equal(awaiting.metering.unprovenGpuSeconds, 4 * 30 * 60);
    assert.equal(awaiting.settlement.grossAmountCents, awaiting.settlement.baseCreditCents + awaiting.settlement.netSupplierPayableCents);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_metering_finals").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE from_bucket = 'IN_SERVICE' AND to_bucket = 'CONSUMED'").get().count, 1);

    const acceptWrite = context(buyer, "m5-d1-accept", "m5-d1-accept-payload");
    const acceptanceInput = parseSubmitOrderAcceptance({
      expectedVersion: awaiting.acceptance.version,
      decision: "ACCEPT",
      reason: "已核对 D1 测试计量与金额勾稽，确认验收。",
      evidenceDigest: TEST_SHA256,
    });
    const acceptances = await Promise.all([
      store.submitAcceptance(order.id, acceptWrite, acceptanceInput),
      store.submitAcceptance(order.id, acceptWrite, acceptanceInput),
    ]);
    assert.equal(acceptances.filter((result) => result.replayed).length, 1);
    const accepted = await store.getOrder(buyer, order.id, "buyer");
    assert.equal(accepted.status, "COMPLETED");
    assert.equal(accepted.settlement.status, "ELIGIBLE");

    const settleWrite = context("m5-d1-ops", "m5-d1-settle", "m5-d1-settle-payload");
    const settlementInput = parseTestRecordSettlement({ expectedVersion: accepted.settlement.version });
    const settlements = await Promise.all([
      store.testRecordSettlement(accepted.settlement.id, settleWrite, settlementInput),
      store.testRecordSettlement(accepted.settlement.id, settleWrite, settlementInput),
    ]);
    assert.equal(settlements.filter((result) => result.replayed).length, 1);
    assert.equal(settlements[0].record.status, "TEST_RECORDED");
    assert.equal(settlements[0].record.fundsMoved, false);
    const batch = db.prepare("SELECT * FROM exchange_ledger_batches").get();
    assert.equal(batch.debit_total_cents, batch.credit_total_cents);
    assert.equal(batch.funds_moved, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_ledger_batches").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_payment_events WHERE funds_moved <> 0").get().count, 0);
  } finally {
    db.close();
  }
});

test("SQLite and D1 M5 reject PASS followed by a latest FAILED connection check without service side effects", async () => {
  const variants = ["sqlite", "d1"];
  for (const variant of variants) {
    let serverNowMs = Date.now();
    const databasePath = join(tmpdir(), `kai-cloud-m5-latest-${variant}-${crypto.randomUUID()}.sqlite`);
    const d1 = variant === "d1" ? d1BackedBySqlite() : null;
    const store = variant === "d1"
      ? createD1ExchangeStore(d1.adapter, () => new Date(serverNowMs))
      : createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
    const { order } = await deliveredOrder(store, `m5-latest-${variant}`);
    const db = d1?.db ?? new DatabaseSync(databasePath);
    try {
      appendFailedLatestConnection(db, order.delivery.package.id, variant);
      const listed = (await store.listOpsMeteringOrders()).find((candidate) => candidate.id === order.id);
      assert.ok(listed, variant);
      assert.equal(listed.delivery.package.latestConnectionCheck.status, "FAILED", variant);
      assert.deepEqual(listed.allowedActions, [], variant);

      serverNowMs = Date.parse(order.startAt) + 60 * 60 * 1_000;
      await assert.rejects(
        store.testStartService(
          order.id,
          context(`m5-latest-${variant}-ops`, `m5-latest-${variant}-start`, `m5-latest-${variant}-payload`),
          parseTestServiceStart({ expectedVersion: order.metering.version }),
        ),
        (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
        variant,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_service_facts").get().count, 0, variant);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_capacity_transfers
        WHERE from_bucket = 'LOCKED' AND to_bucket = 'IN_SERVICE'`).get().count, 0, variant);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_command_receipts
        WHERE command_type = 'TEST_SERVICE_START'`).get().count, 0, variant);
    } finally {
      db.close();
    }
  }
});

test("SQLite and D1 M5 expire stale claimed packages before ops start and leave zero service side effects", async () => {
  const variants = ["sqlite", "d1"];
  for (const variant of variants) {
    let serverNowMs = Date.now();
    const databasePath = join(tmpdir(), `kai-cloud-m5-expiry-${variant}-${crypto.randomUUID()}.sqlite`);
    const d1 = variant === "d1" ? d1BackedBySqlite() : null;
    const store = variant === "d1"
      ? createD1ExchangeStore(d1.adapter, () => new Date(serverNowMs))
      : createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
    const { order } = await deliveredOrder(store, `m5-expiry-${variant}`);
    const db = d1?.db ?? new DatabaseSync(databasePath);
    try {
      const expiredAt = new Date(Date.parse(order.startAt) + 30 * 60 * 1_000).toISOString();
      db.prepare("UPDATE exchange_delivery_packages SET credential_expires_at = ? WHERE id = ?")
        .run(expiredAt, order.delivery.package.id);
      serverNowMs = Date.parse(order.startAt) + 60 * 60 * 1_000;

      const listed = (await store.listOpsMeteringOrders()).find((candidate) => candidate.id === order.id);
      assert.ok(listed, variant);
      assert.equal(listed.delivery.package.status, "EXPIRED", variant);
      assert.equal(listed.delivery.status, "PROVISIONING", variant);
      assert.deepEqual(listed.allowedActions, [], variant);

      await assert.rejects(
        store.testStartService(
          order.id,
          context(`m5-expiry-${variant}-ops`, `m5-expiry-${variant}-start`, `m5-expiry-${variant}-payload`),
          parseTestServiceStart({ expectedVersion: order.metering.version }),
        ),
        (error) => error instanceof ExchangeDomainError
          && error.code === "EXCHANGE_DELIVERY_PACKAGE_EXPIRED"
          && error.status === 410,
        variant,
      );
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_service_facts").get().count, 0, variant);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_capacity_transfers
        WHERE from_bucket = 'LOCKED' AND to_bucket = 'IN_SERVICE'`).get().count, 0, variant);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_command_receipts
        WHERE command_type = 'TEST_SERVICE_START'`).get().count, 0, variant);
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_domain_events
        WHERE event_type = 'DELIVERY_PACKAGE_EXPIRED'`).get().count, 1, variant);
    } finally {
      db.close();
    }
  }
});

test("SQLite rejected delivery package returns to provisioning and creates a new revision", async () => {
  const store = createSqliteExchangeStore(":memory:");
  const { supplier, order } = await startedDeliveryOrder(store, "delivery-reject");
  const first = await store.submitDeliveryPackage(
    order.delivery.id,
    context(supplier, "delivery-reject-submit-one", "delivery-reject-submit-one-payload"),
    deliveryPackageInput(order),
  );
  const rejected = await store.reviewDeliveryPackage(
    first.record.id,
    context("delivery-reject-ops", "delivery-reject-review", "delivery-reject-review-payload"),
    parseReviewDeliveryPackage({
      expectedVersion: first.record.version,
      decision: "REJECT",
      verificationMethod: "MANUAL",
      reason: "脱敏连接说明缺少供应商内部核验记录，请补充后重新提交。",
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(rejected.record.status, "REJECTED");
  const returned = await store.getOrder(supplier, order.id, "supplier");
  assert.equal(returned.delivery.status, "PROVISIONING");
  assert.equal(returned.delivery.package.status, "REJECTED");
  assert.equal(returned.delivery.version, order.delivery.version + 2);
  assert.deepEqual(returned.allowedActions, ["SUBMIT_DELIVERY_PACKAGE"]);
  const second = await store.submitDeliveryPackage(
    order.delivery.id,
    context(supplier, "delivery-reject-submit-two", "delivery-reject-submit-two-payload"),
    parseSubmitDeliveryPackage({
      ...deliveryPackageInput(returned),
      expectedVersion: returned.delivery.version,
      evidenceDigest: TEST_SHA256,
    }),
  );
  assert.equal(second.record.revision, 2);
  assert.equal(second.record.status, "SUBMITTED");
});

test("M8-A SQLite withdraws pristine whole lots for every enabled product and replays canonical facts", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m8-withdraw-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const products = ["GPU_COMPUTE", "MODEL_INSTANCE", "TOKEN_THROUGHPUT", "NAS_STORAGE", "RACK_SPACE"];
  const withdrawals = [];
  for (const [index, product] of products.entries()) {
    const supplier = `m8-withdraw-${index}-supplier`;
    const { lot } = await readyLotForProduct(store, supplier, `m8-withdraw-${index}`, product);
    assert.equal(lot.withdrawalEligibility.eligible, true, product);
    assert.deepEqual(lot.allowedActions, ["CREATE_LISTING", "WITHDRAW"], product);
    const mutationContext = context(supplier, `m8-withdraw-${index}-command`, `m8-withdraw-${index}-payload`);
    const input = parseWithdrawCapacityLot({ expectedVersion: lot.version, reason: "Supplier withdrew the complete unused lot." });
    const first = await store.withdrawCapacityLot(lot.id, mutationContext, input);
    const replay = await store.withdrawCapacityLot(lot.id, mutationContext, input);
    assert.equal(first.replayed, false, product);
    assert.equal(replay.replayed, true, product);
    assert.deepEqual(replay.record, first.record, product);
    const projected = (await store.listSupplierLots(supplier)).find((candidate) => candidate.id === lot.id);
    assert.equal(projected.status, "WITHDRAWN", product);
    assert.equal(projected.version, lot.version + 1, product);
    assert.equal(projected.withdrawalEligibility.reasonCode, "ALREADY_WITHDRAWN", product);
    assert.deepEqual(projected.allowedActions, [], product);
    withdrawals.push(first.record);
  }
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_withdrawals").get().count, products.length);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM exchange_capacity_transfers
      WHERE from_bucket = 'AVAILABLE' AND to_bucket = 'WITHDRAWN'
        AND reason = 'CAPACITY_LOT_WITHDRAWN'`).get().count, products.length);
    assert.throws(
      () => db.prepare("UPDATE exchange_capacity_withdrawals SET reason = 'tampered' WHERE id = ?").run(withdrawals[0].id),
      /EXCHANGE_CAPACITY_WITHDRAWAL_IMMUTABLE/u,
    );
    assert.throws(
      () => db.prepare("DELETE FROM exchange_capacity_transfers WHERE id = ?").run(withdrawals[0].transferId),
      /EXCHANGE_CAPACITY_TRANSFER_IMMUTABLE/u,
    );
    db.prepare(`DELETE FROM exchange_domain_events
      WHERE entity_type = 'CAPACITY_LOT' AND entity_id = ? AND event_type = 'CAPACITY_LOT_WITHDRAWN'`)
      .run(withdrawals[0].capacityLotId);
    await assert.rejects(
      store.withdrawCapacityLot(
        withdrawals[0].capacityLotId,
        context("m8-withdraw-0-supplier", "m8-withdraw-0-command", "m8-withdraw-0-payload"),
        parseWithdrawCapacityLot({ expectedVersion: 1, reason: "Supplier withdrew the complete unused lot." }),
      ),
      /EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_WITHDRAWAL_REPLAY/u,
    );
  } finally {
    db.close();
  }
});

test("M8-A D1 listing/withdrawal has one version winner and inner 0-row faults roll back the lot", async () => {
  const d1 = d1BackedBySqlite();
  const store = createD1ExchangeStore(d1.adapter);
  try {
    const first = await readyLotForProduct(store, "m8-race-supplier", "m8-race", "GPU_COMPUTE");
    const listingPromise = store.createListing(
      context("m8-race-supplier", "m8-race-listing", "m8-race-listing-payload"),
      listingInputForLot(first.lot, first.configuration, 25_000_000),
    );
    const withdrawalPromise = store.withdrawCapacityLot(
      first.lot.id,
      context("m8-race-supplier", "m8-race-withdraw", "m8-race-withdraw-payload"),
      parseWithdrawCapacityLot({ expectedVersion: first.lot.version, reason: "Race the publication command with withdrawal." }),
    );
    const winners = await Promise.allSettled([listingPromise, withdrawalPromise]);
    assert.equal(winners.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(winners.filter((result) => result.status === "rejected").length, 1);
    const finalLot = (await store.listSupplierLots("m8-race-supplier")).find((candidate) => candidate.id === first.lot.id);
    assert.ok(["LISTED", "WITHDRAWN"].includes(finalLot.status));
    assert.equal(finalLot.version, first.lot.version + 1);

    const second = await readyLotForProduct(store, "m8-zero-supplier", "m8-zero", "MODEL_INSTANCE");
    d1.adapter.zeroNextBatchStatement(1);
    await assert.rejects(store.withdrawCapacityLot(
      second.lot.id,
      context("m8-zero-supplier", "m8-zero-withdraw", "m8-zero-withdraw-payload"),
      parseWithdrawCapacityLot({ expectedVersion: second.lot.version, reason: "Inject a missing transfer write." }),
    ));
    const rolledBack = (await store.listSupplierLots("m8-zero-supplier")).find((candidate) => candidate.id === second.lot.id);
    assert.equal(rolledBack.status, "READY");
    assert.equal(rolledBack.version, second.lot.version);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_withdrawals WHERE capacity_lot_id = ?")
      .get(second.lot.id).count, 0);
    assert.equal(d1.db.prepare(`SELECT COUNT(*) AS count FROM exchange_capacity_transfers
      WHERE capacity_lot_id = ? AND to_bucket = 'WITHDRAWN'`).get(second.lot.id).count, 0);
  } finally {
    d1.db.close();
  }
});

test("M8-B SQLite and D1 build exact cross-product swap values, enforce ownership and append-only status", async () => {
  for (const variant of ["sqlite", "d1"]) {
    let swapNowMs = Date.now();
    const databasePath = join(tmpdir(), `kai-cloud-m8-swap-${variant}-${crypto.randomUUID()}.sqlite`);
    const d1 = variant === "d1" ? d1BackedBySqlite() : null;
    const store = variant === "d1"
      ? createD1ExchangeStore(d1.adapter, () => new Date(swapNowMs))
      : createSqliteExchangeStore(databasePath, () => new Date(swapNowMs));
    const db = d1?.db ?? new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      const offered = await publishedGpuListing(store, `${variant}-swap-a`, `${variant}-swap-a`, 4);
      const wanted = await publishedModelListing(store, `${variant}-swap-b`, `${variant}-swap-b`, 4);
      const equalWanted = await publishedGpuListing(store, `${variant}-swap-c`, `${variant}-swap-c`, 4);
      const startAt = [offered.lot.startAt, wanted.lot.startAt, equalWanted.lot.startAt].sort().at(-1);
      const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
      const input = parseCreateSwapQuote({
        offered: { listingVersionId: offered.listing.id, rateUnits: 2, startAt, endAt },
        wanted: { listingVersionId: wanted.listing.id, rateUnits: 1, startAt, endAt },
      });
      const quoteContext = context(`${variant}-swap-a`, `${variant}-swap-quote`, `${variant}-swap-quote-payload`);
      const created = await store.createSwapQuote(quoteContext, input);
      const replay = await store.createSwapQuote(quoteContext, input);
      assert.equal(created.record.offeredValueCents, 5_000, variant);
      assert.equal(created.record.wantedValueCents, 3, variant);
      assert.equal(created.record.cashAdjustmentSignedCents, -4_997, variant);
      assert.equal(created.record.cashAdjustmentPayerActorId, `${variant}-swap-b`, variant);
      assert.equal(created.record.cashAdjustmentPayeeActorId, `${variant}-swap-a`, variant);
      assert.deepEqual(created.record.allowedActions, ["OPS_REVIEW", "CANCELLED"], variant);
      assert.equal(replay.replayed, true, variant);
      assert.deepEqual((await store.listSwapQuotes(`${variant}-swap-b`))[0].allowedActions, [], variant);
      const reverse = await store.createSwapQuote(
        context(`${variant}-swap-b`, `${variant}-swap-reverse`, `${variant}-swap-reverse-payload`),
        parseCreateSwapQuote({
          offered: { listingVersionId: wanted.listing.id, rateUnits: 1, startAt, endAt },
          wanted: { listingVersionId: offered.listing.id, rateUnits: 2, startAt, endAt },
        }),
      );
      assert.equal(reverse.record.cashAdjustmentSignedCents, 4_997, variant);
      assert.equal(reverse.record.cashAdjustmentPayerActorId, `${variant}-swap-b`, variant);
      assert.equal(reverse.record.cashAdjustmentPayeeActorId, `${variant}-swap-a`, variant);
      const equal = await store.createSwapQuote(
        context(`${variant}-swap-a`, `${variant}-swap-equal`, `${variant}-swap-equal-payload`),
        parseCreateSwapQuote({
          offered: { listingVersionId: offered.listing.id, rateUnits: 1, startAt, endAt },
          wanted: { listingVersionId: equalWanted.listing.id, rateUnits: 1, startAt, endAt },
        }),
      );
      assert.equal(equal.record.cashAdjustmentSignedCents, 0, variant);
      assert.equal(equal.record.cashAdjustmentAmountCents, 0, variant);
      assert.equal(equal.record.cashAdjustmentPayerActorId, null, variant);
      assert.equal(equal.record.cashAdjustmentPayeeActorId, null, variant);
      await assert.rejects(
        store.createSwapQuote(
          context(`${variant}-swap-a`, `${variant}-swap-self`, `${variant}-swap-self-payload`),
          parseCreateSwapQuote({ offered: input.offered, wanted: input.offered }),
        ),
        (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_STATE_CONFLICT",
        variant,
      );
      const reviewed = await store.transitionSwapQuote(
        created.record.id,
        context(`${variant}-swap-a`, `${variant}-swap-review`, `${variant}-swap-review-payload`),
        parseTransitionSwapQuote({ expectedVersion: 1, action: "OPS_REVIEW", reason: "Send the quote to operations review." }),
      );
      assert.equal(reviewed.record.status, "OPS_REVIEW", variant);
      assert.equal(reviewed.record.version, 2, variant);
      assert.deepEqual(reviewed.record.allowedActions, ["CANCELLED"], variant);
      const cancelled = await store.transitionSwapQuote(
        created.record.id,
        context(`${variant}-swap-a`, `${variant}-swap-cancel`, `${variant}-swap-cancel-payload`),
        parseTransitionSwapQuote({ expectedVersion: 2, action: "CANCELLED", reason: "Cancel after reviewing the quoted terms." }),
      );
      assert.equal(cancelled.record.status, "CANCELLED", variant);
      assert.equal(cancelled.record.version, 3, variant);
      assert.deepEqual(cancelled.record.allowedActions, [], variant);
      const replayedReview = await store.transitionSwapQuote(
        created.record.id,
        context(`${variant}-swap-a`, `${variant}-swap-review`, `${variant}-swap-review-payload`),
        parseTransitionSwapQuote({ expectedVersion: 1, action: "OPS_REVIEW", reason: "Send the quote to operations review." }),
      );
      assert.equal(replayedReview.replayed, true, variant);
      assert.equal(replayedReview.record.status, "CANCELLED", variant);
      assert.equal(replayedReview.record.version, 3, variant);
      swapNowMs = Date.parse(equal.record.expiresAt);
      const expired = (await store.listSwapQuotes(`${variant}-swap-a`))
        .find((candidate) => candidate.id === equal.record.id);
      assert.equal(expired.status, "EXPIRED", variant);
      assert.deepEqual(expired.allowedActions, ["EXPIRED"], variant);
      const persistedExpiry = await store.transitionSwapQuote(
        equal.record.id,
        context(`${variant}-swap-a`, `${variant}-swap-expire`, `${variant}-swap-expire-payload`),
        parseTransitionSwapQuote({ expectedVersion: 1, action: "EXPIRED", reason: "Persist effective quote expiry." }),
      );
      assert.equal(persistedExpiry.record.status, "EXPIRED", variant);
      assert.equal(persistedExpiry.record.version, 2, variant);
      assert.throws(
        () => db.prepare("UPDATE exchange_listing_versions SET unit_price_micros = unit_price_micros + 1 WHERE id = ?")
          .run(offered.listing.id),
        /EXCHANGE_LISTING_VERSION_IMMUTABLE/u,
        variant,
      );
      assert.throws(
        () => db.prepare("UPDATE exchange_swap_quote_snapshots SET value_cents = value_cents + 1 WHERE quote_id = ?")
          .run(created.record.id),
        /EXCHANGE_SWAP_SNAPSHOT_IMMUTABLE/u,
        variant,
      );
      db.exec("DROP TRIGGER exchange_swap_quote_snapshots_immutable_update");
      db.prepare("UPDATE exchange_swap_quote_snapshots SET snapshot_digest = ? WHERE quote_id = ? AND leg_role = 'OFFERED'")
        .run(`sha256:${"0".repeat(64)}`, created.record.id);
      await assert.rejects(
        store.listSwapQuotes(`${variant}-swap-a`),
        /EXCHANGE_INVARIANT_CORRUPTION:SWAP_SNAPSHOT_DIGEST_MISMATCH/u,
        variant,
      );
    } finally {
      db.close();
    }
  }
});

test("M8-B D1 rechecks exact peak inventory inside the quote batch", async () => {
  const d1 = d1BackedBySqlite();
  const store = createD1ExchangeStore(d1.adapter);
  try {
    const offered = await publishedGpuListing(store, "m8-peak-a", "m8-peak-a", 4);
    const wanted = await publishedModelListing(store, "m8-peak-b", "m8-peak-b", 4);
    const startAt = offered.lot.startAt > wanted.lot.startAt ? offered.lot.startAt : wanted.lot.startAt;
    const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
    const laterStart = new Date(Date.parse(startAt) + 3 * 60 * 60 * 1_000).toISOString();
    const laterEnd = new Date(Date.parse(laterStart) + 60 * 60 * 1_000).toISOString();
    const reservation = await store.createCheckout(
      context("m8-peak-buyer", "m8-peak-checkout", "m8-peak-checkout-payload"),
      parseCreateCheckout({
        listingVersionId: offered.listing.id, parallelUnits: 4,
        startAt: laterStart, endAt: laterEnd, interruptibility: "NON_INTERRUPTIBLE",
      }),
    );
    d1.adapter.beforeNextBatch((db) => {
      db.prepare("UPDATE exchange_reservations SET start_at = ?, end_at = ? WHERE order_id = ?")
        .run(startAt, endAt, reservation.record.id);
    });
    await assert.rejects(store.createSwapQuote(
      context("m8-peak-a", "m8-peak-quote", "m8-peak-quote-payload"),
      parseCreateSwapQuote({
        offered: { listingVersionId: offered.listing.id, rateUnits: 1, startAt, endAt },
        wanted: { listingVersionId: wanted.listing.id, rateUnits: 1, startAt, endAt },
      }),
    ));
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_swap_quotes").get().count, 0);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_swap_quote_snapshots").get().count, 0);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'CREATE_SWAP_QUOTE'")
      .get().count, 0);
  } finally {
    d1.db.close();
  }
});

test("M8-C checkout records exactly one referral decision for every outcome", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m8-referral-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const supplier = "m8-ref-supplier";
  const { lot, listing } = await publishedTokenListing(store, supplier, "m8-ref", 2_000);
  const agentCode = (await store.generateReferralCode(
    context("m8-ref-agent", "m8-ref-agent-code", "m8-ref-code-payload"),
    parseGenerateReferralCode({}),
  )).record;
  const supplierCode = (await store.generateReferralCode(
    context(supplier, "m8-ref-supplier-code", "m8-ref-supplier-code-payload"),
    parseGenerateReferralCode({}),
  )).record;
  const buyerCode = (await store.generateReferralCode(
    context("m8-ref-self-buyer", "m8-ref-buyer-code", "m8-ref-buyer-code-payload"),
    parseGenerateReferralCode({}),
  )).record;
  const cases = [
    ["NONE", "m8-ref-none-buyer", { resolvedCodeId: null, submittedCodeDigest: null }],
    ["INVALID", "m8-ref-invalid-buyer", await store.resolveReferralCode("KAI-AG-NOT-FOUND")],
    ["SELF_BUYER", "m8-ref-self-buyer", await store.resolveReferralCode(buyerCode.code)],
    ["SELF_SUPPLIER", "m8-ref-self-supplier-buyer", await store.resolveReferralCode(supplierCode.code)],
    ["APPLIED", "m8-ref-applied-buyer", await store.resolveReferralCode(agentCode.code)],
  ];
  const orders = [];
  for (const [index, [expectedOutcome, buyer, referral]] of cases.entries()) {
    const startAt = new Date(Date.parse(lot.startAt) + index * 60 * 60 * 1_000).toISOString();
    const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
    const order = (await store.createCheckout(
      context(buyer, `m8-ref-order-${index}`, `m8-ref-order-${index}-payload`),
      parseCreateCheckout({
        listingVersionId: listing.id, rateUnits: 1_000, startAt, endAt,
        interruptibility: "NON_INTERRUPTIBLE",
      }),
      referral,
    )).record;
    assert.equal(order.referralDecision.outcome, expectedOutcome);
    assert.equal(Boolean(order.referralAttribution), expectedOutcome === "APPLIED");
    orders.push(order);
  }
  await assert.rejects(
    store.createCheckout(
      context("m8-ref-none-buyer", "m8-ref-order-0", "m8-ref-order-0-different-referral-payload"),
      parseCreateCheckout({
        listingVersionId: listing.id,
        rateUnits: 1_000,
        startAt: lot.startAt,
        endAt: new Date(Date.parse(lot.startAt) + 60 * 60 * 1_000).toISOString(),
        interruptibility: "NON_INTERRUPTIBLE",
      }),
      await store.resolveReferralCode(agentCode.code),
    ),
    (error) => error instanceof ExchangeIdempotencyConflictError,
  );
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_referral_decisions").get().count, cases.length);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_referral_attributions").get().count, 1);
    assert.equal((await store.listReferralAttributions("m8-ref-agent")).length, 1);
    assert.equal((await store.listReferralAttributions(supplier)).length, 0);
    assert.throws(
      () => db.prepare("UPDATE exchange_referral_decisions SET outcome = 'NONE' WHERE order_id = ?")
        .run(orders.at(-1).id),
      /EXCHANGE_REFERRAL_DECISION_IMMUTABLE/u,
    );
    db.exec("DROP TRIGGER exchange_referral_attributions_immutable_delete");
    db.prepare("DELETE FROM exchange_referral_attributions WHERE order_id = ?").run(orders.at(-1).id);
    await assert.rejects(
      store.getOrder("m8-ref-applied-buyer", orders.at(-1).id, "buyer"),
      /EXCHANGE_INVARIANT_CORRUPTION:(REFERRAL_ATTRIBUTION_CARDINALITY_INVALID|REFERRAL_FACTS_INVALID)/u,
    );
  } finally {
    db.close();
  }
});

test("M8-C APPLIED referral accrues one TEST estimate atomically without changing settlement ledger", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m8-commission-${crypto.randomUUID()}.sqlite`);
  let serverNowMs = Date.now();
  const store = createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
  const code = (await store.generateReferralCode(
    context("m8-commission-agent", "m8-commission-code", "m8-commission-code-payload"),
    parseGenerateReferralCode({}),
  )).record;
  const referral = await store.resolveReferralCode(code.code);
  const db = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    const { settled } = await completeTokenClose(
      store,
      db,
      "m8-commission-close",
      (value) => { serverNowMs = value; },
      referral,
    );
    assert.ok(settled.commission);
    assert.equal(settled.commission.environment, "TEST");
    assert.equal(settled.commission.recordKind, "ESTIMATE_ONLY");
    assert.equal(settled.commission.commissionBaseCents, settled.grossAmountCents);
    assert.equal(settled.commission.commissionRateBasisPoints, 300);
    assert.equal(settled.commission.commissionEstimateCents, Math.floor(settled.grossAmountCents * 300 / 10_000));
    assert.equal(settled.commission.fundsMoved, false);
    assert.equal((await store.listCommissionAccruals("m8-commission-agent")).length, 1);
    const ledger = db.prepare(`SELECT
      SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END) AS debits,
      SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END) AS credits
      FROM exchange_ledger_entries WHERE settlement_id = ?`).get(settled.id);
    assert.equal(ledger.debits, settled.grossAmountCents);
    assert.equal(ledger.credits, settled.grossAmountCents);
    const replay = await store.testRecordSettlement(
      settled.id,
      context("m8-commission-close-ops", "m8-commission-close-settle", "m8-commission-close-settle"),
      parseTestRecordSettlement({ expectedVersion: 1 }),
    );
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.record.commission, settled.commission);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM exchange_commission_accruals WHERE settlement_id = ?")
      .get(settled.id).count, 1);
    db.prepare(`DELETE FROM exchange_domain_events
      WHERE entity_type = 'SETTLEMENT' AND entity_id = ? AND event_type = 'TEST_SETTLEMENT_RECORDED'`)
      .run(settled.id);
    await assert.rejects(
      store.testRecordSettlement(
        settled.id,
        context("m8-commission-close-ops", "m8-commission-close-settle", "m8-commission-close-settle"),
        parseTestRecordSettlement({ expectedVersion: 1 }),
      ),
      /EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_REPLAY_FACTS_INVALID/u,
    );
  } finally {
    db.close();
  }
});

test("M8-C D1 writes the APPLIED commission in the settlement batch and rolls back a missing accrual write", async () => {
  for (const mode of ["positive", "commission-zero-row"]) {
    const d1 = d1BackedBySqlite();
    let serverNowMs = Date.now();
    const store = createD1ExchangeStore(d1.adapter, () => new Date(serverNowMs));
    try {
      const agent = `m8-d1-commission-${mode}-agent`;
      const code = (await store.generateReferralCode(
        context(agent, `m8-d1-${mode}-code`, `m8-d1-${mode}-code-payload`),
        parseGenerateReferralCode({}),
      )).record;
      const referral = await store.resolveReferralCode(code.code);
      let eligibleSettlement;
      const run = completeTokenClose(
        store,
        d1.db,
        `m8-d1-commission-${mode}`,
        (value) => { serverNowMs = value; },
        referral,
        (settlement) => {
          eligibleSettlement = settlement;
          if (mode === "commission-zero-row") d1.adapter.zeroNextBatchStatement(4);
        },
      );
      if (mode === "positive") {
        const { settled } = await run;
        assert.equal(settled.commission.agentActorId, agent);
        assert.equal(settled.commission.commissionEstimateCents, 6);
        assert.equal(settled.commission.fundsMoved, false);
        assert.equal((await store.listCommissionAccruals(agent)).length, 1);
      } else {
        await assert.rejects(run);
        assert.ok(eligibleSettlement);
        const settlementRow = d1.db.prepare("SELECT status, version, ledger_batch_id FROM exchange_settlements WHERE id = ?")
          .get(eligibleSettlement.id);
        assert.deepEqual(
          { ...settlementRow },
          { status: "ELIGIBLE", version: eligibleSettlement.version, ledger_batch_id: null },
        );
        assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_commission_accruals WHERE settlement_id = ?")
          .get(eligibleSettlement.id).count, 0);
        assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_ledger_batches WHERE settlement_id = ?")
          .get(eligibleSettlement.id).count, 0);
        assert.equal(d1.db.prepare(`SELECT COUNT(*) AS count FROM exchange_domain_events
          WHERE entity_id = ? AND event_type = 'TEST_SETTLEMENT_RECORDED'`).get(eligibleSettlement.id).count, 0);
        assert.equal(d1.db.prepare(`SELECT COUNT(*) AS count FROM exchange_command_receipts
          WHERE entity_id = ? AND command_type = 'TEST_RECORD_SETTLEMENT'`).get(eligibleSettlement.id).count, 0);
      }
    } finally {
      d1.db.close();
    }
  }
});

test("M8-C D1 missing referral decision rolls the entire checkout batch back", async () => {
  const d1 = d1BackedBySqlite();
  const store = createD1ExchangeStore(d1.adapter);
  try {
    const { lot, listing } = await publishedTokenListing(store, "m8-ref-zero-supplier", "m8-ref-zero", 2_000);
    const startAt = lot.startAt;
    const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
    d1.adapter.zeroNextBatchStatement(5);
    await assert.rejects(store.createCheckout(
      context("m8-ref-zero-buyer", "m8-ref-zero-order", "m8-ref-zero-order-payload"),
      parseCreateCheckout({
        listingVersionId: listing.id, rateUnits: 1_000, startAt, endAt,
        interruptibility: "NON_INTERRUPTIBLE",
      }),
      { resolvedCodeId: null, submittedCodeDigest: null },
    ));
    for (const table of [
      "exchange_orders", "exchange_reservations", "exchange_referral_decisions",
      "exchange_referral_attributions", "exchange_order_contract_snapshots",
    ]) assert.equal(d1.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    assert.equal(d1.db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_transfers WHERE order_id IS NOT NULL")
      .get().count, 0);
  } finally {
    d1.db.close();
  }
});

test("M8-R1 withdrawal reason is frozen at 4..300 characters", () => {
  for (const length of [4, 300]) {
    assert.equal(parseWithdrawCapacityLot({ expectedVersion: 1, reason: "x".repeat(length) }).reason.length, length);
  }
  for (const length of [3, 301]) {
    assert.throws(
      () => parseWithdrawCapacityLot({ expectedVersion: 1, reason: "x".repeat(length) }),
      (error) => error instanceof ExchangeInputError && error.field === "reason",
    );
  }
});

test("M8-R1 v10 lots with accounting schemas 1, 2 and 3 withdraw without version rewriting in SQLite and D1", async () => {
  const sourcePath = join(tmpdir(), `kai-cloud-m8-old-accounting-source-${crypto.randomUUID()}.sqlite`);
  const sourceStore = createSqliteExchangeStore(sourcePath);
  const seeded = [];
  for (const version of [1, 2, 3]) {
    const supplier = `m8-old-accounting-${version}-supplier`;
    const facts = await readyLotForProduct(sourceStore, supplier, `m8-old-accounting-${version}`, "GPU_COMPUTE");
    seeded.push({ version, supplier, ...facts });
  }
  const sourceDb = new DatabaseSync(sourcePath, { enableForeignKeyConstraints: true });
  try {
    for (const variant of ["sqlite", "d1"]) {
      const targetPath = join(tmpdir(), `kai-cloud-m8-old-accounting-${variant}-${crypto.randomUUID()}.sqlite`);
      const target = variant === "d1"
        ? d1BackedBySqlite()
        : { db: new DatabaseSync(targetPath, { enableForeignKeyConstraints: true }), adapter: null };
      for (const fileName of migrationsThroughV10) applyExchangeMigrationFile(target.db, fileName);
      for (const item of seeded) {
        copyRowUsingSharedColumns(sourceDb, target.db, "exchange_resource_assets", "id = ?", [item.resource.id]);
        copyRowUsingSharedColumns(sourceDb, target.db, "exchange_verification_runs", "id = ?", [item.verification.id]);
        copyRowUsingSharedColumns(sourceDb, target.db, "exchange_capacity_lots", "id = ?", [item.lot.id], {
          accounting_schema_version: item.version,
        });
        copyRowUsingSharedColumns(sourceDb, target.db, "exchange_capacity_transfers", "capacity_lot_id = ?", [item.lot.id], {
          accounting_schema_version: item.version,
        });
      }
      if (variant === "d1") applyExchangeMigrationFile(target.db, "0011_withdraw_swap_commission.sql");
      else target.db.close();
      const store = variant === "d1" ? createD1ExchangeStore(target.adapter) : createSqliteExchangeStore(targetPath);
      const audit = variant === "d1" ? target.db : new DatabaseSync(targetPath, { enableForeignKeyConstraints: true });
      try {
        for (const item of seeded) {
          const mutationContext = context(item.supplier, `m8-old-${variant}-${item.version}`, `m8-old-${variant}-${item.version}-payload`);
          const input = parseWithdrawCapacityLot({
            expectedVersion: item.lot.version,
            reason: `Withdraw pristine accounting schema ${item.version}.`,
          });
          const result = await store.withdrawCapacityLot(item.lot.id, mutationContext, input);
          assert.equal(result.record.capacityLotId, item.lot.id, `${variant}-v${item.version}`);
          assert.equal(audit.prepare("SELECT accounting_schema_version FROM exchange_capacity_withdrawals WHERE id = ?")
            .get(result.record.id).accounting_schema_version, item.version, `${variant}-v${item.version}`);
          assert.deepEqual(
            audit.prepare("SELECT DISTINCT accounting_schema_version FROM exchange_capacity_transfers WHERE capacity_lot_id = ?")
              .all(item.lot.id).map((row) => row.accounting_schema_version),
            [item.version],
            `${variant}-v${item.version}`,
          );
          assert.equal((await store.withdrawCapacityLot(item.lot.id, mutationContext, input)).replayed, true);
        }
      } finally {
        audit.close();
      }
    }
  } finally {
    sourceDb.close();
  }
});

test("M8-R1 SQLite and D1 withdrawal replay rejects missing, extra and contradictory transfer history", async () => {
  for (const variant of ["sqlite", "d1"]) {
    for (const corruption of ["missing", "extra", "contradictory"]) {
      const databasePath = join(tmpdir(), `kai-cloud-m8-withdraw-history-${variant}-${corruption}-${crypto.randomUUID()}.sqlite`);
      const d1 = variant === "d1" ? d1BackedBySqlite() : null;
      const store = variant === "d1" ? createD1ExchangeStore(d1.adapter) : createSqliteExchangeStore(databasePath);
      const supplier = `m8-history-${variant}-${corruption}-supplier`;
      const { lot } = await readyLotForProduct(store, supplier, `m8-history-${variant}-${corruption}`, "GPU_COMPUTE");
      const mutationContext = context(supplier, `m8-history-${variant}-${corruption}`, `m8-history-${variant}-${corruption}-payload`);
      const input = parseWithdrawCapacityLot({ expectedVersion: lot.version, reason: "Withdraw this pristine capacity lot." });
      await store.withdrawCapacityLot(lot.id, mutationContext, input);
      const db = d1?.db ?? new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
      try {
        if (corruption === "missing") {
          db.exec("DROP TRIGGER exchange_capacity_transfers_immutable_delete");
          db.prepare("DELETE FROM exchange_capacity_transfers WHERE capacity_lot_id = ? AND reason = 'CAPACITY_LOT_CREATED'")
            .run(lot.id);
        } else if (corruption === "extra") {
          const lotRow = db.prepare("SELECT * FROM exchange_capacity_lots WHERE id = ?").get(lot.id);
          db.prepare(`INSERT INTO exchange_capacity_transfers (
            id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
            rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at, accounting_schema_version
          ) VALUES (?, ?, NULL, ?, 'ISSUED', 'AVAILABLE', ?, ?, ?, 'CORRUPT_EXTRA_ISSUE', ?, ?)`)
            .run(`KAI-CT-CORRUPT-${crypto.randomUUID()}`, lot.id, `corrupt:${crypto.randomUUID()}`,
              lotRow.rate_unit_code, lotRow.capacity_base_units, lotRow.capacity_gpu_seconds,
              new Date().toISOString(), lotRow.accounting_schema_version);
        } else {
          db.exec("DROP TRIGGER exchange_capacity_transfers_immutable_update");
          db.prepare("UPDATE exchange_capacity_transfers SET reason = 'CORRUPT_INITIAL_FACT' WHERE capacity_lot_id = ? AND reason = 'CAPACITY_LOT_CREATED'")
            .run(lot.id);
        }
        await assert.rejects(
          store.withdrawCapacityLot(lot.id, mutationContext, input),
          /EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_WITHDRAWAL_REPLAY/u,
          `${variant}-${corruption}`,
        );
      } finally {
        db.close();
      }
    }
  }
});

test("M8-R1 SQLite revalidates exact peak inventory after asynchronous quote construction", async () => {
  const databasePath = join(tmpdir(), `kai-cloud-m8-sqlite-swap-race-${crypto.randomUUID()}.sqlite`);
  const store = createSqliteExchangeStore(databasePath);
  const offered = await publishedGpuListing(store, "m8-sqlite-race-a", "m8-sqlite-race-a", 4);
  const wanted = await publishedModelListing(store, "m8-sqlite-race-b", "m8-sqlite-race-b", 4);
  const startAt = offered.lot.startAt > wanted.lot.startAt ? offered.lot.startAt : wanted.lot.startAt;
  const endAt = new Date(Date.parse(startAt) + 60 * 60 * 1_000).toISOString();
  const laterStart = new Date(Date.parse(startAt) + 3 * 60 * 60 * 1_000).toISOString();
  const laterEnd = new Date(Date.parse(laterStart) + 60 * 60 * 1_000).toISOString();
  const reservation = await store.createCheckout(
    context("m8-sqlite-race-buyer", "m8-sqlite-race-checkout", "m8-sqlite-race-checkout-payload"),
    parseCreateCheckout({
      listingVersionId: offered.listing.id, parallelUnits: 4,
      startAt: laterStart, endAt: laterEnd, interruptibility: "NON_INTERRUPTIBLE",
    }),
  );
  const quotePromise = store.createSwapQuote(
    context("m8-sqlite-race-a", "m8-sqlite-race-quote", "m8-sqlite-race-quote-payload"),
    parseCreateSwapQuote({
      offered: { listingVersionId: offered.listing.id, rateUnits: 1, startAt, endAt },
      wanted: { listingVersionId: wanted.listing.id, rateUnits: 1, startAt, endAt },
    }),
  );
  const concurrent = new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
  try {
    concurrent.prepare("UPDATE exchange_reservations SET start_at = ?, end_at = ? WHERE order_id = ?")
      .run(startAt, endAt, reservation.record.id);
    await assert.rejects(
      quotePromise,
      (error) => error instanceof ExchangeDomainError && error.code === "EXCHANGE_CAPACITY_CONFLICT",
    );
    assert.equal(concurrent.prepare("SELECT COUNT(*) AS count FROM exchange_swap_quotes").get().count, 0);
    assert.equal(concurrent.prepare("SELECT COUNT(*) AS count FROM exchange_swap_quote_snapshots").get().count, 0);
    assert.equal(concurrent.prepare("SELECT COUNT(*) AS count FROM exchange_command_receipts WHERE command_type = 'CREATE_SWAP_QUOTE'")
      .get().count, 0);
  } finally {
    concurrent.close();
  }
});

test("M8-R1 SQLite and D1 schema signatures require every swap, referral and commission immutable trigger", async () => {
  const immutableTriggers = [
    "exchange_swap_quotes_immutable_update", "exchange_swap_quotes_immutable_delete",
    "exchange_swap_quote_snapshots_immutable_update", "exchange_swap_quote_snapshots_immutable_delete",
    "exchange_swap_quote_status_events_immutable_update", "exchange_swap_quote_status_events_immutable_delete",
    "exchange_referral_codes_immutable_update", "exchange_referral_codes_immutable_delete",
    "exchange_referral_decisions_immutable_update", "exchange_referral_decisions_immutable_delete",
    "exchange_referral_attributions_immutable_update", "exchange_referral_attributions_immutable_delete",
    "exchange_commission_accruals_immutable_update", "exchange_commission_accruals_immutable_delete",
  ];
  const sqlite = new DatabaseSync(":memory:", { enableForeignKeyConstraints: true });
  try {
    ensureSqliteExchangeSchema(sqlite);
    for (const trigger of immutableTriggers) {
      const definition = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger)?.sql;
      assert.ok(definition, trigger);
      sqlite.exec(`DROP TRIGGER ${trigger}`);
      assert.throws(() => ensureSqliteExchangeSchema(sqlite), /EXCHANGE_SCHEMA_SIGNATURE_INVALID/u, trigger);
      sqlite.exec(definition);
    }
  } finally {
    sqlite.close();
  }
  const d1 = d1BackedBySqlite();
  try {
    await createD1ExchangeStore(d1.adapter).listProductVersions();
    for (const trigger of immutableTriggers) {
      const definition = d1.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(trigger)?.sql;
      assert.ok(definition, trigger);
      d1.db.exec(`DROP TRIGGER ${trigger}`);
      await assert.rejects(
        createD1ExchangeStore(d1.adapter).listProductVersions(),
        /EXCHANGE_SCHEMA_SIGNATURE_INVALID/u,
        trigger,
      );
      d1.db.exec(definition);
    }
  } finally {
    d1.db.close();
  }
});

test("M8-R1 SQLite and D1 replay referral settlement commission chain fails closed on actor, amount, extra and missing facts", async () => {
  for (const variant of ["sqlite", "d1"]) {
    const databasePath = join(tmpdir(), `kai-cloud-m8-chain-${variant}-${crypto.randomUUID()}.sqlite`);
    const d1 = variant === "d1" ? d1BackedBySqlite() : null;
    let serverNowMs = Date.now();
    const store = variant === "d1"
      ? createD1ExchangeStore(d1.adapter, () => new Date(serverNowMs))
      : createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
    const scope = `m8-chain-${variant}`;
    const code = (await store.generateReferralCode(
      context(`${scope}-agent`, `${scope}-code`, `${scope}-code-payload`),
      parseGenerateReferralCode({}),
    )).record;
    const referral = await store.resolveReferralCode(code.code);
    const db = d1?.db ?? new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
    try {
      const { settled } = await completeTokenClose(store, db, scope, (value) => { serverNowMs = value; }, referral);
      const settlementContext = context(`${scope}-ops`, `${scope}-settle`);
      const settlementInput = parseTestRecordSettlement({ expectedVersion: 1 });
      const commission = db.prepare("SELECT * FROM exchange_commission_accruals WHERE settlement_id = ?").get(settled.id);
      db.exec("DROP TRIGGER exchange_referral_codes_immutable_update");
      db.prepare("UPDATE exchange_referral_codes SET agent_actor_id = ? WHERE id = ?")
        .run(`${scope}-wrong-code-owner`, code.id);
      await assert.rejects(store.testRecordSettlement(settled.id, settlementContext, settlementInput),
        /EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_FACTS_INVALID/u,
        `${variant}-resolved-code-actor`);
      db.prepare("UPDATE exchange_referral_codes SET agent_actor_id = ? WHERE id = ?")
        .run(`${scope}-agent`, code.id);
      db.exec("DROP TRIGGER exchange_commission_accruals_immutable_update");

      db.prepare("UPDATE exchange_commission_accruals SET agent_actor_id = ? WHERE id = ?")
        .run(`${scope}-wrong-agent`, commission.id);
      await assert.rejects(store.testRecordSettlement(settled.id, settlementContext, settlementInput),
        /EXCHANGE_INVARIANT_CORRUPTION:(COMMISSION_ASSOCIATION_INVALID|REFERRAL|COMMISSION_ACCRUAL_FACTS_INVALID)/u,
        `${variant}-actor`);
      db.prepare("UPDATE exchange_commission_accruals SET agent_actor_id = ? WHERE id = ?")
        .run(commission.agent_actor_id, commission.id);

      db.exec("PRAGMA ignore_check_constraints = ON");
      db.prepare("UPDATE exchange_commission_accruals SET commission_estimate_cents = commission_estimate_cents + 1 WHERE id = ?")
        .run(commission.id);
      await assert.rejects(store.testRecordSettlement(settled.id, settlementContext, settlementInput),
        /EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_ACCRUAL_FACTS_INVALID/u,
        `${variant}-amount`);
      db.prepare("UPDATE exchange_commission_accruals SET commission_estimate_cents = ? WHERE id = ?")
        .run(commission.commission_estimate_cents, commission.id);
      db.exec("PRAGMA ignore_check_constraints = OFF");

      const extraEventId = `KAI-EV-CORRUPT-${crypto.randomUUID()}`;
      db.prepare(`INSERT INTO exchange_domain_events (
        id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
      ) VALUES (?, ?, 'SETTLEMENT', ?, 'TEST_SETTLEMENT_RECORDED', '{}', ?)`)
        .run(extraEventId, `${scope}-ops`, settled.id, new Date().toISOString());
      await assert.rejects(store.testRecordSettlement(settled.id, settlementContext, settlementInput),
        /EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_REPLAY_FACTS_INVALID/u,
        `${variant}-extra`);
      db.prepare("DELETE FROM exchange_domain_events WHERE id = ?").run(extraEventId);

      db.exec("DROP TRIGGER exchange_commission_accruals_immutable_delete");
      db.prepare("DELETE FROM exchange_commission_accruals WHERE id = ?").run(commission.id);
      await assert.rejects(store.testRecordSettlement(settled.id, settlementContext, settlementInput),
        /EXCHANGE_INVARIANT_CORRUPTION:COMMISSION_CARDINALITY_INVALID/u,
        `${variant}-missing`);
    } finally {
      db.close();
    }
  }
});

async function completeGpuSettlementWithTwoCredits(store, scope, setServerNow) {
  const { buyer, order } = await deliveredOrder(store, scope);
  setServerNow(Date.parse(order.startAt) + 60 * 60 * 1_000);
  const started = await store.testStartService(
    order.id,
    context(`${scope}-ops`, `${scope}-ledger-start`),
    parseTestServiceStart({ expectedVersion: order.metering.version }),
  );
  setServerNow(Date.parse(order.endAt) + 1_000);
  const completed = await store.testCompleteMetering(
    order.id,
    context(`${scope}-ops`, `${scope}-ledger-final`),
    parseTestMeterComplete({ expectedVersion: started.record.metering.version }),
  );
  const accepted = await store.submitAcceptance(
    order.id,
    context(buyer, `${scope}-ledger-accept`),
    parseSubmitOrderAcceptance({
      expectedVersion: completed.record.acceptance.version,
      decision: "ACCEPT",
      reason: "Accept the verified capacity window and exact settlement facts.",
      evidenceDigest: TEST_SHA256,
    }),
  );
  const settlementContext = context(`${scope}-ops`, `${scope}-ledger-settle`);
  const settlementInput = parseTestRecordSettlement({ expectedVersion: accepted.record.settlement.version });
  const mutation = await store.testRecordSettlement(
    accepted.record.settlement.id,
    settlementContext,
    settlementInput,
  );
  assert.ok(mutation.record.netSupplierPayableCents > 1, scope);
  assert.ok(mutation.record.baseCreditCents + mutation.record.disputeCreditCents > 1, scope);
  return { settlement: mutation.record, settlementContext, settlementInput };
}

test("M8-R2 SQLite and D1 settlement replay requires the exact three-line TEST ledger projection", async () => {
  for (const variant of ["sqlite", "d1"]) {
    for (const corruption of ["wrong-account", "wrong-side", "credit-redistribution", "missing", "multiple"]) {
      const scope = `m8-r2-${variant}-${corruption}`;
      const databasePath = join(tmpdir(), `kai-cloud-${scope}-${crypto.randomUUID()}.sqlite`);
      const d1 = variant === "d1" ? d1BackedBySqlite() : null;
      let serverNowMs = Date.now();
      const store = variant === "d1"
        ? createD1ExchangeStore(d1.adapter, () => new Date(serverNowMs))
        : createSqliteExchangeStore(databasePath, () => new Date(serverNowMs));
      const db = d1?.db ?? new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
      try {
        const { settlement, settlementContext, settlementInput } = await completeGpuSettlementWithTwoCredits(
          store,
          scope,
          (value) => { serverNowMs = value; },
        );
        const entries = db.prepare("SELECT * FROM exchange_ledger_entries WHERE settlement_id = ? ORDER BY account_code")
          .all(settlement.id);
        assert.equal(entries.length, 3, `${variant}-${corruption}`);
        const clearing = entries.find((entry) => entry.account_code === "TEST_BUYER_SETTLEMENT_CLEARING");
        const supplier = entries.find((entry) => entry.account_code === "TEST_SUPPLIER_PAYABLE");
        const buyer = entries.find((entry) => entry.account_code === "TEST_BUYER_CREDIT");
        assert.ok(clearing && supplier && buyer, `${variant}-${corruption}`);

        if (corruption === "wrong-account") {
          db.prepare("UPDATE exchange_ledger_entries SET account_code = 'TEST_SUPPLIER_PAYABLE' WHERE id = ?")
            .run(clearing.id);
        } else if (corruption === "wrong-side") {
          db.prepare("UPDATE exchange_ledger_entries SET side = 'DEBIT' WHERE id = ?").run(supplier.id);
        } else if (corruption === "credit-redistribution") {
          db.prepare("UPDATE exchange_ledger_entries SET amount_cents = amount_cents - 1 WHERE id = ?").run(supplier.id);
          db.prepare("UPDATE exchange_ledger_entries SET amount_cents = amount_cents + 1 WHERE id = ?").run(buyer.id);
        } else if (corruption === "missing") {
          db.prepare("DELETE FROM exchange_ledger_entries WHERE id = ?").run(buyer.id);
        } else {
          db.prepare(`INSERT INTO exchange_ledger_entries (
            id, batch_id, settlement_id, account_code, side, amount_cents, created_at
          ) VALUES (?, ?, ?, 'TEST_BUYER_CREDIT', 'CREDIT', ?, ?)`)
            .run(`KAI-LE-CORRUPT-${crypto.randomUUID()}`, buyer.batch_id, settlement.id, buyer.amount_cents, new Date().toISOString());
        }

        await assert.rejects(
          store.testRecordSettlement(settlement.id, settlementContext, settlementInput),
          /EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_LEDGER_PROJECTION_INVALID/u,
          `${variant}-${corruption}`,
        );
      } finally {
        db.close();
      }
    }
  }
});
