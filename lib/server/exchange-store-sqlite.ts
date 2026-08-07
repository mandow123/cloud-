import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  exchangeSchemaStatements,
  exchangeSeedStatements,
  EXCHANGE_SCHEMA_VERSION,
  EXCHANGE_SCHEMA_VERSIONS,
} from "../../db/exchange-schema.ts";
import {
  createExchangeId,
  deriveCommissionEstimateCents,
  isLegacyGpuCreateInput,
  type ApplyPaymentEvent,
  type MarketListing,
  type SubmitOrderAcceptance,
  type TestMeterComplete,
  type TestRecordSettlement,
  type TestServiceStart,
} from "../exchange.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError } from "./exchange-errors.ts";
import {
  eventId,
  mapCapacityLot,
  mapCapacityWithdrawal,
  mapListing,
  mapOrder,
  mapConnectionCheck,
  mapSettlement,
  mapSwapQuote,
  mapDeliveryPackage,
  mapProduct,
  mapOrderContractSnapshot,
  mapResource,
  mapVerification,
  maximumConcurrentRateUnits,
  capacityDescriptor,
  newCapacityLot,
  newListing,
  newCheckoutRecords,
  newResource,
  newVerification,
  type CapacityLotRow,
  type CapacityWithdrawalRow,
  type ListingRow,
  type OrderRow,
  type ProductRow,
  type ResourceRow,
  type ReservationRow,
  type VerificationRow,
  type OrderLifecycleRow,
  type PaymentIntentRow,
  type DeliveryTaskRow,
  type PaymentEventRow,
  type DeliveryPackageRow,
  type DeliveryReviewRow,
  type DeliveryClaimRow,
  type ConnectionCheckRow,
  type MeteringSessionRow,
  type AcceptanceRow,
  type SettlementRow,
  type SettlementLedgerBatchRow,
  type SettlementLedgerEntryRow,
  type SwapQuoteRow,
  type SwapQuoteSnapshotRow,
  type SwapQuoteStatusEventRow,
  type OrderContractSnapshotRow,
  type ProductCapacityPolicyRow,
  type ReferralCodeRow,
  type ReferralDecisionRow,
  type ReferralAttributionRow,
  type CommissionAccrualRow,
  mapReferralCode,
  mapReferralAttribution,
  mapCommissionAccrual,
  assertReferralFacts,
  assertSettlementCommissionFacts,
  assertExactTestSettlementLedger,
} from "./exchange-records.ts";
import type { ExchangeStore } from "./exchange-store.ts";
import {
  assertSwapListingFact,
  buildSwapQuote,
  verifySwapQuoteDigests,
  type SwapListingFact,
} from "./exchange-store-swap.ts";

type SqliteExchangeStore = ExchangeStore & Required<Pick<ExchangeStore,
  "listOpsMeteringOrders" | "testStartService" | "testCompleteMetering" | "submitAcceptance" | "testRecordSettlement"
>>;

function openDatabase(overridePath?: string) {
  const dataDirectory = process.env.KAI_DB_DIR || process.env.KAI_DATA_DIR || join(process.cwd(), ".market-cache", "marketplace");
  const databasePath = overridePath ?? join(dataDirectory, "kai-cloud.sqlite");
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  return new DatabaseSync(databasePath, { enableForeignKeyConstraints: true });
}

function exchangeTableExists(db: DatabaseSync, tableName: string) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function readExchangeSchemaVersions(db: DatabaseSync) {
  return (db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version ASC").all() as Array<{ version: number }>)
    .map((row) => Number(row.version));
}

function assertKnownHistory(versions: number[], latest: number) {
  if (versions.length === 0 || versions.at(-1) !== latest
    || versions.some((version, index) => !EXCHANGE_SCHEMA_VERSIONS.includes(version as typeof EXCHANGE_SCHEMA_VERSIONS[number])
      || (index > 0 && version <= versions[index - 1]))) {
    throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
  }
}

function sqliteObjectNames(db: DatabaseSync, type: "table" | "index" | "trigger") {
  return new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name LIKE 'exchange_%'`).all(type) as Array<{ name: string }>)
    .map((row) => row.name));
}

function sqliteColumnMap(db: DatabaseSync, table: string) {
  return new Map((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>)
    .map((column) => [column.name, column]));
}

function assertCommonExchangeObjects(db: DatabaseSync) {
  const tables = sqliteObjectNames(db, "table");
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
    "exchange_product_capacity_policies", "exchange_order_contract_snapshots", "exchange_meter_intervals", "exchange_meter_evidence",
  ]) if (!tables.has(table)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const triggers = sqliteObjectNames(db, "trigger");
  for (const trigger of [
    "exchange_product_versions_immutable_update", "exchange_product_versions_immutable_delete",
    "exchange_product_capacity_policies_immutable_update", "exchange_product_capacity_policies_immutable_delete",
    "exchange_order_contract_snapshots_immutable_update", "exchange_order_contract_snapshots_immutable_delete",
    "exchange_meter_intervals_no_overlap", "exchange_meter_intervals_immutable_update",
    "exchange_meter_intervals_immutable_delete", "exchange_meter_evidence_observed_within_interval",
    "exchange_meter_evidence_immutable_update", "exchange_meter_evidence_immutable_delete",
  ]) if (!triggers.has(trigger)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  if ((db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get() as { count: number }).count !== 0) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

function assertSqliteV7Signature(db: DatabaseSync) {
  assertCommonExchangeObjects(db);
  const lot = sqliteColumnMap(db, "exchange_capacity_lots");
  const order = sqliteColumnMap(db, "exchange_orders");
  const metering = sqliteColumnMap(db, "exchange_metering_sessions");
  if (!lot.has("parallel_units") || !lot.has("capacity_gpu_seconds") || lot.has("rate_unit_code")
    || !order.has("unit_price_cents") || order.has("unit_price_micros") || order.has("capacity_base_units")
    || !metering.has("scheduled_gpu_seconds") || metering.has("scheduled_capacity_base_units")) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

function assertSqliteV8Signature(db: DatabaseSync) {
  assertCommonExchangeObjects(db);
  const required = new Map([
    ["exchange_capacity_lots", ["rate_unit_code", "rate_units", "capacity_base_units", "accounting_schema_version"]],
    ["exchange_listing_versions", ["rate_unit_code", "unit_price_micros", "min_rate_units", "max_rate_units", "accounting_schema_version"]],
    ["exchange_orders", ["rate_unit_code", "rate_units", "capacity_base_units", "unit_price_micros", "accounting_schema_version"]],
    ["exchange_reservations", ["rate_unit_code", "rate_units", "capacity_base_units", "accounting_schema_version"]],
    ["exchange_capacity_transfers", ["rate_unit_code", "capacity_base_units", "accounting_schema_version"]],
    ["exchange_metering_sessions", ["rate_unit_code", "reserved_rate_units", "scheduled_capacity_base_units", "accounting_schema_version"]],
    ["exchange_service_facts", ["rate_unit_code", "available_capacity_base_units", "accounting_schema_version"]],
    ["exchange_metering_finals", ["rate_unit_code", "scheduled_capacity_base_units", "accounting_schema_version"]],
  ]);
  for (const [table, columns] of required) {
    const schema = sqliteColumnMap(db, table);
    if (columns.some((column) => !schema.has(column))) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  for (const [table, column] of [
    ["exchange_capacity_lots", "capacity_gpu_seconds"],
    ["exchange_orders", "capacity_gpu_seconds"],
    ["exchange_reservations", "capacity_gpu_seconds"],
    ["exchange_capacity_transfers", "capacity_gpu_seconds"],
    ["exchange_metering_sessions", "scheduled_gpu_seconds"],
    ["exchange_service_facts", "available_gpu_seconds"],
    ["exchange_metering_finals", "scheduled_gpu_seconds"],
  ] as const) {
    if (sqliteColumnMap(db, table).get(column)?.notnull !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

function assertSqliteV9Signature(db: DatabaseSync) {
  assertSqliteV8Signature(db);
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
  ]) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!row?.sql.includes("MILLI_M_TOKEN_PER_HOUR") || !row.sql.includes("accounting_schema_version IN (1, 2, 3)")) {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
}

function assertSqliteV10Signature(db: DatabaseSync) {
  assertSqliteV8Signature(db);
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
  ]) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!row?.sql.includes("GIB_STORAGE") || !row.sql.includes("RACK")
      || !row.sql.includes("accounting_schema_version IN (1, 2, 3, 4)")) {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
  for (const [table, signatures] of [
    ["exchange_product_capacity_policies", ["NAS_STORAGE", "RACK_SPACE", "NAS_VOLUME_ALLOCATION", "RACK_COLOCATION_ALLOCATION", "TIB_STORAGE"]],
    ["exchange_order_contract_snapshots", ["NAS_STORAGE", "RACK_SPACE", "GIB_STORAGE", "RACK_HOUR"]],
    ["exchange_meter_evidence", ["STORAGE_IDENTITY", "STORAGE_AVAILABILITY", "FACILITY_IDENTITY", "RACK_AVAILABILITY"]],
  ] as const) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!row || signatures.some((signature) => !row.sql.includes(signature))) {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
}

function assertSqliteV11Signature(db: DatabaseSync) {
  assertSqliteV10Signature(db);
  const transfer = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exchange_capacity_transfers'")
    .get() as { sql: string } | undefined;
  if (!transfer?.sql.includes("WITHDRAWN") || transfer.sql.includes("from_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN', 'WITHDRAWN')")) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const withdrawals = sqliteColumnMap(db, "exchange_capacity_withdrawals");
  for (const column of [
    "capacity_lot_id", "supplier_actor_id", "idempotency_key", "payload_hash",
    "expected_lot_version", "transfer_id", "rate_unit_code", "capacity_base_units", "capacity_gpu_seconds",
    "accounting_schema_version", "reason", "occurred_at",
  ]) if (!withdrawals.has(column)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const triggers = sqliteObjectNames(db, "trigger");
  for (const trigger of [
    "exchange_capacity_transfers_immutable_update", "exchange_capacity_transfers_immutable_delete",
    "exchange_capacity_withdrawals_fact_match", "exchange_capacity_withdrawals_immutable_update",
    "exchange_capacity_withdrawals_immutable_delete",
    "exchange_listing_versions_immutable_update", "exchange_listing_versions_immutable_delete",
    "exchange_swap_quote_status_events_transition", "exchange_swap_quotes_immutable_update",
    "exchange_swap_quotes_immutable_delete", "exchange_swap_quote_snapshots_immutable_update",
    "exchange_swap_quote_snapshots_immutable_delete", "exchange_swap_quote_status_events_immutable_update",
    "exchange_swap_quote_status_events_immutable_delete",
    "exchange_referral_attributions_fact_match", "exchange_commission_accruals_fact_match",
    "exchange_referral_codes_immutable_update", "exchange_referral_codes_immutable_delete",
    "exchange_referral_decisions_immutable_update", "exchange_referral_decisions_immutable_delete",
    "exchange_referral_attributions_immutable_update", "exchange_referral_attributions_immutable_delete",
    "exchange_commission_accruals_immutable_update", "exchange_commission_accruals_immutable_delete",
  ]) if (!triggers.has(trigger)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  for (const table of [
    "exchange_swap_quotes", "exchange_swap_quote_snapshots", "exchange_swap_quote_status_events",
    "exchange_referral_codes", "exchange_referral_decisions", "exchange_referral_attributions",
    "exchange_commission_accruals",
  ]) if (!sqliteObjectNames(db, "table").has(table)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const missingDecisions = db.prepare(`SELECT COUNT(*) AS count FROM exchange_orders orders
    LEFT JOIN exchange_referral_decisions decision ON decision.order_id = orders.id
    WHERE decision.id IS NULL`).get() as { count: number };
  if (missingDecisions.count !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
}

function assertSqliteA2Runtime(db: DatabaseSync) {
  if (!sqliteObjectNames(db, "trigger").has("exchange_order_contract_snapshots_terms_match")) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const model = db.prepare(`SELECT pv.form_factor, pv.specs_json, p.identity_spec_json
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id = 'PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1'
      AND p.id = 'PCP-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1'
      AND pv.product_code = 'MODEL_INSTANCE'
      AND p.rate_unit_code = 'MODEL_INSTANCE'
      AND p.pricing_unit_code = 'MODEL_INSTANCE_HOUR'`).get() as
    | { form_factor: string; specs_json: string; identity_spec_json: string }
    | undefined;
  if (!model || model.form_factor !== "MANAGED_MODEL_INSTANCE") throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const identity = JSON.parse(model.specs_json) as Record<string, unknown>;
  if (identity.registryId !== "deepseek-v4-pro-standard" || identity.provider !== "DeepSeek"
    || identity.canonicalModel !== "deepseek-v4-pro" || identity.modelRevision !== "v4-pro"
    || identity.serviceTier !== "standard-reasoning-switchable" || identity.contextBucket !== "default"
    || identity.regionScope !== "REGION_INDEPENDENT" || identity.quantization !== "PROVIDER_MANAGED") {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

function assertSqliteA3Runtime(db: DatabaseSync) {
  assertSqliteA2Runtime(db);
  const token = db.prepare(`SELECT pv.form_factor, pv.specs_json, p.identity_spec_json,
      p.price_basis_base_units
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id = 'PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1'
      AND p.id = 'PCP-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1'
      AND pv.product_code = 'TOKEN_THROUGHPUT'
      AND p.rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
      AND p.fulfillment_model = 'TOKEN_THROUGHPUT_RESERVATION'
      AND p.pricing_unit_code = 'M_TOKEN_CAPACITY_HOUR'`).get() as
    | { form_factor: string; specs_json: string; identity_spec_json: string; price_basis_base_units: number }
    | undefined;
  if (!token || token.form_factor !== "MANAGED_TOKEN_THROUGHPUT" || token.price_basis_base_units !== 3_600_000) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const identity = JSON.parse(token.specs_json) as Record<string, unknown>;
  const policyIdentity = JSON.parse(token.identity_spec_json) as Record<string, unknown>;
  for (const record of [identity, policyIdentity]) {
    if (record.registryId !== "deepseek-v4-pro-throughput-standard"
      || record.canonicalModel !== "deepseek-v4-pro" || record.modelRevision !== "v4-pro"
      || record.serviceTier !== "standard-reasoning-switchable" || record.contextBucket !== "default"
      || record.regionScope !== "REGION_INDEPENDENT" || record.quantization !== "PROVIDER_MANAGED"
      || record.throughputMetric !== "BILLABLE_INPUT_PLUS_OUTPUT_PER_HOUR"
      || record.tokenizer !== "PROVIDER_TOKENIZER" || record.formFactor !== "MANAGED_TOKEN_THROUGHPUT") {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
}

function assertSqliteM7Runtime(db: DatabaseSync) {
  assertSqliteA3Runtime(db);
  const rows = db.prepare(`SELECT pv.id, pv.form_factor, pv.specs_json, p.id AS policy_id,
      p.rate_unit_code, p.fulfillment_model, p.pricing_unit_code, p.rate_unit_scale_denominator,
      p.rate_unit_reference_code, p.price_basis_base_units
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id IN ('PV-NAS-NFS41-BALANCED-1TIB-V1', 'PV-RACK-42U-10KW-MANAGED-V1')
    ORDER BY pv.id`).all() as Array<Record<string, string | number>>;
  if (rows.length !== 2) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const nas = rows.find((row) => row.id === "PV-NAS-NFS41-BALANCED-1TIB-V1");
  const rack = rows.find((row) => row.id === "PV-RACK-42U-10KW-MANAGED-V1");
  if (!nas || nas.policy_id !== "PCP-NAS-NFS41-BALANCED-1TIB-V1" || nas.form_factor !== "MANAGED_NAS_VOLUME"
    || nas.rate_unit_code !== "GIB_STORAGE" || nas.fulfillment_model !== "NAS_VOLUME_ALLOCATION"
    || nas.pricing_unit_code !== "TIB_HOUR" || nas.rate_unit_scale_denominator !== 1024
    || nas.rate_unit_reference_code !== "TIB_STORAGE" || nas.price_basis_base_units !== 3_686_400) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  if (!rack || rack.policy_id !== "PCP-RACK-42U-10KW-MANAGED-V1" || rack.form_factor !== "MANAGED_COLOCATION_RACK"
    || rack.rate_unit_code !== "RACK" || rack.fulfillment_model !== "RACK_COLOCATION_ALLOCATION"
    || rack.pricing_unit_code !== "RACK_HOUR" || rack.rate_unit_scale_denominator !== 1
    || rack.rate_unit_reference_code !== "RACK" || rack.price_basis_base_units !== 3_600) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const nasIdentity = JSON.parse(String(nas.specs_json)) as Record<string, unknown>;
  if (nasIdentity.registryId !== "kai-nas-nfs41-balanced-v1" || nasIdentity.protocol !== "NFS_4_1"
    || nasIdentity.performanceTier !== "BALANCED" || nasIdentity.minIopsPerTiB !== 3000
    || nasIdentity.minThroughputMiBpsPerTiB !== 200 || nasIdentity.redundancy !== "MULTI_NODE"
    || nasIdentity.encryptionAtRest !== true || nasIdentity.snapshotPolicy !== "DAILY_7D"
    || nasIdentity.regionScope !== "SUPPLIER_DECLARED_CN_REGION" || nasIdentity.egressBilling !== "EXCLUDED") {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const rackIdentity = JSON.parse(String(rack.specs_json)) as Record<string, unknown>;
  if (rackIdentity.registryId !== "kai-rack-42u-10kw-managed-v1" || rackIdentity.rackUnits !== 42
    || rackIdentity.committedPowerKw !== 10 || rackIdentity.powerBilling !== "INCLUDED_UP_TO_10KW"
    || rackIdentity.cooling !== "N_PLUS_ONE" || rackIdentity.network !== "BASIC_DUAL_UPLINK"
    || rackIdentity.access !== "MANAGED_WORK_ORDER" || rackIdentity.regionScope !== "SUPPLIER_DECLARED_CN_REGION") {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const power = db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_product_versions WHERE product_code = 'POWER_CAPACITY') AS products,
      (SELECT COUNT(*) FROM exchange_product_capacity_policies
        WHERE product_code = 'POWER_CAPACITY' AND feature_status = 'ENABLED') AS policies`).get() as
    { products: number; policies: number };
  if (power.products !== 0 || power.policies !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
}

function readV8MigrationSql() {
  const fileName = "0008_model_instance_capacity.sql";
  const candidates = [
    join(process.cwd(), "drizzle", fileName),
    join(process.cwd(), ".openai", "drizzle", fileName),
    join(process.cwd(), "dist", ".openai", "drizzle", fileName),
    fileURLToPath(new URL(`../../drizzle/${fileName}`, import.meta.url)),
  ];
  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) throw new Error("EXCHANGE_MIGRATION_0008_MISSING");
  return readFileSync(migrationPath, "utf8");
}

function readV9MigrationSql() {
  const fileName = "0009_token_throughput_capacity.sql";
  const candidates = [
    join(process.cwd(), "drizzle", fileName),
    join(process.cwd(), ".openai", "drizzle", fileName),
    join(process.cwd(), "dist", ".openai", "drizzle", fileName),
    fileURLToPath(new URL(`../../drizzle/${fileName}`, import.meta.url)),
  ];
  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) throw new Error("EXCHANGE_MIGRATION_0009_MISSING");
  return readFileSync(migrationPath, "utf8");
}

function readV10MigrationSql() {
  const fileName = "0010_nas_rack_capacity.sql";
  const candidates = [
    join(process.cwd(), "drizzle", fileName),
    join(process.cwd(), ".openai", "drizzle", fileName),
    join(process.cwd(), "dist", ".openai", "drizzle", fileName),
    fileURLToPath(new URL(`../../drizzle/${fileName}`, import.meta.url)),
  ];
  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) throw new Error("EXCHANGE_MIGRATION_0010_MISSING");
  return readFileSync(migrationPath, "utf8");
}

function readV11MigrationSql() {
  const fileName = "0011_withdraw_swap_commission.sql";
  const candidates = [
    join(process.cwd(), "drizzle", fileName),
    join(process.cwd(), ".openai", "drizzle", fileName),
    join(process.cwd(), "dist", ".openai", "drizzle", fileName),
    fileURLToPath(new URL(`../../drizzle/${fileName}`, import.meta.url)),
  ];
  const migrationPath = candidates.find((candidate) => existsSync(candidate));
  if (!migrationPath) throw new Error("EXCHANGE_MIGRATION_0011_MISSING");
  return readFileSync(migrationPath, "utf8");
}

function splitMigrationStatements(source: string) {
  return source.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
}

function initializeFreshSchema(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const statement of exchangeSchemaStatements) db.exec(statement);
    for (const statement of exchangeSeedStatements) db.exec(statement);
    const insertVersion = db.prepare("INSERT INTO exchange_schema_migrations (version, applied_at) VALUES (?, ?)");
    const appliedAt = new Date().toISOString();
    for (const version of EXCHANGE_SCHEMA_VERSIONS) insertVersion.run(version, appliedAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function ensureSqliteExchangeSchema(db: DatabaseSync) {
  if (!exchangeTableExists(db, "exchange_schema_migrations")) {
    const existingCore = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'exchange_%'`).get() as { count: number };
    if (Number(existingCore.count) !== 0) throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
    initializeFreshSchema(db);
    assertSqliteV11Signature(db);
    assertSqliteM7Runtime(db);
    return;
  }

  const versions = readExchangeSchemaVersions(db);
  if (versions.length === 0) throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
  const latest = versions.at(-1) as number;
  if (latest > EXCHANGE_SCHEMA_VERSION) throw new Error("EXCHANGE_SCHEMA_VERSION_UNSUPPORTED");
  assertKnownHistory(versions, latest);
  if (latest < 7) throw new Error("EXCHANGE_SCHEMA_MIGRATION_PATH_UNSUPPORTED");

  if (latest === 7) {
    assertSqliteV7Signature(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of splitMigrationStatements(readV8MigrationSql())) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    assertKnownHistory(readExchangeSchemaVersions(db), 8);
  }

  if ((readExchangeSchemaVersions(db).at(-1) as number) === 8) {
    assertSqliteV8Signature(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of splitMigrationStatements(readV9MigrationSql())) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  if ((readExchangeSchemaVersions(db).at(-1) as number) === 9) {
    assertSqliteV9Signature(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of splitMigrationStatements(readV10MigrationSql())) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  if ((readExchangeSchemaVersions(db).at(-1) as number) === 10) {
    assertSqliteV10Signature(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of splitMigrationStatements(readV11MigrationSql())) db.exec(statement);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  assertKnownHistory(readExchangeSchemaVersions(db), EXCHANGE_SCHEMA_VERSION);
  assertSqliteV11Signature(db);

  for (const statement of exchangeSchemaStatements) db.exec(statement);
  for (const statement of exchangeSeedStatements) db.exec(statement);
  assertSqliteM7Runtime(db);
}

function replayOrConflict<Row extends { payload_hash: string }, T>(row: Row | undefined, payloadHash: string, map: (row: Row) => T) {
  if (!row) return null;
  if (row.payload_hash !== payloadHash) throw new ExchangeIdempotencyConflictError();
  return { record: map(row), replayed: true } as const;
}

function insertEvent(db: DatabaseSync, actorId: string, entityType: string, entityId: string, eventType: string, payload: unknown, at: string) {
  db.prepare(`INSERT INTO exchange_domain_events (
    id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(eventId(), actorId, entityType, entityId, eventType, JSON.stringify(payload), at);
}

function withTransaction<T>(db: DatabaseSync, operation: () => T) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const RESOURCE_WITH_POLICY_SQL = `SELECT ra.*,
    p.product_code, p.rate_unit_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_resource_assets ra
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

const LOT_WITH_POLICY_SQL = `SELECT lot.*,
    p.product_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_capacity_lots lot
  JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

const LISTING_WITH_POLICY_SQL = `SELECT lv.*,
    p.product_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_listing_versions lv
  JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
  JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

type SwapListingFactRow = ListingRow & {
  lot_id: string;
  lot_start_at: string;
  lot_end_at: string;
  lot_rate_units: number;
  lot_status: CapacityLotRow["status"];
  resource_status: ResourceRow["status"];
  product_version_id: string;
  capacity_policy_id: string;
};

const SWAP_LISTING_FACT_SQL = `SELECT lv.*,
    lot.id AS lot_id, lot.start_at AS lot_start_at, lot.end_at AS lot_end_at,
    lot.rate_units AS lot_rate_units, lot.status AS lot_status,
    resource.status AS resource_status, resource.product_version_id,
    policy.id AS capacity_policy_id, policy.product_code, policy.fulfillment_model,
    policy.pricing_unit_code AS policy_pricing_unit_code, policy.price_basis_base_units
  FROM exchange_listing_versions lv
  JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
  JOIN exchange_resource_assets resource ON resource.id = lot.resource_asset_id
  JOIN exchange_product_capacity_policies policy
    ON policy.product_version_id = resource.product_version_id AND policy.feature_status = 'ENABLED'`;

function sqliteSwapListingFact(row: SwapListingFactRow): SwapListingFact {
  return {
    listingVersionId: row.id,
    listingCreatedAt: row.created_at,
    listingValidFrom: row.valid_from,
    listingValidUntil: row.valid_until,
    listingStatus: row.status,
    supplierActorId: row.supplier_actor_id,
    unitPriceMicros: row.unit_price_micros,
    minRateUnits: row.min_rate_units,
    maxRateUnits: row.max_rate_units,
    minDurationMinutes: row.min_duration_minutes,
    lotId: row.lot_id,
    lotStartAt: row.lot_start_at,
    lotEndAt: row.lot_end_at,
    lotRateUnits: row.lot_rate_units,
    lotStatus: row.lot_status,
    resourceStatus: row.resource_status,
    productVersionId: row.product_version_id,
    capacityPolicyId: row.capacity_policy_id,
    descriptor: capacityDescriptor(row.rate_unit_code, {
      productCode: row.product_code,
      rateUnitCode: row.rate_unit_code,
      fulfillmentModel: row.fulfillment_model,
      pricingUnitCode: row.policy_pricing_unit_code,
      priceBasisBaseUnits: row.price_basis_base_units,
    }),
  };
}

function assertCanonicalInputForProduct(
  input: object,
  rateUnitCode: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR" | "GIB_STORAGE" | "RACK",
) {
  if (rateUnitCode !== "GPU" && isLegacyGpuCreateInput(input)) {
    throw new ExchangeDomainError("EXCHANGE_UNIT_MISMATCH", 422, "非 GPU 请求必须使用通用容量字段。\n");
  }
}

function readDeliveryPackage(db: DatabaseSync, row: DeliveryPackageRow, viewerRole?: "buyer" | "supplier" | "ops") {
  const review = db.prepare("SELECT * FROM exchange_delivery_reviews WHERE package_id = ?")
    .get(row.id) as DeliveryReviewRow | undefined;
  const claim = db.prepare("SELECT * FROM exchange_delivery_claims WHERE package_id = ?")
    .get(row.id) as DeliveryClaimRow | undefined;
  const latestConnectionCheck = db.prepare(`SELECT * FROM exchange_connection_checks
    WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).get(row.id) as ConnectionCheckRow | undefined;
  return mapDeliveryPackage(row, viewerRole, { review, claim, latestConnectionCheck });
}

function latestDeliveryPackage(db: DatabaseSync, deliveryTaskId: string, viewerRole?: "buyer" | "supplier" | "ops") {
  const row = db.prepare(`SELECT * FROM exchange_delivery_packages
    WHERE delivery_task_id = ? ORDER BY revision DESC LIMIT 1`).get(deliveryTaskId) as DeliveryPackageRow | undefined;
  return row ? readDeliveryPackage(db, row, viewerRole) : null;
}

function readOrder(db: DatabaseSync, orderId: string, viewerRole?: "buyer" | "supplier" | "ops") {
  const order = db.prepare(`SELECT o.*,
      s.id AS snapshot_id, s.product_code AS snapshot_product_code,
      s.rate_unit_code AS snapshot_rate_unit_code,
      s.fulfillment_model AS snapshot_fulfillment_model,
      s.pricing_unit_code AS snapshot_pricing_unit_code,
      s.price_basis_base_units AS snapshot_price_basis_base_units
    FROM exchange_orders o
    LEFT JOIN exchange_order_contract_snapshots s ON s.order_id = o.id
    WHERE o.id = ?`).get(orderId) as OrderRow | undefined;
  if (!order) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单不存在。");
  const reservation = db.prepare("SELECT * FROM exchange_reservations WHERE order_id = ?").get(orderId) as ReservationRow | undefined;
  if (!reservation) throw new Error("ORDER_RESERVATION_MISSING");
  const lifecycle = db.prepare("SELECT * FROM exchange_order_lifecycle WHERE order_id = ?").get(orderId) as OrderLifecycleRow | undefined;
  const payment = db.prepare("SELECT * FROM exchange_payment_intents WHERE order_id = ?").get(orderId) as PaymentIntentRow | undefined;
  const delivery = db.prepare("SELECT * FROM exchange_delivery_tasks WHERE order_id = ?").get(orderId) as DeliveryTaskRow | undefined;
  const metering = db.prepare("SELECT * FROM exchange_metering_sessions WHERE order_id = ?").get(orderId) as MeteringSessionRow | undefined;
  const acceptance = db.prepare("SELECT * FROM exchange_acceptances WHERE order_id = ?").get(orderId) as AcceptanceRow | undefined;
  const settlement = db.prepare("SELECT * FROM exchange_settlements WHERE order_id = ?").get(orderId) as SettlementRow | undefined;
  const referralDecision = db.prepare("SELECT * FROM exchange_referral_decisions WHERE order_id = ?")
    .get(orderId) as ReferralDecisionRow | undefined;
  const referralAttribution = db.prepare("SELECT * FROM exchange_referral_attributions WHERE order_id = ?")
    .get(orderId) as ReferralAttributionRow | undefined;
  const referralCode = referralDecision?.resolved_code_id
    ? db.prepare("SELECT * FROM exchange_referral_codes WHERE id = ?").get(referralDecision.resolved_code_id) as ReferralCodeRow | undefined
    : undefined;
  const commission = db.prepare("SELECT * FROM exchange_commission_accruals WHERE order_id = ?")
    .get(orderId) as CommissionAccrualRow | undefined;
  const snapshot = db.prepare("SELECT * FROM exchange_order_contract_snapshots WHERE order_id = ?")
    .get(orderId) as OrderContractSnapshotRow | undefined;
  if (order.accounting_schema_version >= 2 && !snapshot) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING");
  }
  assertReferralFacts(order, referralDecision, referralAttribution, referralCode);
  assertSettlementCommissionFacts(order, snapshot, settlement, referralAttribution, commission);
  const deliveryPackage = delivery ? latestDeliveryPackage(db, delivery.id, viewerRole) : null;
  return {
    order,
    reservation,
    lifecycle,
    payment,
    delivery,
    deliveryPackage,
    metering,
    acceptance,
    settlement,
    snapshot: snapshot ? mapOrderContractSnapshot(snapshot) : null,
    record: mapOrder(order, reservation, viewerRole, {
      lifecycle, payment, delivery, deliveryPackage, metering, acceptance, settlement,
      referralDecision, referralAttribution, commission,
    }),
  };
}

function oneTimeTestCode() {
  const raw = randomBytes(6).toString("hex").toUpperCase();
  return `KAI-TEST-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function expireDeliveryPackage(db: DatabaseSync, row: DeliveryPackageRow, actorId: string, effectiveAt?: string) {
  if (!["SUBMITTED", "VERIFIED", "CLAIMED"].includes(row.status)) return;
  withTransaction(db, () => {
    const now = effectiveAt ?? new Date().toISOString();
    const packageUpdate = db.prepare(`UPDATE exchange_delivery_packages
      SET status = 'EXPIRED', version = version + 1, updated_at = ?
      WHERE id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')`).run(now, row.id);
    if (packageUpdate.changes !== 1) return;
    db.prepare(`UPDATE exchange_delivery_tasks
      SET status = 'PROVISIONING', attempt = attempt + 1, version = version + 1, updated_at = ?
      WHERE id = ? AND status IN ('VERIFYING', 'DELIVERED')`).run(now, row.delivery_task_id);
    db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?").run(now, row.order_id);
    insertEvent(db, actorId, "DELIVERY_PACKAGE", row.id, "DELIVERY_PACKAGE_EXPIRED", {
      deliveryTaskId: row.delivery_task_id,
      revision: row.revision,
    }, now);
  });
}

function expireReservations(db: DatabaseSync, capacityLotId: string, now: string) {
  const expired = db.prepare(`SELECT r.*, o.status AS order_status FROM exchange_reservations r
    JOIN exchange_orders o ON o.id = r.order_id
    WHERE r.capacity_lot_id = ? AND r.state IN ('HELD', 'SUPPLIER_CONFIRMED')
      AND r.hold_expires_at <= ?`).all(capacityLotId, now) as Array<ReservationRow & { order_status: string }>;
  for (const reservation of expired) {
    db.prepare("UPDATE exchange_reservations SET state = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?")
      .run(now, reservation.id);
    db.prepare("UPDATE exchange_orders SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?")
      .run(now, reservation.order_id);
    db.prepare(`INSERT OR IGNORE INTO exchange_capacity_transfers (
      id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
      rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
    ) VALUES (?, ?, ?, ?, 'HELD', 'AVAILABLE', ?, ?, ?, 'RESERVATION_EXPIRED', ?)`).run(
      createExchangeTransferId(), reservation.capacity_lot_id, reservation.order_id,
      `order:${reservation.order_id}:expired`, reservation.rate_unit_code, reservation.capacity_base_units,
      reservation.capacity_gpu_seconds, now,
    );
  }
}

function assertSqliteSwapInventory(
  db: DatabaseSync,
  fact: SwapListingFact,
  input: { rateUnits: number; startAt: string; endAt: string },
  now: string,
) {
  expireReservations(db, fact.lotId, now);
  const active = db.prepare(`SELECT start_at, end_at, rate_units
    FROM exchange_reservations
    WHERE capacity_lot_id = ? AND start_at < ? AND end_at > ?
      AND (
        state IN ('COMMITTED', 'IN_SERVICE', 'FULFILLED')
        OR (state IN ('HELD', 'SUPPLIER_CONFIRMED') AND hold_expires_at > ?)
      )`).all(fact.lotId, input.endAt, input.startAt, now) as Array<{ start_at: string; end_at: string; rate_units: number }>;
  if (maximumConcurrentRateUnits(active, input.startAt, input.endAt) + input.rateUnits > fact.lotRateUnits) {
    throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "置换时段的可用容量不足。");
  }
}

function assertSqliteSwapLegProjection(
  fact: SwapListingFact,
  input: { listingVersionId: string; rateUnits: number; startAt: string; endAt: string },
  leg: ReturnType<typeof mapSwapQuote>["offered"],
) {
  if (fact.listingVersionId !== input.listingVersionId
    || leg.sourceListingVersionId !== fact.listingVersionId
    || leg.listingCreatedAt !== fact.listingCreatedAt
    || leg.listingValidFrom !== fact.listingValidFrom
    || leg.productVersionId !== fact.productVersionId
    || leg.capacityPolicyId !== fact.capacityPolicyId
    || leg.productCode !== fact.descriptor.productCode
    || leg.rateUnitCode !== fact.descriptor.rateUnitCode
    || leg.fulfillmentModel !== fact.descriptor.fulfillmentModel
    || leg.pricingUnitCode !== fact.descriptor.pricingUnitCode
    || leg.priceBasisBaseUnits !== fact.descriptor.priceBasisBaseUnits
    || leg.unitPriceMicros !== fact.unitPriceMicros
    || leg.rateUnits !== input.rateUnits || leg.startAt !== input.startAt || leg.endAt !== input.endAt) {
    throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "Swap quote source facts changed before the final write.");
  }
}

async function readSqliteSwapQuote(
  db: DatabaseSync,
  quoteId: string,
  statusEvent?: SwapQuoteStatusEventRow,
  now = new Date().toISOString(),
  viewerActorId?: string,
) {
  const row = db.prepare("SELECT * FROM exchange_swap_quotes WHERE id = ?").get(quoteId) as SwapQuoteRow | undefined;
  if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价不存在。");
  const snapshots = db.prepare(`SELECT * FROM exchange_swap_quote_snapshots
    WHERE quote_id = ? ORDER BY leg_role ASC`).all(quoteId) as SwapQuoteSnapshotRow[];
  const statuses = db.prepare(`SELECT * FROM exchange_swap_quote_status_events
    WHERE quote_id = ? ORDER BY version ASC`).all(quoteId) as SwapQuoteStatusEventRow[];
  if (snapshots.length !== 2 || statuses.length === 0
    || statuses.some((event, index) => event.version !== index + 1)
    || statuses[0].status !== "QUOTED") {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_PROJECTION_INVALID");
  }
  const selected = statusEvent ?? statuses.at(-1) as SwapQuoteStatusEventRow;
  const quote = mapSwapQuote(row, snapshots as [SwapQuoteSnapshotRow, SwapQuoteSnapshotRow], selected, now, viewerActorId);
  await verifySwapQuoteDigests(quote, sha256);
  const facts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_type = 'SWAP_QUOTE'
        AND entity_id = ? AND event_type = 'SWAP_QUOTE_CREATED') AS event_count,
      (SELECT COUNT(*) FROM exchange_command_receipts WHERE actor_id = ?
        AND idempotency_key = ? AND payload_hash = ? AND command_type = 'CREATE_SWAP_QUOTE'
        AND entity_id = ?) AS receipt_count`).get(
    quoteId, row.initiator_actor_id, row.idempotency_key, row.payload_hash, quoteId,
  ) as { event_count: number; receipt_count: number };
  if (facts.event_count !== 1 || facts.receipt_count !== 1) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_FACTS_MISSING");
  }
  return quote;
}

function createExchangeTransferId() {
  return `KAI-CT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

function withdrawalEligibility(db: DatabaseSync, lot: CapacityLotRow) {
  if (lot.status === "WITHDRAWN") return { eligible: false, reasonCode: "ALREADY_WITHDRAWN" as const };
  if (lot.status !== "READY") return { eligible: false, reasonCode: "LOT_NOT_READY" as const };
  if ((db.prepare("SELECT COUNT(*) AS count FROM exchange_listing_versions WHERE capacity_lot_id = ?")
    .get(lot.id) as { count: number }).count !== 0) {
    return { eligible: false, reasonCode: "LISTING_HISTORY_EXISTS" as const };
  }
  if ((db.prepare("SELECT COUNT(*) AS count FROM exchange_reservations WHERE capacity_lot_id = ?")
    .get(lot.id) as { count: number }).count !== 0) {
    return { eligible: false, reasonCode: "RESERVATION_HISTORY_EXISTS" as const };
  }
  if ((db.prepare("SELECT COUNT(*) AS count FROM exchange_capacity_withdrawals WHERE capacity_lot_id = ?")
    .get(lot.id) as { count: number }).count !== 0) {
    return { eligible: false, reasonCode: "ALREADY_WITHDRAWN" as const };
  }
  const pristine = db.prepare(`SELECT COUNT(*) AS transfer_count,
      COALESCE(SUM(CASE WHEN to_bucket = 'AVAILABLE' THEN capacity_base_units ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN from_bucket = 'AVAILABLE' THEN capacity_base_units ELSE 0 END), 0) AS available_balance,
      COALESCE(SUM(CASE WHEN from_bucket NOT IN ('ISSUED', 'AVAILABLE') OR to_bucket <> 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS other_movements,
      COALESCE(SUM(CASE WHEN from_bucket = 'ISSUED' AND to_bucket = 'AVAILABLE'
        AND order_id IS NULL AND idempotency_key = ? AND reason = 'CAPACITY_LOT_CREATED'
        AND rate_unit_code = ? AND capacity_base_units = ?
        AND accounting_schema_version = ?
        AND ((? = 'GPU' AND capacity_gpu_seconds = ?) OR (? <> 'GPU' AND capacity_gpu_seconds IS NULL))
        THEN 1 ELSE 0 END), 0) AS initial_transfer_count
    FROM exchange_capacity_transfers WHERE capacity_lot_id = ?`).get(
      `lot:${lot.id}:issued`, lot.rate_unit_code, lot.capacity_base_units, lot.accounting_schema_version,
      lot.rate_unit_code, lot.capacity_base_units, lot.rate_unit_code, lot.id,
    ) as { transfer_count: number; available_balance: number; other_movements: number; initial_transfer_count: number };
  if (pristine.transfer_count !== 1 || pristine.initial_transfer_count !== 1
    || pristine.available_balance !== lot.capacity_base_units || pristine.other_movements !== 0) {
    return { eligible: false, reasonCode: "TRANSFER_HISTORY_NOT_PRISTINE" as const };
  }
  return { eligible: true, reasonCode: "ELIGIBLE" as const };
}

function mapCapacityLotForSupplier(db: DatabaseSync, row: CapacityLotRow) {
  const lot = mapCapacityLot(row);
  const eligibility = withdrawalEligibility(db, row);
  return {
    ...lot,
    withdrawalEligibility: eligibility,
    allowedActions: [
      ...(row.status === "READY" ? ["CREATE_LISTING" as const] : []),
      ...(eligibility.eligible ? ["WITHDRAW" as const] : []),
    ],
  };
}

function projectSqliteCapacityWithdrawal(db: DatabaseSync, row: CapacityWithdrawalRow) {
  const record = mapCapacityWithdrawal(row);
  type WithdrawalTransferFact = {
    id: string; capacity_lot_id: string; order_id: string | null; idempotency_key: string;
    from_bucket: string; to_bucket: string; rate_unit_code: string; capacity_base_units: number;
    capacity_gpu_seconds: number | null; reason: string; occurred_at: string; accounting_schema_version: number;
  };
  const lot = db.prepare("SELECT * FROM exchange_capacity_lots WHERE id = ?")
    .get(row.capacity_lot_id) as CapacityLotRow | undefined;
  const transfers = db.prepare(`SELECT * FROM exchange_capacity_transfers
    WHERE capacity_lot_id = ? ORDER BY occurred_at ASC, id ASC`).all(row.capacity_lot_id) as WithdrawalTransferFact[];
  const sameCapacity = (transfer: WithdrawalTransferFact) => transfer.rate_unit_code === row.rate_unit_code
    && transfer.capacity_base_units === row.capacity_base_units
    && transfer.accounting_schema_version === row.accounting_schema_version
    && transfer.capacity_gpu_seconds === row.capacity_gpu_seconds;
  const initial = transfers.filter((transfer) => transfer.order_id === null
    && transfer.idempotency_key === `lot:${row.capacity_lot_id}:issued`
    && transfer.from_bucket === "ISSUED" && transfer.to_bucket === "AVAILABLE"
    && transfer.reason === "CAPACITY_LOT_CREATED" && sameCapacity(transfer));
  const terminal = transfers.filter((transfer) => transfer.id === row.transfer_id
    && transfer.order_id === null && transfer.idempotency_key === `withdrawal:${row.id}`
    && transfer.from_bucket === "AVAILABLE" && transfer.to_bucket === "WITHDRAWN"
    && transfer.reason === "CAPACITY_LOT_WITHDRAWN" && transfer.occurred_at === row.occurred_at
    && sameCapacity(transfer));
  const availableBalance = transfers.reduce((balance, transfer) => balance
    + (transfer.to_bucket === "AVAILABLE" ? transfer.capacity_base_units : 0)
    - (transfer.from_bucket === "AVAILABLE" ? transfer.capacity_base_units : 0), 0);
  const withdrawnBalance = transfers.reduce((balance, transfer) => balance
    + (transfer.to_bucket === "WITHDRAWN" ? transfer.capacity_base_units : 0)
    - (transfer.from_bucket === "WITHDRAWN" ? transfer.capacity_base_units : 0), 0);
  const factsMatch = Boolean(lot)
    && lot!.supplier_actor_id === row.supplier_actor_id && lot!.status === "WITHDRAWN"
    && lot!.version === row.expected_lot_version + 1 && lot!.rate_unit_code === row.rate_unit_code
    && lot!.capacity_base_units === row.capacity_base_units
    && lot!.capacity_gpu_seconds === row.capacity_gpu_seconds
    && lot!.accounting_schema_version === row.accounting_schema_version
    && transfers.length === 2 && initial.length === 1 && terminal.length === 1
    && initial[0].occurred_at === lot!.created_at
    && availableBalance === 0 && withdrawnBalance === row.capacity_base_units;
  const integrity = db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_domain_events event
        WHERE event.entity_type = 'CAPACITY_LOT' AND event.entity_id = ?
          AND event.event_type = 'CAPACITY_LOT_WITHDRAWN') AS event_total_count,
      (SELECT COUNT(*) FROM exchange_domain_events event
        WHERE event.entity_type = 'CAPACITY_LOT' AND event.entity_id = ?
          AND event.event_type = 'CAPACITY_LOT_WITHDRAWN' AND json(event.payload_json) = json(?)) AS event_count,
      (SELECT COUNT(*) FROM exchange_command_receipts receipt
        WHERE receipt.actor_id = ? AND receipt.idempotency_key = ?
          AND receipt.payload_hash = ? AND receipt.command_type = 'WITHDRAW_CAPACITY_LOT'
          AND receipt.entity_id = ? AND json(receipt.response_json) = json(?)) AS receipt_count`).get(
    row.capacity_lot_id, row.capacity_lot_id, JSON.stringify(record), row.supplier_actor_id, row.idempotency_key,
    row.payload_hash, row.id, JSON.stringify(record),
  ) as { event_total_count: number; event_count: number; receipt_count: number };
  if (!factsMatch || integrity.event_total_count !== 1 || integrity.event_count !== 1 || integrity.receipt_count !== 1) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_WITHDRAWAL_REPLAY");
  }
  return record;
}

function createExchangeSnapshotId() {
  return `KAI-OCS-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

function insertPaymentEvent(
  db: DatabaseSync,
  context: { payloadHash: string },
  input: ApplyPaymentEvent,
  outcome: PaymentEventRow["outcome"],
  receivedAt: string,
  id = createExchangeId("PE"),
) {
  db.prepare(`INSERT INTO exchange_payment_events (
    id, provider, environment, provider_event_id, provider_transaction_id, payment_intent_id,
    merchant_account_ref, event_type, amount_cents, currency, funds_moved,
    verification_method, verified_at, raw_payload_digest, payload_hash, outcome, occurred_at, received_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, input.provider, input.environment, input.providerEventId, input.providerTransactionId, input.providerOrderId,
      input.merchantAccountRef, input.eventType, input.amountCents, input.currency, Number(input.fundsMoved),
      input.verificationMethod, input.verifiedAt, input.rawPayloadDigest, context.payloadHash, outcome, input.occurredAt, receivedAt,
    );
  return id;
}

export function createSqliteExchangeStore(databasePath?: string, clock: () => Date = () => new Date()): SqliteExchangeStore {
  const db = openDatabase(databasePath);
  ensureSqliteExchangeSchema(db);

  return {
    async listProductVersions() {
      return (db.prepare(`SELECT pv.* FROM exchange_product_versions pv
        JOIN exchange_product_capacity_policies p
          ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
        ORDER BY pv.display_name ASC`).all() as ProductRow[]).map(mapProduct);
    },

    async listSupplierResources(actorId) {
      return (db.prepare(`${RESOURCE_WITH_POLICY_SQL}
        WHERE ra.supplier_actor_id = ? ORDER BY ra.created_at DESC`).all(actorId) as ResourceRow[]).map(mapResource);
    },

    async listOpsResources() {
      return (db.prepare(`${RESOURCE_WITH_POLICY_SQL} ORDER BY ra.created_at DESC`).all() as ResourceRow[]).map(mapResource);
    },

    async createResource(context, input) {
      const existing = db.prepare(`${RESOURCE_WITH_POLICY_SQL}
        WHERE ra.supplier_actor_id = ? AND ra.idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as ResourceRow | undefined;
      const replay = replayOrConflict(existing, context.payloadHash, mapResource);
      if (replay) return replay;
      const policy = db.prepare(`SELECT p.* FROM exchange_product_capacity_policies p
        JOIN exchange_product_versions pv ON pv.id = p.product_version_id
        WHERE p.product_version_id = ? AND p.feature_status = 'ENABLED'`).get(input.productVersionId) as
        | ProductCapacityPolicyRow
        | undefined;
      if (!policy || !["GPU_COMPUTE", "MODEL_INSTANCE", "TOKEN_THROUGHPUT", "NAS_STORAGE", "RACK_SPACE"].includes(policy.product_code)) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "未找到可交易的产品版本与容量政策。");
      }
      assertCanonicalInputForProduct(input, policy.rate_unit_code);
      const descriptor = capacityDescriptor(policy.rate_unit_code, {
        productCode: policy.product_code,
        rateUnitCode: policy.rate_unit_code,
        fulfillmentModel: policy.fulfillment_model,
        pricingUnitCode: policy.pricing_unit_code,
        priceBasisBaseUnits: policy.price_basis_base_units,
      });
      const record = newResource(context.actorId, input, descriptor);
      withTransaction(db, () => {
        db.prepare(`INSERT INTO exchange_resource_assets (
          id, supplier_actor_id, idempotency_key, payload_hash, product_version_id,
          title, region, delivery_form, total_parallel_units, interruptibility,
          network_scope, status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id, record.supplierActorId, context.idempotencyKey, context.payloadHash, record.productVersionId,
          record.title, record.region, record.deliveryForm, record.totalRateUnits, record.interruptibility,
          record.networkScope, record.status, record.version, record.createdAt, record.updatedAt,
        );
        insertEvent(db, context.actorId, "RESOURCE_ASSET", record.id, "RESOURCE_DECLARED", record, record.createdAt);
      });
      return { record, replayed: false };
    },

    async createVerification(resourceId, context, input) {
      const existing = db.prepare(`SELECT * FROM exchange_verification_runs
        WHERE operator_actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as VerificationRow | undefined;
      const replay = replayOrConflict(existing, context.payloadHash, mapVerification);
      if (replay) return replay;
      const resource = db.prepare(`${RESOURCE_WITH_POLICY_SQL} WHERE ra.id = ?`).get(resourceId) as ResourceRow | undefined;
      if (!resource) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源不存在或产品未开放交易。");
      if (["SUSPENDED", "WITHDRAWN"].includes(resource.status)) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "当前资源状态不能验真。");
      }
      const record = newVerification(context.actorId, resourceId, input);
      withTransaction(db, () => {
        db.prepare(`INSERT INTO exchange_verification_runs (
          id, resource_asset_id, operator_actor_id, idempotency_key, payload_hash,
          method, result, evidence_summary, evidence_digest, valid_until, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id, record.resourceAssetId, record.operatorActorId, context.idempotencyKey, context.payloadHash,
          record.method, record.result, record.evidenceSummary, record.evidenceDigest, record.validUntil, record.createdAt,
        );
        db.prepare(`UPDATE exchange_resource_assets
          SET status = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(
          record.result === "PASS" ? "VERIFIED" : "REJECTED", record.createdAt, resourceId,
        );
        insertEvent(db, context.actorId, "RESOURCE_ASSET", resourceId, `VERIFICATION_${record.result}`, {
          verificationRunId: record.id,
          method: record.method,
          validUntil: record.validUntil,
        }, record.createdAt);
      });
      return { record, replayed: false };
    },

    async listSupplierLots(actorId) {
      return (db.prepare(`${LOT_WITH_POLICY_SQL}
        WHERE lot.supplier_actor_id = ? ORDER BY lot.created_at DESC`).all(actorId) as CapacityLotRow[])
        .map((row) => mapCapacityLotForSupplier(db, row));
    },

    async createCapacityLot(context, input) {
      const existing = db.prepare(`${LOT_WITH_POLICY_SQL}
        WHERE lot.supplier_actor_id = ? AND lot.idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as CapacityLotRow | undefined;
      const replay = replayOrConflict(existing, context.payloadHash, (row) => mapCapacityLotForSupplier(db, row));
      if (replay) return replay;
      return withTransaction(db, () => {
        const resource = db.prepare(`${RESOURCE_WITH_POLICY_SQL} WHERE ra.id = ?`).get(input.resourceAssetId) as ResourceRow | undefined;
        if (!resource) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源不存在或产品未开放交易。");
        if (!resource.rate_unit_code) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:RESOURCE_POLICY_MISSING");
        if (resource.supplier_actor_id !== context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能使用其他供应商的资源建立容量批次。");
        }
        if (resource.status !== "VERIFIED") {
          throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 422, "资源通过验真后才能建立容量批次。");
        }
        assertCanonicalInputForProduct(input, resource.rate_unit_code);
        if (input.rateUnits > resource.total_parallel_units) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "批次速率单位数超过资源总量。");
        }
        if (input.interruptibility !== resource.interruptibility) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "批次可中断性必须与资源一致。");
        }
        const verification = input.verificationRunId
          ? db.prepare(`SELECT * FROM exchange_verification_runs
              WHERE id = ? AND resource_asset_id = ?`).get(input.verificationRunId, input.resourceAssetId) as VerificationRow | undefined
          : db.prepare(`SELECT * FROM exchange_verification_runs
              WHERE resource_asset_id = ? AND result = 'PASS' AND valid_until >= ?
              ORDER BY created_at DESC LIMIT 1`).get(input.resourceAssetId, input.endAt) as VerificationRow | undefined;
        if (!verification || verification.result !== "PASS") {
          throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 422, "容量批次必须引用通过的验真记录。");
        }
        if (!verification.valid_until || verification.valid_until < input.endAt) {
          throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 422, "验真有效期必须覆盖完整容量时间窗。");
        }
        const overlappingLots = db.prepare(`SELECT start_at, end_at, rate_units
          FROM exchange_capacity_lots
          WHERE resource_asset_id = ? AND status IN ('READY', 'LISTED')
            AND start_at < ? AND end_at > ?`).all(input.resourceAssetId, input.endAt, input.startAt) as CapacityLotRow[];
        if (maximumConcurrentRateUnits(overlappingLots, input.startAt, input.endAt) + input.rateUnits > resource.total_parallel_units) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "该资源在所选时间窗内的容量批次将发生超配。");
        }
        const descriptor = capacityDescriptor(resource.rate_unit_code, {
          productCode: resource.product_code, rateUnitCode: resource.rate_unit_code,
          fulfillmentModel: resource.fulfillment_model,
          pricingUnitCode: resource.policy_pricing_unit_code,
          priceBasisBaseUnits: resource.price_basis_base_units,
        });
        const record = newCapacityLot(context.actorId, { ...input, verificationRunId: verification.id }, descriptor);
        db.prepare(`INSERT INTO exchange_capacity_lots (
          id, supplier_actor_id, idempotency_key, payload_hash, resource_asset_id,
          verification_run_id, start_at, end_at, rate_unit_code, rate_units, capacity_base_units,
          parallel_units, capacity_gpu_seconds,
          interruptibility, status, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id, record.supplierActorId, context.idempotencyKey, context.payloadHash, record.resourceAssetId,
          record.verificationRunId, record.startAt, record.endAt,
          record.rateUnitCode, record.rateUnits, record.capacityBaseUnits,
          record.rateUnitCode === "GPU" ? record.rateUnits : null,
          record.rateUnitCode === "GPU" ? record.capacityBaseUnits : null,
          record.interruptibility, record.status, record.version, record.createdAt, record.updatedAt,
        );
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) VALUES (?, ?, NULL, ?, 'ISSUED', 'AVAILABLE', ?, ?, ?, 'CAPACITY_LOT_CREATED', ?)`).run(
          createExchangeTransferId(), record.id, `lot:${record.id}:issued`,
          record.rateUnitCode, record.capacityBaseUnits,
          record.rateUnitCode === "GPU" ? record.capacityBaseUnits : null, record.createdAt,
        );
        insertEvent(db, context.actorId, "CAPACITY_LOT", record.id, "CAPACITY_LOT_READY", record, record.createdAt);
        return { record, replayed: false };
      });
    },

    async createListing(context, input) {
      const existing = db.prepare(`${LISTING_WITH_POLICY_SQL}
        WHERE lv.supplier_actor_id = ? AND lv.idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as ListingRow | undefined;
      const replay = replayOrConflict(existing, context.payloadHash, mapListing);
      if (replay) return replay;
      return withTransaction(db, () => {
        const lot = db.prepare(`${LOT_WITH_POLICY_SQL} WHERE lot.id = ?`).get(input.capacityLotId) as CapacityLotRow | undefined;
        if (!lot) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "容量批次不存在。");
        if (lot.supplier_actor_id !== context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能上架其他供应商的容量批次。");
        }
        if (lot.status !== "READY") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "只有待上架的容量批次可以发布。");
        }
        if (lot.version !== input.expectedLotVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次版本已经变化，请刷新后重试。");
        }
        assertCanonicalInputForProduct(input, lot.rate_unit_code);
        if (input.maxRateUnits > lot.rate_units) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "上架最大速率单位数超过容量批次。");
        }
        if (lot.rate_unit_code === "GPU" && input.unitPriceMicros % 10_000 !== 0) {
          throw new ExchangeDomainError("EXCHANGE_UNIT_MISMATCH", 422, "GPU 小时报价必须精确到分。");
        }
        if (input.validFrom >= lot.end_at || input.validUntil > lot.end_at) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "上架有效期必须在容量批次结束前截止。");
        }
        const verification = db.prepare("SELECT * FROM exchange_verification_runs WHERE id = ?").get(lot.verification_run_id) as VerificationRow | undefined;
        if (!verification || verification.result !== "PASS" || !verification.valid_until || verification.valid_until < lot.end_at) {
          throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 422, "发布前需要覆盖完整容量时间窗的有效验真。");
        }
        const descriptor = capacityDescriptor(lot.rate_unit_code, {
          productCode: lot.product_code, rateUnitCode: lot.rate_unit_code,
          fulfillmentModel: lot.fulfillment_model,
          pricingUnitCode: lot.policy_pricing_unit_code,
          priceBasisBaseUnits: lot.price_basis_base_units,
        });
        const record = newListing(context.actorId, input, descriptor);
        db.prepare(`INSERT INTO exchange_listing_versions (
          id, listing_id, version_number, supplier_actor_id, idempotency_key, payload_hash,
          capacity_lot_id, rate_unit_code, unit_price_micros, unit_price_cents, currency, pricing_unit_code,
          min_rate_units, max_rate_units, min_parallel_units, max_parallel_units, min_duration_minutes,
          tax_included, energy_included, network_included, scope_note, sla_json,
          delivery_form, valid_from, valid_until, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          record.id, record.listingId, record.versionNumber, record.supplierActorId, context.idempotencyKey, context.payloadHash,
          record.capacityLotId, record.rateUnitCode, record.unitPriceMicros,
          record.rateUnitCode === "GPU" ? record.unitPriceMicros / 10_000 : null,
          record.currency, record.pricingUnitCode,
          record.minRateUnits, record.maxRateUnits,
          record.rateUnitCode === "GPU" ? record.minRateUnits : null,
          record.rateUnitCode === "GPU" ? record.maxRateUnits : null, record.minDurationMinutes,
          Number(record.taxIncluded), Number(record.energyIncluded), Number(record.networkIncluded), record.scopeNote, JSON.stringify(record.sla),
          record.deliveryForm, record.validFrom, record.validUntil, record.status, record.createdAt,
        );
        const lotUpdate = db.prepare(`UPDATE exchange_capacity_lots
          SET status = 'LISTED', version = version + 1, updated_at = ?
          WHERE id = ? AND supplier_actor_id = ? AND status = 'READY' AND version = ?`)
          .run(record.createdAt, lot.id, context.actorId, input.expectedLotVersion);
        if (lotUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次已经被其他操作处理，请刷新后重试。");
        }
        insertEvent(db, context.actorId, "LISTING", record.listingId, "LISTING_PUBLISHED", record, record.createdAt);
        return { record, replayed: false };
      });
    },

    async withdrawCapacityLot(lotId, context, input) {
      const existing = db.prepare(`SELECT * FROM exchange_capacity_withdrawals
        WHERE supplier_actor_id = ? AND idempotency_key = ?`).get(
        context.actorId, context.idempotencyKey,
      ) as CapacityWithdrawalRow | undefined;
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: projectSqliteCapacityWithdrawal(db, existing), replayed: true };
      }
      return withTransaction(db, () => {
        const inTransactionReplay = db.prepare(`SELECT * FROM exchange_capacity_withdrawals
          WHERE supplier_actor_id = ? AND idempotency_key = ?`).get(
          context.actorId, context.idempotencyKey,
        ) as CapacityWithdrawalRow | undefined;
        if (inTransactionReplay) {
          if (inTransactionReplay.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: projectSqliteCapacityWithdrawal(db, inTransactionReplay), replayed: true };
        }

        const lot = db.prepare(`${LOT_WITH_POLICY_SQL} WHERE lot.id = ?`).get(lotId) as CapacityLotRow | undefined;
        if (!lot) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "容量批次不存在。");
        if (lot.supplier_actor_id !== context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能取出其他供应商的容量批次。");
        }
        if (lot.version !== input.expectedVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次版本已经变化，请刷新后重试。");
        }
        const eligibility = withdrawalEligibility(db, lot);
        if (!eligibility.eligible) {
          throw new ExchangeDomainError("EXCHANGE_WITHDRAWAL_INELIGIBLE", 409, eligibility.reasonCode);
        }

        const occurredAt = new Date().toISOString();
        const withdrawalId = createExchangeId("WD");
        const transferId = createExchangeTransferId();
        const lotUpdate = db.prepare(`UPDATE exchange_capacity_lots
          SET status = 'WITHDRAWN', version = version + 1, updated_at = ?
          WHERE id = ? AND supplier_actor_id = ? AND status = 'READY' AND version = ?`)
          .run(occurredAt, lot.id, context.actorId, input.expectedVersion);
        if (lotUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次已经被其他操作处理，请刷新后重试。");
        }
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at,
          accounting_schema_version
        ) VALUES (?, ?, NULL, ?, 'AVAILABLE', 'WITHDRAWN', ?, ?, ?, 'CAPACITY_LOT_WITHDRAWN', ?, ?)`)
          .run(
            transferId, lot.id, `withdrawal:${withdrawalId}`, lot.rate_unit_code,
            lot.capacity_base_units, lot.capacity_gpu_seconds, occurredAt, lot.accounting_schema_version,
          );
        db.prepare(`INSERT INTO exchange_capacity_withdrawals (
          id, capacity_lot_id, supplier_actor_id, idempotency_key, payload_hash,
          expected_lot_version, transfer_id, rate_unit_code, capacity_base_units,
          capacity_gpu_seconds, accounting_schema_version, reason, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(
            withdrawalId, lot.id, context.actorId, context.idempotencyKey, context.payloadHash,
            input.expectedVersion, transferId, lot.rate_unit_code, lot.capacity_base_units,
            lot.capacity_gpu_seconds, lot.accounting_schema_version, input.reason, occurredAt,
          );
        const row = db.prepare("SELECT * FROM exchange_capacity_withdrawals WHERE id = ?")
          .get(withdrawalId) as CapacityWithdrawalRow;
        const record = mapCapacityWithdrawal(row);
        insertEvent(db, context.actorId, "CAPACITY_LOT", lot.id, "CAPACITY_LOT_WITHDRAWN", record, occurredAt);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'WITHDRAW_CAPACITY_LOT', ?, ?, ?)`)
          .run(context.actorId, context.idempotencyKey, context.payloadHash, withdrawalId, JSON.stringify(record), occurredAt);
        return { record, replayed: false };
      });
    },

    async createSwapQuote(context, input) {
      const existing = db.prepare(`SELECT * FROM exchange_swap_quotes
        WHERE initiator_actor_id = ? AND idempotency_key = ?`)
        .get(context.actorId, context.idempotencyKey) as SwapQuoteRow | undefined;
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: await readSqliteSwapQuote(db, existing.id, undefined, clock().toISOString(), context.actorId), replayed: true };
      }
      const generatedAt = clock().toISOString();
      const offeredRow = db.prepare(`${SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
        .get(input.offered.listingVersionId) as SwapListingFactRow | undefined;
      const wantedRow = db.prepare(`${SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
        .get(input.wanted.listingVersionId) as SwapListingFactRow | undefined;
      if (!offeredRow || !wantedRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价引用的挂牌不存在。");
      const offeredFact = sqliteSwapListingFact(offeredRow);
      const wantedFact = sqliteSwapListingFact(wantedRow);
      assertSwapListingFact(offeredFact, input.offered, generatedAt);
      assertSwapListingFact(wantedFact, input.wanted, generatedAt);
      assertSqliteSwapInventory(db, offeredFact, input.offered, generatedAt);
      assertSqliteSwapInventory(db, wantedFact, input.wanted, generatedAt);
      const quote = await buildSwapQuote(context.actorId, input, offeredFact, wantedFact, generatedAt, sha256);
      withTransaction(db, () => {
        const currentOfferedRow = db.prepare(`${SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
          .get(input.offered.listingVersionId) as SwapListingFactRow | undefined;
        const currentWantedRow = db.prepare(`${SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
          .get(input.wanted.listingVersionId) as SwapListingFactRow | undefined;
        if (!currentOfferedRow || !currentWantedRow) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "Swap quote source facts disappeared before the final write.");
        }
        const currentOfferedFact = sqliteSwapListingFact(currentOfferedRow);
        const currentWantedFact = sqliteSwapListingFact(currentWantedRow);
        assertSwapListingFact(currentOfferedFact, input.offered, generatedAt);
        assertSwapListingFact(currentWantedFact, input.wanted, generatedAt);
        if (currentOfferedFact.supplierActorId !== context.actorId
          || currentWantedFact.supplierActorId !== quote.counterpartyActorId
          || currentWantedFact.supplierActorId === context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "Swap quote participants changed before the final write.");
        }
        assertSqliteSwapLegProjection(currentOfferedFact, input.offered, quote.offered);
        assertSqliteSwapLegProjection(currentWantedFact, input.wanted, quote.wanted);
        assertSqliteSwapInventory(db, currentOfferedFact, input.offered, generatedAt);
        assertSqliteSwapInventory(db, currentWantedFact, input.wanted, generatedAt);
        const quoteInsert = db.prepare(`INSERT INTO exchange_swap_quotes (
          id, initiator_actor_id, counterparty_actor_id, idempotency_key, payload_hash,
          offered_value_cents, wanted_value_cents, cash_adjustment_signed_cents,
          cash_adjustment_amount_cents, cash_adjustment_payer_actor_id,
          cash_adjustment_payee_actor_id, generated_at, expires_at, quote_digest
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM exchange_listing_versions lv
          JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
          WHERE lv.id = ? AND lv.supplier_actor_id = ? AND lv.status = 'ACTIVE'
            AND lot.status = 'LISTED' AND lv.valid_from <= ? AND lv.valid_until >= ?)
          AND EXISTS (SELECT 1 FROM exchange_listing_versions lv
          JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
          WHERE lv.id = ? AND lv.supplier_actor_id = ? AND lv.status = 'ACTIVE'
            AND lot.status = 'LISTED' AND lv.valid_from <= ? AND lv.valid_until >= ?)`)
          .run(
            quote.id, quote.initiatorActorId, quote.counterpartyActorId,
            context.idempotencyKey, context.payloadHash, quote.offeredValueCents, quote.wantedValueCents,
            quote.cashAdjustmentSignedCents, quote.cashAdjustmentAmountCents,
            quote.cashAdjustmentPayerActorId, quote.cashAdjustmentPayeeActorId,
            quote.generatedAt, quote.expiresAt, quote.quoteDigest,
            quote.offered.sourceListingVersionId, context.actorId, quote.generatedAt, quote.expiresAt,
            quote.wanted.sourceListingVersionId, quote.counterpartyActorId, quote.generatedAt, quote.expiresAt,
          );
        if (quoteInsert.changes !== 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "挂牌状态已经变化，请重新报价。");
        for (const leg of [quote.offered, quote.wanted]) {
          db.prepare(`INSERT INTO exchange_swap_quote_snapshots (
            id, quote_id, leg_role, source_listing_version_id, listing_created_at, listing_valid_from,
            product_version_id, capacity_policy_id, product_code, rate_unit_code, fulfillment_model,
            pricing_unit_code, rate_units, start_at, end_at, duration_seconds, capacity_base_units,
            unit_price_micros, price_basis_base_units, value_cents, currency, generated_at, expires_at, snapshot_digest
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              leg.id, leg.quoteId, leg.legRole, leg.sourceListingVersionId, leg.listingCreatedAt,
              leg.listingValidFrom, leg.productVersionId, leg.capacityPolicyId, leg.productCode,
              leg.rateUnitCode, leg.fulfillmentModel, leg.pricingUnitCode, leg.rateUnits,
              leg.startAt, leg.endAt, leg.durationSeconds, leg.capacityBaseUnits,
              leg.unitPriceMicros, leg.priceBasisBaseUnits, leg.valueCents, leg.currency,
              leg.generatedAt, leg.expiresAt, leg.snapshotDigest,
            );
        }
        db.prepare(`INSERT INTO exchange_swap_quote_status_events (
          id, quote_id, actor_id, idempotency_key, payload_hash, status, version, reason, occurred_at
        ) VALUES (?, ?, ?, ?, ?, 'QUOTED', 1, 'Initial quote generated', ?)`)
          .run(createExchangeId("SQE"), quote.id, context.actorId, context.idempotencyKey, context.payloadHash, quote.generatedAt);
        insertEvent(db, context.actorId, "SWAP_QUOTE", quote.id, "SWAP_QUOTE_CREATED", quote, quote.generatedAt);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'CREATE_SWAP_QUOTE', ?, ?, ?)`)
          .run(context.actorId, context.idempotencyKey, context.payloadHash, quote.id, JSON.stringify(quote), quote.generatedAt);
      });
      return { record: await readSqliteSwapQuote(db, quote.id, undefined, clock().toISOString(), context.actorId), replayed: false };
    },

    async listSwapQuotes(actorId) {
      const rows = db.prepare(`SELECT * FROM exchange_swap_quotes
        WHERE initiator_actor_id = ? OR counterparty_actor_id = ? ORDER BY generated_at DESC`)
        .all(actorId, actorId) as SwapQuoteRow[];
      const now = clock().toISOString();
      return Promise.all(rows.map((row) => readSqliteSwapQuote(db, row.id, undefined, now, actorId)));
    },

    async transitionSwapQuote(quoteId, context, input) {
      const replayEvent = db.prepare(`SELECT * FROM exchange_swap_quote_status_events
        WHERE actor_id = ? AND idempotency_key = ?`)
        .get(context.actorId, context.idempotencyKey) as SwapQuoteStatusEventRow | undefined;
      if (replayEvent) {
        if (replayEvent.payload_hash !== context.payloadHash || replayEvent.quote_id !== quoteId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: await readSqliteSwapQuote(db, quoteId, undefined, clock().toISOString(), context.actorId), replayed: true };
      }
      const quoteRow = db.prepare("SELECT * FROM exchange_swap_quotes WHERE id = ?").get(quoteId) as SwapQuoteRow | undefined;
      if (!quoteRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价不存在。");
      if (quoteRow.initiator_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有报价发起方可以变更报价状态。");
      }
      const latest = db.prepare(`SELECT * FROM exchange_swap_quote_status_events
        WHERE quote_id = ? ORDER BY version DESC LIMIT 1`).get(quoteId) as SwapQuoteStatusEventRow | undefined;
      if (!latest) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_STATUS_MISSING");
      if (latest.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "置换报价版本已经变化，请刷新后重试。");
      }
      const occurredAt = clock().toISOString();
      const isExpired = occurredAt >= quoteRow.expires_at;
      if (input.action === "EXPIRED" ? !isExpired : isExpired) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, isExpired ? "置换报价已经到期。" : "置换报价尚未到期。");
      }
      const allowed = (latest.status === "QUOTED" && ["OPS_REVIEW", "CANCELLED", "EXPIRED"].includes(input.action))
        || (latest.status === "OPS_REVIEW" && ["CANCELLED", "EXPIRED"].includes(input.action));
      if (!allowed) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "置换报价当前状态不允许该操作。");
      const eventRow: SwapQuoteStatusEventRow = {
        id: createExchangeId("SQE"), quote_id: quoteId, actor_id: context.actorId,
        idempotency_key: context.idempotencyKey, payload_hash: context.payloadHash,
        status: input.action, version: input.expectedVersion + 1,
        reason: input.reason, occurred_at: occurredAt,
      };
      withTransaction(db, () => {
        db.prepare(`INSERT INTO exchange_swap_quote_status_events (
          id, quote_id, actor_id, idempotency_key, payload_hash, status, version, reason, occurred_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes WHERE id = ? AND initiator_actor_id = ?)`)
          .run(
            eventRow.id, eventRow.quote_id, eventRow.actor_id, eventRow.idempotency_key,
            eventRow.payload_hash, eventRow.status, eventRow.version, eventRow.reason,
            eventRow.occurred_at, quoteId, context.actorId,
          );
        insertEvent(db, context.actorId, "SWAP_QUOTE", quoteId, `SWAP_QUOTE_${input.action}`, {
          status: input.action, version: eventRow.version, reason: input.reason,
        }, occurredAt);
        const projected = mapSwapQuote(
          quoteRow,
          db.prepare("SELECT * FROM exchange_swap_quote_snapshots WHERE quote_id = ? ORDER BY leg_role")
            .all(quoteId) as [SwapQuoteSnapshotRow, SwapQuoteSnapshotRow],
          eventRow,
          occurredAt,
          context.actorId,
        );
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'TRANSITION_SWAP_QUOTE', ?, ?, ?)`)
          .run(context.actorId, context.idempotencyKey, context.payloadHash, quoteId, JSON.stringify(projected), occurredAt);
      });
      return { record: await readSqliteSwapQuote(db, quoteId, eventRow, occurredAt, context.actorId), replayed: false };
    },
    async generateReferralCode(context) {
      const existing = db.prepare("SELECT * FROM exchange_referral_codes WHERE agent_actor_id = ?")
        .get(context.actorId) as ReferralCodeRow | undefined;
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: mapReferralCode(existing), replayed: true };
      }
      const createdAt = clock().toISOString();
      const record = {
        id: createExchangeId("RC"), agentActorId: context.actorId,
        code: `KAI-AG-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`,
        createdAt,
      } as const;
      withTransaction(db, () => {
        db.prepare(`INSERT INTO exchange_referral_codes (
          id, agent_actor_id, idempotency_key, payload_hash, code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(record.id, record.agentActorId, context.idempotencyKey, context.payloadHash, record.code, record.createdAt);
        insertEvent(db, context.actorId, "REFERRAL_CODE", record.id, "REFERRAL_CODE_CREATED", record, createdAt);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'GENERATE_REFERRAL_CODE', ?, ?, ?)`)
          .run(context.actorId, context.idempotencyKey, context.payloadHash, record.id, JSON.stringify(record), createdAt);
      });
      return { record, replayed: false };
    },

    async listReferralCodes(actorId) {
      return (db.prepare("SELECT * FROM exchange_referral_codes WHERE agent_actor_id = ? ORDER BY created_at DESC")
        .all(actorId) as ReferralCodeRow[]).map(mapReferralCode);
    },

    async resolveReferralCode(code) {
      if (code === null || code.trim() === "") return { resolvedCodeId: null, submittedCodeDigest: null };
      const normalized = code.trim().toUpperCase();
      if (normalized.length < 8 || normalized.length > 40 || !/^[A-Z0-9-]+$/u.test(normalized)) {
        return { resolvedCodeId: null, submittedCodeDigest: sha256(normalized) };
      }
      const row = db.prepare("SELECT id FROM exchange_referral_codes WHERE code = ?")
        .get(normalized) as { id: string } | undefined;
      return row
        ? { resolvedCodeId: row.id, submittedCodeDigest: null }
        : { resolvedCodeId: null, submittedCodeDigest: sha256(normalized) };
    },

    async listReferralAttributions(actorId) {
      return (db.prepare(`SELECT * FROM exchange_referral_attributions
        WHERE agent_actor_id = ? ORDER BY attributed_at DESC`).all(actorId) as ReferralAttributionRow[])
        .map(mapReferralAttribution);
    },

    async listCommissionAccruals(actorId) {
      return (db.prepare(`SELECT * FROM exchange_commission_accruals
        WHERE agent_actor_id = ? ORDER BY created_at DESC`).all(actorId) as CommissionAccrualRow[])
        .map(mapCommissionAccrual);
    },

    async listMarketListings() {
      const now = new Date().toISOString();
      const rows = db.prepare(`SELECT
          lv.*, p.product_code, p.fulfillment_model,
          p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units,
          ra.id AS resource_id, ra.supplier_actor_id AS resource_supplier_actor_id,
          ra.product_version_id AS resource_product_version_id, ra.title AS resource_title,
          ra.region AS resource_region, ra.delivery_form AS resource_delivery_form,
          ra.total_parallel_units AS resource_total_rate_units,
          ra.interruptibility AS resource_interruptibility, ra.network_scope AS resource_network_scope,
          ra.status AS resource_status, ra.version AS resource_version,
          ra.created_at AS resource_created_at, ra.updated_at AS resource_updated_at,
          cl.id AS lot_id, cl.supplier_actor_id AS lot_supplier_actor_id,
          cl.resource_asset_id AS lot_resource_asset_id, cl.verification_run_id AS lot_verification_run_id,
          cl.start_at AS lot_start_at, cl.end_at AS lot_end_at, cl.rate_unit_code AS lot_rate_unit_code,
          cl.rate_units AS lot_rate_units, cl.capacity_base_units AS lot_capacity_base_units,
          cl.parallel_units AS lot_parallel_units, cl.capacity_gpu_seconds AS lot_capacity_gpu_seconds,
          cl.accounting_schema_version AS lot_accounting_schema_version,
          cl.interruptibility AS lot_interruptibility, cl.status AS lot_status, cl.version AS lot_version,
          cl.created_at AS lot_created_at, cl.updated_at AS lot_updated_at,
          pv.id AS product_id, pv.product_code, pv.pricing_unit_code AS product_pricing_unit_code,
          pv.display_name, pv.manufacturer, pv.model, pv.form_factor, pv.specs_json,
          pv.immutable_hash AS product_immutable_hash, pv.created_at AS product_created_at
        FROM exchange_listing_versions lv
        JOIN exchange_capacity_lots cl ON cl.id = lv.capacity_lot_id
        JOIN exchange_resource_assets ra ON ra.id = cl.resource_asset_id
        JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
        JOIN exchange_product_capacity_policies p
          ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
        WHERE lv.status = 'ACTIVE' AND lv.valid_from <= ? AND lv.valid_until > ?
          AND cl.status = 'LISTED' AND cl.end_at > ? AND ra.status = 'VERIFIED'
        ORDER BY lv.created_at DESC`).all(now, now, now) as Array<ListingRow & Record<string, string | number>>;
      return rows.map((row): MarketListing => {
        const listing = mapListing(row);
        return {
          ...listing,
          resource: mapResource({
            id: String(row.resource_id), supplier_actor_id: String(row.resource_supplier_actor_id), payload_hash: "",
            product_version_id: String(row.resource_product_version_id), title: String(row.resource_title),
            region: String(row.resource_region), delivery_form: String(row.resource_delivery_form),
            total_parallel_units: Number(row.resource_total_rate_units), interruptibility: row.resource_interruptibility as ResourceRow["interruptibility"],
            network_scope: String(row.resource_network_scope), status: row.resource_status as ResourceRow["status"],
            version: Number(row.resource_version), created_at: String(row.resource_created_at), updated_at: String(row.resource_updated_at),
            product_code: row.product_code as ResourceRow["product_code"], rate_unit_code: row.rate_unit_code as ResourceRow["rate_unit_code"],
            fulfillment_model: row.fulfillment_model as ResourceRow["fulfillment_model"],
            policy_pricing_unit_code: row.policy_pricing_unit_code as ResourceRow["policy_pricing_unit_code"],
            price_basis_base_units: Number(row.price_basis_base_units),
          }),
          lot: mapCapacityLot({
            id: String(row.lot_id), supplier_actor_id: String(row.lot_supplier_actor_id), payload_hash: "",
            resource_asset_id: String(row.lot_resource_asset_id), verification_run_id: String(row.lot_verification_run_id),
            start_at: String(row.lot_start_at), end_at: String(row.lot_end_at), rate_unit_code: row.lot_rate_unit_code as CapacityLotRow["rate_unit_code"],
            rate_units: Number(row.lot_rate_units), capacity_base_units: Number(row.lot_capacity_base_units),
            parallel_units: row.lot_parallel_units === null ? null : Number(row.lot_parallel_units),
            capacity_gpu_seconds: row.lot_capacity_gpu_seconds === null ? null : Number(row.lot_capacity_gpu_seconds),
            accounting_schema_version: Number(row.lot_accounting_schema_version) as CapacityLotRow["accounting_schema_version"],
            interruptibility: row.lot_interruptibility as CapacityLotRow["interruptibility"], status: row.lot_status as CapacityLotRow["status"],
            version: Number(row.lot_version), created_at: String(row.lot_created_at), updated_at: String(row.lot_updated_at),
            product_code: row.product_code as CapacityLotRow["product_code"], fulfillment_model: row.fulfillment_model as CapacityLotRow["fulfillment_model"],
            policy_pricing_unit_code: row.policy_pricing_unit_code as CapacityLotRow["policy_pricing_unit_code"],
            price_basis_base_units: Number(row.price_basis_base_units),
          }),
          product: mapProduct({
            id: String(row.product_id),
            product_code: row.product_code as ProductRow["product_code"],
            pricing_unit_code: row.product_pricing_unit_code as ProductRow["pricing_unit_code"],
            display_name: String(row.display_name),
            manufacturer: String(row.manufacturer),
            model: String(row.model),
            form_factor: String(row.form_factor),
            specs_json: String(row.specs_json),
            immutable_hash: String(row.product_immutable_hash),
            created_at: String(row.product_created_at),
          }),
        };
      });
    },

    async createCheckout(context, input, referral = { resolvedCodeId: null, submittedCodeDigest: null }) {
      const existing = db.prepare(`SELECT * FROM exchange_orders
        WHERE buyer_actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as OrderRow | undefined;
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: readOrder(db, existing.id, "buyer").record, replayed: true };
      }
      return withTransaction(db, () => {
        const listing = db.prepare(`SELECT lv.*, cl.start_at AS lot_start_at, cl.end_at AS lot_end_at,
            cl.rate_unit_code AS lot_rate_unit_code, cl.rate_units AS lot_rate_units,
            cl.id AS lot_id, cl.status AS lot_status, cl.interruptibility AS lot_interruptibility,
            ra.id AS resource_asset_id, ra.product_version_id,
            pv.product_code, pv.specs_json AS product_identity_json,
            p.id AS capacity_policy_id, p.rate_unit_code AS policy_rate_unit_code,
            p.fulfillment_model, p.pricing_unit_code AS policy_pricing_unit_code,
            p.price_basis_base_units, p.immutable_hash AS evidence_policy_version
          FROM exchange_listing_versions lv
          JOIN exchange_capacity_lots cl ON cl.id = lv.capacity_lot_id
          JOIN exchange_resource_assets ra ON ra.id = cl.resource_asset_id
          JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
          JOIN exchange_product_capacity_policies p
            ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
          WHERE lv.id = ?`).get(input.listingVersionId) as (ListingRow & {
            lot_start_at: string; lot_end_at: string; lot_rate_unit_code: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR";
            lot_rate_units: number; lot_id: string; lot_status: string; resource_asset_id: string; product_version_id: string;
            product_code: "GPU_COMPUTE" | "MODEL_INSTANCE" | "TOKEN_THROUGHPUT"; product_identity_json: string;
            capacity_policy_id: string; policy_rate_unit_code: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR";
            fulfillment_model: "GPU_ALLOCATION" | "MODEL_INSTANCE_ALLOCATION" | "TOKEN_THROUGHPUT_RESERVATION";
            policy_pricing_unit_code: "GPU_HOUR" | "MODEL_INSTANCE_HOUR" | "M_TOKEN_CAPACITY_HOUR";
            price_basis_base_units: number; evidence_policy_version: string;
            lot_interruptibility: "NON_INTERRUPTIBLE" | "INTERRUPTIBLE";
          }) | undefined;
        if (!listing) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "上架版本不存在。");
        const now = new Date().toISOString();
        if (listing.supplier_actor_id === context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "供应商不能购买自己的上架资源。");
        }
        if (listing.status !== "ACTIVE" || listing.valid_from > now || listing.valid_until <= now || listing.lot_status !== "LISTED") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该上架版本当前不可购买。");
        }
        if (input.startAt < listing.lot_start_at || input.endAt > listing.lot_end_at) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "所选服务时间必须完整落在容量批次内。");
        }
        assertCanonicalInputForProduct(input, listing.policy_rate_unit_code);
        if (listing.rate_unit_code !== listing.lot_rate_unit_code
          || listing.rate_unit_code !== listing.policy_rate_unit_code
          || listing.pricing_unit_code !== listing.policy_pricing_unit_code) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:LISTING_POLICY_UNIT_MISMATCH");
        }
        if (input.rateUnits < listing.min_rate_units || input.rateUnits > listing.max_rate_units) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "速率单位数不在上架允许范围内。");
        }
        if (input.interruptibility !== listing.lot_interruptibility) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "订单中断属性必须与所选上架容量一致。");
        }
        const durationMinutes = (Date.parse(input.endAt) - Date.parse(input.startAt)) / 60_000;
        if (durationMinutes < listing.min_duration_minutes) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "服务时长低于该上架版本的最短时长。");
        }
        expireReservations(db, listing.lot_id, now);
        const overlappingReservations = db.prepare(`SELECT start_at, end_at, rate_units
          FROM exchange_reservations
          WHERE capacity_lot_id = ? AND start_at < ? AND end_at > ?
            AND (state IN ('SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE')
              OR (state = 'HELD' AND hold_expires_at > ?))`).all(listing.lot_id, input.endAt, input.startAt, now) as ReservationRow[];
        if (maximumConcurrentRateUnits(overlappingReservations, input.startAt, input.endAt) + input.rateUnits > listing.lot_rate_units) {
          throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "所选时间窗的可用容量不足。");
        }
        const descriptor = capacityDescriptor(listing.policy_rate_unit_code, {
          productCode: listing.product_code, rateUnitCode: listing.policy_rate_unit_code,
          fulfillmentModel: listing.fulfillment_model, pricingUnitCode: listing.policy_pricing_unit_code,
          priceBasisBaseUnits: listing.price_basis_base_units,
        });
        const { orderRow, reservationRow } = newCheckoutRecords(
          context.actorId, listing.supplier_actor_id, {
            capacityLotId: listing.lot_id, listingValidUntil: listing.valid_until,
            descriptor, unitPriceMicros: listing.unit_price_micros,
          }, input,
        );
        if (Date.parse(orderRow.hold_expires_at) <= Date.now() + 30_000) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "距离上架截止或服务开始不足 30 秒，无法建立预留。");
        }
        db.prepare(`INSERT INTO exchange_orders (
          id, buyer_actor_id, supplier_actor_id, idempotency_key, payload_hash,
          listing_version_id, rate_unit_code, rate_units, parallel_units, start_at, end_at,
          capacity_base_units, capacity_gpu_seconds, unit_price_micros, unit_price_cents,
          total_amount_cents, currency, status, hold_expires_at,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          orderRow.id, orderRow.buyer_actor_id, orderRow.supplier_actor_id, context.idempotencyKey, context.payloadHash,
          orderRow.listing_version_id, orderRow.rate_unit_code, orderRow.rate_units, orderRow.parallel_units, orderRow.start_at, orderRow.end_at,
          orderRow.capacity_base_units, orderRow.capacity_gpu_seconds, orderRow.unit_price_micros, orderRow.unit_price_cents,
          orderRow.total_amount_cents, orderRow.currency, orderRow.status, orderRow.hold_expires_at,
          orderRow.version, orderRow.created_at, orderRow.updated_at,
        );
        db.prepare(`INSERT INTO exchange_reservations (
          id, order_id, capacity_lot_id, rate_unit_code, rate_units, parallel_units, start_at, end_at,
          capacity_base_units, capacity_gpu_seconds, state, hold_expires_at, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          reservationRow.id, reservationRow.order_id, reservationRow.capacity_lot_id,
          reservationRow.rate_unit_code, reservationRow.rate_units, reservationRow.parallel_units,
          reservationRow.start_at, reservationRow.end_at,
          reservationRow.capacity_base_units, reservationRow.capacity_gpu_seconds, reservationRow.state,
          reservationRow.hold_expires_at, reservationRow.version, reservationRow.created_at, reservationRow.updated_at,
        );
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) VALUES (?, ?, ?, ?, 'AVAILABLE', 'HELD', ?, ?, ?, 'CHECKOUT_RESERVED', ?)`).run(
          createExchangeTransferId(), listing.lot_id, orderRow.id, `order:${orderRow.id}:hold`,
          orderRow.rate_unit_code, orderRow.capacity_base_units, orderRow.capacity_gpu_seconds, orderRow.created_at,
        );
        const snapshotId = createExchangeSnapshotId();
        const durationSeconds = (Date.parse(orderRow.end_at) - Date.parse(orderRow.start_at)) / 1_000;
        const snapshotDigest = sha256(JSON.stringify({
          orderId: orderRow.id, listingVersionId: orderRow.listing_version_id,
          productVersionId: listing.product_version_id, capacityPolicyId: listing.capacity_policy_id,
          productCode: listing.product_code, rateUnitCode: orderRow.rate_unit_code,
          fulfillmentModel: listing.fulfillment_model, pricingUnitCode: listing.policy_pricing_unit_code,
          rateUnits: orderRow.rate_units, durationSeconds, capacityBaseUnits: orderRow.capacity_base_units,
          unitPriceMicros: orderRow.unit_price_micros, priceBasisBaseUnits: listing.price_basis_base_units,
          grossAmountCents: orderRow.total_amount_cents, currency: orderRow.currency,
          productIdentity: JSON.parse(listing.product_identity_json), sla: JSON.parse(listing.sla_json),
          evidencePolicyVersion: listing.evidence_policy_version,
        }));
        db.prepare(`INSERT INTO exchange_order_contract_snapshots (
          id, order_id, listing_version_id, product_version_id, capacity_policy_id,
          product_code, rate_unit_code, fulfillment_model, pricing_unit_code,
          rate_units, duration_seconds, capacity_base_units, unit_price_micros,
          price_basis_base_units, gross_amount_cents, currency, product_identity_json,
          sla_json, evidence_policy_version, snapshot_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          snapshotId, orderRow.id, orderRow.listing_version_id, listing.product_version_id, listing.capacity_policy_id,
          listing.product_code, orderRow.rate_unit_code, listing.fulfillment_model, listing.policy_pricing_unit_code,
          orderRow.rate_units, durationSeconds, orderRow.capacity_base_units, orderRow.unit_price_micros,
          listing.price_basis_base_units, orderRow.total_amount_cents, orderRow.currency, listing.product_identity_json,
          listing.sla_json, listing.evidence_policy_version, snapshotDigest, orderRow.created_at,
        );
        if (referral.resolvedCodeId !== null && referral.submittedCodeDigest !== null) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_RESOLUTION_INVALID");
        }
        const referralCode = referral.resolvedCodeId
          ? db.prepare("SELECT * FROM exchange_referral_codes WHERE id = ?").get(referral.resolvedCodeId) as ReferralCodeRow | undefined
          : undefined;
        if (referral.resolvedCodeId && !referralCode) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_CODE_MISSING");
        }
        const decisionOutcome = !referral.resolvedCodeId
          ? referral.submittedCodeDigest ? "INVALID" as const : "NONE" as const
          : referralCode?.agent_actor_id === context.actorId
            ? "SELF_BUYER" as const
            : referralCode?.agent_actor_id === listing.supplier_actor_id
              ? "SELF_SUPPLIER" as const
              : "APPLIED" as const;
        const decisionId = createExchangeId("RD");
        db.prepare(`INSERT INTO exchange_referral_decisions (
          id, order_id, outcome, resolved_code_id, submitted_code_digest, decided_at
        ) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            decisionId, orderRow.id, decisionOutcome,
            referral.resolvedCodeId, referral.submittedCodeDigest, orderRow.created_at,
          );
        if (decisionOutcome === "APPLIED" && referralCode) {
          db.prepare(`INSERT INTO exchange_referral_attributions (
            id, order_id, decision_id, referral_code_id, agent_actor_id,
            buyer_actor_id, supplier_actor_id, attributed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              createExchangeId("RAT"), orderRow.id, decisionId, referralCode.id,
              referralCode.agent_actor_id, context.actorId, listing.supplier_actor_id, orderRow.created_at,
            );
        }
        const record = readOrder(db, orderRow.id, "buyer").record;
        insertEvent(db, context.actorId, "ORDER", orderRow.id, "ORDER_CAPACITY_HELD", record, orderRow.created_at);
        return { record, replayed: false };
      });
    },

    async getOrder(actorId, orderId, role) {
      let result = readOrder(db, orderId, role);
      if ((role === "buyer" && result.order.buyer_actor_id !== actorId)
        || (role === "supplier" && result.order.supplier_actor_id !== actorId)) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单不存在。");
      }
      const stalePackage = result.delivery ? db.prepare(`SELECT * FROM exchange_delivery_packages
        WHERE delivery_task_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')
          AND credential_expires_at <= ? ORDER BY revision DESC LIMIT 1`)
        .get(result.delivery.id, new Date().toISOString()) as DeliveryPackageRow | undefined : undefined;
      if (stalePackage) {
        expireDeliveryPackage(db, stalePackage, `system:delivery-expiry:${actorId}`);
        result = readOrder(db, orderId, role);
      }
      return result.record;
    },

    async listOrders(actorId, role) {
      const rows = db.prepare(`SELECT * FROM exchange_orders WHERE ${role === "buyer" ? "buyer_actor_id" : "supplier_actor_id"} = ?
        ORDER BY created_at DESC`).all(actorId) as OrderRow[];
      return rows.map((order) => {
        const stalePackage = db.prepare(`SELECT * FROM exchange_delivery_packages
          WHERE order_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')
            AND credential_expires_at <= ? ORDER BY revision DESC LIMIT 1`)
          .get(order.id, new Date().toISOString()) as DeliveryPackageRow | undefined;
        if (stalePackage) expireDeliveryPackage(db, stalePackage, `system:delivery-expiry:${actorId}`);
        return readOrder(db, order.id, role).record;
      });
    },

    async confirmOrder(orderId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "SUPPLIER_CONFIRMATION" || receipt.entity_id !== orderId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: readOrder(db, orderId, "supplier").record, replayed: true };
      }
      const preflight = readOrder(db, orderId);
      if (preflight.order.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以确认容量。");
      }
      if (preflight.order.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
      }
      if (preflight.order.status !== "PENDING_SUPPLIER_CONFIRMATION" || preflight.reservation.state !== "HELD") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能执行供应商确认。");
      }
      if (preflight.order.hold_expires_at <= new Date().toISOString()) {
        withTransaction(db, () => expireReservations(db, preflight.reservation.capacity_lot_id, new Date().toISOString()));
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "容量预留已过期。");
      }
      return withTransaction(db, () => {
        const current = readOrder(db, orderId);
        if (current.order.supplier_actor_id !== context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以确认容量。");
        }
        if (current.order.version !== input.expectedVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
        }
        const now = new Date().toISOString();
        if (current.order.status !== "PENDING_SUPPLIER_CONFIRMATION" || current.reservation.state !== "HELD") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能执行供应商确认。");
        }
        if (current.order.hold_expires_at <= now) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "容量预留已过期。");
        }
        const nextHold = input.action === "CONFIRM"
          ? new Date(Math.min(Date.now() + 30 * 60 * 1_000, Date.parse(current.order.start_at))).toISOString()
          : current.order.hold_expires_at;
        db.prepare(`UPDATE exchange_orders SET status = ?, hold_expires_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?`).run(
          input.action === "CONFIRM" ? "AWAITING_PAYMENT" : "CANCELLED", nextHold, now, orderId, input.expectedVersion,
        );
        db.prepare(`UPDATE exchange_reservations SET state = ?, hold_expires_at = ?, version = version + 1, updated_at = ?
          WHERE order_id = ? AND state = 'HELD'`).run(
          input.action === "CONFIRM" ? "SUPPLIER_CONFIRMED" : "RELEASED", nextHold, now, orderId,
        );
        if (input.action === "REJECT") {
          db.prepare(`INSERT INTO exchange_capacity_transfers (
            id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
            rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
          ) VALUES (?, ?, ?, ?, 'HELD', 'AVAILABLE', ?, ?, ?, 'SUPPLIER_REJECTED', ?)`).run(
            createExchangeTransferId(), current.reservation.capacity_lot_id, orderId,
            `order:${orderId}:supplier-rejected`, current.order.rate_unit_code,
            current.order.capacity_base_units, current.order.capacity_gpu_seconds, now,
          );
        }
        if (input.action === "CONFIRM") {
          db.prepare(`INSERT INTO exchange_payment_intents (
            id, order_id, provider, environment, merchant_account_ref, amount_cents, currency,
            status, provider_payment_id, expires_at, version, created_at, updated_at
          ) VALUES (?, ?, 'SIMULATED', 'TEST', 'KAI-CLOUD-TEST-CNY', ?, 'CNY', 'PENDING', NULL, ?, 1, ?, ?)`)
            .run(createExchangeId("PI"), orderId, current.order.total_amount_cents, nextHold, now, now);
          db.prepare(`INSERT INTO exchange_order_lifecycle (order_id, phase, state_reason, version, updated_at)
            VALUES (?, 'AWAITING_PAYMENT', 'SUPPLIER_CONFIRMED', 1, ?)
            ON CONFLICT(order_id) DO UPDATE SET phase = 'AWAITING_PAYMENT', state_reason = 'SUPPLIER_CONFIRMED',
              version = exchange_order_lifecycle.version + 1, updated_at = excluded.updated_at`).run(orderId, now);
        } else {
          db.prepare(`INSERT INTO exchange_order_lifecycle (order_id, phase, state_reason, version, updated_at)
            VALUES (?, 'EXCEPTION', 'SUPPLIER_REJECTED', 1, ?)
            ON CONFLICT(order_id) DO UPDATE SET phase = 'EXCEPTION', state_reason = 'SUPPLIER_REJECTED',
              version = exchange_order_lifecycle.version + 1, updated_at = excluded.updated_at`).run(orderId, now);
        }
        const updated = readOrder(db, orderId, "supplier").record;
        insertEvent(db, context.actorId, "ORDER", orderId, `SUPPLIER_${input.action}`, { decision: input.action }, now);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'SUPPLIER_CONFIRMATION', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(updated), now,
        );
        return { record: updated, replayed: false };
      });
    },

    async applyPaymentEvent(context, input) {
      const existing = db.prepare(`SELECT * FROM exchange_payment_events
        WHERE provider = ? AND environment = ? AND provider_event_id = ?`)
        .get(input.provider, input.environment, input.providerEventId) as PaymentEventRow | undefined;
      if (existing) {
        if (existing.payload_hash !== context.payloadHash || existing.raw_payload_digest !== input.rawPayloadDigest) {
          throw new ExchangeIdempotencyConflictError();
        }
        if (existing.outcome === "REVIEW_REQUIRED") {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_REVIEW_REQUIRED", 422, "支付事件与平台支付订单不匹配，已进入人工核对。");
        }
        if (existing.outcome === "LATE_CAPTURE_REVIEW") {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用，已进入退款与人工核对。");
        }
        if (existing.outcome === "IGNORED_DUPLICATE_TRANSACTION") {
          const applied = db.prepare(`SELECT * FROM exchange_payment_events
            WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
            .get(existing.provider, existing.environment, existing.provider_transaction_id) as PaymentEventRow | undefined;
          if (!applied) throw new Error("CAPTURED_PAYMENT_EVENT_MISSING");
          const appliedPayment = db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
            .get(applied.payment_intent_id) as PaymentIntentRow;
          return { record: readOrder(db, appliedPayment.order_id, "buyer").record, replayed: true };
        }
        const payment = db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .get(existing.payment_intent_id) as PaymentIntentRow;
        return { record: readOrder(db, payment.order_id, "buyer").record, replayed: true };
      }

      const payment = db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
        .get(input.providerOrderId) as PaymentIntentRow | undefined;
      if (!payment) throw new ExchangeDomainError("EXCHANGE_PAYMENT_ORDER_NOT_FOUND", 404, "支付订单不存在。");
      const receivedAt = new Date().toISOString();
      const current = readOrder(db, payment.order_id);
      if (!current.snapshot || current.snapshot.grossAmountCents !== current.order.total_amount_cents
        || current.snapshot.grossAmountCents !== payment.amount_cents) {
        throw new Error("EXCHANGE_INVARIANT_CORRUPTION:PAYMENT_SNAPSHOT_AMOUNT_MISMATCH");
      }
      const mismatch = payment.provider !== input.provider
        || payment.environment !== input.environment
        || payment.merchant_account_ref !== input.merchantAccountRef
        || payment.amount_cents !== input.amountCents
        || payment.currency !== input.currency
        || input.environment !== "TEST"
        || input.provider !== "SIMULATED"
        || input.fundsMoved;
      if (mismatch) {
        insertPaymentEvent(db, context, input, "REVIEW_REQUIRED", receivedAt);
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_REVIEW_REQUIRED", 422, "支付事件与平台支付订单不匹配，已进入人工核对。");
      }

      const duplicateTransaction = db.prepare(`SELECT * FROM exchange_payment_events
        WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
        .get(input.provider, input.environment, input.providerTransactionId) as PaymentEventRow | undefined;
      if (duplicateTransaction) {
        insertPaymentEvent(db, context, input, "IGNORED_DUPLICATE_TRANSACTION", receivedAt);
        const capturedPayment = db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .get(duplicateTransaction.payment_intent_id) as PaymentIntentRow;
        return { record: readOrder(db, capturedPayment.order_id, "buyer").record, replayed: true };
      }

      if (payment.status === "CAPTURED") {
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_ALREADY_CAPTURED", 409, "该支付订单已经确认，不能创建第二笔测试支付。");
      }

      if (current.order.status !== "AWAITING_PAYMENT" || current.reservation.state !== "SUPPLIER_CONFIRMED"
        || payment.status !== "PENDING" || current.reservation.hold_expires_at <= receivedAt || payment.expires_at <= receivedAt) {
        if (current.reservation.state === "SUPPLIER_CONFIRMED" && current.reservation.hold_expires_at <= receivedAt) {
          withTransaction(db, () => expireReservations(db, current.reservation.capacity_lot_id, receivedAt));
        }
        insertPaymentEvent(db, context, input, "LATE_CAPTURE_REVIEW", receivedAt);
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用，已进入退款与人工核对。");
      }

      return withTransaction(db, () => {
        const locked = readOrder(db, payment.order_id);
        const lockedPayment = db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .get(payment.id) as PaymentIntentRow;
        const now = new Date().toISOString();
        if (locked.order.status !== "AWAITING_PAYMENT" || locked.reservation.state !== "SUPPLIER_CONFIRMED"
          || lockedPayment.status !== "PENDING" || locked.reservation.hold_expires_at <= now || lockedPayment.expires_at <= now) {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用。");
        }
        if (!locked.snapshot || locked.snapshot.grossAmountCents !== locked.order.total_amount_cents
          || locked.snapshot.grossAmountCents !== lockedPayment.amount_cents) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:PAYMENT_SNAPSHOT_AMOUNT_MISMATCH");
        }
        const deliverySource = db.prepare(`SELECT lv.delivery_form, cl.resource_asset_id, ra.product_version_id
          FROM exchange_orders o
          JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
          JOIN exchange_capacity_lots cl ON cl.id = lv.capacity_lot_id
          JOIN exchange_resource_assets ra ON ra.id = cl.resource_asset_id
          WHERE o.id = ?`).get(locked.order.id) as { delivery_form: string; resource_asset_id: string; product_version_id: string };
        const paymentEventId = createExchangeId("PE");
        const lockTransferId = createExchangeTransferId();
        const deliveryTaskId = createExchangeId("DT");
        const meteringSessionId = createExchangeId("MS");
        insertPaymentEvent(db, context, input, "APPLIED", now, paymentEventId);
        const paymentUpdate = db.prepare(`UPDATE exchange_payment_intents
          SET status = 'CAPTURED', provider_payment_id = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'PENDING'`).run(input.providerTransactionId, now, payment.id);
        const reservationUpdate = db.prepare(`UPDATE exchange_reservations
          SET state = 'COMMITTED', version = version + 1, updated_at = ?
          WHERE id = ? AND state = 'SUPPLIER_CONFIRMED' AND hold_expires_at > ?`)
          .run(now, locked.reservation.id, now);
        const orderUpdate = db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'AWAITING_PAYMENT'`).run(now, locked.order.id);
        if (paymentUpdate.changes !== 1 || reservationUpdate.changes !== 1 || orderUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_STATE_CONFLICT", 409, "支付应用时订单状态已变化。");
        }
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) VALUES (?, ?, ?, ?, 'HELD', 'LOCKED', ?, ?, ?, 'PAYMENT_CAPTURED', ?)`).run(
          lockTransferId, locked.reservation.capacity_lot_id, locked.order.id,
          `order:${locked.order.id}:payment-locked`, locked.order.rate_unit_code,
          locked.order.capacity_base_units, locked.order.capacity_gpu_seconds, now,
        );
        db.prepare(`INSERT INTO exchange_order_lifecycle (order_id, phase, state_reason, version, updated_at)
          VALUES (?, 'FULFILLING', 'TEST_PAYMENT_CAPTURED', 1, ?)
          ON CONFLICT(order_id) DO UPDATE SET phase = 'FULFILLING', state_reason = 'TEST_PAYMENT_CAPTURED',
            version = exchange_order_lifecycle.version + 1, updated_at = excluded.updated_at`).run(locked.order.id, now);
        const provisioningDueAt = new Date(Math.min(Date.parse(locked.order.start_at), Date.now() + 4 * 60 * 60 * 1_000)).toISOString();
        db.prepare(`INSERT INTO exchange_delivery_tasks (
          id, order_id, payment_event_id, reservation_id, capacity_lot_id, listing_version_id,
          resource_asset_id, product_version_id, lock_transfer_id, parallel_units, start_at, end_at,
          delivery_form, method, status, attempt, evidence_policy_version, provisioning_due_at,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'PENDING', 0, ?, ?, 1, ?, ?)`).run(
          deliveryTaskId, locked.order.id, paymentEventId, locked.reservation.id, locked.reservation.capacity_lot_id,
          locked.order.listing_version_id, deliverySource.resource_asset_id, deliverySource.product_version_id, lockTransferId,
          locked.order.rate_units, locked.order.start_at, locked.order.end_at, deliverySource.delivery_form,
          locked.snapshot.evidencePolicyVersion, provisioningDueAt, now, now,
        );
        db.prepare(`INSERT INTO exchange_metering_sessions (
          id, order_id, payment_event_id, delivery_task_id, reservation_id, environment, status,
          scheduled_start_at, scheduled_end_at, actual_start_at, finalized_at,
          rate_unit_code, reserved_rate_units,
          scheduled_capacity_base_units, available_capacity_base_units,
          unavailable_capacity_base_units, unproven_capacity_base_units,
          scheduled_gpu_seconds, available_gpu_seconds, unavailable_gpu_seconds, unproven_gpu_seconds,
          availability_ppm, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'TEST', 'SCHEDULED', ?, ?, NULL, NULL,
          ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`).run(
          meteringSessionId, locked.order.id, paymentEventId, deliveryTaskId, locked.reservation.id,
          locked.order.start_at, locked.order.end_at, locked.order.rate_unit_code, locked.order.rate_units,
          locked.order.capacity_base_units, locked.order.capacity_base_units,
          locked.order.rate_unit_code === "GPU" ? locked.order.capacity_base_units : null,
          locked.order.rate_unit_code === "GPU" ? 0 : null,
          locked.order.rate_unit_code === "GPU" ? 0 : null,
          locked.order.rate_unit_code === "GPU" ? locked.order.capacity_base_units : null,
          now, now,
        );
        insertEvent(db, context.actorId, "ORDER", locked.order.id, "PAYMENT_CAPTURED", { paymentEventId, fundsMoved: false }, now);
        insertEvent(db, context.actorId, "ORDER", locked.order.id, "CAPACITY_LOCKED", { lockTransferId }, now);
        insertEvent(db, context.actorId, "ORDER", locked.order.id, "DELIVERY_TASK_CREATED", { deliveryTaskId }, now);
        insertEvent(db, context.actorId, "ORDER", locked.order.id, "METERING_SCHEDULED", {
          meteringSessionId,
          environment: "TEST",
          fundsMoved: false,
        }, now);
        return { record: readOrder(db, locked.order.id, "buyer").record, replayed: false };
      });
    },

    async startProvisioning(orderId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "START_PROVISIONING" || receipt.entity_id !== orderId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: readOrder(db, orderId, "supplier").record, replayed: true };
      }
      const preflight = readOrder(db, orderId, "supplier");
      if (preflight.order.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以开始开通。");
      }
      if (preflight.order.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
      }
      return withTransaction(db, () => {
        const current = readOrder(db, orderId, "supplier");
        if (current.order.supplier_actor_id !== context.actorId || current.order.version !== input.expectedVersion
          || current.record.status !== "FULFILLING" || current.payment?.status !== "CAPTURED"
          || current.reservation.state !== "COMMITTED" || current.delivery?.status !== "PENDING") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能开始开通。");
        }
        const now = new Date().toISOString();
        const deliveryUpdate = db.prepare(`UPDATE exchange_delivery_tasks
          SET status = 'PROVISIONING', attempt = attempt + 1, version = version + 1, updated_at = ?
          WHERE order_id = ? AND status = 'PENDING'`).run(now, orderId);
        const orderUpdate = db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
          .run(now, orderId, input.expectedVersion);
        if (deliveryUpdate.changes !== 1 || orderUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单状态已变化，请刷新后重试。");
        }
        insertEvent(db, context.actorId, "ORDER", orderId, "PROVISIONING_STARTED", { command: "START_PROVISIONING" }, now);
        const updated = readOrder(db, orderId, "supplier").record;
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'START_PROVISIONING', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(updated), now,
        );
        return { record: updated, replayed: false };
      });
    },

    async listOpsDeliveryPackages() {
      const stale = db.prepare(`SELECT * FROM exchange_delivery_packages
        WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') AND credential_expires_at <= ?`)
        .all(new Date().toISOString()) as DeliveryPackageRow[];
      for (const row of stale) expireDeliveryPackage(db, row, "system:delivery-expiry:ops");
      return (db.prepare(`SELECT * FROM exchange_delivery_packages
        ORDER BY created_at DESC, revision DESC`).all() as DeliveryPackageRow[])
        .map((row) => readDeliveryPackage(db, row, "ops"));
    },

    async submitDeliveryPackage(deliveryTaskId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "SUBMIT_DELIVERY_PACKAGE"
          || receipt.entity_id !== deliveryTaskId) throw new ExchangeIdempotencyConflictError();
        return { record: JSON.parse(receipt.response_json), replayed: true };
      }
      const preflight = db.prepare(`SELECT dt.*, o.supplier_actor_id, o.rate_unit_code, ra.region
        FROM exchange_delivery_tasks dt
        JOIN exchange_orders o ON o.id = dt.order_id
        JOIN exchange_resource_assets ra ON ra.id = dt.resource_asset_id
        WHERE dt.id = ?`).get(deliveryTaskId) as
        | (DeliveryTaskRow & { supplier_actor_id: string; rate_unit_code: OrderRow["rate_unit_code"]; region: string })
        | undefined;
      if (!preflight) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付任务不存在。");
      if (preflight.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以提交交付包。");
      }
      if ((preflight.rate_unit_code === "GIB_STORAGE" && input.publicProfile.protocol !== "NFS")
        || (preflight.rate_unit_code === "RACK" && input.publicProfile.protocol !== "WORK_ORDER")) {
        throw new ExchangeDomainError("EXCHANGE_UNIT_MISMATCH", 422, "交付协议与产品容量政策不匹配。");
      }
      if (preflight.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付任务版本已变化，请刷新后重试。");
      }
      if (preflight.status !== "PROVISIONING") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "交付任务当前不能提交交付包。");
      }
      return withTransaction(db, () => {
        const current = db.prepare(`SELECT dt.*, o.supplier_actor_id, ra.region
          FROM exchange_delivery_tasks dt
          JOIN exchange_orders o ON o.id = dt.order_id
          JOIN exchange_resource_assets ra ON ra.id = dt.resource_asset_id
          WHERE dt.id = ?`).get(deliveryTaskId) as DeliveryTaskRow & { supplier_actor_id: string; region: string };
        if (current.supplier_actor_id !== context.actorId || current.version !== input.expectedVersion || current.status !== "PROVISIONING") {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付任务状态已变化，请刷新后重试。");
        }
        const active = db.prepare(`SELECT id FROM exchange_delivery_packages
          WHERE delivery_task_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') LIMIT 1`)
          .get(deliveryTaskId) as { id: string } | undefined;
        if (active) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该交付任务已有生效中的交付包。");
        const revisionRow = db.prepare(`SELECT COALESCE(MAX(revision), 0) + 1 AS revision
          FROM exchange_delivery_packages WHERE delivery_task_id = ?`).get(deliveryTaskId) as { revision: number };
        const now = new Date().toISOString();
        const row: DeliveryPackageRow = {
          id: createExchangeId("DP"),
          delivery_task_id: deliveryTaskId,
          order_id: current.order_id,
          supplier_actor_id: context.actorId,
          revision: revisionRow.revision,
          environment: "TEST",
          status: "SUBMITTED",
          public_profile_json: JSON.stringify({
            ...input.publicProfile,
            region: current.region,
            deliveryForm: current.delivery_form,
            credentialKind: "ONE_TIME_TEST_CODE",
          }),
          submission_evidence_digest: input.evidenceDigest,
          credential_expires_at: input.publicProfile.expiresAt,
          version: 1,
          created_at: now,
          updated_at: now,
        };
        db.prepare(`INSERT INTO exchange_delivery_packages (
          id, delivery_task_id, order_id, supplier_actor_id, revision, environment, status,
          public_profile_json, submission_evidence_digest, credential_expires_at,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'TEST', 'SUBMITTED', ?, ?, ?, 1, ?, ?)`).run(
          row.id, row.delivery_task_id, row.order_id, row.supplier_actor_id, row.revision,
          row.public_profile_json, row.submission_evidence_digest, row.credential_expires_at, now, now,
        );
        const taskUpdate = db.prepare(`UPDATE exchange_delivery_tasks
          SET status = 'VERIFYING', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'PROVISIONING' AND version = ?`).run(now, deliveryTaskId, input.expectedVersion);
        if (taskUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付任务状态已变化，请刷新后重试。");
        }
        db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?").run(now, current.order_id);
        const record = readDeliveryPackage(db, row, "supplier");
        insertEvent(db, context.actorId, "DELIVERY_PACKAGE", row.id, "DELIVERY_PACKAGE_SUBMITTED", {
          deliveryTaskId,
          revision: row.revision,
          environment: "TEST",
          evidenceDigest: row.submission_evidence_digest,
        }, now);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'SUBMIT_DELIVERY_PACKAGE', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, deliveryTaskId, JSON.stringify(record), now,
        );
        return { record, replayed: false };
      });
    },

    async reviewDeliveryPackage(packageId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "REVIEW_DELIVERY_PACKAGE"
          || receipt.entity_id !== packageId) throw new ExchangeIdempotencyConflictError();
        return { record: JSON.parse(receipt.response_json), replayed: true };
      }
      const preflight = db.prepare("SELECT * FROM exchange_delivery_packages WHERE id = ?")
        .get(packageId) as DeliveryPackageRow | undefined;
      if (!preflight) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      if (preflight.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
      }
      if (preflight.credential_expires_at <= new Date().toISOString()) {
        expireDeliveryPackage(db, preflight, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请供应商重新提交。");
      }
      return withTransaction(db, () => {
        const current = db.prepare("SELECT * FROM exchange_delivery_packages WHERE id = ?")
          .get(packageId) as DeliveryPackageRow;
        const task = db.prepare("SELECT * FROM exchange_delivery_tasks WHERE id = ?")
          .get(current.delivery_task_id) as DeliveryTaskRow;
        if (current.version !== input.expectedVersion || current.status !== "SUBMITTED" || task.status !== "VERIFYING") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "交付包当前不能核验。");
        }
        const now = new Date().toISOString();
        const reviewRow: DeliveryReviewRow = {
          id: createExchangeId("DR"),
          package_id: packageId,
          delivery_task_id: current.delivery_task_id,
          reviewer_actor_id: context.actorId,
          decision: input.decision,
          verification_method: input.verificationMethod,
          reason: input.reason,
          evidence_digest: input.evidenceDigest,
          created_at: now,
        };
        db.prepare(`INSERT INTO exchange_delivery_reviews (
          id, package_id, delivery_task_id, reviewer_actor_id, decision, verification_method,
          reason, evidence_digest, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          reviewRow.id, packageId, reviewRow.delivery_task_id, context.actorId, input.decision,
          input.verificationMethod, input.reason, input.evidenceDigest, now,
        );
        const packageStatus = input.decision === "PASS" ? "VERIFIED" : "REJECTED";
        const packageUpdate = db.prepare(`UPDATE exchange_delivery_packages
          SET status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'SUBMITTED' AND version = ?`).run(packageStatus, now, packageId, input.expectedVersion);
        const taskUpdate = db.prepare(`UPDATE exchange_delivery_tasks
          SET status = ?, attempt = attempt + ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'VERIFYING'`).run(
          input.decision === "PASS" ? "DELIVERED" : "PROVISIONING",
          input.decision === "PASS" ? 0 : 1,
          now,
          current.delivery_task_id,
        );
        if (packageUpdate.changes !== 1 || taskUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包状态已变化，请刷新后重试。");
        }
        db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?").run(now, current.order_id);
        const updatedRow = db.prepare("SELECT * FROM exchange_delivery_packages WHERE id = ?")
          .get(packageId) as DeliveryPackageRow;
        const record = readDeliveryPackage(db, updatedRow, "ops");
        insertEvent(db, context.actorId, "DELIVERY_PACKAGE", packageId, `DELIVERY_PACKAGE_${packageStatus}`, {
          deliveryTaskId: current.delivery_task_id,
          reviewId: reviewRow.id,
          verificationMethod: reviewRow.verification_method,
          evidenceDigest: reviewRow.evidence_digest,
        }, now);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'REVIEW_DELIVERY_PACKAGE', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, packageId, JSON.stringify(record), now,
        );
        return { record, replayed: false };
      });
    },

    async claimDeliveryPackage(packageId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "CLAIM_DELIVERY_PACKAGE"
          || receipt.entity_id !== packageId) throw new ExchangeIdempotencyConflictError();
        throw new ExchangeDomainError(
          "EXCHANGE_DELIVERY_ALREADY_CLAIMED",
          410,
          "一次性测试码已经显示，不能重复领取；如未保存，请联系平台重发新的交付包版本。",
        );
      }
      const preflight = db.prepare(`SELECT dp.*, o.buyer_actor_id, dt.status AS task_status
        FROM exchange_delivery_packages dp
        JOIN exchange_orders o ON o.id = dp.order_id
        JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
        WHERE dp.id = ?`).get(packageId) as (DeliveryPackageRow & { buyer_actor_id: string; task_status: string }) | undefined;
      if (!preflight || preflight.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      }
      if (preflight.credential_expires_at <= new Date().toISOString()) {
        expireDeliveryPackage(db, preflight, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请联系平台重发。");
      }
      if (preflight.status === "CLAIMED") {
        throw new ExchangeDomainError(
          "EXCHANGE_DELIVERY_ALREADY_CLAIMED",
          410,
          "一次性测试码已经显示，不能重复领取；如未保存，请联系平台重发新的交付包版本。",
        );
      }
      if (preflight.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
      }
      if (preflight.status !== "VERIFIED" || preflight.task_status !== "DELIVERED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "交付包通过平台核验后才能领取。");
      }
      const testCode = oneTimeTestCode();
      const codeDigest = sha256(testCode);
      return withTransaction(db, () => {
        const current = db.prepare(`SELECT dp.*, o.buyer_actor_id, dt.status AS task_status
          FROM exchange_delivery_packages dp
          JOIN exchange_orders o ON o.id = dp.order_id
          JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
          WHERE dp.id = ?`).get(packageId) as DeliveryPackageRow & { buyer_actor_id: string; task_status: string };
        if (current.buyer_actor_id !== context.actorId || current.status !== "VERIFIED"
          || current.task_status !== "DELIVERED" || current.version !== input.expectedVersion) {
          if (current.status === "CLAIMED") {
            throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经被领取。");
          }
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包状态已变化，请刷新后重试。");
        }
        const now = new Date().toISOString();
        const claimRow: DeliveryClaimRow = {
          id: createExchangeId("DC"),
          package_id: packageId,
          order_id: current.order_id,
          buyer_actor_id: context.actorId,
          claim_code_digest: codeDigest,
          claimed_at: now,
        };
        db.prepare(`INSERT INTO exchange_delivery_claims (
          id, package_id, order_id, buyer_actor_id, claim_code_digest, claimed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(
          claimRow.id, packageId, current.order_id, context.actorId, claimRow.claim_code_digest, now,
        );
        const packageUpdate = db.prepare(`UPDATE exchange_delivery_packages
          SET status = 'CLAIMED', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'VERIFIED' AND version = ?`).run(now, packageId, input.expectedVersion);
        if (packageUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经被领取。");
        }
        db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?").run(now, current.order_id);
        insertEvent(db, context.actorId, "DELIVERY_PACKAGE", packageId, "DELIVERY_PACKAGE_CLAIMED", {
          claimId: claimRow.id,
        }, now);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'CLAIM_DELIVERY_PACKAGE', ?, ?, ?)`).run(
          context.actorId,
          context.idempotencyKey,
          context.payloadHash,
          packageId,
          JSON.stringify({ packageId, claimId: claimRow.id }),
          now,
        );
        const updatedRow = db.prepare("SELECT * FROM exchange_delivery_packages WHERE id = ?")
          .get(packageId) as DeliveryPackageRow;
        const record = readDeliveryPackage(db, updatedRow, "buyer");
        return { record: { package: record, testCode }, replayed: false };
      });
    },

    async testDeliveryConnection(packageId, context, input) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "TEST_DELIVERY_CONNECTION"
          || receipt.entity_id !== packageId) throw new ExchangeIdempotencyConflictError();
        return { record: JSON.parse(receipt.response_json), replayed: true };
      }
      const preflight = db.prepare(`SELECT dp.*, o.buyer_actor_id
        FROM exchange_delivery_packages dp
        JOIN exchange_orders o ON o.id = dp.order_id
        WHERE dp.id = ?`).get(packageId) as (DeliveryPackageRow & { buyer_actor_id: string }) | undefined;
      if (!preflight || preflight.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      }
      if (preflight.credential_expires_at <= new Date().toISOString()) {
        expireDeliveryPackage(db, preflight, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请联系平台重发。");
      }
      return withTransaction(db, () => {
        const current = db.prepare(`SELECT dp.*, o.buyer_actor_id, dt.status AS task_status
          FROM exchange_delivery_packages dp
          JOIN exchange_orders o ON o.id = dp.order_id
          JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
          WHERE dp.id = ?`).get(packageId) as (DeliveryPackageRow & { buyer_actor_id: string; task_status: string }) | undefined;
        if (!current || current.buyer_actor_id !== context.actorId) {
          throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
        }
        if (current.credential_expires_at <= new Date().toISOString()) {
          throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请联系平台重发。");
        }
        if (current.version !== input.expectedVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
        }
        const claim = db.prepare("SELECT * FROM exchange_delivery_claims WHERE package_id = ?")
          .get(packageId) as DeliveryClaimRow | undefined;
        if (current.status !== "CLAIMED" || current.task_status !== "DELIVERED" || !claim) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "领取一次性测试码后才能测试连接。");
        }
        const latest = db.prepare(`SELECT * FROM exchange_connection_checks
          WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).get(packageId) as ConnectionCheckRow | undefined;
        if (latest?.status === "PASSED") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试连接已经通过，无需重复执行。");
        }
        if (latest && latest.attempt >= 3) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "测试连接次数已达上限，请联系平台处理。");
        }
        const now = new Date().toISOString();
        const checkId = createExchangeId("CC");
        const row: ConnectionCheckRow = {
          id: checkId,
          package_id: packageId,
          delivery_task_id: current.delivery_task_id,
          order_id: current.order_id,
          buyer_actor_id: context.actorId,
          attempt: (latest?.attempt ?? 0) + 1,
          adapter: "SIMULATED_TEST",
          status: "PASSED",
          diagnostic_code: "SIMULATED_ENDPOINT_REACHABLE",
          summary: "测试适配器确认连接流程可达；此结果不代表开始计费、服务完成或最终验收。",
          evidence_digest: sha256(`${checkId}:${packageId}:SIMULATED_TEST:PASSED`),
          started_at: now,
          finished_at: now,
          created_at: now,
        };
        db.prepare(`INSERT INTO exchange_connection_checks (
          id, package_id, delivery_task_id, order_id, buyer_actor_id, attempt,
          adapter, status, diagnostic_code, summary, evidence_digest, started_at, finished_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'SIMULATED_TEST', 'PASSED', ?, ?, ?, ?, ?, ?)`).run(
          row.id, row.package_id, row.delivery_task_id, row.order_id, row.buyer_actor_id, row.attempt,
          row.diagnostic_code, row.summary, row.evidence_digest, row.started_at, row.finished_at, row.created_at,
        );
        insertEvent(db, context.actorId, "DELIVERY_PACKAGE", packageId, "DELIVERY_READINESS", {
          connectionCheckId: row.id,
          adapter: row.adapter,
          status: row.status,
        }, now);
        const record = mapConnectionCheck(row);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'TEST_DELIVERY_CONNECTION', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, packageId, JSON.stringify(record), now,
        );
        return { record, replayed: false };
      });
    },

    async listOpsMeteringOrders() {
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      const stalePackages = db.prepare(`SELECT * FROM exchange_delivery_packages
        WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') AND credential_expires_at <= ?
        ORDER BY created_at, revision`).all(serverNow) as DeliveryPackageRow[];
      for (const stalePackage of stalePackages) {
        expireDeliveryPackage(db, stalePackage, "system:delivery-expiry:ops-metering", serverNow);
      }
      const rows = db.prepare(`SELECT o.id FROM exchange_orders o
        JOIN exchange_metering_sessions ms ON ms.order_id = o.id
        ORDER BY o.created_at DESC`).all() as Array<{ id: string }>;
      return rows.map((row) => readOrder(db, row.id, "ops").record);
    },

    async testStartService(orderId: string, context: Parameters<NonNullable<ExchangeStore["testStartService"]>>[1], input: TestServiceStart) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "TEST_SERVICE_START"
          || receipt.entity_id !== orderId) throw new ExchangeIdempotencyConflictError();
        return { record: readOrder(db, orderId, "ops").record, replayed: true };
      }
      const preflight = readOrder(db, orderId, "ops");
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      if (!preflight.metering) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单计量会话不存在。");
      if (preflight.metering.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "计量会话版本已变化，请刷新后重试。");
      }
      const readiness = db.prepare(`SELECT dp.*,
          CASE WHEN (SELECT cc.status FROM exchange_connection_checks cc
            WHERE cc.package_id = dp.id ORDER BY cc.attempt DESC LIMIT 1) = 'PASSED'
            THEN 1 ELSE 0 END AS has_passed_connection
        FROM exchange_delivery_packages dp WHERE dp.order_id = ?
        ORDER BY dp.revision DESC LIMIT 1`).get(orderId) as (DeliveryPackageRow & { has_passed_connection: number }) | undefined;
      if (readiness && readiness.credential_expires_at <= serverNow
        && ["SUBMITTED", "VERIFIED", "CLAIMED", "EXPIRED"].includes(readiness.status)) {
        if (["SUBMITTED", "VERIFIED", "CLAIMED"].includes(readiness.status)) {
          expireDeliveryPackage(db, readiness, context.actorId, serverNow);
        }
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请供应商重新提交并完成领取与连接检查。");
      }
      if (!readiness || readiness.status !== "CLAIMED" || !readiness.has_passed_connection) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试交付包完成领取且连接检查通过后才能开始服务。");
      }
      if (serverNow < preflight.order.start_at || serverNow >= preflight.order.end_at) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试服务只能在订单固定服务时间窗内开始。");
      }
      return withTransaction(db, () => {
        const current = readOrder(db, orderId, "ops");
        if (!current.metering || current.metering.version !== input.expectedVersion
          || current.metering.status !== "SCHEDULED" || current.payment?.status !== "CAPTURED"
          || current.payment.environment !== "TEST" || current.delivery?.status !== "DELIVERED"
          || current.reservation.state !== "COMMITTED" || current.lifecycle?.phase !== "FULFILLING") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能开始测试服务。");
        }
        const currentReadiness = db.prepare(`SELECT dp.*,
            CASE WHEN (SELECT cc.status FROM exchange_connection_checks cc
              WHERE cc.package_id = dp.id ORDER BY cc.attempt DESC LIMIT 1) = 'PASSED'
              THEN 1 ELSE 0 END AS has_passed_connection
          FROM exchange_delivery_packages dp WHERE dp.order_id = ?
          ORDER BY dp.revision DESC LIMIT 1`).get(orderId) as (DeliveryPackageRow & { has_passed_connection: number }) | undefined;
        if (!currentReadiness || currentReadiness.status !== "CLAIMED" || !currentReadiness.has_passed_connection
          || currentReadiness.credential_expires_at <= serverNow) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试交付就绪状态已变化，请刷新后重试。");
        }
        const meteringUpdate = db.prepare(`UPDATE exchange_metering_sessions
          SET status = 'ACTIVE', actual_start_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'SCHEDULED' AND version = ?`).run(
          serverNow, serverNow, current.metering.id, input.expectedVersion,
        );
        const deliveryUpdate = db.prepare(`UPDATE exchange_delivery_tasks
          SET status = 'IN_SERVICE', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'DELIVERED'`).run(serverNow, current.delivery.id);
        const reservationUpdate = db.prepare(`UPDATE exchange_reservations
          SET state = 'IN_SERVICE', version = version + 1, updated_at = ?
          WHERE id = ? AND state = 'COMMITTED'`).run(serverNow, current.reservation.id);
        if (meteringUpdate.changes !== 1 || deliveryUpdate.changes !== 1 || reservationUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试服务状态已变化，请刷新后重试。");
        }
        const transferId = createExchangeTransferId();
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) VALUES (?, ?, ?, ?, 'LOCKED', 'IN_SERVICE', ?, ?, ?, 'TEST_SERVICE_STARTED', ?)`).run(
          transferId, current.reservation.capacity_lot_id, orderId,
          `order:${orderId}:test-service-start`, current.order.rate_unit_code,
          current.order.capacity_base_units, current.order.capacity_gpu_seconds, serverNow,
        );
        const factId = createExchangeId("SF");
        const evidenceDigest = sha256(`${factId}:${orderId}:${serverNow}:TEST_SERVICE_STARTED`);
        db.prepare(`INSERT INTO exchange_service_facts (
          id, metering_session_id, order_id, fact_type, environment, effective_start_at,
          effective_end_at, rate_unit_code, available_capacity_base_units,
          available_gpu_seconds, evidence_digest, created_at
        ) VALUES (?, ?, ?, 'TEST_SERVICE_STARTED', 'TEST', ?, NULL, ?, 0, ?, ?, ?)`).run(
          factId, current.metering.id, orderId, serverNow, current.order.rate_unit_code,
          current.order.rate_unit_code === "GPU" ? 0 : null, evidenceDigest, serverNow,
        );
        db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?")
          .run(serverNow, orderId);
        insertEvent(db, context.actorId, "ORDER", orderId, "TEST_SERVICE_STARTED", {
          meteringSessionId: current.metering.id,
          serviceFactId: factId,
          capacityTransferId: transferId,
          effectiveAt: serverNow,
          fundsMoved: false,
        }, serverNow);
        const record = readOrder(db, orderId, "ops").record;
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'TEST_SERVICE_START', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(record), serverNow,
        );
        return { record, replayed: false };
      });
    },

    async testCompleteMetering(orderId: string, context: Parameters<NonNullable<ExchangeStore["testCompleteMetering"]>>[1], input: TestMeterComplete) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "TEST_METER_COMPLETE"
          || receipt.entity_id !== orderId) throw new ExchangeIdempotencyConflictError();
        return { record: readOrder(db, orderId, "ops").record, replayed: true };
      }
      const preflight = readOrder(db, orderId, "ops");
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      if (!preflight.metering) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单计量会话不存在。");
      if (preflight.metering.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "计量会话版本已变化，请刷新后重试。");
      }
      if (serverNow < preflight.order.end_at) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "固定服务时间窗结束后才能完成计量。");
      }
      return withTransaction(db, () => {
        const current = readOrder(db, orderId, "ops");
        if (!current.metering || current.metering.version !== input.expectedVersion
          || current.metering.status !== "ACTIVE" || !current.metering.actual_start_at
          || current.delivery?.status !== "IN_SERVICE" || current.reservation.state !== "IN_SERVICE"
          || current.lifecycle?.phase !== "FULFILLING") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能完成测试计量。");
        }
        if (!current.snapshot || current.snapshot.grossAmountCents !== current.order.total_amount_cents) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:METERING_SNAPSHOT_AMOUNT_MISMATCH");
        }
        const scheduledCapacityBaseUnits = current.order.capacity_base_units;
        const unprovenCapacityBaseUnits = Math.max(0, Math.min(
          scheduledCapacityBaseUnits,
          ((Date.parse(current.metering.actual_start_at) - Date.parse(current.order.start_at)) / 1_000) * current.order.rate_units,
        ));
        const availableCapacityBaseUnits = scheduledCapacityBaseUnits - unprovenCapacityBaseUnits;
        const unavailableCapacityBaseUnits = unprovenCapacityBaseUnits;
        const availabilityPpm = Number((BigInt(availableCapacityBaseUnits) * BigInt(1_000_000)) / BigInt(scheduledCapacityBaseUnits));
        const deliveredAmountCents = Number(
          (BigInt(current.snapshot.grossAmountCents) * BigInt(availableCapacityBaseUnits)) / BigInt(scheduledCapacityBaseUnits),
        );
        const baseCreditCents = current.snapshot.grossAmountCents - deliveredAmountCents;
        const finalId = createExchangeId("MF");
        const acceptanceId = createExchangeId("AC");
        const settlementId = createExchangeId("ST");
        const finalDigest = sha256([
          orderId, scheduledCapacityBaseUnits, availableCapacityBaseUnits, unavailableCapacityBaseUnits,
          unprovenCapacityBaseUnits, availabilityPpm, deliveredAmountCents, baseCreditCents,
        ].join(":"));
        const meteringUpdate = db.prepare(`UPDATE exchange_metering_sessions SET
          status = 'FINAL', finalized_at = ?,
          available_capacity_base_units = ?, unavailable_capacity_base_units = ?, unproven_capacity_base_units = ?,
          available_gpu_seconds = ?, unavailable_gpu_seconds = ?, unproven_gpu_seconds = ?,
          availability_ppm = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'ACTIVE' AND version = ?`).run(
          serverNow, availableCapacityBaseUnits, unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unavailableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unprovenCapacityBaseUnits : null, availabilityPpm,
          serverNow, current.metering.id, input.expectedVersion,
        );
        const deliveryUpdate = db.prepare(`UPDATE exchange_delivery_tasks
          SET status = 'COMPLETED', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'IN_SERVICE'`).run(serverNow, current.delivery.id);
        const reservationUpdate = db.prepare(`UPDATE exchange_reservations
          SET state = 'FULFILLED', version = version + 1, updated_at = ?
          WHERE id = ? AND state = 'IN_SERVICE'`).run(serverNow, current.reservation.id);
        if (meteringUpdate.changes !== 1 || deliveryUpdate.changes !== 1 || reservationUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试计量状态已变化，请刷新后重试。");
        }
        db.prepare(`INSERT INTO exchange_metering_finals (
          id, metering_session_id, order_id, rate_unit_code,
          scheduled_capacity_base_units, available_capacity_base_units,
          unavailable_capacity_base_units, unproven_capacity_base_units,
          scheduled_gpu_seconds, available_gpu_seconds,
          unavailable_gpu_seconds, unproven_gpu_seconds, availability_ppm, gross_amount_cents,
          delivered_amount_cents, base_credit_cents, evidence_digest, finalized_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          finalId, current.metering.id, orderId,
          current.order.rate_unit_code,
          scheduledCapacityBaseUnits, availableCapacityBaseUnits, unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? scheduledCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unavailableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unprovenCapacityBaseUnits : null,
          availabilityPpm, current.snapshot.grossAmountCents,
          deliveredAmountCents, baseCreditCents, finalDigest, serverNow,
        );
        const intervalId = createExchangeId("MI");
        db.prepare(`INSERT INTO exchange_meter_intervals (
          id, metering_session_id, order_id, capacity_policy_id, sequence_number,
          interval_start_at, interval_end_at, duration_seconds, reserved_rate_units,
          proven_rate_units, scheduled_capacity_base_units, available_capacity_base_units,
          unavailable_capacity_base_units, unproven_capacity_base_units, evidence_status,
          adapter, evidence_digest, created_at
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TEST', ?, ?)`).run(
          intervalId, current.metering.id, orderId, current.snapshot.capacityPolicyId,
          current.order.start_at, current.order.end_at, current.snapshot.durationSeconds,
          current.order.rate_units, current.order.rate_units, scheduledCapacityBaseUnits,
          availableCapacityBaseUnits, unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
          unprovenCapacityBaseUnits === 0 ? "PROVEN" : "UNPROVEN", finalDigest, serverNow,
        );
        const modelIdentityDigest = sha256(JSON.stringify(current.snapshot.productIdentity));
        const evidenceRows = current.order.rate_unit_code === "MODEL_INSTANCE"
          ? [
            { type: "MODEL_IDENTITY", modelIdentity: modelIdentityDigest, payload: sha256(`${intervalId}:MODEL_IDENTITY:${modelIdentityDigest}`) },
            { type: "INSTANCE_HEARTBEAT", modelIdentity: null, payload: sha256(`${intervalId}:INSTANCE_HEARTBEAT:PASS`) },
          ] as const
          : current.order.rate_unit_code === "MILLI_M_TOKEN_PER_HOUR"
            ? [
              { type: "MODEL_IDENTITY", modelIdentity: modelIdentityDigest, payload: sha256(`${intervalId}:MODEL_IDENTITY:${modelIdentityDigest}`) },
              { type: "THROUGHPUT", modelIdentity: null, payload: sha256(`${intervalId}:THROUGHPUT:${availableCapacityBaseUnits}`) },
            ] as const
            : current.order.rate_unit_code === "GIB_STORAGE"
              ? [
                { type: "STORAGE_IDENTITY", modelIdentity: modelIdentityDigest, payload: sha256(`${intervalId}:STORAGE_IDENTITY:${modelIdentityDigest}`) },
                { type: "STORAGE_AVAILABILITY", modelIdentity: null, payload: sha256(`${intervalId}:STORAGE_AVAILABILITY:${availabilityPpm}`) },
              ] as const
              : current.order.rate_unit_code === "RACK"
                ? [
                  { type: "FACILITY_IDENTITY", modelIdentity: modelIdentityDigest, payload: sha256(`${intervalId}:FACILITY_IDENTITY:${modelIdentityDigest}`) },
                  { type: "RACK_AVAILABILITY", modelIdentity: null, payload: sha256(`${intervalId}:RACK_AVAILABILITY:${availabilityPpm}`) },
                ] as const
                : [
                  { type: "AVAILABILITY", modelIdentity: null, payload: sha256(`${intervalId}:AVAILABILITY:${availabilityPpm}`) },
                ] as const;
        for (const evidence of evidenceRows) {
          db.prepare(`INSERT INTO exchange_meter_evidence (
            id, meter_interval_id, evidence_type, source, model_identity_digest,
            payload_digest, observed_at, created_at
          ) VALUES (?, ?, ?, 'TEST', ?, ?, ?, ?)`).run(
            createExchangeId("ME"), intervalId, evidence.type, evidence.modelIdentity,
            evidence.payload, current.order.end_at, serverNow,
          );
        }
        db.prepare(`INSERT INTO exchange_service_facts (
          id, metering_session_id, order_id, fact_type, environment, effective_start_at,
          effective_end_at, rate_unit_code, available_capacity_base_units,
          available_gpu_seconds, evidence_digest, created_at
        ) VALUES (?, ?, ?, 'TEST_WINDOW_FINALIZED', 'TEST', ?, ?, ?, ?, ?, ?, ?)`).run(
          createExchangeId("SF"), current.metering.id, orderId, current.metering.actual_start_at,
          current.order.end_at, current.order.rate_unit_code, availableCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null, finalDigest, serverNow,
        );
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) VALUES (?, ?, ?, ?, 'IN_SERVICE', 'CONSUMED', ?, ?, ?, 'TEST_METERING_FINAL', ?)`).run(
          createExchangeTransferId(), current.reservation.capacity_lot_id, orderId,
          `order:${orderId}:test-meter-final`, current.order.rate_unit_code,
          scheduledCapacityBaseUnits, current.order.rate_unit_code === "GPU" ? scheduledCapacityBaseUnits : null, serverNow,
        );
        db.prepare(`INSERT INTO exchange_acceptances (
          id, order_id, metering_final_id, buyer_actor_id, status, reason, evidence_digest,
          version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'PENDING', NULL, NULL, 1, ?, ?)`).run(
          acceptanceId, orderId, finalId, current.order.buyer_actor_id, serverNow, serverNow,
        );
        db.prepare(`INSERT INTO exchange_settlements (
          id, order_id, metering_final_id, acceptance_id, environment, status,
          gross_amount_cents, base_credit_cents, dispute_credit_cents, net_supplier_payable_cents,
          funds_moved, ledger_batch_id, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'TEST', 'BLOCKED', ?, ?, 0, ?, 0, NULL, 1, ?, ?)`).run(
          settlementId, orderId, finalId, acceptanceId, current.snapshot.grossAmountCents,
          baseCreditCents, deliveredAmountCents, serverNow, serverNow,
        );
        const lifecycleUpdate = db.prepare(`UPDATE exchange_order_lifecycle
          SET phase = 'AWAITING_ACCEPTANCE', state_reason = 'TEST_METERING_FINAL',
            version = version + 1, updated_at = ? WHERE order_id = ? AND phase = 'FULFILLING'`).run(serverNow, orderId);
        const orderUpdate = db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?")
          .run(serverNow, orderId);
        if (lifecycleUpdate.changes !== 1 || orderUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单最终化状态已变化，请刷新后重试。");
        }
        insertEvent(db, context.actorId, "ORDER", orderId, "TEST_METERING_FINAL", {
          meteringFinalId: finalId,
          rateUnitCode: current.order.rate_unit_code,
          scheduledCapacityBaseUnits,
          availableCapacityBaseUnits,
          unavailableCapacityBaseUnits,
          unprovenCapacityBaseUnits,
          grossAmountCents: current.snapshot.grossAmountCents,
          baseCreditCents,
          netSupplierPayableCents: deliveredAmountCents,
          fundsMoved: false,
        }, serverNow);
        const record = readOrder(db, orderId, "ops").record;
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'TEST_METER_COMPLETE', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(record), serverNow,
        );
        return { record, replayed: false };
      });
    },

    async submitAcceptance(orderId: string, context: Parameters<NonNullable<ExchangeStore["submitAcceptance"]>>[1], input: SubmitOrderAcceptance) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "SUBMIT_ACCEPTANCE"
          || receipt.entity_id !== orderId) throw new ExchangeIdempotencyConflictError();
        return { record: readOrder(db, orderId, "buyer").record, replayed: true };
      }
      const preflight = readOrder(db, orderId, "buyer");
      if (preflight.order.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的买方可以验收或发起争议。");
      }
      if (!preflight.acceptance) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单验收单不存在。");
      if (preflight.acceptance.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "验收单版本已变化，请刷新后重试。");
      }
      return withTransaction(db, () => {
        const current = readOrder(db, orderId, "buyer");
        if (!current.acceptance || current.acceptance.status !== "PENDING"
          || current.acceptance.version !== input.expectedVersion || current.metering?.status !== "FINAL"
          || current.lifecycle?.phase !== "AWAITING_ACCEPTANCE" || !current.settlement
          || current.settlement.status !== "BLOCKED") {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能提交验收结论。");
        }
        const now = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
        const status = input.decision === "ACCEPT" ? "ACCEPTED" : "DISPUTED";
        const acceptanceUpdate = db.prepare(`UPDATE exchange_acceptances
          SET status = ?, reason = ?, evidence_digest = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'PENDING' AND version = ?`).run(
          status, input.reason, input.evidenceDigest, now, current.acceptance.id, input.expectedVersion,
        );
        const settlementUpdate = db.prepare(`UPDATE exchange_settlements
          SET status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'BLOCKED'`).run(
          input.decision === "ACCEPT" ? "ELIGIBLE" : "BLOCKED", now, current.settlement.id,
        );
        const lifecycleUpdate = db.prepare(`UPDATE exchange_order_lifecycle
          SET phase = ?, state_reason = ?, version = version + 1, updated_at = ?
          WHERE order_id = ? AND phase = 'AWAITING_ACCEPTANCE'`).run(
          input.decision === "ACCEPT" ? "COMPLETED" : "EXCEPTION",
          input.decision === "ACCEPT" ? "BUYER_ACCEPTED" : "BUYER_DISPUTED",
          now, orderId,
        );
        if (acceptanceUpdate.changes !== 1 || settlementUpdate.changes !== 1 || lifecycleUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "验收状态已变化，请刷新后重试。");
        }
        db.prepare("UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?").run(now, orderId);
        insertEvent(db, context.actorId, "ORDER", orderId, `BUYER_${status}`, {
          acceptanceId: current.acceptance.id,
          evidenceDigest: input.evidenceDigest,
          decision: input.decision,
        }, now);
        const record = readOrder(db, orderId, "buyer").record;
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'SUBMIT_ACCEPTANCE', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(record), now,
        );
        return { record, replayed: false };
      });
    },

    async testRecordSettlement(settlementId: string, context: Parameters<NonNullable<ExchangeStore["testRecordSettlement"]>>[1], input: TestRecordSettlement) {
      const receipt = db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).get(context.actorId, context.idempotencyKey) as
        | { payload_hash: string; command_type: string; entity_id: string; response_json: string }
        | undefined;
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "TEST_RECORD_SETTLEMENT"
          || receipt.entity_id !== settlementId) throw new ExchangeIdempotencyConflictError();
        const replaySettlement = db.prepare("SELECT * FROM exchange_settlements WHERE id = ?")
          .get(settlementId) as SettlementRow | undefined;
        if (!replaySettlement || replaySettlement.status !== "TEST_RECORDED" || !replaySettlement.ledger_batch_id) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_REPLAY_MISSING");
        }
        readOrder(db, replaySettlement.order_id, "ops");
        const replayCommission = db.prepare("SELECT * FROM exchange_commission_accruals WHERE settlement_id = ?")
          .get(settlementId) as CommissionAccrualRow | undefined;
        const replayRecord = mapSettlement(replaySettlement, replayCommission);
        const expectedEventPayload = JSON.stringify({
          ledgerBatchId: replaySettlement.ledger_batch_id,
          grossAmountCents: replayRecord.grossAmountCents,
          baseCreditCents: replayRecord.baseCreditCents,
          netSupplierPayableCents: replayRecord.netSupplierPayableCents,
          fundsMoved: false,
        });
        const settlementEventCount = (db.prepare(`SELECT COUNT(*) AS count FROM exchange_domain_events
          WHERE entity_type = 'SETTLEMENT' AND entity_id = ? AND event_type = 'TEST_SETTLEMENT_RECORDED'
            AND json(payload_json) = json(?)`)
          .get(settlementId, expectedEventPayload) as { count: number }).count;
        const settlementEventTotal = (db.prepare(`SELECT COUNT(*) AS count FROM exchange_domain_events
          WHERE entity_type = 'SETTLEMENT' AND entity_id = ? AND event_type = 'TEST_SETTLEMENT_RECORDED'`)
          .get(settlementId) as { count: number }).count;
        const settlementReceiptTotal = (db.prepare(`SELECT COUNT(*) AS count FROM exchange_command_receipts
          WHERE entity_id = ? AND command_type = 'TEST_RECORD_SETTLEMENT'`)
          .get(settlementId) as { count: number }).count;
        const ledger = db.prepare("SELECT * FROM exchange_ledger_batches WHERE id = ?")
          .get(replaySettlement.ledger_batch_id) as SettlementLedgerBatchRow | undefined;
        const ledgerEntries = db.prepare("SELECT * FROM exchange_ledger_entries WHERE batch_id = ? ORDER BY id")
          .all(replaySettlement.ledger_batch_id) as SettlementLedgerEntryRow[];
        assertExactTestSettlementLedger(replaySettlement, ledger, ledgerEntries);
        if (settlementEventTotal !== 1 || settlementEventCount !== 1
          || settlementReceiptTotal !== 1
          || receipt.response_json !== JSON.stringify(replayRecord)) {
          throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_REPLAY_FACTS_INVALID");
        }
        return { record: replayRecord, replayed: true };
      }
      const preflight = db.prepare(`SELECT s.*, a.status AS acceptance_status, pi.status AS payment_status,
          pi.environment AS payment_environment
        FROM exchange_settlements s
        JOIN exchange_acceptances a ON a.id = s.acceptance_id
        JOIN exchange_payment_intents pi ON pi.order_id = s.order_id
        WHERE s.id = ?`).get(settlementId) as (SettlementRow & {
          acceptance_status: string; payment_status: string; payment_environment: string;
        }) | undefined;
      if (!preflight) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "测试结算单不存在。");
      if (preflight.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算单版本已变化，请刷新后重试。");
      }
      if (preflight.status !== "ELIGIBLE" || preflight.acceptance_status !== "ACCEPTED"
        || preflight.payment_status !== "CAPTURED" || preflight.payment_environment !== "TEST") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试结算单当前没有记账资格。");
      }
      return withTransaction(db, () => {
        const current = db.prepare("SELECT * FROM exchange_settlements WHERE id = ?")
          .get(settlementId) as SettlementRow;
        if (current.version !== input.expectedVersion || current.status !== "ELIGIBLE") {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算状态已变化，请刷新后重试。");
        }
        const now = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
        const batchId = createExchangeId("LB");
        const creditEntries = [
          { account: "TEST_SUPPLIER_PAYABLE", amount: current.net_supplier_payable_cents },
          { account: "TEST_BUYER_CREDIT", amount: current.base_credit_cents + current.dispute_credit_cents },
        ].filter((entry) => entry.amount > 0);
        db.prepare(`INSERT INTO exchange_ledger_batches (
          id, settlement_id, environment, entry_count, debit_total_cents, credit_total_cents,
          funds_moved, created_at
        ) VALUES (?, ?, 'TEST', ?, ?, ?, 0, ?)`).run(
          batchId, settlementId, 1 + creditEntries.length,
          current.gross_amount_cents, current.gross_amount_cents, now,
        );
        db.prepare(`INSERT INTO exchange_ledger_entries (
          id, batch_id, settlement_id, account_code, side, amount_cents, created_at
        ) VALUES (?, ?, ?, 'TEST_BUYER_SETTLEMENT_CLEARING', 'DEBIT', ?, ?)`).run(
          createExchangeId("LE"), batchId, settlementId, current.gross_amount_cents, now,
        );
        for (const entry of creditEntries) {
          db.prepare(`INSERT INTO exchange_ledger_entries (
            id, batch_id, settlement_id, account_code, side, amount_cents, created_at
          ) VALUES (?, ?, ?, ?, 'CREDIT', ?, ?)`).run(
            createExchangeId("LE"), batchId, settlementId, entry.account, entry.amount, now,
          );
        }
        const settlementUpdate = db.prepare(`UPDATE exchange_settlements
          SET status = 'TEST_RECORDED', funds_moved = 0, ledger_batch_id = ?,
            version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'ELIGIBLE' AND version = ?`).run(
          batchId, now, settlementId, input.expectedVersion,
        );
        if (settlementUpdate.changes !== 1) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算状态已变化，请刷新后重试。");
        }
        const updated = db.prepare("SELECT * FROM exchange_settlements WHERE id = ?")
          .get(settlementId) as SettlementRow;
        const attribution = db.prepare("SELECT * FROM exchange_referral_attributions WHERE order_id = ?")
          .get(updated.order_id) as ReferralAttributionRow | undefined;
        let commission: CommissionAccrualRow | undefined;
        if (attribution) {
          db.prepare(`INSERT INTO exchange_commission_accruals (
            id, order_id, settlement_id, attribution_id, agent_actor_id,
            environment, record_kind, commission_base_cents, commission_rate_basis_points,
            commission_estimate_cents, funds_moved, created_at
          ) VALUES (?, ?, ?, ?, ?, 'TEST', 'ESTIMATE_ONLY', ?, 300, ?, 0, ?)`)
            .run(
              createExchangeId("CA"), updated.order_id, updated.id, attribution.id,
              attribution.agent_actor_id, updated.gross_amount_cents,
              deriveCommissionEstimateCents(updated.gross_amount_cents), now,
            );
          commission = db.prepare("SELECT * FROM exchange_commission_accruals WHERE settlement_id = ?")
            .get(settlementId) as CommissionAccrualRow;
        }
        const record = mapSettlement(updated, commission);
        insertEvent(db, context.actorId, "SETTLEMENT", settlementId, "TEST_SETTLEMENT_RECORDED", {
          ledgerBatchId: batchId,
          grossAmountCents: record.grossAmountCents,
          baseCreditCents: record.baseCreditCents,
          netSupplierPayableCents: record.netSupplierPayableCents,
          fundsMoved: false,
        }, now);
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) VALUES (?, ?, ?, 'TEST_RECORD_SETTLEMENT', ?, ?, ?)`).run(
          context.actorId, context.idempotencyKey, context.payloadHash, settlementId, JSON.stringify(record), now,
        );
        return { record, replayed: false };
      });
    },
  };
}
