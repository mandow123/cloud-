import { HOSTING_V2_AGENT_STALE_SECONDS, type HostingAgentChallenge, type HostingAgentCommand, type HostingContract, type HostingDashboard, type HostingDevice, type HostingDeviceInventory, type HostingFeeSchedule, type HostingOffer, type HostingSupplierProfile } from "../hosting-v2.ts";
import { HOSTING_V2_SCHEMA_VERSION, hostingV2SchemaStatements } from "../../db/hosting-v2-schema.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError, ExchangeInputError } from "./exchange-errors.ts";
import { assertHostingV2ApprovedImage } from "./hosting-v2-image-policy.ts";
import type { HostingMutationContext, HostingV2DatabaseAdapter, HostingV2Sql, HostingV2Store } from "./hosting-v2-store.ts";

type Row = Record<string, unknown>;
const value = (row: Row, key: string) => String(row[key]);
const nullable = (row: Row, key: string) => row[key] == null ? null : String(row[key]);
const number = (row: Row, key: string) => Number(row[key]);
const json = <T>(row: Row, key: string) => JSON.parse(value(row, key)) as T;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const VERIFY_TEST_NAMES = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"] as const;
const HOSTING_V2_MIN_AGENT_VERSION = "1.3.0";

function agentVersionAtLeast(valueToCheck: string, minimum: string) {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value);
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const current = parse(valueToCheck);
  const required = parse(minimum);
  if (!current || !required) return false;
  for (let index = 0; index < 3; index += 1) {
    if (current[index] > required[index]) return true;
    if (current[index] < required[index]) return false;
  }
  return true;
}

function assertSuccessfulVerificationDetails(details: Record<string, unknown> | undefined, expectedInventoryDigest: string, now: string) {
  if (!details || details.protocolVersion !== 1 || details.inventoryDigest !== expectedInventoryDigest || typeof details.observedAt !== "string") {
    throw new ExchangeInputError("设备验真结果结构无效。", "details");
  }
  const observedAt = Date.parse(details.observedAt);
  if (!Number.isFinite(observedAt) || Math.abs(observedAt - Date.parse(now)) > 10 * 60_000) throw new ExchangeInputError("设备验真观测时间无效。", "details.observedAt");
  if (!Array.isArray(details.tests) || details.tests.length !== VERIFY_TEST_NAMES.length) throw new ExchangeInputError("设备验真测试数量无效。", "details.tests");
  const names = new Set<string>();
  for (const item of details.tests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ExchangeInputError("设备验真测试结构无效。", "details.tests");
    const result = item as Record<string, unknown>;
    if (!VERIFY_TEST_NAMES.includes(result.name as typeof VERIFY_TEST_NAMES[number]) || result.status !== "PASSED" || typeof result.evidenceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(result.evidenceDigest)) {
      throw new ExchangeInputError("设备验真测试结果无效。", "details.tests");
    }
    names.add(String(result.name));
  }
  if (names.size !== VERIFY_TEST_NAMES.length) throw new ExchangeInputError("设备验真测试存在重复或缺失。", "details.tests");
}

function assertSuccessfulProvisionDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, inventory: HostingDeviceInventory, now: string) {
  if (!details || details.protocolVersion !== 1 || details.contractId !== payload.contractId || details.image !== payload.image || typeof details.observedAt !== "string") {
    throw new ExchangeInputError("实例开通结果结构无效。", "details");
  }
  const observedAt = Date.parse(details.observedAt);
  if (!Number.isFinite(observedAt) || Math.abs(observedAt - Date.parse(now)) > 10 * 60_000) throw new ExchangeInputError("实例开通观测时间无效。", "details.observedAt");
  if (typeof details.containerDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(details.containerDigest) || typeof details.workspaceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(details.workspaceDigest)) {
    throw new ExchangeInputError("实例开通证据摘要无效。", "details");
  }
  const endpoint = typeof details.endpointDisplay === "string" ? details.endpointDisplay.trim() : "";
  const endpointMatch = /^(\[[0-9a-f:]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?):([0-9]{2,5})$/u.exec(endpoint);
  const endpointPort = Number(endpointMatch?.[2] ?? 0);
  if (!endpointMatch || endpointMatch[1].toLowerCase() !== inventory.publicHost.toLowerCase() || endpointPort < inventory.sshPortStart || endpointPort > inventory.sshPortEnd) {
    throw new ExchangeInputError("Agent 返回的连接入口不在设备验真的主机和端口范围内。", "endpointDisplay");
  }
  return endpoint;
}

function assertSuccessfulStartDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, now: string) {
  const expectedKeys = ["containerDigest", "contractId", "endpointDisplay", "observedAt", "protocolVersion", "runtimeStateDigest", "runtimeStatus", "sshBannerDigest", "startedAt"];
  if (!details || Object.keys(details).sort().join(",") !== expectedKeys.sort().join(",")
    || details.protocolVersion !== 1 || details.contractId !== payload.contractId || details.endpointDisplay !== payload.endpointDisplay
    || details.runtimeStatus !== "RUNNING" || typeof details.observedAt !== "string" || typeof details.startedAt !== "string") {
    throw new ExchangeInputError("实例启动结果结构无效。", "details");
  }
  for (const field of ["containerDigest", "runtimeStateDigest", "sshBannerDigest"] as const) {
    if (typeof details[field] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(details[field])) throw new ExchangeInputError("实例启动证据摘要无效。", `details.${field}`);
  }
  const observedAt = Date.parse(details.observedAt);
  const startedAt = Date.parse(details.startedAt);
  const serverNow = Date.parse(now);
  if (!Number.isFinite(observedAt) || !Number.isFinite(startedAt) || startedAt > observedAt || Math.abs(observedAt - serverNow) > 10 * 60_000 || Math.abs(startedAt - serverNow) > 10 * 60_000) {
    throw new ExchangeInputError("实例启动观测时间无效。", "details.observedAt");
  }
}

function assertSuccessfulStopDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, now: string) {
  const expectedKeys = ["containerDigest", "contractId", "observedAt", "protocolVersion", "runtimeSeconds", "runtimeStateDigest", "runtimeStatus", "startedAt", "stoppedAt"];
  if (!details || Object.keys(details).sort().join(",") !== expectedKeys.sort().join(",")
    || details.protocolVersion !== 1 || details.contractId !== payload.contractId || details.runtimeStatus !== "STOPPED"
    || typeof details.observedAt !== "string" || typeof details.startedAt !== "string" || typeof details.stoppedAt !== "string") {
    throw new ExchangeInputError("实例停止结果结构无效。", "details");
  }
  for (const field of ["containerDigest", "runtimeStateDigest"] as const) {
    if (typeof details[field] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(details[field])) throw new ExchangeInputError("实例停止证据摘要无效。", `details.${field}`);
  }
  const observedAt = Date.parse(details.observedAt);
  const startedAt = Date.parse(details.startedAt);
  const stoppedAt = Date.parse(details.stoppedAt);
  const expectedStartedAt = typeof payload.startedAt === "string" ? Date.parse(payload.startedAt) : Number.NaN;
  const serverNow = Date.parse(now);
  const calculatedSeconds = Math.max(0, Math.ceil((stoppedAt - startedAt) / 1_000));
  if (!Number.isFinite(observedAt) || !Number.isFinite(startedAt) || !Number.isFinite(stoppedAt) || !Number.isFinite(expectedStartedAt)
    || startedAt > stoppedAt || stoppedAt > observedAt || Math.abs(observedAt - serverNow) > 10 * 60_000
    || Math.abs(stoppedAt - serverNow) > 10 * 60_000 || Math.abs(startedAt - expectedStartedAt) > 10 * 60_000
    || !Number.isSafeInteger(details.runtimeSeconds) || details.runtimeSeconds !== calculatedSeconds) {
    throw new ExchangeInputError("实例停止计量时间无效。", "details.runtimeSeconds");
  }
}

function assertSuccessfulCleanupDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, now: string) {
  const expectedKeys = ["authorizedKeyRemoved", "cleanedAt", "cleanupDigest", "cleanupStatus", "containerDigest", "containerRemoved", "contractId", "observedAt", "protocolVersion", "workspaceRemoved"];
  if (!details || Object.keys(details).sort().join(",") !== expectedKeys.sort().join(",")
    || details.protocolVersion !== 1 || details.contractId !== payload.contractId || details.cleanupStatus !== "CLEANED"
    || details.containerRemoved !== true || details.authorizedKeyRemoved !== true || details.workspaceRemoved !== true
    || typeof details.cleanedAt !== "string" || typeof details.observedAt !== "string") {
    throw new ExchangeInputError("实例清理结果结构无效。", "details");
  }
  for (const field of ["containerDigest", "cleanupDigest"] as const) {
    if (typeof details[field] !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(details[field])) throw new ExchangeInputError("实例清理证据摘要无效。", `details.${field}`);
  }
  const cleanedAt = Date.parse(details.cleanedAt);
  const observedAt = Date.parse(details.observedAt);
  const serverNow = Date.parse(now);
  if (!Number.isFinite(cleanedAt) || !Number.isFinite(observedAt) || cleanedAt > observedAt
    || Math.abs(cleanedAt - serverNow) > 10 * 60_000 || Math.abs(observedAt - serverNow) > 10 * 60_000) {
    throw new ExchangeInputError("实例清理观测时间无效。", "details.cleanedAt");
  }
}

function profile(row: Row): HostingSupplierProfile {
  return {
    organizationId: value(row, "organization_id"), accountId: value(row, "account_id"),
    supplierType: value(row, "supplier_type") as HostingSupplierProfile["supplierType"],
    legalDisplayName: value(row, "legal_display_name"), contactEmail: value(row, "contact_email"),
    agreementVersion: nullable(row, "agreement_version"), evidenceDigest: nullable(row, "evidence_digest"),
    reviewNote: nullable(row, "review_note"), status: value(row, "status") as HostingSupplierProfile["status"],
    version: number(row, "version"), createdAt: value(row, "created_at"), updatedAt: value(row, "updated_at"),
  };
}

function challenge(row: Row): HostingAgentChallenge {
  return {
    id: value(row, "id"), organizationId: value(row, "organization_id"), accountId: value(row, "account_id"),
    nonce: value(row, "nonce"), minimumAgentVersion: value(row, "minimum_agent_version"), expiresAt: value(row, "expires_at"),
    consumedAt: nullable(row, "consumed_at"), createdAt: value(row, "created_at"),
  };
}

function device(row: Row): HostingDevice {
  return {
    id: value(row, "id"), organizationId: value(row, "organization_id"), accountId: value(row, "account_id"),
    displayName: value(row, "display_name"), deviceKeyId: value(row, "device_key_id"), devicePublicKey: value(row, "device_public_key"),
    agentVersion: value(row, "agent_version"), inventory: json<HostingDeviceInventory>(row, "inventory_json"), inventoryDigest: value(row, "inventory_digest"),
    status: value(row, "status") as HostingDevice["status"], verificationStatus: value(row, "verification_status") as HostingDevice["verificationStatus"],
    verificationEvidenceDigest: nullable(row, "verification_evidence_digest"), verifiedUntil: nullable(row, "verified_until"),
    lastSequence: number(row, "last_sequence"), lastSeenAt: nullable(row, "last_seen_at"), version: number(row, "version"),
    createdAt: value(row, "created_at"), updatedAt: value(row, "updated_at"),
  };
}

function fee(row: Row): HostingFeeSchedule {
  return { id: value(row, "id"), platformFeeBps: number(row, "platform_fee_bps"), referralRewardBps: number(row, "referral_reward_bps"), status: value(row, "status") as HostingFeeSchedule["status"], effectiveFrom: value(row, "effective_from"), createdBy: value(row, "created_by"), createdAt: value(row, "created_at") };
}

function offer(row: Row): HostingOffer {
  return {
    id: value(row, "id"), organizationId: value(row, "organization_id"), deviceId: value(row, "device_id"), feeScheduleId: value(row, "fee_schedule_id"), title: value(row, "title"),
    gpuModel: value(row, "gpu_model") as HostingOffer["gpuModel"], region: value(row, "region"), cardHourMicrosPerGpuHour: number(row, "card_hour_micros_per_gpu_hour"),
    minRentalSeconds: number(row, "min_rental_seconds"), maxRentalSeconds: number(row, "max_rental_seconds"), availableFrom: value(row, "available_from"), availableUntil: value(row, "available_until"),
    approvedImage: value(row, "approved_image"), termsVersion: value(row, "terms_version"), status: value(row, "status") as HostingOffer["status"], version: number(row, "version"), createdAt: value(row, "created_at"), updatedAt: value(row, "updated_at"),
  };
}

function contract(row: Row): HostingContract {
  return {
    id: value(row, "id"), offerId: value(row, "offer_id"), deviceId: value(row, "device_id"), buyerOrganizationId: value(row, "buyer_organization_id"), buyerAccountId: value(row, "buyer_account_id"), supplierOrganizationId: value(row, "supplier_organization_id"), feeScheduleId: value(row, "fee_schedule_id"),
    snapshot: json<HostingContract["snapshot"]>(row, "snapshot_json"), reservedSeconds: number(row, "reserved_seconds"), measuredSeconds: row.measured_seconds == null ? null : number(row, "measured_seconds"), heldMicros: number(row, "held_micros"), settledMicros: row.settled_micros == null ? null : number(row, "settled_micros"), supplierIncomeMicros: row.supplier_income_micros == null ? null : number(row, "supplier_income_micros"), commissionMicros: row.commission_micros == null ? null : number(row, "commission_micros"), status: value(row, "status") as HostingContract["status"],
    sshPublicKeyFingerprint: nullable(row, "ssh_public_key_fingerprint"), endpointDisplay: nullable(row, "endpoint_display"), startedAt: nullable(row, "started_at"), stoppedAt: nullable(row, "stopped_at"), acceptedAt: nullable(row, "accepted_at"), version: number(row, "version"), createdAt: value(row, "created_at"), updatedAt: value(row, "updated_at"),
  };
}

function command(row: Row): HostingAgentCommand {
  return { id: value(row, "id"), deviceId: value(row, "device_id"), contractId: nullable(row, "contract_id"), type: value(row, "command_type") as HostingAgentCommand["type"], payload: json(row, "payload_json"), status: value(row, "status") as HostingAgentCommand["status"], attempt: number(row, "attempt"), evidenceDigest: nullable(row, "evidence_digest"), errorCode: nullable(row, "error_code"), createdAt: value(row, "created_at"), deliveredAt: nullable(row, "delivered_at"), completedAt: nullable(row, "completed_at") };
}

function event(context: HostingMutationContext, organizationId: string | null, entityType: string, entityId: string, eventType: string, metadata: Record<string, unknown> = {}): HostingV2Sql {
  return { sql: "INSERT INTO hosting_v2_events(id,organization_id,entity_type,entity_id,event_type,actor_id,payload_digest,metadata_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)", values: [id("hve"), organizationId, entityType, entityId, eventType, context.actorId, context.payloadHash, JSON.stringify(metadata), context.now] };
}

async function replay(db: HostingV2DatabaseAdapter, context: HostingMutationContext, commandType: string) {
  const row = await db.first<Row>("SELECT * FROM hosting_v2_command_receipts WHERE actor_id=? AND idempotency_key=?", [context.actorId, context.idempotencyKey]);
  if (!row) return null;
  if (value(row, "payload_hash") !== context.payloadHash || value(row, "command_type") !== commandType) throw new ExchangeIdempotencyConflictError();
  return { entityType: value(row, "entity_type"), entityId: value(row, "entity_id") };
}

function receipt(context: HostingMutationContext, commandType: string, entityType: string, entityId: string): HostingV2Sql {
  return { sql: "INSERT INTO hosting_v2_command_receipts(actor_id,idempotency_key,command_type,payload_hash,entity_type,entity_id,created_at) VALUES(?,?,?,?,?,?,?)", values: [context.actorId, context.idempotencyKey, commandType, context.payloadHash, entityType, entityId, context.now] };
}

export async function createHostingV2Store(db: HostingV2DatabaseAdapter): Promise<HostingV2Store> {
  await db.ensureSchema(hostingV2SchemaStatements, HOSTING_V2_SCHEMA_VERSION);
  const store = {} as HostingV2Store;
  Object.assign(store, createProfileMethods(db), createDeviceMethods(db), createMarketMethods(db));
  return store;
}

function createProfileMethods(db: HostingV2DatabaseAdapter): Partial<HostingV2Store> {
  return {
    async dashboard(organizationId, now): Promise<HostingDashboard> {
      const [profileRow, deviceRows, offerRows, contractRows, activeFee, incomeRows] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]),
        db.all<Row>("SELECT * FROM hosting_v2_devices WHERE organization_id=? ORDER BY created_at DESC", [organizationId]),
        db.all<Row>("SELECT * FROM hosting_v2_offers WHERE organization_id=? ORDER BY created_at DESC", [organizationId]),
        db.all<Row>("SELECT * FROM hosting_v2_contracts WHERE supplier_organization_id=? OR buyer_organization_id=? ORDER BY created_at DESC LIMIT 100", [organizationId, organizationId]),
        db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [now]),
        db.all<Row>("SELECT income_type,status,COALESCE(SUM(amount_micros),0) amount_micros FROM card_hour_income_accruals WHERE organization_id=? GROUP BY income_type,status", [organizationId]).catch(() => []),
      ]);
      const devices = deviceRows.map(device);
      const earnings = { pendingMicros: 0, vestedMicros: 0, commissionPendingMicros: 0, commissionVestedMicros: 0 };
      for (const row of incomeRows) {
        const key = `${value(row, "income_type")}:${value(row, "status")}`;
        if (key === "RENTAL:PENDING") earnings.pendingMicros = number(row, "amount_micros");
        if (key === "RENTAL:VESTED") earnings.vestedMicros = number(row, "amount_micros");
        if (key === "COMMISSION:PENDING") earnings.commissionPendingMicros = number(row, "amount_micros");
        if (key === "COMMISSION:VESTED") earnings.commissionVestedMicros = number(row, "amount_micros");
      }
      const cutoff = Date.parse(now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000;
      return {
        profile: profileRow ? profile(profileRow) : null,
        devices,
        offers: offerRows.map(offer),
        contracts: contractRows.map(contract),
        earnings,
        readiness: {
          supplierApproved: profileRow?.status === "APPROVED",
          onlineVerifiedDevices: devices.filter((item) => item.status === "VERIFIED" && item.verificationStatus === "PASSED" && Boolean(item.verifiedUntil && Date.parse(item.verifiedUntil) > Date.parse(now)) && Boolean(item.lastSeenAt && Date.parse(item.lastSeenAt) >= cutoff)).length,
          activeFeeSchedule: Boolean(activeFee),
          cardHourSettlement: true,
          alipayPublicTopup: false,
          buyback: false,
        },
      };
    },

    async saveProfile(account, input, context) {
      const replayed = await replay(db, context, "SAVE_PROFILE");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
        return profile(row);
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [account.activeOrganization.id]);
      if (current && !["DRAFT", "REJECTED"].includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "当前供应主体不能修改资料。");
      if (current && number(current, "version") !== input.expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "供应主体资料已变化，请刷新。");
      if (!current && input.expectedVersion !== 0) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "供应主体尚未建立。");
      const supplierType = input.supplierType;
      if (!["INDIVIDUAL", "COMPANY", "IDC", "CLOUD_VENDOR"].includes(supplierType)) throw new ExchangeInputError("供应方类型无效。", "supplierType");
      const name = input.legalDisplayName.normalize("NFKC").trim();
      const email = input.contactEmail.trim().toLowerCase();
      if (name.length < 2 || name.length > 120) throw new ExchangeInputError("供应主体名称应为 2–120 个字符。", "legalDisplayName");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new ExchangeInputError("联系邮箱格式无效。", "contactEmail");
      const statements: HostingV2Sql[] = current ? [
        { sql: "UPDATE hosting_v2_supplier_profiles SET account_id=?,supplier_type=?,legal_display_name=?,contact_email=?,agreement_version=NULL,evidence_digest=NULL,review_note=NULL,status='DRAFT',version=version+1,updated_at=? WHERE organization_id=? AND version=?", values: [account.account.id, supplierType, name, email, context.now, account.activeOrganization.id, input.expectedVersion] },
      ] : [
        { sql: "INSERT INTO hosting_v2_supplier_profiles(organization_id,account_id,supplier_type,legal_display_name,contact_email,status,version,created_at,updated_at) VALUES(?,?,?,?,?,'DRAFT',1,?,?)", values: [account.activeOrganization.id, account.account.id, supplierType, name, email, context.now, context.now] },
      ];
      statements.push(event(context, account.activeOrganization.id, "SUPPLIER_PROFILE", account.activeOrganization.id, "PROFILE_SAVED"), receipt(context, "SAVE_PROFILE", "SUPPLIER_PROFILE", account.activeOrganization.id));
      await db.batch(statements);
      const created = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [account.activeOrganization.id]);
      if (!created) throw new Error("HOSTING_PROFILE_SAVE_FAILED");
      return profile(created);
    },

    async submitProfile(organizationId, expectedVersion, context) {
      const replayed = await replay(db, context, "SUBMIT_PROFILE");
      if (!replayed) {
        const current = await db.first<Row>("SELECT status,version FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
        if (value(current, "status") !== "DRAFT") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "供应主体当前不能提交审核。");
        if (number(current, "version") !== expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "供应主体资料已变化，请刷新。");
        await db.batch([
          { sql: "UPDATE hosting_v2_supplier_profiles SET status='SUBMITTED',agreement_version='KAI_HOSTING_2026_08',version=version+1,updated_at=? WHERE organization_id=? AND version=? AND status='DRAFT'", values: [context.now, organizationId, expectedVersion] },
          event(context, organizationId, "SUPPLIER_PROFILE", organizationId, "PROFILE_SUBMITTED"),
          receipt(context, "SUBMIT_PROFILE", "SUPPLIER_PROFILE", organizationId),
        ]);
      }
      const row = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
      if (value(row, "status") !== "SUBMITTED" && !replayed) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "供应主体当前不能提交审核。");
      return profile(row);
    },

    async listProfiles() {
      return (await db.all<Row>("SELECT * FROM hosting_v2_supplier_profiles ORDER BY updated_at DESC")).map(profile);
    },

    async reviewProfile(organizationId, input, context) {
      const replayed = await replay(db, context, "REVIEW_PROFILE");
      if (!replayed) {
        const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "SUSPENDED";
        if (input.reviewNote.trim().length < 4) throw new ExchangeInputError("审核说明至少 4 个字符。", "reviewNote");
        const current = await db.first<Row>("SELECT status,version FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
        if (!["SUBMITTED", "APPROVED"].includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "供应主体当前不能执行该审核决定。");
        if (number(current, "version") !== input.expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "供应主体资料已变化，请刷新。");
        const statements: HostingV2Sql[] = [
          { sql: "UPDATE hosting_v2_supplier_profiles SET status=?,review_note=?,evidence_digest=?,version=version+1,updated_at=? WHERE organization_id=? AND version=? AND status IN ('SUBMITTED','APPROVED')", values: [status, input.reviewNote.trim(), input.evidenceDigest ?? null, context.now, organizationId, input.expectedVersion] },
        ];
        if (status !== "APPROVED") statements.push({ sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE organization_id=? AND status IN ('DRAFT','PUBLISHED','PAUSED')", values: [context.now, organizationId] });
        statements.push(event(context, organizationId, "SUPPLIER_PROFILE", organizationId, `PROFILE_${status}`), receipt(context, "REVIEW_PROFILE", "SUPPLIER_PROFILE", organizationId));
        await db.batch(statements);
      }
      const row = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
      return profile(row);
    },
  };
}

function randomBase64Url(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  const binary = Array.from(data, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function createDeviceMethods(db: HostingV2DatabaseAdapter): Partial<HostingV2Store> {
  return {
    async issueAgentChallenge(account, context) {
      const profileRow = await db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [account.activeOrganization.id]);
      if (!profileRow || value(profileRow, "status") !== "APPROVED") throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体审核通过后才能登记设备。");
      const replayed = await replay(db, context, "ISSUE_AGENT_CHALLENGE");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_challenges WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备登记挑战不存在。");
        return challenge(row);
      }
      const recordId = id("hac");
      const expiresAt = new Date(Date.parse(context.now) + 5 * 60_000).toISOString();
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_challenges(id,organization_id,account_id,nonce,minimum_agent_version,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", values: [recordId, account.activeOrganization.id, account.account.id, randomBase64Url(), HOSTING_V2_MIN_AGENT_VERSION, expiresAt, context.now] },
        event(context, account.activeOrganization.id, "AGENT_CHALLENGE", recordId, "AGENT_CHALLENGE_ISSUED"),
        receipt(context, "ISSUE_AGENT_CHALLENGE", "AGENT_CHALLENGE", recordId),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_challenges WHERE id=?", [recordId]);
      if (!row) throw new Error("HOSTING_AGENT_CHALLENGE_CREATE_FAILED");
      return challenge(row);
    },

    async getAgentChallenge(challengeId) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_challenges WHERE id=?", [challengeId]);
      return row ? challenge(row) : null;
    },

    async registerDevice(challengeId, input, context) {
      const replayed = await replay(db, context, "REGISTER_DEVICE");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在。");
        return device(row);
      }
      const challengeRow = await db.first<Row>("SELECT * FROM hosting_v2_agent_challenges WHERE id=?", [challengeId]);
      if (!challengeRow || challengeRow.consumed_at != null || Date.parse(value(challengeRow, "expires_at")) < Date.parse(context.now)) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 410, "设备登记挑战已过期或已使用。");
      }
      const profileRow = await db.first<Row>("SELECT status FROM hosting_v2_supplier_profiles WHERE organization_id=?", [value(challengeRow, "organization_id")]);
      if (!profileRow || value(profileRow, "status") !== "APPROVED") throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体当前不能登记设备。");
      const recordId = id("had");
      await db.batch([
        { sql: `INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,last_sequence,last_seen_at,version,created_at,updated_at)
          SELECT ?,organization_id,account_id,?,?,?,?,?,?,'ONLINE','NOT_RUN',0,?,1,?,? FROM hosting_v2_agent_challenges WHERE id=? AND consumed_at IS NULL AND expires_at>=?`, values: [recordId, input.displayName, input.deviceKeyId, input.devicePublicKey, input.agentVersion, JSON.stringify(input.inventory), input.inventoryDigest, context.now, context.now, context.now, challengeId, context.now] },
        { sql: "UPDATE hosting_v2_agent_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL", values: [context.now, challengeId] },
        event(context, value(challengeRow, "organization_id"), "DEVICE", recordId, "DEVICE_REGISTERED", { deviceKeyId: input.deviceKeyId }),
        receipt(context, "REGISTER_DEVICE", "DEVICE", recordId),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [recordId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记未完成，请重新发起挑战。");
      return device(row);
    },

    async getDevice(deviceId) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]);
      return row ? device(row) : null;
    },

    async acceptHeartbeat(deviceId, input, context) {
      const current = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]);
      if (!current || value(current, "status") === "REVOKED") throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在或已撤销。");
      if (input.sequence <= number(current, "last_sequence")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "心跳序列已经使用。");
      const inventoryChanged = input.inventoryDigest !== value(current, "inventory_digest");
      const protectedStatus = ["VERIFYING", "BUSY", "DRAINING"].includes(value(current, "status"));
      const nextStatus = input.capacityState === "OFFLINE" ? "OFFLINE" : inventoryChanged ? "ONLINE" : protectedStatus ? value(current, "status") : value(current, "verification_status") === "PASSED" ? "VERIFIED" : "ONLINE";
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_heartbeats(id,device_id,sequence,inventory_digest,capacity_state,payload_digest,observed_at,received_at) VALUES(?,?,?,?,?,?,?,?)", values: [id("hhb"), deviceId, input.sequence, input.inventoryDigest, input.capacityState, context.payloadHash, input.observedAt, context.now] },
        { sql: "UPDATE hosting_v2_devices SET status=?,verification_status=CASE WHEN ? THEN 'EXPIRED' ELSE verification_status END,verified_until=CASE WHEN ? THEN NULL ELSE verified_until END,last_sequence=?,last_seen_at=?,version=version+1,updated_at=? WHERE id=? AND last_sequence<?", values: [nextStatus, inventoryChanged ? 1 : 0, inventoryChanged ? 1 : 0, input.sequence, input.observedAt, context.now, deviceId, input.sequence] },
        ...(inventoryChanged ? [{ sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE device_id=? AND status IN ('PUBLISHED','PAUSED')", values: [context.now, deviceId] } satisfies HostingV2Sql] : []),
        event(context, value(current, "organization_id"), "DEVICE", deviceId, inventoryChanged ? "DEVICE_INVENTORY_CHANGED" : "DEVICE_HEARTBEAT", { sequence: input.sequence, capacityState: input.capacityState }),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]);
      if (!row) throw new Error("HOSTING_DEVICE_HEARTBEAT_FAILED");
      return device(row);
    },

    async queueVerification(organizationId, deviceId, context) {
      const replayed = await replay(db, context, "QUEUE_VERIFICATION");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "验真任务不存在。");
        return command(row);
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=? AND organization_id=?", [deviceId, organizationId]);
      if (!current || !["ONLINE", "VERIFIED"].includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备需在线后才能验真。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,NULL,'VERIFY',?,'PENDING',0,?)", values: [commandId, deviceId, JSON.stringify({ expectedInventoryDigest: value(current, "inventory_digest"), tests: ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "PORT_REACHABILITY"] }), context.now] },
        { sql: "UPDATE hosting_v2_devices SET status='VERIFYING',verification_status='PENDING',version=version+1,updated_at=? WHERE id=?", values: [context.now, deviceId] },
        event(context, organizationId, "DEVICE", deviceId, "DEVICE_VERIFICATION_QUEUED", { commandId }),
        receipt(context, "QUEUE_VERIFICATION", "AGENT_COMMAND", commandId),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]);
      if (!row) throw new Error("HOSTING_VERIFICATION_QUEUE_FAILED");
      return command(row);
    },
  };
}

function createMarketMethods(db: HostingV2DatabaseAdapter): Partial<HostingV2Store> {
  return {
    async createFeeSchedule(input, context) {
      const replayed = await replay(db, context, "CREATE_FEE_SCHEDULE");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "费率版本不存在。");
        return fee(row);
      }
      if (!Number.isInteger(input.platformFeeBps) || input.platformFeeBps < 0 || input.platformFeeBps > 5000) throw new ExchangeInputError("平台服务费应为 0–5000 基点。", "platformFeeBps");
      if (!Number.isInteger(input.referralRewardBps) || input.referralRewardBps < 0 || input.referralRewardBps > input.platformFeeBps) throw new ExchangeInputError("推荐奖励不能超过平台服务费。", "referralRewardBps");
      if (Number.isNaN(Date.parse(input.effectiveFrom))) throw new ExchangeInputError("费率生效时间无效。", "effectiveFrom");
      const recordId = id("hfee");
      const statements: HostingV2Sql[] = [];
      if (input.activate) statements.push({ sql: "UPDATE hosting_v2_fee_schedules SET status='RETIRED' WHERE status='ACTIVE'" });
      statements.push(
        { sql: "INSERT INTO hosting_v2_fee_schedules(id,platform_fee_bps,referral_reward_bps,status,effective_from,created_by,created_at) VALUES(?,?,?,?,?,?,?)", values: [recordId, input.platformFeeBps, input.referralRewardBps, input.activate ? "ACTIVE" : "DRAFT", new Date(input.effectiveFrom).toISOString(), context.actorId, context.now] },
        event(context, null, "FEE_SCHEDULE", recordId, input.activate ? "FEE_SCHEDULE_ACTIVATED" : "FEE_SCHEDULE_CREATED"),
        receipt(context, "CREATE_FEE_SCHEDULE", "FEE_SCHEDULE", recordId),
      );
      await db.batch(statements);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE id=?", [recordId]);
      if (!row) throw new Error("HOSTING_FEE_CREATE_FAILED");
      return fee(row);
    },

    async activeFeeSchedule(now) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [now]);
      return row ? fee(row) : null;
    },

    async createOffer(organizationId, input, context) {
      const replayed = await replay(db, context, "CREATE_OFFER");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_offers WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "挂牌不存在。");
        return offer(row);
      }
      const [profileRow, deviceRow, feeRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]),
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=? AND organization_id=?", [input.deviceId, organizationId]),
        db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [context.now]),
      ]);
      if (!profileRow || value(profileRow, "status") !== "APPROVED") throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体未通过审核。");
      if (!deviceRow || value(deviceRow, "status") !== "VERIFIED" || value(deviceRow, "verification_status") !== "PASSED" || !deviceRow.verified_until || Date.parse(value(deviceRow, "verified_until")) <= Date.parse(context.now) || !deviceRow.last_seen_at || Date.parse(value(deviceRow, "last_seen_at")) < Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000) {
        throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 409, "设备需保持在线且验真有效后才能挂牌。");
      }
      if (!feeRow) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 503, "平台尚未启用正式费率版本，挂牌保持关闭。");
      if (input.gpuModel !== json<HostingDeviceInventory>(deviceRow, "inventory_json").gpuModel) throw new ExchangeInputError("挂牌 GPU 型号与设备验真结果不一致。", "gpuModel");
      const title = input.title.normalize("NFKC").trim();
      const region = input.region.normalize("NFKC").trim();
      if (title.length < 3 || title.length > 120) throw new ExchangeInputError("挂牌标题应为 3–120 个字符。", "title");
      if (region.length < 2 || region.length > 80) throw new ExchangeInputError("资源区域应为 2–80 个字符。", "region");
      if (!Number.isSafeInteger(input.cardHourMicrosPerGpuHour) || input.cardHourMicrosPerGpuHour < 1) throw new ExchangeInputError("卡时报价无效。", "cardHourMicrosPerGpuHour");
      if (!Number.isInteger(input.minRentalSeconds) || input.minRentalSeconds < 180 || !Number.isInteger(input.maxRentalSeconds) || input.maxRentalSeconds < input.minRentalSeconds || input.maxRentalSeconds > 31 * 24 * 3600) throw new ExchangeInputError("租用时长范围无效。", "minRentalSeconds");
      const availableFrom = Date.parse(input.availableFrom);
      const availableUntil = Date.parse(input.availableUntil);
      if (!Number.isFinite(availableFrom) || !Number.isFinite(availableUntil) || availableUntil <= availableFrom || availableUntil <= Date.parse(context.now)) throw new ExchangeInputError("可用时间窗无效。", "availableUntil");
      assertHostingV2ApprovedImage(input.approvedImage);
      if (!/^KAI_HOSTING_TERMS_\d{4}_\d{2}$/u.test(input.termsVersion)) throw new ExchangeInputError("挂牌协议版本无效。", "termsVersion");
      const recordId = id("hofr");
      await db.batch([
        { sql: `INSERT INTO hosting_v2_offers(id,organization_id,device_id,fee_schedule_id,title,gpu_model,region,card_hour_micros_per_gpu_hour,min_rental_seconds,max_rental_seconds,available_from,available_until,approved_image,terms_version,status,version,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?)`, values: [recordId, organizationId, input.deviceId, value(feeRow, "id"), title, input.gpuModel, region, input.cardHourMicrosPerGpuHour, input.minRentalSeconds, input.maxRentalSeconds, new Date(availableFrom).toISOString(), new Date(availableUntil).toISOString(), input.approvedImage, input.termsVersion, context.now, context.now] },
        event(context, organizationId, "OFFER", recordId, "OFFER_CREATED"),
        receipt(context, "CREATE_OFFER", "OFFER", recordId),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_offers WHERE id=?", [recordId]);
      if (!row) throw new Error("HOSTING_OFFER_CREATE_FAILED");
      return offer(row);
    },

    async updateOfferStatus(organizationId, offerId, input, context) {
      const replayed = await replay(db, context, "UPDATE_OFFER_STATUS");
      if (!replayed) {
        const current = await db.first<Row>("SELECT o.*,d.status device_status,d.verification_status device_verification,d.verified_until,d.last_seen_at,p.status supplier_status FROM hosting_v2_offers o JOIN hosting_v2_devices d ON d.id=o.device_id JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id WHERE o.id=? AND o.organization_id=?", [offerId, organizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "挂牌不存在。");
        if (number(current, "version") !== input.expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "挂牌版本已变化。");
        if (input.status === "PUBLISHED" && value(current, "supplier_status") !== "APPROVED") throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体当前未获准发布挂牌。");
        if (input.status === "PUBLISHED" && (value(current, "device_status") !== "VERIFIED" || value(current, "device_verification") !== "PASSED" || Date.parse(value(current, "verified_until")) <= Date.parse(context.now) || Date.parse(value(current, "last_seen_at")) < Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000)) throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 409, "设备不在线或验真已经过期。");
        const allowed = input.status === "PUBLISHED" ? ["DRAFT", "PAUSED"] : input.status === "PAUSED" ? ["PUBLISHED"] : ["DRAFT", "PUBLISHED", "PAUSED", "SUSPENDED"];
        if (!allowed.includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "挂牌当前不能执行这个动作。");
        await db.batch([
          { sql: `UPDATE hosting_v2_offers SET status=?,version=version+1,updated_at=? WHERE id=? AND organization_id=? AND version=? AND status IN (${allowed.map(() => "?").join(",")})`, values: [input.status, context.now, offerId, organizationId, input.expectedVersion, ...allowed] },
          event(context, organizationId, "OFFER", offerId, `OFFER_${input.status}`),
          receipt(context, "UPDATE_OFFER_STATUS", "OFFER", offerId),
        ]);
      }
      const row = await db.first<Row>("SELECT * FROM hosting_v2_offers WHERE id=? AND organization_id=?", [offerId, organizationId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "挂牌不存在。");
      return offer(row);
    },

    async listPublicOffers(now) {
      const cutoff = new Date(Date.parse(now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000).toISOString();
      return (await db.all<Row>(`SELECT o.* FROM hosting_v2_offers o JOIN hosting_v2_devices d ON d.id=o.device_id JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id
        WHERE o.status='PUBLISHED' AND p.status='APPROVED' AND o.available_from<=? AND o.available_until>? AND d.status='VERIFIED' AND d.verification_status='PASSED' AND d.verified_until>? AND d.last_seen_at>=?
        ORDER BY o.card_hour_micros_per_gpu_hour,o.created_at`, [now, now, now, cutoff])).map(offer);
    },

    async getOffer(offerId) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_offers WHERE id=?", [offerId]);
      return row ? offer(row) : null;
    },

    async reserveContract(account, offerId, reservedSeconds, heldMicros, context) {
      const replayed = await replay(db, context, "RESERVE_CONTRACT");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
        return contract(row);
      }
      const row = await db.first<Row>(`SELECT o.*,f.platform_fee_bps,f.referral_reward_bps FROM hosting_v2_offers o
        JOIN hosting_v2_fee_schedules f ON f.id=o.fee_schedule_id
        JOIN hosting_v2_devices d ON d.id=o.device_id
        JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id
        WHERE o.id=? AND o.status='PUBLISHED' AND p.status='APPROVED' AND o.available_from<=? AND o.available_until>? AND d.status='VERIFIED' AND d.verification_status='PASSED' AND d.verified_until>?`, [offerId, context.now, context.now, context.now]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源已不可租用，请刷新市场。");
      if (value(row, "organization_id") === account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "供应方不能购买自己的资源。");
      if (!Number.isInteger(reservedSeconds) || reservedSeconds < number(row, "min_rental_seconds") || reservedSeconds > number(row, "max_rental_seconds")) throw new ExchangeInputError("租用时长不在挂牌范围内。", "reservedSeconds");
      const recordId = id("hctr");
      const snapshot = {
        title: value(row, "title"), gpuModel: value(row, "gpu_model"), region: value(row, "region"),
        cardHourMicrosPerGpuHour: number(row, "card_hour_micros_per_gpu_hour"), approvedImage: value(row, "approved_image"), termsVersion: value(row, "terms_version"),
        platformFeeBps: number(row, "platform_fee_bps"), referralRewardBps: number(row, "referral_reward_bps"),
      };
      await db.batch([
        { sql: `INSERT INTO hosting_v2_contracts(id,offer_id,device_id,buyer_organization_id,buyer_account_id,supplier_organization_id,fee_schedule_id,snapshot_json,reserved_seconds,held_micros,status,idempotency_key,payload_hash,version,created_at,updated_at)
          SELECT ?,id,device_id,?,?,?,?,?,?,?,'RESERVED',?,?,1,?,? FROM hosting_v2_offers WHERE id=? AND status='PUBLISHED'`, values: [recordId, account.activeOrganization.id, account.account.id, value(row, "organization_id"), value(row, "fee_schedule_id"), JSON.stringify(snapshot), reservedSeconds, heldMicros, context.idempotencyKey, context.payloadHash, context.now, context.now, offerId] },
        { sql: "UPDATE hosting_v2_offers SET status='RESERVED',version=version+1,updated_at=? WHERE id=? AND status='PUBLISHED' AND EXISTS(SELECT 1 FROM hosting_v2_contracts WHERE id=?)", values: [context.now, offerId, recordId] },
        event(context, account.activeOrganization.id, "CONTRACT", recordId, "CONTRACT_RESERVED", { offerId, reservedSeconds, heldMicros }),
        receipt(context, "RESERVE_CONTRACT", "CONTRACT", recordId),
      ]);
      const created = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [recordId]);
      if (!created) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源刚刚被其他订单预留，请重新选择。");
      return contract(created);
    },

    async markContractHeld(buyerOrganizationId, contractId, context) {
      const replayed = await replay(db, context, "MARK_CONTRACT_HELD");
      if (!replayed) await db.batch([
        { sql: "UPDATE hosting_v2_contracts SET status='CARD_HOURS_HELD',version=version+1,updated_at=? WHERE id=? AND buyer_organization_id=? AND status='RESERVED'", values: [context.now, contractId, buyerOrganizationId] },
        event(context, buyerOrganizationId, "CONTRACT", contractId, "CARD_HOURS_HELD"),
        receipt(context, "MARK_CONTRACT_HELD", "CONTRACT", contractId),
      ]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND buyer_organization_id=?", [contractId, buyerOrganizationId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
      if (value(row, "status") !== "CARD_HOURS_HELD") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同卡时未完成锁定。");
      return contract(row);
    },

    async contractForViewer(organizationId, contractId) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND (buyer_organization_id=? OR supplier_organization_id=?)", [contractId, organizationId, organizationId]);
      return row ? contract(row) : null;
    },

    async cancelContract(contractId, reason, context) {
      const replayed = await replay(db, context, "CANCEL_CONTRACT");
      if (!replayed) {
        const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
        if (!/[\p{L}\p{N}]/u.test(reason) || reason.trim().length < 4) throw new ExchangeInputError("取消原因至少 4 个字符。", "reason");
        if (!['RESERVED','CARD_HOURS_HELD','PAID','PROVISIONING','READY'].includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不能取消。");
        await db.batch([
          { sql: "UPDATE hosting_v2_contracts SET status='CANCELLED',version=version+1,updated_at=? WHERE id=? AND status IN ('RESERVED','CARD_HOURS_HELD','PAID','PROVISIONING','READY')", values: [context.now, contractId] },
          { sql: "UPDATE hosting_v2_offers SET status='PUBLISHED',version=version+1,updated_at=? WHERE id=? AND status='RESERVED'", values: [context.now, value(current, "offer_id")] },
          event(context, value(current, "buyer_organization_id"), "CONTRACT", contractId, "CONTRACT_CANCELLED", { reason: reason.trim() }),
          receipt(context, "CANCEL_CONTRACT", "CONTRACT", contractId),
        ]);
      }
      const row = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
      return contract(row);
    },

    async attachSshKey(buyerOrganizationId, contractId, input, context) {
      const replayed = await replay(db, context, "ATTACH_SSH_KEY");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "开通任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND buyer_organization_id=?", [contractId, buyerOrganizationId]);
      if (!current || value(current, "status") !== "CARD_HOURS_HELD") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同未锁定卡时或已经提交公钥。");
      const deviceRow = await db.first<Row>("SELECT agent_version FROM hosting_v2_devices WHERE id=?", [value(current, "device_id")]);
      if (!deviceRow || !agentVersionAtLeast(value(deviceRow, "agent_version"), HOSTING_V2_MIN_AGENT_VERSION)) throw new ExchangeDomainError("HOSTING_AGENT_UPGRADE_REQUIRED", 409, `Host Agent 需要升级到 ${HOSTING_V2_MIN_AGENT_VERSION} 或更高版本。`);
      if (!/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]{40,8192}(?: [^\r\n]{1,120})?$/u.test(input.publicKey.trim())) throw new ExchangeInputError("请提交有效的 OpenSSH 公钥。", "publicKey");
      if (!/^SHA256:[A-Za-z0-9+/]{20,64}$/u.test(input.fingerprint)) throw new ExchangeInputError("SSH 公钥指纹无效。", "fingerprint");
      const commandId = id("hcmd");
      const snapshot = json<HostingContract["snapshot"]>(current, "snapshot_json");
      const payload = { contractId, image: snapshot.approvedImage, publicKey: input.publicKey.trim(), reservedSeconds: number(current, "reserved_seconds"), gpuCount: 1 };
      await db.batch([
        { sql: "UPDATE hosting_v2_contracts SET status='PROVISIONING',ssh_public_key_fingerprint=?,version=version+1,updated_at=? WHERE id=? AND status='CARD_HOURS_HELD'", values: [input.fingerprint, context.now, contractId] },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'PROVISION',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, JSON.stringify(payload), context.now] },
        event(context, buyerOrganizationId, "CONTRACT", contractId, "PROVISIONING_QUEUED", { commandId, publicKeyFingerprint: input.fingerprint }),
        receipt(context, "ATTACH_SSH_KEY", "AGENT_COMMAND", commandId),
      ]);
      const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId])]);
      if (!contractRow || !commandRow) throw new Error("HOSTING_PROVISION_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(commandRow) };
    },

    async requestContractStart(buyerOrganizationId, contractId, context) {
      const replayed = await replay(db, context, "START_CONTRACT");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "启动任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND buyer_organization_id=?", [contractId, buyerOrganizationId]);
      if (!current || value(current, "status") !== "READY") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实例尚未准备完成。");
      const endpointDisplay = nullable(current, "endpoint_display");
      if (!endpointDisplay) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实例连接入口尚未准备完成。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'START',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, JSON.stringify({ contractId, endpointDisplay }), context.now] },
        event(context, buyerOrganizationId, "CONTRACT", contractId, "START_QUEUED", { commandId }),
        receipt(context, "START_CONTRACT", "AGENT_COMMAND", commandId),
      ]);
      const commandRow = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]);
      if (!commandRow) throw new Error("HOSTING_START_QUEUE_FAILED");
      return { contract: contract(current), command: command(commandRow) };
    },

    async requestContractStop(organizationId, contractId, context) {
      const replayed = await replay(db, context, "STOP_CONTRACT");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "停止任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND (buyer_organization_id=? OR supplier_organization_id=?)", [contractId, organizationId, organizationId]);
      if (!current || value(current, "status") !== "IN_SERVICE") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实例当前不在运行。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'STOP',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, JSON.stringify({ contractId, startedAt: nullable(current, "started_at"), maximumSeconds: number(current, "reserved_seconds") }), context.now] },
        event(context, organizationId, "CONTRACT", contractId, "STOP_QUEUED", { commandId }),
        receipt(context, "STOP_CONTRACT", "AGENT_COMMAND", commandId),
      ]);
      const commandRow = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]);
      if (!commandRow) throw new Error("HOSTING_STOP_QUEUE_FAILED");
      return { contract: contract(current), command: command(commandRow) };
    },

    async pollCommand(deviceId, now) {
      const leaseCutoff = new Date(Date.parse(now) - 60_000).toISOString();
      const current = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE device_id=? AND (status='PENDING' OR (status='DELIVERED' AND delivered_at<? AND attempt<5)) ORDER BY created_at LIMIT 1", [deviceId, leaseCutoff]);
      if (!current) return null;
      await db.batch([{ sql: "UPDATE hosting_v2_agent_commands SET status='DELIVERED',attempt=attempt+1,delivered_at=? WHERE id=? AND (status='PENDING' OR (status='DELIVERED' AND delivered_at<? AND attempt<5))", values: [now, value(current, "id"), leaseCutoff] }]);
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [value(current, "id")]);
      return row ? command(row) : null;
    },

    async completeCommand(deviceId, commandId, input, context) {
      const [commandRow, deviceRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=? AND device_id=?", [commandId, deviceId]),
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]),
      ]);
      if (!commandRow || !deviceRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备任务不存在。");
      if (["SUCCEEDED", "FAILED"].includes(value(commandRow, "status"))) {
        if (nullable(commandRow, "evidence_digest") !== input.evidenceDigest || value(commandRow, "status") !== input.outcome) throw new ExchangeIdempotencyConflictError();
        const existingContract = commandRow.contract_id ? await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [value(commandRow, "contract_id")]) : null;
        return { command: command(commandRow), contract: existingContract ? contract(existingContract) : null, device: device(deviceRow) };
      }
      const type = value(commandRow, "command_type") as HostingAgentCommand["type"];
      const success = input.outcome === "SUCCEEDED";
      const commandPayload = json<Record<string, unknown>>(commandRow, "payload_json");
      const deviceInventory = json<HostingDeviceInventory>(deviceRow, "inventory_json");
      if (type === "VERIFY" && success) assertSuccessfulVerificationDetails(input.details, value(deviceRow, "inventory_digest"), context.now);
      const provisionEndpoint = type === "PROVISION" && success ? assertSuccessfulProvisionDetails(input.details, commandPayload, deviceInventory, context.now) : null;
      if (type === "START" && success) assertSuccessfulStartDetails(input.details, commandPayload, context.now);
      if (type === "STOP" && success) assertSuccessfulStopDetails(input.details, commandPayload, context.now);
      if (type === "CLEANUP" && success) assertSuccessfulCleanupDetails(input.details, commandPayload, context.now);
      const statements: HostingV2Sql[] = [
        { sql: "UPDATE hosting_v2_agent_commands SET status=?,evidence_digest=?,error_code=?,completed_at=? WHERE id=? AND status IN ('PENDING','DELIVERED')", values: [input.outcome, input.evidenceDigest, input.errorCode ?? null, context.now, commandId] },
      ];
      const contractId = nullable(commandRow, "contract_id");
      let organizationId = value(deviceRow, "organization_id");
      if (type === "VERIFY") {
        const verifiedUntil = new Date(Date.parse(context.now) + 24 * 60 * 60_000).toISOString();
        statements.push({ sql: "UPDATE hosting_v2_devices SET status=?,verification_status=?,verification_evidence_digest=?,verified_until=?,version=version+1,updated_at=? WHERE id=?", values: [success ? "VERIFIED" : "ONLINE", success ? "PASSED" : "FAILED", input.evidenceDigest, success ? verifiedUntil : null, context.now, deviceId] });
        if (!success) statements.push({ sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE device_id=? AND status IN ('PUBLISHED','PAUSED')", values: [context.now, deviceId] });
      } else if (contractId) {
        const currentContract = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!currentContract) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "任务关联合同不存在。");
        organizationId = value(currentContract, "supplier_organization_id");
        if (!success) {
          statements.push({ sql: "UPDATE hosting_v2_contracts SET status=?,version=version+1,updated_at=? WHERE id=?", values: [type === "CLEANUP" ? "CLEANING" : "FAILED", context.now, contractId] });
          statements.push(
              { sql: "UPDATE hosting_v2_devices SET status='DRAINING',version=version+1,updated_at=? WHERE id=?", values: [context.now, deviceId] },
              { sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE id=?", values: [context.now, value(currentContract, "offer_id")] },
            );
        } else if (type === "PROVISION") {
          statements.push(
            { sql: "UPDATE hosting_v2_contracts SET status='READY',endpoint_display=?,version=version+1,updated_at=? WHERE id=? AND status='PROVISIONING'", values: [provisionEndpoint, context.now, contractId] },
            { sql: "UPDATE hosting_v2_devices SET status='BUSY',version=version+1,updated_at=? WHERE id=?", values: [context.now, deviceId] },
          );
        } else if (type === "START") {
          statements.push({ sql: "UPDATE hosting_v2_contracts SET status='IN_SERVICE',started_at=?,version=version+1,updated_at=? WHERE id=? AND status='READY'", values: [context.now, context.now, contractId] });
        } else if (type === "STOP") {
          const rawMeasured = Number(input.details?.runtimeSeconds);
          const wallClockSeconds = Math.max(0, Math.ceil((Date.parse(context.now) - Date.parse(value(currentContract, "started_at"))) / 1_000));
          const measured = Math.max(180, Math.min(number(currentContract, "reserved_seconds"), wallClockSeconds, rawMeasured));
          statements.push({ sql: "UPDATE hosting_v2_contracts SET status='AWAITING_ACCEPTANCE',measured_seconds=?,stopped_at=?,version=version+1,updated_at=? WHERE id=? AND status='IN_SERVICE'", values: [measured, context.now, context.now, contractId] });
        } else if (type === "CLEANUP") {
          const verificationFresh = value(deviceRow, "verification_status") === "PASSED"
            && Date.parse(nullable(deviceRow, "verified_until") ?? "") > Date.parse(context.now)
            && Date.parse(nullable(deviceRow, "last_seen_at") ?? "") >= Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000;
          statements.push(
            { sql: "UPDATE hosting_v2_contracts SET status='CLEANED',version=version+1,updated_at=? WHERE id=? AND status='CLEANING'", values: [context.now, contractId] },
            { sql: "UPDATE hosting_v2_devices SET status=?,verification_status=?,version=version+1,updated_at=? WHERE id=?", values: [verificationFresh ? "VERIFIED" : "ONLINE", value(deviceRow, "verification_status") === "PASSED" && Date.parse(nullable(deviceRow, "verified_until") ?? "") <= Date.parse(context.now) ? "EXPIRED" : value(deviceRow, "verification_status"), context.now, deviceId] },
            { sql: "UPDATE hosting_v2_offers SET status=?,version=version+1,updated_at=? WHERE id=? AND status='RESERVED'", values: [verificationFresh ? "PUBLISHED" : "SUSPENDED", context.now, value(currentContract, "offer_id")] },
          );
        }
      }
      statements.push(event(context, organizationId, "AGENT_COMMAND", commandId, `AGENT_COMMAND_${input.outcome}`, { type, contractId, errorCode: input.errorCode ?? null }));
      await db.batch(statements);
      const [finalCommand, finalDevice, finalContract] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]),
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]),
        contractId ? db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]) : Promise.resolve(null),
      ]);
      if (!finalCommand || !finalDevice) throw new Error("HOSTING_COMMAND_COMPLETION_FAILED");
      return { command: command(finalCommand), contract: finalContract ? contract(finalContract) : null, device: device(finalDevice) };
    },

    async markContractSettled(contractId, input, context) {
      const replayed = await replay(db, context, "SETTLE_CONTRACT");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "清理任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
      if (!current || value(current, "status") !== "AWAITING_ACCEPTANCE") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不能结算。");
      if (!Number.isSafeInteger(input.measuredSeconds) || input.measuredSeconds < 180 || input.measuredSeconds > number(current, "reserved_seconds") || !Number.isSafeInteger(input.settledMicros) || input.settledMicros < 1 || input.settledMicros > number(current, "held_micros")) throw new ExchangeInputError("合同计量或结算金额无效。");
      if (input.supplierIncomeMicros < 0 || input.commissionMicros < 0 || input.supplierIncomeMicros + input.commissionMicros > input.settledMicros) throw new ExchangeInputError("收益拆分无效。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: "UPDATE hosting_v2_contracts SET status='CLEANING',measured_seconds=?,settled_micros=?,supplier_income_micros=?,commission_micros=?,accepted_at=?,version=version+1,updated_at=? WHERE id=? AND status='AWAITING_ACCEPTANCE'", values: [input.measuredSeconds, input.settledMicros, input.supplierIncomeMicros, input.commissionMicros, context.now, context.now, contractId] },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'CLEANUP',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, JSON.stringify({ contractId, removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true }), context.now] },
        event(context, value(current, "supplier_organization_id"), "CONTRACT", contractId, "CONTRACT_SETTLED", input),
        receipt(context, "SETTLE_CONTRACT", "AGENT_COMMAND", commandId),
      ]);
      const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId])]);
      if (!contractRow || !commandRow) throw new Error("HOSTING_SETTLEMENT_CLEANUP_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(commandRow) };
    },
  };
}
