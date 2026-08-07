import { supplySchemaStatements, SUPPLY_SCHEMA_VERSION } from "../../db/supply-schema.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError } from "./exchange-errors.ts";
import {
  fail,
  type AgentEnrollment,
  type AllocationBinding,
  type AvailabilityWindow,
  type ExchangeBinding,
  type MacInventoryItem,
  type PromotionPolicy,
  type SupplyAssetMember,
  type SupplyAssetPool,
  type SupplyComponent,
  type SupplyMutationContext,
  type SupplyPromotion,
  type SupplyOffer,
  type SupplyConnectionCheck,
  type SupplyTrialDelivery,
  type SupplyTrialOrder,
  type SupplyTrialPayment,
  type SupplyTrialPaymentEvent,
  type VerificationEvidence,
  type VerificationJob,
} from "./supply-domain.ts";
import type { SupplyStore } from "./supply-store.ts";

export type SupplySql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export type SupplyRunResult = Readonly<{ changes: number }>;

export interface SupplyDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(statements: readonly SupplySql[]): Promise<SupplyRunResult[]>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

type Row = Record<string, unknown>;

const nowIso = () => new Date().toISOString();
const newId = (prefix: string) => `KAI-${prefix}-${crypto.randomUUID().replaceAll("-", "").toUpperCase()}`;
const json = (value: unknown) => JSON.stringify(value);

function number(row: Row, key: string) {
  return Number(row[key]);
}

function pool(row: Row): SupplyAssetPool {
  return {
    id: String(row.id), supplierActorId: String(row.supplier_actor_id), externalRef: String(row.external_ref),
    assetKind: row.asset_kind as SupplyAssetPool["assetKind"], name: String(row.name), region: String(row.region),
    deliveryForm: String(row.delivery_form), specDigest: String(row.spec_digest), status: row.status as SupplyAssetPool["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function offer(row: Row): SupplyOffer {
  return {
    id: String(row.id), supplierActorId: String(row.supplier_actor_id),
    supplierType: row.supplier_type as SupplyOffer["supplierType"], resourceType: row.resource_type as SupplyOffer["resourceType"],
    quantity: number(row, "quantity"), quantityUnit: row.quantity_unit as SupplyOffer["quantityUnit"], pricingUnit: row.pricing_unit as SupplyOffer["pricingUnit"],
    productName: String(row.product_name), specification: String(row.specification), region: String(row.region), deliveryForm: String(row.delivery_form),
    availabilityStartAt: row.availability_start_at == null ? null : String(row.availability_start_at),
    availabilityEndAt: row.availability_end_at == null ? null : String(row.availability_end_at),
    notes: row.notes == null ? null : String(row.notes), status: row.status as SupplyOffer["status"], version: number(row, "version"),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function policy(row: Row): PromotionPolicy {
  return {
    poolId: String(row.pool_id), publicationMode: row.publication_mode as PromotionPolicy["publicationMode"],
    unitPriceMicrosPerGpuHour: row.unit_price_micros_gpu_hour == null ? null : number(row, "unit_price_micros_gpu_hour"),
    gpuCountPerNode: row.gpu_count_per_node == null ? null : number(row, "gpu_count_per_node"),
    maxOrderHours: number(row, "max_order_hours"), maxBuyerNodeHours: number(row, "max_buyer_node_hours"),
    maxTotalNodeHours: number(row, "max_total_node_hours"), sshExclusiveRequired: Boolean(row.ssh_exclusive_required),
  };
}

function member(row: Row): SupplyAssetMember {
  return {
    id: String(row.id), poolId: String(row.pool_id), supplierActorId: String(row.supplier_actor_id),
    externalRef: String(row.external_ref), serialDigest: String(row.serial_digest),
    hardwareUuidDigest: row.hardware_uuid_digest == null ? null : String(row.hardware_uuid_digest),
    specDigest: String(row.spec_digest), status: row.status as SupplyAssetMember["status"],
    lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
    verifiedUntil: row.verified_until == null ? null : String(row.verified_until),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function component(row: Row): SupplyComponent {
  return {
    id: String(row.id), memberId: String(row.member_id), componentType: row.component_type as SupplyComponent["componentType"],
    identityDigest: String(row.identity_digest), model: String(row.model),
    memoryGiB: row.memory_gib == null ? null : number(row, "memory_gib"),
    topologyGroup: row.topology_group == null ? null : String(row.topology_group),
    specs: JSON.parse(String(row.specs_json)) as Record<string, unknown>, status: row.status as SupplyComponent["status"],
  };
}

function enrollment(row: Row): AgentEnrollment {
  return {
    id: String(row.id), memberId: String(row.member_id), supplierActorId: String(row.supplier_actor_id),
    publicKeyDigest: String(row.public_key_digest), status: row.status as AgentEnrollment["status"],
    enrolledAt: String(row.enrolled_at), lastSeenAt: row.last_seen_at == null ? null : String(row.last_seen_at),
  };
}

function verificationJob(row: Row): VerificationJob {
  return {
    id: String(row.id), poolId: String(row.pool_id), memberId: String(row.member_id), requestedBy: String(row.requested_by),
    reviewedBy: row.reviewed_by == null ? null : String(row.reviewed_by), status: row.status as VerificationJob["status"],
    validUntil: row.valid_until == null ? null : String(row.valid_until), createdAt: String(row.created_at),
    completedAt: row.completed_at == null ? null : String(row.completed_at),
  };
}

function evidence(row: Row): VerificationEvidence {
  return {
    id: String(row.id), jobId: String(row.job_id), evidenceType: String(row.evidence_type),
    payloadDigest: String(row.payload_digest), summary: String(row.summary), observedAt: String(row.observed_at), createdAt: String(row.created_at),
  };
}

function window(row: Row): AvailabilityWindow {
  return {
    id: String(row.id), poolId: String(row.pool_id), memberId: String(row.member_id), supplierActorId: String(row.supplier_actor_id),
    startAt: String(row.start_at), endAt: String(row.end_at), status: row.status as AvailabilityWindow["status"], createdAt: String(row.created_at),
  };
}

function promotion(row: Row): SupplyPromotion {
  return {
    id: String(row.id), poolId: String(row.pool_id), memberId: String(row.member_id),
    availabilityWindowId: String(row.availability_window_id), status: row.status as SupplyPromotion["status"],
    unitPriceMicrosPerGpuHour: number(row, "unit_price_micros_gpu_hour"), gpuCount: 8,
    startAt: String(row.start_at), endAt: String(row.end_at), nodeHours: number(row, "node_hours"), createdAt: String(row.created_at),
  };
}

function trialOrder(row: Row): SupplyTrialOrder {
  return {
    id: String(row.id), promotionId: String(row.promotion_id), allocationBindingId: String(row.allocation_binding_id),
    buyerActorId: String(row.buyer_actor_id), supplierActorId: String(row.supplier_actor_id), memberId: String(row.member_id),
    startAt: String(row.start_at), endAt: String(row.end_at), durationHours: number(row, "duration_hours"), gpuCount: 8,
    unitPriceMicrosPerGpuHour: 1_000_000, amountCents: number(row, "amount_cents"), currency: "CNY",
    status: row.status as SupplyTrialOrder["status"], expiresAt: String(row.expires_at), version: number(row, "version"),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function allocation(row: Row): AllocationBinding {
  return {
    id: String(row.id), promotionId: String(row.promotion_id), memberId: String(row.member_id), buyerActorId: String(row.buyer_actor_id),
    trialOrderId: String(row.trial_order_id), startAt: String(row.start_at), endAt: String(row.end_at), nodeHours: number(row, "node_hours"),
    status: row.status as AllocationBinding["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function payment(row: Row): SupplyTrialPayment {
  return {
    orderId: String(row.order_id), status: row.status as SupplyTrialPayment["status"], provider: String(row.provider),
    providerOrderRef: String(row.provider_order_ref), providerTransactionRef: row.provider_transaction_ref == null ? null : String(row.provider_transaction_ref),
    version: number(row, "version"), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function paymentEvent(row: Row): SupplyTrialPaymentEvent {
  return {
    id: String(row.id), orderId: String(row.order_id), provider: String(row.provider), providerEventRef: String(row.provider_event_ref),
    providerTransactionRef: row.provider_transaction_ref == null ? null : String(row.provider_transaction_ref), eventType: String(row.event_type),
    operation: row.operation as SupplyTrialPaymentEvent["operation"],
    amountCents: number(row, "amount_cents"), payloadDigest: String(row.payload_digest), outcome: row.outcome as SupplyTrialPaymentEvent["outcome"],
    resultingStatus: row.resulting_status as SupplyTrialPaymentEvent["resultingStatus"],
    occurredAt: String(row.occurred_at), receivedAt: String(row.received_at),
  };
}

function delivery(row: Row): SupplyTrialDelivery {
  return {
    orderId: String(row.order_id), status: row.status as SupplyTrialDelivery["status"],
    buyerPublicKeyFingerprint: row.buyer_public_key_fingerprint == null ? null : String(row.buyer_public_key_fingerprint),
    secureEndpointRef: row.secure_endpoint_ref == null ? null : String(row.secure_endpoint_ref),
    hostKeyFingerprint: row.host_key_fingerprint == null ? null : String(row.host_key_fingerprint),
    credentialExpiresAt: row.credential_expires_at == null ? null : String(row.credential_expires_at),
    cleanupEvidenceDigest: row.cleanup_evidence_digest == null ? null : String(row.cleanup_evidence_digest),
    version: number(row, "version"), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function connectionCheck(row: Row): SupplyConnectionCheck {
  return {
    id: String(row.id), orderId: String(row.order_id), status: row.status as SupplyConnectionCheck["status"],
    diagnosticCode: String(row.diagnostic_code), evidenceDigest: row.evidence_digest == null ? null : String(row.evidence_digest),
    startedAt: String(row.started_at), finishedAt: row.finished_at == null ? null : String(row.finished_at),
  };
}

function supplyError(code: string, status: 403 | 404 | 409 | 410 | 422, message: string) {
  return new ExchangeDomainError(code as never, status, message);
}

async function receipt<T>(db: SupplyDatabaseAdapter, context: SupplyMutationContext, command: string) {
  const row = await db.first<Row>("SELECT * FROM supply_command_receipts WHERE actor_id = ? AND idempotency_key = ?", [context.actorId, context.idempotencyKey]);
  if (!row) return null;
  if (String(row.payload_hash) !== context.payloadHash || String(row.command_type) !== command) throw new ExchangeIdempotencyConflictError();
  return JSON.parse(String(row.response_json)) as T;
}

function receiptSql(context: SupplyMutationContext, command: string, response: unknown, createdAt: string): SupplySql {
  return {
    sql: `INSERT INTO supply_command_receipts (actor_id,idempotency_key,payload_hash,command_type,response_json,created_at)
      VALUES (?,?,?,?,?,?)`,
    values: [context.actorId, context.idempotencyKey, context.payloadHash, command, json(response), createdAt],
  };
}

function invariantSql(predicate: string, values: readonly unknown[] = []): SupplySql {
  return {
    sql: `SELECT CASE WHEN (${predicate}) THEN 1 ELSE abs(-9223372036854775808) END AS invariant_ok`,
    values,
  };
}

async function ownedPool(db: SupplyDatabaseAdapter, actorId: string, poolId: string) {
  const row = await db.first<Row>("SELECT * FROM supply_asset_pools WHERE id = ? AND supplier_actor_id = ?", [poolId, actorId]);
  if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "资产池不存在或不属于当前供应方。");
  return pool(row);
}

async function getPolicy(db: SupplyDatabaseAdapter, poolId: string) {
  const row = await db.first<Row>("SELECT * FROM supply_promotion_policies WHERE pool_id = ?", [poolId]);
  if (!row) throw new Error("SUPPLY_INVARIANT:POLICY_MISSING");
  return policy(row);
}

function nodeHours(startAt: string, endAt: string) {
  const milliseconds = Date.parse(endAt) - Date.parse(startAt);
  if (milliseconds <= 0 || milliseconds % 3_600_000 !== 0) fail("H100 试运行时间窗必须使用整小时。", 422);
  return milliseconds / 3_600_000;
}

function h100EvidenceValid(components: SupplyComponent[], records: VerificationEvidence[]) {
  const gpus = components.filter((item) => item.componentType === "GPU");
  const topology = new Set(gpus.map((item) => item.topologyGroup));
  const evidenceTypes = new Set(records.map((item) => item.evidenceType));
  return gpus.length === 8
    && new Set(gpus.map((item) => item.identityDigest)).size === 8
    && gpus.every((item) => /H100/i.test(item.model) && /SXM5/i.test(item.model) && item.memoryGiB === 80 && item.topologyGroup)
    && topology.size === 1
    && ["GPU_INVENTORY", "GPU_TOPOLOGY", "GPU_BURN_IN", "SSH_CONNECTIVITY"].every((type) => evidenceTypes.has(type));
}

function macEvidenceValid(records: VerificationEvidence[]) {
  const evidenceTypes = new Set(records.map((item) => item.evidenceType));
  return ["MAC_SYSTEM_PROFILE", "AGENT_HEARTBEAT", "REMOTE_ACCESS"].every((type) => evidenceTypes.has(type));
}

export async function createSupplyStore(db: SupplyDatabaseAdapter): Promise<SupplyStore> {
  await db.ensureSchema(supplySchemaStatements, SUPPLY_SCHEMA_VERSION);

  const store: SupplyStore = {
    async listOffers(actorId) {
      return (await db.all<Row>("SELECT * FROM supply_offers WHERE supplier_actor_id=? ORDER BY created_at DESC,id DESC", [actorId])).map(offer);
    },

    async createOffer(context, input) {
      const replay = await receipt<SupplyOffer>(db, context, "CREATE_SUPPLY_OFFER");
      if (replay) return { record: replay, replayed: true };
      const createdAt = nowIso();
      const record: SupplyOffer = {
        id: newId("SOF"), supplierActorId: context.actorId, ...input,
        status: "SUBMITTED", version: 1, createdAt, updatedAt: createdAt,
      };
      try {
        await db.batch([
          { sql: `INSERT INTO supply_offers (id,supplier_actor_id,idempotency_key,payload_hash,supplier_type,resource_type,quantity,quantity_unit,pricing_unit,product_name,specification,region,delivery_form,availability_start_at,availability_end_at,notes,status,version,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`, values: [record.id, context.actorId, context.idempotencyKey, context.payloadHash, record.supplierType, record.resourceType, record.quantity, record.quantityUnit, record.pricingUnit, record.productName, record.specification, record.region, record.deliveryForm, record.availabilityStartAt, record.availabilityEndAt, record.notes, record.status, createdAt, createdAt] },
          receiptSql(context, "CREATE_SUPPLY_OFFER", record, createdAt),
        ]);
      } catch {
        const existing = await db.first<Row>("SELECT * FROM supply_offers WHERE supplier_actor_id=? AND idempotency_key=?", [context.actorId, context.idempotencyKey]);
        if (existing) {
          const storedReceipt = await receipt<SupplyOffer>(db, context, "CREATE_SUPPLY_OFFER");
          if (storedReceipt) return { record: storedReceipt, replayed: true };
        }
        throw supplyError("SUPPLY_OFFER_CONFLICT", 409, "供给报价提交冲突，请更换幂等键后重试。");
      }
      return { record, replayed: false };
    },

    async listPools(actorId) {
      const rows = await db.all<Row>(`SELECT p.*, policy.*, 
        (SELECT COUNT(*) FROM supply_asset_members m WHERE m.pool_id=p.id) AS member_count,
        (SELECT COUNT(*) FROM supply_asset_members m WHERE m.pool_id=p.id AND m.status='VERIFIED' AND m.verified_until>?) AS verified_count
        FROM supply_asset_pools p JOIN supply_promotion_policies policy ON policy.pool_id=p.id
        WHERE p.supplier_actor_id=? ORDER BY p.created_at DESC`, [nowIso(), actorId]);
      return rows.map((row) => ({ pool: pool(row), policy: policy(row), memberCount: number(row, "member_count"), verifiedCount: number(row, "verified_count") }));
    },

    async getPool(actorId, poolId) {
      return { pool: await ownedPool(db, actorId, poolId), policy: await getPolicy(db, poolId) };
    },

    async createPool(context, input) {
      const replay = await receipt<{ pool: SupplyAssetPool; policy: PromotionPolicy }>(db, context, "CREATE_POOL");
      if (replay) return { record: replay, replayed: true };
      const createdAt = nowIso();
      const record: SupplyAssetPool = {
        id: newId("SP"), supplierActorId: context.actorId, externalRef: input.externalRef, assetKind: input.assetKind,
        name: input.name, region: input.region, deliveryForm: input.deliveryForm, specDigest: input.specDigest,
        status: "DRAFT", createdAt, updatedAt: createdAt,
      };
      const policyRecord: PromotionPolicy = input.assetKind === "H100_8X_NODE" ? {
        poolId: record.id, publicationMode: "H100_LIMITED_TRIAL", unitPriceMicrosPerGpuHour: 1_000_000,
        gpuCountPerNode: 8, maxOrderHours: 8, maxBuyerNodeHours: 8, maxTotalNodeHours: 80, sshExclusiveRequired: true,
      } : {
        poolId: record.id, publicationMode: "INVENTORY_ONLY", unitPriceMicrosPerGpuHour: null,
        gpuCountPerNode: null, maxOrderHours: 0, maxBuyerNodeHours: 0, maxTotalNodeHours: 0, sshExclusiveRequired: false,
      };
      const response = { pool: record, policy: policyRecord };
      await db.batch([
        { sql: `INSERT INTO supply_asset_pools VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, values: [record.id, context.actorId, context.idempotencyKey, context.payloadHash, record.externalRef, record.assetKind, record.name, record.region, record.deliveryForm, record.specDigest, record.status, createdAt, createdAt] },
        { sql: `INSERT INTO supply_promotion_policies VALUES (?,?,?,?,?,?,?,?,?)`, values: [record.id, policyRecord.publicationMode, policyRecord.unitPriceMicrosPerGpuHour, policyRecord.gpuCountPerNode, policyRecord.maxOrderHours, policyRecord.maxBuyerNodeHours, policyRecord.maxTotalNodeHours, Number(policyRecord.sshExclusiveRequired), createdAt] },
        receiptSql(context, "CREATE_POOL", response, createdAt),
      ]);
      return { record: response, replayed: false };
    },

    async listMembers(actorId, poolId) {
      await ownedPool(db, actorId, poolId);
      return (await db.all<Row>("SELECT * FROM supply_asset_members WHERE pool_id=? ORDER BY created_at", [poolId])).map(member);
    },

    async batchMembers(poolId, context, items) {
      const replay = await receipt<{ items: SupplyAssetMember[] }>(db, context, "BATCH_MEMBERS");
      if (replay) return { record: replay, replayed: true };
      const targetPool = await ownedPool(db, context.actorId, poolId);
      if (items.some((item) => item.specDigest !== targetPool.specDigest)) fail("成员规格摘要必须与资产池一致。", 422);
      const existing = await db.all<Row>(`SELECT * FROM supply_asset_members WHERE supplier_actor_id=? AND external_ref IN (${items.map(() => "?").join(",")})`, [context.actorId, ...items.map((item) => item.externalRef)]);
      const byRef = new Map(existing.map((row) => [String(row.external_ref), member(row)]));
      for (const item of items) {
        const current = byRef.get(item.externalRef);
        if (current && (current.poolId !== poolId || current.serialDigest !== item.serialDigest || current.specDigest !== item.specDigest)) {
          throw supplyError("SUPPLY_MEMBER_CONFLICT", 409, `资产 ${item.externalRef} 已使用不同身份或规格登记。`);
        }
      }
      const createdAt = nowIso();
      const records = items.map((item) => byRef.get(item.externalRef) ?? ({
        id: newId("SM"), poolId, supplierActorId: context.actorId, externalRef: item.externalRef,
        serialDigest: item.serialDigest, hardwareUuidDigest: item.hardwareUuidDigest, specDigest: item.specDigest,
        status: "DECLARED", lastSeenAt: null, verifiedUntil: null, createdAt, updatedAt: createdAt,
      } satisfies SupplyAssetMember));
      const inserts = records.filter((item) => !byRef.has(item.externalRef)).map((item): SupplySql => ({
        sql: `INSERT INTO supply_asset_members VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        values: [item.id, item.poolId, item.supplierActorId, item.externalRef, item.serialDigest, item.hardwareUuidDigest, item.specDigest, item.status, null, null, item.createdAt, item.updatedAt],
      }));
      const response = { items: records };
      await db.batch([...inserts, receiptSql(context, "BATCH_MEMBERS", response, createdAt)]);
      return { record: response, replayed: false };
    },

    async importMacInventory(context, items) {
      const replay = await receipt<{ groups: Array<{ pool: SupplyAssetPool; policy: PromotionPolicy; items: SupplyAssetMember[] }> }>(db, context, "IMPORT_MAC_INVENTORY");
      if (replay) return { record: replay, replayed: true };
      const existingRefs = await db.all<Row>(`SELECT * FROM supply_asset_members WHERE supplier_actor_id=? AND external_ref IN (${items.map(() => "?").join(",")})`, [context.actorId, ...items.map((item) => item.externalRef)]);
      const byRef = new Map(existingRefs.map((row) => [String(row.external_ref), member(row)]));
      for (const item of items) {
        const current = byRef.get(item.externalRef);
        if (current && (current.serialDigest !== item.serialDigest || current.specDigest !== item.specDigest)) {
          throw supplyError("SUPPLY_MEMBER_CONFLICT", 409, `Mac ${item.externalRef} 已使用不同身份或规格登记。`);
        }
      }
      const groups = new Map<string, MacInventoryItem[]>();
      for (const item of items) groups.set(item.specDigest, [...(groups.get(item.specDigest) ?? []), item]);
      const createdAt = nowIso();
      const responseGroups: Array<{ pool: SupplyAssetPool; policy: PromotionPolicy; items: SupplyAssetMember[] }> = [];
      const statements: SupplySql[] = [];
      for (const [specDigest, groupItems] of groups) {
        const firstItem = groupItems[0];
        const externalRef = `mac-group:${specDigest.slice(7, 23)}`;
        const poolRow = await db.first<Row>("SELECT * FROM supply_asset_pools WHERE supplier_actor_id=? AND external_ref=?", [context.actorId, externalRef]);
        const poolRecord = poolRow ? pool(poolRow) : {
          id: newId("SP"), supplierActorId: context.actorId, externalRef, assetKind: "MAC_MINI" as const,
          name: `${firstItem.model} ${firstItem.chip} ${firstItem.memoryGiB}GiB/${firstItem.storageGiB}GiB`,
          region: firstItem.region, deliveryForm: firstItem.deliveryForm, specDigest, status: "DRAFT" as const,
          createdAt, updatedAt: createdAt,
        };
        const policyRecord: PromotionPolicy = { poolId: poolRecord.id, publicationMode: "INVENTORY_ONLY", unitPriceMicrosPerGpuHour: null, gpuCountPerNode: null, maxOrderHours: 0, maxBuyerNodeHours: 0, maxTotalNodeHours: 0, sshExclusiveRequired: false };
        if (!poolRow) {
          statements.push({ sql: `INSERT INTO supply_asset_pools VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, values: [poolRecord.id, context.actorId, `${context.idempotencyKey}:${specDigest.slice(-12)}`, context.payloadHash, externalRef, "MAC_MINI", poolRecord.name, poolRecord.region, poolRecord.deliveryForm, specDigest, "DRAFT", createdAt, createdAt] });
          statements.push({ sql: `INSERT INTO supply_promotion_policies VALUES (?,?,?,?,?,?,?,?,?)`, values: [poolRecord.id, "INVENTORY_ONLY", null, null, 0, 0, 0, 0, createdAt] });
        }
        const memberRecords = groupItems.map((item) => byRef.get(item.externalRef) ?? ({
          id: newId("SM"), poolId: poolRecord.id, supplierActorId: context.actorId, externalRef: item.externalRef,
          serialDigest: item.serialDigest, hardwareUuidDigest: item.hardwareUuidDigest, specDigest,
          status: "DECLARED", lastSeenAt: null, verifiedUntil: null, createdAt, updatedAt: createdAt,
        } satisfies SupplyAssetMember));
        for (const item of memberRecords.filter((entry) => !byRef.has(entry.externalRef))) {
          statements.push({ sql: `INSERT INTO supply_asset_members VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, values: [item.id, item.poolId, item.supplierActorId, item.externalRef, item.serialDigest, item.hardwareUuidDigest, item.specDigest, item.status, null, null, createdAt, createdAt] });
        }
        responseGroups.push({ pool: poolRecord, policy: policyRecord, items: memberRecords });
      }
      const response = { groups: responseGroups };
      statements.push(receiptSql(context, "IMPORT_MAC_INVENTORY", response, createdAt));
      await db.batch(statements);
      return { record: response, replayed: false };
    },

    async listComponents(actorId, memberId) {
      const target = await db.first<Row>("SELECT * FROM supply_asset_members WHERE id=? AND supplier_actor_id=?", [memberId, actorId]);
      if (!target) throw supplyError("SUPPLY_NOT_FOUND", 404, "资产成员不存在。");
      return (await db.all<Row>("SELECT * FROM supply_asset_components WHERE member_id=? ORDER BY component_type,id", [memberId])).map(component);
    },

    async batchComponents(memberId, context, items) {
      const replay = await receipt<{ items: SupplyComponent[] }>(db, context, "BATCH_COMPONENTS");
      if (replay) return { record: replay, replayed: true };
      const target = await db.first<Row>("SELECT * FROM supply_asset_members WHERE id=? AND supplier_actor_id=?", [memberId, context.actorId]);
      if (!target) throw supplyError("SUPPLY_NOT_FOUND", 404, "资产成员不存在。");
      const identities = items.map((item) => item.identityDigest);
      const existing = await db.all<Row>(`SELECT * FROM supply_asset_components WHERE member_id=? AND identity_digest IN (${items.map(() => "?").join(",")})`, [memberId, ...identities]);
      const byIdentity = new Map(existing.map((row) => [String(row.identity_digest), component(row)]));
      for (const item of items) {
        const current = byIdentity.get(item.identityDigest);
        if (current && (current.componentType !== item.componentType || current.model !== item.model || current.memoryGiB !== item.memoryGiB || current.topologyGroup !== item.topologyGroup || json(current.specs) !== json(item.specs))) {
          throw supplyError("SUPPLY_COMPONENT_CONFLICT", 409, "组件身份已使用不同规格登记。");
        }
      }
      const createdAt = nowIso();
      const records = items.map((item) => byIdentity.get(item.identityDigest) ?? ({ id: newId("SC"), memberId, ...item, status: "DECLARED" as const }));
      const statements = records.filter((item) => !byIdentity.has(item.identityDigest)).map((item): SupplySql => ({
        sql: `INSERT INTO supply_asset_components VALUES (?,?,?,?,?,?,?,?,?,?)`,
        values: [item.id, memberId, item.componentType, item.identityDigest, item.model, item.memoryGiB, item.topologyGroup, json(item.specs), item.status, createdAt],
      }));
      const response = { items: records };
      await db.batch([...statements, receiptSql(context, "BATCH_COMPONENTS", response, createdAt)]);
      return { record: response, replayed: false };
    },

    async createEnrollment(context, input) {
      const replay = await receipt<AgentEnrollment>(db, context, "CREATE_ENROLLMENT");
      if (replay) return { record: replay, replayed: true };
      const target = await db.first<Row>("SELECT * FROM supply_asset_members WHERE id=? AND supplier_actor_id=?", [input.memberId, context.actorId]);
      if (!target) throw supplyError("SUPPLY_NOT_FOUND", 404, "资产成员不存在。");
      const createdAt = nowIso();
      const record: AgentEnrollment = { id: newId("SA"), memberId: input.memberId, supplierActorId: context.actorId, publicKeyDigest: input.publicKeyDigest, status: "PENDING", enrolledAt: createdAt, lastSeenAt: null };
      await db.batch([
        { sql: `INSERT INTO supply_agent_enrollments VALUES (?,?,?,?,?,?,?,?,?)`, values: [record.id, record.memberId, context.actorId, context.idempotencyKey, context.payloadHash, record.publicKeyDigest, record.status, createdAt, null] },
        receiptSql(context, "CREATE_ENROLLMENT", record, createdAt),
      ]);
      return { record, replayed: false };
    },

    async heartbeat(enrollmentId, context, input) {
      const replay = await receipt<AgentEnrollment>(db, context, "AGENT_HEARTBEAT");
      if (replay) return { record: replay, replayed: true };
      const row = await db.first<Row>("SELECT * FROM supply_agent_enrollments WHERE id=? AND supplier_actor_id=? AND status<>'REVOKED'", [enrollmentId, context.actorId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "Agent enrollment 不存在或已撤销。");
      const receivedAt = nowIso();
      if (Math.abs(Date.parse(input.observedAt) - Date.parse(receivedAt)) > 10 * 60_000) fail("心跳时间与服务端时间偏差过大。", 422);
      const record = { ...enrollment(row), status: "ACTIVE" as const, lastSeenAt: input.observedAt };
      await db.batch([
        { sql: `INSERT INTO supply_agent_heartbeats VALUES (?,?,?,?,?,?,?,?)`, values: [newId("SH"), enrollmentId, context.actorId, context.idempotencyKey, context.payloadHash, input.observedAt, input.payloadDigest, receivedAt] },
        { sql: `UPDATE supply_agent_enrollments SET status='ACTIVE',last_seen_at=? WHERE id=? AND supplier_actor_id=?`, values: [input.observedAt, enrollmentId, context.actorId] },
        { sql: `UPDATE supply_asset_members SET status=CASE WHEN status='VERIFIED' THEN status ELSE 'ONLINE' END,last_seen_at=?,updated_at=? WHERE id=?`, values: [input.observedAt, receivedAt, record.memberId] },
        receiptSql(context, "AGENT_HEARTBEAT", record, receivedAt),
      ]);
      return { record, replayed: false };
    },

    async createVerificationJob(context, memberId) {
      const replay = await receipt<VerificationJob>(db, context, "CREATE_VERIFICATION_JOB");
      if (replay) return { record: replay, replayed: true };
      const row = await db.first<Row>("SELECT * FROM supply_asset_members WHERE id=? AND supplier_actor_id=?", [memberId, context.actorId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "资产成员不存在。");
      const target = member(row);
      const createdAt = nowIso();
      const record: VerificationJob = { id: newId("SV"), poolId: target.poolId, memberId, requestedBy: context.actorId, reviewedBy: null, status: "PENDING", validUntil: null, createdAt, completedAt: null };
      await db.batch([
        { sql: `INSERT INTO supply_verification_jobs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, values: [record.id, record.poolId, memberId, context.actorId, context.idempotencyKey, context.payloadHash, null, null, null, "PENDING", null, createdAt, null] },
        receiptSql(context, "CREATE_VERIFICATION_JOB", record, createdAt),
      ]);
      return { record, replayed: false };
    },

    async getVerificationJob(actorId, jobId, allowOps = false) {
      const row = await db.first<Row>(`SELECT j.* FROM supply_verification_jobs j JOIN supply_asset_pools p ON p.id=j.pool_id
        WHERE j.id=? AND (?=1 OR p.supplier_actor_id=?)`, [jobId, Number(allowOps), actorId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "核验任务不存在。");
      const records = await db.all<Row>("SELECT * FROM supply_verification_evidence WHERE job_id=? ORDER BY created_at", [jobId]);
      return { job: verificationJob(row), evidence: records.map(evidence) };
    },

    async addVerificationEvidence(jobId, context, input) {
      const replay = await receipt<VerificationEvidence>(db, context, "ADD_VERIFICATION_EVIDENCE");
      if (replay) return { record: replay, replayed: true };
      const jobRow = await db.first<Row>("SELECT * FROM supply_verification_jobs WHERE id=? AND status='PENDING'", [jobId]);
      if (!jobRow) throw supplyError("SUPPLY_STATE_CONFLICT", 409, "核验任务不存在或已完成。");
      const createdAt = nowIso();
      const record: VerificationEvidence = { id: newId("SE"), jobId, ...input, createdAt };
      await db.batch([
        { sql: `INSERT INTO supply_verification_evidence VALUES (?,?,?,?,?,?,?,?,?,?)`, values: [record.id, jobId, context.actorId, context.idempotencyKey, context.payloadHash, record.evidenceType, record.payloadDigest, record.summary, record.observedAt, createdAt] },
        receiptSql(context, "ADD_VERIFICATION_EVIDENCE", record, createdAt),
      ]);
      return { record, replayed: false };
    },

    async completeVerification(jobId, context, input) {
      const replay = await receipt<VerificationJob>(db, context, "COMPLETE_VERIFICATION");
      if (replay) return { record: replay, replayed: true };
      const jobRow = await db.first<Row>("SELECT * FROM supply_verification_jobs WHERE id=? AND status='PENDING'", [jobId]);
      if (!jobRow) throw supplyError("SUPPLY_STATE_CONFLICT", 409, "核验任务不存在或已完成。");
      const job = verificationJob(jobRow);
      const poolRow = await db.first<Row>("SELECT * FROM supply_asset_pools WHERE id=?", [job.poolId]);
      if (!poolRow) throw new Error("SUPPLY_INVARIANT:POOL_MISSING");
      const targetPool = pool(poolRow);
      const components = (await db.all<Row>("SELECT * FROM supply_asset_components WHERE member_id=?", [job.memberId])).map(component);
      const records = (await db.all<Row>("SELECT * FROM supply_verification_evidence WHERE job_id=?", [jobId])).map(evidence);
      if (input.decision === "PASS") {
        const valid = targetPool.assetKind === "H100_8X_NODE" ? h100EvidenceValid(components, records)
          : targetPool.assetKind === "MAC_MINI" ? macEvidenceValid(records)
            : records.length >= 2;
        if (!valid) throw supplyError("SUPPLY_VERIFICATION_INCOMPLETE", 422, "核验材料不足，不能标记通过。");
      }
      const completedAt = nowIso();
      const updated: VerificationJob = { ...job, reviewedBy: context.actorId, status: input.decision === "PASS" ? "PASSED" : "FAILED", validUntil: input.validUntil, completedAt };
      const nextMemberStatus = input.decision === "PASS" ? "VERIFIED" : "REJECTED";
      try {
        await db.batch([
          invariantSql("EXISTS (SELECT 1 FROM supply_verification_jobs WHERE id=? AND status='PENDING')", [jobId]),
          { sql: `UPDATE supply_verification_jobs SET reviewed_by=?,completion_idempotency_key=?,completion_payload_hash=?,status=?,valid_until=?,completed_at=? WHERE id=? AND status='PENDING'`, values: [context.actorId, context.idempotencyKey, context.payloadHash, updated.status, input.validUntil, completedAt, jobId] },
          { sql: `UPDATE supply_asset_members SET status=?,verified_until=?,updated_at=? WHERE id=?`, values: [nextMemberStatus, input.validUntil, completedAt, job.memberId] },
          { sql: `UPDATE supply_asset_components SET status=? WHERE member_id=?`, values: [input.decision === "PASS" ? "VERIFIED" : "REJECTED", job.memberId] },
          { sql: `UPDATE supply_asset_pools SET status=CASE WHEN ?='PASSED' THEN 'ACTIVE' ELSE status END,updated_at=? WHERE id=?`, values: [updated.status, completedAt, job.poolId] },
          ...(input.decision === "FAIL" ? [
            { sql: `UPDATE supply_promotions SET status='SUSPENDED' WHERE member_id=? AND status='ACTIVE'`, values: [job.memberId] },
            { sql: `UPDATE supply_exchange_bindings SET status='SUSPENDED' WHERE member_id=? AND status='ACTIVE'`, values: [job.memberId] },
          ] satisfies SupplySql[] : []),
          receiptSql(context, "COMPLETE_VERIFICATION", updated, completedAt),
        ]);
      } catch {
        throw supplyError("SUPPLY_STATE_CONFLICT", 409, "核验任务状态已变化。");
      }
      return { record: updated, replayed: false };
    },

    async batchAvailability(poolId, context, items) {
      const replay = await receipt<{ items: AvailabilityWindow[] }>(db, context, "BATCH_AVAILABILITY");
      if (replay) return { record: replay, replayed: true };
      await ownedPool(db, context.actorId, poolId);
      const createdAt = nowIso();
      const records: AvailabilityWindow[] = [];
      for (const input of items) {
        const target = await db.first<Row>("SELECT * FROM supply_asset_members WHERE id=? AND pool_id=? AND supplier_actor_id=?", [input.memberId, poolId, context.actorId]);
        if (!target) throw supplyError("SUPPLY_NOT_FOUND", 404, "时间窗引用了不存在的资产成员。");
        const item = member(target);
        if (item.status !== "VERIFIED" || !item.verifiedUntil || item.verifiedUntil < input.endAt) {
          throw supplyError("SUPPLY_VERIFICATION_REQUIRED", 422, "资产核验必须覆盖完整时间窗。");
        }
        records.push({ id: newId("SW"), poolId, memberId: item.id, supplierActorId: context.actorId, startAt: input.startAt, endAt: input.endAt, status: "AVAILABLE", createdAt });
      }
      for (let left = 0; left < records.length; left += 1) {
        for (let right = left + 1; right < records.length; right += 1) {
          if (records[left].memberId === records[right].memberId && records[left].startAt < records[right].endAt && records[left].endAt > records[right].startAt) {
            throw supplyError("SUPPLY_CAPACITY_CONFLICT", 409, "同一批次内的资产时间窗不能重叠。");
          }
        }
      }
      const guards = records.map((item) => invariantSql(
        "NOT EXISTS (SELECT 1 FROM supply_availability_windows WHERE member_id=? AND status IN ('AVAILABLE','PROMOTED') AND start_at<? AND end_at>?)",
        [item.memberId, item.endAt, item.startAt],
      ));
      const statements = records.map((item): SupplySql => ({
        sql: `INSERT INTO supply_availability_windows (id,pool_id,member_id,supplier_actor_id,import_idempotency_key,start_at,end_at,status,created_at)
          SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM supply_availability_windows WHERE member_id=? AND status IN ('AVAILABLE','PROMOTED') AND start_at<? AND end_at>?)`,
        values: [item.id, poolId, item.memberId, context.actorId, context.idempotencyKey, item.startAt, item.endAt, item.status, createdAt, item.memberId, item.endAt, item.startAt],
      }));
      const response = { items: records };
      let results: SupplyRunResult[];
      try {
        results = await db.batch([...guards, ...statements, receiptSql(context, "BATCH_AVAILABILITY", response, createdAt)]);
      } catch {
        throw supplyError("SUPPLY_CAPACITY_CONFLICT", 409, "资产时间窗发生重叠，本次批次未创建。");
      }
      if (results.slice(records.length, records.length * 2).some((result) => result.changes !== 1)) throw supplyError("SUPPLY_CAPACITY_CONFLICT", 409, "资产时间窗发生重叠，本次批次未创建。");
      return { record: response, replayed: false };
    },

    async listAvailability(actorId, poolId) {
      await ownedPool(db, actorId, poolId);
      return (await db.all<Row>("SELECT * FROM supply_availability_windows WHERE pool_id=? ORDER BY start_at", [poolId])).map(window);
    },

    async previewPromotion(actorId, poolId, windowIds) {
      const targetPool = await ownedPool(db, actorId, poolId);
      const targetPolicy = await getPolicy(db, poolId);
      const blockers: string[] = [];
      if (targetPolicy.publicationMode !== "H100_LIMITED_TRIAL" || targetPool.assetKind !== "H100_8X_NODE") blockers.push("POOL_NOT_H100_TRIAL");
      const otherPilotPool = await db.first<Row>(`SELECT p.id FROM supply_promotions p
        JOIN supply_asset_pools pool ON pool.id=p.pool_id
        WHERE p.pool_id<>? AND pool.asset_kind='H100_8X_NODE' AND p.status IN ('ACTIVE','EXHAUSTED') LIMIT 1`, [poolId]);
      if (otherPilotPool) blockers.push("H100_PILOT_SINGLE_POOL_ONLY");
      const placeholders = windowIds.map(() => "?").join(",");
      const rows = await db.all<Row>(`SELECT w.*,m.status AS member_status,m.verified_until FROM supply_availability_windows w
        JOIN supply_asset_members m ON m.id=w.member_id WHERE w.pool_id=? AND w.id IN (${placeholders})`, [poolId, ...windowIds]);
      if (rows.length !== windowIds.length) blockers.push("WINDOW_NOT_FOUND");
      const windows = rows.map((row) => ({ ...window(row), nodeHours: nodeHours(String(row.start_at), String(row.end_at)) }));
      if (rows.some((row) => row.status !== "AVAILABLE" || row.member_status !== "VERIFIED" || String(row.verified_until) < String(row.end_at))) blockers.push("WINDOW_NOT_VERIFIED_OR_AVAILABLE");
      if (windows.some((item) => item.nodeHours > 80)) blockers.push("WINDOW_EXCEEDS_TRIAL_CAP");
      const totalRow = await db.first<Row>("SELECT COALESCE(SUM(node_hours),0) AS total FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')", [poolId]);
      const committedNodeHours = totalRow ? number(totalRow, "total") : 0;
      const candidateNodeHours = windows.reduce((sum, item) => sum + item.nodeHours, 0);
      const remainingNodeHours = Math.max(0, targetPolicy.maxTotalNodeHours - committedNodeHours);
      if (candidateNodeHours > remainingNodeHours) blockers.push("TRIAL_80_NODE_HOUR_CAP_EXCEEDED");
      const bounds = await db.first<Row>("SELECT MIN(start_at) AS min_start,MAX(end_at) AS max_end FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')", [poolId]);
      const starts = [...windows.map((item) => item.startAt), ...(bounds?.min_start ? [String(bounds.min_start)] : [])];
      const ends = [...windows.map((item) => item.endAt), ...(bounds?.max_end ? [String(bounds.max_end)] : [])];
      if (starts.length > 0 && Math.max(...ends.map(Date.parse)) - Math.min(...starts.map(Date.parse)) > 30 * 86_400_000) {
        blockers.push("CAMPAIGN_30_DAY_WINDOW_EXCEEDED");
      }
      return { pool: targetPool, policy: targetPolicy, windows, committedNodeHours, candidateNodeHours, remainingNodeHours, publishable: blockers.length === 0, blockers };
    },

    async commitPromotion(poolId, context, windowIds) {
      const replay = await receipt<{ promotions: SupplyPromotion[]; bindings: ExchangeBinding[] }>(db, context, "COMMIT_PROMOTION");
      if (replay) return { record: replay, replayed: true };
      const preview = await store.previewPromotion(context.actorId, poolId, windowIds);
      if (!preview.publishable) throw supplyError("SUPPLY_PROMOTION_BLOCKED", 422, preview.blockers.join(","));
      const createdAt = nowIso();
      const promotions = preview.windows.map((item): SupplyPromotion => ({
        id: newId("SPR"), poolId, memberId: item.memberId, availabilityWindowId: item.id, status: "ACTIVE",
        unitPriceMicrosPerGpuHour: 1_000_000, gpuCount: 8, startAt: item.startAt, endAt: item.endAt, nodeHours: item.nodeHours, createdAt,
      }));
      const bindings = promotions.map((item): ExchangeBinding => ({ id: newId("SEB"), promotionId: item.id, poolId, memberId: item.memberId, availabilityWindowId: item.availabilityWindowId, bindingMode: "ISOLATED_SUPPLY", status: "ACTIVE", createdAt }));
      const statements: SupplySql[] = [];
      for (let index = 0; index < promotions.length; index += 1) {
        const item = promotions[index];
        const binding = bindings[index];
        statements.push(invariantSql(`
          (SELECT COALESCE(SUM(node_hours),0) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')) + ? <= 80
          AND unixepoch(MAX(?,COALESCE((SELECT MAX(end_at) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')),?)))
            - unixepoch(MIN(?,COALESCE((SELECT MIN(start_at) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')),?))) <= 2592000
          AND NOT EXISTS (SELECT 1 FROM supply_promotions p JOIN supply_asset_pools pool ON pool.id=p.pool_id
            WHERE p.pool_id<>? AND pool.asset_kind='H100_8X_NODE' AND p.status IN ('ACTIVE','EXHAUSTED'))
          AND EXISTS (SELECT 1 FROM supply_availability_windows w JOIN supply_asset_members m ON m.id=w.member_id
            WHERE w.id=? AND w.status='AVAILABLE' AND m.status='VERIFIED' AND m.verified_until>=w.end_at)`,
          [poolId, item.nodeHours, item.endAt, poolId, item.endAt, item.startAt, poolId, item.startAt, poolId, item.availabilityWindowId]));
        statements.push({
          sql: `INSERT INTO supply_promotions (id,pool_id,member_id,availability_window_id,supplier_actor_id,commit_idempotency_key,unit_price_micros_gpu_hour,gpu_count,start_at,end_at,node_hours,status,created_at)
            SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(node_hours),0) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')) + ? <= 80
              AND unixepoch(MAX(?,COALESCE((SELECT MAX(end_at) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')),?)))
                - unixepoch(MIN(?,COALESCE((SELECT MIN(start_at) FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')),?))) <= 2592000
              AND NOT EXISTS (SELECT 1 FROM supply_promotions p JOIN supply_asset_pools pool ON pool.id=p.pool_id
                WHERE p.pool_id<>? AND pool.asset_kind='H100_8X_NODE' AND p.status IN ('ACTIVE','EXHAUSTED'))
              AND EXISTS (SELECT 1 FROM supply_availability_windows WHERE id=? AND status='AVAILABLE')`,
          values: [item.id, poolId, item.memberId, item.availabilityWindowId, context.actorId, context.idempotencyKey, 1_000_000, 8, item.startAt, item.endAt, item.nodeHours, item.status, createdAt, poolId, item.nodeHours, item.endAt, poolId, item.endAt, item.startAt, poolId, item.startAt, poolId, item.availabilityWindowId],
        });
        statements.push({ sql: `UPDATE supply_availability_windows SET status='PROMOTED' WHERE id=? AND status='AVAILABLE' AND EXISTS (SELECT 1 FROM supply_promotions WHERE id=?)`, values: [item.availabilityWindowId, item.id] });
        statements.push({ sql: `INSERT INTO supply_exchange_bindings (id,promotion_id,pool_id,member_id,availability_window_id,binding_mode,status,created_at)
          SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM supply_promotions WHERE id=?)`, values: [binding.id, binding.promotionId, poolId, binding.memberId, binding.availabilityWindowId, binding.bindingMode, binding.status, createdAt, item.id] });
      }
      const response = { promotions, bindings };
      statements.push(receiptSql(context, "COMMIT_PROMOTION", response, createdAt));
      let results: SupplyRunResult[];
      try {
        results = await db.batch(statements);
      } catch {
        throw supplyError("SUPPLY_PROMOTION_CONFLICT", 409, "发布条件已变化，本次提交未完成。");
      }
      for (let index = 0; index < promotions.length; index += 1) {
        if (results[index * 4 + 1]?.changes !== 1 || results[index * 4 + 2]?.changes !== 1 || results[index * 4 + 3]?.changes !== 1) {
          throw supplyError("SUPPLY_PROMOTION_CONFLICT", 409, "发布条件已变化，本次提交未完成。");
        }
      }
      return { record: response, replayed: false };
    },

    async listPromotions(actorId) {
      const rows = actorId
        ? await db.all<Row>("SELECT * FROM supply_promotions WHERE supplier_actor_id=? ORDER BY created_at DESC", [actorId])
        : await db.all<Row>(`SELECT p.* FROM supply_promotions p JOIN supply_asset_members m ON m.id=p.member_id
          WHERE p.status='ACTIVE' AND m.status='VERIFIED' AND m.verified_until>? ORDER BY p.created_at DESC`, [nowIso()]);
      return rows.map(promotion);
    },

    async createTrialOrder(context, input) {
      const replay = await receipt<SupplyTrialOrder>(db, context, "CREATE_TRIAL_ORDER");
      if (replay) return { record: replay, replayed: true };
      const row = await db.first<Row>(`SELECT p.*,pool.supplier_actor_id,policy.max_order_hours,policy.max_buyer_node_hours,policy.max_total_node_hours,
          member.status AS member_status,member.verified_until
        FROM supply_promotions p JOIN supply_asset_pools pool ON pool.id=p.pool_id JOIN supply_promotion_policies policy ON policy.pool_id=p.pool_id
        JOIN supply_asset_members member ON member.id=p.member_id
        WHERE p.id=? AND p.status='ACTIVE'`, [input.promotionId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "试运行批次不存在。");
      const promoted = promotion(row);
      const hours = nodeHours(input.startAt, input.endAt);
      if (hours < 1 || hours > number(row, "max_order_hours")) fail("单笔试运行必须为 1–8 个整小时。", 422);
      if (input.startAt < promoted.startAt || input.endAt > promoted.endAt || Date.parse(input.startAt) <= Date.now()) fail("订单时间必须位于可售未来时间窗内。", 422);
      if (row.member_status !== "VERIFIED" || !row.verified_until || String(row.verified_until) < input.endAt) fail("节点核验有效期不能覆盖订单时间。", 422);
      const campaignBounds = await db.first<Row>("SELECT MIN(start_at) AS min_start,MAX(end_at) AS max_end FROM supply_promotions WHERE pool_id=? AND status IN ('ACTIVE','EXHAUSTED')", [promoted.poolId]);
      if (!campaignBounds?.min_start || !campaignBounds.max_end
        || Date.parse(String(campaignBounds.max_end)) - Date.parse(String(campaignBounds.min_start)) > 30 * 86_400_000
        || Date.parse(input.startAt) < Date.parse(String(campaignBounds.min_start))
        || Date.parse(input.endAt) > Date.parse(String(campaignBounds.min_start)) + 30 * 86_400_000) {
        fail("订单时间超出本次 30 天试运行活动窗口。", 422);
      }
      const createdAt = nowIso();
      const orderId = newId("STO");
      const allocationId = newId("SAL");
      const expiresAt = new Date(Date.parse(createdAt) + 15 * 60_000).toISOString();
      const record: SupplyTrialOrder = {
        id: orderId, promotionId: promoted.id, allocationBindingId: allocationId, buyerActorId: context.actorId,
        supplierActorId: String(row.supplier_actor_id), memberId: promoted.memberId, startAt: input.startAt, endAt: input.endAt,
        durationHours: hours, gpuCount: 8, unitPriceMicrosPerGpuHour: 1_000_000,
        amountCents: hours * 8 * 100, currency: "CNY", status: "PAYMENT_PENDING", expiresAt, version: 1, createdAt, updatedAt: createdAt,
      };
      const insertOrder: SupplySql = {
        sql: `INSERT INTO supply_trial_orders (id,promotion_id,allocation_binding_id,buyer_actor_id,supplier_actor_id,member_id,idempotency_key,payload_hash,start_at,end_at,duration_hours,gpu_count,unit_price_micros_gpu_hour,amount_cents,currency,status,expires_at,version,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE
            (SELECT COALESCE(SUM(node_hours),0) FROM supply_allocation_bindings WHERE buyer_actor_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE','RELEASED')) + ? <= ?
            AND (SELECT COALESCE(SUM(node_hours),0) FROM supply_allocation_bindings WHERE promotion_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE','RELEASED')) + ? <= 80
            AND NOT EXISTS (SELECT 1 FROM supply_trial_orders WHERE buyer_actor_id=?)
            AND (SELECT COUNT(DISTINCT o.buyer_actor_id) FROM supply_trial_orders o JOIN supply_promotions op ON op.id=o.promotion_id WHERE op.pool_id=?) < 10
            AND NOT EXISTS (SELECT 1 FROM supply_allocation_bindings WHERE member_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE') AND start_at<? AND end_at>?)`,
        values: [record.id, record.promotionId, allocationId, context.actorId, record.supplierActorId, record.memberId, context.idempotencyKey, context.payloadHash, record.startAt, record.endAt, hours, 8, 1_000_000, record.amountCents, "CNY", record.status, expiresAt, 1, createdAt, createdAt, context.actorId, hours, number(row, "max_buyer_node_hours"), record.promotionId, hours, context.actorId, promoted.poolId, record.memberId, record.endAt, record.startAt],
      };
      const orderGuard = invariantSql(`
        (SELECT COALESCE(SUM(node_hours),0) FROM supply_allocation_bindings WHERE buyer_actor_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE','RELEASED')) + ? <= ?
        AND (SELECT COALESCE(SUM(node_hours),0) FROM supply_allocation_bindings WHERE promotion_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE','RELEASED')) + ? <= 80
        AND NOT EXISTS (SELECT 1 FROM supply_trial_orders WHERE buyer_actor_id=?)
        AND (SELECT COUNT(DISTINCT o.buyer_actor_id) FROM supply_trial_orders o JOIN supply_promotions op ON op.id=o.promotion_id WHERE op.pool_id=?) < 10
        AND EXISTS (SELECT 1 FROM supply_asset_members WHERE id=? AND status='VERIFIED' AND verified_until>=?)
        AND NOT EXISTS (SELECT 1 FROM supply_allocation_bindings WHERE member_id=? AND status IN ('RESERVED','LOCKED','IN_SERVICE') AND start_at<? AND end_at>?)`,
        [context.actorId, hours, number(row, "max_buyer_node_hours"), record.promotionId, hours, context.actorId, promoted.poolId, record.memberId, record.endAt, record.memberId, record.endAt, record.startAt]);
      const insertAllocation: SupplySql = {
        sql: `INSERT INTO supply_allocation_bindings (id,promotion_id,member_id,buyer_actor_id,trial_order_id,start_at,end_at,node_hours,status,created_at,updated_at)
          SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM supply_trial_orders WHERE id=?)`,
        values: [allocationId, record.promotionId, record.memberId, context.actorId, record.id, record.startAt, record.endAt, hours, "RESERVED", createdAt, createdAt, record.id],
      };
      const initializeDelivery: SupplySql = {
        sql: `INSERT INTO supply_trial_deliveries (order_id,status,buyer_public_key_fingerprint,secure_endpoint_ref,host_key_fingerprint,credential_expires_at,cleanup_evidence_digest,version,created_at,updated_at)
          SELECT ?,'AWAITING_PAYMENT',NULL,NULL,NULL,NULL,NULL,1,?,? WHERE EXISTS (SELECT 1 FROM supply_trial_orders WHERE id=?)`,
        values: [record.id, createdAt, createdAt, record.id],
      };
      let results: SupplyRunResult[];
      try {
        results = await db.batch([orderGuard, insertOrder, insertAllocation, initializeDelivery, receiptSql(context, "CREATE_TRIAL_ORDER", record, createdAt)]);
      } catch {
        throw supplyError("SUPPLY_PURCHASE_LIMIT", 409, "节点时间已被占用、主体或试运行额度已用完。");
      }
      if (results[1]?.changes !== 1 || results[2]?.changes !== 1 || results[3]?.changes !== 1) throw supplyError("SUPPLY_PURCHASE_LIMIT", 409, "节点时间已被占用或买家试运行额度已用完。");
      return { record, replayed: false };
    },

    async getTrialOrder(actorId, orderId, role) {
      const clause = role === "buyer" ? "buyer_actor_id=?" : role === "supplier" ? "supplier_actor_id=?" : "1=?";
      const value = role === "ops" ? 1 : actorId;
      const row = await db.first<Row>(`SELECT * FROM supply_trial_orders WHERE id=? AND ${clause}`, [orderId, value]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "试运行订单不存在。");
      const allocationRow = await db.first<Row>("SELECT * FROM supply_allocation_bindings WHERE trial_order_id=?", [orderId]);
      if (!allocationRow) throw new Error("SUPPLY_INVARIANT:ALLOCATION_MISSING");
      const paymentRow = await db.first<Row>("SELECT * FROM supply_trial_payments WHERE order_id=?", [orderId]);
      const deliveryRow = await db.first<Row>("SELECT * FROM supply_trial_deliveries WHERE order_id=?", [orderId]);
      const paymentRows = await db.all<Row>("SELECT * FROM supply_trial_payment_events WHERE order_id=? ORDER BY received_at", [orderId]);
      const checkRows = await db.all<Row>("SELECT * FROM supply_trial_connection_checks WHERE order_id=? ORDER BY started_at", [orderId]);
      return {
        order: trialOrder(row), allocation: allocation(allocationRow), payment: paymentRow ? payment(paymentRow) : null,
        paymentEvents: paymentRows.map(paymentEvent), delivery: deliveryRow ? delivery(deliveryRow) : null,
        connectionChecks: checkRows.map(connectionCheck),
      };
    },

    async listTrialOrders(actorId, role) {
      const rows = role === "buyer" ? await db.all<Row>("SELECT * FROM supply_trial_orders WHERE buyer_actor_id=? ORDER BY created_at DESC", [actorId])
        : role === "supplier" ? await db.all<Row>("SELECT * FROM supply_trial_orders WHERE supplier_actor_id=? ORDER BY created_at DESC", [actorId])
          : await db.all<Row>("SELECT * FROM supply_trial_orders ORDER BY created_at DESC");
      return rows.map(trialOrder);
    },

    async transitionTrialOrder(orderId, context, input) {
      const replay = await receipt<SupplyTrialOrder>(db, context, "TRANSITION_TRIAL_ORDER");
      if (replay) return { record: replay, replayed: true };
      const row = await db.first<Row>("SELECT * FROM supply_trial_orders WHERE id=?", [orderId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "试运行订单不存在。");
      const current = trialOrder(row);
      if (current.version !== input.expectedVersion) throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "订单版本已变化。");
      const deliveryRow = await db.first<Row>("SELECT status FROM supply_trial_deliveries WHERE order_id=?", [orderId]);
      const deliveryStatus = deliveryRow == null ? null : String(deliveryRow.status);
      const refundCanReleaseWithoutCleanup = deliveryStatus === "AWAITING_PAYMENT" || deliveryStatus === "AWAITING_KEY";
      if ((input.toStatus === "REFUND_PENDING" || input.toStatus === "REFUNDED") && !refundCanReleaseWithoutCleanup) {
        throw supplyError("SUPPLY_STATE_CONFLICT", 409, "交付已开始，退款只能改变资金状态；节点仍须完成撤权和数据清理。");
      }
      const transitions: Record<SupplyTrialOrder["status"], readonly SupplyTrialOrder["status"][]> = {
        PAYMENT_PENDING: ["PAID", "FAILED", "CANCELLED"], PAID: ["PROVISIONING", "REFUND_PENDING"],
        PROVISIONING: ["DELIVERED", "FAILED", "REFUND_PENDING"], DELIVERED: ["IN_SERVICE", "FAILED", "REFUND_PENDING"],
        IN_SERVICE: ["COMPLETED", "FAILED", "REFUND_PENDING"], COMPLETED: ["REFUND_PENDING"], FAILED: ["REFUND_PENDING"], CANCELLED: [],
        REFUND_PENDING: ["REFUNDED"], REFUNDED: [],
      };
      if (!transitions[current.status].includes(input.toStatus)) throw supplyError("SUPPLY_STATE_CONFLICT", 409, `${current.status} 不能转换为 ${input.toStatus}。`);
      const updatedAt = nowIso();
      const updated: SupplyTrialOrder = { ...current, status: input.toStatus, version: current.version + 1, updatedAt };
      const allocationStatus: AllocationBinding["status"] = input.toStatus === "PAID" || input.toStatus === "PROVISIONING" || input.toStatus === "DELIVERED" || input.toStatus === "REFUND_PENDING" ? "LOCKED"
        : input.toStatus === "IN_SERVICE" ? "IN_SERVICE"
          : ["COMPLETED", "FAILED"].includes(input.toStatus) ? "LOCKED"
            : ["CANCELLED", "REFUNDED"].includes(input.toStatus) ? "CANCELLED" : "RESERVED";
      let results: SupplyRunResult[];
      try {
        results = await db.batch([
          invariantSql("EXISTS (SELECT 1 FROM supply_trial_orders WHERE id=? AND version=? AND status=?)", [orderId, input.expectedVersion, current.status]),
          ...((input.toStatus === "REFUND_PENDING" || input.toStatus === "REFUNDED") ? [
            invariantSql("EXISTS (SELECT 1 FROM supply_trial_deliveries WHERE order_id=? AND status IN ('AWAITING_PAYMENT','AWAITING_KEY'))", [orderId]),
          ] satisfies SupplySql[] : []),
          { sql: `UPDATE supply_trial_orders SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=?`, values: [input.toStatus, updatedAt, orderId, input.expectedVersion, current.status] },
          { sql: `UPDATE supply_allocation_bindings SET status=?,updated_at=? WHERE trial_order_id=?`, values: [allocationStatus, updatedAt, orderId] },
          receiptSql(context, "TRANSITION_TRIAL_ORDER", updated, updatedAt),
        ]);
      } catch {
        throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "订单状态已变化。");
      }
      if (results[1]?.changes !== 1) throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "订单状态已变化。");
      return { record: updated, replayed: false };
    },

    async ensureTrialPayment(orderId, context, input) {
      const replay = await receipt<SupplyTrialPayment>(db, context, "ENSURE_TRIAL_PAYMENT");
      if (replay) return { record: replay, replayed: true };
      const orderRow = await db.first<Row>("SELECT * FROM supply_trial_orders WHERE id=?", [orderId]);
      if (!orderRow) throw supplyError("SUPPLY_NOT_FOUND", 404, "试运行订单不存在。");
      const existing = await db.first<Row>("SELECT * FROM supply_trial_payments WHERE order_id=?", [orderId]);
      if (existing) {
        const current = payment(existing);
        if (current.provider !== input.provider || current.providerOrderRef !== input.providerOrderRef) {
          throw supplyError("SUPPLY_PAYMENT_CONFLICT", 409, "订单已绑定其他支付单。");
        }
        return { record: current, replayed: true };
      }
      const createdAt = nowIso();
      const record: SupplyTrialPayment = {
        orderId, status: "PENDING", provider: input.provider, providerOrderRef: input.providerOrderRef,
        providerTransactionRef: null, version: 1, createdAt, updatedAt: createdAt,
      };
      await db.batch([
        { sql: `INSERT INTO supply_trial_payments (order_id,status,provider,provider_order_ref,provider_transaction_ref,version,created_at,updated_at) VALUES (?,?,?,?,NULL,1,?,?)`, values: [orderId, record.status, input.provider, input.providerOrderRef, createdAt, createdAt] },
        receiptSql(context, "ENSURE_TRIAL_PAYMENT", record, createdAt),
      ]);
      return { record, replayed: false };
    },

    async applyTrialPaymentEvent(orderId, context, input) {
      const replay = await receipt<{ payment: SupplyTrialPayment; event: SupplyTrialPaymentEvent }>(db, context, "APPLY_TRIAL_PAYMENT_EVENT");
      if (replay) return { record: replay, replayed: true };
      const paymentRow = await db.first<Row>("SELECT * FROM supply_trial_payments WHERE order_id=? AND provider=?", [orderId, input.provider]);
      if (!paymentRow) throw supplyError("SUPPLY_PAYMENT_NOT_FOUND", 404, "支付单不存在。");
      const orderRow = await db.first<Row>("SELECT * FROM supply_trial_orders WHERE id=?", [orderId]);
      if (!orderRow) throw new Error("SUPPLY_INVARIANT:ORDER_MISSING");
      const order = trialOrder(orderRow);
      const paymentDeliveryRow = await db.first<Row>("SELECT status FROM supply_trial_deliveries WHERE order_id=?", [orderId]);
      const paymentDeliveryStatus = paymentDeliveryRow == null ? null : String(paymentDeliveryRow.status);
      const receivedAt = nowIso();
      const current = payment(paymentRow);
      const duplicateRow = await db.first<Row>("SELECT * FROM supply_trial_payment_events WHERE provider=? AND provider_event_ref=?", [input.provider, input.providerEventRef]);
      if (duplicateRow) {
        const duplicate = paymentEvent(duplicateRow);
        if (duplicate.orderId !== orderId || duplicate.payloadDigest !== input.payloadDigest) {
          throw supplyError("SUPPLY_PAYMENT_EVENT_CONFLICT", 409, "支付事件编号已绑定不同内容。");
        }
        return { record: { payment: current, event: duplicate }, replayed: true };
      }
      if (input.providerTransactionRef) {
        const transactionRow = await db.first<Row>("SELECT order_id FROM supply_trial_payments WHERE provider=? AND provider_transaction_ref=? AND order_id<>?", [input.provider, input.providerTransactionRef, orderId]);
        if (transactionRow) throw supplyError("PAYMENT_TRANSACTION_CONFLICT", 409, "支付流水已绑定其他订单。");
      }

      let effectiveStatus = input.toStatus;
      let eventOutcome: SupplyTrialPaymentEvent["outcome"] = input.outcome;
      let operation: SupplyTrialPaymentEvent["operation"] = "OTHER";
      let advanceCapture = false;
      let fullRefund = false;
      let safePreDeliveryRelease = false;
      if (input.toStatus === "CAPTURED") {
        operation = "CAPTURE";
        if (input.amountCents !== order.amountCents) throw supplyError("SUPPLY_PAYMENT_AMOUNT_MISMATCH", 422, "支付金额与服务端订单金额不一致。");
        if (order.status !== "PAYMENT_PENDING") {
          effectiveStatus = current.status;
          eventOutcome = "IGNORED";
        } else if (order.expiresAt <= receivedAt) {
          effectiveStatus = "REFUND_PENDING";
          eventOutcome = "APPLIED";
          advanceCapture = true;
        } else {
          effectiveStatus = "CAPTURED";
          eventOutcome = "APPLIED";
          advanceCapture = true;
        }
      } else if (input.toStatus === "REFUNDED") {
        operation = "REFUND";
        if (!["CAPTURED", "REFUND_PENDING"].includes(current.status)) throw supplyError("SUPPLY_PAYMENT_STATE_CONFLICT", 409, "当前支付状态不能退款。");
        const refundedRow = await db.first<Row>("SELECT COALESCE(SUM(amount_cents),0) AS total FROM supply_trial_payment_events WHERE order_id=? AND operation='REFUND' AND outcome='APPLIED'", [orderId]);
        const refunded = (refundedRow ? number(refundedRow, "total") : 0) + input.amountCents;
        if (input.amountCents <= 0 || refunded > order.amountCents) throw supplyError("SUPPLY_PAYMENT_AMOUNT_MISMATCH", 422, "累计退款金额超出订单金额。");
        fullRefund = refunded === order.amountCents;
        safePreDeliveryRelease = fullRefund && (paymentDeliveryStatus === "AWAITING_PAYMENT" || paymentDeliveryStatus === "AWAITING_KEY");
        effectiveStatus = fullRefund ? "REFUNDED" : current.status === "REFUND_PENDING" ? "REFUND_PENDING" : "CAPTURED";
        eventOutcome = "APPLIED";
      }
      const updated: SupplyTrialPayment = {
        ...current, status: effectiveStatus, providerTransactionRef: input.providerTransactionRef ?? current.providerTransactionRef,
        version: current.version + 1, updatedAt: receivedAt,
      };
      const event: SupplyTrialPaymentEvent = {
        id: newId("SPE"), orderId, provider: input.provider, providerEventRef: input.providerEventRef,
        providerTransactionRef: input.providerTransactionRef, eventType: input.eventType, operation, amountCents: input.amountCents,
        payloadDigest: input.payloadDigest, outcome: eventOutcome, resultingStatus: effectiveStatus, occurredAt: input.occurredAt, receivedAt,
      };
      const response = { payment: updated, event };
      try {
        await db.batch([
          invariantSql("EXISTS (SELECT 1 FROM supply_trial_payments WHERE order_id=? AND version=?)", [orderId, current.version]),
          { sql: `INSERT INTO supply_trial_payment_events (id,order_id,provider,provider_event_ref,provider_transaction_ref,event_type,operation,amount_cents,payload_digest,outcome,resulting_status,occurred_at,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, values: [event.id, orderId, event.provider, event.providerEventRef, event.providerTransactionRef, event.eventType, event.operation, event.amountCents, event.payloadDigest, event.outcome, event.resultingStatus, event.occurredAt, event.receivedAt] },
          { sql: `UPDATE supply_trial_payments SET status=?,provider_transaction_ref=?,version=version+1,updated_at=? WHERE order_id=? AND version=?`, values: [updated.status, updated.providerTransactionRef, receivedAt, orderId, current.version] },
          ...(advanceCapture ? [
            { sql: `UPDATE supply_trial_orders SET status=CASE WHEN expires_at>? THEN 'PAID' ELSE 'REFUND_PENDING' END,version=version+1,updated_at=? WHERE id=? AND status='PAYMENT_PENDING'`, values: [receivedAt, receivedAt, orderId] },
            { sql: `UPDATE supply_allocation_bindings SET status='LOCKED',updated_at=? WHERE trial_order_id=?`, values: [receivedAt, orderId] },
            { sql: `UPDATE supply_trial_deliveries SET status='AWAITING_KEY',version=version+1,updated_at=? WHERE order_id=? AND EXISTS (SELECT 1 FROM supply_trial_orders WHERE id=? AND status='PAID')`, values: [receivedAt, orderId, orderId] },
          ] satisfies SupplySql[] : []),
          ...(safePreDeliveryRelease ? [
            { sql: `UPDATE supply_trial_orders SET status='REFUNDED',version=version+1,updated_at=? WHERE id=?`, values: [receivedAt, orderId] },
            { sql: `UPDATE supply_allocation_bindings SET status='CANCELLED',updated_at=? WHERE trial_order_id=?`, values: [receivedAt, orderId] },
          ] satisfies SupplySql[] : []),
          receiptSql(context, "APPLY_TRIAL_PAYMENT_EVENT", response, receivedAt),
        ]);
      } catch {
        const concurrentEventRow = await db.first<Row>("SELECT * FROM supply_trial_payment_events WHERE provider=? AND provider_event_ref=?", [input.provider, input.providerEventRef]);
        if (concurrentEventRow) {
          const concurrentEvent = paymentEvent(concurrentEventRow);
          if (concurrentEvent.orderId === orderId && concurrentEvent.payloadDigest === input.payloadDigest) {
            const latestPaymentRow = await db.first<Row>("SELECT * FROM supply_trial_payments WHERE order_id=?", [orderId]);
            if (!latestPaymentRow) throw new Error("SUPPLY_INVARIANT:PAYMENT_MISSING");
            return { record: { payment: payment(latestPaymentRow), event: concurrentEvent }, replayed: true };
          }
          throw supplyError("SUPPLY_PAYMENT_EVENT_CONFLICT", 409, "支付事件编号已绑定不同内容。");
        }
        if (input.providerTransactionRef) {
          const transactionRow = await db.first<Row>("SELECT order_id FROM supply_trial_payments WHERE provider=? AND provider_transaction_ref=? AND order_id<>?", [input.provider, input.providerTransactionRef, orderId]);
          if (transactionRow) throw supplyError("PAYMENT_TRANSACTION_CONFLICT", 409, "支付流水已绑定其他订单。");
        }
        throw supplyError("SUPPLY_PAYMENT_STATE_CONFLICT", 409, "支付状态已变化，请重新读取订单。");
      }
      return { record: response, replayed: false };
    },

    async updateTrialDelivery(orderId, context, input) {
      const replay = await receipt<SupplyTrialDelivery>(db, context, "UPDATE_TRIAL_DELIVERY");
      if (replay) return { record: replay, replayed: true };
      if (input.secureEndpointRef != null && !/^secure-ref:[A-Za-z0-9._:-]{8,200}$/u.test(input.secureEndpointRef)) {
        fail("secureEndpointRef 必须是安全存储引用，不能提交真实地址。", 400);
      }
      if (input.toStatus === "COMPLETED" && (!input.cleanupEvidenceDigest || !/^sha256:[0-9a-f]{64}$/u.test(input.cleanupEvidenceDigest))) {
        fail("完成清理前必须提交 cleanupEvidenceDigest。", 422);
      }
      const row = await db.first<Row>("SELECT * FROM supply_trial_deliveries WHERE order_id=?", [orderId]);
      if (!row) throw supplyError("SUPPLY_NOT_FOUND", 404, "交付记录不存在。");
      const current = delivery(row);
      if (current.version !== input.expectedVersion) throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "交付记录版本已变化。");
      const transitions: Record<SupplyTrialDelivery["status"], readonly SupplyTrialDelivery["status"][]> = {
        AWAITING_PAYMENT: ["AWAITING_KEY", "FAILED"], AWAITING_KEY: ["PROVISIONING", "FAILED"],
        PROVISIONING: ["READY", "FAILED"], READY: ["IN_SERVICE", "FAILED"],
        IN_SERVICE: ["CLEANING", "FAILED"], CLEANING: ["COMPLETED", "FAILED"], COMPLETED: [], FAILED: ["CLEANING"],
      };
      if (!transitions[current.status].includes(input.toStatus)) throw supplyError("SUPPLY_STATE_CONFLICT", 409, `${current.status} 不能转换为 ${input.toStatus}。`);
      const updatedAt = nowIso();
      const updated: SupplyTrialDelivery = {
        ...current, status: input.toStatus,
        buyerPublicKeyFingerprint: input.buyerPublicKeyFingerprint === undefined ? current.buyerPublicKeyFingerprint : input.buyerPublicKeyFingerprint,
        secureEndpointRef: input.secureEndpointRef === undefined ? current.secureEndpointRef : input.secureEndpointRef,
        hostKeyFingerprint: input.hostKeyFingerprint === undefined ? current.hostKeyFingerprint : input.hostKeyFingerprint,
        credentialExpiresAt: input.credentialExpiresAt === undefined ? current.credentialExpiresAt : input.credentialExpiresAt,
        cleanupEvidenceDigest: input.cleanupEvidenceDigest === undefined ? current.cleanupEvidenceDigest : input.cleanupEvidenceDigest,
        version: current.version + 1, updatedAt,
      };
      if (updated.status === "PROVISIONING" && !updated.buyerPublicKeyFingerprint) fail("进入开通阶段前必须登记买家公钥指纹。", 422);
      if (updated.status === "READY" && (!updated.secureEndpointRef || !updated.hostKeyFingerprint || !updated.credentialExpiresAt || updated.credentialExpiresAt <= updatedAt)) {
        fail("交付就绪前必须登记安全地址引用、主机指纹和有效凭据期限。", 422);
      }
      if (updated.status === "IN_SERVICE") {
        const passed = await db.first<Row>("SELECT id FROM supply_trial_connection_checks WHERE order_id=? AND status='PASSED' ORDER BY started_at DESC LIMIT 1", [orderId]);
        if (!passed) fail("进入服务前必须通过连接检查。", 422);
      }
      let results: SupplyRunResult[];
      try {
        results = await db.batch([
          invariantSql("EXISTS (SELECT 1 FROM supply_trial_deliveries WHERE order_id=? AND version=?)", [orderId, input.expectedVersion]),
          { sql: `UPDATE supply_trial_deliveries SET status=?,buyer_public_key_fingerprint=?,secure_endpoint_ref=?,host_key_fingerprint=?,credential_expires_at=?,cleanup_evidence_digest=?,version=version+1,updated_at=? WHERE order_id=? AND version=?`, values: [updated.status, updated.buyerPublicKeyFingerprint, updated.secureEndpointRef, updated.hostKeyFingerprint, updated.credentialExpiresAt, updated.cleanupEvidenceDigest, updatedAt, orderId, input.expectedVersion] },
          ...(updated.status === "COMPLETED" ? [{ sql: `UPDATE supply_allocation_bindings SET status='RELEASED',updated_at=? WHERE trial_order_id=? AND status IN ('LOCKED','IN_SERVICE')`, values: [updatedAt, orderId] }] satisfies SupplySql[] : []),
          receiptSql(context, "UPDATE_TRIAL_DELIVERY", updated, updatedAt),
        ]);
      } catch {
        throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "交付记录状态已变化。");
      }
      if (results[1]?.changes !== 1) throw supplyError("SUPPLY_VERSION_CONFLICT", 409, "交付记录状态已变化。");
      return { record: updated, replayed: false };
    },

    async recordTrialConnectionCheck(orderId, context, input) {
      const replay = await receipt<SupplyConnectionCheck>(db, context, "RECORD_TRIAL_CONNECTION_CHECK");
      if (replay) return { record: replay, replayed: true };
      const orderRow = await db.first<Row>("SELECT id FROM supply_trial_orders WHERE id=?", [orderId]);
      if (!orderRow) throw supplyError("SUPPLY_NOT_FOUND", 404, "试运行订单不存在。");
      const record: SupplyConnectionCheck = { id: newId("SCC"), orderId, ...input };
      const createdAt = nowIso();
      await db.batch([
        { sql: `INSERT INTO supply_trial_connection_checks (id,order_id,status,diagnostic_code,evidence_digest,started_at,finished_at) VALUES (?,?,?,?,?,?,?)`, values: [record.id, orderId, record.status, record.diagnosticCode, record.evidenceDigest, record.startedAt, record.finishedAt] },
        receiptSql(context, "RECORD_TRIAL_CONNECTION_CHECK", record, createdAt),
      ]);
      return { record, replayed: false };
    },
  };

  return store;
}
