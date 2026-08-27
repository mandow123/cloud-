import { MANAGED_GPU_SCHEMA_VERSION, managedGpuSchemaStatements } from "../../db/managed-gpu-schema.ts";
import {
  ManagedGpuDomainError,
  assertManagedGpuOrderTransition,
  managedGpuNetSettlementMicros,
  requiredManagedGpuAssetEvidence,
  type ManagedGpuAsset,
  type ManagedGpuCurrency,
  type ManagedGpuFacility,
  type ManagedGpuEconomicPolicy,
  type ManagedGpuOrder,
  type ManagedGpuProduct,
  type ManagedGpuQuote,
  type ManagedGpuSettlement,
} from "../managed-gpu.ts";
import { AccountAuthError } from "./account-auth.ts";
import { paidAvailableAllocationStatements } from "./card-hour-paid-entitlements.ts";
import type { ManagedGpuApproval, ManagedGpuApprovalAction, ManagedGpuMutationContext, ManagedGpuServiceRequest, ManagedGpuStore } from "./managed-gpu-store.ts";

export type ManagedGpuSql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export type ManagedGpuRunResult = Readonly<{ changes: number }>;
export interface ManagedGpuDatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  run(sql: string, values?: readonly unknown[]): Promise<ManagedGpuRunResult>;
  batch(statements: readonly ManagedGpuSql[]): Promise<ManagedGpuRunResult[]>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => String(row[key]);
const nullableText = (row: Row, key: string) => row[key] == null ? null : String(row[key]);
const integer = (row: Row, key: string) => Number(row[key]);

function jsonObject(value: unknown) {
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function jsonStrings(value: unknown) {
  try { const parsed = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; }
  catch { return []; }
}

function product(row: Row): ManagedGpuProduct {
  return {
    id: text(row, "id"), hardwareClassId: text(row, "hardware_class_id"), sku: text(row, "sku"), manufacturer: text(row, "manufacturer"), model: text(row, "model"),
    gpuModel: text(row, "gpu_model"), hardwareTier: text(row, "hardware_tier") as ManagedGpuProduct["hardwareTier"], vramGb: row.vram_gb == null ? null : integer(row, "vram_gb"),
    displayName: text(row, "display_name"), sellerName: text(row, "seller_name"), specs: jsonObject(row.specs_json), quoteMode: "QUOTE_REQUIRED",
    sellable: integer(row, "sellable") === 1, status: text(row, "status") as ManagedGpuProduct["status"],
    currency: row.currency == null ? null : text(row, "currency") as ManagedGpuCurrency,
    unitPriceMinor: row.unit_price_minor == null ? null : integer(row, "unit_price_minor"),
    cardHourReferenceMicros: row.card_hour_reference_micros == null ? null : integer(row, "card_hour_reference_micros"),
    warrantyMonths: row.warranty_months == null ? null : integer(row, "warranty_months"),
    estimatedDeliveryDays: row.estimated_delivery_days == null ? null : integer(row, "estimated_delivery_days"),
    fulfillmentModes: jsonStrings(row.fulfillment_modes_json) as ManagedGpuProduct["fulfillmentModes"],
    facilityIds: jsonStrings(row.facility_ids_json), utilization7dBps: row.utilization_7d_bps == null ? null : integer(row, "utilization_7d_bps"),
    utilization30dBps: row.utilization_30d_bps == null ? null : integer(row, "utilization_30d_bps"), quoteValidUntil: nullableText(row, "quote_valid_until"),
    immutableHash: text(row, "immutable_hash"), createdAt: text(row, "created_at"),
  };
}

function facility(row: Row): ManagedGpuFacility {
  return {
    id: text(row, "id"), code: text(row, "code"), displayName: text(row, "display_name"), countryCode: text(row, "country_code"),
    region: text(row, "region"), timezone: text(row, "timezone"), status: text(row, "status") as ManagedGpuFacility["status"],
    custodyTermsVersion: text(row, "custody_terms_version"), version: integer(row, "version"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function economicPolicy(row: Row): ManagedGpuEconomicPolicy {
  return {
    id:text(row,"id"),policyCode:text(row,"policy_code"),versionNumber:integer(row,"version_number"),facilityId:text(row,"facility_id"),
    facilityChargeMicrosPerAssetDay:integer(row,"facility_charge_micros_per_asset_day"),calculation:jsonObject(row.calculation_json),
    effectiveFrom:text(row,"effective_from"),effectiveUntil:nullableText(row,"effective_until"),approvedBy:text(row,"approved_by"),
    immutableHash:text(row,"immutable_hash"),createdAt:text(row,"created_at"),
  };
}

function quote(row: Row): ManagedGpuQuote {
  return {
    id: text(row, "id"), organizationId: text(row, "organization_id"), accountId: text(row, "account_id"),
    productVersionId: text(row, "product_version_id"), facilityId: nullableText(row, "facility_id"), quantity: integer(row, "quantity"),
    fulfillmentChoice: text(row, "fulfillment_choice") as ManagedGpuQuote["fulfillmentChoice"],
    requestedCurrency: text(row, "requested_currency") as ManagedGpuCurrency,
    destinationCountryCode: nullableText(row, "destination_country_code"), status: text(row, "status") as ManagedGpuQuote["status"],
    unitAmountMinor: row.unit_amount_minor == null ? null : integer(row, "unit_amount_minor"),
    totalAmountMinor: row.total_amount_minor == null ? null : integer(row, "total_amount_minor"),
    issuedCurrency: row.issued_currency == null ? null : text(row, "issued_currency") as ManagedGpuCurrency,
    priceBreakdown: row.price_breakdown_json == null ? null : jsonObject(row.price_breakdown_json) as ManagedGpuQuote["priceBreakdown"],
    expiresAt: nullableText(row, "expires_at"), version: integer(row, "version"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function order(row: Row): ManagedGpuOrder {
  return {
    id: text(row, "id"), quoteId: text(row, "quote_id"), organizationId: text(row, "organization_id"), accountId: text(row, "account_id"),
    productVersionId: text(row, "product_version_id"), facilityId: nullableText(row, "facility_id"), quantity: integer(row, "quantity"),
    fulfillmentChoice: text(row, "fulfillment_choice") as ManagedGpuOrder["fulfillmentChoice"], currency: text(row, "currency") as ManagedGpuCurrency,
    totalAmountMinor: integer(row, "total_amount_minor"), status: text(row, "status") as ManagedGpuOrder["status"],
    version: integer(row, "version"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function asset(row: Row): ManagedGpuAsset {
  return {
    id: text(row, "id"), orderId: text(row, "order_id"), unitIndex: integer(row, "unit_index"), ownerOrganizationId: text(row, "owner_organization_id"),
    productVersionId: text(row, "product_version_id"), facilityId: nullableText(row, "facility_id"), serialFingerprint: text(row, "serial_fingerprint"),
    acquisitionAmountMinor: integer(row, "acquisition_amount_minor"), currency: text(row, "currency") as ManagedGpuCurrency, ownershipBps: 10000,
    agentBindingId: nullableText(row, "agent_binding_id"),
    status: text(row, "status") as ManagedGpuAsset["status"], version: integer(row, "version"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function settlement(row: Row): ManagedGpuSettlement {
  return {
    id: text(row, "id"), organizationId: text(row, "organization_id"), assetId: text(row, "asset_id"), periodStart: text(row, "period_start"),
    periodEnd: text(row, "period_end"), grossCardHourMicros: integer(row, "gross_card_hour_micros"),
    refundCardHourMicros: integer(row, "refund_card_hour_micros"), platformFeeMicros: integer(row, "platform_fee_micros"),
    wearMicros: integer(row, "wear_micros"), facilityChargeMicros: integer(row, "facility_charge_micros"),
    earnedCardHourMicros: integer(row, "earned_card_hour_micros"), totalChargeMicros: integer(row, "total_charge_micros"),
    appliedDeductionMicros: integer(row, "applied_deduction_micros"), shortfallMicros: integer(row, "shortfall_micros"), netCardHourMicros: integer(row, "net_card_hour_micros"),
    policyVersionId: text(row, "policy_version_id"), status: text(row, row.current_status == null ? "status" : "current_status") as ManagedGpuSettlement["status"],
    ledgerBatchId: nullableText(row, "current_ledger_batch_id"), outstandingFeeId: nullableText(row, "outstanding_fee_id"),
    outstandingFeeStatus: nullableText(row, "outstanding_fee_status") as ManagedGpuSettlement["outstandingFeeStatus"],
    outstandingFeeDueAt: nullableText(row, "outstanding_fee_due_at"), withdrawable: false, transferable: false, createdAt: text(row, "created_at"),
  };
}

function serviceRequest(row: Row): ManagedGpuServiceRequest {
  return {
    id: text(row, "id"), organizationId: text(row, "organization_id"), accountId: text(row, "account_id"), assetId: text(row, "asset_id"),
    requestType: text(row, "request_type") as ManagedGpuServiceRequest["requestType"], destinationCountryCode: nullableText(row, "destination_country_code"),
    addressReference: nullableText(row, "address_reference"), reason: text(row, "reason"), status: text(row, "status") as ManagedGpuServiceRequest["status"],
    earliestExecutionAt: nullableText(row, "earliest_execution_at"), version: integer(row, "version"), createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at"),
  };
}

function approval(row: Row): ManagedGpuApproval {
  return { id: text(row, "id"), actionType: text(row, "action_type") as ManagedGpuApprovalAction, targetId: text(row, "target_id"), requesterAccountId: text(row, "requester_account_id"), approverAccountId: nullableText(row, "approver_account_id"), payloadHash: text(row, "payload_hash"), commandPayload: jsonObject(row.command_payload_json), status: text(row, "status") as ManagedGpuApproval["status"], version: integer(row, "version"), requestedAt: text(row, "requested_at"), decidedAt: nullableText(row, "decided_at"), consumedAt: nullableText(row, "consumed_at") };
}

function approvalPayloadJson(value: Record<string, unknown>) {
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) { for (const child of item) visit(child); return; }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/(password|secret|private.?key|credential|authorization|cookie)/iu.test(key)) throw invalid("审批内容不得包含密钥或认证信息。");
      visit(child);
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  if (serialized.length > 16_384) throw invalid("审批内容过大。");
  return serialized;
}

function conflict(code: string, message: string) { return new AccountAuthError(code, 409, message); }
function invalid(message: string) { return new AccountAuthError("MANAGED_GPU_VALIDATION_ERROR", 400, message); }
function missing(message: string) { return new AccountAuthError("MANAGED_GPU_NOT_FOUND", 404, message); }
function event(id: string, organizationId: string, entityType: string, entityId: string, eventType: string, payloadHash: string, now: string): ManagedGpuSql {
  return { sql: "INSERT INTO managed_gpu_domain_events(id,organization_id,entity_type,entity_id,event_type,payload_digest,occurred_at) VALUES(?,?,?,?,?,?,?)", values: [id, organizationId, entityType, entityId, eventType, payloadHash, now] };
}

async function receipt(db: ManagedGpuDatabaseAdapter, organizationId: string, scope: string, key: string, hash: string) {
  const row = await db.first<Row>("SELECT payload_hash,entity_id FROM managed_gpu_command_receipts WHERE organization_id=? AND command_scope=? AND idempotency_key=?", [organizationId, scope, key]);
  if (!row) return null;
  if (text(row, "payload_hash") !== hash) throw conflict("MANAGED_GPU_IDEMPOTENCY_CONFLICT", "同一提交标识对应了不同内容。");
  return text(row, "entity_id");
}

const requireOneChange = (): ManagedGpuSql => ({ sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" });

const SETTLEMENT_SELECT = `SELECT settlement.*,
  COALESCE((SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1),'REVIEW_REQUIRED') current_status,
  (SELECT ledger_batch_id FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1) current_ledger_batch_id,
  (SELECT id FROM managed_gpu_outstanding_hosting_fees WHERE settlement_id=settlement.id LIMIT 1) outstanding_fee_id,
  (SELECT due_at FROM managed_gpu_outstanding_hosting_fees WHERE settlement_id=settlement.id LIMIT 1) outstanding_fee_due_at,
  (SELECT fee_event.status FROM managed_gpu_outstanding_hosting_fees fee
    JOIN managed_gpu_outstanding_hosting_fee_events fee_event ON fee_event.fee_id=fee.id
    WHERE fee.settlement_id=settlement.id ORDER BY fee_event.sequence DESC LIMIT 1) outstanding_fee_status
  FROM managed_gpu_settlements settlement`;

async function approvalConsumption(db: ManagedGpuDatabaseAdapter, context: ManagedGpuMutationContext, action: ManagedGpuApprovalAction, targetId: string) {
  if (!context.approvalId) throw conflict("MANAGED_GPU_DUAL_APPROVAL_REQUIRED", "该高风险操作必须由第二位管理员批准后才能执行。");
  const approved = await db.first<Row>(`SELECT id,approver_account_id FROM managed_gpu_approvals WHERE id=? AND action_type=? AND target_id=? AND payload_hash=? AND status='APPROVED'
    AND requester_account_id=? AND requester_organization_id=? AND approver_account_id IS NOT NULL AND approver_account_id<>requester_account_id`, [context.approvalId, action, targetId, context.payloadHash, context.accountId, context.organizationId]);
  if (!approved) throw conflict("MANAGED_GPU_APPROVAL_INVALID", "双人审批不存在、内容不一致、非原申请人执行或已被使用。");
  return { approverAccountId: text(approved, "approver_account_id"), statements: [{ sql: `UPDATE managed_gpu_approvals SET status='CONSUMED',consumed_at=?,version=version+1
    WHERE id=? AND action_type=? AND target_id=? AND payload_hash=? AND status='APPROVED'
      AND requester_account_id=? AND requester_organization_id=? AND approver_account_id IS NOT NULL AND approver_account_id<>requester_account_id`, values: [context.now, context.approvalId, action, targetId, context.payloadHash, context.accountId, context.organizationId] }, requireOneChange()] as const };
}

export async function createManagedGpuStore(db: ManagedGpuDatabaseAdapter): Promise<ManagedGpuStore> {
  await db.ensureSchema(managedGpuSchemaStatements, MANAGED_GPU_SCHEMA_VERSION);
  return {
    async requestApproval(context, input) {
      const existing = await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE requester_organization_id=? AND idempotency_key=?", [context.organizationId, context.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== input.commandPayloadHash || text(existing, "action_type") !== input.actionType || text(existing, "target_id") !== input.targetId) throw conflict("MANAGED_GPU_IDEMPOTENCY_CONFLICT", "同一审批提交标识对应了不同内容。");
        return { record: approval(existing), replayed: true };
      }
      if (!/^[a-f0-9]{64}$/u.test(input.commandPayloadHash)) throw invalid("待执行命令必须使用 SHA-256 摘要。");
      const commandPayloadJson = approvalPayloadJson(input.commandPayload);
      const id = `mgap_${crypto.randomUUID()}`;
      await db.batch([
        { sql: "INSERT INTO managed_gpu_approvals(id,action_type,target_id,requester_account_id,requester_organization_id,approver_account_id,payload_hash,command_payload_json,status,idempotency_key,version,requested_at,decided_at,consumed_at) VALUES(?,?,?,?,?,NULL,?,?,'REQUESTED',?,1,?,NULL,NULL)", values: [id, input.actionType, input.targetId, context.accountId, context.organizationId, input.commandPayloadHash, commandPayloadJson, context.idempotencyKey, context.now] },
        event(`mge_${crypto.randomUUID()}`, context.organizationId, "APPROVAL", id, "APPROVAL_REQUESTED", context.payloadHash, context.now),
      ]);
      return { record: approval((await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [id]))!), replayed: false };
    },
    async approveApproval(context, approvalId, input) {
      const replay = await receipt(db, context.organizationId, "APPROVE_MANAGED_GPU_ACTION", context.idempotencyKey, context.payloadHash);
      if (replay) return { record: approval((await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [replay]))!), replayed: true };
      const current = await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [approvalId]);
      if (!current) throw missing("审批请求不存在。");
      if (text(current, "action_type") !== input.actionType) throw conflict("MANAGED_GPU_APPROVAL_ACTION_MISMATCH", "审批动作与原请求不一致。");
      if (text(current, "requester_organization_id") !== context.organizationId) throw new AccountAuthError("MANAGED_GPU_APPROVAL_FORBIDDEN", 403, "不能审批其他管理组织的请求。");
      if (text(current, "requester_account_id") === context.accountId) throw new AccountAuthError("MANAGED_GPU_SELF_APPROVAL_FORBIDDEN", 403, "申请人不能审批自己的高风险操作。");
      if (text(current, "status") !== "REQUESTED" || integer(current, "version") !== input.expectedVersion) throw conflict("MANAGED_GPU_APPROVAL_STATE_CONFLICT", "审批请求状态已变化。");
      const results = await db.batch([
        { sql: "UPDATE managed_gpu_approvals SET approver_account_id=?,status='APPROVED',version=version+1,decided_at=? WHERE id=? AND status='REQUESTED' AND version=? AND requester_account_id<>? AND requester_organization_id=?", values: [context.accountId, context.now, approvalId, input.expectedVersion, context.accountId, context.organizationId] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [context.organizationId, "APPROVE_MANAGED_GPU_ACTION", context.idempotencyKey, context.payloadHash, approvalId, context.now] },
        event(`mge_${crypto.randomUUID()}`, text(current, "requester_organization_id"), "APPROVAL", approvalId, "APPROVAL_GRANTED", context.payloadHash, context.now),
      ]);
      if (results[0]?.changes !== 1) throw conflict("MANAGED_GPU_APPROVAL_STATE_CONFLICT", "审批请求状态已变化。");
      return { record: approval((await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [approvalId]))!), replayed: false };
    },
    async rejectApproval(context, approvalId, input) {
      const replay = await receipt(db, context.organizationId, "REJECT_MANAGED_GPU_ACTION", context.idempotencyKey, context.payloadHash);
      if (replay) return { record: approval((await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [replay]))!), replayed: true };
      const current = await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [approvalId]);
      if (!current) throw missing("审批请求不存在。");
      if (text(current, "action_type") !== input.actionType) throw conflict("MANAGED_GPU_APPROVAL_ACTION_MISMATCH", "审批动作与原请求不一致。");
      if (text(current, "requester_organization_id") !== context.organizationId) throw new AccountAuthError("MANAGED_GPU_APPROVAL_FORBIDDEN", 403, "不能处理其他管理组织的请求。");
      if (text(current, "requester_account_id") === context.accountId) throw new AccountAuthError("MANAGED_GPU_SELF_APPROVAL_FORBIDDEN", 403, "申请人不能处理自己的高风险操作。");
      if (text(current, "status") !== "REQUESTED" || integer(current, "version") !== input.expectedVersion) throw conflict("MANAGED_GPU_APPROVAL_STATE_CONFLICT", "审批请求状态已变化。");
      const results = await db.batch([
        { sql: "UPDATE managed_gpu_approvals SET approver_account_id=?,status='REJECTED',version=version+1,decided_at=? WHERE id=? AND status='REQUESTED' AND version=? AND requester_account_id<>? AND requester_organization_id=?", values: [context.accountId, context.now, approvalId, input.expectedVersion, context.accountId, context.organizationId] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [context.organizationId, "REJECT_MANAGED_GPU_ACTION", context.idempotencyKey, context.payloadHash, approvalId, context.now] },
        event(`mge_${crypto.randomUUID()}`, text(current, "requester_organization_id"), "APPROVAL", approvalId, "APPROVAL_REJECTED", context.payloadHash, context.now),
      ]);
      if (results[0]?.changes !== 1) throw conflict("MANAGED_GPU_APPROVAL_STATE_CONFLICT", "审批请求状态已变化。");
      return { record: approval((await db.first<Row>("SELECT * FROM managed_gpu_approvals WHERE id=?", [approvalId]))!), replayed: false };
    },
    async listCatalog() {
      const [products, facilities] = await Promise.all([
        db.all<Row>("SELECT * FROM managed_gpu_product_versions WHERE status='ACTIVE' AND sellable=1 ORDER BY display_name,id"),
        db.all<Row>("SELECT * FROM managed_gpu_facilities WHERE status='ACTIVE' AND custody_terms_version<>'PENDING' ORDER BY display_name,id"),
      ]);
      return { records: products.map(product), facilities: facilities.map(facility) };
    },
    async createQuote(context, input) {
      const existing = await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE organization_id=? AND idempotency_key=?", [context.organizationId, context.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== context.payloadHash) throw conflict("MANAGED_GPU_IDEMPOTENCY_CONFLICT", "同一询价标识对应了不同内容。");
        return { record: quote(existing), replayed: true };
      }
      const selectedProduct = await db.first<Row>("SELECT * FROM managed_gpu_product_versions WHERE id=? AND status='ACTIVE' AND sellable=1", [input.productVersionId]);
      if (!selectedProduct) throw new AccountAuthError("MANAGED_GPU_PRODUCT_UNAVAILABLE", 503, "该 GPU 当前仅供参考，尚无已核验可售库存。");
      const inventory = jsonObject(selectedProduct.specs_json);
      const verifiedInventoryCount = Number(inventory.verifiedInventoryCount);
      const inventoryEvidenceDigest = typeof inventory.inventoryEvidenceDigest === "string" ? inventory.inventoryEvidenceDigest : "";
      if (!Number.isSafeInteger(verifiedInventoryCount) || verifiedInventoryCount < input.quantity || !/^[a-f0-9]{64}$/u.test(inventoryEvidenceDigest)) {
        throw new AccountAuthError("MANAGED_GPU_INVENTORY_UNVERIFIED", 503, "该 GPU 没有足量且可审计的已核验库存。");
      }
      if (!jsonStrings(selectedProduct.fulfillment_modes_json).includes(input.fulfillmentChoice)) throw invalid("该 GPU 商品不支持所选履约方式。");
      if (selectedProduct.quote_valid_until && text(selectedProduct, "quote_valid_until") <= context.now) throw new AccountAuthError("MANAGED_GPU_PRODUCT_QUOTE_EXPIRED", 503, "该 GPU 商品报价已过有效期。");
      if (input.fulfillmentChoice === "BEIDOU_HOSTING") {
        const selectedFacility = await db.first<Row>("SELECT id FROM managed_gpu_facilities WHERE id=? AND status='ACTIVE' AND custody_terms_version<>'PENDING'", [input.facilityId]);
        if (!selectedFacility) throw new AccountAuthError("MANAGED_GPU_FACILITY_UNAVAILABLE", 503, "北斗机房尚未通过运营验收。");
        const facilityIds = jsonStrings(selectedProduct.facility_ids_json);
        if (facilityIds.length && !facilityIds.includes(input.facilityId ?? "")) throw invalid("该 GPU 商品不能托管到所选机房。");
      }
      const id = `mgq_${crypto.randomUUID()}`;
      await db.batch([
        { sql: `INSERT INTO managed_gpu_quotes(id,organization_id,account_id,product_version_id,facility_id,quantity,fulfillment_choice,requested_currency,destination_country_code,status,unit_amount_minor,total_amount_minor,issued_currency,expires_at,idempotency_key,payload_hash,version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,'REQUESTED',NULL,NULL,NULL,NULL,?,?,1,?,?)`, values: [id, context.organizationId, context.accountId, input.productVersionId, input.facilityId, input.quantity, input.fulfillmentChoice, input.requestedCurrency, input.destinationCountryCode, context.idempotencyKey, context.payloadHash, context.now, context.now] },
        event(`mge_${crypto.randomUUID()}`, context.organizationId, "QUOTE", id, "QUOTE_REQUESTED", context.payloadHash, context.now),
      ]);
      return { record: quote((await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE id=?", [id]))!), replayed: false };
    },
    async listMemberQuotes(organizationId) { return (await db.all<Row>("SELECT * FROM managed_gpu_quotes WHERE organization_id=? ORDER BY created_at DESC,id DESC", [organizationId])).map(quote); },
    async issueQuote(adminContext, quoteId, input) {
      const replay = await receipt(db, adminContext.organizationId, "ISSUE_QUOTE", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: quote((await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE id=?", [replay]))!), replayed: true };
      if (!Number.isSafeInteger(input.unitAmountMinor) || input.unitAmountMinor <= 0) throw invalid("GPU 单价必须是正整数最小币种。");
      for (const amount of [input.shippingMinor,input.taxMinor,input.otherMinor]) if (!Number.isSafeInteger(amount) || amount < 0) throw invalid("报价费用必须是非负整数最小币种。");
      const current = await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE id=?", [quoteId]);
      if (!current) throw missing("询价不存在。");
      if (text(current, "status") !== "REQUESTED" || integer(current, "version") !== input.expectedVersion) throw conflict("MANAGED_GPU_STATE_CONFLICT", "询价状态已变化。");
      const sourceProduct = await db.first<Row>("SELECT specs_json FROM managed_gpu_product_versions WHERE id=? AND status='ACTIVE' AND sellable=1", [text(current,"product_version_id")]);
      const inventory = sourceProduct ? jsonObject(sourceProduct.specs_json) : {};
      const inventoryCount = Number(inventory.verifiedInventoryCount);
      const reserved = await db.first<Row>("SELECT COALESCE(SUM(quantity),0) amount FROM managed_gpu_quotes WHERE product_version_id=? AND status IN ('ISSUED','ACCEPTED')", [text(current,"product_version_id")]);
      if (!sourceProduct || !Number.isSafeInteger(inventoryCount) || integer(reserved ?? {amount:0},"amount") + integer(current,"quantity") > inventoryCount) {
        throw conflict("MANAGED_GPU_INVENTORY_EXHAUSTED", "已核验库存不足，不能发布该报价。");
      }
      const hardwareSubtotalMinor = input.unitAmountMinor * integer(current,"quantity");
      const totalAmountMinor = hardwareSubtotalMinor + input.shippingMinor + input.taxMinor + input.otherMinor;
      if (![hardwareSubtotalMinor,totalAmountMinor].every(Number.isSafeInteger)) throw invalid("报价金额超出安全范围。");
      const priceBreakdown = JSON.stringify({hardwareSubtotalMinor,shippingMinor:input.shippingMinor,taxMinor:input.taxMinor,otherMinor:input.otherMinor});
      const nextVersion = input.expectedVersion + 1;
      const consume = await approvalConsumption(db, adminContext, "ISSUE_QUOTE", quoteId);
      const results = await db.batch([
        { sql: "UPDATE managed_gpu_quotes SET status='ISSUED',unit_amount_minor=?,total_amount_minor=?,issued_currency=?,price_breakdown_json=?,expires_at=?,version=?,updated_at=? WHERE id=? AND status='REQUESTED' AND version=?", values: [input.unitAmountMinor, totalAmountMinor, input.currency, priceBreakdown, input.expiresAt, nextVersion, adminContext.now, quoteId, input.expectedVersion] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "ISSUE_QUOTE", adminContext.idempotencyKey, adminContext.payloadHash, quoteId, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(current, "organization_id"), "QUOTE", quoteId, "QUOTE_ISSUED", adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      if (results[0]?.changes !== 1) throw conflict("MANAGED_GPU_STATE_CONFLICT", "询价状态已变化。");
      return { record: quote((await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE id=?", [quoteId]))!), replayed: false };
    },
    async acceptQuote(context, quoteId) {
      const existing = await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE organization_id=? AND idempotency_key=?", [context.organizationId, context.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== context.payloadHash) throw conflict("MANAGED_GPU_IDEMPOTENCY_CONFLICT", "同一订单标识对应了不同内容。");
        return { record: order(existing), replayed: true };
      }
      const current = await db.first<Row>("SELECT * FROM managed_gpu_quotes WHERE id=? AND organization_id=?", [quoteId, context.organizationId]);
      if (!current) throw missing("询价不存在。");
      if (text(current, "status") !== "ISSUED" || !current.total_amount_minor || !current.issued_currency || !current.expires_at || text(current, "expires_at") <= context.now) throw conflict("MANAGED_GPU_QUOTE_NOT_ACCEPTABLE", "询价未正式报价或已过期。");
      const id = `mgo_${crypto.randomUUID()}`;
      const results = await db.batch([
        { sql: `INSERT INTO managed_gpu_purchase_orders(id,quote_id,organization_id,account_id,product_version_id,facility_id,quantity,fulfillment_choice,currency,total_amount_minor,status,idempotency_key,payload_hash,version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,'AWAITING_PAYMENT',?,?,1,?,?)`, values: [id, quoteId, context.organizationId, context.accountId, text(current, "product_version_id"), nullableText(current, "facility_id"), integer(current, "quantity"), text(current, "fulfillment_choice"), text(current, "issued_currency"), integer(current, "total_amount_minor"), context.idempotencyKey, context.payloadHash, context.now, context.now] },
        { sql: "UPDATE managed_gpu_quotes SET status='ACCEPTED',version=version+1,updated_at=? WHERE id=? AND status='ISSUED' AND version=?", values: [context.now, quoteId, integer(current, "version")] },
        requireOneChange(),
        event(`mge_${crypto.randomUUID()}`, context.organizationId, "ORDER", id, "ORDER_CREATED", context.payloadHash, context.now),
      ]);
      if (results[1]?.changes !== 1) throw conflict("MANAGED_GPU_STATE_CONFLICT", "询价状态已变化。");
      return { record: order((await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [id]))!), replayed: false };
    },
    async listMemberOrders(organizationId) { return (await db.all<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE organization_id=? ORDER BY created_at DESC,id DESC", [organizationId])).map(order); },
    async getMemberOrder(organizationId, orderId) { const row = await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=? AND organization_id=?", [orderId, organizationId]); return row ? order(row) : null; },
    async listMemberAssets(organizationId) { return (await db.all<Row>("SELECT * FROM managed_gpu_physical_assets WHERE owner_organization_id=? ORDER BY created_at DESC,id DESC", [organizationId])).map(asset); },
    async listMemberSettlements(organizationId) { return (await db.all<Row>(`${SETTLEMENT_SELECT} WHERE settlement.organization_id=? ORDER BY settlement.period_end DESC,settlement.id DESC`, [organizationId])).map(settlement); },
    async createServiceRequest(context, input) {
      const existing = await db.first<Row>("SELECT * FROM managed_gpu_service_requests WHERE organization_id=? AND idempotency_key=?", [context.organizationId, context.idempotencyKey]);
      if (existing) {
        if (text(existing, "payload_hash") !== context.payloadHash) throw conflict("MANAGED_GPU_IDEMPOTENCY_CONFLICT", "同一服务请求标识对应了不同内容。");
        return { record: serviceRequest(existing), replayed: true };
      }
      const owned = await db.first<Row>("SELECT id,status FROM managed_gpu_physical_assets WHERE id=? AND owner_organization_id=?", [input.assetId, context.organizationId]);
      if (!owned) throw missing("GPU 资产不存在。");
      if (["DELIVERED", "RETIRED"].includes(text(owned, "status"))) throw conflict("MANAGED_GPU_ASSET_NOT_SERVICEABLE", "该资产当前不能提交退出或寄送请求。");
      const id = `mgr_${crypto.randomUUID()}`;
      const earliestExecutionAt = input.requestType === "EXIT_HOSTING" ? new Date(Date.parse(context.now) + 30 * 86_400_000).toISOString() : null;
      await db.batch([
        { sql: `INSERT INTO managed_gpu_service_requests(id,organization_id,account_id,asset_id,request_type,destination_country_code,address_reference,reason,status,earliest_execution_at,idempotency_key,payload_hash,version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'REQUESTED',?,?,?,1,?,?)`, values: [id, context.organizationId, context.accountId, input.assetId, input.requestType, input.destinationCountryCode, input.addressReference, input.reason, earliestExecutionAt, context.idempotencyKey, context.payloadHash, context.now, context.now] },
        event(`mge_${crypto.randomUUID()}`, context.organizationId, "SERVICE_REQUEST", id, `${input.requestType}_REQUESTED`, context.payloadHash, context.now),
      ]);
      return { record: serviceRequest((await db.first<Row>("SELECT * FROM managed_gpu_service_requests WHERE id=?", [id]))!), replayed: false };
    },
    async payOutstandingHostingFee(context, feeId, input) {
      const replay = await receipt(db, context.organizationId,"PAY_MANAGED_GPU_HOSTING_FEE",context.idempotencyKey,context.payloadHash);
      if (replay) return { feeId:replay,status:"PAID" as const,replayed:true };
      const fee = await db.first<Row>(`SELECT fee.*,(SELECT status FROM managed_gpu_outstanding_hosting_fee_events WHERE fee_id=fee.id ORDER BY sequence DESC LIMIT 1) current_status FROM managed_gpu_outstanding_hosting_fees fee WHERE fee.id=? AND fee.organization_id=?`,[feeId,context.organizationId]);
      if (!fee) throw missing("待缴托管费用不存在。");
      if (text(fee,"current_status") !== "PENDING" && text(fee,"current_status") !== "OVERDUE") throw conflict("MANAGED_GPU_HOSTING_FEE_STATE_CONFLICT","该托管费用已处理。");
      const amount = integer(fee,"amount_micros");
      if (!Number.isSafeInteger(input.expectedAmountMicros) || input.expectedAmountMicros !== amount) throw conflict("MANAGED_GPU_HOSTING_FEE_AMOUNT_CHANGED","待缴金额已变化，请刷新后重新授权。");
      const wallet = await db.first<Row>("SELECT available_micros FROM card_hour_wallets WHERE organization_id=?",[context.organizationId]);
      if (!wallet || integer(wallet,"available_micros") < amount) throw conflict("MANAGED_GPU_CARD_HOUR_BALANCE_INSUFFICIENT","可用卡时不足，未执行扣款。");
      const entitlementStatements = await paidAvailableAllocationStatements(db,{organizationId:context.organizationId,amountMicros:amount,now:context.now,destination:"SPENT"});
      const batchId=`chb_${crypto.randomUUID()}`;
      const latestEvent=await db.first<Row>("SELECT sequence FROM managed_gpu_outstanding_hosting_fee_events WHERE fee_id=? ORDER BY sequence DESC LIMIT 1",[feeId]);
      await db.batch([
        ...entitlementStatements,
        {sql:"UPDATE card_hour_wallets SET available_micros=available_micros-?,lifetime_spent_micros=lifetime_spent_micros+?,version=version+1,updated_at=? WHERE organization_id=? AND available_micros>=?",values:[amount,amount,context.now,context.organizationId,amount]},
        requireOneChange(),
        {sql:"INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) VALUES(?,?,'ORDER_CAPTURE',?,?,'POSTED',?,?)",values:[batchId,context.organizationId,`managed-gpu-hosting-fee:${feeId}`,amount,JSON.stringify({sourceSystem:"MANAGED_GPU_HOSTING_FEE",feeId,settlementId:text(fee,"settlement_id"),authorizedBy:context.accountId}),context.now]},
        {sql:"INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','DEBIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=?",values:[`che_${crypto.randomUUID()}`,batchId,context.organizationId,amount,context.now,context.organizationId]},
        {sql:"INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) VALUES(?,?,NULL,'PLATFORM_MANAGED_GPU_HOSTING_FEE','CREDIT',?,NULL,?)",values:[`che_${crypto.randomUUID()}`,batchId,amount,context.now]},
        {sql:"INSERT INTO managed_gpu_outstanding_hosting_fee_events(id,fee_id,sequence,status,payload_digest,occurred_at) VALUES(?,?,?,'PAID',?,?)",values:[`mgfee_evt_${crypto.randomUUID()}`,feeId,integer(latestEvent??{sequence:0},"sequence")+1,context.payloadHash,context.now]},
        {sql:"INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)",values:[context.organizationId,"PAY_MANAGED_GPU_HOSTING_FEE",context.idempotencyKey,context.payloadHash,feeId,context.now]},
        event(`mge_${crypto.randomUUID()}`,context.organizationId,"HOSTING_FEE",feeId,"HOSTING_FEE_PAID",context.payloadHash,context.now),
      ]);
      return {feeId,status:"PAID" as const,replayed:false};
    },
    async memberSummary(organizationId) {
      const [orders, assets, active, settlements, confirmedIncome, provisionalIncome] = await Promise.all([
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_purchase_orders WHERE organization_id=?", [organizationId]),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_physical_assets WHERE owner_organization_id=?", [organizationId]),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_physical_assets WHERE owner_organization_id=? AND status='ACTIVE'", [organizationId]),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_settlements WHERE organization_id=?", [organizationId]),
        db.first<Row>(`SELECT COALESCE(SUM(net_card_hour_micros),0) AS amount FROM managed_gpu_settlements settlement WHERE organization_id=? AND (SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1)='POSTED'`, [organizationId]),
        db.first<Row>(`SELECT COALESCE(SUM(net_card_hour_micros),0) AS amount FROM managed_gpu_settlements settlement WHERE organization_id=? AND COALESCE((SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1),'REVIEW_REQUIRED') NOT IN ('POSTED','REVERSED')`, [organizationId]),
      ]);
      return { orderCount: integer(orders ?? { count: 0 }, "count"), assetCount: integer(assets ?? { count: 0 }, "count"), activeAssetCount: integer(active ?? { count: 0 }, "count"), settlementCount: integer(settlements ?? { count: 0 }, "count"), confirmedIncomeCardHourMicros: integer(confirmedIncome ?? { amount: 0 }, "amount"), provisionalIncomeCardHourMicros: integer(provisionalIncome ?? { amount: 0 }, "amount"), withdrawable: false as const, transferable: false as const };
    },
    async listAdminOrders() { return (await db.all<Row>("SELECT * FROM managed_gpu_purchase_orders ORDER BY created_at DESC,id DESC")).map(order); },
    async adminOverview() {
      const [products, facilities, economicPolicies, quotes, orders, assets, settlements, serviceRequests, approvals, productCount, facilityCount, economicPolicyCount, quoteCount, orderCount, assetCount, settlementCount, serviceRequestCount, approvalCount] = await Promise.all([
        db.all<Row>("SELECT * FROM managed_gpu_product_versions ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_facilities ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_economic_policy_versions ORDER BY effective_from DESC,version_number DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_quotes ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_purchase_orders ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_physical_assets ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>(`${SETTLEMENT_SELECT} ORDER BY settlement.period_end DESC,settlement.id DESC LIMIT 200`),
        db.all<Row>("SELECT * FROM managed_gpu_service_requests ORDER BY created_at DESC,id DESC LIMIT 200"),
        db.all<Row>("SELECT * FROM managed_gpu_approvals ORDER BY requested_at DESC,id DESC LIMIT 200"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_product_versions"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_facilities"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_economic_policy_versions"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_quotes"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_purchase_orders"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_physical_assets"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_settlements"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_service_requests"),
        db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_approvals"),
      ]);
      return { products:products.map(product),facilities:facilities.map(facility),economicPolicies:economicPolicies.map(economicPolicy),quotes: quotes.map(quote), orders: orders.map(order), assets: assets.map(asset), settlements: settlements.map(settlement), serviceRequests: serviceRequests.map(serviceRequest), approvals: approvals.map(approval), counts: { products:integer(productCount??{count:0},"count"),facilities:integer(facilityCount??{count:0},"count"),economicPolicies:integer(economicPolicyCount??{count:0},"count"),quotes: integer(quoteCount ?? { count: 0 }, "count"), orders: integer(orderCount ?? { count: 0 }, "count"), assets: integer(assetCount ?? { count: 0 }, "count"), settlements: integer(settlementCount ?? { count: 0 }, "count"), serviceRequests: integer(serviceRequestCount ?? { count: 0 }, "count"), approvals: integer(approvalCount ?? { count: 0 }, "count") } };
    },
    async recordPaymentEvidence(adminContext, input) {
      const replay = await receipt(db, adminContext.organizationId, "RECORD_PAYMENT_EVIDENCE", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { eventId: replay, replayed: true };
      const sourceOrder = await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [input.orderId]);
      if (!sourceOrder) throw missing("订单不存在。");
      if (text(sourceOrder, "status") !== "AWAITING_PAYMENT") throw conflict("MANAGED_GPU_ORDER_PAYMENT_STATE_INVALID", "只有待付款订单可以登记付款证据。");
      if (input.currency !== text(sourceOrder, "currency")) throw invalid("付款证据币种与订单不一致。");
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid("付款证据金额无效。");
      if (!/^[a-f0-9]{64}$/u.test(input.payloadDigest)) throw invalid("付款证据必须包含 SHA-256 摘要。");
      if (!/^[A-Za-z0-9_.:-]{2,80}$/u.test(input.provider)) throw invalid("付款渠道标识无效。");
      if (!/^[A-Za-z0-9_.:/-]{4,160}$/u.test(input.providerReference)) throw invalid("付款流水号无效。");
      const occurredAt = Date.parse(input.occurredAt);
      if (!Number.isFinite(occurredAt) || occurredAt > Date.parse(adminContext.now) + 300_000) throw invalid("付款证据时间无效。");
      const eventId = `mgp_${crypto.randomUUID()}`;
      const consume = await approvalConsumption(db, adminContext, "RECORD_PAYMENT_EVIDENCE", input.orderId);
      await db.batch([
        { sql: "INSERT INTO managed_gpu_payment_events(id,order_id,provider,provider_reference,event_type,amount_minor,currency,payload_digest,occurred_at,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)", values: [eventId, input.orderId, input.provider, input.providerReference, input.eventType, input.amountMinor, input.currency, input.payloadDigest, input.occurredAt, adminContext.now] },
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "RECORD_PAYMENT_EVIDENCE", adminContext.idempotencyKey, adminContext.payloadHash, eventId, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(sourceOrder, "organization_id"), "ORDER", input.orderId, `PAYMENT_${input.eventType}_EVIDENCE_RECORDED`, adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      return { eventId, replayed: false };
    },
    async transitionOrder(adminContext, orderId, input) {
      const replay = await receipt(db, adminContext.organizationId, "TRANSITION_ORDER", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: order((await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [replay]))!), replayed: true };
      const current = await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [orderId]);
      if (!current) throw missing("订单不存在。");
      if (integer(current, "version") !== input.expectedVersion) throw conflict("MANAGED_GPU_STATE_CONFLICT", "订单版本已变化。");
      try { assertManagedGpuOrderTransition(text(current, "status") as ManagedGpuOrder["status"], input.toStatus); }
      catch (error) { if (error instanceof ManagedGpuDomainError) throw invalid(error.message); throw error; }
      if (input.toStatus === "PAID") {
        const payment = await db.first<Row>(`SELECT
          COALESCE(SUM(CASE WHEN event_type='CAPTURED' THEN amount_minor ELSE 0 END),0) AS captured_minor,
          COALESCE(SUM(CASE WHEN event_type IN ('REFUNDED','CHARGEBACK','REVERSAL') THEN amount_minor ELSE 0 END),0) AS reversed_minor,
          COUNT(*) AS event_count
          FROM managed_gpu_payment_events WHERE order_id=? AND currency=?`, [orderId, text(current, "currency")]);
        const captured = integer(payment ?? { captured_minor: 0 }, "captured_minor");
        const reversed = integer(payment ?? { reversed_minor: 0 }, "reversed_minor");
        if (integer(payment ?? { event_count: 0 }, "event_count") < 1 || captured - reversed !== integer(current, "total_amount_minor")) {
          throw conflict("MANAGED_GPU_PAYMENT_EVIDENCE_MISMATCH", "已收妥付款证据的净额与订单金额不一致，不能标记为已付款。");
        }
      }
      if (input.toStatus === "ASSET_ASSIGNED") {
        const assigned = await db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_physical_assets WHERE order_id=?", [orderId]);
        if (integer(assigned ?? { count: 0 }, "count") !== integer(current, "quantity")) throw conflict("MANAGED_GPU_ASSET_COUNT_MISMATCH", "实物资产数量尚未与订单数量完全匹配。");
      }
      if (input.toStatus === "FULFILLED") {
        const requiredStatus = text(current, "fulfillment_choice") === "BEIDOU_HOSTING" ? "ACTIVE" : "DELIVERED";
        const fulfilled = await db.first<Row>("SELECT COUNT(*) AS count FROM managed_gpu_physical_assets WHERE order_id=? AND status=?", [orderId, requiredStatus]);
        if (integer(fulfilled ?? { count: 0 }, "count") !== integer(current, "quantity")) throw conflict("MANAGED_GPU_FULFILLMENT_EVIDENCE_MISSING", "全部实物资产尚未完成对应的托管上线或签收证据。");
      }
      if (input.toStatus === "REFUNDED") {
        const payment = await db.first<Row>(`SELECT
          COALESCE(SUM(CASE WHEN event_type='CAPTURED' THEN amount_minor ELSE 0 END),0) AS captured_minor,
          COALESCE(SUM(CASE WHEN event_type IN ('REFUNDED','CHARGEBACK','REVERSAL') THEN amount_minor ELSE 0 END),0) AS reversed_minor
          FROM managed_gpu_payment_events WHERE order_id=? AND currency=?`, [orderId, text(current, "currency")]);
        if (integer(payment ?? { captured_minor: 0 }, "captured_minor") !== integer(payment ?? { reversed_minor: 0 }, "reversed_minor")) throw conflict("MANAGED_GPU_REFUND_EVIDENCE_MISMATCH", "付款冲正证据尚未完整覆盖原付款金额。");
      }
      const consume = await approvalConsumption(db, adminContext, "TRANSITION_ORDER", orderId);
      const results = await db.batch([
        { sql: "UPDATE managed_gpu_purchase_orders SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?", values: [input.toStatus, adminContext.now, orderId, input.expectedVersion] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "TRANSITION_ORDER", adminContext.idempotencyKey, adminContext.payloadHash, orderId, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(current, "organization_id"), "ORDER", orderId, `ORDER_${input.toStatus}`, adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      if (results[0]?.changes !== 1) throw conflict("MANAGED_GPU_STATE_CONFLICT", "订单版本已变化。");
      return { record: order((await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [orderId]))!), replayed: false };
    },
    async createAsset(adminContext, input) {
      const replay = await receipt(db, adminContext.organizationId, "CREATE_ASSET", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [replay]))!), replayed: true };
      const sourceOrder = await db.first<Row>("SELECT * FROM managed_gpu_purchase_orders WHERE id=?", [input.orderId]);
      if (!sourceOrder) throw missing("订单不存在。");
      if (!["PAID", "PROCUREMENT", "ASSET_ASSIGNED"].includes(text(sourceOrder, "status"))) throw conflict("MANAGED_GPU_ORDER_NOT_FUNDED", "只有已付款并进入采购的订单可以分配实物资产。");
      if (input.status !== "EXPECTED") throw invalid("实物资产必须从 EXPECTED 开始，不能跳过收货、验真和安装证据。");
      const quantity = integer(sourceOrder, "quantity");
      if (!Number.isSafeInteger(input.unitIndex) || input.unitIndex < 1 || input.unitIndex > quantity) throw invalid("资产序号超出订单购买数量。");
      if (!/^[a-f0-9]{64}$/u.test(input.serialFingerprint)) throw invalid("序列号只能保存 SHA-256 指纹。");
      if (nullableText(sourceOrder, "facility_id") !== input.facilityId) throw invalid("资产机房必须与已接受报价的履约地点一致。");
      const total = integer(sourceOrder, "total_amount_minor");
      const base = Math.floor(total / quantity);
      const amount = base + (input.unitIndex <= total % quantity ? 1 : 0);
      const id = `mga_${crypto.randomUUID()}`;
      const consume = await approvalConsumption(db, adminContext, "CREATE_ASSET", input.orderId);
      await db.batch([
        { sql: `INSERT INTO managed_gpu_physical_assets(id,order_id,unit_index,owner_organization_id,product_version_id,facility_id,serial_fingerprint,acquisition_amount_minor,currency,ownership_bps,status,version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,10000,?,1,?,?)`, values: [id, input.orderId, input.unitIndex, text(sourceOrder, "organization_id"), text(sourceOrder, "product_version_id"), input.facilityId, input.serialFingerprint, amount, text(sourceOrder, "currency"), input.status, adminContext.now, adminContext.now] },
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "CREATE_ASSET", adminContext.idempotencyKey, adminContext.payloadHash, id, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(sourceOrder, "organization_id"), "ASSET", id, "ASSET_EXPECTED", adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [id]))!), replayed: false };
    },
    async transitionAsset(adminContext, assetId, input) {
      const replay = await receipt(db, adminContext.organizationId, "TRANSITION_ASSET", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [replay]))!), replayed: true };
      const current = await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [assetId]);
      if (!current) throw missing("GPU 资产不存在。");
      if (integer(current, "version") !== input.expectedVersion) throw conflict("MANAGED_GPU_STATE_CONFLICT", "资产版本已变化。");
      if (input.toStatus === "SHIPPING") throw conflict("MANAGED_GPU_SHIP_ASSET_PATH_REQUIRED", "设备寄送只能通过已批准的专用寄送流程执行。");
      let evidenceType;
      try { evidenceType = requiredManagedGpuAssetEvidence(text(current, "status") as ManagedGpuAsset["status"], input.toStatus); }
      catch (error) { if (error instanceof ManagedGpuDomainError) throw invalid(error.message); throw error; }
      if (!/^[a-f0-9]{64}$/u.test(input.evidenceDigest)) throw invalid("资产状态证据必须包含 SHA-256 摘要。");
      if ((input.toStatus === "INSTALLED" || input.toStatus === "ACTIVE") && !input.agentBindingId) throw invalid("安装和上线必须绑定已验真的 KAI Agent。");
      if (input.toStatus === "INSTALLED" && input.agentBindingId) {
        const occupied = await db.first<Row>("SELECT id FROM managed_gpu_physical_assets WHERE agent_binding_id=? AND id<>?", [input.agentBindingId,assetId]);
        if (occupied) throw conflict("MANAGED_GPU_AGENT_BINDING_ALREADY_ASSIGNED", "MVP 要求一张物理 GPU 唯一绑定一个 Hosting 设备/Agent，不能复用绑定。");
      }
      if (input.toStatus === "ACTIVE" && nullableText(current, "agent_binding_id") && nullableText(current, "agent_binding_id") !== input.agentBindingId) throw conflict("MANAGED_GPU_AGENT_BINDING_MISMATCH", "上线证据与安装时绑定的 Agent 不一致。");
      let drainAttestation: ManagedGpuSql | null = null;
      if (input.toStatus === "DRAINING") {
        const binding = nullableText(current, "agent_binding_id");
        const verifiedAt = input.verifiedAt == null ? Number.NaN : Date.parse(input.verifiedAt);
        const now = Date.parse(adminContext.now);
        if (!binding || input.agentBindingId !== binding || input.allocationCount !== 0 || input.processCount !== 0 || !Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > 15 * 60_000) {
          throw conflict("MANAGED_GPU_DRAIN_ATTESTATION_REQUIRED", "排空必须包含最近 15 分钟内由已绑定 Agent 证明的零分配、零进程证据。");
        }
        drainAttestation = { sql: "INSERT INTO managed_gpu_asset_drain_attestations(id,asset_id,agent_binding_id,allocation_count,process_count,evidence_digest,verified_at,recorded_at) VALUES(?,?,?,?,?,?,?,?)", values: [`mgda_${crypto.randomUUID()}`,assetId,binding,0,0,input.evidenceDigest,input.verifiedAt,adminContext.now] };
      }
      const nextBinding = input.toStatus === "INSTALLED" ? input.agentBindingId : nullableText(current, "agent_binding_id");
      const evidenceId = `mgev_${crypto.randomUUID()}`;
      const consume = await approvalConsumption(db, adminContext, "TRANSITION_ASSET", assetId);
      const results = await db.batch([
        { sql: "INSERT INTO managed_gpu_asset_evidence(id,asset_id,evidence_type,evidence_digest,agent_binding_id,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?)", values: [evidenceId, assetId, evidenceType, input.evidenceDigest, input.agentBindingId, adminContext.accountId, adminContext.now] },
        ...(drainAttestation ? [drainAttestation] : []),
        { sql: "UPDATE managed_gpu_physical_assets SET status=?,agent_binding_id=?,version=version+1,updated_at=? WHERE id=? AND status=? AND version=?", values: [input.toStatus, nextBinding, adminContext.now, assetId, text(current, "status"), input.expectedVersion] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "TRANSITION_ASSET", adminContext.idempotencyKey, adminContext.payloadHash, assetId, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(current, "owner_organization_id"), "ASSET", assetId, `ASSET_${input.toStatus}`, adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      const updateIndex = drainAttestation ? 2 : 1;
      if (results[updateIndex]?.changes !== 1) throw conflict("MANAGED_GPU_STATE_CONFLICT", "资产版本已变化。");
      return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [assetId]))!), replayed: false };
    },
    async createSettlement(adminContext, input) {
      const replay = await receipt(db, adminContext.organizationId, "CREATE_SETTLEMENT", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: settlement((await db.first<Row>(`${SETTLEMENT_SELECT} WHERE settlement.id=?`, [replay]))!), replayed: true };
      const ownedAsset = await db.first<Row>(`SELECT asset.*,product.hardware_tier FROM managed_gpu_physical_assets asset
        JOIN managed_gpu_product_versions product ON product.id=asset.product_version_id WHERE asset.id=?`, [input.assetId]);
      if (!ownedAsset) throw missing("GPU 资产不存在。");
      if (!(input.periodStart < input.periodEnd)) throw invalid("结算周期无效。");
      const policy = await db.first<Row>("SELECT id,facility_charge_micros_per_asset_day,effective_from,effective_until FROM managed_gpu_economic_policy_versions WHERE id=?", [input.policyVersionId]);
      if (!policy || text(policy, "effective_from") > input.periodStart || (policy.effective_until && text(policy, "effective_until") < input.periodEnd)) throw invalid("结算政策版本不覆盖该周期。");
      const saleFacts=await db.first<Row>(`SELECT
        COALESCE(SUM(CASE WHEN sale.event_type='CAPTURED' THEN sale.card_hour_micros ELSE 0 END),0) AS gross_card_hour_micros,
        COALESCE(SUM(CASE WHEN sale.event_type IN ('REFUNDED','CHARGEBACK','REVERSAL') THEN sale.card_hour_micros ELSE 0 END),0) AS refund_card_hour_micros,
        COUNT(*) AS event_count
        FROM managed_gpu_compute_sale_events sale
        JOIN card_hour_ledger_batches batch ON batch.id=sale.capture_batch_id AND batch.status='POSTED'
          AND ((sale.event_type='CAPTURED' AND batch.operation='ORDER_CAPTURE') OR (sale.event_type IN ('REFUNDED','CHARGEBACK','REVERSAL') AND batch.operation='ORDER_REFUND'))
          AND json_extract(batch.metadata_json,'$.sourceSystem')='HOSTING_V2'
        WHERE sale.asset_id=? AND sale.source_entry_kind='MANAGED_GPU_INCOME' AND sale.source_entry_status='POSTED'
          AND sale.occurred_at>=? AND sale.occurred_at<?`,[input.assetId,input.periodStart,input.periodEnd]);
      const verifiedGross=integer(saleFacts??{gross_card_hour_micros:0},"gross_card_hour_micros"),verifiedRefund=integer(saleFacts??{refund_card_hour_micros:0},"refund_card_hour_micros");
      if (integer(saleFacts??{event_count:0},"event_count")<1) throw conflict("MANAGED_GPU_SALES_EVIDENCE_MISSING","没有已验收且已扣卡时的真实算力成交事件，不能计算收益。");
      const afterRefund = verifiedGross - verifiedRefund;
      if (afterRefund < 0) throw conflict("MANAGED_GPU_SALES_RECONCILIATION_MISMATCH","真实成交冲正卡时超过已收妥卡时。");
      const lifetime = await db.first<Row>(`SELECT COALESCE(SUM(CASE WHEN sale.event_type='CAPTURED' THEN sale.card_hour_micros ELSE -sale.card_hour_micros END),0) amount
        FROM managed_gpu_compute_sale_events sale JOIN managed_gpu_physical_assets asset ON asset.id=sale.asset_id
        WHERE asset.owner_organization_id=? AND sale.source_entry_status='POSTED' AND sale.occurred_at<?`, [text(ownedAsset,"owner_organization_id"), input.periodEnd]);
      const feeTier = await db.first<Row>(`SELECT tier.policy_version_id,tier.tier_code,tier.platform_fee_bps FROM managed_gpu_fee_tiers tier
        JOIN managed_gpu_fee_policy_versions policy_version ON policy_version.id=tier.policy_version_id
        WHERE policy_version.effective_from<=? AND tier.minimum_lifetime_card_hour_micros<=?
        ORDER BY policy_version.effective_from DESC,tier.minimum_lifetime_card_hour_micros DESC LIMIT 1`, [input.periodStart, Math.max(0, integer(lifetime ?? {amount:0},"amount"))]);
      if (!feeTier) throw conflict("MANAGED_GPU_FEE_POLICY_MISSING", "缺少已生效的累计成交量平台费阶梯，不能结算。");
      const wearBpsByTier = { CONSUMER: 1000, WORKSTATION: 700, DATACENTER: 500 } as const;
      const hardwareTier = text(ownedAsset,"hardware_tier") as keyof typeof wearBpsByTier;
      const wearReserveBps = wearBpsByTier[hardwareTier];
      if (!wearReserveBps) throw conflict("MANAGED_GPU_HARDWARE_TIER_INVALID", "GPU 硬件等级未核定，不能结算磨损。");
      const periodMilliseconds = Date.parse(input.periodEnd) - Date.parse(input.periodStart);
      if (!Number.isFinite(periodMilliseconds) || periodMilliseconds <= 0) throw invalid("结算周期时间格式无效。");
      const chargeDays = Math.ceil(periodMilliseconds / 86_400_000);
      const settlementInput = {
        grossCardHourMicros: verifiedGross,
        refundCardHourMicros: verifiedRefund,
        platformFeeMicros: Math.floor(afterRefund * integer(feeTier, "platform_fee_bps") / 10_000),
        wearMicros: Math.floor(afterRefund * wearReserveBps / 10_000),
        facilityChargeMicros: integer(policy, "facility_charge_micros_per_asset_day") * chargeDays,
      };
      let totals;
      try { totals = managedGpuNetSettlementMicros(settlementInput); }
      catch (error) { if (error instanceof ManagedGpuDomainError) throw invalid(error.message); throw error; }
      const id = `mgs_${crypto.randomUUID()}`;
      const settlementEventId = `mgse_${crypto.randomUUID()}`;
      const feeId = totals.shortfallMicros > 0 ? `mgfee_${crypto.randomUUID()}` : null;
      const dueAt = new Date(Date.parse(adminContext.now) + 7 * 86_400_000).toISOString();
      const consume = await approvalConsumption(db, adminContext, "CREATE_SETTLEMENT", input.assetId);
      await db.batch([
        { sql: `INSERT INTO managed_gpu_settlements(id,organization_id,asset_id,period_start,period_end,gross_card_hour_micros,refund_card_hour_micros,platform_fee_micros,wear_micros,facility_charge_micros,earned_card_hour_micros,total_charge_micros,applied_deduction_micros,shortfall_micros,net_card_hour_micros,policy_version_id,fee_policy_version_id,fee_tier_code,platform_fee_bps,wear_reserve_bps,status,ledger_entry_id,source_key,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'REVIEW_REQUIRED',NULL,?,?)`, values: [id, text(ownedAsset, "owner_organization_id"), input.assetId, input.periodStart, input.periodEnd, settlementInput.grossCardHourMicros, settlementInput.refundCardHourMicros, settlementInput.platformFeeMicros, settlementInput.wearMicros, settlementInput.facilityChargeMicros, totals.earnedCardHourMicros, totals.totalChargeMicros, totals.appliedDeductionMicros, totals.shortfallMicros, totals.netCardHourMicros, input.policyVersionId, text(feeTier,"policy_version_id"), text(feeTier,"tier_code"), integer(feeTier,"platform_fee_bps"), wearReserveBps, input.sourceKey, adminContext.now] },
        { sql: "INSERT INTO managed_gpu_settlement_events(id,settlement_id,sequence,status,requested_by,approved_by,approval_id,ledger_batch_id,payload_digest,occurred_at) VALUES(?,?,1,'REVIEW_REQUIRED',?,NULL,NULL,NULL,?,?)", values: [settlementEventId,id,adminContext.accountId,adminContext.payloadHash,adminContext.now] },
        ...(feeId ? [
          { sql: "INSERT INTO managed_gpu_outstanding_hosting_fees(id,settlement_id,organization_id,asset_id,amount_micros,due_at,automatic_debit_authorization_id,created_at) VALUES(?,?,?,?,?,?,NULL,?)", values: [feeId,id,text(ownedAsset,"owner_organization_id"),input.assetId,totals.shortfallMicros,dueAt,adminContext.now] },
          { sql: "INSERT INTO managed_gpu_outstanding_hosting_fee_events(id,fee_id,sequence,status,payload_digest,occurred_at) VALUES(?,?,1,'PENDING',?,?)", values: [`mgfee_evt_${crypto.randomUUID()}`,feeId,adminContext.payloadHash,adminContext.now] },
        ] : []),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId, "CREATE_SETTLEMENT", adminContext.idempotencyKey, adminContext.payloadHash, id, adminContext.now] },
        event(`mge_${crypto.randomUUID()}`, text(ownedAsset, "owner_organization_id"), "SETTLEMENT", id, "SETTLEMENT_REVIEW_REQUIRED", adminContext.payloadHash, adminContext.now),
        ...consume.statements,
      ]);
      return { record: settlement((await db.first<Row>(`${SETTLEMENT_SELECT} WHERE settlement.id=?`, [id]))!), replayed: false };
    },
    async transitionSettlement(adminContext, settlementId, input) {
      const replay = await receipt(db, adminContext.organizationId, "TRANSITION_SETTLEMENT", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: settlement((await db.first<Row>(`${SETTLEMENT_SELECT} WHERE settlement.id=?`, [replay]))!), replayed: true };
      const current = await db.first<Row>(`${SETTLEMENT_SELECT} WHERE settlement.id=?`, [settlementId]);
      if (!current) throw missing("GPU 托管月度结算不存在。");
      if (text(current,"current_status") !== input.expectedStatus) throw conflict("MANAGED_GPU_SETTLEMENT_STATE_CONFLICT", "月度结算状态已变化。");
      const allowed: Record<string,string> = { REVIEW_REQUIRED: "READY", READY: "APPROVED", APPROVED: "POSTED" };
      if (allowed[input.expectedStatus] !== input.toStatus) throw invalid("月度结算只允许 REVIEW_REQUIRED→READY→APPROVED→POSTED 顺序推进。");
      const latestEvent = await db.first<Row>("SELECT * FROM managed_gpu_settlement_events WHERE settlement_id=? ORDER BY sequence DESC LIMIT 1", [settlementId]);
      if (!latestEvent) throw conflict("MANAGED_GPU_SETTLEMENT_EVENT_MISSING", "月度结算事件链不完整。");
      const consume = await approvalConsumption(db, adminContext, "TRANSITION_SETTLEMENT", settlementId);
      const outstanding = await db.first<Row>(`SELECT fee.id,fee.due_at,
        (SELECT status FROM managed_gpu_outstanding_hosting_fee_events WHERE fee_id=fee.id ORDER BY sequence DESC LIMIT 1) current_status
        FROM managed_gpu_outstanding_hosting_fees fee WHERE fee.settlement_id=?`, [settlementId]);
      if (outstanding && text(outstanding,"current_status") !== "PAID" && input.toStatus !== "READY") {
        throw conflict("MANAGED_GPU_OUTSTANDING_FEE_PENDING", "本期产出不足覆盖托管费用，待缴费用结清前不能批准或入账。");
      }
      const sequence = integer(latestEvent,"sequence") + 1;
      const eventId = `mgse_${crypto.randomUUID()}`;
      const amount = integer(current,"net_card_hour_micros");
      if (input.toStatus === "POSTED" && amount < 0) throw conflict("MANAGED_GPU_SETTLEMENT_AMOUNT_INVALID", "月度结算净卡时不能为负数。");
      const ledgerBatchId = input.toStatus === "POSTED" && amount > 0 ? `chb_${crypto.randomUUID()}` : null;
      const organizationId = text(current,"organization_id");
      const postingStatements: ManagedGpuSql[] = ledgerBatchId ? [
        { sql: "INSERT OR IGNORE INTO card_hour_wallets(organization_id,available_micros,held_micros,lifetime_topup_micros,lifetime_spent_micros,version,created_at,updated_at) VALUES(?,0,0,0,0,1,?,?)", values: [organizationId,adminContext.now,adminContext.now] },
        { sql: "UPDATE card_hour_wallets SET available_micros=available_micros+?,version=version+1,updated_at=? WHERE organization_id=?", values: [amount,adminContext.now,organizationId] },
        requireOneChange(),
        { sql: "INSERT INTO card_hour_ledger_batches(id,organization_id,operation,business_key,amount_micros,status,metadata_json,created_at) VALUES(?,?,'MANAGED_GPU_INCOME',?,?,'POSTED',?,?)", values: [ledgerBatchId,organizationId,`managed-gpu-income:${settlementId}`,amount,JSON.stringify({sourceSystem:"MANAGED_GPU_INCOME",settlementId,assetId:text(current,"asset_id"),withdrawable:false,transferable:false}),adminContext.now] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) SELECT ?,?,?, 'USER_AVAILABLE','CREDIT',?,available_micros,? FROM card_hour_wallets WHERE organization_id=?", values: [`che_${crypto.randomUUID()}`,ledgerBatchId,organizationId,amount,adminContext.now,organizationId] },
        { sql: "INSERT INTO card_hour_ledger_entries(id,batch_id,organization_id,account_code,side,amount_micros,balance_after_micros,created_at) VALUES(?,?,NULL,'PLATFORM_MANAGED_GPU_INCOME','DEBIT',?,NULL,?)", values: [`che_${crypto.randomUUID()}`,ledgerBatchId,amount,adminContext.now] },
      ] : [];
      await db.batch([
        ...postingStatements,
        { sql: "INSERT INTO managed_gpu_settlement_events(id,settlement_id,sequence,status,requested_by,approved_by,approval_id,ledger_batch_id,payload_digest,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)", values: [eventId,settlementId,sequence,input.toStatus,adminContext.accountId,consume.approverAccountId,adminContext.approvalId,ledgerBatchId,adminContext.payloadHash,adminContext.now] },
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId,"TRANSITION_SETTLEMENT",adminContext.idempotencyKey,adminContext.payloadHash,settlementId,adminContext.now] },
        event(`mge_${crypto.randomUUID()}`,organizationId,"SETTLEMENT",settlementId,`SETTLEMENT_${input.toStatus}`,adminContext.payloadHash,adminContext.now),
        ...consume.statements,
      ]);
      return { record: settlement((await db.first<Row>(`${SETTLEMENT_SELECT} WHERE settlement.id=?`, [settlementId]))!), replayed: false };
    },
    async shipAsset(adminContext, serviceRequestId, input) {
      const replay = await receipt(db, adminContext.organizationId, "SHIP_ASSET", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) {
        const replayRequest = await db.first<Row>("SELECT * FROM managed_gpu_service_requests WHERE id=?", [serviceRequestId]);
        return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [replay]))!), serviceRequest: serviceRequest(replayRequest!), replayed: true };
      }
      if (!/^[a-f0-9]{64}$/u.test(input.evidenceDigest)) throw invalid("寄送执行必须包含 SHA-256 交接证据摘要。");
      const request = await db.first<Row>("SELECT * FROM managed_gpu_service_requests WHERE id=? AND request_type='GLOBAL_SHIPPING'", [serviceRequestId]);
      if (!request) throw missing("设备寄送请求不存在。");
      if (integer(request,"version") !== input.expectedVersion || !["REQUESTED","APPROVED"].includes(text(request,"status"))) throw conflict("MANAGED_GPU_SERVICE_REQUEST_STATE_CONFLICT", "设备寄送请求状态已变化。");
      const current = await db.first<Row>(`SELECT asset.*,orders.fulfillment_choice FROM managed_gpu_physical_assets asset JOIN managed_gpu_purchase_orders orders ON orders.id=asset.order_id WHERE asset.id=?`, [text(request,"asset_id")]);
      if (!current) throw missing("GPU 资产不存在。");
      const initialGlobalShipping = text(current,"fulfillment_choice") === "GLOBAL_SHIPPING";
      if (initialGlobalShipping) {
        if (text(current,"status") !== "VERIFIED") throw conflict("MANAGED_GPU_INITIAL_SHIPPING_NOT_VERIFIED", "初始全球寄送必须先完成实物验真。");
      } else {
        if (text(current,"fulfillment_choice") !== "BEIDOU_HOSTING" || text(current,"status") !== "DRAINING") throw conflict("MANAGED_GPU_SHIPPING_NOT_DRAINED", "北斗托管资产必须先进入 DRAINING 才能改为寄送。");
      }
      const exitRequest = initialGlobalShipping ? null : await db.first<Row>(`SELECT * FROM managed_gpu_service_requests WHERE asset_id=? AND organization_id=? AND request_type='EXIT_HOSTING'
        AND status NOT IN ('REJECTED','CANCELLED') ORDER BY created_at DESC LIMIT 1`, [text(current,"id"),text(current,"owner_organization_id")]);
      if (!initialGlobalShipping) {
        if (!exitRequest || !exitRequest.earliest_execution_at || text(exitRequest,"earliest_execution_at") > adminContext.now) throw conflict("MANAGED_GPU_EXIT_NOTICE_PENDING", "北斗托管退出申请的 30 天通知期尚未届满。");
        const attestation = await db.first<Row>("SELECT * FROM managed_gpu_asset_drain_attestations WHERE asset_id=? ORDER BY verified_at DESC LIMIT 1", [text(current,"id")]);
        if (!attestation || text(attestation,"agent_binding_id") !== nullableText(current,"agent_binding_id") || integer(attestation,"allocation_count") !== 0 || integer(attestation,"process_count") !== 0 || Date.parse(adminContext.now)-Date.parse(text(attestation,"verified_at")) > 15*60_000) throw conflict("MANAGED_GPU_DRAIN_ATTESTATION_STALE", "寄送前必须取得最近 15 分钟的零分配、零进程 Agent 验真。");
        const hostingSchema = await db.first<Row>("SELECT COUNT(*) count FROM sqlite_master WHERE type='table' AND name IN ('hosting_v2_contracts','hosting_v2_instances')");
        if (integer(hostingSchema ?? {count:0},"count") !== 2) throw conflict("MANAGED_GPU_HOSTING_CONTROL_PLANE_UNAVAILABLE", "托管控制层未就绪，不能确认设备已排空。");
        const activeContract = await db.first<Row>("SELECT id FROM hosting_v2_contracts WHERE device_id=? AND status NOT IN ('SETTLED','CLEANED','CANCELLED','FAILED','REFUNDED') LIMIT 1", [nullableText(current,"agent_binding_id")]);
        const activeInstance = await db.first<Row>("SELECT contract_id FROM hosting_v2_instances WHERE device_id=? AND status NOT IN ('CLEANED','FAILED') LIMIT 1", [nullableText(current,"agent_binding_id")]);
        if (activeContract || activeInstance) throw conflict("MANAGED_GPU_ACTIVE_WORKLOAD_EXISTS", "仍有预约、交付、作业或会话占用该设备，不能寄送。");
        const openSettlement = await db.first<Row>(`SELECT settlement.id FROM managed_gpu_settlements settlement WHERE settlement.asset_id=? AND COALESCE((SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1),'REVIEW_REQUIRED') NOT IN ('POSTED','REVERSED') LIMIT 1`, [text(current,"id")]);
        const uncoveredSale = await db.first<Row>(`SELECT sale.id FROM managed_gpu_compute_sale_events sale WHERE sale.asset_id=? AND NOT EXISTS(SELECT 1 FROM managed_gpu_settlements settlement WHERE settlement.asset_id=sale.asset_id AND sale.occurred_at>=settlement.period_start AND sale.occurred_at<settlement.period_end AND (SELECT status FROM managed_gpu_settlement_events WHERE settlement_id=settlement.id ORDER BY sequence DESC LIMIT 1) IN ('POSTED','REVERSED')) LIMIT 1`, [text(current,"id")]);
        if (openSettlement || uncoveredSale) throw conflict("MANAGED_GPU_SETTLEMENT_NOT_SEALED", "计量成交尚未全部封账，不能寄送设备。");
      }
      const consume = await approvalConsumption(db, adminContext, "SHIP_ASSET", serviceRequestId);
      const evidenceId = `mgev_${crypto.randomUUID()}`;
      await db.batch([
        { sql: "INSERT INTO managed_gpu_asset_evidence(id,asset_id,evidence_type,evidence_digest,agent_binding_id,recorded_by,recorded_at) VALUES(?,?,'SHIPPING',?,?,?,?)", values: [evidenceId,text(current,"id"),input.evidenceDigest,nullableText(current,"agent_binding_id"),adminContext.accountId,adminContext.now] },
        { sql: "UPDATE managed_gpu_physical_assets SET status='SHIPPING',version=version+1,updated_at=? WHERE id=? AND status=? AND version=?", values: [adminContext.now,text(current,"id"),initialGlobalShipping?"VERIFIED":"DRAINING",integer(current,"version")] },
        requireOneChange(),
        { sql: "UPDATE managed_gpu_service_requests SET status='COMPLETED',version=version+1,updated_at=? WHERE id=? AND version=? AND status IN ('REQUESTED','APPROVED')", values: [adminContext.now,serviceRequestId,input.expectedVersion] },
        requireOneChange(),
        ...(exitRequest ? [{ sql: "UPDATE managed_gpu_service_requests SET status='COMPLETED',version=version+1,updated_at=? WHERE id=? AND status NOT IN ('COMPLETED','REJECTED','CANCELLED')", values: [adminContext.now,text(exitRequest,"id")] }, requireOneChange()] : []),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId,"SHIP_ASSET",adminContext.idempotencyKey,adminContext.payloadHash,text(current,"id"),adminContext.now] },
        event(`mge_${crypto.randomUUID()}`,text(current,"owner_organization_id"),"ASSET",text(current,"id"),"ASSET_SHIPPING",adminContext.payloadHash,adminContext.now),
        ...consume.statements,
      ]);
      return { record: asset((await db.first<Row>("SELECT * FROM managed_gpu_physical_assets WHERE id=?", [text(current,"id")]))!), serviceRequest: serviceRequest((await db.first<Row>("SELECT * FROM managed_gpu_service_requests WHERE id=?", [serviceRequestId]))!), replayed: false };
    },
    async publishProductVersion(adminContext, input) {
      const replay = await receipt(db, adminContext.organizationId, "PUBLISH_PRODUCT_VERSION", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: product((await db.first<Row>("SELECT * FROM managed_gpu_product_versions WHERE id=?", [replay]))!), replayed: true };
      if (!/^[A-Z0-9][A-Z0-9_.:-]{2,79}$/u.test(input.sku) || !/^[A-Z0-9][A-Z0-9_.:-]{2,79}$/u.test(input.hardwareClassId)) throw invalid("商品 SKU 或硬件类别标识无效。");
      if (![input.manufacturer,input.model,input.displayName,input.sellerName,input.gpuModel].every((value) => value.trim().length >= 2 && value.trim().length <= 120)) throw invalid("商品名称、型号或供应商名称无效。");
      if (!["CONSUMER","WORKSTATION","DATACENTER"].includes(input.hardwareTier)) throw invalid("GPU 硬件等级无效。");
      if (!Number.isSafeInteger(input.vramGb) || input.vramGb < 1 || input.vramGb > 10_000) throw invalid("GPU 显存规格无效。");
      if (!Number.isSafeInteger(input.verifiedInventoryCount) || input.verifiedInventoryCount < 1 || input.verifiedInventoryCount > 100_000) throw invalid("必须提供正整数的已核验库存。");
      if (!/^[a-f0-9]{64}$/u.test(input.inventoryEvidenceDigest)) throw invalid("可售商品必须提供库存验真 SHA-256 摘要。");
      if (![input.warrantyMonths,input.estimatedDeliveryDays].every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1200)) throw invalid("保修或预计交付周期无效。");
      if (!Array.isArray(input.fulfillmentModes) || input.fulfillmentModes.length < 1 || input.fulfillmentModes.some((value) => !["BEIDOU_HOSTING","GLOBAL_SHIPPING"].includes(value))) throw invalid("商品履约方式无效。");
      if (new Set(input.fulfillmentModes).size !== input.fulfillmentModes.length || new Set(input.facilityIds).size !== input.facilityIds.length) throw invalid("商品履约或机房列表不能重复。");
      if (!Number.isFinite(Date.parse(input.quoteValidUntil)) || input.quoteValidUntil <= adminContext.now) throw invalid("商品询价有效期必须晚于当前时间。");
      if (input.fulfillmentModes.includes("BEIDOU_HOSTING") && input.facilityIds.length < 1) throw invalid("支持北斗托管的商品必须指定已验收机房。");
      for (const facilityId of input.facilityIds) {
        const configured = await db.first<Row>("SELECT id FROM managed_gpu_facilities WHERE id=? AND status='ACTIVE' AND custody_terms_version<>'PENDING'", [facilityId]);
        if (!configured) throw conflict("MANAGED_GPU_FACILITY_UNAVAILABLE", "商品引用的机房尚未完成验收。");
      }
      const id = `mgpv_${crypto.randomUUID()}`;
      const specsJson = approvalPayloadJson({ ...input.specs, verifiedInventoryCount: input.verifiedInventoryCount, inventoryEvidenceDigest: input.inventoryEvidenceDigest });
      const consume = await approvalConsumption(db, adminContext, "PUBLISH_PRODUCT_VERSION", input.sku);
      await db.batch([
        { sql: `INSERT INTO managed_gpu_product_versions(id,hardware_class_id,sku,manufacturer,model,display_name,seller_name,gpu_model,hardware_tier,vram_gb,specs_json,quote_mode,sellable,currency,unit_price_minor,card_hour_reference_micros,warranty_months,estimated_delivery_days,fulfillment_modes_json,facility_ids_json,utilization_7d_bps,utilization_30d_bps,quote_valid_until,status,immutable_hash,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'QUOTE_REQUIRED',1,?,NULL,NULL,?,?,?, ?,NULL,NULL,?,'ACTIVE',?,?)`, values: [id,input.hardwareClassId,input.sku,input.manufacturer.trim(),input.model.trim(),input.displayName.trim(),input.sellerName.trim(),input.gpuModel.trim(),input.hardwareTier,input.vramGb,specsJson,input.currency,input.warrantyMonths,input.estimatedDeliveryDays,JSON.stringify(input.fulfillmentModes),JSON.stringify(input.facilityIds),input.quoteValidUntil,adminContext.payloadHash,adminContext.now] },
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId,"PUBLISH_PRODUCT_VERSION",adminContext.idempotencyKey,adminContext.payloadHash,id,adminContext.now] },
        event(`mge_${crypto.randomUUID()}`,adminContext.organizationId,"PRODUCT_VERSION",id,"PRODUCT_VERSION_PUBLISHED",input.inventoryEvidenceDigest,adminContext.now),
        ...consume.statements,
      ]);
      return { record: product((await db.first<Row>("SELECT * FROM managed_gpu_product_versions WHERE id=?", [id]))!), replayed: false };
    },
    async activateFacility(adminContext, facilityId, input) {
      const replay = await receipt(db, adminContext.organizationId, "ACTIVATE_FACILITY", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) return { record: facility((await db.first<Row>("SELECT * FROM managed_gpu_facilities WHERE id=?", [replay]))!), replayed: true };
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/u.test(input.custodyTermsVersion) || input.custodyTermsVersion.toUpperCase() === "PENDING") throw invalid("必须绑定正式生效的托管条款版本。");
      if (!/^[a-f0-9]{64}$/u.test(input.verificationEvidenceDigest)) throw invalid("机房激活必须提供验收证据 SHA-256 摘要。");
      const current = await db.first<Row>("SELECT * FROM managed_gpu_facilities WHERE id=?", [facilityId]);
      if (!current) throw missing("GPU 托管机房不存在。");
      if (integer(current,"version") !== input.expectedVersion || !["PLANNED","SUSPENDED"].includes(text(current,"status"))) throw conflict("MANAGED_GPU_FACILITY_STATE_CONFLICT", "机房状态或版本已变化。");
      const consume = await approvalConsumption(db, adminContext, "ACTIVATE_FACILITY", facilityId);
      await db.batch([
        { sql: "UPDATE managed_gpu_facilities SET status='ACTIVE',custody_terms_version=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status IN ('PLANNED','SUSPENDED')", values: [input.custodyTermsVersion,adminContext.now,facilityId,input.expectedVersion] },
        requireOneChange(),
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId,"ACTIVATE_FACILITY",adminContext.idempotencyKey,adminContext.payloadHash,facilityId,adminContext.now] },
        event(`mge_${crypto.randomUUID()}`,adminContext.organizationId,"FACILITY",facilityId,"FACILITY_ACTIVATED",input.verificationEvidenceDigest,adminContext.now),
        ...consume.statements,
      ]);
      return { record: facility((await db.first<Row>("SELECT * FROM managed_gpu_facilities WHERE id=?", [facilityId]))!), replayed: false };
    },
    async publishEconomicPolicy(adminContext, input) {
      const replay = await receipt(db, adminContext.organizationId, "PUBLISH_ECONOMIC_POLICY", adminContext.idempotencyKey, adminContext.payloadHash);
      if (replay) {
        const row = (await db.first<Row>("SELECT * FROM managed_gpu_economic_policy_versions WHERE id=?", [replay]))!;
        return { record: economicPolicy(row), replayed: true };
      }
      if (!/^[A-Z0-9][A-Z0-9_.:-]{2,79}$/u.test(input.policyCode) || !Number.isSafeInteger(input.versionNumber) || input.versionNumber < 1) throw invalid("经济政策代码或版本无效。");
      if (!Number.isSafeInteger(input.facilityChargeMicrosPerAssetDay) || input.facilityChargeMicrosPerAssetDay < 0) throw invalid("机房日费用必须是非负卡时微单位整数。");
      if (!Number.isFinite(Date.parse(input.effectiveFrom)) || (input.effectiveUntil !== null && (!Number.isFinite(Date.parse(input.effectiveUntil)) || input.effectiveUntil <= input.effectiveFrom))) throw invalid("经济政策生效区间无效。");
      const configured = await db.first<Row>("SELECT id FROM managed_gpu_facilities WHERE id=? AND status='ACTIVE' AND custody_terms_version<>'PENDING'", [input.facilityId]);
      if (!configured) throw conflict("MANAGED_GPU_FACILITY_UNAVAILABLE", "经济政策只能绑定已验收的活动机房。");
      const id = `mgpol_${crypto.randomUUID()}`;
      const targetId = `${input.policyCode}:${input.versionNumber}`;
      const consume = await approvalConsumption(db, adminContext, "PUBLISH_ECONOMIC_POLICY", targetId);
      const calculationJson = approvalPayloadJson({ ...input.calculation, platformFee: "SERVER_DERIVED_LIFETIME_TIER", wearReserve: "SERVER_DERIVED_HARDWARE_TIER", ownerAuthorizedDebitMicros: 0 });
      await db.batch([
        { sql: "INSERT INTO managed_gpu_economic_policy_versions(id,policy_code,version_number,facility_id,facility_charge_micros_per_asset_day,platform_fee_bps,wear_reserve_bps,calculation_json,effective_from,effective_until,approved_by,immutable_hash,created_at) VALUES(?,?,?,?,?,0,0,?,?,?,?,?,?)", values: [id,input.policyCode,input.versionNumber,input.facilityId,input.facilityChargeMicrosPerAssetDay,calculationJson,input.effectiveFrom,input.effectiveUntil,consume.approverAccountId,adminContext.payloadHash,adminContext.now] },
        { sql: "INSERT INTO managed_gpu_command_receipts(organization_id,command_scope,idempotency_key,payload_hash,entity_id,created_at) VALUES(?,?,?,?,?,?)", values: [adminContext.organizationId,"PUBLISH_ECONOMIC_POLICY",adminContext.idempotencyKey,adminContext.payloadHash,id,adminContext.now] },
        event(`mge_${crypto.randomUUID()}`,adminContext.organizationId,"ECONOMIC_POLICY",id,"ECONOMIC_POLICY_PUBLISHED",adminContext.payloadHash,adminContext.now),
        ...consume.statements,
      ]);
      const row = (await db.first<Row>("SELECT * FROM managed_gpu_economic_policy_versions WHERE id=?", [id]))!;
      return { record: economicPolicy(row), replayed: false };
    },
    async health() { const row = await db.first<Row>("SELECT MAX(version) AS version FROM managed_gpu_schema_migrations"); return { schemaVersion: Number(row?.version ?? 0) }; },
  };
}
