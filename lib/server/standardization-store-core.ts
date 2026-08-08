import { STANDARDIZATION_SCHEMA_VERSION, standardizationSchemaStatements } from "../../db/standardization-schema.ts";
import {
  KAI_SCH_POLICY,
  STANDARDIZATION_PRODUCTS,
  STANDARDIZATION_PRODUCT_VERSIONS,
  StandardizationIdempotencyError,
  StandardizationInputError,
  StandardizationSnapshotConflictError,
  baseUnitsToNativeDecimal,
  deriveKaiSchMicros,
  microKaiToDecimal,
  nearestRankQuartiles,
  parseAppendStandardizationSnapshot,
  sampleIsIndexEligible,
  unavailableQuoteEnvelope,
  type AppendStandardizationSnapshot,
  type KaiHoursAccountEnvelope,
  type KaiStandardQuote,
  type KaiStandardQuoteEnvelope,
  type StandardizationMutationContext,
  type StandardizationProductCode,
  type StandardizationSample,
} from "../standardization.ts";
import type { StandardizationStore } from "./standardization-store.ts";

export type StandardizationSql = Readonly<{ sql: string; values?: readonly unknown[] }>;

export interface StandardizationDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(statements: readonly StandardizationSql[]): Promise<ReadonlyArray<{ changes: number }>>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

type Row = Record<string, unknown>;

type CapacityRow = {
  product_code: StandardizationProductCode;
  product_version_id: string;
  region: string;
  price_basis_base_units: number;
  deposited_base_units: number;
  available_base_units: number;
  held_base_units: number;
  consumed_base_units: number;
};

function stringValue(row: Row, field: string) {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`STANDARDIZATION_INVARIANT:${field}`);
  return value;
}

function numberValue(row: Row, field: string) {
  const value = Number(row[field]);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`STANDARDIZATION_INVARIANT:${field}`);
  return value;
}

async function digest(value: unknown) {
  const data = new TextEncoder().encode(JSON.stringify(value));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function id(prefix: "BATCH" | "QUOTE" | "AUDIT") {
  return `KAI-SCH-${prefix}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
}

function exclusionReason(sample: StandardizationSample, asOf: string) {
  if (sample.sourceSystem === "SUPPLY_PILOT") return "SUPPLY_PILOT" as const;
  if (sample.promotional) return "PROMOTIONAL" as const;
  if (!sample.marketIndexEligible) return "NOT_INDEX_ELIGIBLE" as const;
  if (!sampleIsIndexEligible(sample, asOf)) return "STALE_SAMPLE" as const;
  return null;
}

function groupKey(sample: StandardizationSample) {
  return `${sample.productCode}\u0000${sample.productVersionId}\u0000${sample.region}`;
}

function status(expiresAt: string, at: Date) {
  return Date.parse(expiresAt) <= at.getTime() ? "STALE" as const : "CURRENT" as const;
}

function quoteEnvelope(batch: Row, quotes: readonly Row[], at: Date): KaiStandardQuoteEnvelope {
  const snapshotStatus = status(stringValue(batch, "expires_at"), at);
  return {
    policy: {
      version: KAI_SCH_POLICY.version,
      unitCode: KAI_SCH_POLICY.unitCode,
      benchmarkLabel: KAI_SCH_POLICY.benchmarkLabel,
    },
    snapshot: {
      asOf: stringValue(batch, "as_of"),
      expiresAt: stringValue(batch, "expires_at"),
      status: snapshotStatus,
      p25CnyMicros: stringValue(batch, "benchmark_p25_cny_micros"),
      p50CnyMicros: stringValue(batch, "benchmark_p50_cny_micros"),
      p75CnyMicros: stringValue(batch, "benchmark_p75_cny_micros"),
      sampleCount: numberValue(batch, "benchmark_sample_count"),
    },
    quotes: quotes.map((row): KaiStandardQuote => ({
      productCode: stringValue(row, "product_code") as StandardizationProductCode,
      productVersionId: stringValue(row, "product_version_id"),
      productLabel: stringValue(row, "product_label"),
      nativeUnitCode: stringValue(row, "native_unit_code"),
      nativeUnitLabel: stringValue(row, "native_unit_label"),
      region: stringValue(row, "region"),
      p25KaiSch: microKaiToDecimal(BigInt(stringValue(row, "p25_kai_sch_micros"))),
      p50KaiSch: microKaiToDecimal(BigInt(stringValue(row, "p50_kai_sch_micros"))),
      p75KaiSch: microKaiToDecimal(BigInt(stringValue(row, "p75_kai_sch_micros"))),
      sampleCount: numberValue(row, "sample_count"),
      asOf: stringValue(row, "as_of"),
      expiresAt: stringValue(row, "expires_at"),
      policyVersion: stringValue(row, "policy_version"),
    })),
  };
}

async function tableExists(db: StandardizationDatabaseAdapter, table: string) {
  return Boolean(await db.first("SELECT 1 AS present FROM sqlite_master WHERE type='table' AND name=?", [table]));
}

function zeroAccount(envelope: KaiStandardQuoteEnvelope): KaiHoursAccountEnvelope {
  return {
    policyVersion: envelope.policy.version,
    asOf: envelope.snapshot.asOf,
    expiresAt: envelope.snapshot.expiresAt,
    status: envelope.snapshot.status,
    summary: {
      depositedKaiSch: "0.000000",
      availableKaiSch: "0.000000",
      earnedKaiSch: "0.000000",
      settlementCnyCents: "0",
    },
    positions: [],
    income: { pendingCnyCents: "0", payableCnyCents: "0", settledCnyCents: "0" },
  };
}

export async function createStandardizationStore(
  db: StandardizationDatabaseAdapter,
  clock: () => Date = () => new Date(),
): Promise<StandardizationStore> {
  await db.ensureSchema(standardizationSchemaStatements, STANDARDIZATION_SCHEMA_VERSION);

  const store: StandardizationStore = {
    async appendSnapshot(context: StandardizationMutationContext, input: AppendStandardizationSnapshot) {
      if (typeof context.reason !== "string" || context.reason.trim().length < 8 || context.reason.trim().length > 500) {
        throw new StandardizationInputError("发布原因必须为 8 至 500 个字符。", "reason");
      }
      const snapshotInput = parseAppendStandardizationSnapshot(input);
      const prior = await db.first<Row>(
        "SELECT payload_hash,batch_id FROM standardization_command_receipts WHERE actor_id=? AND idempotency_key=?",
        [context.actorId, context.idempotencyKey],
      );
      if (prior) {
        if (stringValue(prior, "payload_hash") !== context.payloadHash) throw new StandardizationIdempotencyError();
        const batch = await db.first<Row>("SELECT * FROM standardization_snapshot_batches WHERE id=?", [stringValue(prior, "batch_id")]);
        if (!batch) throw new Error("STANDARDIZATION_INVARIANT:REPLAY_BATCH_MISSING");
        const rows = await db.all<Row>("SELECT * FROM standardization_quote_snapshots WHERE batch_id=? ORDER BY product_code,product_version_id,region", [stringValue(prior, "batch_id")]);
        return { record: quoteEnvelope(batch, rows, clock()), replayed: true };
      }

      if (Date.parse(snapshotInput.asOf) > clock().getTime() + 5 * 60_000) {
        throw new StandardizationInputError("行情快照时间不能位于未来。", "asOf");
      }
      const eligible = snapshotInput.samples.filter((sample) => exclusionReason(sample, snapshotInput.asOf) === null);
      const benchmarkSamples = eligible.filter((sample) => sample.benchmark);
      if (benchmarkSamples.length < KAI_SCH_POLICY.minSampleCount) {
        throw new StandardizationInputError("基准有效样本不足，不能发布快照。", "samples");
      }
      const benchmark = nearestRankQuartiles(benchmarkSamples.map((sample) => BigInt(sample.unitPriceCnyMicros)));
      const groups = new Map<string, StandardizationSample[]>();
      for (const sample of eligible.filter((item) => !item.benchmark)) {
        const key = groupKey(sample);
        const values = groups.get(key) ?? [];
        values.push(sample);
        groups.set(key, values);
      }
      const validGroups = [...groups.values()].filter((items) => items.length >= KAI_SCH_POLICY.minSampleCount);
      const batchId = id("BATCH");
      const createdAt = clock().toISOString();
      const publishReason = context.reason.trim();
      const batchDigest = await digest({
        policyVersion: KAI_SCH_POLICY.version,
        input: snapshotInput,
        publishReason,
        eligibleSampleIds: eligible.map((sample) => sample.sampleId),
      });
      const excludedPromotional = snapshotInput.samples.filter((sample) => sample.promotional || sample.sourceSystem === "SUPPLY_PILOT").length;
      const statements: StandardizationSql[] = [{
        sql: `INSERT INTO standardization_snapshot_batches (
          id,policy_version,actor_id,idempotency_key,payload_hash,as_of,expires_at,
          publish_reason,
          benchmark_p25_cny_micros,benchmark_p50_cny_micros,benchmark_p75_cny_micros,
          benchmark_sample_count,source_sample_count,promotional_excluded_count,snapshot_digest,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        values: [batchId, KAI_SCH_POLICY.version, context.actorId, context.idempotencyKey, context.payloadHash,
          snapshotInput.asOf, snapshotInput.expiresAt, publishReason,
          benchmark.p25.toString(), benchmark.p50.toString(), benchmark.p75.toString(),
          benchmarkSamples.length, snapshotInput.samples.length, excludedPromotional, batchDigest, createdAt],
      }];
      for (const sample of snapshotInput.samples) {
        const reason = exclusionReason(sample, snapshotInput.asOf);
        statements.push({
          sql: `INSERT INTO standardization_samples (
            batch_id,sample_id,product_code,product_version_id,region,unit_price_cny_micros,is_benchmark,promotional,
            market_index_eligible,source_system,included_in_index,exclusion_reason,observed_at,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          values: [batchId, sample.sampleId, sample.productCode, sample.productVersionId, sample.region, sample.unitPriceCnyMicros,
            Number(sample.benchmark), Number(sample.promotional), Number(sample.marketIndexEligible), sample.sourceSystem,
            Number(reason === null), reason, sample.observedAt, createdAt],
        });
      }
      for (const items of validGroups) {
        const first = items[0]!;
        const product = STANDARDIZATION_PRODUCTS[first.productCode];
        const productVersion = STANDARDIZATION_PRODUCT_VERSIONS[first.productVersionId as keyof typeof STANDARDIZATION_PRODUCT_VERSIONS];
        if (!productVersion || productVersion.productCode !== first.productCode) {
          throw new StandardizationInputError("产品版本不在受控目录中。", "samples");
        }
        const prices = nearestRankQuartiles(items.map((sample) => BigInt(sample.unitPriceCnyMicros)));
        const standard = {
          p25: deriveKaiSchMicros({ nativeCapacityBaseUnits: product.priceBasisBaseUnits, nativePriceBasisBaseUnits: product.priceBasisBaseUnits, nativeIndexPriceCnyMicros: prices.p25, benchmarkP50CnyMicros: benchmark.p50 }),
          p50: deriveKaiSchMicros({ nativeCapacityBaseUnits: product.priceBasisBaseUnits, nativePriceBasisBaseUnits: product.priceBasisBaseUnits, nativeIndexPriceCnyMicros: prices.p50, benchmarkP50CnyMicros: benchmark.p50 }),
          p75: deriveKaiSchMicros({ nativeCapacityBaseUnits: product.priceBasisBaseUnits, nativePriceBasisBaseUnits: product.priceBasisBaseUnits, nativeIndexPriceCnyMicros: prices.p75, benchmarkP50CnyMicros: benchmark.p50 }),
        };
        const quoteId = id("QUOTE");
        const quoteDigest = await digest({
          batchDigest,
          productCode: first.productCode,
          productVersionId: first.productVersionId,
          region: first.region,
          prices: { p25: prices.p25.toString(), p50: prices.p50.toString(), p75: prices.p75.toString() },
          standard: { p25: standard.p25.toString(), p50: standard.p50.toString(), p75: standard.p75.toString() },
          sampleIds: items.map((sample) => sample.sampleId),
        });
        const promotionalExcludedCount = snapshotInput.samples.filter((sample) => groupKey(sample) === groupKey(first)
          && (sample.promotional || sample.sourceSystem === "SUPPLY_PILOT")).length;
        statements.push({
          sql: `INSERT INTO standardization_quote_snapshots (
            id,batch_id,policy_version,product_code,product_version_id,product_label,native_unit_code,native_unit_label,region,
            p25_cny_micros,p50_cny_micros,p75_cny_micros,p25_kai_sch_micros,p50_kai_sch_micros,p75_kai_sch_micros,
            sample_count,promotional_excluded_count,as_of,expires_at,snapshot_digest,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          values: [quoteId, batchId, KAI_SCH_POLICY.version, first.productCode, first.productVersionId, productVersion.productLabel,
            product.nativeUnitCode, product.nativeUnitLabel, first.region,
            prices.p25.toString(), prices.p50.toString(), prices.p75.toString(),
            standard.p25.toString(), standard.p50.toString(), standard.p75.toString(),
            items.length, promotionalExcludedCount, snapshotInput.asOf, snapshotInput.expiresAt, quoteDigest, createdAt],
        });
      }
      statements.push({
        sql: `INSERT INTO standardization_audit_events(
          id,batch_id,actor_id,event_type,reason,payload_hash,occurred_at
        ) VALUES(?,?,?,?,?,?,?)`,
        values: [id("AUDIT"), batchId, context.actorId, "SNAPSHOT_PUBLISHED", publishReason, context.payloadHash, createdAt],
      });
      statements.push({
        sql: "INSERT INTO standardization_command_receipts(actor_id,idempotency_key,payload_hash,batch_id,created_at) VALUES(?,?,?,?,?)",
        values: [context.actorId, context.idempotencyKey, context.payloadHash, batchId, createdAt],
      });
      try {
        await db.batch(statements);
      } catch (error) {
        // Two publishers may both pass the read preflight. Resolve only the
        // domain conflicts we can prove after the atomic write loses its race;
        // every other database failure remains internal and undisclosed.
        const concurrentReceipt = await db.first<Row>(
          "SELECT payload_hash,batch_id FROM standardization_command_receipts WHERE actor_id=? AND idempotency_key=?",
          [context.actorId, context.idempotencyKey],
        );
        if (concurrentReceipt) {
          if (stringValue(concurrentReceipt, "payload_hash") !== context.payloadHash) {
            throw new StandardizationIdempotencyError();
          }
          const concurrentBatch = await db.first<Row>(
            "SELECT * FROM standardization_snapshot_batches WHERE id=?",
            [stringValue(concurrentReceipt, "batch_id")],
          );
          if (!concurrentBatch) throw new Error("STANDARDIZATION_INVARIANT:CONCURRENT_REPLAY_BATCH_MISSING");
          const concurrentRows = await db.all<Row>(
            "SELECT * FROM standardization_quote_snapshots WHERE batch_id=? ORDER BY product_code,product_version_id,region",
            [stringValue(concurrentReceipt, "batch_id")],
          );
          return { record: quoteEnvelope(concurrentBatch, concurrentRows, clock()), replayed: true };
        }
        const occupiedSnapshot = await db.first<Row>(
          "SELECT id FROM standardization_snapshot_batches WHERE policy_version=? AND as_of=?",
          [KAI_SCH_POLICY.version, snapshotInput.asOf],
        );
        if (occupiedSnapshot) throw new StandardizationSnapshotConflictError();
        throw error;
      }
      const batch = await db.first<Row>("SELECT * FROM standardization_snapshot_batches WHERE id=?", [batchId]);
      if (!batch) throw new Error("STANDARDIZATION_INVARIANT:BATCH_WRITE_MISSING");
      const rows = await db.all<Row>("SELECT * FROM standardization_quote_snapshots WHERE batch_id=? ORDER BY product_code,product_version_id,region", [batchId]);
      return { record: quoteEnvelope(batch, rows, clock()), replayed: false };
    },

    async getQuotes(at = clock()) {
      const batch = await db.first<Row>(
        "SELECT * FROM standardization_snapshot_batches WHERE policy_version=? AND as_of<=? ORDER BY as_of DESC LIMIT 1",
        [KAI_SCH_POLICY.version, at.toISOString()],
      );
      if (!batch) return unavailableQuoteEnvelope(at);
      const rows = await db.all<Row>(
        "SELECT * FROM standardization_quote_snapshots WHERE batch_id=? ORDER BY product_code,product_version_id,region",
        [stringValue(batch, "id")],
      );
      return quoteEnvelope(batch, rows, at);
    },

    async getAccountProjection(organizationId: string, at = clock()) {
      const envelope = await store.getQuotes(at);
      if (envelope.snapshot.status === "UNAVAILABLE") return zeroAccount(envelope);
      if (!await tableExists(db, "exchange_capacity_lots") || !await tableExists(db, "admin_entity_ownership")) {
        return zeroAccount(envelope);
      }
      const rows = await db.all<CapacityRow>(`SELECT
          ra.product_code,
          ra.product_version_id,
          ra.region,
          policy.price_basis_base_units,
          SUM(lot.capacity_base_units) AS deposited_base_units,
          SUM(COALESCE(balance.available_base_units,0)) AS available_base_units,
          SUM(COALESCE(balance.held_base_units,0)) AS held_base_units,
          SUM(COALESCE(balance.consumed_base_units,0)) AS consumed_base_units
        FROM exchange_capacity_lots lot
        JOIN exchange_resource_assets ra ON ra.id=lot.resource_asset_id
        JOIN exchange_product_capacity_policies policy
          ON policy.product_version_id=ra.product_version_id AND policy.feature_status='ENABLED'
        JOIN admin_entity_ownership own
          ON own.source_system='EXCHANGE' AND own.entity_type='CAPACITY_LOT'
          AND own.entity_id=lot.id AND own.organization_id=?
        LEFT JOIN (
          SELECT capacity_lot_id,
            SUM(CASE WHEN to_bucket='AVAILABLE' THEN capacity_base_units ELSE 0 END)
              - SUM(CASE WHEN from_bucket='AVAILABLE' THEN capacity_base_units ELSE 0 END) AS available_base_units,
            SUM(CASE WHEN to_bucket IN ('HELD','LOCKED','IN_SERVICE') THEN capacity_base_units ELSE 0 END)
              - SUM(CASE WHEN from_bucket IN ('HELD','LOCKED','IN_SERVICE') THEN capacity_base_units ELSE 0 END) AS held_base_units,
            SUM(CASE WHEN to_bucket='CONSUMED' THEN capacity_base_units ELSE 0 END) AS consumed_base_units
          FROM exchange_capacity_transfers GROUP BY capacity_lot_id
        ) balance ON balance.capacity_lot_id=lot.id
        GROUP BY ra.product_code,ra.product_version_id,ra.region,policy.price_basis_base_units
        ORDER BY ra.product_code,ra.product_version_id,ra.region`, [organizationId]);
      if (rows.length === 0) return zeroAccount(envelope);

      const quoteRows = await db.all<Row>(`SELECT * FROM standardization_quote_snapshots
        WHERE batch_id=(SELECT id FROM standardization_snapshot_batches WHERE policy_version=? AND as_of<=? ORDER BY as_of DESC LIMIT 1)`,
      [KAI_SCH_POLICY.version, at.toISOString()]);
      const exact = new Map(quoteRows.map((row) => [
        `${stringValue(row, "product_code")}\u0000${stringValue(row, "product_version_id")}\u0000${stringValue(row, "region")}`,
        row,
      ]));
      const nationwide = new Map(quoteRows.filter((row) => stringValue(row, "region") === "全国")
        .map((row) => [`${stringValue(row, "product_code")}\u0000${stringValue(row, "product_version_id")}`, row]));
      let deposited = BigInt(0);
      let available = BigInt(0);
      const positions: KaiHoursAccountEnvelope["positions"] extends ReadonlyArray<infer T> ? T[] : never = [];
      for (const row of rows) {
        if (!(row.product_code in STANDARDIZATION_PRODUCTS)
          || !Number.isSafeInteger(row.price_basis_base_units) || row.price_basis_base_units <= 0
          || ![row.deposited_base_units, row.available_base_units, row.held_base_units, row.consumed_base_units]
            .every((value) => Number.isSafeInteger(value) && value >= 0)) {
          throw new Error("STANDARDIZATION_INVARIANT:CAPACITY_PROJECTION_INVALID");
        }
        const quote = exact.get(`${row.product_code}\u0000${row.product_version_id}\u0000${row.region}`)
          ?? nationwide.get(`${row.product_code}\u0000${row.product_version_id}`);
        if (!quote) return zeroAccount({ ...envelope, snapshot: { ...envelope.snapshot, status: "UNAVAILABLE" } });
        const benchmarkP50 = BigInt(envelope.snapshot.p50CnyMicros!);
        const nativeP50 = BigInt(stringValue(quote, "p50_cny_micros"));
        const basis = BigInt(row.price_basis_base_units);
        const convert = (baseUnits: number) => deriveKaiSchMicros({
          nativeCapacityBaseUnits: BigInt(baseUnits),
          nativePriceBasisBaseUnits: basis,
          nativeIndexPriceCnyMicros: nativeP50,
          benchmarkP50CnyMicros: benchmarkP50,
        });
        const depositedValue = convert(row.deposited_base_units);
        const availableValue = convert(row.available_base_units);
        const heldValue = convert(row.held_base_units);
        deposited += depositedValue;
        available += availableValue;
        const product = STANDARDIZATION_PRODUCTS[row.product_code];
        const productVersion = STANDARDIZATION_PRODUCT_VERSIONS[row.product_version_id as keyof typeof STANDARDIZATION_PRODUCT_VERSIONS];
        if (!productVersion || productVersion.productCode !== row.product_code) {
          throw new Error("STANDARDIZATION_INVARIANT:PRODUCT_VERSION_UNCONTROLLED");
        }
        positions.push({
          productCode: row.product_code,
          productVersionId: row.product_version_id,
          productLabel: productVersion.productLabel,
          nativeAmount: baseUnitsToNativeDecimal(BigInt(row.deposited_base_units), basis),
          nativeUnitLabel: product.nativeUnitLabel,
          availableKaiSch: microKaiToDecimal(availableValue),
          heldKaiSch: microKaiToDecimal(heldValue),
        });
      }
      return {
        policyVersion: envelope.policy.version,
        asOf: envelope.snapshot.asOf,
        expiresAt: envelope.snapshot.expiresAt,
        status: envelope.snapshot.status,
        summary: {
          depositedKaiSch: microKaiToDecimal(deposited),
          availableKaiSch: microKaiToDecimal(available),
          // Completed native service is not income. KAI-SCH earnings require a
          // LIVE accepted settlement plus its immutable order-time snapshot.
          earnedKaiSch: "0.000000",
          settlementCnyCents: "0",
        },
        positions,
        income: { pendingCnyCents: "0", payableCnyCents: "0", settledCnyCents: "0" },
      };
    },
  };
  return store;
}
