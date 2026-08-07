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
  type DeliveryPackage,
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
  mapConnectionCheck,
  mapDeliveryPackage,
  mapListing,
  mapOrder,
  mapSettlement,
  mapSwapQuote,
  mapProduct,
  mapOrderContractSnapshot,
  mapResource,
  mapVerification,
  maximumConcurrentRateUnits,
  newCapacityLot,
  newListing,
  newCheckoutRecords,
  newResource,
  newVerification,
  capacityDescriptor,
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

type D1ExchangeStore = ExchangeStore & Required<Pick<ExchangeStore,
  "listOpsMeteringOrders" | "testStartService" | "testCompleteMetering" | "submitAcceptance" | "testRecordSettlement"
>>;

type D1Result<T> = { results?: T[]; meta?: { changes?: number } };
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
type CommandReceiptRow = { payload_hash: string; command_type: string; entity_id: string; response_json: string };

function changes(result: D1Result<unknown> | undefined) {
  const value = result?.meta?.changes;
  if (!Number.isInteger(value) || (value ?? -1) < 0) throw new Error("D1_CHANGES_UNAVAILABLE");
  return value as number;
}

function d1InvariantGuard(db: D1Database, invariantSql: string, ...values: unknown[]) {
  return db.prepare(`SELECT CASE WHEN (${invariantSql}) THEN 1 ELSE abs(-9223372036854775808) END AS invariant_ok`)
    .bind(...values);
}

const D1_RESOURCE_WITH_POLICY_SQL = `SELECT ra.*,
    p.product_code, p.rate_unit_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_resource_assets ra
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

const D1_LOT_WITH_POLICY_SQL = `SELECT lot.*,
    p.product_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_capacity_lots lot
  JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

const D1_LISTING_WITH_POLICY_SQL = `SELECT lv.*,
    p.product_code, p.fulfillment_model,
    p.pricing_unit_code AS policy_pricing_unit_code, p.price_basis_base_units
  FROM exchange_listing_versions lv
  JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
  JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
  JOIN exchange_product_capacity_policies p
    ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'`;

type D1SwapListingFactRow = ListingRow & {
  lot_id: string; lot_start_at: string; lot_end_at: string; lot_rate_units: number;
  lot_status: CapacityLotRow["status"]; resource_status: ResourceRow["status"];
  product_version_id: string; capacity_policy_id: string;
};

const D1_SWAP_LISTING_FACT_SQL = `SELECT lv.*,
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

function d1SwapListingFact(row: D1SwapListingFactRow): SwapListingFact {
  return {
    listingVersionId: row.id, listingCreatedAt: row.created_at,
    listingValidFrom: row.valid_from, listingValidUntil: row.valid_until,
    listingStatus: row.status, supplierActorId: row.supplier_actor_id,
    unitPriceMicros: row.unit_price_micros, minRateUnits: row.min_rate_units,
    maxRateUnits: row.max_rate_units, minDurationMinutes: row.min_duration_minutes,
    lotId: row.lot_id, lotStartAt: row.lot_start_at, lotEndAt: row.lot_end_at,
    lotRateUnits: row.lot_rate_units, lotStatus: row.lot_status,
    resourceStatus: row.resource_status, productVersionId: row.product_version_id,
    capacityPolicyId: row.capacity_policy_id,
    descriptor: capacityDescriptor(row.rate_unit_code, {
      productCode: row.product_code, rateUnitCode: row.rate_unit_code,
      fulfillmentModel: row.fulfillment_model,
      pricingUnitCode: row.policy_pricing_unit_code,
      priceBasisBaseUnits: row.price_basis_base_units,
    }),
  };
}

function assertD1CanonicalInputForProduct(
  input: object,
  rateUnitCode: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR" | "GIB_STORAGE" | "RACK",
) {
  if (rateUnitCode !== "GPU" && isLegacyGpuCreateInput(input)) {
    throw new ExchangeDomainError("EXCHANGE_UNIT_MISMATCH", 422, "非 GPU 请求必须使用通用容量字段。");
  }
}

function assertD1SchemaHistory(versions: number[], latest: number) {
  if (versions.length === 0 || versions.at(-1) !== latest
    || versions.some((version, index) => !EXCHANGE_SCHEMA_VERSIONS.includes(version as typeof EXCHANGE_SCHEMA_VERSIONS[number])
      || (index > 0 && version <= versions[index - 1]))) {
    throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
  }
}

async function d1ObjectNames(db: D1Database, type: "table" | "index" | "trigger") {
  const result = await db.prepare(`SELECT name FROM sqlite_master WHERE type = ? AND name LIKE 'exchange_%'`)
    .bind(type).all<{ name: string }>();
  return new Set((result.results ?? []).map((row) => row.name));
}

async function d1ColumnMap(db: D1Database, table: string) {
  const result = await db.prepare(`SELECT name, "notnull" AS is_not_null FROM pragma_table_info('${table}')`)
    .all<{ name: string; is_not_null: number }>();
  return new Map((result.results ?? []).map((column) => [column.name, column]));
}

async function assertD1CommonExchangeObjects(db: D1Database) {
  const tables = await d1ObjectNames(db, "table");
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
    "exchange_product_capacity_policies", "exchange_order_contract_snapshots", "exchange_meter_intervals", "exchange_meter_evidence",
  ]) if (!tables.has(table)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const triggers = await d1ObjectNames(db, "trigger");
  for (const trigger of [
    "exchange_product_versions_immutable_update", "exchange_product_versions_immutable_delete",
    "exchange_product_capacity_policies_immutable_update", "exchange_product_capacity_policies_immutable_delete",
    "exchange_order_contract_snapshots_immutable_update", "exchange_order_contract_snapshots_immutable_delete",
    "exchange_meter_intervals_no_overlap", "exchange_meter_intervals_immutable_update",
    "exchange_meter_intervals_immutable_delete", "exchange_meter_evidence_observed_within_interval",
    "exchange_meter_evidence_immutable_update", "exchange_meter_evidence_immutable_delete",
  ]) if (!triggers.has(trigger)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const foreignKeys = await db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check")
    .first<{ count: number }>();
  if (Number(foreignKeys?.count ?? -1) !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
}

async function assertD1V7Signature(db: D1Database) {
  await assertD1CommonExchangeObjects(db);
  const lot = await d1ColumnMap(db, "exchange_capacity_lots");
  const order = await d1ColumnMap(db, "exchange_orders");
  const metering = await d1ColumnMap(db, "exchange_metering_sessions");
  if (!lot.has("parallel_units") || !lot.has("capacity_gpu_seconds") || lot.has("rate_unit_code")
    || !order.has("unit_price_cents") || order.has("unit_price_micros") || order.has("capacity_base_units")
    || !metering.has("scheduled_gpu_seconds") || metering.has("scheduled_capacity_base_units")) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

async function assertD1V8Signature(db: D1Database) {
  await assertD1CommonExchangeObjects(db);
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
    const schema = await d1ColumnMap(db, table);
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
    if ((await d1ColumnMap(db, table)).get(column)?.is_not_null !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

async function assertD1V9Signature(db: D1Database) {
  await assertD1V8Signature(db);
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
  ]) {
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table).first<{ sql: string }>();
    if (!row?.sql.includes("MILLI_M_TOKEN_PER_HOUR") || !row.sql.includes("accounting_schema_version IN (1, 2, 3)")) {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
}

async function assertD1V10Signature(db: D1Database) {
  await assertD1V8Signature(db);
  for (const table of [
    "exchange_capacity_lots", "exchange_listing_versions", "exchange_orders", "exchange_reservations",
    "exchange_capacity_transfers", "exchange_metering_sessions", "exchange_service_facts", "exchange_metering_finals",
  ]) {
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table).first<{ sql: string }>();
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
    const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table).first<{ sql: string }>();
    if (!row || signatures.some((signature) => !row.sql.includes(signature))) {
      throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
    }
  }
}

async function assertD1V11Signature(db: D1Database) {
  await assertD1V10Signature(db);
  const transfer = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'exchange_capacity_transfers'")
    .first<{ sql: string }>();
  if (!transfer?.sql.includes("WITHDRAWN") || transfer.sql.includes("from_bucket IN ('ISSUED', 'AVAILABLE', 'HELD', 'LOCKED', 'IN_SERVICE', 'CONSUMED', 'EXPIRED', 'FROZEN', 'WITHDRAWN')")) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const withdrawals = await d1ColumnMap(db, "exchange_capacity_withdrawals");
  for (const column of [
    "capacity_lot_id", "supplier_actor_id", "idempotency_key", "payload_hash",
    "expected_lot_version", "transfer_id", "rate_unit_code", "capacity_base_units", "capacity_gpu_seconds",
    "accounting_schema_version", "reason", "occurred_at",
  ]) if (!withdrawals.has(column)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const triggers = await d1ObjectNames(db, "trigger");
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
  const tables = await d1ObjectNames(db, "table");
  for (const table of [
    "exchange_swap_quotes", "exchange_swap_quote_snapshots", "exchange_swap_quote_status_events",
    "exchange_referral_codes", "exchange_referral_decisions", "exchange_referral_attributions",
    "exchange_commission_accruals",
  ]) if (!tables.has(table)) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  const missingDecisions = await db.prepare(`SELECT COUNT(*) AS count FROM exchange_orders orders
    LEFT JOIN exchange_referral_decisions decision ON decision.order_id = orders.id
    WHERE decision.id IS NULL`).first<{ count: number }>();
  if (Number(missingDecisions?.count ?? -1) !== 0) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
}

async function assertD1A2Runtime(db: D1Database) {
  const trigger = await db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'trigger' AND name = 'exchange_order_contract_snapshots_terms_match'`).first<{ name: string }>();
  const model = await db.prepare(`SELECT pv.form_factor, pv.specs_json
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id = 'PV-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1'
      AND p.id = 'PCP-MODEL-DEEPSEEK-V4-PRO-STANDARD-V1'
      AND pv.product_code = 'MODEL_INSTANCE'
      AND p.rate_unit_code = 'MODEL_INSTANCE'
      AND p.pricing_unit_code = 'MODEL_INSTANCE_HOUR'`).first<{ form_factor: string; specs_json: string }>();
  if (!trigger || !model || model.form_factor !== "MANAGED_MODEL_INSTANCE") {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
  const identity = JSON.parse(model.specs_json) as Record<string, unknown>;
  if (identity.registryId !== "deepseek-v4-pro-standard" || identity.provider !== "DeepSeek"
    || identity.canonicalModel !== "deepseek-v4-pro" || identity.modelRevision !== "v4-pro"
    || identity.serviceTier !== "standard-reasoning-switchable" || identity.contextBucket !== "default"
    || identity.regionScope !== "REGION_INDEPENDENT" || identity.quantization !== "PROVIDER_MANAGED") {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

async function assertD1A3Runtime(db: D1Database) {
  await assertD1A2Runtime(db);
  const token = await db.prepare(`SELECT pv.form_factor, pv.specs_json, p.identity_spec_json,
      p.price_basis_base_units
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id = 'PV-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1'
      AND p.id = 'PCP-TOKEN-DEEPSEEK-V4-PRO-THROUGHPUT-STANDARD-V1'
      AND pv.product_code = 'TOKEN_THROUGHPUT'
      AND p.rate_unit_code = 'MILLI_M_TOKEN_PER_HOUR'
      AND p.fulfillment_model = 'TOKEN_THROUGHPUT_RESERVATION'
      AND p.pricing_unit_code = 'M_TOKEN_CAPACITY_HOUR'`).first<{
        form_factor: string; specs_json: string; identity_spec_json: string; price_basis_base_units: number;
      }>();
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

async function assertD1M7Runtime(db: D1Database) {
  await assertD1A3Runtime(db);
  const result = await db.prepare(`SELECT pv.id, pv.form_factor, pv.specs_json, p.id AS policy_id,
      p.rate_unit_code, p.fulfillment_model, p.pricing_unit_code, p.rate_unit_scale_denominator,
      p.rate_unit_reference_code, p.price_basis_base_units
    FROM exchange_product_versions pv
    JOIN exchange_product_capacity_policies p
      ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
    WHERE pv.id IN ('PV-NAS-NFS41-BALANCED-1TIB-V1', 'PV-RACK-42U-10KW-MANAGED-V1')
    ORDER BY pv.id`).all<Record<string, string | number>>();
  const rows = result.results ?? [];
  const nas = rows.find((row) => row.id === "PV-NAS-NFS41-BALANCED-1TIB-V1");
  const rack = rows.find((row) => row.id === "PV-RACK-42U-10KW-MANAGED-V1");
  if (rows.length !== 2 || !nas || nas.policy_id !== "PCP-NAS-NFS41-BALANCED-1TIB-V1"
    || nas.form_factor !== "MANAGED_NAS_VOLUME" || nas.rate_unit_code !== "GIB_STORAGE"
    || nas.fulfillment_model !== "NAS_VOLUME_ALLOCATION" || nas.pricing_unit_code !== "TIB_HOUR"
    || nas.rate_unit_scale_denominator !== 1024 || nas.rate_unit_reference_code !== "TIB_STORAGE"
    || nas.price_basis_base_units !== 3_686_400) throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
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
  const power = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_product_versions WHERE product_code = 'POWER_CAPACITY') AS products,
      (SELECT COUNT(*) FROM exchange_product_capacity_policies
        WHERE product_code = 'POWER_CAPACITY' AND feature_status = 'ENABLED') AS policies`)
    .first<{ products: number; policies: number }>();
  if (Number(power?.products ?? -1) !== 0 || Number(power?.policies ?? -1) !== 0) {
    throw new Error("EXCHANGE_SCHEMA_SIGNATURE_INVALID");
  }
}

function replayOrConflict<Row extends { payload_hash: string }, T>(row: Row | null, payloadHash: string, map: (row: Row) => T) {
  if (!row) return null;
  if (row.payload_hash !== payloadHash) throw new ExchangeIdempotencyConflictError();
  return { record: map(row), replayed: true } as const;
}

async function replayAfterConcurrentInsert<Row extends { payload_hash: string }, T>(
  error: unknown,
  statement: D1Statement,
  payloadHash: string,
  map: (row: Row) => T,
) {
  const replay = replayOrConflict(await statement.first<Row>(), payloadHash, map);
  if (replay) return replay;
  throw error;
}

function eventStatement(db: D1Database, actorId: string, entityType: string, entityId: string, eventType: string, payload: unknown, at: string) {
  return db.prepare(`INSERT INTO exchange_domain_events (
    id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
  ) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
    SELECT 1 FROM exchange_resource_assets WHERE id = ?
    UNION ALL SELECT 1 FROM exchange_capacity_lots WHERE id = ?
    UNION ALL SELECT 1 FROM exchange_listing_versions WHERE listing_id = ?
    UNION ALL SELECT 1 FROM exchange_orders WHERE id = ?
  )`).bind(eventId(), actorId, entityType, entityId, eventType, JSON.stringify(payload), at, entityId, entityId, entityId, entityId);
}

function transferId() {
  return `KAI-CT-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
}

async function d1WithdrawalEligibility(db: D1Database, lot: CapacityLotRow) {
  if (lot.status === "WITHDRAWN") return { eligible: false, reasonCode: "ALREADY_WITHDRAWN" as const };
  if (lot.status !== "READY") return { eligible: false, reasonCode: "LOT_NOT_READY" as const };
  const history = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_listing_versions WHERE capacity_lot_id = ?) AS listing_count,
      (SELECT COUNT(*) FROM exchange_reservations WHERE capacity_lot_id = ?) AS reservation_count,
      (SELECT COUNT(*) FROM exchange_capacity_withdrawals WHERE capacity_lot_id = ?) AS withdrawal_count,
      COUNT(transfer.id) AS transfer_count,
      COALESCE(SUM(CASE WHEN transfer.to_bucket = 'AVAILABLE' THEN transfer.capacity_base_units ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN transfer.from_bucket = 'AVAILABLE' THEN transfer.capacity_base_units ELSE 0 END), 0) AS available_balance,
      COALESCE(SUM(CASE WHEN transfer.from_bucket NOT IN ('ISSUED', 'AVAILABLE') OR transfer.to_bucket <> 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS other_movements,
      COALESCE(SUM(CASE WHEN transfer.from_bucket = 'ISSUED' AND transfer.to_bucket = 'AVAILABLE'
        AND transfer.order_id IS NULL AND transfer.idempotency_key = ? AND transfer.reason = 'CAPACITY_LOT_CREATED'
        AND transfer.rate_unit_code = ? AND transfer.capacity_base_units = ?
        AND transfer.accounting_schema_version = ?
        AND ((? = 'GPU' AND transfer.capacity_gpu_seconds = ?) OR (? <> 'GPU' AND transfer.capacity_gpu_seconds IS NULL))
        THEN 1 ELSE 0 END), 0) AS initial_transfer_count
    FROM exchange_capacity_transfers transfer WHERE transfer.capacity_lot_id = ?`).bind(
      lot.id, lot.id, lot.id, `lot:${lot.id}:issued`, lot.rate_unit_code,
      lot.capacity_base_units, lot.accounting_schema_version, lot.rate_unit_code,
      lot.capacity_base_units, lot.rate_unit_code, lot.id,
    ).first<{
      listing_count: number; reservation_count: number; withdrawal_count: number;
      transfer_count: number; available_balance: number; other_movements: number; initial_transfer_count: number;
    }>();
  if (!history) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:WITHDRAWAL_HISTORY_UNAVAILABLE");
  if (Number(history.listing_count) !== 0) return { eligible: false, reasonCode: "LISTING_HISTORY_EXISTS" as const };
  if (Number(history.reservation_count) !== 0) return { eligible: false, reasonCode: "RESERVATION_HISTORY_EXISTS" as const };
  if (Number(history.withdrawal_count) !== 0) return { eligible: false, reasonCode: "ALREADY_WITHDRAWN" as const };
  if (Number(history.transfer_count) !== 1 || Number(history.initial_transfer_count) !== 1
    || Number(history.available_balance) !== lot.capacity_base_units || Number(history.other_movements) !== 0) {
    return { eligible: false, reasonCode: "TRANSFER_HISTORY_NOT_PRISTINE" as const };
  }
  return { eligible: true, reasonCode: "ELIGIBLE" as const };
}

async function mapD1CapacityLotForSupplier(db: D1Database, row: CapacityLotRow) {
  const lot = mapCapacityLot(row);
  const eligibility = await d1WithdrawalEligibility(db, row);
  return {
    ...lot,
    withdrawalEligibility: eligibility,
    allowedActions: [
      ...(row.status === "READY" ? ["CREATE_LISTING" as const] : []),
      ...(eligibility.eligible ? ["WITHDRAW" as const] : []),
    ],
  };
}

async function projectD1CapacityWithdrawal(db: D1Database, row: CapacityWithdrawalRow) {
  const record = mapCapacityWithdrawal(row);
  type WithdrawalTransferFact = {
    id: string; capacity_lot_id: string; order_id: string | null; idempotency_key: string;
    from_bucket: string; to_bucket: string; rate_unit_code: string; capacity_base_units: number;
    capacity_gpu_seconds: number | null; reason: string; occurred_at: string; accounting_schema_version: number;
  };
  const lot = await db.prepare("SELECT * FROM exchange_capacity_lots WHERE id = ?")
    .bind(row.capacity_lot_id).first<CapacityLotRow>();
  const transferResult = await db.prepare(`SELECT * FROM exchange_capacity_transfers
    WHERE capacity_lot_id = ? ORDER BY occurred_at ASC, id ASC`).bind(row.capacity_lot_id).all<WithdrawalTransferFact>();
  const transfers = transferResult.results ?? [];
  const sameCapacity = (transfer: WithdrawalTransferFact) => transfer.rate_unit_code === row.rate_unit_code
    && Number(transfer.capacity_base_units) === Number(row.capacity_base_units)
    && Number(transfer.accounting_schema_version) === Number(row.accounting_schema_version)
    && (transfer.capacity_gpu_seconds === null ? null : Number(transfer.capacity_gpu_seconds))
      === (row.capacity_gpu_seconds === null ? null : Number(row.capacity_gpu_seconds));
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
    + (transfer.to_bucket === "AVAILABLE" ? Number(transfer.capacity_base_units) : 0)
    - (transfer.from_bucket === "AVAILABLE" ? Number(transfer.capacity_base_units) : 0), 0);
  const withdrawnBalance = transfers.reduce((balance, transfer) => balance
    + (transfer.to_bucket === "WITHDRAWN" ? Number(transfer.capacity_base_units) : 0)
    - (transfer.from_bucket === "WITHDRAWN" ? Number(transfer.capacity_base_units) : 0), 0);
  const factsMatch = Boolean(lot)
    && lot!.supplier_actor_id === row.supplier_actor_id && lot!.status === "WITHDRAWN"
    && Number(lot!.version) === Number(row.expected_lot_version) + 1
    && lot!.rate_unit_code === row.rate_unit_code
    && Number(lot!.capacity_base_units) === Number(row.capacity_base_units)
    && (lot!.capacity_gpu_seconds === null ? null : Number(lot!.capacity_gpu_seconds))
      === (row.capacity_gpu_seconds === null ? null : Number(row.capacity_gpu_seconds))
    && Number(lot!.accounting_schema_version) === Number(row.accounting_schema_version)
    && transfers.length === 2 && initial.length === 1 && terminal.length === 1
    && initial[0].occurred_at === lot!.created_at
    && availableBalance === 0 && withdrawnBalance === Number(row.capacity_base_units);
  const integrity = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_domain_events event
        WHERE event.entity_type = 'CAPACITY_LOT' AND event.entity_id = ?
          AND event.event_type = 'CAPACITY_LOT_WITHDRAWN') AS event_total_count,
      (SELECT COUNT(*) FROM exchange_domain_events event
        WHERE event.entity_type = 'CAPACITY_LOT' AND event.entity_id = ?
          AND event.event_type = 'CAPACITY_LOT_WITHDRAWN' AND json(event.payload_json) = json(?)) AS event_count,
      (SELECT COUNT(*) FROM exchange_command_receipts receipt
        WHERE receipt.actor_id = ? AND receipt.idempotency_key = ?
          AND receipt.payload_hash = ? AND receipt.command_type = 'WITHDRAW_CAPACITY_LOT'
          AND receipt.entity_id = ? AND json(receipt.response_json) = json(?)) AS receipt_count`)
    .bind(
      row.capacity_lot_id, row.capacity_lot_id, JSON.stringify(record), row.supplier_actor_id,
      row.idempotency_key,
      row.payload_hash, row.id, JSON.stringify(record),
    ).first<{ event_total_count: number; event_count: number; receipt_count: number }>();
  if (!factsMatch || !integrity || Number(integrity.event_total_count) !== 1
    || Number(integrity.event_count) !== 1 || Number(integrity.receipt_count) !== 1) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:CAPACITY_WITHDRAWAL_REPLAY");
  }
  return record;
}

async function assertD1SwapInventory(
  db: D1Database,
  fact: SwapListingFact,
  input: { rateUnits: number; startAt: string; endAt: string },
  now: string,
) {
  const expired = await db.prepare(`SELECT * FROM exchange_reservations
    WHERE capacity_lot_id = ? AND state IN ('HELD', 'SUPPLIER_CONFIRMED') AND hold_expires_at <= ?`)
    .bind(fact.lotId, now).all<ReservationRow>();
  await expireD1Reservations(db, expired.results ?? [], now);
  const active = await db.prepare(`SELECT start_at, end_at, rate_units
    FROM exchange_reservations
    WHERE capacity_lot_id = ? AND start_at < ? AND end_at > ?
      AND (state IN ('COMMITTED', 'IN_SERVICE', 'FULFILLED')
        OR (state IN ('HELD', 'SUPPLIER_CONFIRMED') AND hold_expires_at > ?))`)
    .bind(fact.lotId, input.endAt, input.startAt, now)
    .all<{ start_at: string; end_at: string; rate_units: number }>();
  if (maximumConcurrentRateUnits(active.results ?? [], input.startAt, input.endAt) + input.rateUnits > fact.lotRateUnits) {
    throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "置换时段的可用容量不足。");
  }
}

function d1SwapInventoryInvariant(
  db: D1Database,
  fact: SwapListingFact,
  input: { rateUnits: number; startAt: string; endAt: string },
  now: string,
) {
  return d1InvariantGuard(db, `NOT EXISTS (
    WITH boundaries(point) AS (
      SELECT ?
      UNION
      SELECT reservation.start_at
      FROM exchange_reservations reservation
      WHERE reservation.capacity_lot_id = ?
        AND reservation.start_at > ? AND reservation.start_at < ?
        AND reservation.end_at > ?
        AND (reservation.state IN ('COMMITTED', 'IN_SERVICE', 'FULFILLED')
          OR (reservation.state IN ('HELD', 'SUPPLIER_CONFIRMED') AND reservation.hold_expires_at > ?))
    )
    SELECT 1 FROM boundaries
    WHERE ? + COALESCE((
      SELECT SUM(active.rate_units)
      FROM exchange_reservations active
      WHERE active.capacity_lot_id = ?
        AND active.start_at <= boundaries.point AND active.end_at > boundaries.point
        AND active.start_at < ? AND active.end_at > ?
        AND (active.state IN ('COMMITTED', 'IN_SERVICE', 'FULFILLED')
          OR (active.state IN ('HELD', 'SUPPLIER_CONFIRMED') AND active.hold_expires_at > ?))
    ), 0) > (SELECT lot.rate_units FROM exchange_capacity_lots lot WHERE lot.id = ?)
  )`,
  input.startAt, fact.lotId, input.startAt, input.endAt, input.startAt, now,
  input.rateUnits, fact.lotId, input.endAt, input.startAt, now, fact.lotId);
}

async function readD1SwapQuote(
  db: D1Database,
  quoteId: string,
  statusEvent?: SwapQuoteStatusEventRow,
  now = new Date().toISOString(),
  viewerActorId?: string,
) {
  const row = await db.prepare("SELECT * FROM exchange_swap_quotes WHERE id = ?")
    .bind(quoteId).first<SwapQuoteRow>();
  if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价不存在。");
  const snapshotsResult = await db.prepare(`SELECT * FROM exchange_swap_quote_snapshots
    WHERE quote_id = ? ORDER BY leg_role ASC`).bind(quoteId).all<SwapQuoteSnapshotRow>();
  const statusesResult = await db.prepare(`SELECT * FROM exchange_swap_quote_status_events
    WHERE quote_id = ? ORDER BY version ASC`).bind(quoteId).all<SwapQuoteStatusEventRow>();
  const snapshots = snapshotsResult.results ?? [];
  const statuses = statusesResult.results ?? [];
  if (snapshots.length !== 2 || statuses.length === 0
    || statuses.some((event, index) => event.version !== index + 1)
    || statuses[0].status !== "QUOTED") {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_PROJECTION_INVALID");
  }
  const selected = statusEvent ?? statuses.at(-1) as SwapQuoteStatusEventRow;
  const quote = mapSwapQuote(row, snapshots as [SwapQuoteSnapshotRow, SwapQuoteSnapshotRow], selected, now, viewerActorId);
  await verifySwapQuoteDigests(quote, sha256);
  const facts = await db.prepare(`SELECT
      (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_type = 'SWAP_QUOTE'
        AND entity_id = ? AND event_type = 'SWAP_QUOTE_CREATED') AS event_count,
      (SELECT COUNT(*) FROM exchange_command_receipts WHERE actor_id = ?
        AND idempotency_key = ? AND payload_hash = ? AND command_type = 'CREATE_SWAP_QUOTE'
        AND entity_id = ?) AS receipt_count`).bind(
      quoteId, row.initiator_actor_id, row.idempotency_key, row.payload_hash, quoteId,
    ).first<{ event_count: number; receipt_count: number }>();
  if (!facts || Number(facts.event_count) !== 1 || Number(facts.receipt_count) !== 1) {
    throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SWAP_QUOTE_FACTS_MISSING");
  }
  return quote;
}

function oneTimeTestCode() {
  const raw = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `KAI-TEST-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function readD1CommandReceipt(db: D1Database, actorId: string, idempotencyKey: string) {
  return db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
    FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
    .bind(actorId, idempotencyKey).first<CommandReceiptRow>();
}

function validateD1CommandReceipt(
  receipt: CommandReceiptRow,
  expected: { payloadHash: string; commandType: string; entityId: string },
) {
  if (receipt.payload_hash !== expected.payloadHash || receipt.command_type !== expected.commandType
    || receipt.entity_id !== expected.entityId) throw new ExchangeIdempotencyConflictError();
  return receipt;
}

async function expireD1Reservations(db: D1Database, reservations: ReservationRow[], now: string) {
  if (!reservations.length) return;
  const statements: D1Statement[] = [];
  for (const reservation of reservations) {
    const gateTransferId = transferId();
    const expiryEventId = eventId();
    statements.push(
      db.prepare(`INSERT OR IGNORE INTO exchange_capacity_transfers (
        id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
        rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
      ) SELECT ?, r.capacity_lot_id, r.order_id, ?, 'HELD', 'AVAILABLE',
          r.rate_unit_code, r.capacity_base_units, r.capacity_gpu_seconds, 'RESERVATION_EXPIRED', ?
        FROM exchange_reservations r JOIN exchange_orders o ON o.id = r.order_id
        WHERE r.id = ? AND r.state IN ('HELD', 'SUPPLIER_CONFIRMED')
          AND r.hold_expires_at <= ?
          AND o.status IN ('PENDING_SUPPLIER_CONFIRMATION', 'AWAITING_PAYMENT')`)
        .bind(gateTransferId, `order:${reservation.order_id}:expired`, now, reservation.id, now),
      db.prepare(`UPDATE exchange_reservations SET state = 'EXPIRED', version = version + 1, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`)
        .bind(now, reservation.id, gateTransferId),
      db.prepare(`UPDATE exchange_orders SET status = 'EXPIRED', version = version + 1, updated_at = ?
        WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`)
        .bind(now, reservation.order_id, gateTransferId),
      db.prepare(`INSERT INTO exchange_domain_events (
        id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
      ) SELECT ?, 'system:reservation-expiry', 'ORDER', ?, 'RESERVATION_EXPIRED', ?, ?
        WHERE EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`)
        .bind(expiryEventId, reservation.order_id, JSON.stringify({ reservationId: reservation.id }), now, gateTransferId),
      d1InvariantGuard(db, `
        (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE id = ? AND order_id = ?
          AND reason = 'RESERVATION_EXPIRED') = 1
        AND (SELECT COUNT(*) FROM exchange_reservations WHERE id = ? AND state = 'EXPIRED') = 1
        AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND status = 'EXPIRED') = 1
        AND (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ?
          AND entity_id = ? AND event_type = 'RESERVATION_EXPIRED') = 1`,
      gateTransferId, reservation.order_id, reservation.id, reservation.order_id,
      expiryEventId, reservation.order_id),
    );
  }
  await db.batch(statements);
}

async function expireD1DeliveryPackage(db: D1Database, row: DeliveryPackageRow, actorId: string, effectiveAt?: string) {
  if (!["SUBMITTED", "VERIFIED", "CLAIMED"].includes(row.status)) return false;
  const now = effectiveAt ?? new Date().toISOString();
  if (row.credential_expires_at > now) return false;
  const gateEventId = eventId();
  const results = await db.batch([
    db.prepare(`INSERT INTO exchange_domain_events (
      id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
    ) SELECT ?, ?, 'DELIVERY_PACKAGE', dp.id, 'DELIVERY_PACKAGE_EXPIRED', ?, ?
      FROM exchange_delivery_packages dp
      WHERE dp.id = ? AND dp.status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')
        AND dp.version = ? AND dp.credential_expires_at <= ?`).bind(
      gateEventId, actorId, JSON.stringify({ deliveryTaskId: row.delivery_task_id, revision: row.revision }),
      now, row.id, row.version, now,
    ),
    db.prepare(`UPDATE exchange_delivery_packages
      SET status = 'EXPIRED', version = version + 1, updated_at = ?
      WHERE id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') AND version = ?
        AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, row.id, row.version, gateEventId),
    db.prepare(`UPDATE exchange_delivery_tasks
      SET status = 'PROVISIONING', attempt = attempt + 1, version = version + 1, updated_at = ?
      WHERE id = ? AND status IN ('VERIFYING', 'DELIVERED')
        AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, row.delivery_task_id, gateEventId),
    db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, row.order_id, gateEventId),
    d1InvariantGuard(db, `
      (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ?
        AND entity_id = ? AND event_type = 'DELIVERY_PACKAGE_EXPIRED') = 1
      AND (SELECT COUNT(*) FROM exchange_delivery_packages WHERE id = ? AND status = 'EXPIRED'
        AND version = ?) = 1
      AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE id = ? AND status = 'PROVISIONING') = 1
      AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version >= 2) = 1`,
    gateEventId, row.id, row.id, row.version + 1, row.delivery_task_id, row.order_id),
  ]);
  if (changes(results[0]) === 0) return false;
  if (changes(results[1]) !== 1 || changes(results[2]) !== 1 || changes(results[3]) !== 1) {
    throw new Error("DELIVERY_EXPIRY_INVARIANT_FAILED");
  }
  return true;
}

async function insertD1PaymentOutcome(
  db: D1Database,
  context: { payloadHash: string },
  input: ApplyPaymentEvent,
  outcome: PaymentEventRow["outcome"],
  receivedAt: string,
) {
  await db.prepare(`INSERT INTO exchange_payment_events (
    id, provider, environment, provider_event_id, provider_transaction_id, payment_intent_id,
    merchant_account_ref, event_type, amount_cents, currency, funds_moved,
    verification_method, verified_at, raw_payload_digest, payload_hash, outcome, occurred_at, received_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    createExchangeId("PE"), input.provider, input.environment, input.providerEventId, input.providerTransactionId,
    input.providerOrderId, input.merchantAccountRef, input.eventType, input.amountCents, input.currency,
    Number(input.fundsMoved), input.verificationMethod, input.verifiedAt, input.rawPayloadDigest,
    context.payloadHash, outcome, input.occurredAt, receivedAt,
  ).run();
}

export function createD1ExchangeStore(value: unknown, clock: () => Date = () => new Date()): D1ExchangeStore {
  const db = value as D1Database;
  let schemaPromise: Promise<void> | undefined;
  const ensureSchema = () => {
    schemaPromise ??= (async () => {
      const migrationTable = await db.prepare(`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'exchange_schema_migrations'`).first<{ name: string }>();
      if (migrationTable) {
        const result = await db.prepare("SELECT version FROM exchange_schema_migrations ORDER BY version ASC")
          .all<{ version: number }>();
        const versions = (result.results ?? []).map((row) => Number(row.version));
        if (versions.length === 0) throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
        const latest = versions.at(-1) as number;
        if (latest > EXCHANGE_SCHEMA_VERSION) throw new Error("EXCHANGE_SCHEMA_VERSION_UNSUPPORTED");
        assertD1SchemaHistory(versions, latest);
        if (latest < EXCHANGE_SCHEMA_VERSION) {
          if (latest === 7) await assertD1V7Signature(db);
          if (latest === 8) await assertD1V8Signature(db);
          if (latest === 9) await assertD1V9Signature(db);
          if (latest === 10) await assertD1V10Signature(db);
          throw new Error("EXCHANGE_MIGRATION_REQUIRED");
        }

        await assertD1V11Signature(db);

        await db.batch(exchangeSchemaStatements.map((sql) => db.prepare(sql)));
        await db.batch(exchangeSeedStatements.map((sql) => db.prepare(sql)));
        await assertD1M7Runtime(db);
        return;
      }

      const existingCore = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'exchange_%'`).first<{ count: number }>();
      if (Number(existingCore?.count ?? 0) !== 0) throw new Error("EXCHANGE_SCHEMA_HISTORY_INVALID");
      await db.batch(exchangeSchemaStatements.map((sql) => db.prepare(sql)));
      await db.batch(exchangeSeedStatements.map((sql) => db.prepare(sql)));
      const appliedAt = new Date().toISOString();
      await db.batch(EXCHANGE_SCHEMA_VERSIONS.map((version) => db.prepare(
        "INSERT INTO exchange_schema_migrations (version, applied_at) VALUES (?, ?)",
      ).bind(version, appliedAt)));
      await assertD1V11Signature(db);
      await assertD1M7Runtime(db);
    })().catch((error) => {
      schemaPromise = undefined;
      throw error;
    });
    return schemaPromise;
  };

  const projectDeliveryPackage = async (
    row: DeliveryPackageRow,
    viewerRole?: "buyer" | "supplier" | "ops",
  ): Promise<DeliveryPackage> => {
    const review = await db.prepare("SELECT * FROM exchange_delivery_reviews WHERE package_id = ?")
      .bind(row.id).first<DeliveryReviewRow>();
    const claim = await db.prepare("SELECT * FROM exchange_delivery_claims WHERE package_id = ?")
      .bind(row.id).first<DeliveryClaimRow>();
    const latestConnectionCheck = await db.prepare(`SELECT * FROM exchange_connection_checks
      WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).bind(row.id).first<ConnectionCheckRow>();
    return mapDeliveryPackage(row, viewerRole, { review, claim, latestConnectionCheck });
  };

  const readDeliveryPackage = async (
    deliveryTaskId: string,
    viewerRole?: "buyer" | "supplier" | "ops",
  ) => {
    const row = await db.prepare(`SELECT * FROM exchange_delivery_packages
      WHERE delivery_task_id = ? ORDER BY revision DESC LIMIT 1`).bind(deliveryTaskId).first<DeliveryPackageRow>();
    return row ? projectDeliveryPackage(row, viewerRole) : null;
  };

  const expireOrderDeliveryPackage = async (orderId: string, actorId: string) => {
    const row = await db.prepare(`SELECT * FROM exchange_delivery_packages
      WHERE order_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED')
        AND credential_expires_at <= ? ORDER BY revision DESC LIMIT 1`)
      .bind(orderId, new Date().toISOString()).first<DeliveryPackageRow>();
    return row ? expireD1DeliveryPackage(db, row, actorId) : false;
  };

  const readOrder = async (orderId: string, viewerRole?: "buyer" | "supplier" | "ops") => {
    const order = await db.prepare(`SELECT o.*,
        s.id AS snapshot_id, s.product_code AS snapshot_product_code,
        s.rate_unit_code AS snapshot_rate_unit_code,
        s.fulfillment_model AS snapshot_fulfillment_model,
        s.pricing_unit_code AS snapshot_pricing_unit_code,
        s.price_basis_base_units AS snapshot_price_basis_base_units
      FROM exchange_orders o
      LEFT JOIN exchange_order_contract_snapshots s ON s.order_id = o.id
      WHERE o.id = ?`).bind(orderId).first<OrderRow>();
    if (!order) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单不存在。");
    const reservation = await db.prepare("SELECT * FROM exchange_reservations WHERE order_id = ?").bind(orderId).first<ReservationRow>();
    if (!reservation) throw new Error("ORDER_RESERVATION_MISSING");
    const lifecycle = await db.prepare("SELECT * FROM exchange_order_lifecycle WHERE order_id = ?").bind(orderId).first<OrderLifecycleRow>();
    const payment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE order_id = ?").bind(orderId).first<PaymentIntentRow>();
    const delivery = await db.prepare("SELECT * FROM exchange_delivery_tasks WHERE order_id = ?").bind(orderId).first<DeliveryTaskRow>();
    const metering = await db.prepare("SELECT * FROM exchange_metering_sessions WHERE order_id = ?").bind(orderId).first<MeteringSessionRow>();
    const acceptance = await db.prepare("SELECT * FROM exchange_acceptances WHERE order_id = ?").bind(orderId).first<AcceptanceRow>();
    const settlement = await db.prepare("SELECT * FROM exchange_settlements WHERE order_id = ?").bind(orderId).first<SettlementRow>();
    const referralDecision = await db.prepare("SELECT * FROM exchange_referral_decisions WHERE order_id = ?")
      .bind(orderId).first<ReferralDecisionRow>();
    const referralAttribution = await db.prepare("SELECT * FROM exchange_referral_attributions WHERE order_id = ?")
      .bind(orderId).first<ReferralAttributionRow>();
    const referralCode = referralDecision?.resolved_code_id
      ? await db.prepare("SELECT * FROM exchange_referral_codes WHERE id = ?")
        .bind(referralDecision.resolved_code_id).first<ReferralCodeRow>()
      : null;
    const commission = await db.prepare("SELECT * FROM exchange_commission_accruals WHERE order_id = ?")
      .bind(orderId).first<CommissionAccrualRow>();
    const snapshotRow = await db.prepare("SELECT * FROM exchange_order_contract_snapshots WHERE order_id = ?")
      .bind(orderId).first<OrderContractSnapshotRow>();
    if (order.accounting_schema_version >= 2 && !snapshotRow) {
      throw new Error("EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING");
    }
    assertReferralFacts(order, referralDecision, referralAttribution, referralCode);
    assertSettlementCommissionFacts(order, snapshotRow, settlement, referralAttribution, commission);
    const deliveryPackage = delivery ? await readDeliveryPackage(delivery.id, viewerRole) : null;
    return {
      order, reservation, lifecycle, payment, delivery, deliveryPackage, metering, acceptance, settlement,
      referralDecision, referralAttribution, commission,
      snapshot: snapshotRow ? mapOrderContractSnapshot(snapshotRow) : null,
      record: mapOrder(order, reservation, viewerRole, {
        lifecycle, payment, delivery, deliveryPackage, metering, acceptance, settlement,
        referralDecision, referralAttribution, commission,
      }),
    };
  };

  const projectDeliveryPackageAfterSnapshot = async (
    packageId: string,
    viewerRole: "buyer" | "supplier" | "ops",
  ) => {
    const row = await db.prepare("SELECT * FROM exchange_delivery_packages WHERE id = ?")
      .bind(packageId).first<DeliveryPackageRow>();
    if (!row) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:DELIVERY_PACKAGE_RECEIPT_TARGET_MISSING");
    await readOrder(row.order_id, viewerRole);
    return projectDeliveryPackage(row, viewerRole);
  };

  const projectLatestDeliveryPackageAfterSnapshot = async (
    deliveryTaskId: string,
    viewerRole: "buyer" | "supplier" | "ops",
  ) => {
    const task = await db.prepare("SELECT order_id FROM exchange_delivery_tasks WHERE id = ?")
      .bind(deliveryTaskId).first<{ order_id: string }>();
    if (!task) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:DELIVERY_TASK_RECEIPT_TARGET_MISSING");
    await readOrder(task.order_id, viewerRole);
    const record = await readDeliveryPackage(deliveryTaskId, viewerRole);
    if (!record) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:DELIVERY_PACKAGE_RECEIPT_TARGET_MISSING");
    return record;
  };

  const projectConnectionCheckAfterSnapshot = async (packageId: string) => {
    const row = await db.prepare("SELECT order_id FROM exchange_delivery_packages WHERE id = ?")
      .bind(packageId).first<{ order_id: string }>();
    if (!row) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:DELIVERY_PACKAGE_RECEIPT_TARGET_MISSING");
    await readOrder(row.order_id, "buyer");
    const check = await db.prepare(`SELECT * FROM exchange_connection_checks
      WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).bind(packageId).first<ConnectionCheckRow>();
    if (!check) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:CONNECTION_RECEIPT_TARGET_MISSING");
    return mapConnectionCheck(check);
  };

  const projectSettlementAfterSnapshot = async (settlementId: string) => {
    const row = await db.prepare("SELECT * FROM exchange_settlements WHERE id = ?")
      .bind(settlementId).first<SettlementRow>();
    if (!row) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_RECEIPT_TARGET_MISSING");
    await readOrder(row.order_id, "ops");
    const commission = await db.prepare("SELECT * FROM exchange_commission_accruals WHERE settlement_id = ?")
      .bind(settlementId).first<CommissionAccrualRow>();
    const record = mapSettlement(row, commission);
    const eventPayload = JSON.stringify({
      ledgerBatchId: row.ledger_batch_id, grossAmountCents: record.grossAmountCents,
      baseCreditCents: record.baseCreditCents,
      netSupplierPayableCents: record.netSupplierPayableCents, fundsMoved: false,
    });
    const ledger = row.ledger_batch_id
      ? await db.prepare("SELECT * FROM exchange_ledger_batches WHERE id = ?").bind(row.ledger_batch_id)
        .first<SettlementLedgerBatchRow>()
      : null;
    const ledgerEntryResult = row.ledger_batch_id
      ? await db.prepare("SELECT * FROM exchange_ledger_entries WHERE batch_id = ? ORDER BY id")
        .bind(row.ledger_batch_id).all<SettlementLedgerEntryRow>()
      : { results: [] };
    assertExactTestSettlementLedger(row, ledger, ledgerEntryResult.results ?? []);
    const facts = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_type = 'SETTLEMENT' AND entity_id = ?
          AND event_type = 'TEST_SETTLEMENT_RECORDED') AS event_total_count,
        (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_type = 'SETTLEMENT' AND entity_id = ?
          AND event_type = 'TEST_SETTLEMENT_RECORDED' AND json(payload_json) = json(?)) AS event_count,
        (SELECT COUNT(*) FROM exchange_command_receipts WHERE entity_id = ?
          AND command_type = 'TEST_RECORD_SETTLEMENT') AS receipt_total_count,
        (SELECT COUNT(*) FROM exchange_command_receipts WHERE entity_id = ?
          AND command_type = 'TEST_RECORD_SETTLEMENT' AND json(response_json) = json(?)) AS receipt_count`)
      .bind(settlementId, settlementId, eventPayload, settlementId, settlementId, JSON.stringify(record))
      .first<{ event_total_count: number; event_count: number; receipt_total_count: number; receipt_count: number }>();
    if (Number(facts?.event_total_count ?? -1) !== 1 || Number(facts?.event_count ?? -1) !== 1
      || Number(facts?.receipt_total_count ?? -1) !== 1 || Number(facts?.receipt_count ?? -1) !== 1) {
      throw new Error("EXCHANGE_INVARIANT_CORRUPTION:SETTLEMENT_REPLAY_FACTS_INVALID");
    }
    return record;
  };

  return {
    async listProductVersions() {
      await ensureSchema();
      const result = await db.prepare(`SELECT pv.* FROM exchange_product_versions pv
        JOIN exchange_product_capacity_policies p
          ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
        ORDER BY pv.display_name ASC`).all<ProductRow>();
      return (result.results ?? []).map(mapProduct);
    },

    async listSupplierResources(actorId) {
      await ensureSchema();
      const result = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL}
        WHERE ra.supplier_actor_id = ? ORDER BY ra.created_at DESC`).bind(actorId).all<ResourceRow>();
      return (result.results ?? []).map(mapResource);
    },

    async listOpsResources() {
      await ensureSchema();
      const result = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL} ORDER BY ra.created_at DESC`).all<ResourceRow>();
      return (result.results ?? []).map(mapResource);
    },

    async createResource(context, input) {
      await ensureSchema();
      const existing = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL}
        WHERE ra.supplier_actor_id = ? AND ra.idempotency_key = ?`).bind(context.actorId, context.idempotencyKey).first<ResourceRow>();
      const replay = replayOrConflict(existing, context.payloadHash, mapResource);
      if (replay) return replay;
      const policy = await db.prepare(`SELECT p.* FROM exchange_product_capacity_policies p
        JOIN exchange_product_versions pv ON pv.id = p.product_version_id
        WHERE p.product_version_id = ? AND p.feature_status = 'ENABLED'`)
        .bind(input.productVersionId).first<ProductCapacityPolicyRow>();
      if (!policy || !["GPU_COMPUTE", "MODEL_INSTANCE", "TOKEN_THROUGHPUT", "NAS_STORAGE", "RACK_SPACE"].includes(policy.product_code)) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "未找到可交易的产品版本与容量政策。");
      }
      assertD1CanonicalInputForProduct(input, policy.rate_unit_code);
      const descriptor = capacityDescriptor(policy.rate_unit_code, {
        productCode: policy.product_code,
        rateUnitCode: policy.rate_unit_code,
        fulfillmentModel: policy.fulfillment_model,
        pricingUnitCode: policy.pricing_unit_code,
        priceBasisBaseUnits: policy.price_basis_base_units,
      });
      const record = newResource(context.actorId, input, descriptor);
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`INSERT INTO exchange_resource_assets (
          id, supplier_actor_id, idempotency_key, payload_hash, product_version_id,
          title, region, delivery_form, total_parallel_units, interruptibility,
          network_scope, status, version, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM exchange_product_capacity_policies
          WHERE product_version_id = ? AND feature_status = 'ENABLED' AND rate_unit_code = ?)`).bind(
          record.id, record.supplierActorId, context.idempotencyKey, context.payloadHash, record.productVersionId,
          record.title, record.region, record.deliveryForm, record.totalRateUnits, record.interruptibility,
          record.networkScope, record.status, record.version, record.createdAt, record.updatedAt,
          record.productVersionId, record.rateUnitCode,
        ),
          eventStatement(db, context.actorId, "RESOURCE_ASSET", record.id, "RESOURCE_DECLARED", record, record.createdAt),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_resource_assets WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ? AND event_type = 'RESOURCE_DECLARED') = 1`,
          record.id, record.id),
        ]);
      } catch (error) {
        return replayAfterConcurrentInsert<ResourceRow, ReturnType<typeof mapResource>>(
          error,
          db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL} WHERE ra.supplier_actor_id = ? AND ra.idempotency_key = ?`)
            .bind(context.actorId, context.idempotencyKey),
          context.payloadHash,
          mapResource,
        );
      }
      if (changes(results[0]) !== 1) {
        const concurrent = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL}
          WHERE ra.supplier_actor_id = ? AND ra.idempotency_key = ?`).bind(context.actorId, context.idempotencyKey).first<ResourceRow>();
        const concurrentReplay = replayOrConflict(concurrent, context.payloadHash, mapResource);
        if (concurrentReplay) return concurrentReplay;
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "资源创建状态发生变化，请重试。");
      }
      return { record, replayed: false };
    },

    async createVerification(resourceId, context, input) {
      await ensureSchema();
      const existing = await db.prepare(`SELECT * FROM exchange_verification_runs
        WHERE operator_actor_id = ? AND idempotency_key = ?`).bind(context.actorId, context.idempotencyKey).first<VerificationRow>();
      const replay = replayOrConflict(existing, context.payloadHash, mapVerification);
      if (replay) return replay;
      const resource = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL} WHERE ra.id = ?`).bind(resourceId).first<ResourceRow>();
      if (!resource) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源不存在或产品未开放交易。");
      if (["SUSPENDED", "WITHDRAWN"].includes(resource.status)) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "当前资源状态不能验真。");
      }
      const record = newVerification(context.actorId, resourceId, input);
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`INSERT INTO exchange_verification_runs (
          id, resource_asset_id, operator_actor_id, idempotency_key, payload_hash,
          method, result, evidence_summary, evidence_digest, valid_until, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_resource_assets
            WHERE id = ? AND status NOT IN ('SUSPENDED', 'WITHDRAWN'))`).bind(
          record.id, record.resourceAssetId, record.operatorActorId, context.idempotencyKey, context.payloadHash,
          record.method, record.result, record.evidenceSummary, record.evidenceDigest, record.validUntil, record.createdAt,
          resourceId,
        ),
        db.prepare(`UPDATE exchange_resource_assets SET status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status NOT IN ('SUSPENDED', 'WITHDRAWN')
            AND EXISTS (SELECT 1 FROM exchange_verification_runs WHERE id = ?)`).bind(
          record.result === "PASS" ? "VERIFIED" : "REJECTED", record.createdAt, resourceId, record.id,
        ),
          db.prepare(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'RESOURCE_ASSET', ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_verification_runs WHERE id = ?)`).bind(
            eventId(), context.actorId, resourceId, `VERIFICATION_${record.result}`,
            JSON.stringify({ verificationRunId: record.id, method: record.method, validUntil: record.validUntil }),
            record.createdAt, record.id,
          ),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_verification_runs WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_resource_assets WHERE id = ? AND status = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ? AND event_type = ?) = 1`,
          record.id, resourceId, record.result === "PASS" ? "VERIFIED" : "REJECTED",
          resourceId, `VERIFICATION_${record.result}`),
        ]);
      } catch (error) {
        return replayAfterConcurrentInsert<VerificationRow, ReturnType<typeof mapVerification>>(
          error,
          db.prepare(`SELECT * FROM exchange_verification_runs WHERE operator_actor_id = ? AND idempotency_key = ?`)
            .bind(context.actorId, context.idempotencyKey),
          context.payloadHash,
          mapVerification,
        );
      }
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_verification_runs
          WHERE operator_actor_id = ? AND idempotency_key = ?`).bind(context.actorId, context.idempotencyKey).first<VerificationRow>();
        const concurrentReplay = replayOrConflict(concurrent, context.payloadHash, mapVerification);
        if (concurrentReplay) return concurrentReplay;
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "资源状态已变化，请刷新后重试。");
      }
      return { record, replayed: false };
    },

    async listSupplierLots(actorId) {
      await ensureSchema();
      const result = await db.prepare(`${D1_LOT_WITH_POLICY_SQL}
        WHERE lot.supplier_actor_id = ? ORDER BY lot.created_at DESC`).bind(actorId).all<CapacityLotRow>();
      return Promise.all((result.results ?? []).map((row) => mapD1CapacityLotForSupplier(db, row)));
    },

    async createCapacityLot(context, input) {
      await ensureSchema();
      const existing = await db.prepare(`${D1_LOT_WITH_POLICY_SQL}
        WHERE lot.supplier_actor_id = ? AND lot.idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey).first<CapacityLotRow>();
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: await mapD1CapacityLotForSupplier(db, existing), replayed: true };
      }
      const resource = await db.prepare(`${D1_RESOURCE_WITH_POLICY_SQL} WHERE ra.id = ?`)
        .bind(input.resourceAssetId).first<ResourceRow>();
      if (!resource) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "资源不存在或产品未开放交易。");
      if (!resource.rate_unit_code) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:RESOURCE_POLICY_MISSING");
      if (resource.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能使用其他供应商的资源建立容量批次。");
      }
      if (resource.status !== "VERIFIED") throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 422, "资源通过验真后才能建立容量批次。");
      assertD1CanonicalInputForProduct(input, resource.rate_unit_code);
      if (input.rateUnits > resource.total_parallel_units) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "批次速率单位数超过资源总量。");
      if (input.interruptibility !== resource.interruptibility) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "批次可中断性必须与资源一致。");
      const verification = input.verificationRunId
        ? await db.prepare(`SELECT * FROM exchange_verification_runs
            WHERE id = ? AND resource_asset_id = ?`).bind(input.verificationRunId, input.resourceAssetId).first<VerificationRow>()
        : await db.prepare(`SELECT * FROM exchange_verification_runs
            WHERE resource_asset_id = ? AND result = 'PASS' AND valid_until >= ?
            ORDER BY created_at DESC LIMIT 1`).bind(input.resourceAssetId, input.endAt).first<VerificationRow>();
      if (!verification || verification.result !== "PASS") throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 422, "容量批次必须引用通过的验真记录。");
      if (!verification.valid_until || verification.valid_until < input.endAt) throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 422, "验真有效期必须覆盖完整容量时间窗。");
      const descriptor = capacityDescriptor(resource.rate_unit_code, {
        productCode: resource.product_code, rateUnitCode: resource.rate_unit_code,
        fulfillmentModel: resource.fulfillment_model, pricingUnitCode: resource.policy_pricing_unit_code,
        priceBasisBaseUnits: resource.price_basis_base_units,
      });
      const record = newCapacityLot(context.actorId, { ...input, verificationRunId: verification.id }, descriptor);
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`INSERT INTO exchange_capacity_lots (
          id, supplier_actor_id, idempotency_key, payload_hash, resource_asset_id,
          verification_run_id, start_at, end_at, rate_unit_code, rate_units, capacity_base_units,
          parallel_units, capacity_gpu_seconds,
          interruptibility, status, version, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM exchange_resource_assets ra
          JOIN exchange_product_capacity_policies p
            ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'
          WHERE ra.id = ? AND ra.supplier_actor_id = ? AND ra.status = 'VERIFIED'
            AND p.rate_unit_code = ? AND p.pricing_unit_code = ?
            AND ra.interruptibility = ? AND ra.total_parallel_units >= ?
            AND NOT EXISTS (
              SELECT 1 FROM (
                SELECT ? AS point
                UNION
                SELECT cl0.start_at AS point FROM exchange_capacity_lots cl0
                  WHERE cl0.resource_asset_id = ? AND cl0.status IN ('READY', 'LISTED')
                    AND cl0.start_at < ? AND cl0.end_at > ?
              ) points
              WHERE (SELECT COALESCE(SUM(cl1.rate_units), 0) FROM exchange_capacity_lots cl1
                WHERE cl1.resource_asset_id = ? AND cl1.status IN ('READY', 'LISTED')
                  AND cl1.start_at <= points.point AND cl1.end_at > points.point
              ) + ? > ra.total_parallel_units
            )
        )`).bind(
          record.id, record.supplierActorId, context.idempotencyKey, context.payloadHash, record.resourceAssetId,
          record.verificationRunId, record.startAt, record.endAt,
          record.rateUnitCode, record.rateUnits, record.capacityBaseUnits,
          record.rateUnitCode === "GPU" ? record.rateUnits : null,
          record.rateUnitCode === "GPU" ? record.capacityBaseUnits : null,
          record.interruptibility, record.status, record.version, record.createdAt, record.updatedAt,
          record.resourceAssetId, context.actorId, record.rateUnitCode, record.pricingUnitCode,
          record.interruptibility, record.rateUnits,
          record.startAt, record.resourceAssetId, record.endAt, record.startAt,
          record.resourceAssetId, record.rateUnits,
        ),
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) SELECT ?, ?, NULL, ?, 'ISSUED', 'AVAILABLE', ?, ?, ?, 'CAPACITY_LOT_CREATED', ?
          WHERE EXISTS (SELECT 1 FROM exchange_capacity_lots WHERE id = ?)`).bind(
          transferId(), record.id, `lot:${record.id}:issued`,
          record.rateUnitCode, record.capacityBaseUnits,
          record.rateUnitCode === "GPU" ? record.capacityBaseUnits : null, record.createdAt, record.id,
        ),
          eventStatement(db, context.actorId, "CAPACITY_LOT", record.id, "CAPACITY_LOT_READY", record, record.createdAt),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_capacity_lots WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_transfers
              WHERE capacity_lot_id = ? AND reason = 'CAPACITY_LOT_CREATED') = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events
              WHERE entity_id = ? AND event_type = 'CAPACITY_LOT_READY') = 1`,
          record.id, record.id, record.id),
        ]);
      } catch (error) {
        return replayAfterConcurrentInsert<CapacityLotRow, ReturnType<typeof mapCapacityLot>>(
          error,
          db.prepare(`${D1_LOT_WITH_POLICY_SQL}
            WHERE lot.supplier_actor_id = ? AND lot.idempotency_key = ?`)
            .bind(context.actorId, context.idempotencyKey),
          context.payloadHash,
          mapCapacityLot,
        );
      }
      if (changes(results[0]) !== 1) {
        const concurrent = await db.prepare(`${D1_LOT_WITH_POLICY_SQL}
          WHERE lot.supplier_actor_id = ? AND lot.idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<CapacityLotRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: await mapD1CapacityLotForSupplier(db, concurrent), replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "该资源在所选时间窗内的容量批次将发生超配。");
      }
      return { record, replayed: false };
    },

    async createListing(context, input) {
      await ensureSchema();
      const existing = await db.prepare(`${D1_LISTING_WITH_POLICY_SQL}
        WHERE lv.supplier_actor_id = ? AND lv.idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey).first<ListingRow>();
      const replay = replayOrConflict(existing, context.payloadHash, mapListing);
      if (replay) return replay;
      const lot = await db.prepare(`${D1_LOT_WITH_POLICY_SQL} WHERE lot.id = ?`)
        .bind(input.capacityLotId).first<CapacityLotRow>();
      if (!lot) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "容量批次不存在。");
      if (lot.supplier_actor_id !== context.actorId) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能上架其他供应商的容量批次。");
      if (lot.status !== "READY") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "只有待上架的容量批次可以发布。");
      if (lot.version !== input.expectedLotVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次版本已经变化，请刷新后重试。");
      }
      assertD1CanonicalInputForProduct(input, lot.rate_unit_code);
      if (input.maxRateUnits > lot.rate_units) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "上架最大速率单位数超过容量批次。");
      if (lot.rate_unit_code === "GPU" && input.unitPriceMicros % 10_000 !== 0) {
        throw new ExchangeDomainError("EXCHANGE_UNIT_MISMATCH", 422, "GPU 小时报价必须精确到分。");
      }
      if (input.validFrom >= lot.end_at || input.validUntil > lot.end_at) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "上架有效期必须在容量批次结束前截止。");
      const verification = await db.prepare("SELECT * FROM exchange_verification_runs WHERE id = ?").bind(lot.verification_run_id).first<VerificationRow>();
      if (!verification || verification.result !== "PASS" || !verification.valid_until || verification.valid_until < lot.end_at) {
        throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 422, "发布前需要覆盖完整容量时间窗的有效验真。");
      }
      const descriptor = capacityDescriptor(lot.rate_unit_code, {
        productCode: lot.product_code, rateUnitCode: lot.rate_unit_code,
        fulfillmentModel: lot.fulfillment_model, pricingUnitCode: lot.policy_pricing_unit_code,
        priceBasisBaseUnits: lot.price_basis_base_units,
      });
      const record = newListing(context.actorId, input, descriptor);
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`INSERT INTO exchange_listing_versions (
          id, listing_id, version_number, supplier_actor_id, idempotency_key, payload_hash,
          capacity_lot_id, rate_unit_code, unit_price_micros, unit_price_cents, currency, pricing_unit_code,
          min_rate_units, max_rate_units, min_parallel_units, max_parallel_units, min_duration_minutes,
          tax_included, energy_included, network_included, scope_note, sla_json,
          delivery_form, valid_from, valid_until, status, created_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM exchange_capacity_lots cl
          JOIN exchange_resource_assets ra ON ra.id = cl.resource_asset_id
          JOIN exchange_product_capacity_policies p
            ON p.product_version_id = ra.product_version_id AND p.feature_status = 'ENABLED'
          WHERE cl.id = ? AND cl.supplier_actor_id = ? AND cl.status = 'READY' AND cl.version = ?
            AND cl.rate_units >= ? AND cl.rate_unit_code = ? AND p.rate_unit_code = ? AND p.pricing_unit_code = ?)`).bind(
          record.id, record.listingId, record.versionNumber, record.supplierActorId, context.idempotencyKey, context.payloadHash,
          record.capacityLotId, record.rateUnitCode, record.unitPriceMicros,
          record.rateUnitCode === "GPU" ? record.unitPriceMicros / 10_000 : null,
          record.currency, record.pricingUnitCode, record.minRateUnits, record.maxRateUnits,
          record.rateUnitCode === "GPU" ? record.minRateUnits : null,
          record.rateUnitCode === "GPU" ? record.maxRateUnits : null, record.minDurationMinutes,
          Number(record.taxIncluded), Number(record.energyIncluded), Number(record.networkIncluded), record.scopeNote, JSON.stringify(record.sla),
          record.deliveryForm, record.validFrom, record.validUntil, record.status, record.createdAt,
          record.capacityLotId, context.actorId, input.expectedLotVersion,
          record.maxRateUnits, record.rateUnitCode, record.rateUnitCode, record.pricingUnitCode,
        ),
        db.prepare(`UPDATE exchange_capacity_lots
          SET status = 'LISTED', version = version + 1, updated_at = ?
          WHERE id = ? AND supplier_actor_id = ? AND status = 'READY' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_listing_versions WHERE id = ?)`)
          .bind(record.createdAt, record.capacityLotId, context.actorId, input.expectedLotVersion, record.id),
          eventStatement(db, context.actorId, "LISTING", record.listingId, "LISTING_PUBLISHED", record, record.createdAt),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_listing_versions WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_lots
              WHERE id = ? AND status = 'LISTED' AND version = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events
              WHERE entity_id = ? AND event_type = 'LISTING_PUBLISHED') = 1`,
          record.id, record.capacityLotId, input.expectedLotVersion + 1, record.listingId),
        ]);
      } catch (error) {
        return replayAfterConcurrentInsert<ListingRow, ReturnType<typeof mapListing>>(
          error,
          db.prepare(`${D1_LISTING_WITH_POLICY_SQL}
            WHERE lv.supplier_actor_id = ? AND lv.idempotency_key = ?`)
            .bind(context.actorId, context.idempotencyKey),
          context.payloadHash,
          mapListing,
        );
      }
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
        const concurrent = await db.prepare(`${D1_LISTING_WITH_POLICY_SQL}
          WHERE lv.supplier_actor_id = ? AND lv.idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<ListingRow>();
        const concurrentReplay = replayOrConflict(concurrent, context.payloadHash, mapListing);
        if (concurrentReplay) return concurrentReplay;
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "容量批次状态已变化，请刷新后重试。");
      }
      return { record, replayed: false };
    },

    async withdrawCapacityLot(lotId, context, input) {
      await ensureSchema();
      const existing = await db.prepare(`SELECT * FROM exchange_capacity_withdrawals
        WHERE supplier_actor_id = ? AND idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey).first<CapacityWithdrawalRow>();
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: await projectD1CapacityWithdrawal(db, existing), replayed: true };
      }
      const lot = await db.prepare(`${D1_LOT_WITH_POLICY_SQL} WHERE lot.id = ?`)
        .bind(lotId).first<CapacityLotRow>();
      if (!lot) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "容量批次不存在。");
      if (lot.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "不能取出其他供应商的容量批次。");
      }
      if (lot.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次版本已经变化，请刷新后重试。");
      }
      const eligibility = await d1WithdrawalEligibility(db, lot);
      if (!eligibility.eligible) {
        throw new ExchangeDomainError("EXCHANGE_WITHDRAWAL_INELIGIBLE", 409, eligibility.reasonCode);
      }

      const occurredAt = clock().toISOString();
      const withdrawalId = createExchangeId("WD");
      const withdrawalTransferId = transferId();
      const record = {
        id: withdrawalId,
        capacityLotId: lot.id,
        supplierActorId: context.actorId,
        transferId: withdrawalTransferId,
        rateUnitCode: lot.rate_unit_code,
        capacityBaseUnits: lot.capacity_base_units,
        reason: input.reason,
        occurredAt,
      } as const;
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`UPDATE exchange_capacity_lots
            SET status = 'WITHDRAWN', version = version + 1, updated_at = ?
            WHERE id = ? AND supplier_actor_id = ? AND status = 'READY' AND version = ?
              AND NOT EXISTS (SELECT 1 FROM exchange_listing_versions WHERE capacity_lot_id = ?)
              AND NOT EXISTS (SELECT 1 FROM exchange_reservations WHERE capacity_lot_id = ?)
              AND NOT EXISTS (SELECT 1 FROM exchange_capacity_withdrawals WHERE capacity_lot_id = ?)
              AND (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE capacity_lot_id = ?) = 1
              AND EXISTS (SELECT 1 FROM exchange_capacity_transfers transfer
                WHERE transfer.capacity_lot_id = ? AND transfer.idempotency_key = ?
                  AND transfer.from_bucket = 'ISSUED' AND transfer.to_bucket = 'AVAILABLE'
                  AND transfer.order_id IS NULL AND transfer.reason = 'CAPACITY_LOT_CREATED'
                  AND transfer.rate_unit_code = exchange_capacity_lots.rate_unit_code
                  AND transfer.capacity_base_units = exchange_capacity_lots.capacity_base_units
                  AND transfer.accounting_schema_version = exchange_capacity_lots.accounting_schema_version
                  AND ((transfer.rate_unit_code = 'GPU' AND transfer.capacity_gpu_seconds = transfer.capacity_base_units)
                    OR (transfer.rate_unit_code <> 'GPU' AND transfer.capacity_gpu_seconds IS NULL)))`)
            .bind(
              occurredAt, lot.id, context.actorId, input.expectedVersion,
              lot.id, lot.id, lot.id, lot.id, lot.id, `lot:${lot.id}:issued`,
            ),
          db.prepare(`INSERT INTO exchange_capacity_transfers (
              id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
              rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at,
              accounting_schema_version
            )
            SELECT ?, lot.id, NULL, ?, 'AVAILABLE', 'WITHDRAWN', lot.rate_unit_code,
              lot.capacity_base_units, lot.capacity_gpu_seconds, 'CAPACITY_LOT_WITHDRAWN', ?, lot.accounting_schema_version
            FROM exchange_capacity_lots lot
            WHERE lot.id = ? AND lot.supplier_actor_id = ? AND lot.status = 'WITHDRAWN'
              AND lot.version = ? + 1`)
            .bind(
              withdrawalTransferId, `withdrawal:${withdrawalId}`, occurredAt,
              lot.id, context.actorId, input.expectedVersion,
            ),
          db.prepare(`INSERT INTO exchange_capacity_withdrawals (
              id, capacity_lot_id, supplier_actor_id, idempotency_key, payload_hash,
              expected_lot_version, transfer_id, rate_unit_code, capacity_base_units,
              capacity_gpu_seconds, accounting_schema_version, reason, occurred_at
            )
            SELECT ?, lot.id, ?, ?, ?, ?, transfer.id, lot.rate_unit_code,
              lot.capacity_base_units, lot.capacity_gpu_seconds, lot.accounting_schema_version, ?, ?
            FROM exchange_capacity_lots lot
            JOIN exchange_capacity_transfers transfer ON transfer.id = ?
            WHERE lot.id = ? AND lot.status = 'WITHDRAWN' AND lot.version = ? + 1`)
            .bind(
              withdrawalId, context.actorId, context.idempotencyKey, context.payloadHash,
              input.expectedVersion, input.reason, occurredAt, withdrawalTransferId,
              lot.id, input.expectedVersion,
            ),
          db.prepare(`INSERT INTO exchange_domain_events (
              id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
            ) SELECT ?, ?, 'CAPACITY_LOT', ?, 'CAPACITY_LOT_WITHDRAWN', ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_capacity_withdrawals WHERE id = ?)`)
            .bind(eventId(), context.actorId, lot.id, JSON.stringify(record), occurredAt, withdrawalId),
          db.prepare(`INSERT INTO exchange_command_receipts (
              actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
            ) SELECT ?, ?, ?, 'WITHDRAW_CAPACITY_LOT', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_capacity_withdrawals WHERE id = ?)`)
            .bind(
              context.actorId, context.idempotencyKey, context.payloadHash,
              withdrawalId, JSON.stringify(record), occurredAt, withdrawalId,
            ),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_capacity_lots
              WHERE id = ? AND supplier_actor_id = ? AND status = 'WITHDRAWN' AND version = ? + 1) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_withdrawals
              WHERE id = ? AND capacity_lot_id = ? AND transfer_id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_transfers
              WHERE id = ? AND capacity_lot_id = ? AND from_bucket = 'AVAILABLE'
                AND to_bucket = 'WITHDRAWN' AND capacity_base_units = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE capacity_lot_id = ?) = 2
            AND (SELECT COUNT(*) FROM exchange_domain_events
              WHERE entity_id = ? AND event_type = 'CAPACITY_LOT_WITHDRAWN') = 1
            AND (SELECT COUNT(*) FROM exchange_command_receipts
              WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?) = 1`,
          lot.id, context.actorId, input.expectedVersion,
          withdrawalId, lot.id, withdrawalTransferId,
          withdrawalTransferId, lot.id, lot.capacity_base_units, lot.id,
          lot.id, context.actorId, context.idempotencyKey, withdrawalId),
        ]);
      } catch (error) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_capacity_withdrawals
          WHERE supplier_actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<CapacityWithdrawalRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: await projectD1CapacityWithdrawal(db, concurrent), replayed: true };
        }
        throw error;
      }
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1
        || changes(results[3]) !== 1 || changes(results[4]) !== 1) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "容量批次已经被其他操作处理，请刷新后重试。");
      }
      return { record, replayed: false };
    },

    async createSwapQuote(context, input) {
      await ensureSchema();
      const existing = await db.prepare(`SELECT * FROM exchange_swap_quotes
        WHERE initiator_actor_id = ? AND idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey).first<SwapQuoteRow>();
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: await readD1SwapQuote(db, existing.id, undefined, clock().toISOString(), context.actorId), replayed: true };
      }
      const generatedAt = clock().toISOString();
      const offeredRow = await db.prepare(`${D1_SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
        .bind(input.offered.listingVersionId).first<D1SwapListingFactRow>();
      const wantedRow = await db.prepare(`${D1_SWAP_LISTING_FACT_SQL} WHERE lv.id = ?`)
        .bind(input.wanted.listingVersionId).first<D1SwapListingFactRow>();
      if (!offeredRow || !wantedRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价引用的挂牌不存在。");
      const offeredFact = d1SwapListingFact(offeredRow);
      const wantedFact = d1SwapListingFact(wantedRow);
      assertSwapListingFact(offeredFact, input.offered, generatedAt);
      assertSwapListingFact(wantedFact, input.wanted, generatedAt);
      await assertD1SwapInventory(db, offeredFact, input.offered, generatedAt);
      await assertD1SwapInventory(db, wantedFact, input.wanted, generatedAt);
      const quote = await buildSwapQuote(context.actorId, input, offeredFact, wantedFact, generatedAt, sha256);
      const creationEventId = eventId();
      try {
        const legStatements = [quote.offered, quote.wanted].map((leg) => db.prepare(`INSERT INTO exchange_swap_quote_snapshots (
            id, quote_id, leg_role, source_listing_version_id, listing_created_at, listing_valid_from,
            product_version_id, capacity_policy_id, product_code, rate_unit_code, fulfillment_model,
            pricing_unit_code, rate_units, start_at, end_at, duration_seconds, capacity_base_units,
            unit_price_micros, price_basis_base_units, value_cents, currency, generated_at, expires_at, snapshot_digest
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes WHERE id = ?)`)
          .bind(
            leg.id, leg.quoteId, leg.legRole, leg.sourceListingVersionId, leg.listingCreatedAt,
            leg.listingValidFrom, leg.productVersionId, leg.capacityPolicyId, leg.productCode,
            leg.rateUnitCode, leg.fulfillmentModel, leg.pricingUnitCode, leg.rateUnits,
            leg.startAt, leg.endAt, leg.durationSeconds, leg.capacityBaseUnits,
            leg.unitPriceMicros, leg.priceBasisBaseUnits, leg.valueCents, leg.currency,
            leg.generatedAt, leg.expiresAt, leg.snapshotDigest, quote.id,
          ));
        const results = await db.batch([
          db.prepare(`INSERT INTO exchange_swap_quotes (
              id, initiator_actor_id, counterparty_actor_id, idempotency_key, payload_hash,
              offered_value_cents, wanted_value_cents, cash_adjustment_signed_cents,
              cash_adjustment_amount_cents, cash_adjustment_payer_actor_id,
              cash_adjustment_payee_actor_id, generated_at, expires_at, quote_digest
            ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_listing_versions lv
              JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
              JOIN exchange_resource_assets resource ON resource.id = lot.resource_asset_id
              WHERE lv.id = ? AND lv.supplier_actor_id = ? AND lv.status = 'ACTIVE'
                AND lot.status = 'LISTED' AND resource.status = 'VERIFIED'
                AND lv.valid_from <= ? AND lv.valid_until >= ?
                AND ? >= lot.start_at AND ? <= lot.end_at
                AND ? BETWEEN lv.min_rate_units AND lv.max_rate_units
                AND ? <= lot.rate_units
                AND unixepoch(?) - unixepoch(?) >= lv.min_duration_minutes * 60)
              AND EXISTS (SELECT 1 FROM exchange_listing_versions lv
              JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
              JOIN exchange_resource_assets resource ON resource.id = lot.resource_asset_id
              WHERE lv.id = ? AND lv.supplier_actor_id = ? AND lv.status = 'ACTIVE'
                AND lot.status = 'LISTED' AND resource.status = 'VERIFIED'
                AND lv.valid_from <= ? AND lv.valid_until >= ?
                AND ? >= lot.start_at AND ? <= lot.end_at
                AND ? BETWEEN lv.min_rate_units AND lv.max_rate_units
                AND ? <= lot.rate_units
                AND unixepoch(?) - unixepoch(?) >= lv.min_duration_minutes * 60)`)
            .bind(
              quote.id, quote.initiatorActorId, quote.counterpartyActorId, context.idempotencyKey,
              context.payloadHash, quote.offeredValueCents, quote.wantedValueCents,
              quote.cashAdjustmentSignedCents, quote.cashAdjustmentAmountCents,
              quote.cashAdjustmentPayerActorId, quote.cashAdjustmentPayeeActorId,
              quote.generatedAt, quote.expiresAt, quote.quoteDigest,
              quote.offered.sourceListingVersionId, context.actorId, quote.generatedAt, quote.expiresAt,
              quote.offered.startAt, quote.offered.endAt, quote.offered.rateUnits, quote.offered.rateUnits,
              quote.offered.endAt, quote.offered.startAt,
              quote.wanted.sourceListingVersionId, quote.counterpartyActorId, quote.generatedAt, quote.expiresAt,
              quote.wanted.startAt, quote.wanted.endAt, quote.wanted.rateUnits, quote.wanted.rateUnits,
              quote.wanted.endAt, quote.wanted.startAt,
            ),
          ...legStatements,
          db.prepare(`INSERT INTO exchange_swap_quote_status_events (
              id, quote_id, actor_id, idempotency_key, payload_hash, status, version, reason, occurred_at
            ) SELECT ?, ?, ?, ?, ?, 'QUOTED', 1, 'Initial quote generated', ?
            WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes WHERE id = ?)`)
            .bind(
              createExchangeId("SQE"), quote.id, context.actorId, context.idempotencyKey,
              context.payloadHash, quote.generatedAt, quote.id,
            ),
          db.prepare(`INSERT INTO exchange_domain_events (
              id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
            ) SELECT ?, ?, 'SWAP_QUOTE', ?, 'SWAP_QUOTE_CREATED', ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes WHERE id = ?)`)
            .bind(creationEventId, context.actorId, quote.id, JSON.stringify(quote), quote.generatedAt, quote.id),
          db.prepare(`INSERT INTO exchange_command_receipts (
              actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
            ) SELECT ?, ?, ?, 'CREATE_SWAP_QUOTE', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes WHERE id = ?)`)
            .bind(
              context.actorId, context.idempotencyKey, context.payloadHash,
              quote.id, JSON.stringify(quote), quote.generatedAt, quote.id,
            ),
          d1SwapInventoryInvariant(db, offeredFact, input.offered, quote.generatedAt),
          d1SwapInventoryInvariant(db, wantedFact, input.wanted, quote.generatedAt),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_swap_quotes WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_swap_quote_snapshots WHERE quote_id = ?) = 2
            AND (SELECT COUNT(*) FROM exchange_swap_quote_snapshots WHERE quote_id = ? AND leg_role = 'OFFERED') = 1
            AND (SELECT COUNT(*) FROM exchange_swap_quote_snapshots WHERE quote_id = ? AND leg_role = 'WANTED') = 1
            AND (SELECT COUNT(*) FROM exchange_swap_quote_status_events WHERE quote_id = ? AND status = 'QUOTED' AND version = 1) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ? AND event_type = 'SWAP_QUOTE_CREATED') = 1
            AND (SELECT COUNT(*) FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?) = 1`,
          quote.id, quote.id, quote.id, quote.id, quote.id, creationEventId,
          context.actorId, context.idempotencyKey, quote.id),
        ]);
        if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1
          || changes(results[3]) !== 1 || changes(results[4]) !== 1 || changes(results[5]) !== 1) {
          throw new Error("EXCHANGE_SWAP_QUOTE_BATCH_INVARIANT_FAILED");
        }
      } catch (error) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_swap_quotes
          WHERE initiator_actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<SwapQuoteRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: await readD1SwapQuote(db, concurrent.id, undefined, undefined, context.actorId), replayed: true };
        }
        throw error;
      }
      return { record: await readD1SwapQuote(db, quote.id, undefined, clock().toISOString(), context.actorId), replayed: false };
    },

    async listSwapQuotes(actorId) {
      await ensureSchema();
      const rows = await db.prepare(`SELECT * FROM exchange_swap_quotes
        WHERE initiator_actor_id = ? OR counterparty_actor_id = ? ORDER BY generated_at DESC`)
        .bind(actorId, actorId).all<SwapQuoteRow>();
      const now = clock().toISOString();
      return Promise.all((rows.results ?? []).map((row) => readD1SwapQuote(db, row.id, undefined, now, actorId)));
    },

    async transitionSwapQuote(quoteId, context, input) {
      await ensureSchema();
      const replayEvent = await db.prepare(`SELECT * FROM exchange_swap_quote_status_events
        WHERE actor_id = ? AND idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey).first<SwapQuoteStatusEventRow>();
      if (replayEvent) {
        if (replayEvent.payload_hash !== context.payloadHash || replayEvent.quote_id !== quoteId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: await readD1SwapQuote(db, quoteId, undefined, clock().toISOString(), context.actorId), replayed: true };
      }
      const quoteRow = await db.prepare("SELECT * FROM exchange_swap_quotes WHERE id = ?")
        .bind(quoteId).first<SwapQuoteRow>();
      if (!quoteRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "置换报价不存在。");
      if (quoteRow.initiator_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有报价发起方可以变更报价状态。");
      }
      const latest = await db.prepare(`SELECT * FROM exchange_swap_quote_status_events
        WHERE quote_id = ? ORDER BY version DESC LIMIT 1`).bind(quoteId).first<SwapQuoteStatusEventRow>();
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
      const statusEvent: SwapQuoteStatusEventRow = {
        id: createExchangeId("SQE"), quote_id: quoteId, actor_id: context.actorId,
        idempotency_key: context.idempotencyKey, payload_hash: context.payloadHash,
        status: input.action, version: input.expectedVersion + 1,
        reason: input.reason, occurred_at: occurredAt,
      };
      const projected = mapSwapQuote(
        quoteRow,
        (await db.prepare("SELECT * FROM exchange_swap_quote_snapshots WHERE quote_id = ? ORDER BY leg_role")
          .bind(quoteId).all<SwapQuoteSnapshotRow>()).results as [SwapQuoteSnapshotRow, SwapQuoteSnapshotRow],
        statusEvent,
        occurredAt,
        context.actorId,
      );
      const transitionEventId = eventId();
      const results = await db.batch([
        db.prepare(`INSERT INTO exchange_swap_quote_status_events (
            id, quote_id, actor_id, idempotency_key, payload_hash, status, version, reason, occurred_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_swap_quotes quote
            WHERE quote.id = ? AND quote.initiator_actor_id = ?
              AND ((? = 'EXPIRED' AND quote.expires_at <= ?)
                OR (? <> 'EXPIRED' AND quote.expires_at > ?)))`)
          .bind(
            statusEvent.id, quoteId, context.actorId, context.idempotencyKey, context.payloadHash,
            statusEvent.status, statusEvent.version, statusEvent.reason, statusEvent.occurred_at,
            quoteId, context.actorId, input.action, occurredAt, input.action, occurredAt,
          ),
        db.prepare(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'SWAP_QUOTE', ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_swap_quote_status_events WHERE id = ?)`)
          .bind(
            transitionEventId, context.actorId, quoteId, `SWAP_QUOTE_${input.action}`,
            JSON.stringify({ status: input.action, version: statusEvent.version, reason: input.reason }),
            occurredAt, statusEvent.id,
          ),
        db.prepare(`INSERT INTO exchange_command_receipts (
            actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
          ) SELECT ?, ?, ?, 'TRANSITION_SWAP_QUOTE', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_swap_quote_status_events WHERE id = ?)`)
          .bind(
            context.actorId, context.idempotencyKey, context.payloadHash,
            quoteId, JSON.stringify(projected), occurredAt, statusEvent.id,
          ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_swap_quote_status_events WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?) = 1`,
        statusEvent.id, statusEvent.version, transitionEventId, context.actorId, context.idempotencyKey),
      ]);
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "置换报价已经被其他操作处理，请刷新后重试。");
      }
      return { record: await readD1SwapQuote(db, quoteId, statusEvent, occurredAt, context.actorId), replayed: false };
    },
    async generateReferralCode(context) {
      await ensureSchema();
      const existing = await db.prepare("SELECT * FROM exchange_referral_codes WHERE agent_actor_id = ?")
        .bind(context.actorId).first<ReferralCodeRow>();
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
      const referralEventId = eventId();
      try {
        const results = await db.batch([
          db.prepare(`INSERT INTO exchange_referral_codes (
            id, agent_actor_id, idempotency_key, payload_hash, code, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(record.id, record.agentActorId, context.idempotencyKey, context.payloadHash, record.code, record.createdAt),
          db.prepare(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'REFERRAL_CODE', ?, 'REFERRAL_CODE_CREATED', ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_referral_codes WHERE id = ?)`)
            .bind(referralEventId, context.actorId, record.id, JSON.stringify(record), createdAt, record.id),
          db.prepare(`INSERT INTO exchange_command_receipts (
            actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
          ) SELECT ?, ?, ?, 'GENERATE_REFERRAL_CODE', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_referral_codes WHERE id = ?)`)
            .bind(
              context.actorId, context.idempotencyKey, context.payloadHash,
              record.id, JSON.stringify(record), createdAt, record.id,
            ),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_referral_codes WHERE id = ? AND agent_actor_id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?) = 1`,
          record.id, context.actorId, referralEventId, context.actorId, context.idempotencyKey),
        ]);
        if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
          throw new Error("EXCHANGE_REFERRAL_CODE_BATCH_INVARIANT_FAILED");
        }
      } catch (error) {
        const concurrent = await db.prepare("SELECT * FROM exchange_referral_codes WHERE agent_actor_id = ?")
          .bind(context.actorId).first<ReferralCodeRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: mapReferralCode(concurrent), replayed: true };
        }
        throw error;
      }
      return { record, replayed: false };
    },

    async listReferralCodes(actorId) {
      await ensureSchema();
      const rows = await db.prepare(`SELECT * FROM exchange_referral_codes
        WHERE agent_actor_id = ? ORDER BY created_at DESC`).bind(actorId).all<ReferralCodeRow>();
      return (rows.results ?? []).map(mapReferralCode);
    },

    async resolveReferralCode(code) {
      await ensureSchema();
      if (code === null || code.trim() === "") return { resolvedCodeId: null, submittedCodeDigest: null };
      const normalized = code.trim().toUpperCase();
      if (normalized.length < 8 || normalized.length > 40 || !/^[A-Z0-9-]+$/u.test(normalized)) {
        return { resolvedCodeId: null, submittedCodeDigest: await sha256(normalized) };
      }
      const row = await db.prepare("SELECT id FROM exchange_referral_codes WHERE code = ?")
        .bind(normalized).first<{ id: string }>();
      return row
        ? { resolvedCodeId: row.id, submittedCodeDigest: null }
        : { resolvedCodeId: null, submittedCodeDigest: await sha256(normalized) };
    },

    async listReferralAttributions(actorId) {
      await ensureSchema();
      const rows = await db.prepare(`SELECT * FROM exchange_referral_attributions
        WHERE agent_actor_id = ? ORDER BY attributed_at DESC`).bind(actorId).all<ReferralAttributionRow>();
      return (rows.results ?? []).map(mapReferralAttribution);
    },

    async listCommissionAccruals(actorId) {
      await ensureSchema();
      const rows = await db.prepare(`SELECT * FROM exchange_commission_accruals
        WHERE agent_actor_id = ? ORDER BY created_at DESC`).bind(actorId).all<CommissionAccrualRow>();
      return (rows.results ?? []).map(mapCommissionAccrual);
    },

    async listMarketListings() {
      await ensureSchema();
      const now = new Date().toISOString();
      const result = await db.prepare(`SELECT
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
        ORDER BY lv.created_at DESC`).bind(now, now, now).all<ListingRow & Record<string, string | number>>();
      return (result.results ?? []).map((row): MarketListing => {
        const listing = mapListing(row);
        return {
          ...listing,
          resource: mapResource({
            id: String(row.resource_id), supplier_actor_id: String(row.resource_supplier_actor_id), payload_hash: "",
            product_version_id: String(row.resource_product_version_id), title: String(row.resource_title),
            region: String(row.resource_region), delivery_form: String(row.resource_delivery_form),
            total_parallel_units: Number(row.resource_total_rate_units),
            interruptibility: row.resource_interruptibility as ResourceRow["interruptibility"],
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
            start_at: String(row.lot_start_at), end_at: String(row.lot_end_at),
            rate_unit_code: row.lot_rate_unit_code as CapacityLotRow["rate_unit_code"],
            rate_units: Number(row.lot_rate_units), capacity_base_units: Number(row.lot_capacity_base_units),
            parallel_units: row.lot_parallel_units === null ? null : Number(row.lot_parallel_units),
            capacity_gpu_seconds: row.lot_capacity_gpu_seconds === null ? null : Number(row.lot_capacity_gpu_seconds),
            accounting_schema_version: Number(row.lot_accounting_schema_version) as CapacityLotRow["accounting_schema_version"],
            interruptibility: row.lot_interruptibility as CapacityLotRow["interruptibility"],
            status: row.lot_status as CapacityLotRow["status"], version: Number(row.lot_version),
            created_at: String(row.lot_created_at), updated_at: String(row.lot_updated_at),
            product_code: row.product_code as CapacityLotRow["product_code"],
            fulfillment_model: row.fulfillment_model as CapacityLotRow["fulfillment_model"],
            policy_pricing_unit_code: row.policy_pricing_unit_code as CapacityLotRow["policy_pricing_unit_code"],
            price_basis_base_units: Number(row.price_basis_base_units),
          }),
          product: mapProduct({
          id: String(row.product_id), product_code: row.product_code as ProductRow["product_code"],
          pricing_unit_code: row.product_pricing_unit_code as ProductRow["pricing_unit_code"],
          display_name: String(row.display_name), manufacturer: String(row.manufacturer), model: String(row.model),
            form_factor: String(row.form_factor), specs_json: String(row.specs_json),
            immutable_hash: String(row.product_immutable_hash), created_at: String(row.product_created_at),
          }),
        };
      });
    },

    async createCheckout(context, input, referral = { resolvedCodeId: null, submittedCodeDigest: null }) {
      await ensureSchema();
      const existing = await db.prepare(`SELECT * FROM exchange_orders
        WHERE buyer_actor_id = ? AND idempotency_key = ?`).bind(context.actorId, context.idempotencyKey).first<OrderRow>();
      if (existing) {
        if (existing.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
        return { record: (await readOrder(existing.id, "buyer")).record, replayed: true };
      }
      const listing = await db.prepare(`SELECT lv.*, cl.start_at AS lot_start_at, cl.end_at AS lot_end_at,
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
        WHERE lv.id = ?`).bind(input.listingVersionId).first<ListingRow & {
          lot_start_at: string; lot_end_at: string; lot_rate_unit_code: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR";
          lot_rate_units: number; lot_id: string; lot_status: string; resource_asset_id: string; product_version_id: string;
          product_code: "GPU_COMPUTE" | "MODEL_INSTANCE" | "TOKEN_THROUGHPUT"; product_identity_json: string;
          capacity_policy_id: string; policy_rate_unit_code: "GPU" | "MODEL_INSTANCE" | "MILLI_M_TOKEN_PER_HOUR";
          fulfillment_model: "GPU_ALLOCATION" | "MODEL_INSTANCE_ALLOCATION" | "TOKEN_THROUGHPUT_RESERVATION";
          policy_pricing_unit_code: "GPU_HOUR" | "MODEL_INSTANCE_HOUR" | "M_TOKEN_CAPACITY_HOUR";
          price_basis_base_units: number; evidence_policy_version: string;
          lot_interruptibility: "NON_INTERRUPTIBLE" | "INTERRUPTIBLE";
        }>();
      if (!listing) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "上架版本不存在。");
      const now = new Date().toISOString();
      if (listing.supplier_actor_id === context.actorId) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "供应商不能购买自己的上架资源。");
      if (listing.status !== "ACTIVE" || listing.valid_from > now || listing.valid_until <= now || listing.lot_status !== "LISTED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该上架版本当前不可购买。");
      }
      if (input.startAt < listing.lot_start_at || input.endAt > listing.lot_end_at) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "所选服务时间必须完整落在容量批次内。");
      assertD1CanonicalInputForProduct(input, listing.policy_rate_unit_code);
      if (listing.rate_unit_code !== listing.lot_rate_unit_code
        || listing.rate_unit_code !== listing.policy_rate_unit_code
        || listing.pricing_unit_code !== listing.policy_pricing_unit_code) {
        throw new Error("EXCHANGE_INVARIANT_CORRUPTION:LISTING_POLICY_UNIT_MISMATCH");
      }
      if (input.rateUnits < listing.min_rate_units || input.rateUnits > listing.max_rate_units) {
        throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "速率单位数不在上架允许范围内。");
      }
      if (input.interruptibility !== listing.lot_interruptibility) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "订单中断属性必须与所选上架容量一致。");
      if ((Date.parse(input.endAt) - Date.parse(input.startAt)) / 60_000 < listing.min_duration_minutes) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "服务时长低于该上架版本的最短时长。");

      const expiredResult = await db.prepare(`SELECT * FROM exchange_reservations
        WHERE capacity_lot_id = ? AND state IN ('HELD', 'SUPPLIER_CONFIRMED') AND hold_expires_at <= ?`)
        .bind(listing.lot_id, now).all<ReservationRow>();
      const expired = expiredResult.results ?? [];
      await expireD1Reservations(db, expired, now);

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
      const durationSeconds = (Date.parse(orderRow.end_at) - Date.parse(orderRow.start_at)) / 1_000;
      const snapshotId = createExchangeId("OCS");
      const snapshotDigest = await sha256(JSON.stringify({
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
      const publicCheckoutTerms = {
        schemaVersion: 4, orderId: orderRow.id, productCode: listing.product_code,
        rateUnitCode: orderRow.rate_unit_code, pricingUnitCode: listing.policy_pricing_unit_code,
        priceBasisBaseUnits: listing.price_basis_base_units, rateUnits: orderRow.rate_units,
        durationSeconds, capacityBaseUnits: orderRow.capacity_base_units,
        unitPriceMicros: orderRow.unit_price_micros, grossAmountCents: orderRow.total_amount_cents,
        currency: orderRow.currency,
      };
      if (referral.resolvedCodeId !== null && referral.submittedCodeDigest !== null) {
        throw new Error("EXCHANGE_INVARIANT_CORRUPTION:REFERRAL_RESOLUTION_INVALID");
      }
      const referralCode = referral.resolvedCodeId
        ? await db.prepare("SELECT * FROM exchange_referral_codes WHERE id = ?")
          .bind(referral.resolvedCodeId).first<ReferralCodeRow>()
        : null;
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
      const referralDecisionId = createExchangeId("RD");
      const referralAttributionId = decisionOutcome === "APPLIED" ? createExchangeId("RAT") : null;
      if (Date.parse(orderRow.hold_expires_at) <= Date.now() + 30_000) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "距离上架截止或服务开始不足 30 秒，无法建立预留。");
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          db.prepare(`INSERT INTO exchange_orders (
          id, buyer_actor_id, supplier_actor_id, idempotency_key, payload_hash,
          listing_version_id, rate_unit_code, rate_units, parallel_units, start_at, end_at,
          capacity_base_units, capacity_gpu_seconds, unit_price_micros, unit_price_cents,
          total_amount_cents, currency, status, hold_expires_at,
          version, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT ? AS point
            UNION
            SELECT r0.start_at AS point FROM exchange_reservations r0
              WHERE r0.capacity_lot_id = ? AND r0.start_at < ? AND r0.end_at > ?
                AND (r0.state IN ('SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE')
                  OR (r0.state = 'HELD' AND r0.hold_expires_at > ?))
          ) points
          WHERE (SELECT COALESCE(SUM(r1.rate_units), 0) FROM exchange_reservations r1
            WHERE r1.capacity_lot_id = ? AND r1.start_at <= points.point AND r1.end_at > points.point
              AND (r1.state IN ('SUPPLIER_CONFIRMED', 'COMMITTED', 'IN_SERVICE')
                OR (r1.state = 'HELD' AND r1.hold_expires_at > ?))
          ) + ? > ?
        )`).bind(
          orderRow.id, orderRow.buyer_actor_id, orderRow.supplier_actor_id, context.idempotencyKey, context.payloadHash,
          orderRow.listing_version_id, orderRow.rate_unit_code, orderRow.rate_units, orderRow.parallel_units,
          orderRow.start_at, orderRow.end_at, orderRow.capacity_base_units, orderRow.capacity_gpu_seconds,
          orderRow.unit_price_micros, orderRow.unit_price_cents,
          orderRow.total_amount_cents, orderRow.currency, orderRow.status, orderRow.hold_expires_at,
          orderRow.version, orderRow.created_at, orderRow.updated_at,
          input.startAt, listing.lot_id, input.endAt, input.startAt, now,
          listing.lot_id, now, input.rateUnits, listing.lot_rate_units,
        ),
        db.prepare(`INSERT INTO exchange_reservations (
          id, order_id, capacity_lot_id, rate_unit_code, rate_units, parallel_units, start_at, end_at,
          capacity_base_units, capacity_gpu_seconds, state, hold_expires_at, version, created_at, updated_at
        ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`).bind(
          reservationRow.id, reservationRow.order_id, reservationRow.capacity_lot_id,
          reservationRow.rate_unit_code, reservationRow.rate_units, reservationRow.parallel_units,
          reservationRow.start_at, reservationRow.end_at,
          reservationRow.capacity_base_units, reservationRow.capacity_gpu_seconds, reservationRow.state,
          reservationRow.hold_expires_at, reservationRow.version, reservationRow.created_at, reservationRow.updated_at, orderRow.id,
        ),
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) SELECT ?, ?, ?, ?, 'AVAILABLE', 'HELD', ?, ?, ?, 'CHECKOUT_RESERVED', ?
          WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`).bind(
          transferId(), listing.lot_id, orderRow.id, `order:${orderRow.id}:hold`,
          orderRow.rate_unit_code, orderRow.capacity_base_units, orderRow.capacity_gpu_seconds,
          orderRow.created_at, orderRow.id,
        ),
          db.prepare(`INSERT INTO exchange_order_contract_snapshots (
            id, order_id, listing_version_id, product_version_id, capacity_policy_id,
            product_code, rate_unit_code, fulfillment_model, pricing_unit_code,
            rate_units, duration_seconds, capacity_base_units, unit_price_micros,
            price_basis_base_units, gross_amount_cents, currency, product_identity_json,
            sla_json, evidence_policy_version, snapshot_digest, created_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`).bind(
            snapshotId, orderRow.id, orderRow.listing_version_id, listing.product_version_id, listing.capacity_policy_id,
            listing.product_code, orderRow.rate_unit_code, listing.fulfillment_model, listing.policy_pricing_unit_code,
            orderRow.rate_units, durationSeconds, orderRow.capacity_base_units, orderRow.unit_price_micros,
            listing.price_basis_base_units, orderRow.total_amount_cents, orderRow.currency,
            listing.product_identity_json, listing.sla_json, listing.evidence_policy_version, snapshotDigest,
            orderRow.created_at, orderRow.id,
          ),
          db.prepare(`INSERT INTO exchange_order_lifecycle (order_id, phase, state_reason, version, updated_at)
            SELECT ?, 'AWAITING_SUPPLIER', 'CHECKOUT_RESERVED', 1, ?
            WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`).bind(
            orderRow.id, orderRow.created_at, orderRow.id,
          ),
          db.prepare(`INSERT INTO exchange_referral_decisions (
              id, order_id, outcome, resolved_code_id, submitted_code_digest, decided_at
            ) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`)
            .bind(
              referralDecisionId, orderRow.id, decisionOutcome, referral.resolvedCodeId,
              referral.submittedCodeDigest, orderRow.created_at, orderRow.id,
            ),
          db.prepare(`INSERT INTO exchange_referral_attributions (
              id, order_id, decision_id, referral_code_id, agent_actor_id,
              buyer_actor_id, supplier_actor_id, attributed_at
            ) SELECT ?, ?, ?, code.id, code.agent_actor_id, ?, ?, ?
            FROM exchange_referral_codes code
            WHERE ? = 'APPLIED' AND code.id = ?
              AND EXISTS (SELECT 1 FROM exchange_referral_decisions decision
                WHERE decision.id = ? AND decision.order_id = ? AND decision.outcome = 'APPLIED')`)
            .bind(
              referralAttributionId, orderRow.id, referralDecisionId,
              context.actorId, listing.supplier_actor_id, orderRow.created_at,
              decisionOutcome, referral.resolvedCodeId, referralDecisionId, orderRow.id,
            ),
          db.prepare(`INSERT INTO exchange_command_receipts (
            actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
          ) SELECT ?, ?, ?, 'CREATE_CHECKOUT', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_orders WHERE id = ?)`).bind(
            context.actorId, context.idempotencyKey, context.payloadHash, orderRow.id,
            JSON.stringify(publicCheckoutTerms), orderRow.created_at, orderRow.id,
          ),
          eventStatement(db, context.actorId, "ORDER", orderRow.id, "ORDER_CAPACITY_HELD", publicCheckoutTerms, orderRow.created_at),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND accounting_schema_version IN (2, 3, 4)
              AND rate_unit_code = ? AND rate_units = ? AND capacity_base_units = ?
              AND unit_price_micros = ? AND total_amount_cents = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_reservations WHERE order_id = ?
              AND rate_unit_code = ? AND rate_units = ? AND capacity_base_units = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE order_id = ?
              AND reason = 'CHECKOUT_RESERVED' AND rate_unit_code = ? AND capacity_base_units = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_order_contract_snapshots WHERE order_id = ?
              AND id = ? AND product_code = ? AND rate_unit_code = ? AND pricing_unit_code = ?
              AND rate_units = ? AND duration_seconds = ? AND capacity_base_units = ?
              AND unit_price_micros = ? AND price_basis_base_units = ? AND gross_amount_cents = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_order_lifecycle
              WHERE order_id = ? AND phase = 'AWAITING_SUPPLIER' AND state_reason = 'CHECKOUT_RESERVED') = 1
            AND (SELECT COUNT(*) FROM exchange_referral_decisions
              WHERE id = ? AND order_id = ? AND outcome = ?
                AND resolved_code_id IS ? AND submitted_code_digest IS ?) = 1
            AND (SELECT COUNT(*) FROM exchange_referral_attributions WHERE order_id = ?) = ?
            AND (? = 0 OR EXISTS (SELECT 1 FROM exchange_referral_attributions attribution
              WHERE attribution.id = ? AND attribution.order_id = ? AND attribution.decision_id = ?
                AND attribution.referral_code_id = ? AND attribution.agent_actor_id = ?
                AND attribution.buyer_actor_id = ? AND attribution.supplier_actor_id = ?))
            AND (SELECT COUNT(*) FROM exchange_command_receipts
              WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ? AND command_type = 'CREATE_CHECKOUT') = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events
              WHERE entity_id = ? AND event_type = 'ORDER_CAPACITY_HELD') = 1
            AND EXISTS (
              SELECT 1 FROM exchange_orders o
              JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
              JOIN exchange_capacity_lots lot ON lot.id = lv.capacity_lot_id
              JOIN exchange_resource_assets ra ON ra.id = lot.resource_asset_id
              JOIN exchange_product_versions pv ON pv.id = ra.product_version_id
              JOIN exchange_product_capacity_policies p
                ON p.product_version_id = pv.id AND p.feature_status = 'ENABLED'
              WHERE o.id = ? AND o.rate_unit_code = lv.rate_unit_code
                AND o.rate_unit_code = lot.rate_unit_code AND o.rate_unit_code = p.rate_unit_code
                AND lv.pricing_unit_code = p.pricing_unit_code
                AND o.unit_price_micros = lv.unit_price_micros
                AND o.rate_units BETWEEN lv.min_rate_units AND lv.max_rate_units
            )`,
          orderRow.id, orderRow.rate_unit_code, orderRow.rate_units, orderRow.capacity_base_units,
          orderRow.unit_price_micros, orderRow.total_amount_cents,
          orderRow.id, orderRow.rate_unit_code, orderRow.rate_units, orderRow.capacity_base_units,
          orderRow.id, orderRow.rate_unit_code, orderRow.capacity_base_units,
          orderRow.id, snapshotId, listing.product_code, orderRow.rate_unit_code, listing.policy_pricing_unit_code,
          orderRow.rate_units, durationSeconds, orderRow.capacity_base_units, orderRow.unit_price_micros,
          listing.price_basis_base_units, orderRow.total_amount_cents,
          orderRow.id,
          referralDecisionId, orderRow.id, decisionOutcome,
          referral.resolvedCodeId, referral.submittedCodeDigest,
          orderRow.id, decisionOutcome === "APPLIED" ? 1 : 0,
          decisionOutcome === "APPLIED" ? 1 : 0,
          referralAttributionId, orderRow.id, referralDecisionId, referral.resolvedCodeId,
          referralCode?.agent_actor_id ?? "", context.actorId, listing.supplier_actor_id,
          context.actorId, context.idempotencyKey, orderRow.id, orderRow.id, orderRow.id),
        ]);
      } catch (error) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_orders
          WHERE buyer_actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<OrderRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: (await readOrder(concurrent.id, "buyer")).record, replayed: true };
        }
        throw error;
      }
      if (changes(results[0]) !== 1 || changes(results[1]) !== 1 || changes(results[2]) !== 1) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_orders
          WHERE buyer_actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey).first<OrderRow>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash) throw new ExchangeIdempotencyConflictError();
          return { record: (await readOrder(concurrent.id, "buyer")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "所选时间窗的可用并行卡数不足。");
      }
      return { record: (await readOrder(orderRow.id, "buyer")).record, replayed: false };
    },

    async getOrder(actorId, orderId, role) {
      await ensureSchema();
      let result = await readOrder(orderId, role);
      if ((role === "buyer" && result.order.buyer_actor_id !== actorId)
        || (role === "supplier" && result.order.supplier_actor_id !== actorId)) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单不存在。");
      }
      if (await expireOrderDeliveryPackage(orderId, `system:delivery-expiry:${actorId}`)) {
        result = await readOrder(orderId, role);
      }
      return result.record;
    },

    async listOrders(actorId, role) {
      await ensureSchema();
      const result = await db.prepare(`SELECT * FROM exchange_orders WHERE ${role === "buyer" ? "buyer_actor_id" : "supplier_actor_id"} = ?
        ORDER BY created_at DESC`).bind(actorId).all<OrderRow>();
      const records = [];
      for (const order of result.results ?? []) {
        await expireOrderDeliveryPackage(order.id, `system:delivery-expiry:${actorId}`);
        records.push((await readOrder(order.id, role)).record);
      }
      return records;
    },

    async confirmOrder(orderId, context, input) {
      await ensureSchema();
      const receipt = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json FROM exchange_command_receipts
        WHERE actor_id = ? AND idempotency_key = ?`).bind(context.actorId, context.idempotencyKey)
        .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "SUPPLIER_CONFIRMATION" || receipt.entity_id !== orderId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
      }
      const current = await readOrder(orderId);
      if (current.order.supplier_actor_id !== context.actorId) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以确认容量。");
      if (current.order.version !== input.expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
      const now = new Date().toISOString();
      if (current.order.status !== "PENDING_SUPPLIER_CONFIRMATION" || current.reservation.state !== "HELD") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能执行供应商确认。");
      if (current.order.hold_expires_at <= now) {
        await expireD1Reservations(db, [current.reservation], now);
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "容量预留已过期。");
      }
      const nextHold = input.action === "CONFIRM"
        ? new Date(Math.min(Date.now() + 30 * 60 * 1_000, Date.parse(current.order.start_at))).toISOString()
        : current.order.hold_expires_at;
      const updatedOrder: OrderRow = {
        ...current.order,
        status: input.action === "CONFIRM" ? "AWAITING_PAYMENT" : "CANCELLED",
        hold_expires_at: nextHold,
        version: current.order.version + 1,
        updated_at: now,
      };
      const updatedReservation: ReservationRow = {
        ...current.reservation,
        state: input.action === "CONFIRM" ? "SUPPLIER_CONFIRMED" : "RELEASED",
        hold_expires_at: nextHold,
        version: current.reservation.version + 1,
        updated_at: now,
      };
      const lifecycleRow: OrderLifecycleRow = {
        order_id: orderId,
        phase: input.action === "CONFIRM" ? "AWAITING_PAYMENT" : "EXCEPTION",
        state_reason: input.action === "CONFIRM" ? "SUPPLIER_CONFIRMED" : "SUPPLIER_REJECTED",
        version: 1,
        updated_at: now,
      };
      const paymentIntentRow: PaymentIntentRow | null = input.action === "CONFIRM" ? {
        id: createExchangeId("PI"),
        order_id: orderId,
        provider: "SIMULATED",
        environment: "TEST",
        merchant_account_ref: "KAI-CLOUD-TEST-CNY",
        amount_cents: current.order.total_amount_cents,
        currency: "CNY",
        status: "PENDING",
        provider_payment_id: null,
        expires_at: nextHold,
        version: 1,
        created_at: now,
        updated_at: now,
      } : null;
      const updatedRecord = mapOrder(updatedOrder, updatedReservation, "supplier", {
        lifecycle: lifecycleRow,
        payment: paymentIntentRow,
        referralDecision: current.referralDecision,
        referralAttribution: current.referralAttribution,
      });
      const gateEventId = eventId();
      const statements = [
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'ORDER', o.id, ?, ?, ?
          FROM exchange_orders o JOIN exchange_reservations r ON r.order_id = o.id
          WHERE o.id = ? AND o.supplier_actor_id = ? AND o.version = ?
            AND o.status = 'PENDING_SUPPLIER_CONFIRMATION'
            AND r.state = 'HELD' AND r.hold_expires_at > ?
            AND EXISTS (SELECT 1 FROM exchange_order_lifecycle ol
              WHERE ol.order_id = o.id AND ol.phase = 'AWAITING_SUPPLIER' AND ol.state_reason = 'CHECKOUT_RESERVED')
            ${input.action === "CONFIRM" ? "AND NOT EXISTS (SELECT 1 FROM exchange_payment_intents pi WHERE pi.order_id = o.id)" : ""}`).bind(
          gateEventId, context.actorId, `SUPPLIER_${input.action}`, JSON.stringify({ decision: input.action }), now,
          orderId, context.actorId, input.expectedVersion, now,
        ),
        db.prepare(`UPDATE exchange_orders SET status = ?, hold_expires_at = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND status = 'PENDING_SUPPLIER_CONFIRMATION'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          updatedOrder.status, nextHold, now, orderId, input.expectedVersion, gateEventId,
        ),
        db.prepare(`UPDATE exchange_reservations SET state = ?, hold_expires_at = ?, version = version + 1, updated_at = ?
          WHERE order_id = ? AND state = 'HELD'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          updatedReservation.state, nextHold, now, orderId, gateEventId,
        ),
      ];
      if (paymentIntentRow) {
        statements.push(
          db.prepare(`INSERT INTO exchange_payment_intents (
            id, order_id, provider, environment, merchant_account_ref, amount_cents, currency,
            status, provider_payment_id, expires_at, version, created_at, updated_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, ?
            WHERE EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
            paymentIntentRow.id, orderId, paymentIntentRow.provider, paymentIntentRow.environment,
            paymentIntentRow.merchant_account_ref, paymentIntentRow.amount_cents, paymentIntentRow.currency,
            paymentIntentRow.status, paymentIntentRow.expires_at, now, now, gateEventId,
          ),
        );
      } else {
        statements.push(db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) SELECT ?, ?, ?, ?, 'HELD', 'AVAILABLE', ?, ?, ?, 'SUPPLIER_REJECTED', ?
          WHERE EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          transferId(), current.reservation.capacity_lot_id, orderId,
          `order:${orderId}:supplier-rejected`, current.order.rate_unit_code,
          current.order.capacity_base_units, current.order.capacity_gpu_seconds, now, gateEventId,
        ));
      }
      statements.push(
        db.prepare(`UPDATE exchange_order_lifecycle
          SET phase = ?, state_reason = ?, version = version + 1, updated_at = ?
          WHERE order_id = ? AND phase = 'AWAITING_SUPPLIER' AND state_reason = 'CHECKOUT_RESERVED'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          lifecycleRow.phase, lifecycleRow.state_reason, now, orderId, gateEventId,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'SUPPLIER_CONFIRMATION', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(updatedRecord), now, gateEventId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND status = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_reservations WHERE order_id = ? AND state = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_order_lifecycle WHERE order_id = ? AND phase = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ? AND command_type = 'SUPPLIER_CONFIRMATION') = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ?) = 1
          ${input.action === "CONFIRM"
            ? "AND (SELECT COUNT(*) FROM exchange_payment_intents WHERE order_id = ? AND status = 'PENDING') = 1"
            : "AND (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE order_id = ? AND reason = 'SUPPLIER_REJECTED') = 1"}`,
        orderId, updatedOrder.status, updatedOrder.version, orderId, updatedReservation.state,
        orderId, lifecycleRow.phase, context.actorId, context.idempotencyKey, orderId, gateEventId, orderId),
      );
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrentReceipt = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
          FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey)
          .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
        if (concurrentReceipt) {
          if (concurrentReceipt.payload_hash !== context.payloadHash || concurrentReceipt.command_type !== "SUPPLIER_CONFIRMATION" || concurrentReceipt.entity_id !== orderId) {
            throw new ExchangeIdempotencyConflictError();
          }
          return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
        }
        const refreshed = await db.prepare("SELECT status, version FROM exchange_orders WHERE id = ?")
          .bind(orderId).first<{ status: string; version: number }>();
        if (refreshed?.status !== "PENDING_SUPPLIER_CONFIRMATION" || refreshed.version !== input.expectedVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单状态已变化，请刷新后重试。");
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrentReceipt = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
          FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey)
          .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
        if (concurrentReceipt) {
          if (concurrentReceipt.payload_hash !== context.payloadHash || concurrentReceipt.command_type !== "SUPPLIER_CONFIRMATION" || concurrentReceipt.entity_id !== orderId) {
            throw new ExchangeIdempotencyConflictError();
          }
          return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单状态已变化，请刷新后重试。");
      }
      return { record: updatedRecord, replayed: false };
    },

    async applyPaymentEvent(context, input) {
      await ensureSchema();
      const replayExistingPaymentEvent = async (paymentEvent: PaymentEventRow) => {
        if (paymentEvent.payload_hash !== context.payloadHash || paymentEvent.raw_payload_digest !== input.rawPayloadDigest) {
          throw new ExchangeIdempotencyConflictError();
        }
        if (paymentEvent.outcome === "REVIEW_REQUIRED") {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_REVIEW_REQUIRED", 422, "支付事件与平台支付订单不匹配，已进入人工核对。");
        }
        if (paymentEvent.outcome === "LATE_CAPTURE_REVIEW") {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用，已进入退款与人工核对。");
        }
        if (paymentEvent.outcome === "IGNORED_DUPLICATE_TRANSACTION") {
          const applied = await db.prepare(`SELECT * FROM exchange_payment_events
            WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
            .bind(paymentEvent.provider, paymentEvent.environment, paymentEvent.provider_transaction_id).first<PaymentEventRow>();
          if (!applied) throw new Error("CAPTURED_PAYMENT_EVENT_MISSING");
          const appliedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
            .bind(applied.payment_intent_id).first<PaymentIntentRow>();
          if (!appliedPayment) throw new Error("PAYMENT_INTENT_MISSING");
          return { record: (await readOrder(appliedPayment.order_id, "buyer")).record, replayed: true } as const;
        }
        const appliedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .bind(paymentEvent.payment_intent_id).first<PaymentIntentRow>();
        if (!appliedPayment) throw new Error("PAYMENT_INTENT_MISSING");
        return { record: (await readOrder(appliedPayment.order_id, "buyer")).record, replayed: true } as const;
      };
      const insertPaymentOutcomeOrReplay = async (
        outcome: PaymentEventRow["outcome"],
        receivedAt: string,
      ) => {
        try {
          await insertD1PaymentOutcome(db, context, input, outcome, receivedAt);
          return null;
        } catch (error) {
          const concurrent = await db.prepare(`SELECT * FROM exchange_payment_events
            WHERE provider = ? AND environment = ? AND provider_event_id = ?`)
            .bind(input.provider, input.environment, input.providerEventId).first<PaymentEventRow>();
          if (!concurrent) throw error;
          return replayExistingPaymentEvent(concurrent);
        }
      };
      const existing = await db.prepare(`SELECT * FROM exchange_payment_events
        WHERE provider = ? AND environment = ? AND provider_event_id = ?`)
        .bind(input.provider, input.environment, input.providerEventId).first<PaymentEventRow>();
      if (existing) {
        return replayExistingPaymentEvent(existing);
      }

      const payment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
        .bind(input.providerOrderId).first<PaymentIntentRow>();
      if (!payment) throw new ExchangeDomainError("EXCHANGE_PAYMENT_ORDER_NOT_FOUND", 404, "支付订单不存在。");
      const receivedAt = new Date().toISOString();
      const current = await readOrder(payment.order_id);
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
        const replay = await insertPaymentOutcomeOrReplay("REVIEW_REQUIRED", receivedAt);
        if (replay) return replay;
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_REVIEW_REQUIRED", 422, "支付事件与平台支付订单不匹配，已进入人工核对。");
      }

      const duplicateTransaction = await db.prepare(`SELECT * FROM exchange_payment_events
        WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
        .bind(input.provider, input.environment, input.providerTransactionId).first<PaymentEventRow>();
      if (duplicateTransaction) {
        const replay = await insertPaymentOutcomeOrReplay("IGNORED_DUPLICATE_TRANSACTION", receivedAt);
        if (replay) return replay;
        const capturedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .bind(duplicateTransaction.payment_intent_id).first<PaymentIntentRow>();
        if (!capturedPayment) throw new Error("PAYMENT_INTENT_MISSING");
        return { record: (await readOrder(capturedPayment.order_id, "buyer")).record, replayed: true };
      }

      if (payment.status === "CAPTURED") {
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_ALREADY_CAPTURED", 409, "该支付订单已经确认，不能创建第二笔测试支付。");
      }

      if (current.order.status !== "AWAITING_PAYMENT" || current.reservation.state !== "SUPPLIER_CONFIRMED"
        || payment.status !== "PENDING" || current.reservation.hold_expires_at <= receivedAt || payment.expires_at <= receivedAt) {
        if (current.reservation.state === "SUPPLIER_CONFIRMED" && current.reservation.hold_expires_at <= receivedAt) {
          await expireD1Reservations(db, [current.reservation], receivedAt);
        }
        const replay = await insertPaymentOutcomeOrReplay("LATE_CAPTURE_REVIEW", receivedAt);
        if (replay) return replay;
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用，已进入退款与人工核对。");
      }

      const deliverySource = await db.prepare(`SELECT lv.delivery_form, cl.resource_asset_id, ra.product_version_id
        FROM exchange_orders o
        JOIN exchange_listing_versions lv ON lv.id = o.listing_version_id
        JOIN exchange_capacity_lots cl ON cl.id = lv.capacity_lot_id
        JOIN exchange_resource_assets ra ON ra.id = cl.resource_asset_id
        WHERE o.id = ?`).bind(current.order.id)
        .first<{ delivery_form: string; resource_asset_id: string; product_version_id: string }>();
      if (!deliverySource) throw new Error("DELIVERY_SNAPSHOT_MISSING");
      const paymentEventId = createExchangeId("PE");
      const lockTransferId = transferId();
      const deliveryTaskId = createExchangeId("DT");
      const meteringSessionId = createExchangeId("MS");
      const now = new Date().toISOString();
      const provisioningDueAt = new Date(Math.min(Date.parse(current.order.start_at), Date.now() + 4 * 60 * 60 * 1_000)).toISOString();
      const gate = db.prepare(`INSERT INTO exchange_capacity_transfers (
        id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
        rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
      ) SELECT ?, r.capacity_lot_id, o.id, ?, 'HELD', 'LOCKED',
          o.rate_unit_code, o.capacity_base_units, o.capacity_gpu_seconds, 'PAYMENT_CAPTURED', ?
        FROM exchange_payment_intents pi
        JOIN exchange_orders o ON o.id = pi.order_id
        JOIN exchange_reservations r ON r.order_id = o.id
        WHERE pi.id = ? AND pi.provider = ? AND pi.environment = ? AND pi.merchant_account_ref = ?
          AND pi.amount_cents = ? AND pi.currency = ? AND pi.status = 'PENDING' AND pi.expires_at > ?
          AND o.status = 'AWAITING_PAYMENT' AND r.state = 'SUPPLIER_CONFIRMED' AND r.hold_expires_at > ?`)
        .bind(lockTransferId, `order:${current.order.id}:payment-locked`, now, payment.id, input.provider,
          input.environment, input.merchantAccountRef, input.amountCents, input.currency, now, now);
      const guard = (sql: string) => `${sql} WHERE EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`;
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch([
          gate,
          db.prepare(guard(`INSERT INTO exchange_payment_events (
            id, provider, environment, provider_event_id, provider_transaction_id, payment_intent_id,
            merchant_account_ref, event_type, amount_cents, currency, funds_moved,
            verification_method, verified_at, raw_payload_digest, payload_hash, outcome, occurred_at, received_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'APPLIED', ?, ?`)).bind(
            paymentEventId, input.provider, input.environment, input.providerEventId, input.providerTransactionId,
            input.providerOrderId, input.merchantAccountRef, input.eventType, input.amountCents, input.currency,
            Number(input.fundsMoved), input.verificationMethod, input.verifiedAt, input.rawPayloadDigest,
            context.payloadHash, input.occurredAt, now, lockTransferId,
          ),
          db.prepare(`UPDATE exchange_payment_intents SET status = 'CAPTURED', provider_payment_id = ?,
            version = version + 1, updated_at = ? WHERE id = ? AND status = 'PENDING'
              AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`).bind(
            input.providerTransactionId, now, payment.id, lockTransferId,
          ),
          db.prepare(`UPDATE exchange_reservations SET state = 'COMMITTED', version = version + 1, updated_at = ?
            WHERE id = ? AND state = 'SUPPLIER_CONFIRMED'
              AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`).bind(now, current.reservation.id, lockTransferId),
          db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
            WHERE id = ? AND status = 'AWAITING_PAYMENT'
              AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`).bind(now, current.order.id, lockTransferId),
          db.prepare(`UPDATE exchange_order_lifecycle SET phase = 'FULFILLING', state_reason = 'TEST_PAYMENT_CAPTURED',
            version = version + 1, updated_at = ? WHERE order_id = ?
              AND EXISTS (SELECT 1 FROM exchange_capacity_transfers WHERE id = ?)`).bind(now, current.order.id, lockTransferId),
          db.prepare(guard(`INSERT INTO exchange_delivery_tasks (
            id, order_id, payment_event_id, reservation_id, capacity_lot_id, listing_version_id,
            resource_asset_id, product_version_id, lock_transfer_id, parallel_units, start_at, end_at,
            delivery_form, method, status, attempt, evidence_policy_version, provisioning_due_at,
            version, created_at, updated_at
          ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'PENDING', 0,
            ?, ?, 1, ?, ?`)).bind(
            deliveryTaskId, current.order.id, paymentEventId, current.reservation.id, current.reservation.capacity_lot_id,
            current.order.listing_version_id, deliverySource.resource_asset_id, deliverySource.product_version_id, lockTransferId,
            current.order.rate_units, current.order.start_at, current.order.end_at, deliverySource.delivery_form,
            current.snapshot.evidencePolicyVersion, provisioningDueAt, now, now, lockTransferId,
          ),
          db.prepare(guard(`INSERT INTO exchange_metering_sessions (
            id, order_id, payment_event_id, delivery_task_id, reservation_id, environment, status,
            scheduled_start_at, scheduled_end_at, actual_start_at, finalized_at,
            rate_unit_code, reserved_rate_units,
            scheduled_capacity_base_units, available_capacity_base_units,
            unavailable_capacity_base_units, unproven_capacity_base_units,
            scheduled_gpu_seconds, available_gpu_seconds, unavailable_gpu_seconds, unproven_gpu_seconds,
            availability_ppm, version, created_at, updated_at
          ) SELECT ?, ?, ?, ?, ?, 'TEST', 'SCHEDULED', ?, ?, NULL, NULL,
            ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, NULL, 1, ?, ?`)).bind(
            meteringSessionId, current.order.id, paymentEventId, deliveryTaskId, current.reservation.id,
            current.order.start_at, current.order.end_at, current.order.rate_unit_code, current.order.rate_units,
            current.order.capacity_base_units, current.order.capacity_base_units,
            current.order.rate_unit_code === "GPU" ? current.order.capacity_base_units : null,
            current.order.rate_unit_code === "GPU" ? 0 : null,
            current.order.rate_unit_code === "GPU" ? 0 : null,
            current.order.rate_unit_code === "GPU" ? current.order.capacity_base_units : null,
            now, now, lockTransferId,
          ),
          db.prepare(guard(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'ORDER', ?, 'PAYMENT_CAPTURED', ?, ?`)).bind(
            eventId(), context.actorId, current.order.id, JSON.stringify({ paymentEventId, fundsMoved: false }), now, lockTransferId,
          ),
          db.prepare(guard(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'ORDER', ?, 'CAPACITY_LOCKED', ?, ?`)).bind(
            eventId(), context.actorId, current.order.id, JSON.stringify({ lockTransferId }), now, lockTransferId,
          ),
          db.prepare(guard(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'ORDER', ?, 'DELIVERY_TASK_CREATED', ?, ?`)).bind(
            eventId(), context.actorId, current.order.id, JSON.stringify({ deliveryTaskId }), now, lockTransferId,
          ),
          db.prepare(guard(`INSERT INTO exchange_domain_events (
            id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
          ) SELECT ?, ?, 'ORDER', ?, 'METERING_SCHEDULED', ?, ?`)).bind(
            eventId(), context.actorId, current.order.id,
            JSON.stringify({ meteringSessionId, environment: "TEST", fundsMoved: false }), now, lockTransferId,
          ),
          d1InvariantGuard(db, `
            (SELECT COUNT(*) FROM exchange_capacity_transfers WHERE id = ? AND order_id = ?
              AND rate_unit_code = ? AND capacity_base_units = ? AND reason = 'PAYMENT_CAPTURED') = 1
            AND (SELECT COUNT(*) FROM exchange_payment_events WHERE id = ? AND outcome = 'APPLIED') = 1
            AND (SELECT COUNT(*) FROM exchange_payment_intents WHERE id = ? AND status = 'CAPTURED') = 1
            AND (SELECT COUNT(*) FROM exchange_reservations WHERE order_id = ? AND state = 'COMMITTED') = 1
            AND (SELECT COUNT(*) FROM exchange_order_lifecycle WHERE order_id = ? AND phase = 'FULFILLING') = 1
            AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE id = ? AND order_id = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_metering_sessions WHERE id = ? AND order_id = ?
              AND rate_unit_code = ? AND reserved_rate_units = ? AND scheduled_capacity_base_units = ?) = 1
            AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ?
              AND event_type IN ('PAYMENT_CAPTURED','CAPACITY_LOCKED','DELIVERY_TASK_CREATED','METERING_SCHEDULED')) = 4`,
          lockTransferId, current.order.id, current.order.rate_unit_code, current.order.capacity_base_units,
          paymentEventId, payment.id, current.order.id, current.order.id,
          deliveryTaskId, current.order.id, meteringSessionId, current.order.id,
          current.order.rate_unit_code, current.order.rate_units, current.order.capacity_base_units, current.order.id),
        ]);
      } catch (error) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_payment_events
          WHERE provider = ? AND environment = ? AND provider_event_id = ?`)
          .bind(input.provider, input.environment, input.providerEventId).first<PaymentEventRow>();
        if (concurrent) {
          return replayExistingPaymentEvent(concurrent);
        }
        const concurrentTransaction = await db.prepare(`SELECT * FROM exchange_payment_events
          WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
          .bind(input.provider, input.environment, input.providerTransactionId).first<PaymentEventRow>();
        if (concurrentTransaction) {
          const replay = await insertPaymentOutcomeOrReplay("IGNORED_DUPLICATE_TRANSACTION", new Date().toISOString());
          if (replay) return replay;
          const capturedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
            .bind(concurrentTransaction.payment_intent_id).first<PaymentIntentRow>();
          if (!capturedPayment) throw new Error("PAYMENT_INTENT_MISSING");
          return { record: (await readOrder(capturedPayment.order_id, "buyer")).record, replayed: true };
        }
        const refreshedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
          .bind(payment.id).first<PaymentIntentRow>();
        if (refreshedPayment?.status === "CAPTURED") {
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_ALREADY_CAPTURED", 409, "该支付订单已经确认，不能创建第二笔测试支付。");
        }
        const refreshedState = await db.prepare(`SELECT o.status AS order_status, r.state AS reservation_state
          FROM exchange_orders o JOIN exchange_reservations r ON r.order_id = o.id WHERE o.id = ?`)
          .bind(current.order.id).first<{ order_status: string; reservation_state: string }>();
        if (refreshedState?.order_status !== "AWAITING_PAYMENT"
          || refreshedState.reservation_state !== "SUPPLIER_CONFIRMED") {
          const replay = await insertPaymentOutcomeOrReplay("LATE_CAPTURE_REVIEW", new Date().toISOString());
          if (replay) return replay;
          throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件到达时容量预留已不可用，已进入退款与人工核对。");
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await db.prepare(`SELECT * FROM exchange_payment_events
          WHERE provider = ? AND environment = ? AND provider_event_id = ?`)
          .bind(input.provider, input.environment, input.providerEventId).first<PaymentEventRow>();
        if (concurrent) {
          return replayExistingPaymentEvent(concurrent);
        }
        const concurrentTransaction = await db.prepare(`SELECT * FROM exchange_payment_events
          WHERE provider = ? AND environment = ? AND provider_transaction_id = ? AND outcome = 'APPLIED'`)
          .bind(input.provider, input.environment, input.providerTransactionId).first<PaymentEventRow>();
        if (concurrentTransaction) {
          const replay = await insertPaymentOutcomeOrReplay("IGNORED_DUPLICATE_TRANSACTION", new Date().toISOString());
          if (replay) return replay;
          const capturedPayment = await db.prepare("SELECT * FROM exchange_payment_intents WHERE id = ?")
            .bind(concurrentTransaction.payment_intent_id).first<PaymentIntentRow>();
          if (!capturedPayment) throw new Error("PAYMENT_INTENT_MISSING");
          return { record: (await readOrder(capturedPayment.order_id, "buyer")).record, replayed: true };
        }
        const refreshed = await readOrder(current.order.id);
        if (refreshed.reservation.state === "SUPPLIER_CONFIRMED" && refreshed.reservation.hold_expires_at <= new Date().toISOString()) {
          await expireD1Reservations(db, [refreshed.reservation], new Date().toISOString());
        }
        const replay = await insertPaymentOutcomeOrReplay("LATE_CAPTURE_REVIEW", new Date().toISOString());
        if (replay) return replay;
        throw new ExchangeDomainError("EXCHANGE_PAYMENT_LATE_CAPTURE", 410, "支付事件未能锁定容量，已进入人工核对。");
      }
      return { record: (await readOrder(current.order.id, "buyer")).record, replayed: false };
    },

    async startProvisioning(orderId, context, input) {
      await ensureSchema();
      const receipt = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
        FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
        .bind(context.actorId, context.idempotencyKey)
        .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
      if (receipt) {
        if (receipt.payload_hash !== context.payloadHash || receipt.command_type !== "START_PROVISIONING" || receipt.entity_id !== orderId) {
          throw new ExchangeIdempotencyConflictError();
        }
        return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
      }
      const current = await readOrder(orderId, "supplier");
      if (current.order.supplier_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的供应商可以开始开通。");
      }
      if (current.order.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单版本已变化，请刷新后重试。");
      }
      if (current.record.status !== "FULFILLING" || current.payment?.status !== "CAPTURED"
        || current.reservation.state !== "COMMITTED" || current.delivery?.status !== "PENDING") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能开始开通。");
      }
      const now = new Date().toISOString();
      const gateEventId = eventId();
      const updatedDelivery: DeliveryTaskRow = {
        ...current.delivery,
        status: "PROVISIONING",
        attempt: current.delivery.attempt + 1,
        version: current.delivery.version + 1,
        updated_at: now,
      };
      const updatedOrder: OrderRow = { ...current.order, version: current.order.version + 1, updated_at: now };
      const updatedRecord = mapOrder(updatedOrder, current.reservation, "supplier", {
        lifecycle: current.lifecycle,
        payment: current.payment,
        delivery: updatedDelivery,
        referralDecision: current.referralDecision,
        referralAttribution: current.referralAttribution,
      });
      const statements = [
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'ORDER', o.id, 'PROVISIONING_STARTED', ?, ?
          FROM exchange_orders o
          JOIN exchange_reservations r ON r.order_id = o.id
          JOIN exchange_payment_intents pi ON pi.order_id = o.id
          JOIN exchange_delivery_tasks dt ON dt.order_id = o.id
          JOIN exchange_order_lifecycle ol ON ol.order_id = o.id
          WHERE o.id = ? AND o.supplier_actor_id = ? AND o.version = ?
            AND r.state = 'COMMITTED' AND pi.status = 'CAPTURED'
            AND dt.status = 'PENDING' AND ol.phase = 'FULFILLING'`).bind(
          gateEventId, context.actorId, JSON.stringify({ deliveryTaskId: current.delivery.id }), now,
          orderId, context.actorId, input.expectedVersion,
        ),
        db.prepare(`UPDATE exchange_delivery_tasks SET status = 'PROVISIONING', attempt = attempt + 1,
          version = version + 1, updated_at = ? WHERE order_id = ? AND status = 'PENDING'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, orderId, gateEventId),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
          WHERE id = ? AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, orderId, input.expectedVersion, gateEventId),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'START_PROVISIONING', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId, JSON.stringify(updatedRecord), now, gateEventId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ? AND entity_id = ?
            AND event_type = 'PROVISIONING_STARTED') = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE id = ?
            AND status = 'PROVISIONING' AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'START_PROVISIONING') = 1`,
        gateEventId, orderId, current.delivery.id, current.delivery.version + 1,
        orderId, current.order.version + 1, context.actorId, context.idempotencyKey, orderId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
          FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey)
          .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash || concurrent.command_type !== "START_PROVISIONING" || concurrent.entity_id !== orderId) {
            throw new ExchangeIdempotencyConflictError();
          }
          return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await db.prepare(`SELECT payload_hash, command_type, entity_id, response_json
          FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?`)
          .bind(context.actorId, context.idempotencyKey)
          .first<{ payload_hash: string; command_type: string; entity_id: string; response_json: string }>();
        if (concurrent) {
          if (concurrent.payload_hash !== context.payloadHash || concurrent.command_type !== "START_PROVISIONING" || concurrent.entity_id !== orderId) {
            throw new ExchangeIdempotencyConflictError();
          }
          return { record: (await readOrder(orderId, "supplier")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "订单状态已变化，请刷新后重试。");
      }
      return { record: (await readOrder(orderId, "supplier")).record, replayed: false };
    },

    async listOpsDeliveryPackages() {
      await ensureSchema();
      const stale = await db.prepare(`SELECT * FROM exchange_delivery_packages
        WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') AND credential_expires_at <= ?`)
        .bind(new Date().toISOString()).all<DeliveryPackageRow>();
      for (const row of stale.results ?? []) await expireD1DeliveryPackage(db, row, "system:delivery-expiry:ops");
      const result = await db.prepare(`SELECT * FROM exchange_delivery_packages
        ORDER BY created_at DESC, revision DESC`).all<DeliveryPackageRow>();
      return Promise.all((result.results ?? []).map((row) => projectDeliveryPackage(row, "ops")));
    },

    async submitDeliveryPackage(deliveryTaskId, context, input) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "SUBMIT_DELIVERY_PACKAGE", entityId: deliveryTaskId });
        return { record: await projectLatestDeliveryPackageAfterSnapshot(deliveryTaskId, "supplier"), replayed: true };
      }
      const preflight = await db.prepare(`SELECT dt.*, o.supplier_actor_id, o.version AS order_version,
          o.rate_unit_code, ra.region
        FROM exchange_delivery_tasks dt
        JOIN exchange_orders o ON o.id = dt.order_id
        JOIN exchange_resource_assets ra ON ra.id = dt.resource_asset_id
        WHERE dt.id = ?`).bind(deliveryTaskId)
        .first<DeliveryTaskRow & {
          supplier_actor_id: string; order_version: number; rate_unit_code: OrderRow["rate_unit_code"]; region: string;
        }>();
      if (!preflight) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付任务不存在。");
      await readOrder(preflight.order_id, "supplier");
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
      const revisionResult = await db.prepare(`SELECT COALESCE(MAX(revision), 0) + 1 AS revision
        FROM exchange_delivery_packages WHERE delivery_task_id = ?`).bind(deliveryTaskId).first<{ revision: number }>();
      const revision = revisionResult?.revision ?? 1;
      const now = new Date().toISOString();
      const row: DeliveryPackageRow = {
        id: createExchangeId("DP"),
        delivery_task_id: deliveryTaskId,
        order_id: preflight.order_id,
        supplier_actor_id: context.actorId,
        revision,
        environment: "TEST",
        status: "SUBMITTED",
        public_profile_json: JSON.stringify({
          ...input.publicProfile,
          region: preflight.region,
          deliveryForm: preflight.delivery_form,
          credentialKind: "ONE_TIME_TEST_CODE",
        }),
        submission_evidence_digest: input.evidenceDigest,
        credential_expires_at: input.publicProfile.expiresAt,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      const record = mapDeliveryPackage(row, "supplier");
      const statements = [
        db.prepare(`INSERT INTO exchange_delivery_packages (
          id, delivery_task_id, order_id, supplier_actor_id, revision, environment, status,
          public_profile_json, submission_evidence_digest, credential_expires_at, version, created_at, updated_at
        ) SELECT ?, dt.id, dt.order_id, o.supplier_actor_id, ?, 'TEST', 'SUBMITTED', ?, ?, ?, 1, ?, ?
          FROM exchange_delivery_tasks dt JOIN exchange_orders o ON o.id = dt.order_id
          WHERE dt.id = ? AND dt.status = 'PROVISIONING' AND dt.version = ? AND o.supplier_actor_id = ?
            AND NOT EXISTS (SELECT 1 FROM exchange_delivery_packages active
              WHERE active.delivery_task_id = dt.id AND active.status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED'))
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts cr
              WHERE cr.actor_id = ? AND cr.idempotency_key = ?)`).bind(
          row.id, revision, row.public_profile_json, row.submission_evidence_digest, row.credential_expires_at,
          now, now, deliveryTaskId, input.expectedVersion, context.actorId, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`UPDATE exchange_delivery_tasks SET status = 'VERIFYING', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'PROVISIONING' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_delivery_packages WHERE id = ?)`).bind(
          now, deliveryTaskId, input.expectedVersion, row.id,
        ),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_delivery_packages WHERE id = ?)`).bind(now, row.order_id, row.id),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'DELIVERY_PACKAGE', ?, 'DELIVERY_PACKAGE_SUBMITTED', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_delivery_packages WHERE id = ?)`).bind(
          eventId(), context.actorId, row.id, JSON.stringify({ deliveryTaskId, revision, environment: "TEST", evidenceDigest: row.submission_evidence_digest }), now, row.id,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'SUBMIT_DELIVERY_PACKAGE', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_delivery_packages WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, deliveryTaskId, JSON.stringify(record), now, row.id,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_delivery_packages WHERE id = ? AND delivery_task_id = ?
            AND order_id = ? AND status = 'SUBMITTED' AND version = 1) = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE id = ?
            AND status = 'VERIFYING' AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ?
            AND event_type = 'DELIVERY_PACKAGE_SUBMITTED') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'SUBMIT_DELIVERY_PACKAGE') = 1`,
        row.id, deliveryTaskId, row.order_id, deliveryTaskId, preflight.version + 1,
        row.order_id, preflight.order_version + 1, row.id,
        context.actorId, context.idempotencyKey, deliveryTaskId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "SUBMIT_DELIVERY_PACKAGE", entityId: deliveryTaskId });
          return { record: await projectLatestDeliveryPackageAfterSnapshot(deliveryTaskId, "supplier"), replayed: true };
        }
        const active = await db.prepare(`SELECT id FROM exchange_delivery_packages
          WHERE delivery_task_id = ? AND status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') LIMIT 1`)
          .bind(deliveryTaskId).first<{ id: string }>();
        if (active) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该交付任务已有生效中的交付包。");
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "SUBMIT_DELIVERY_PACKAGE", entityId: deliveryTaskId });
          return { record: await projectLatestDeliveryPackageAfterSnapshot(deliveryTaskId, "supplier"), replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付任务状态已变化，请刷新后重试。");
      }
      return { record: await projectLatestDeliveryPackageAfterSnapshot(deliveryTaskId, "supplier"), replayed: false };
    },

    async reviewDeliveryPackage(packageId, context, input) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "REVIEW_DELIVERY_PACKAGE", entityId: packageId });
        return { record: await projectDeliveryPackageAfterSnapshot(packageId, "ops"), replayed: true };
      }
      const current = await db.prepare(`SELECT dp.*, dt.status AS task_status, dt.version AS task_version
        FROM exchange_delivery_packages dp JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
        WHERE dp.id = ?`).bind(packageId).first<DeliveryPackageRow & { task_status: string; task_version: number }>();
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      const orderState = await readOrder(current.order_id, "ops");
      if (current.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
      }
      if (current.credential_expires_at <= new Date().toISOString()) {
        await expireD1DeliveryPackage(db, current, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请供应商重新提交。");
      }
      if (current.status !== "SUBMITTED" || current.task_status !== "VERIFYING") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "交付包当前不能核验。");
      }
      const now = new Date().toISOString();
      const review: DeliveryReviewRow = {
        id: createExchangeId("DR"), package_id: packageId, delivery_task_id: current.delivery_task_id,
        reviewer_actor_id: context.actorId, decision: input.decision, verification_method: input.verificationMethod,
        reason: input.reason, evidence_digest: input.evidenceDigest, created_at: now,
      };
      const status = input.decision === "PASS" ? "VERIFIED" : "REJECTED";
      const updatedRow: DeliveryPackageRow = { ...current, status, version: current.version + 1, updated_at: now };
      const record = mapDeliveryPackage(updatedRow, "ops", { review });
      const statements = [
        db.prepare(`INSERT INTO exchange_delivery_reviews (
          id, package_id, delivery_task_id, reviewer_actor_id, decision, verification_method, reason, evidence_digest, created_at
        ) SELECT ?, dp.id, dp.delivery_task_id, ?, ?, ?, ?, ?, ?
          FROM exchange_delivery_packages dp JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
          WHERE dp.id = ? AND dp.status = 'SUBMITTED' AND dp.version = ? AND dp.credential_expires_at > ?
            AND dt.status = 'VERIFYING' AND NOT EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE package_id = dp.id)
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          review.id, context.actorId, input.decision, input.verificationMethod, input.reason, input.evidenceDigest, now,
          packageId, input.expectedVersion, now, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`UPDATE exchange_delivery_packages SET status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'SUBMITTED' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE id = ?)`).bind(status, now, packageId, input.expectedVersion, review.id),
        db.prepare(`UPDATE exchange_delivery_tasks SET status = ?, attempt = attempt + ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'VERIFYING'
            AND EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE id = ?)`).bind(
          input.decision === "PASS" ? "DELIVERED" : "PROVISIONING", input.decision === "PASS" ? 0 : 1,
          now, current.delivery_task_id, review.id,
        ),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE id = ?)`).bind(now, current.order_id, review.id),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'DELIVERY_PACKAGE', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE id = ?)`).bind(
          eventId(), context.actorId, packageId, `DELIVERY_PACKAGE_${status}`,
          JSON.stringify({ deliveryTaskId: current.delivery_task_id, reviewId: review.id, verificationMethod: review.verification_method, evidenceDigest: review.evidence_digest }),
          now, review.id,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'REVIEW_DELIVERY_PACKAGE', ?, ?, ? WHERE EXISTS (SELECT 1 FROM exchange_delivery_reviews WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, packageId, JSON.stringify(record), now, review.id,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_delivery_reviews WHERE id = ? AND package_id = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_packages WHERE id = ? AND status = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE id = ? AND status = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ? AND event_type = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'REVIEW_DELIVERY_PACKAGE') = 1`,
        review.id, packageId, packageId, status, current.version + 1,
        current.delivery_task_id, input.decision === "PASS" ? "DELIVERED" : "PROVISIONING", current.task_version + 1,
        current.order_id, orderState.order.version + 1, packageId, `DELIVERY_PACKAGE_${status}`,
        context.actorId, context.idempotencyKey, packageId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "REVIEW_DELIVERY_PACKAGE", entityId: packageId });
          return { record: await projectDeliveryPackageAfterSnapshot(packageId, "ops"), replayed: true };
        }
        const refreshed = await db.prepare("SELECT status, version FROM exchange_delivery_packages WHERE id = ?")
          .bind(packageId).first<{ status: string; version: number }>();
        if (refreshed && (refreshed.status !== "SUBMITTED" || refreshed.version !== input.expectedVersion)) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包状态已变化，请刷新后重试。");
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "REVIEW_DELIVERY_PACKAGE", entityId: packageId });
          return { record: await projectDeliveryPackageAfterSnapshot(packageId, "ops"), replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包状态已变化，请刷新后重试。");
      }
      return { record: await projectDeliveryPackageAfterSnapshot(packageId, "ops"), replayed: false };
    },

    async claimDeliveryPackage(packageId, context, input) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "CLAIM_DELIVERY_PACKAGE", entityId: packageId });
        await projectDeliveryPackageAfterSnapshot(packageId, "buyer");
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经显示，不能重复领取；如未保存，请联系平台重发新的交付包版本。");
      }
      const current = await db.prepare(`SELECT dp.*, o.buyer_actor_id, o.version AS order_version, dt.status AS task_status
        FROM exchange_delivery_packages dp
        JOIN exchange_orders o ON o.id = dp.order_id
        JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
        WHERE dp.id = ?`).bind(packageId)
        .first<DeliveryPackageRow & { buyer_actor_id: string; order_version: number; task_status: string }>();
      if (!current || current.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      }
      await readOrder(current.order_id, "buyer");
      if (current.credential_expires_at <= new Date().toISOString()) {
        await expireD1DeliveryPackage(db, current, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请联系平台重发。");
      }
      if (current.status === "CLAIMED") {
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经显示，不能重复领取；如未保存，请联系平台重发新的交付包版本。");
      }
      if (current.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
      }
      if (current.status !== "VERIFIED" || current.task_status !== "DELIVERED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "交付包通过平台核验后才能领取。");
      }
      const testCode = oneTimeTestCode();
      const codeDigest = await sha256(testCode);
      const now = new Date().toISOString();
      const claim: DeliveryClaimRow = {
        id: createExchangeId("DC"), package_id: packageId, order_id: current.order_id,
        buyer_actor_id: context.actorId, claim_code_digest: codeDigest, claimed_at: now,
      };
      const redactedResponse = JSON.stringify({ packageId, claimId: claim.id });
      const statements = [
        db.prepare(`INSERT INTO exchange_delivery_claims (
          id, package_id, order_id, buyer_actor_id, claim_code_digest, claimed_at
        ) SELECT ?, dp.id, dp.order_id, o.buyer_actor_id, ?, ?
          FROM exchange_delivery_packages dp
          JOIN exchange_orders o ON o.id = dp.order_id
          JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
          WHERE dp.id = ? AND o.buyer_actor_id = ? AND dp.status = 'VERIFIED' AND dp.version = ?
            AND dp.credential_expires_at > ? AND dt.status = 'DELIVERED'
            AND NOT EXISTS (SELECT 1 FROM exchange_delivery_claims WHERE package_id = dp.id)
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          claim.id, codeDigest, now, packageId, context.actorId, input.expectedVersion, now, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`UPDATE exchange_delivery_packages SET status = 'CLAIMED', version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'VERIFIED' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_delivery_claims WHERE id = ?)`).bind(now, packageId, input.expectedVersion, claim.id),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ?
          WHERE id = ? AND EXISTS (SELECT 1 FROM exchange_delivery_claims WHERE id = ?)`).bind(now, current.order_id, claim.id),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'DELIVERY_PACKAGE', ?, 'DELIVERY_PACKAGE_CLAIMED', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_delivery_claims WHERE id = ?)`).bind(
          eventId(), context.actorId, packageId, JSON.stringify({ claimId: claim.id }), now, claim.id,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'CLAIM_DELIVERY_PACKAGE', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_delivery_claims WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, packageId, redactedResponse, now, claim.id,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_delivery_claims WHERE id = ? AND package_id = ?
            AND order_id = ? AND buyer_actor_id = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_packages WHERE id = ?
            AND status = 'CLAIMED' AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ?
            AND event_type = 'DELIVERY_PACKAGE_CLAIMED') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'CLAIM_DELIVERY_PACKAGE') = 1`,
        claim.id, packageId, current.order_id, context.actorId,
        packageId, current.version + 1, current.order_id, current.order_version + 1,
        packageId, context.actorId, context.idempotencyKey, packageId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrentReceipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrentReceipt) {
          validateD1CommandReceipt(concurrentReceipt, { payloadHash: context.payloadHash, commandType: "CLAIM_DELIVERY_PACKAGE", entityId: packageId });
          throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经被领取。");
        }
        const concurrentClaim = await db.prepare("SELECT id FROM exchange_delivery_claims WHERE package_id = ?")
          .bind(packageId).first<{ id: string }>();
        if (concurrentClaim) throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经被领取。");
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrentReceipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrentReceipt) {
          validateD1CommandReceipt(concurrentReceipt, { payloadHash: context.payloadHash, commandType: "CLAIM_DELIVERY_PACKAGE", entityId: packageId });
        }
        const concurrentClaim = await db.prepare("SELECT id FROM exchange_delivery_claims WHERE package_id = ?")
          .bind(packageId).first<{ id: string }>();
        if (concurrentReceipt || concurrentClaim) {
          throw new ExchangeDomainError("EXCHANGE_DELIVERY_ALREADY_CLAIMED", 410, "一次性测试码已经被领取。");
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包状态已变化，请刷新后重试。");
      }
      return { record: { package: await projectDeliveryPackageAfterSnapshot(packageId, "buyer"), testCode }, replayed: false };
    },

    async testDeliveryConnection(packageId, context, input) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "TEST_DELIVERY_CONNECTION", entityId: packageId });
        return { record: await projectConnectionCheckAfterSnapshot(packageId), replayed: true };
      }
      const current = await db.prepare(`SELECT dp.*, o.buyer_actor_id, dt.status AS task_status,
          CASE WHEN dc.id IS NULL THEN 0 ELSE 1 END AS has_claim
        FROM exchange_delivery_packages dp
        JOIN exchange_orders o ON o.id = dp.order_id
        JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
        LEFT JOIN exchange_delivery_claims dc ON dc.package_id = dp.id
        WHERE dp.id = ?`).bind(packageId)
        .first<DeliveryPackageRow & { buyer_actor_id: string; task_status: string; has_claim: number }>();
      if (!current || current.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "交付包不存在。");
      }
      await readOrder(current.order_id, "buyer");
      if (current.credential_expires_at <= new Date().toISOString()) {
        await expireD1DeliveryPackage(db, current, context.actorId);
        throw new ExchangeDomainError("EXCHANGE_DELIVERY_PACKAGE_EXPIRED", 410, "测试连接信息已经过期，请联系平台重发。");
      }
      if (current.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "交付包版本已变化，请刷新后重试。");
      }
      if (current.status !== "CLAIMED" || current.task_status !== "DELIVERED" || !current.has_claim) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "领取一次性测试码后才能测试连接。");
      }
      const latest = await db.prepare(`SELECT * FROM exchange_connection_checks
        WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).bind(packageId).first<ConnectionCheckRow>();
      if (latest?.status === "PASSED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试连接已经通过，无需重复执行。");
      }
      if (latest && latest.attempt >= 3) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 422, "测试连接次数已达上限，请联系平台处理。");
      }
      const now = new Date().toISOString();
      const checkId = createExchangeId("CC");
      const check: ConnectionCheckRow = {
        id: checkId, package_id: packageId, delivery_task_id: current.delivery_task_id, order_id: current.order_id,
        buyer_actor_id: context.actorId, attempt: (latest?.attempt ?? 0) + 1, adapter: "SIMULATED_TEST", status: "PASSED",
        diagnostic_code: "SIMULATED_ENDPOINT_REACHABLE",
        summary: "测试适配器确认连接流程可达；此结果不代表开始计费、服务完成或最终验收。",
        evidence_digest: await sha256(`${checkId}:${packageId}:SIMULATED_TEST:PASSED`),
        started_at: now, finished_at: now, created_at: now,
      };
      const record = mapConnectionCheck(check);
      const statements = [
        db.prepare(`INSERT INTO exchange_connection_checks (
          id, package_id, delivery_task_id, order_id, buyer_actor_id, attempt, adapter, status,
          diagnostic_code, summary, evidence_digest, started_at, finished_at, created_at
        ) SELECT ?, dp.id, dp.delivery_task_id, dp.order_id, o.buyer_actor_id, ?, 'SIMULATED_TEST', 'PASSED', ?, ?, ?, ?, ?, ?
          FROM exchange_delivery_packages dp
          JOIN exchange_orders o ON o.id = dp.order_id
          JOIN exchange_delivery_tasks dt ON dt.id = dp.delivery_task_id
          JOIN exchange_delivery_claims dc ON dc.package_id = dp.id
          WHERE dp.id = ? AND o.buyer_actor_id = ? AND dp.status = 'CLAIMED' AND dp.version = ?
            AND dp.credential_expires_at > ? AND dt.status = 'DELIVERED'
            AND NOT EXISTS (SELECT 1 FROM exchange_connection_checks cc WHERE cc.package_id = dp.id AND cc.status IN ('RUNNING', 'PASSED'))
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts cr WHERE cr.actor_id = ? AND cr.idempotency_key = ?)`).bind(
          check.id, check.attempt, check.diagnostic_code, check.summary, check.evidence_digest, now, now, now,
          packageId, context.actorId, input.expectedVersion, now, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'DELIVERY_PACKAGE', ?, 'DELIVERY_READINESS', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_connection_checks WHERE id = ?)`).bind(
          eventId(), context.actorId, packageId, JSON.stringify({ connectionCheckId: check.id, adapter: check.adapter, status: check.status }), now, check.id,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'TEST_DELIVERY_CONNECTION', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_connection_checks WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, packageId, JSON.stringify(record), now, check.id,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_connection_checks WHERE id = ? AND package_id = ?
            AND order_id = ? AND status = 'PASSED') = 1
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ?
            AND event_type = 'DELIVERY_READINESS') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'TEST_DELIVERY_CONNECTION') = 1`,
        check.id, packageId, current.order_id, packageId,
        context.actorId, context.idempotencyKey, packageId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_DELIVERY_CONNECTION", entityId: packageId });
          return { record: await projectConnectionCheckAfterSnapshot(packageId), replayed: true };
        }
        const concurrentCheck = await db.prepare(`SELECT status FROM exchange_connection_checks
          WHERE package_id = ? ORDER BY attempt DESC LIMIT 1`).bind(packageId).first<{ status: string }>();
        if (concurrentCheck) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试连接状态已变化，请刷新后重试。");
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_DELIVERY_CONNECTION", entityId: packageId });
          return { record: await projectConnectionCheckAfterSnapshot(packageId), replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试连接状态已变化，请刷新后重试。");
      }
      return { record: await projectConnectionCheckAfterSnapshot(packageId), replayed: false };
    },

    async listOpsMeteringOrders() {
      await ensureSchema();
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      const stale = await db.prepare(`SELECT * FROM exchange_delivery_packages
        WHERE status IN ('SUBMITTED', 'VERIFIED', 'CLAIMED') AND credential_expires_at <= ?
        ORDER BY created_at, revision`).bind(serverNow).all<DeliveryPackageRow>();
      for (const row of stale.results ?? []) {
        await expireD1DeliveryPackage(db, row, "system:delivery-expiry:ops-metering", serverNow);
      }
      const result = await db.prepare(`SELECT o.id FROM exchange_orders o
        JOIN exchange_metering_sessions ms ON ms.order_id = o.id
        ORDER BY o.created_at DESC`).all<{ id: string }>();
      return Promise.all((result.results ?? []).map(async (row) => (await readOrder(row.id, "ops")).record));
    },

    async testStartService(orderId, context, input: TestServiceStart) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "TEST_SERVICE_START", entityId: orderId });
        return { record: (await readOrder(orderId, "ops")).record, replayed: true };
      }
      const current = await readOrder(orderId, "ops");
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      if (!current.metering) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单计量会话不存在。");
      if (current.metering.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "计量会话版本已变化，请刷新后重试。");
      }
      const readiness = await db.prepare(`SELECT dp.*,
          CASE WHEN (SELECT cc.status FROM exchange_connection_checks cc
            WHERE cc.package_id = dp.id ORDER BY cc.attempt DESC LIMIT 1) = 'PASSED'
            THEN 1 ELSE 0 END AS has_passed_connection
        FROM exchange_delivery_packages dp WHERE dp.order_id = ?
        ORDER BY dp.revision DESC LIMIT 1`).bind(orderId)
        .first<DeliveryPackageRow & { has_passed_connection: number }>();
      if (readiness && readiness.credential_expires_at <= serverNow
        && ["SUBMITTED", "VERIFIED", "CLAIMED", "EXPIRED"].includes(readiness.status)) {
        if (["SUBMITTED", "VERIFIED", "CLAIMED"].includes(readiness.status)) {
          await expireD1DeliveryPackage(db, readiness, context.actorId, serverNow);
        }
        throw new ExchangeDomainError(
          "EXCHANGE_DELIVERY_PACKAGE_EXPIRED",
          410,
          "测试连接信息已经过期，请供应商重新提交并完成领取与连接检查。",
        );
      }
      if (!readiness || readiness.status !== "CLAIMED" || !readiness.has_passed_connection) {
        throw new ExchangeDomainError(
          "EXCHANGE_STATE_CONFLICT",
          409,
          "测试交付包完成领取且连接检查通过后才能开始服务。",
        );
      }
      if (serverNow < current.order.start_at || serverNow >= current.order.end_at) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试服务只能在订单固定服务时间窗内开始。");
      }
      if (current.metering.status !== "SCHEDULED" || current.payment?.status !== "CAPTURED"
        || current.payment.environment !== "TEST" || current.delivery?.status !== "DELIVERED"
        || current.reservation.state !== "COMMITTED" || current.lifecycle?.phase !== "FULFILLING") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能开始测试服务。");
      }
      const factId = createExchangeId("SF");
      const capacityTransferId = transferId();
      const evidenceDigest = await sha256(`${factId}:${orderId}:${serverNow}:TEST_SERVICE_STARTED`);
      const updatedMetering: MeteringSessionRow = {
        ...current.metering,
        status: "ACTIVE",
        actual_start_at: serverNow,
        version: current.metering.version + 1,
        updated_at: serverNow,
      };
      const updatedDelivery: DeliveryTaskRow = {
        ...current.delivery,
        status: "IN_SERVICE",
        version: current.delivery.version + 1,
        updated_at: serverNow,
      };
      const updatedReservation: ReservationRow = {
        ...current.reservation,
        state: "IN_SERVICE",
        version: current.reservation.version + 1,
        updated_at: serverNow,
      };
      const updatedOrder: OrderRow = { ...current.order, version: current.order.version + 1, updated_at: serverNow };
      const updatedRecord = mapOrder(updatedOrder, updatedReservation, "ops", {
        lifecycle: current.lifecycle,
        payment: current.payment,
        delivery: updatedDelivery,
        deliveryPackage: current.deliveryPackage,
        metering: updatedMetering,
        acceptance: current.acceptance,
        settlement: current.settlement,
        commission: current.commission,
        referralDecision: current.referralDecision,
        referralAttribution: current.referralAttribution,
      });
      const statements = [
        db.prepare(`INSERT INTO exchange_service_facts (
          id, metering_session_id, order_id, fact_type, environment, effective_start_at,
          effective_end_at, rate_unit_code, available_capacity_base_units,
          available_gpu_seconds, evidence_digest, created_at
        ) SELECT ?, ms.id, o.id, 'TEST_SERVICE_STARTED', 'TEST', ?, NULL, o.rate_unit_code, 0,
            CASE WHEN o.rate_unit_code = 'GPU' THEN 0 ELSE NULL END, ?, ?
          FROM exchange_metering_sessions ms
          JOIN exchange_orders o ON o.id = ms.order_id
          JOIN exchange_payment_intents pi ON pi.order_id = o.id
          JOIN exchange_delivery_tasks dt ON dt.order_id = o.id
          JOIN exchange_delivery_packages dp ON dp.delivery_task_id = dt.id
            AND dp.status = 'CLAIMED' AND dp.credential_expires_at > ?
          JOIN exchange_reservations r ON r.order_id = o.id
          JOIN exchange_order_lifecycle ol ON ol.order_id = o.id
          WHERE o.id = ? AND ms.status = 'SCHEDULED' AND ms.version = ?
            AND ms.environment = 'TEST' AND pi.status = 'CAPTURED' AND pi.environment = 'TEST'
            AND dt.status = 'DELIVERED' AND r.state = 'COMMITTED' AND ol.phase = 'FULFILLING'
            AND (SELECT cc.status FROM exchange_connection_checks cc
              WHERE cc.package_id = dp.id ORDER BY cc.attempt DESC LIMIT 1) = 'PASSED'
            AND o.start_at <= ? AND o.end_at > ?
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          factId, serverNow, evidenceDigest, serverNow, serverNow, orderId, input.expectedVersion,
          serverNow, serverNow, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`UPDATE exchange_metering_sessions SET status = 'ACTIVE', actual_start_at = ?,
          version = version + 1, updated_at = ? WHERE order_id = ? AND status = 'SCHEDULED' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(
          serverNow, serverNow, orderId, input.expectedVersion, factId,
        ),
        db.prepare(`UPDATE exchange_delivery_tasks SET status = 'IN_SERVICE', version = version + 1, updated_at = ?
          WHERE order_id = ? AND status = 'DELIVERED'
            AND EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(serverNow, orderId, factId),
        db.prepare(`UPDATE exchange_reservations SET state = 'IN_SERVICE', version = version + 1, updated_at = ?
          WHERE order_id = ? AND state = 'COMMITTED'
            AND EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(serverNow, orderId, factId),
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) SELECT ?, r.capacity_lot_id, r.order_id, ?, 'LOCKED', 'IN_SERVICE',
            r.rate_unit_code, r.capacity_base_units, r.capacity_gpu_seconds, 'TEST_SERVICE_STARTED', ?
          FROM exchange_reservations r WHERE r.order_id = ?
            AND EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(
          capacityTransferId, `order:${orderId}:test-service-start`, serverNow, orderId, factId,
        ),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(serverNow, orderId, factId),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'ORDER', ?, 'TEST_SERVICE_STARTED', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(
          eventId(), context.actorId, orderId, JSON.stringify({
            meteringSessionId: current.metering.id,
            serviceFactId: factId,
            capacityTransferId,
            effectiveAt: serverNow,
            fundsMoved: false,
          }), serverNow, factId,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'TEST_SERVICE_START', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_service_facts WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId,
          JSON.stringify(updatedRecord), serverNow, factId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_service_facts WHERE id = ? AND order_id = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_metering_sessions WHERE order_id = ? AND status = 'ACTIVE') = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE order_id = ? AND status = 'IN_SERVICE') = 1
          AND (SELECT COUNT(*) FROM exchange_reservations WHERE order_id = ? AND state = 'IN_SERVICE') = 1
          AND (SELECT COUNT(*) FROM exchange_capacity_transfers
            WHERE order_id = ? AND reason = 'TEST_SERVICE_STARTED') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND command_type = 'TEST_SERVICE_START') = 1`,
        factId, orderId, orderId, orderId, orderId, orderId, context.actorId, context.idempotencyKey),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_SERVICE_START", entityId: orderId });
          return { record: (await readOrder(orderId, "ops")).record, replayed: true };
        }
        const refreshed = await db.prepare("SELECT status, version FROM exchange_metering_sessions WHERE order_id = ?")
          .bind(orderId).first<{ status: string; version: number }>();
        if (refreshed?.status !== "SCHEDULED" || refreshed.version !== input.expectedVersion) {
          throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试服务状态已变化，请刷新后重试。");
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_SERVICE_START", entityId: orderId });
          return { record: (await readOrder(orderId, "ops")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试服务状态已变化，请刷新后重试。");
      }
      return { record: (await readOrder(orderId, "ops")).record, replayed: false };
    },

    async testCompleteMetering(orderId, context, input: TestMeterComplete) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "TEST_METER_COMPLETE", entityId: orderId });
        return { record: (await readOrder(orderId, "ops")).record, replayed: true };
      }
      const current = await readOrder(orderId, "ops");
      const serverNow = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      if (!current.metering) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单计量会话不存在。");
      if (current.metering.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "计量会话版本已变化，请刷新后重试。");
      }
      if (serverNow < current.order.end_at) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "固定服务时间窗结束后才能完成计量。");
      }
      if (current.metering.status !== "ACTIVE" || !current.metering.actual_start_at
        || current.delivery?.status !== "IN_SERVICE" || current.reservation.state !== "IN_SERVICE"
        || current.lifecycle?.phase !== "FULFILLING") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能完成测试计量。");
      }
      if (!current.snapshot) throw new Error("EXCHANGE_INVARIANT_CORRUPTION:ORDER_CONTRACT_SNAPSHOT_MISSING");
      const scheduledCapacityBaseUnits = current.order.capacity_base_units;
      const unprovenCapacityBaseUnits = Math.max(0, Math.min(
        scheduledCapacityBaseUnits,
        ((Date.parse(current.metering.actual_start_at) - Date.parse(current.order.start_at)) / 1_000) * current.order.rate_units,
      ));
      const availableCapacityBaseUnits = scheduledCapacityBaseUnits - unprovenCapacityBaseUnits;
      const unavailableCapacityBaseUnits = unprovenCapacityBaseUnits;
      const availabilityPpm = Number(
        (BigInt(availableCapacityBaseUnits) * BigInt(1_000_000)) / BigInt(scheduledCapacityBaseUnits),
      );
      const deliveredAmountCents = Number(
        (BigInt(current.snapshot.grossAmountCents) * BigInt(availableCapacityBaseUnits)) / BigInt(scheduledCapacityBaseUnits),
      );
      const baseCreditCents = current.snapshot.grossAmountCents - deliveredAmountCents;
      const finalId = createExchangeId("MF");
      const factId = createExchangeId("SF");
      const acceptanceId = createExchangeId("AC");
      const settlementId = createExchangeId("ST");
      const consumeTransferId = transferId();
      const intervalId = createExchangeId("MI");
      const evidenceId = createExchangeId("ME");
      const identityEvidenceId = createExchangeId("ME");
      const modelIdentityDigest = await sha256(JSON.stringify(current.snapshot.productIdentity));
      const finalDigest = await sha256([
        orderId, scheduledCapacityBaseUnits, availableCapacityBaseUnits, unavailableCapacityBaseUnits,
        unprovenCapacityBaseUnits, availabilityPpm, deliveredAmountCents, baseCreditCents,
      ].join(":"));
      const updatedMetering: MeteringSessionRow = {
        ...current.metering,
        status: "FINAL",
        finalized_at: serverNow,
        available_capacity_base_units: availableCapacityBaseUnits,
        unavailable_capacity_base_units: unavailableCapacityBaseUnits,
        unproven_capacity_base_units: unprovenCapacityBaseUnits,
        available_gpu_seconds: current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
        unavailable_gpu_seconds: current.order.rate_unit_code === "GPU" ? unavailableCapacityBaseUnits : null,
        unproven_gpu_seconds: current.order.rate_unit_code === "GPU" ? unprovenCapacityBaseUnits : null,
        availability_ppm: availabilityPpm,
        version: current.metering.version + 1,
        updated_at: serverNow,
      };
      const updatedDelivery: DeliveryTaskRow = {
        ...current.delivery, status: "COMPLETED", version: current.delivery.version + 1, updated_at: serverNow,
      };
      const updatedReservation: ReservationRow = {
        ...current.reservation, state: "FULFILLED", version: current.reservation.version + 1, updated_at: serverNow,
      };
      const updatedLifecycle: OrderLifecycleRow = {
        ...current.lifecycle!, phase: "AWAITING_ACCEPTANCE", state_reason: "TEST_METERING_FINAL",
        version: current.lifecycle!.version + 1, updated_at: serverNow,
      };
      const acceptance: AcceptanceRow = {
        id: acceptanceId, order_id: orderId, metering_final_id: finalId, buyer_actor_id: current.order.buyer_actor_id,
        status: "PENDING", reason: null, evidence_digest: null, version: 1, created_at: serverNow, updated_at: serverNow,
      };
      const settlement: SettlementRow = {
        id: settlementId, order_id: orderId, metering_final_id: finalId, acceptance_id: acceptanceId,
        environment: "TEST", status: "BLOCKED", gross_amount_cents: current.snapshot.grossAmountCents,
        base_credit_cents: baseCreditCents, dispute_credit_cents: 0,
        net_supplier_payable_cents: deliveredAmountCents, funds_moved: 0, ledger_batch_id: null,
        version: 1, created_at: serverNow, updated_at: serverNow,
      };
      const updatedOrder: OrderRow = { ...current.order, version: current.order.version + 1, updated_at: serverNow };
      const updatedRecord = mapOrder(updatedOrder, updatedReservation, "ops", {
        lifecycle: updatedLifecycle, payment: current.payment, delivery: updatedDelivery,
        deliveryPackage: current.deliveryPackage, metering: updatedMetering, acceptance, settlement,
        commission: current.commission, referralDecision: current.referralDecision,
        referralAttribution: current.referralAttribution,
      });
      const statements = [
        db.prepare(`INSERT INTO exchange_metering_finals (
          id, metering_session_id, order_id, rate_unit_code,
          scheduled_capacity_base_units, available_capacity_base_units,
          unavailable_capacity_base_units, unproven_capacity_base_units,
          scheduled_gpu_seconds, available_gpu_seconds,
          unavailable_gpu_seconds, unproven_gpu_seconds, availability_ppm, gross_amount_cents,
          delivered_amount_cents, base_credit_cents, evidence_digest, finalized_at
        ) SELECT ?, ms.id, o.id, o.rate_unit_code, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          FROM exchange_metering_sessions ms
          JOIN exchange_orders o ON o.id = ms.order_id
          JOIN exchange_delivery_tasks dt ON dt.order_id = o.id
          JOIN exchange_reservations r ON r.order_id = o.id
          JOIN exchange_order_lifecycle ol ON ol.order_id = o.id
          WHERE o.id = ? AND ms.status = 'ACTIVE' AND ms.version = ? AND ms.actual_start_at IS NOT NULL
            AND dt.status = 'IN_SERVICE' AND r.state = 'IN_SERVICE' AND ol.phase = 'FULFILLING'
            AND o.end_at <= ?
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          finalId, scheduledCapacityBaseUnits, availableCapacityBaseUnits,
          unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? scheduledCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unavailableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unprovenCapacityBaseUnits : null,
          availabilityPpm, current.snapshot.grossAmountCents, deliveredAmountCents, baseCreditCents,
          finalDigest, serverNow, orderId, input.expectedVersion, serverNow, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`INSERT INTO exchange_meter_intervals (
          id, metering_session_id, order_id, capacity_policy_id, sequence_number,
          interval_start_at, interval_end_at, duration_seconds, reserved_rate_units, proven_rate_units,
          scheduled_capacity_base_units, available_capacity_base_units, unavailable_capacity_base_units,
          unproven_capacity_base_units, evidence_status, adapter, evidence_digest, created_at
        ) SELECT ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TEST', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          intervalId, current.metering.id, orderId, current.snapshot.capacityPolicyId,
          current.order.start_at, current.order.end_at, current.snapshot.durationSeconds,
          current.order.rate_units, availableCapacityBaseUnits > 0 ? current.order.rate_units : 0,
          scheduledCapacityBaseUnits, availableCapacityBaseUnits, unavailableCapacityBaseUnits,
          unprovenCapacityBaseUnits, unprovenCapacityBaseUnits > 0 ? "UNPROVEN" : "PROVEN",
          finalDigest, serverNow, finalId,
        ),
        db.prepare(`INSERT INTO exchange_meter_evidence (
          id, meter_interval_id, evidence_type, source, model_identity_digest,
          payload_digest, observed_at, created_at
        ) SELECT ?, ?, CASE ?
            WHEN 'MODEL_INSTANCE' THEN 'INSTANCE_HEARTBEAT'
            WHEN 'MILLI_M_TOKEN_PER_HOUR' THEN 'THROUGHPUT'
            WHEN 'GIB_STORAGE' THEN 'STORAGE_AVAILABILITY'
            WHEN 'RACK' THEN 'RACK_AVAILABILITY'
            ELSE 'AVAILABILITY'
          END,
            'TEST', NULL, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_meter_intervals WHERE id = ?)`).bind(
          evidenceId, intervalId, current.order.rate_unit_code, finalDigest,
          current.order.start_at, serverNow, intervalId,
        ),
        db.prepare(`INSERT INTO exchange_meter_evidence (
          id, meter_interval_id, evidence_type, source, model_identity_digest,
          payload_digest, observed_at, created_at
        ) SELECT ?, ?, CASE ?
            WHEN 'GIB_STORAGE' THEN 'STORAGE_IDENTITY'
            WHEN 'RACK' THEN 'FACILITY_IDENTITY'
            ELSE 'MODEL_IDENTITY'
          END, 'TEST', ?, ?, ?, ?
          WHERE ? IN ('MODEL_INSTANCE', 'MILLI_M_TOKEN_PER_HOUR', 'GIB_STORAGE', 'RACK')
            AND EXISTS (SELECT 1 FROM exchange_meter_intervals WHERE id = ?)`).bind(
          identityEvidenceId, intervalId, current.order.rate_unit_code, modelIdentityDigest, modelIdentityDigest,
          current.order.start_at, serverNow, current.order.rate_unit_code, intervalId,
        ),
        db.prepare(`INSERT INTO exchange_service_facts (
          id, metering_session_id, order_id, fact_type, environment, effective_start_at,
          effective_end_at, rate_unit_code, available_capacity_base_units,
          available_gpu_seconds, evidence_digest, created_at
        ) SELECT ?, mf.metering_session_id, mf.order_id, 'TEST_WINDOW_FINALIZED', 'TEST', ?, ?,
            mf.rate_unit_code, ?, ?, ?, ?
          FROM exchange_metering_finals mf WHERE mf.id = ?`).bind(
          factId, current.metering.actual_start_at, current.order.end_at,
          availableCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
          finalDigest, serverNow, finalId,
        ),
        db.prepare(`UPDATE exchange_metering_sessions SET status = 'FINAL', finalized_at = ?,
          available_capacity_base_units = ?, unavailable_capacity_base_units = ?, unproven_capacity_base_units = ?,
          available_gpu_seconds = ?, unavailable_gpu_seconds = ?, unproven_gpu_seconds = ?,
          availability_ppm = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'ACTIVE' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          serverNow, availableCapacityBaseUnits, unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
          current.order.rate_unit_code === "GPU" ? availableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unavailableCapacityBaseUnits : null,
          current.order.rate_unit_code === "GPU" ? unprovenCapacityBaseUnits : null, availabilityPpm,
          serverNow, current.metering.id, input.expectedVersion, finalId,
        ),
        db.prepare(`UPDATE exchange_delivery_tasks SET status = 'COMPLETED', version = version + 1, updated_at = ?
          WHERE order_id = ? AND status = 'IN_SERVICE'
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(serverNow, orderId, finalId),
        db.prepare(`UPDATE exchange_reservations SET state = 'FULFILLED', version = version + 1, updated_at = ?
          WHERE order_id = ? AND state = 'IN_SERVICE'
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(serverNow, orderId, finalId),
        db.prepare(`INSERT INTO exchange_capacity_transfers (
          id, capacity_lot_id, order_id, idempotency_key, from_bucket, to_bucket,
          rate_unit_code, capacity_base_units, capacity_gpu_seconds, reason, occurred_at
        ) SELECT ?, r.capacity_lot_id, r.order_id, ?, 'IN_SERVICE', 'CONSUMED',
            r.rate_unit_code, r.capacity_base_units, r.capacity_gpu_seconds, 'TEST_METERING_FINAL', ?
          FROM exchange_reservations r WHERE r.order_id = ?
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          consumeTransferId, `order:${orderId}:test-meter-final`, serverNow, orderId, finalId,
        ),
        db.prepare(`INSERT INTO exchange_acceptances (
          id, order_id, metering_final_id, buyer_actor_id, status, reason, evidence_digest,
          version, created_at, updated_at
        ) SELECT ?, o.id, ?, o.buyer_actor_id, 'PENDING', NULL, NULL, 1, ?, ?
          FROM exchange_orders o WHERE o.id = ?
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          acceptanceId, finalId, serverNow, serverNow, orderId, finalId,
        ),
        db.prepare(`INSERT INTO exchange_settlements (
          id, order_id, metering_final_id, acceptance_id, environment, status,
          gross_amount_cents, base_credit_cents, dispute_credit_cents, net_supplier_payable_cents,
          funds_moved, ledger_batch_id, version, created_at, updated_at
        ) SELECT ?, ?, ?, ?, 'TEST', 'BLOCKED', ?, ?, 0, ?, 0, NULL, 1, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_acceptances WHERE id = ?)`).bind(
          settlementId, orderId, finalId, acceptanceId, current.snapshot.grossAmountCents,
          baseCreditCents, deliveredAmountCents, serverNow, serverNow, acceptanceId,
        ),
        db.prepare(`UPDATE exchange_order_lifecycle SET phase = 'AWAITING_ACCEPTANCE',
          state_reason = 'TEST_METERING_FINAL', version = version + 1, updated_at = ?
          WHERE order_id = ? AND phase = 'FULFILLING'
            AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(serverNow, orderId, finalId),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(serverNow, orderId, finalId),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'ORDER', ?, 'TEST_METERING_FINAL', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          eventId(), context.actorId, orderId, JSON.stringify({
            meteringFinalId: finalId, rateUnitCode: current.order.rate_unit_code,
            scheduledCapacityBaseUnits, availableCapacityBaseUnits,
            unavailableCapacityBaseUnits, unprovenCapacityBaseUnits,
            grossAmountCents: current.snapshot.grossAmountCents,
            baseCreditCents, netSupplierPayableCents: deliveredAmountCents, fundsMoved: false,
          }), serverNow, finalId,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'TEST_METER_COMPLETE', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_metering_finals WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId,
          JSON.stringify(updatedRecord), serverNow, finalId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_metering_finals WHERE id = ? AND order_id = ?
            AND rate_unit_code = ? AND scheduled_capacity_base_units = ?
            AND gross_amount_cents = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_meter_intervals WHERE id = ? AND order_id = ?
            AND capacity_policy_id = ? AND scheduled_capacity_base_units = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_meter_evidence WHERE meter_interval_id = ?) = ?
          AND (
            (? = 'GPU' AND (SELECT COUNT(*) FROM exchange_meter_evidence
              WHERE meter_interval_id = ? AND evidence_type = 'AVAILABILITY') = 1)
            OR (? = 'MODEL_INSTANCE'
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'MODEL_IDENTITY') = 1
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'INSTANCE_HEARTBEAT') = 1)
            OR (? = 'MILLI_M_TOKEN_PER_HOUR'
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'MODEL_IDENTITY') = 1
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'THROUGHPUT') = 1)
            OR (? = 'GIB_STORAGE'
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'STORAGE_IDENTITY') = 1
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'STORAGE_AVAILABILITY') = 1)
            OR (? = 'RACK'
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'FACILITY_IDENTITY') = 1
              AND (SELECT COUNT(*) FROM exchange_meter_evidence
                WHERE meter_interval_id = ? AND evidence_type = 'RACK_AVAILABILITY') = 1)
          )
          AND (SELECT COUNT(*) FROM exchange_metering_sessions WHERE order_id = ? AND status = 'FINAL') = 1
          AND (SELECT COUNT(*) FROM exchange_delivery_tasks WHERE order_id = ? AND status = 'COMPLETED') = 1
          AND (SELECT COUNT(*) FROM exchange_reservations WHERE order_id = ? AND state = 'FULFILLED') = 1
          AND (SELECT COUNT(*) FROM exchange_acceptances WHERE order_id = ? AND status = 'PENDING') = 1
          AND (SELECT COUNT(*) FROM exchange_settlements WHERE order_id = ? AND status = 'BLOCKED'
            AND gross_amount_cents = ? AND base_credit_cents + net_supplier_payable_cents = gross_amount_cents) = 1
          AND (SELECT COUNT(*) FROM exchange_order_lifecycle WHERE order_id = ? AND phase = 'AWAITING_ACCEPTANCE') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND command_type = 'TEST_METER_COMPLETE') = 1`,
        finalId, orderId, current.order.rate_unit_code, scheduledCapacityBaseUnits, current.snapshot.grossAmountCents,
        intervalId, orderId, current.snapshot.capacityPolicyId, scheduledCapacityBaseUnits,
        intervalId, current.order.rate_unit_code === "GPU" ? 1 : 2,
        current.order.rate_unit_code, intervalId,
        current.order.rate_unit_code, intervalId, intervalId,
        current.order.rate_unit_code, intervalId, intervalId,
        current.order.rate_unit_code, intervalId, intervalId,
        current.order.rate_unit_code, intervalId, intervalId,
        orderId, orderId, orderId, orderId, orderId, current.snapshot.grossAmountCents,
        orderId, context.actorId, context.idempotencyKey),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_METER_COMPLETE", entityId: orderId });
          return { record: (await readOrder(orderId, "ops")).record, replayed: true };
        }
        const final = await db.prepare("SELECT id FROM exchange_metering_finals WHERE order_id = ?").bind(orderId).first<{ id: string }>();
        if (final) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试计量已经完成，请刷新后重试。");
        throw error;
      }
      if (changes(results[0]) !== 1) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_METER_COMPLETE", entityId: orderId });
          return { record: (await readOrder(orderId, "ops")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试计量状态已变化，请刷新后重试。");
      }
      return { record: (await readOrder(orderId, "ops")).record, replayed: false };
    },

    async submitAcceptance(orderId, context, input: SubmitOrderAcceptance) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "SUBMIT_ACCEPTANCE", entityId: orderId });
        return { record: (await readOrder(orderId, "buyer")).record, replayed: true };
      }
      const current = await readOrder(orderId, "buyer");
      if (current.order.buyer_actor_id !== context.actorId) {
        throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有该订单的买方可以验收或发起争议。");
      }
      if (!current.acceptance) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "订单验收单不存在。");
      if (current.acceptance.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "验收单版本已变化，请刷新后重试。");
      }
      if (current.acceptance.status !== "PENDING" || current.metering?.status !== "FINAL"
        || current.lifecycle?.phase !== "AWAITING_ACCEPTANCE" || !current.settlement
        || current.settlement.status !== "BLOCKED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能提交验收结论。");
      }
      const now = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      const status = input.decision === "ACCEPT" ? "ACCEPTED" : "DISPUTED";
      const updatedAcceptance: AcceptanceRow = {
        ...current.acceptance, status, reason: input.reason, evidence_digest: input.evidenceDigest,
        version: current.acceptance.version + 1, updated_at: now,
      };
      const updatedSettlement: SettlementRow = {
        ...current.settlement, status: input.decision === "ACCEPT" ? "ELIGIBLE" : "BLOCKED",
        version: current.settlement.version + 1, updated_at: now,
      };
      const updatedLifecycle: OrderLifecycleRow = {
        ...current.lifecycle!, phase: input.decision === "ACCEPT" ? "COMPLETED" : "EXCEPTION",
        state_reason: input.decision === "ACCEPT" ? "BUYER_ACCEPTED" : "BUYER_DISPUTED",
        version: current.lifecycle!.version + 1, updated_at: now,
      };
      const updatedOrder: OrderRow = { ...current.order, version: current.order.version + 1, updated_at: now };
      const updatedRecord = mapOrder(updatedOrder, current.reservation, "buyer", {
        lifecycle: updatedLifecycle, payment: current.payment, delivery: current.delivery,
        deliveryPackage: current.deliveryPackage, metering: current.metering,
        acceptance: updatedAcceptance, settlement: updatedSettlement,
        commission: current.commission, referralDecision: current.referralDecision,
        referralAttribution: current.referralAttribution,
      });
      const gateEventId = eventId();
      const statements = [
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'ORDER', o.id, ?, ?, ?
          FROM exchange_orders o
          JOIN exchange_acceptances a ON a.order_id = o.id
          JOIN exchange_metering_sessions ms ON ms.order_id = o.id
          JOIN exchange_settlements s ON s.order_id = o.id
          JOIN exchange_order_lifecycle ol ON ol.order_id = o.id
          WHERE o.id = ? AND o.buyer_actor_id = ? AND a.status = 'PENDING' AND a.version = ?
            AND ms.status = 'FINAL' AND s.status = 'BLOCKED' AND ol.phase = 'AWAITING_ACCEPTANCE'
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          gateEventId, context.actorId, `BUYER_${status}`,
          JSON.stringify({ acceptanceId: current.acceptance.id, evidenceDigest: input.evidenceDigest, reason: input.reason }),
          now, orderId, context.actorId, input.expectedVersion, context.actorId, context.idempotencyKey,
        ),
        db.prepare(`UPDATE exchange_acceptances SET status = ?, reason = ?, evidence_digest = ?,
          version = version + 1, updated_at = ? WHERE id = ? AND status = 'PENDING' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          status, input.reason, input.evidenceDigest, now, current.acceptance.id, input.expectedVersion, gateEventId,
        ),
        db.prepare(`UPDATE exchange_settlements SET status = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'BLOCKED'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          updatedSettlement.status, now, current.settlement.id, gateEventId,
        ),
        db.prepare(`UPDATE exchange_order_lifecycle SET phase = ?, state_reason = ?, version = version + 1, updated_at = ?
          WHERE order_id = ? AND phase = 'AWAITING_ACCEPTANCE'
            AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          updatedLifecycle.phase, updatedLifecycle.state_reason, now, orderId, gateEventId,
        ),
        db.prepare(`UPDATE exchange_orders SET version = version + 1, updated_at = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(now, orderId, gateEventId),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'SUBMIT_ACCEPTANCE', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_domain_events WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, orderId,
          JSON.stringify(updatedRecord), now, gateEventId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_domain_events WHERE id = ? AND entity_id = ?
            AND event_type = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_acceptances WHERE id = ? AND status = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_settlements WHERE id = ? AND status = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_order_lifecycle WHERE order_id = ?
            AND phase = ? AND state_reason = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_orders WHERE id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'SUBMIT_ACCEPTANCE') = 1`,
        gateEventId, orderId, `BUYER_${status}`,
        current.acceptance.id, status, current.acceptance.version + 1,
        current.settlement.id, updatedSettlement.status, current.settlement.version + 1,
        orderId, updatedLifecycle.phase, updatedLifecycle.state_reason, current.lifecycle!.version + 1,
        orderId, current.order.version + 1,
        context.actorId, context.idempotencyKey, orderId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "SUBMIT_ACCEPTANCE", entityId: orderId });
          return { record: (await readOrder(orderId, "buyer")).record, replayed: true };
        }
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "SUBMIT_ACCEPTANCE", entityId: orderId });
          return { record: (await readOrder(orderId, "buyer")).record, replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "验收状态已变化，请刷新后重试。");
      }
      return { record: (await readOrder(orderId, "buyer")).record, replayed: false };
    },

    async testRecordSettlement(settlementId, context, input: TestRecordSettlement) {
      await ensureSchema();
      const receipt = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
      if (receipt) {
        validateD1CommandReceipt(receipt, { payloadHash: context.payloadHash, commandType: "TEST_RECORD_SETTLEMENT", entityId: settlementId });
        return { record: await projectSettlementAfterSnapshot(settlementId), replayed: true };
      }
      const current = await db.prepare(`SELECT s.*, a.status AS acceptance_status, pi.status AS payment_status,
          pi.environment AS payment_environment, ol.phase AS lifecycle_phase
        FROM exchange_settlements s
        JOIN exchange_acceptances a ON a.id = s.acceptance_id
        JOIN exchange_payment_intents pi ON pi.order_id = s.order_id
        JOIN exchange_order_lifecycle ol ON ol.order_id = s.order_id
        WHERE s.id = ?`).bind(settlementId).first<SettlementRow & {
          acceptance_status: string; payment_status: string; payment_environment: string; lifecycle_phase: string;
        }>();
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "测试结算单不存在。");
      await readOrder(current.order_id, "ops");
      if (current.version !== input.expectedVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算单版本已变化，请刷新后重试。");
      }
      if (current.status !== "ELIGIBLE" || current.acceptance_status !== "ACCEPTED"
        || current.payment_status !== "CAPTURED" || current.payment_environment !== "TEST"
        || current.lifecycle_phase !== "COMPLETED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "测试结算单当前没有记账资格。");
      }
      const now = new Date(Math.floor(clock().getTime() / 1_000) * 1_000).toISOString();
      const batchId = createExchangeId("LB");
      const updated: SettlementRow = {
        ...current, status: "TEST_RECORDED", funds_moved: 0, ledger_batch_id: batchId,
        version: current.version + 1, updated_at: now,
      };
      const attribution = await db.prepare("SELECT * FROM exchange_referral_attributions WHERE order_id = ?")
        .bind(current.order_id).first<ReferralAttributionRow>();
      const commission: CommissionAccrualRow | null = attribution ? {
        id: createExchangeId("CA"), order_id: current.order_id, settlement_id: settlementId,
        attribution_id: attribution.id, agent_actor_id: attribution.agent_actor_id,
        environment: "TEST", record_kind: "ESTIMATE_ONLY",
        commission_base_cents: current.gross_amount_cents,
        commission_rate_basis_points: 300,
        commission_estimate_cents: deriveCommissionEstimateCents(current.gross_amount_cents),
        funds_moved: 0, created_at: now,
      } : null;
      const record = mapSettlement(updated, commission);
      const creditEntries = [
        { account: "TEST_SUPPLIER_PAYABLE", amount: current.net_supplier_payable_cents },
        { account: "TEST_BUYER_CREDIT", amount: current.base_credit_cents + current.dispute_credit_cents },
      ].filter((entry) => entry.amount > 0);
      const statements = [
        db.prepare(`INSERT INTO exchange_ledger_batches (
          id, settlement_id, environment, entry_count, debit_total_cents, credit_total_cents,
          funds_moved, created_at
        ) SELECT ?, s.id, 'TEST', ?, s.gross_amount_cents, s.gross_amount_cents, 0, ?
          FROM exchange_settlements s
          JOIN exchange_acceptances a ON a.id = s.acceptance_id
          JOIN exchange_payment_intents pi ON pi.order_id = s.order_id
          JOIN exchange_order_lifecycle ol ON ol.order_id = s.order_id
          WHERE s.id = ? AND s.status = 'ELIGIBLE' AND s.version = ?
            AND a.status = 'ACCEPTED' AND pi.status = 'CAPTURED' AND pi.environment = 'TEST'
            AND ol.phase = 'COMPLETED'
            AND NOT EXISTS (SELECT 1 FROM exchange_command_receipts WHERE actor_id = ? AND idempotency_key = ?)`).bind(
          batchId, 1 + creditEntries.length, now, settlementId, input.expectedVersion,
          context.actorId, context.idempotencyKey,
        ),
        db.prepare(`INSERT INTO exchange_ledger_entries (
          id, batch_id, settlement_id, account_code, side, amount_cents, created_at
        ) SELECT ?, ?, s.id, 'TEST_BUYER_SETTLEMENT_CLEARING', 'DEBIT', s.gross_amount_cents, ?
          FROM exchange_settlements s WHERE s.id = ?
            AND EXISTS (SELECT 1 FROM exchange_ledger_batches WHERE id = ?)`).bind(
          createExchangeId("LE"), batchId, now, settlementId, batchId,
        ),
        ...creditEntries.map((entry) => db.prepare(`INSERT INTO exchange_ledger_entries (
          id, batch_id, settlement_id, account_code, side, amount_cents, created_at
        ) SELECT ?, ?, ?, ?, 'CREDIT', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_ledger_batches WHERE id = ?)`).bind(
          createExchangeId("LE"), batchId, settlementId, entry.account, entry.amount, now, batchId,
        )),
        db.prepare(`UPDATE exchange_settlements SET status = 'TEST_RECORDED', funds_moved = 0,
          ledger_batch_id = ?, version = version + 1, updated_at = ?
          WHERE id = ? AND status = 'ELIGIBLE' AND version = ?
            AND EXISTS (SELECT 1 FROM exchange_ledger_batches WHERE id = ?)`).bind(
          batchId, now, settlementId, input.expectedVersion, batchId,
        ),
        ...(commission ? [db.prepare(`INSERT INTO exchange_commission_accruals (
            id, order_id, settlement_id, attribution_id, agent_actor_id,
            environment, record_kind, commission_base_cents, commission_rate_basis_points,
            commission_estimate_cents, funds_moved, created_at
          ) SELECT ?, ?, ?, ?, ?, 'TEST', 'ESTIMATE_ONLY', ?, 300, ?, 0, ?
          WHERE EXISTS (SELECT 1 FROM exchange_settlements
            WHERE id = ? AND status = 'TEST_RECORDED' AND ledger_batch_id = ?)`)
          .bind(
            commission.id, commission.order_id, commission.settlement_id,
            commission.attribution_id, commission.agent_actor_id,
            commission.commission_base_cents, commission.commission_estimate_cents,
            commission.created_at, settlementId, batchId,
          )] : []),
        db.prepare(`INSERT INTO exchange_domain_events (
          id, actor_id, entity_type, entity_id, event_type, payload_json, occurred_at
        ) SELECT ?, ?, 'SETTLEMENT', ?, 'TEST_SETTLEMENT_RECORDED', ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_ledger_batches WHERE id = ?)`).bind(
          eventId(), context.actorId, settlementId, JSON.stringify({
            ledgerBatchId: batchId, grossAmountCents: record.grossAmountCents,
            baseCreditCents: record.baseCreditCents,
            netSupplierPayableCents: record.netSupplierPayableCents, fundsMoved: false,
          }), now, batchId,
        ),
        db.prepare(`INSERT INTO exchange_command_receipts (
          actor_id, idempotency_key, payload_hash, command_type, entity_id, response_json, created_at
        ) SELECT ?, ?, ?, 'TEST_RECORD_SETTLEMENT', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM exchange_ledger_batches WHERE id = ?)`).bind(
          context.actorId, context.idempotencyKey, context.payloadHash, settlementId,
          JSON.stringify(record), now, batchId,
        ),
        d1InvariantGuard(db, `
          (SELECT COUNT(*) FROM exchange_ledger_batches WHERE id = ? AND settlement_id = ?
            AND entry_count = ? AND debit_total_cents = ? AND credit_total_cents = ?
            AND funds_moved = 0) = 1
          AND (SELECT COUNT(*) FROM exchange_ledger_entries WHERE batch_id = ?) = ?
          AND (SELECT COALESCE(SUM(CASE WHEN side = 'DEBIT' THEN amount_cents ELSE 0 END), 0)
            FROM exchange_ledger_entries WHERE batch_id = ?) = ?
          AND (SELECT COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_cents ELSE 0 END), 0)
            FROM exchange_ledger_entries WHERE batch_id = ?) = ?
          AND (SELECT COUNT(*) FROM exchange_settlements WHERE id = ? AND status = 'TEST_RECORDED'
            AND funds_moved = 0 AND ledger_batch_id = ? AND version = ?) = 1
          AND (SELECT COUNT(*) FROM exchange_commission_accruals WHERE settlement_id = ?) = ?
          AND (? = 0 OR EXISTS (SELECT 1 FROM exchange_commission_accruals commission
            WHERE commission.id = ? AND commission.order_id = ? AND commission.attribution_id = ?
              AND commission.agent_actor_id = ? AND commission.environment = 'TEST'
              AND commission.record_kind = 'ESTIMATE_ONLY' AND commission.funds_moved = 0
              AND commission.commission_base_cents = ? AND commission.commission_rate_basis_points = 300
              AND commission.commission_estimate_cents = ?))
          AND (SELECT COUNT(*) FROM exchange_domain_events WHERE entity_id = ?
            AND event_type = 'TEST_SETTLEMENT_RECORDED') = 1
          AND (SELECT COUNT(*) FROM exchange_command_receipts
            WHERE actor_id = ? AND idempotency_key = ? AND entity_id = ?
              AND command_type = 'TEST_RECORD_SETTLEMENT') = 1`,
        batchId, settlementId, 1 + creditEntries.length, current.gross_amount_cents, current.gross_amount_cents,
        batchId, 1 + creditEntries.length, batchId, current.gross_amount_cents,
        batchId, current.gross_amount_cents, settlementId, batchId, current.version + 1,
        settlementId, commission ? 1 : 0, commission ? 1 : 0,
        commission?.id ?? "", current.order_id, commission?.attribution_id ?? "",
        commission?.agent_actor_id ?? "", current.gross_amount_cents,
        commission?.commission_estimate_cents ?? 0,
        settlementId, context.actorId, context.idempotencyKey, settlementId),
      ];
      let results: Array<D1Result<unknown>>;
      try {
        results = await db.batch(statements);
      } catch (error) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_RECORD_SETTLEMENT", entityId: settlementId });
          return { record: await projectSettlementAfterSnapshot(settlementId), replayed: true };
        }
        const concurrentBatch = await db.prepare("SELECT id FROM exchange_ledger_batches WHERE settlement_id = ?")
          .bind(settlementId).first<{ id: string }>();
        if (concurrentBatch) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算已经记录，请刷新后重试。");
        throw error;
      }
      if (results.slice(0, -1).some((result) => changes(result) !== 1)) {
        const concurrent = await readD1CommandReceipt(db, context.actorId, context.idempotencyKey);
        if (concurrent) {
          validateD1CommandReceipt(concurrent, { payloadHash: context.payloadHash, commandType: "TEST_RECORD_SETTLEMENT", entityId: settlementId });
          return { record: await projectSettlementAfterSnapshot(settlementId), replayed: true };
        }
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "测试结算状态已变化，请刷新后重试。");
      }
      return { record: await projectSettlementAfterSnapshot(settlementId), replayed: false };
    },
  };
}
