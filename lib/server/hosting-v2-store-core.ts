import { HOSTING_FEE_LEGACY_QUALIFICATION_MODEL, HOSTING_FEE_QUALIFICATION_MODEL, HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS, HOSTING_V2_AGENT_STALE_SECONDS, hostingActualFeeBreakdown, hostingCardHourMicrosForSeconds, hostingCurrentCalendarMonth, hostingDefaultFeeTiers, hostingFeeBreakdown, hostingFeeRatesAreValid, hostingSelectFeeTier, type HostingAgentChallenge, type HostingAgentCommand, type HostingCleanupIncident, type HostingContract, type HostingContractEvidence, type HostingDashboard, type HostingDevice, type HostingDeviceInventory, type HostingDisputeCase, type HostingFeeSchedule, type HostingFeeTier, type HostingGoldenLoopAudit, type HostingOffer, type HostingStopIncident, type HostingSupplierFeePreview, type HostingSupplierMonthlySettlement, type HostingSupplierProfile } from "../hosting-v2.ts";
import { HOSTING_V2_SCHEMA_COMPATIBILITY_VERSION, HOSTING_V2_SCHEMA_VERSION, hostingV2SchemaStatements } from "../../db/hosting-v2-schema.ts";
import { ExchangeDomainError, ExchangeIdempotencyConflictError, ExchangeInputError } from "./exchange-errors.ts";
import { assertHostingAgentWindow, hostingAgentCanonicalJson, hostingAgentDigest, verifyHostingAgentSignature } from "./hosting-agent-crypto.ts";
import { assertHostingV2ApprovedImage, HOSTING_V2_OCI_IMAGE_PATTERN, hostingV2ApprovedImages } from "./hosting-v2-image-policy.ts";
import { gpuTradingEligibility, physicalGpuAudit } from "./hosting-v2-audit-policy.ts";
import type { HostingMutationContext, HostingV2DatabaseAdapter, HostingV2Sql, HostingV2Store } from "./hosting-v2-store.ts";

type Row = Record<string, unknown>;
const value = (row: Row, key: string) => String(row[key]);
const nullable = (row: Row, key: string) => row[key] == null ? null : String(row[key]);
const number = (row: Row, key: string) => Number(row[key]);
const json = <T>(row: Row, key: string) => JSON.parse(value(row, key)) as T;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
const VERIFY_TEST_NAMES = ["GPU_IDENTITY", "CUDA_SMOKE", "MEMORY", "STORAGE", "NETWORK", "WORKLOAD_IMAGE", "PORT_REACHABILITY"] as const;
const HOSTING_V2_MIN_AGENT_VERSION = "1.9.5";
const HOSTING_V2_AUTOMATED_STOP_ATTEMPTS = 4;
const DEVICE_RETIREMENT_EVENT_TYPES = ["DEVICE_RETIREMENT_REQUESTED", "DEVICE_CREDENTIAL_REVOKED", "DEVICE_RETIREMENT_FINALIZED"] as const;
const DEVICE_RETIREMENT_EVENT_SQL = `EXISTS(
  SELECT 1 FROM hosting_v2_events retirement
  WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=hosting_v2_devices.id
    AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED')
)`;

async function hasDeviceRetirementEvent(db: HostingV2DatabaseAdapter, deviceId: string) {
  const row = await db.first<{ found: number }>(`SELECT EXISTS(
    SELECT 1 FROM hosting_v2_events
    WHERE entity_type='DEVICE' AND entity_id=? AND event_type IN (${DEVICE_RETIREMENT_EVENT_TYPES.map(() => "?").join(",")})
  ) AS found`, [deviceId, ...DEVICE_RETIREMENT_EVENT_TYPES]);
  return Number(row?.found ?? 0) === 1;
}

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

function verificationAllowsImage(row: Row, image: string) {
  try {
    const payload = json<Record<string, unknown>>(row, "verification_payload_json");
    return Array.isArray(payload.approvedImages) && payload.approvedImages.includes(image);
  } catch { return false; }
}

function rowInventory(row: Row, key = "inventory_json") {
  return json<HostingDeviceInventory>(row, key);
}

function assertGpuTradingEligible(row: Row, key = "inventory_json") {
  const eligibility = gpuTradingEligibility(rowInventory(row, key));
  if (!eligibility.passed) throw new ExchangeDomainError("HOSTING_PHYSICAL_GPU_REQUIRED", 409, eligibility.detail);
}

function assertSuccessfulVerificationDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, expectedInventoryDigest: string, controlPlaneReachabilityDigest: string | undefined, now: string) {
  if (!details || details.protocolVersion !== 1 || details.inventoryDigest !== expectedInventoryDigest || typeof details.observedAt !== "string") {
    throw new ExchangeInputError("设备验真结果结构无效。", "details");
  }
  const observedAt = Date.parse(details.observedAt);
  if (!Number.isFinite(observedAt) || Math.abs(observedAt - Date.parse(now)) > 10 * 60_000) throw new ExchangeInputError("设备验真观测时间无效。", "details.observedAt");
  if (!Array.isArray(details.tests) || details.tests.length !== VERIFY_TEST_NAMES.length) throw new ExchangeInputError("设备验真测试数量无效。", "details.tests");
  const names = new Set<string>();
  let portReachability: Record<string, unknown> | null = null;
  let workloadImage: Record<string, unknown> | null = null;
  for (const item of details.tests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ExchangeInputError("设备验真测试结构无效。", "details.tests");
    const result = item as Record<string, unknown>;
    if (!VERIFY_TEST_NAMES.includes(result.name as typeof VERIFY_TEST_NAMES[number]) || result.status !== "PASSED" || typeof result.evidenceDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(result.evidenceDigest)) {
      throw new ExchangeInputError("设备验真测试结果无效。", "details.tests");
    }
    if (result.name === "PORT_REACHABILITY") portReachability = result;
    if (result.name === "WORKLOAD_IMAGE") workloadImage = result;
    names.add(String(result.name));
  }
  if (names.size !== VERIFY_TEST_NAMES.length) throw new ExchangeInputError("设备验真测试存在重复或缺失。", "details.tests");
  const approvedImages = Array.isArray(payload.approvedImages) ? payload.approvedImages : [];
  const workloadSummary = workloadImage?.summary;
  if (approvedImages.length === 0 || !workloadSummary || typeof workloadSummary !== "object" || Array.isArray(workloadSummary)
    || (workloadSummary as Record<string, unknown>).scope !== "APPROVED_WORKLOAD_IMAGES"
    || (workloadSummary as Record<string, unknown>).allPresent !== true
    || JSON.stringify((workloadSummary as Record<string, unknown>).images) !== JSON.stringify(approvedImages)) {
    throw new ExchangeInputError("设备未证明平台批准的不可变工作负载镜像已就绪。", "details.tests.WORKLOAD_IMAGE");
  }
  const summary = portReachability?.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)
    || (summary as Record<string, unknown>).scope !== "CONTROL_PLANE_CHALLENGE"
    || (summary as Record<string, unknown>).challengeDigest !== controlPlaneReachabilityDigest
    || !/^sha256:[a-f0-9]{64}$/u.test(controlPlaneReachabilityDigest ?? "")) {
    throw new ExchangeInputError("设备公网入口未经 Cloud 控制面回连验证。", "details.tests.PORT_REACHABILITY");
  }
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

function assertSuccessfulStopDetails(details: Record<string, unknown> | undefined, payload: Record<string, unknown>, now: string, allowHistoricalStoppedAt = false) {
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
  const maximumSeconds = typeof payload.maximumSeconds === "number" ? payload.maximumSeconds : Number.NaN;
  const serverNow = Date.parse(now);
  const calculatedSeconds = Math.max(0, Math.ceil((stoppedAt - startedAt) / 1_000));
  const stoppedAtIsFresh = Math.abs(stoppedAt - serverNow) <= 10 * 60_000;
  const stoppedAtFollowsLeaseExpiry = Number.isFinite(maximumSeconds) && stoppedAt >= expectedStartedAt + maximumSeconds * 1_000;
  if (!Number.isFinite(observedAt) || !Number.isFinite(startedAt) || !Number.isFinite(stoppedAt) || !Number.isFinite(expectedStartedAt)
    || startedAt > stoppedAt || stoppedAt > observedAt || Math.abs(observedAt - serverNow) > 10 * 60_000
    || (!allowHistoricalStoppedAt && !stoppedAtIsFresh && !stoppedAtFollowsLeaseExpiry) || Math.abs(startedAt - expectedStartedAt) > 10 * 60_000
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
    consumedAt: nullable(row, "consumed_at"), revokedAt: nullable(row, "revoked_at"), createdAt: value(row, "created_at"),
  };
}

const agentChallengeProjection = `SELECT c.*,
  (SELECT e.occurred_at FROM hosting_v2_events e
    WHERE e.entity_type='AGENT_CHALLENGE' AND e.entity_id=c.id AND e.event_type='AGENT_CHALLENGE_REVOKED'
    ORDER BY e.occurred_at DESC LIMIT 1) AS revoked_at
  FROM hosting_v2_agent_challenges c`;

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
  const rawSnapshot = json<HostingContract["snapshot"]>(row, "snapshot_json");
  const snapshot = {
    ...rawSnapshot,
    feeQualification: rawSnapshot.feeQualification ?? null,
    acceptanceWindowSeconds: Number.isSafeInteger(rawSnapshot.acceptanceWindowSeconds) && rawSnapshot.acceptanceWindowSeconds >= 0
      ? rawSnapshot.acceptanceWindowSeconds
      : HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS,
  };
  return {
    id: value(row, "id"), offerId: value(row, "offer_id"), deviceId: value(row, "device_id"), buyerOrganizationId: value(row, "buyer_organization_id"), buyerAccountId: value(row, "buyer_account_id"), supplierOrganizationId: value(row, "supplier_organization_id"), feeScheduleId: value(row, "fee_schedule_id"),
    snapshot, reservedSeconds: number(row, "reserved_seconds"), measuredSeconds: row.measured_seconds == null ? null : number(row, "measured_seconds"), heldMicros: number(row, "held_micros"), settledMicros: row.settled_micros == null ? null : number(row, "settled_micros"), supplierIncomeMicros: row.supplier_income_micros == null ? null : number(row, "supplier_income_micros"), commissionMicros: row.commission_micros == null ? null : number(row, "commission_micros"), status: value(row, "status") as HostingContract["status"],
    sshPublicKeyFingerprint: nullable(row, "ssh_public_key_fingerprint"), endpointDisplay: nullable(row, "endpoint_display"), startedAt: nullable(row, "started_at"), stoppedAt: nullable(row, "stopped_at"), acceptedAt: nullable(row, "accepted_at"), version: number(row, "version"), createdAt: value(row, "created_at"), updatedAt: value(row, "updated_at"),
  };
}

function contractEvidence(instanceRow: Row | null, meteringRow: Row | null, cleanupRow: Row | null, acceptanceRow: Row | null, disputeRow: Row | null, deliveryFailureRow: Row | null, stopFailureRow: Row | null, runtimeControlRow: Row): HostingContractEvidence {
  return {
    instance: instanceRow ? {
      status: value(instanceRow, "status") as NonNullable<HostingContractEvidence["instance"]>["status"],
      containerDigest: value(instanceRow, "container_digest"), workspaceDigest: value(instanceRow, "workspace_digest"),
      provisionEvidenceDigest: value(instanceRow, "provision_evidence_digest"), startEvidenceDigest: nullable(instanceRow, "start_evidence_digest"), stopEvidenceDigest: nullable(instanceRow, "stop_evidence_digest"),
      provisionedAt: value(instanceRow, "provisioned_at"), startedAt: nullable(instanceRow, "started_at"), stoppedAt: nullable(instanceRow, "stopped_at"), cleanedAt: nullable(instanceRow, "cleaned_at"),
    } : null,
    metering: meteringRow ? {
      runtimeStateDigest: value(meteringRow, "runtime_state_digest"), agentStartedAt: value(meteringRow, "agent_started_at"), agentStoppedAt: value(meteringRow, "agent_stopped_at"),
      agentRuntimeSeconds: number(meteringRow, "agent_runtime_seconds"), serverMeasuredSeconds: number(meteringRow, "server_measured_seconds"), evidenceDigest: value(meteringRow, "evidence_digest"), recordedAt: value(meteringRow, "recorded_at"),
    } : null,
    cleanup: cleanupRow ? {
      cleanupDigest: value(cleanupRow, "cleanup_digest"), containerRemoved: true, authorizedKeyRemoved: true, workspaceRemoved: true,
      evidenceDigest: value(cleanupRow, "evidence_digest"), cleanedAt: value(cleanupRow, "cleaned_at"), recordedAt: value(cleanupRow, "recorded_at"),
    } : null,
    acceptance: acceptanceRow ? {
      mode: value(acceptanceRow, "decision_mode") as "BUYER" | "TIMEOUT",
      acceptanceWindowSeconds: number(acceptanceRow, "acceptance_window_seconds"), deadlineAt: value(acceptanceRow, "deadline_at"), decidedAt: value(acceptanceRow, "decided_at"),
    } : null,
    dispute: disputeRow ? {
      reason: value(disputeRow, "reason"), openedAt: value(disputeRow, "opened_at"),
      proposalId: nullable(disputeRow, "proposal_id"), proposalVersion: disputeRow.proposal_version == null ? null : number(disputeRow, "proposal_version"),
      proposedResolution: nullable(disputeRow, "resolution") as "REFUND" | "SETTLE" | null,
      proposalStatus: nullable(disputeRow, "proposal_status") as "REQUESTED" | "APPROVED" | "REJECTED" | "APPLIED" | null,
      requestedAt: nullable(disputeRow, "requested_at"), decidedAt: nullable(disputeRow, "decided_at"),
    } : null,
    deliveryFailure: deliveryFailureRow ? {
      commandId: value(deliveryFailureRow, "id"), stage: value(deliveryFailureRow, "command_type") as "PROVISION" | "START",
      errorCode: value(deliveryFailureRow, "error_code"), evidenceDigest: value(deliveryFailureRow, "evidence_digest"),
      failedAt: value(deliveryFailureRow, "completed_at"),
    } : null,
    stopFailure: stopFailureRow ? {
      commandId: value(stopFailureRow, "command_id"), errorCode: value(stopFailureRow, "error_code"), evidenceDigest: value(stopFailureRow, "evidence_digest"),
      retrySequence: number(stopFailureRow, "retry_sequence"), status: value(stopFailureRow, "status") as NonNullable<HostingContractEvidence["stopFailure"]>["status"],
      recoveryCommandId: nullable(stopFailureRow, "recovery_command_id"), failedAt: value(stopFailureRow, "failed_at"),
    } : null,
    runtimeControl: {
      agentLastSeenAt: nullable(runtimeControlRow, "agent_last_seen_at"), stopCommandId: nullable(runtimeControlRow, "stop_command_id"),
      stopCommandStatus: nullable(runtimeControlRow, "stop_command_status") as HostingContractEvidence["runtimeControl"]["stopCommandStatus"],
      stopAttempt: runtimeControlRow.stop_attempt == null ? 0 : number(runtimeControlRow, "stop_attempt"),
      stopRequestedAt: nullable(runtimeControlRow, "stop_requested_at"), stopDeliveredAt: nullable(runtimeControlRow, "stop_delivered_at"),
    },
  };
}

function disputeCase(row: Row): HostingDisputeCase {
  return {
    contractId: value(row, "contract_id"), contractVersion: number(row, "contract_version"), contractStatus: value(row, "contract_status") as HostingDisputeCase["contractStatus"],
    buyerOrganizationId: value(row, "buyer_organization_id"), supplierOrganizationId: value(row, "supplier_organization_id"),
    deviceId: value(row, "device_id"), deviceDisplayName: value(row, "device_display_name"), offerId: value(row, "offer_id"), offerTitle: value(row, "offer_title"),
    measuredSeconds: number(row, "measured_seconds"), heldMicros: number(row, "held_micros"), reason: value(row, "reason"), openedAt: value(row, "opened_at"),
    proposalId: nullable(row, "proposal_id"), proposalVersion: row.proposal_version == null ? null : number(row, "proposal_version"),
    proposedResolution: nullable(row, "resolution") as HostingDisputeCase["proposedResolution"], proposalStatus: nullable(row, "proposal_status") as HostingDisputeCase["proposalStatus"],
    requestReason: nullable(row, "request_reason"), evidenceDigest: nullable(row, "evidence_digest"), requestedBy: nullable(row, "requested_by"), requestedAt: nullable(row, "requested_at"),
    decidedBy: nullable(row, "decided_by"), decisionReason: nullable(row, "decision_reason"), decidedAt: nullable(row, "decided_at"),
  };
}

function disputeCaseByProposal(db: HostingV2DatabaseAdapter, proposalId: string) {
  return db.first<Row>(`SELECT
      c.id contract_id,c.version contract_version,c.status contract_status,c.buyer_organization_id,c.supplier_organization_id,
      c.device_id,c.offer_id,c.measured_seconds,c.held_micros,d.display_name device_display_name,o.title offer_title,
      x.reason,x.opened_at,p.id proposal_id,p.proposal_version,p.resolution,p.status proposal_status,p.request_reason,p.evidence_digest,
      p.requested_by,p.requested_at,p.decided_by,p.decision_reason,p.decided_at
    FROM hosting_v2_dispute_resolution_proposals p
    JOIN hosting_v2_contracts c ON c.id=p.contract_id
    JOIN hosting_v2_disputes x ON x.contract_id=c.id
    JOIN hosting_v2_devices d ON d.id=c.device_id
    JOIN hosting_v2_offers o ON o.id=c.offer_id
    WHERE p.id=?`, [proposalId]);
}

function command(row: Row): HostingAgentCommand {
  return { id: value(row, "id"), deviceId: value(row, "device_id"), contractId: nullable(row, "contract_id"), type: value(row, "command_type") as HostingAgentCommand["type"], payload: json(row, "payload_json"), status: value(row, "status") as HostingAgentCommand["status"], attempt: number(row, "attempt"), evidenceDigest: nullable(row, "evidence_digest"), errorCode: nullable(row, "error_code"), createdAt: value(row, "created_at"), deliveredAt: nullable(row, "delivered_at"), completedAt: nullable(row, "completed_at") };
}

function cleanupIncident(row: Row): HostingCleanupIncident {
  return {
    contractId: value(row, "contract_id"), contractVersion: number(row, "contract_version"), contractStatus: "CLEANING",
    supplierOrganizationId: value(row, "supplier_organization_id"), deviceId: value(row, "device_id"), deviceDisplayName: value(row, "device_display_name"),
    deviceStatus: "DRAINING", deviceVersion: number(row, "device_version"), deviceLastSeenAt: nullable(row, "device_last_seen_at"),
    offerId: value(row, "offer_id"), offerStatus: value(row, "offer_status") as HostingOffer["status"],
    cleanupCommandId: value(row, "cleanup_command_id"), cleanupCommandStatus: value(row, "cleanup_command_status") as HostingCleanupIncident["cleanupCommandStatus"],
    cleanupAttempt: number(row, "cleanup_attempt"), evidenceDigest: nullable(row, "evidence_digest"), errorCode: nullable(row, "error_code"),
    failedAt: nullable(row, "failed_at"), updatedAt: value(row, "updated_at"),
  };
}

function stopIncident(row: Row): HostingStopIncident {
  return {
    contractId: value(row, "contract_id"), contractVersion: number(row, "contract_version"), supplierOrganizationId: value(row, "supplier_organization_id"),
    deviceId: value(row, "device_id"), deviceDisplayName: value(row, "device_display_name"), deviceVersion: number(row, "device_version"), deviceLastSeenAt: nullable(row, "device_last_seen_at"),
    offerId: value(row, "offer_id"), offerStatus: value(row, "offer_status") as HostingOffer["status"], failedCommandId: value(row, "failed_command_id"),
    retrySequence: number(row, "retry_sequence"), failureStatus: value(row, "failure_status") as HostingStopIncident["failureStatus"], errorCode: value(row, "error_code"),
    evidenceDigest: value(row, "evidence_digest"), recoveryCommandId: nullable(row, "recovery_command_id"), failedAt: value(row, "failed_at"),
  };
}

function goldenCheck(key: string, label: string, passed: boolean, detail: string) {
  return { key, label, status: passed ? "PASS" as const : "FAIL" as const, detail };
}

function rowNumberEquals(row: Row | null | undefined, key: string, expected: number | null) {
  return Boolean(row) && expected != null && number(row!, key) === expected;
}

function rowValueEquals(row: Row | null | undefined, key: string, expected: unknown) {
  return Boolean(row) && row![key] === expected;
}

async function hasValidAgentTransport(row: Row | undefined, devicePublicKey: string) {
  if (!row || value(row, "status") !== "SUCCEEDED" || !nullable(row, "signed_payload_json") || !nullable(row, "signature")) return false;
  try {
    const signedPayload = json<Record<string, unknown>>(row, "signed_payload_json");
    if (signedPayload.operation !== "COMPLETE_COMMAND" || signedPayload.deviceId !== row.device_id || signedPayload.commandId !== row.id
      || signedPayload.outcome !== "SUCCEEDED" || signedPayload.evidenceDigest !== row.evidence_digest
      || await hostingAgentDigest(signedPayload.details ?? {}) !== row.evidence_digest
      || await hostingAgentDigest(signedPayload) !== row.signed_payload_digest || await hostingAgentDigest(row.signature) !== row.signature_digest) return false;
    await verifyHostingAgentSignature(devicePublicKey, signedPayload, value(row, "signature"));
    return true;
  } catch { return false; }
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

async function supplierFeePreviewForSchedule(db: HostingV2DatabaseAdapter, organizationId: string, feeScheduleId: string | null, now: string): Promise<HostingSupplierFeePreview> {
  if (!Number.isFinite(Date.parse(now))) throw new ExchangeDomainError("HOSTING_FEE_QUALIFICATION_TIME_INVALID", 400, "成交费率核算时间无效。");
  const asOf = new Date(Date.parse(now)).toISOString();
  const volumeRow = await db.first<{ qualifying_volume_micros: number | null }>(`SELECT COALESCE(SUM(
      CASE WHEN event_type='SETTLEMENT' THEN amount_micros ELSE -amount_micros END
    ),0) qualifying_volume_micros
    FROM hosting_v2_supplier_fee_volume_events
    WHERE supplier_organization_id=? AND occurred_at<=?`, [organizationId, asOf]);
  const legacyVolumeRow = await db.first<{ qualifying_volume_micros: number | null }>(`SELECT COALESCE(SUM(settled.amount_micros),0) qualifying_volume_micros
    FROM card_hour_hold_events settled
    JOIN card_hour_order_holds h ON h.id=settled.hold_id AND h.source_system='HOSTING_V2'
    JOIN hosting_v2_contracts c ON c.id=h.order_id
    WHERE c.supplier_organization_id=? AND settled.event_type='SETTLED' AND settled.occurred_at<=?
      AND NOT EXISTS(SELECT 1 FROM hosting_v2_supplier_fee_volume_events recorded WHERE recorded.source_event_id=settled.id)
      AND NOT EXISTS(
        SELECT 1 FROM hosting_v2_dispute_resolution_proposals proposal
        JOIN card_hour_hold_events refunded ON refunded.hold_id=h.id AND refunded.event_type='RELEASED'
        WHERE proposal.contract_id=c.id AND proposal.resolution='REFUND' AND proposal.status='APPLIED'
          AND refunded.occurred_at<=?
      )`, [organizationId, asOf, asOf]).catch(() => null);
  const qualifyingVolumeMicros = Number(volumeRow?.qualifying_volume_micros ?? 0) + Number(legacyVolumeRow?.qualifying_volume_micros ?? 0);
  if (!Number.isSafeInteger(qualifyingVolumeMicros) || qualifyingVolumeMicros < 0) {
    throw new ExchangeDomainError("HOSTING_FEE_QUALIFYING_VOLUME_INVALID", 503, "供应方历史结算量超出安全计算范围，费率预览保持关闭。");
  }
  if (!feeScheduleId) {
    return {
      activeFeeScheduleId: null, model: HOSTING_FEE_QUALIFICATION_MODEL, tierCode: null, asOf,
      qualifyingVolumeMicros, platformFeeBps: null, referralRewardBps: null, tiers: [],
      nextTierCode: null, nextTierMinimumMicros: null, remainingToNextTierMicros: null,
    };
  }
  const tierRows = await db.all<Row>(`SELECT tier_code,minimum_qualifying_micros,platform_fee_bps,referral_reward_bps
    FROM hosting_v2_lifetime_fee_tiers WHERE fee_schedule_id=? ORDER BY minimum_qualifying_micros`, [feeScheduleId]);
  if (!tierRows.length) throw new ExchangeDomainError("HOSTING_FEE_TIERS_UNAVAILABLE", 503, "成交费率阶梯尚未配置，费率预览保持关闭。");
  const tiers = tierRows.map((tier) => ({
    code: value(tier, "tier_code"),
    minimumQualifyingMicros: number(tier, "minimum_qualifying_micros"),
    platformFeeBps: number(tier, "platform_fee_bps"),
    referralRewardBps: number(tier, "referral_reward_bps"),
  }));
  let selectedTier: HostingFeeTier;
  try {
    selectedTier = hostingSelectFeeTier(tiers, qualifyingVolumeMicros);
  } catch {
    throw new ExchangeDomainError("HOSTING_FEE_TIERS_UNAVAILABLE", 503, "成交费率阶梯无效，费率预览保持关闭。");
  }
  const selectedIndex = tiers.findIndex((tier) => tier.code === selectedTier.code);
  const nextTier = tiers[selectedIndex + 1] ?? null;
  return {
    activeFeeScheduleId: feeScheduleId,
    model: HOSTING_FEE_QUALIFICATION_MODEL,
    tierCode: selectedTier.code,
    asOf,
    qualifyingVolumeMicros,
    platformFeeBps: selectedTier.platformFeeBps,
    referralRewardBps: selectedTier.referralRewardBps,
    tiers,
    nextTierCode: nextTier?.code ?? null,
    nextTierMinimumMicros: nextTier?.minimumQualifyingMicros ?? null,
    remainingToNextTierMicros: nextTier ? nextTier.minimumQualifyingMicros - qualifyingVolumeMicros : null,
  };
}

async function supplierMonthlySettlementReadModel(db: HostingV2DatabaseAdapter, organizationId: string, now: string): Promise<HostingSupplierMonthlySettlement> {
  const period = hostingCurrentCalendarMonth(now);
  const rows = await db.all<Row>(`SELECT c.id,c.settled_micros,c.supplier_income_micros,c.commission_micros
    FROM hosting_v2_contracts c
    WHERE c.supplier_organization_id=? AND c.accepted_at>=? AND c.accepted_at<?
      AND ((c.status='SETTLED' AND c.settled_micros IS NOT NULL) OR c.status IN ('CLEANING','CLEANED'))
      AND NOT EXISTS(SELECT 1 FROM hosting_v2_dispute_resolution_proposals p
        WHERE p.contract_id=c.id AND p.resolution='REFUND' AND p.status='APPLIED')
    ORDER BY c.accepted_at,c.id`, [organizationId, period.startAt, period.endAt]);
  let grossMicros = 0n;
  let platformFeeMicros = 0n;
  let supplierIncomeMicros = 0n;
  let inFeeReferralCommissionMicros = 0n;
  let platformNetMicros = 0n;
  try {
    for (const row of rows) {
      if (row.settled_micros == null || row.supplier_income_micros == null || row.commission_micros == null) throw new Error("HOSTING_ACTUAL_FEE_AMOUNTS_INVALID");
      const actual = hostingActualFeeBreakdown(number(row, "settled_micros"), number(row, "supplier_income_micros"), number(row, "commission_micros"));
      grossMicros += BigInt(actual.grossMicros);
      platformFeeMicros += BigInt(actual.platformFeeMicros);
      supplierIncomeMicros += BigInt(actual.supplierIncomeMicros);
      inFeeReferralCommissionMicros += BigInt(actual.inFeeReferralCommissionMicros);
      platformNetMicros += BigInt(actual.platformNetMicros);
    }
    const maximum = BigInt(Number.MAX_SAFE_INTEGER);
    if ([grossMicros, platformFeeMicros, supplierIncomeMicros, inFeeReferralCommissionMicros, platformNetMicros].some((amount) => amount > maximum)) throw new Error("HOSTING_ACTUAL_FEE_AMOUNTS_INVALID");
    const aggregate = hostingActualFeeBreakdown(Number(grossMicros), Number(supplierIncomeMicros), Number(inFeeReferralCommissionMicros));
    if (aggregate.platformFeeMicros !== Number(platformFeeMicros) || aggregate.platformNetMicros !== Number(platformNetMicros)) throw new Error("HOSTING_ACTUAL_FEE_AMOUNTS_INVALID");
    return { period, ...aggregate };
  } catch {
    throw new ExchangeDomainError("HOSTING_SETTLEMENT_FEE_AMOUNTS_INVALID", 503, "供应订单实际结算拆分不一致，收益汇总保持关闭。");
  }
}

export async function createHostingV2Store(db: HostingV2DatabaseAdapter): Promise<HostingV2Store> {
  await db.ensureSchema(hostingV2SchemaStatements, HOSTING_V2_SCHEMA_VERSION, HOSTING_V2_SCHEMA_COMPATIBILITY_VERSION);
  const store = {} as HostingV2Store;
  Object.assign(store, createReadinessMethods(db), createProfileMethods(db), createDeviceMethods(db), createMarketMethods(db));
  return store;
}

function createReadinessMethods(db: HostingV2DatabaseAdapter): Partial<HostingV2Store> {
  return {
    async readiness(now) {
      const staleCutoff = new Date(Date.parse(now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000).toISOString();
      const [migration, feeRow, suppliers, activeAgents, drainingDevices, failedCleanups, cleaningContracts] = await Promise.all([
        db.first<{ version: number | null }>("SELECT MAX(version) AS version FROM hosting_v2_schema_migrations"),
        db.first<Row>("SELECT id FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [now]),
        db.first<{ count: number }>("SELECT COUNT(*) AS count FROM hosting_v2_supplier_profiles WHERE status='APPROVED' AND agreement_version IS NOT NULL AND evidence_digest IS NOT NULL"),
        db.all<Row>("SELECT agent_version,inventory_json FROM hosting_v2_devices WHERE status IN ('VERIFIED','BUSY') AND verification_status='PASSED' AND verified_until>? AND last_seen_at>=?", [now, staleCutoff]),
        db.first<{ count: number }>("SELECT COUNT(*) AS count FROM hosting_v2_devices WHERE status='DRAINING'"),
        db.first<{ count: number }>(`SELECT COUNT(*) AS count FROM hosting_v2_contracts c
          WHERE c.status='CLEANING'
            AND EXISTS(SELECT 1 FROM hosting_v2_agent_commands f WHERE f.contract_id=c.id AND f.command_type='CLEANUP' AND f.status='FAILED')
            AND NOT EXISTS(SELECT 1 FROM hosting_v2_agent_commands a WHERE a.contract_id=c.id AND a.command_type='CLEANUP' AND a.status IN ('PENDING','DELIVERED','SUCCEEDED'))`),
        db.first<{ count: number }>("SELECT COUNT(*) AS count FROM hosting_v2_contracts WHERE status='CLEANING'"),
      ]);
      const schemaVersion = Number(migration?.version ?? 0);
      if (schemaVersion < HOSTING_V2_SCHEMA_VERSION || schemaVersion > HOSTING_V2_SCHEMA_COMPATIBILITY_VERSION) throw new Error("HOSTING_V2_SCHEMA_MISMATCH");
      if (schemaVersion === 14) {
        // Merely inserting a version marker is not a valid future schema. This
        // projection deliberately references every bridge-critical field so a
        // malformed or non-additive migration remains fail-closed.
        await db.first("SELECT device_id,organization_id,mode,status,requested_at,finalized_at FROM hosting_v2_device_retirements LIMIT 1");
      }
      await db.first("SELECT tier_code FROM hosting_v2_lifetime_fee_tiers LIMIT 1");
      const invalidFeeVolume = await db.first<Row>(`SELECT supplier_organization_id
        FROM hosting_v2_supplier_fee_volume_events
        GROUP BY supplier_organization_id
        HAVING SUM(CASE WHEN event_type='SETTLEMENT' THEN amount_micros ELSE -amount_micros END)<0
        LIMIT 1`);
      if (invalidFeeVolume) throw new Error("HOSTING_FEE_VOLUME_AUDIT_INVALID");
      return {
        schemaVersion,
        integrity: "ok" as const,
        activeFeeScheduleId: feeRow ? value(feeRow, "id") : null,
        approvedSupplierCount: Number(suppliers?.count ?? 0),
        activeAgentCount: activeAgents.filter((row) => gpuTradingEligibility(rowInventory(row)).passed && agentVersionAtLeast(value(row, "agent_version"), HOSTING_V2_MIN_AGENT_VERSION)).length,
        drainingDeviceCount: Number(drainingDevices?.count ?? 0),
        failedCleanupCount: Number(failedCleanups?.count ?? 0),
        cleaningContractCount: Number(cleaningContracts?.count ?? 0),
      };
    },
    async listCleanupIncidents() {
      const rows = await db.all<Row>(`SELECT
          c.id AS contract_id,c.version AS contract_version,c.supplier_organization_id,c.offer_id,c.updated_at,
          d.id AS device_id,d.display_name AS device_display_name,d.version AS device_version,d.last_seen_at AS device_last_seen_at,
          o.status AS offer_status,
          cmd.id AS cleanup_command_id,cmd.status AS cleanup_command_status,cmd.attempt AS cleanup_attempt,
          cmd.evidence_digest,cmd.error_code,cmd.completed_at AS failed_at
        FROM hosting_v2_contracts c
        JOIN hosting_v2_devices d ON d.id=c.device_id AND d.status='DRAINING'
        JOIN hosting_v2_offers o ON o.id=c.offer_id
        JOIN hosting_v2_agent_commands cmd ON cmd.id=(
          SELECT latest.id FROM hosting_v2_agent_commands latest
          WHERE latest.contract_id=c.id AND latest.command_type='CLEANUP'
          ORDER BY CASE WHEN latest.status IN ('PENDING','DELIVERED') THEN 1 ELSE 0 END DESC,
            COALESCE(latest.completed_at,latest.delivered_at,latest.created_at) DESC,latest.created_at DESC LIMIT 1
        )
        WHERE c.status='CLEANING' AND cmd.status IN ('PENDING','DELIVERED','FAILED')
        ORDER BY c.updated_at DESC,c.id DESC LIMIT 200`);
      return rows.map(cleanupIncident);
    },
    async listStopIncidents() {
      const rows = await db.all<Row>(`SELECT
          c.id contract_id,c.version contract_version,c.supplier_organization_id,c.offer_id,
          d.id device_id,d.display_name device_display_name,d.version device_version,d.last_seen_at device_last_seen_at,
          o.status offer_status,f.command_id failed_command_id,f.retry_sequence,f.status failure_status,f.error_code,f.evidence_digest,f.recovery_command_id,f.failed_at
        FROM hosting_v2_contracts c
        JOIN hosting_v2_devices d ON d.id=c.device_id AND d.status='DRAINING'
        JOIN hosting_v2_offers o ON o.id=c.offer_id AND o.status='SUSPENDED'
        JOIN hosting_v2_stop_failures f ON f.command_id=(SELECT latest.command_id FROM hosting_v2_stop_failures latest WHERE latest.contract_id=c.id ORDER BY latest.retry_sequence DESC LIMIT 1)
        WHERE c.status='FAILED' AND f.status IN ('RECORDED','RETRYING','RETRY_FAILED','EXHAUSTED')
        ORDER BY f.failed_at DESC,c.id DESC LIMIT 200`);
      return rows.map(stopIncident);
    },
    async listDisputeCases() {
      const rows = await db.all<Row>(`SELECT
          c.id contract_id,c.version contract_version,c.status contract_status,c.buyer_organization_id,c.supplier_organization_id,
          c.device_id,c.offer_id,c.measured_seconds,c.held_micros,d.display_name device_display_name,o.title offer_title,
          x.reason,x.opened_at,p.id proposal_id,p.proposal_version,p.resolution,p.status proposal_status,p.request_reason,p.evidence_digest,
          p.requested_by,p.requested_at,p.decided_by,p.decision_reason,p.decided_at
        FROM hosting_v2_contracts c
        JOIN hosting_v2_disputes x ON x.contract_id=c.id
        JOIN hosting_v2_devices d ON d.id=c.device_id
        JOIN hosting_v2_offers o ON o.id=c.offer_id
        LEFT JOIN hosting_v2_dispute_resolution_proposals p ON p.id=(
          SELECT p2.id FROM hosting_v2_dispute_resolution_proposals p2 WHERE p2.contract_id=c.id ORDER BY p2.proposal_version DESC LIMIT 1)
        WHERE c.status IN ('DISPUTED','SETTLED','CLEANING','REFUNDED','CLEANED')
        ORDER BY CASE WHEN p.status='REQUESTED' THEN 0 WHEN c.status='DISPUTED' THEN 1 ELSE 2 END,x.opened_at DESC LIMIT 200`);
      return rows.map(disputeCase);
    },
    async auditGoldenLoop(contractId, now) {
      const main = await db.first<Row>(`SELECT c.*,
          d.status device_status,d.verification_status,d.verification_evidence_digest,d.verified_until,d.last_seen_at,d.agent_version,d.device_public_key,d.inventory_json,
          o.status offer_status,o.approved_image offer_approved_image,o.gpu_model offer_gpu_model,o.card_hour_micros_per_gpu_hour offer_rate,o.terms_version offer_terms_version,
          p.status supplier_status,p.agreement_version supplier_agreement_version,p.evidence_digest supplier_evidence_digest,
          f.platform_fee_bps fee_platform_bps,f.referral_reward_bps fee_referral_bps,
          ft.tier_code fee_tier_code,ft.minimum_qualifying_micros fee_tier_minimum_micros,
          ft.platform_fee_bps fee_tier_platform_bps,ft.referral_reward_bps fee_tier_referral_bps,
          lft.tier_code lifetime_fee_tier_code,lft.minimum_qualifying_micros lifetime_fee_tier_minimum_micros,
          lft.platform_fee_bps lifetime_fee_tier_platform_bps,lft.referral_reward_bps lifetime_fee_tier_referral_bps
        FROM hosting_v2_contracts c
        JOIN hosting_v2_devices d ON d.id=c.device_id
        JOIN hosting_v2_offers o ON o.id=c.offer_id
        LEFT JOIN hosting_v2_supplier_profiles p ON p.organization_id=c.supplier_organization_id
        LEFT JOIN hosting_v2_fee_schedules f ON f.id=c.fee_schedule_id
        LEFT JOIN hosting_v2_fee_tiers ft ON ft.fee_schedule_id=c.fee_schedule_id
          AND ft.tier_code=json_extract(c.snapshot_json,'$.feeQualification.tierCode')
        LEFT JOIN hosting_v2_lifetime_fee_tiers lft ON lft.fee_schedule_id=c.fee_schedule_id
          AND lft.tier_code=json_extract(c.snapshot_json,'$.feeQualification.tierCode')
        WHERE c.id=?`, [contractId]);
      if (!main) return null;
      const [instance, metering, cleanup, acceptance, verification, commandRows, hold, holdEvents, ledgerBatches, incomeRows, attribution, dispute] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_instances WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_metering_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_cleanup_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_acceptance_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>(`SELECT cmd.*,proof.agent_evidence_digest,proof.control_plane_reachability_digest,proof.public_host,proof.public_port,
            att.signed_payload_json,att.signature,att.signed_payload_digest,att.signature_digest
          FROM hosting_v2_verification_proofs proof JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
          LEFT JOIN hosting_v2_agent_transport_attestations att ON att.command_id=cmd.id
          WHERE proof.device_id=? AND proof.agent_evidence_digest=? ORDER BY proof.recorded_at DESC LIMIT 1`, [value(main, "device_id"), nullable(main, "verification_evidence_digest")]),
        db.all<Row>(`SELECT cmd.*,att.signed_payload_json,att.signature,att.signed_payload_digest,att.signature_digest
          FROM hosting_v2_agent_commands cmd LEFT JOIN hosting_v2_agent_transport_attestations att ON att.command_id=cmd.id
          WHERE cmd.contract_id=? AND cmd.command_type IN ('PROVISION','START','STOP','CLEANUP') ORDER BY cmd.created_at`, [contractId]),
        db.first<Row>("SELECT * FROM card_hour_order_holds WHERE source_system='HOSTING_V2' AND order_id=?", [contractId]).catch(() => null),
        db.all<Row>(`SELECT e.* FROM card_hour_hold_events e JOIN card_hour_order_holds h ON h.id=e.hold_id
          WHERE h.source_system='HOSTING_V2' AND h.order_id=? ORDER BY e.occurred_at`, [contractId]).catch(() => []),
        db.all<Row>("SELECT * FROM card_hour_ledger_batches WHERE business_key IN (?,?,?)", [`order:HOSTING_V2:${contractId}`, `rental:HOSTING_V2:${contractId}`, `commission:HOSTING_V2:${contractId}`]).catch(() => []),
        db.all<Row>("SELECT * FROM card_hour_income_accruals WHERE source_system='HOSTING_V2' AND source_id=?", [contractId]).catch(() => []),
        db.first<Row>("SELECT referrer_organization_id FROM card_hour_referral_attributions WHERE invitee_organization_id=?", [value(main, "buyer_organization_id")]).catch(() => null),
        db.first<Row>("SELECT contract_id FROM hosting_v2_disputes WHERE contract_id=?", [contractId]),
      ]);
      const snapshot = json<HostingContract["snapshot"]>(main, "snapshot_json");
      const inventory = json<HostingDeviceInventory>(main, "inventory_json");
      const measuredSeconds = main.measured_seconds == null ? null : number(main, "measured_seconds");
      const settledMicros = main.settled_micros == null ? null : number(main, "settled_micros");
      const supplierIncomeMicros = main.supplier_income_micros == null ? null : number(main, "supplier_income_micros");
      const commissionMicros = main.commission_micros == null ? null : number(main, "commission_micros");
      const expectedSettled = measuredSeconds == null ? null : hostingCardHourMicrosForSeconds(snapshot.cardHourMicrosPerGpuHour, measuredSeconds);
      const expectedFeeBreakdown = expectedSettled == null ? null : hostingFeeBreakdown(expectedSettled, snapshot.platformFeeBps, snapshot.referralRewardBps, Boolean(attribution));
      const expectedSupplierIncome = expectedFeeBreakdown?.supplierIncomeMicros ?? null;
      const expectedCommission = expectedFeeBreakdown?.commissionMicros ?? 0;
      const commandsByType = new Map<string, Row>();
      for (const row of commandRows) if (value(row, "status") === "SUCCEEDED") commandsByType.set(value(row, "command_type"), row);
      const commandTransport = new Map<string, boolean>();
      for (const [type, row] of commandsByType) commandTransport.set(type, await hasValidAgentTransport(row, value(main, "device_public_key")));
      const verificationTransport = await hasValidAgentTransport(verification ?? undefined, value(main, "device_public_key"));
      const holdEvent = (type: string) => holdEvents.find((row) => value(row, "event_type") === type);
      const batch = (key: string) => ledgerBatches.find((row) => value(row, "business_key") === key);
      const income = (type: string) => incomeRows.find((row) => value(row, "income_type") === type && value(row, "status") === "VESTED");
      const agentFresh = Boolean(main.last_seen_at && Date.parse(value(main, "last_seen_at")) >= Date.parse(now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000);
      const verificationFresh = Boolean(main.verified_until && Date.parse(value(main, "verified_until")) > Date.parse(now));
      const commandsAuthentic = ["PROVISION", "START", "STOP", "CLEANUP"].every((type) => commandTransport.get(type) === true);
      const qualification = snapshot.feeQualification;
      const lifetimeQualification = qualification?.model === HOSTING_FEE_QUALIFICATION_MODEL ? qualification : null;
      const legacyQualification = qualification?.model === HOSTING_FEE_LEGACY_QUALIFICATION_MODEL ? qualification : null;
      const lifetimeTierPricingFrozen = Boolean(lifetimeQualification
        && lifetimeQualification.tierCode === nullable(main, "lifetime_fee_tier_code")
        && lifetimeQualification.platformFeeBps === number(main, "lifetime_fee_tier_platform_bps")
        && lifetimeQualification.referralRewardBps === number(main, "lifetime_fee_tier_referral_bps")
        && lifetimeQualification.qualifyingVolumeMicros >= number(main, "lifetime_fee_tier_minimum_micros")
        && Number.isFinite(Date.parse(lifetimeQualification.asOf)));
      const legacyTierPricingFrozen = Boolean(legacyQualification
        && legacyQualification.tierCode === nullable(main, "fee_tier_code")
        && legacyQualification.platformFeeBps === number(main, "fee_tier_platform_bps")
        && legacyQualification.referralRewardBps === number(main, "fee_tier_referral_bps")
        && legacyQualification.period.timeZone === "Asia/Shanghai"
        && Date.parse(legacyQualification.period.startAt) < Date.parse(legacyQualification.period.endAt));
      const tierPricingFrozen = Boolean(qualification
        && (lifetimeTierPricingFrozen || legacyTierPricingFrozen)
        && qualification.platformFeeBps === snapshot.platformFeeBps
        && qualification.referralRewardBps === snapshot.referralRewardBps);
      const legacyPricingFrozen = !qualification && snapshot.platformFeeBps === number(main, "fee_platform_bps") && snapshot.referralRewardBps === number(main, "fee_referral_bps");
      const pricingFrozen = (tierPricingFrozen || legacyPricingFrozen)
        && snapshot.cardHourMicrosPerGpuHour === number(main, "offer_rate") && snapshot.approvedImage === value(main, "offer_approved_image")
        && snapshot.termsVersion === value(main, "offer_terms_version") && snapshot.gpuModel === value(main, "offer_gpu_model");
      const gpuAudit = physicalGpuAudit(inventory);
      const checks = [
        goldenCheck("supplier", "供应主体已签约并审核", value(main, "supplier_status") === "APPROVED" && Boolean(nullable(main, "supplier_agreement_version")) && Boolean(nullable(main, "supplier_evidence_digest")), `状态 ${nullable(main, "supplier_status") ?? "缺失"}`),
        goldenCheck("gpu", "单张首期 GPU 规格真实登记", gpuAudit.passed && inventory.gpuModel === snapshot.gpuModel, gpuAudit.detail),
        goldenCheck("verification", "验真与控制面回连有签名证明", value(main, "verification_status") === "PASSED" && Boolean(verification) && verificationTransport && verification?.public_host === inventory.publicHost && number(verification!, "public_port") === inventory.sshPortStart, verificationTransport ? "设备签名、验真摘要与公网回连一致" : "缺少由设备签名接口写入的验真证明"),
        goldenCheck("agent", "Host Agent 版本与心跳有效", agentVersionAtLeast(value(main, "agent_version"), HOSTING_V2_MIN_AGENT_VERSION) && agentFresh && verificationFresh, `${value(main, "agent_version")} · 最后心跳 ${nullable(main, "last_seen_at") ?? "缺失"}`),
        goldenCheck("pricing", "成交快照冻结费率、镜像与条款", pricingFrozen && HOSTING_V2_OCI_IMAGE_PATTERN.test(snapshot.approvedImage), pricingFrozen ? snapshot.approvedImage : "挂牌或费率已与合同快照不一致"),
        goldenCheck("delivery", "开通、启动、停机、清理均由真实 Agent 签名", commandsAuthentic, commandsAuthentic ? "4 类任务传输签名全部有效" : "存在缺失签名或直接写入的任务结果"),
        goldenCheck("instance", "实例身份与交付证据闭合", Boolean(instance) && value(instance!, "status") === "CLEANED" && value(instance!, "approved_image") === snapshot.approvedImage && rowValueEquals(instance, "provision_command_id", commandsByType.get("PROVISION")?.id) && rowValueEquals(instance, "start_evidence_digest", commandsByType.get("START")?.evidence_digest) && rowValueEquals(instance, "stop_evidence_digest", commandsByType.get("STOP")?.evidence_digest), instance ? `${value(instance, "container_digest")} · CLEANED` : "实例证明缺失"),
        goldenCheck("metering", "服务端与 Agent 计量一致且不少于三分钟", Boolean(metering) && Boolean(instance) && measuredSeconds != null && measuredSeconds >= 180 && measuredSeconds <= number(main, "reserved_seconds") && rowNumberEquals(metering, "server_measured_seconds", measuredSeconds) && rowValueEquals(metering, "command_id", commandsByType.get("STOP")?.id) && rowValueEquals(metering, "container_digest", instance?.container_digest), metering ? `${number(metering, "server_measured_seconds")} 秒` : "计量证明缺失"),
        goldenCheck("acceptance", "买家或超时验收证明已固化", Boolean(acceptance) && ["BUYER", "TIMEOUT"].includes(value(acceptance!, "decision_mode")), acceptance ? `${value(acceptance, "decision_mode")} · ${value(acceptance, "decided_at")}` : "验收证明缺失"),
        goldenCheck("settlement", "卡时锁定、实际扣减与释放一致", Boolean(hold) && value(hold!, "status") === "SETTLED" && rowNumberEquals(hold, "amount_micros", number(main, "held_micros")) && rowNumberEquals(hold, "settled_micros", settledMicros) && rowNumberEquals(holdEvent("HELD"), "amount_micros", number(main, "held_micros")) && rowNumberEquals(holdEvent("SETTLED"), "amount_micros", settledMicros) && settledMicros === expectedSettled && rowNumberEquals(batch(`order:HOSTING_V2:${contractId}`), "amount_micros", settledMicros), `锁定 ${number(main, "held_micros")} · 结算 ${settledMicros ?? "缺失"} 微卡时`),
        goldenCheck("earnings", "租金、佣金与版本化费率一致", supplierIncomeMicros === expectedSupplierIncome && commissionMicros === expectedCommission && rowNumberEquals(income("RENTAL"), "amount_micros", supplierIncomeMicros) && rowNumberEquals(batch(`rental:HOSTING_V2:${contractId}`), "amount_micros", supplierIncomeMicros) && (expectedCommission === 0 ? !income("COMMISSION") && !batch(`commission:HOSTING_V2:${contractId}`) : rowNumberEquals(income("COMMISSION"), "amount_micros", expectedCommission) && rowNumberEquals(batch(`commission:HOSTING_V2:${contractId}`), "amount_micros", expectedCommission)), `租金 ${supplierIncomeMicros ?? "缺失"} · 佣金 ${commissionMicros ?? "缺失"} 微卡时`),
        goldenCheck("cleanup", "容器、密钥和工作区清理证明完整", Boolean(cleanup) && Boolean(instance) && rowValueEquals(cleanup, "command_id", commandsByType.get("CLEANUP")?.id) && rowNumberEquals(cleanup, "container_removed", 1) && rowNumberEquals(cleanup, "authorized_key_removed", 1) && rowNumberEquals(cleanup, "workspace_removed", 1) && rowValueEquals(cleanup, "container_digest", instance?.container_digest), cleanup ? value(cleanup, "cleanup_digest") : "清理证明缺失"),
        goldenCheck("relist", "合同完成且设备自动恢复可售", value(main, "status") === "CLEANED" && value(main, "device_status") === "VERIFIED" && value(main, "offer_status") === "PUBLISHED" && !dispute, `${value(main, "status")} · 设备 ${value(main, "device_status")} · 挂牌 ${value(main, "offer_status")}`),
      ];
      const passedChecks = checks.filter((check) => check.status === "PASS").length;
      return {
        contractId,
        verdict: passedChecks === checks.length ? "PASS" : "FAIL",
        checkedAt: now,
        passedChecks,
        totalChecks: checks.length,
        facts: {
          gpuModel: snapshot.gpuModel,
          deviceId: value(main, "device_id"),
          deviceStatus: value(main, "device_status") as HostingGoldenLoopAudit["facts"]["deviceStatus"],
          offerStatus: value(main, "offer_status") as HostingGoldenLoopAudit["facts"]["offerStatus"],
          agentVersion: value(main, "agent_version"),
          measuredSeconds,
          heldMicros: number(main, "held_micros"),
          settledMicros,
          supplierIncomeMicros,
          commissionMicros,
          approvedImage: snapshot.approvedImage,
        },
        checks,
      } satisfies HostingGoldenLoopAudit;
    },
  };
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
          supplierApproved: profileRow?.status === "APPROVED" && Boolean(profileRow.agreement_version) && Boolean(profileRow.evidence_digest),
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

    async submitProfile(organizationId, expectedVersion, agreementVersion, context) {
      const replayed = await replay(db, context, "SUBMIT_PROFILE");
      if (!replayed) {
        if (!/^KAI_HOSTING_TERMS_\d{4}_\d{2}$/u.test(agreementVersion)) throw new ExchangeInputError("供应协议版本无效。", "agreementVersion");
        const current = await db.first<Row>("SELECT status,version FROM hosting_v2_supplier_profiles WHERE organization_id=?", [organizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "供应主体不存在。");
        if (value(current, "status") !== "DRAFT") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "供应主体当前不能提交审核。");
        if (number(current, "version") !== expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "供应主体资料已变化，请刷新。");
        await db.batch([
          { sql: "UPDATE hosting_v2_supplier_profiles SET status='SUBMITTED',agreement_version=?,version=version+1,updated_at=? WHERE organization_id=? AND version=? AND status='DRAFT'", values: [agreementVersion, context.now, organizationId, expectedVersion] },
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
        if (input.evidenceDigest != null && !/^[a-f0-9]{64}$/u.test(input.evidenceDigest)) throw new ExchangeInputError("审核证据仅接受 64 位 SHA-256 摘要。", "evidenceDigest");
        if (status === "APPROVED" && !input.evidenceDigest) throw new ExchangeInputError("批准供应主体前必须保存审核证据的 SHA-256 摘要。", "evidenceDigest");
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
      if (!profileRow || value(profileRow, "status") !== "APPROVED" || !nullable(profileRow, "agreement_version") || !nullable(profileRow, "evidence_digest")) throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体完成协议签署和有证据审核后才能登记设备。");
      const replayed = await replay(db, context, "ISSUE_AGENT_CHALLENGE");
      if (replayed) {
        const row = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=?`, [replayed.entityId]);
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
      const row = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=?`, [recordId]);
      if (!row) throw new Error("HOSTING_AGENT_CHALLENGE_CREATE_FAILED");
      return challenge(row);
    },

    async revokeAgentChallenge(organizationId, challengeId, context) {
      const replayed = await replay(db, context, "REVOKE_AGENT_CHALLENGE");
      if (replayed) {
        const row = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=? AND c.organization_id=?`, [replayed.entityId, organizationId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备登记挑战不存在。");
        return challenge(row);
      }
      const current = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=? AND c.organization_id=?`, [challengeId, organizationId]);
      if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备登记挑战不存在或不属于当前组织。");
      if (nullable(current, "revoked_at")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记挑战已经废弃。");
      if (nullable(current, "consumed_at")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记挑战已被 Agent 使用，不能再废弃。");

      const eventId = id("hve");
      const results = await db.batch([
        {
          sql: "UPDATE hosting_v2_agent_challenges SET consumed_at=? WHERE id=? AND organization_id=? AND consumed_at IS NULL",
          values: [context.now, challengeId, organizationId],
        },
        {
          sql: `INSERT INTO hosting_v2_events(id,organization_id,entity_type,entity_id,event_type,actor_id,payload_digest,metadata_json,occurred_at)
            SELECT ?,c.organization_id,'AGENT_CHALLENGE',c.id,'AGENT_CHALLENGE_REVOKED',?,?,?,?
            FROM hosting_v2_agent_challenges c
            WHERE c.id=? AND c.organization_id=? AND c.consumed_at=?
              AND NOT EXISTS(SELECT 1 FROM hosting_v2_agent_registrations r WHERE r.challenge_id=c.id)
              AND NOT EXISTS(SELECT 1 FROM hosting_v2_events e WHERE e.entity_type='AGENT_CHALLENGE' AND e.entity_id=c.id AND e.event_type='AGENT_CHALLENGE_REVOKED')`,
          values: [eventId, context.actorId, context.payloadHash, JSON.stringify({}), context.now, challengeId, organizationId, context.now],
        },
        {
          sql: `INSERT INTO hosting_v2_command_receipts(actor_id,idempotency_key,command_type,payload_hash,entity_type,entity_id,created_at)
            SELECT ?,?,'REVOKE_AGENT_CHALLENGE',?,'AGENT_CHALLENGE',entity_id,?
            FROM hosting_v2_events WHERE id=?`,
          values: [context.actorId, context.idempotencyKey, context.payloadHash, context.now, eventId],
        },
      ]);
      if (results[0]?.changes !== 1 || results[1]?.changes !== 1 || results[2]?.changes !== 1) {
        const latest = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=? AND c.organization_id=?`, [challengeId, organizationId]);
        if (latest && nullable(latest, "revoked_at")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记挑战已经废弃。");
        if (latest && nullable(latest, "consumed_at")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记挑战已被 Agent 使用，不能再废弃。");
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备登记挑战已经废弃。");
      }
      const row = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=? AND c.organization_id=?`, [challengeId, organizationId]);
      if (!row || !nullable(row, "revoked_at")) throw new Error("HOSTING_AGENT_CHALLENGE_REVOKE_FAILED");
      return challenge(row);
    },

    async getAgentChallenge(challengeId) {
      const row = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=?`, [challengeId]);
      return row ? challenge(row) : null;
    },

    async getAgentRegistration(organizationId, challengeId) {
      const challengeRow = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=? AND c.organization_id=?`, [challengeId, organizationId]);
      if (!challengeRow) return null;
      const deviceRow = await db.first<Row>(`SELECT d.* FROM hosting_v2_agent_registrations r
        JOIN hosting_v2_devices d ON d.id=r.device_id
        WHERE r.challenge_id=? AND r.organization_id=?`, [challengeId, organizationId]);
      return { challenge: challenge(challengeRow), device: deviceRow ? device(deviceRow) : null };
    },

    async registerDevice(challengeId, input, context) {
      const replayed = await replay(db, context, "REGISTER_DEVICE");
      if (replayed) {
        const row = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [replayed.entityId]);
        if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在。");
        return device(row);
      }
      if (!agentVersionAtLeast(input.agentVersion, HOSTING_V2_MIN_AGENT_VERSION)) {
        throw new ExchangeDomainError("HOSTING_AGENT_UPGRADE_REQUIRED", 409, `Host Agent 需要升级到 ${HOSTING_V2_MIN_AGENT_VERSION} 或更高版本。`);
      }
      const challengeRow = await db.first<Row>(`${agentChallengeProjection} WHERE c.id=?`, [challengeId]);
      if (!challengeRow || challengeRow.consumed_at != null || challengeRow.revoked_at != null || Date.parse(value(challengeRow, "expires_at")) < Date.parse(context.now)) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 410, "设备登记挑战已过期、已使用或已废弃。");
      }
      const profileRow = await db.first<Row>("SELECT status,agreement_version,evidence_digest FROM hosting_v2_supplier_profiles WHERE organization_id=?", [value(challengeRow, "organization_id")]);
      if (!profileRow || value(profileRow, "status") !== "APPROVED" || !nullable(profileRow, "agreement_version") || !nullable(profileRow, "evidence_digest")) throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体当前缺少有效协议或审核证据，不能登记设备。");
      const recordId = id("had");
      await db.batch([
        { sql: `INSERT INTO hosting_v2_devices(id,organization_id,account_id,display_name,device_key_id,device_public_key,agent_version,inventory_json,inventory_digest,status,verification_status,last_sequence,last_seen_at,version,created_at,updated_at)
          SELECT ?,organization_id,account_id,?,?,?,?,?,?,'ONLINE','NOT_RUN',0,NULL,1,?,? FROM hosting_v2_agent_challenges c
          WHERE c.id=? AND consumed_at IS NULL AND expires_at>=?`, values: [recordId, input.displayName, input.deviceKeyId, input.devicePublicKey, input.agentVersion, JSON.stringify(input.inventory), input.inventoryDigest, context.now, context.now, challengeId, context.now] },
        { sql: `INSERT INTO hosting_v2_agent_registrations(challenge_id,device_id,organization_id,registered_at)
          VALUES(?,?,(SELECT organization_id FROM hosting_v2_devices WHERE id=?),?)`, values: [challengeId, recordId, recordId, context.now] },
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
      const current = await db.first<Row>(`SELECT *,${DEVICE_RETIREMENT_EVENT_SQL} AS retirement_requested
        FROM hosting_v2_devices WHERE id=?`, [deviceId]);
      if (!current || value(current, "status") === "REVOKED") throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在或已撤销。");
      if (input.sequence <= number(current, "last_sequence")) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "心跳序列已经使用。");
      const inventoryChanged = input.inventoryDigest !== value(current, "inventory_digest");
      const retirementRequested = number(current, "retirement_requested") === 1;
      const protectedStatus = ["VERIFYING", "BUSY", "DRAINING"].includes(value(current, "status"));
      const nextStatus = retirementRequested ? "DRAINING" : input.capacityState === "OFFLINE" ? "OFFLINE" : inventoryChanged ? "ONLINE" : protectedStatus ? value(current, "status") : value(current, "verification_status") === "PASSED" ? "VERIFIED" : "ONLINE";
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_heartbeats(id,device_id,sequence,inventory_digest,capacity_state,payload_digest,observed_at,received_at) VALUES(?,?,?,?,?,?,?,?)", values: [id("hhb"), deviceId, input.sequence, input.inventoryDigest, input.capacityState, context.payloadHash, input.observedAt, context.now] },
        { sql: `UPDATE hosting_v2_devices SET
            status=CASE WHEN ${DEVICE_RETIREMENT_EVENT_SQL} THEN 'DRAINING' ELSE ? END,
            verification_status=CASE WHEN ? OR ${DEVICE_RETIREMENT_EVENT_SQL} THEN 'EXPIRED' ELSE verification_status END,
            verified_until=CASE WHEN ? OR ${DEVICE_RETIREMENT_EVENT_SQL} THEN NULL ELSE verified_until END,
            last_sequence=?,last_seen_at=?,version=version+1,updated_at=?
          WHERE id=? AND status!='REVOKED' AND last_sequence<?`, values: [nextStatus, inventoryChanged ? 1 : 0, inventoryChanged ? 1 : 0, input.sequence, input.observedAt, context.now, deviceId, input.sequence] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: `UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=?
          WHERE device_id=? AND status IN ('PUBLISHED','PAUSED') AND (? OR EXISTS(
            SELECT 1 FROM hosting_v2_events retirement
            WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=hosting_v2_offers.device_id
              AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED')
          ))`, values: [context.now, deviceId, inventoryChanged ? 1 : 0] },
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
      const current = await db.first<Row>(`SELECT *,${DEVICE_RETIREMENT_EVENT_SQL} AS retirement_requested
        FROM hosting_v2_devices WHERE id=? AND organization_id=?`, [deviceId, organizationId]);
      if (!current || !["ONLINE", "VERIFIED"].includes(value(current, "status")) || number(current, "retirement_requested") === 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备需在线且未进入退场后才能验真。");
      if (!nullable(current, "last_seen_at") || Date.parse(value(current, "last_seen_at")) < Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备尚未发送有效心跳，不能开始验真。");
      const commandId = id("hcmd");
      const approvedImages = [...hostingV2ApprovedImages()].sort();
      await db.batch([
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,NULL,'VERIFY',?,'PENDING',0,?)", values: [commandId, deviceId, JSON.stringify({ expectedInventoryDigest: value(current, "inventory_digest"), tests: [...VERIFY_TEST_NAMES], approvedImages, reachabilityChallenge: crypto.randomUUID().replaceAll("-", "") }), context.now] },
        { sql: `UPDATE hosting_v2_devices SET status='VERIFYING',verification_status='PENDING',version=version+1,updated_at=?
          WHERE id=? AND status IN ('ONLINE','VERIFIED') AND NOT ${DEVICE_RETIREMENT_EVENT_SQL}`, values: [context.now, deviceId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
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
      if (!hostingFeeRatesAreValid(input.platformFeeBps, input.referralRewardBps)) throw new ExchangeInputError("推荐奖励应为非负整数且不能超过平台服务费。", "referralRewardBps");
      if (Number.isNaN(Date.parse(input.effectiveFrom))) throw new ExchangeInputError("费率生效时间无效。", "effectiveFrom");
      const recordId = id("hfee");
      const tiers = hostingDefaultFeeTiers(input.platformFeeBps, input.referralRewardBps);
      const statements: HostingV2Sql[] = [];
      if (input.activate) statements.push({ sql: "UPDATE hosting_v2_fee_schedules SET status='RETIRED' WHERE status='ACTIVE'" });
      statements.push(
        { sql: "INSERT INTO hosting_v2_fee_schedules(id,platform_fee_bps,referral_reward_bps,status,effective_from,created_by,created_at) VALUES(?,?,?,?,?,?,?)", values: [recordId, input.platformFeeBps, input.referralRewardBps, input.activate ? "ACTIVE" : "DRAFT", new Date(input.effectiveFrom).toISOString(), context.actorId, context.now] },
        ...tiers.map((tier) => ({
          sql: "INSERT INTO hosting_v2_fee_tiers(fee_schedule_id,tier_code,minimum_qualifying_micros,platform_fee_bps,referral_reward_bps,created_at) VALUES(?,?,?,?,?,?)",
          values: [recordId, tier.code, tier.minimumQualifyingMicros, tier.platformFeeBps, tier.referralRewardBps, context.now],
        } satisfies HostingV2Sql)),
        ...tiers.map((tier) => ({
          sql: "INSERT INTO hosting_v2_lifetime_fee_tiers(fee_schedule_id,tier_code,minimum_qualifying_micros,platform_fee_bps,referral_reward_bps,created_at) VALUES(?,?,?,?,?,?)",
          values: [recordId, tier.code, tier.minimumQualifyingMicros, tier.platformFeeBps, tier.referralRewardBps, context.now],
        } satisfies HostingV2Sql)),
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

    async supplierFeePreview(organizationId, now) {
      const row = await db.first<Row>("SELECT id FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [now]);
      return supplierFeePreviewForSchedule(db, organizationId, row ? value(row, "id") : null, now);
    },

    async supplierMonthlySettlement(organizationId, now) {
      return supplierMonthlySettlementReadModel(db, organizationId, now);
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
        db.first<Row>(`SELECT d.*,(SELECT cmd.payload_json FROM hosting_v2_verification_proofs proof
          JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
          WHERE proof.device_id=d.id AND proof.agent_evidence_digest=d.verification_evidence_digest
          ORDER BY proof.recorded_at DESC LIMIT 1) AS verification_payload_json
          FROM hosting_v2_devices d WHERE d.id=? AND d.organization_id=?`, [input.deviceId, organizationId]),
        db.first<Row>("SELECT * FROM hosting_v2_fee_schedules WHERE status='ACTIVE' AND effective_from<=? ORDER BY effective_from DESC LIMIT 1", [context.now]),
      ]);
      if (!profileRow || value(profileRow, "status") !== "APPROVED" || !nullable(profileRow, "agreement_version") || !nullable(profileRow, "evidence_digest")) throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体未完成有证据审核。");
      if (!deviceRow || value(deviceRow, "status") !== "VERIFIED" || value(deviceRow, "verification_status") !== "PASSED" || !deviceRow.verified_until || Date.parse(value(deviceRow, "verified_until")) <= Date.parse(context.now) || !deviceRow.last_seen_at || Date.parse(value(deviceRow, "last_seen_at")) < Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000) {
        throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 409, "设备需保持在线且验真有效后才能挂牌。");
      }
      if (!agentVersionAtLeast(value(deviceRow, "agent_version"), HOSTING_V2_MIN_AGENT_VERSION)) {
        throw new ExchangeDomainError("HOSTING_AGENT_UPGRADE_REQUIRED", 409, `Host Agent 需要升级到 ${HOSTING_V2_MIN_AGENT_VERSION} 或更高版本。`);
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
      if (!verificationAllowsImage(deviceRow, input.approvedImage)) throw new ExchangeDomainError("EXCHANGE_VERIFICATION_REQUIRED", 409, "设备需重新验真并确认当前工作负载镜像后才能挂牌。");
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
        const current = await db.first<Row>(`SELECT o.*,d.status device_status,d.verification_status device_verification,d.verification_evidence_digest,d.verified_until,d.last_seen_at,d.agent_version device_agent_version,d.inventory_json,p.status supplier_status,p.agreement_version supplier_agreement_version,p.evidence_digest supplier_evidence_digest,
          (SELECT cmd.payload_json FROM hosting_v2_verification_proofs proof JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
           WHERE proof.device_id=d.id AND proof.agent_evidence_digest=d.verification_evidence_digest ORDER BY proof.recorded_at DESC LIMIT 1) AS verification_payload_json
          FROM hosting_v2_offers o JOIN hosting_v2_devices d ON d.id=o.device_id JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id WHERE o.id=? AND o.organization_id=?`, [offerId, organizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "挂牌不存在。");
        if (number(current, "version") !== input.expectedVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "挂牌版本已变化。");
        if (input.status === "PUBLISHED" && (value(current, "supplier_status") !== "APPROVED" || !nullable(current, "supplier_agreement_version") || !nullable(current, "supplier_evidence_digest"))) throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "供应主体缺少有效协议或审核证据，不能发布挂牌。");
        if (input.status === "PUBLISHED" && (value(current, "device_status") !== "VERIFIED" || value(current, "device_verification") !== "PASSED" || Date.parse(value(current, "verified_until")) <= Date.parse(context.now) || Date.parse(value(current, "last_seen_at")) < Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000)) throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 409, "设备不在线或验真已经过期。");
        if (input.status === "PUBLISHED" && !agentVersionAtLeast(value(current, "device_agent_version"), HOSTING_V2_MIN_AGENT_VERSION)) throw new ExchangeDomainError("HOSTING_AGENT_UPGRADE_REQUIRED", 409, `Host Agent 需要升级到 ${HOSTING_V2_MIN_AGENT_VERSION} 或更高版本。`);
        if (input.status === "PUBLISHED") {
          assertGpuTradingEligible(current);
          assertHostingV2ApprovedImage(value(current, "approved_image"));
          if (!verificationAllowsImage(current, value(current, "approved_image"))) throw new ExchangeDomainError("EXCHANGE_VERIFICATION_EXPIRED", 409, "设备尚未证明当前工作负载镜像可交付，请重新验真。");
        }
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
      const approvedImages = hostingV2ApprovedImages();
      return (await db.all<Row>(`SELECT o.*,d.agent_version device_agent_version,d.inventory_json,
          (SELECT cmd.payload_json FROM hosting_v2_verification_proofs proof JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
           WHERE proof.device_id=d.id AND proof.agent_evidence_digest=d.verification_evidence_digest ORDER BY proof.recorded_at DESC LIMIT 1) AS verification_payload_json
        FROM hosting_v2_offers o JOIN hosting_v2_devices d ON d.id=o.device_id JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id
        WHERE o.status='PUBLISHED' AND p.status='APPROVED' AND p.agreement_version IS NOT NULL AND p.evidence_digest IS NOT NULL AND o.available_from<=? AND o.available_until>? AND d.status='VERIFIED' AND d.verification_status='PASSED' AND d.verified_until>? AND d.last_seen_at>=?
        ORDER BY o.card_hour_micros_per_gpu_hour,o.created_at`, [now, now, now, cutoff]))
        .filter((row) => gpuTradingEligibility(rowInventory(row)).passed
          && agentVersionAtLeast(value(row, "device_agent_version"), HOSTING_V2_MIN_AGENT_VERSION)
          && approvedImages.has(value(row, "approved_image")) && verificationAllowsImage(row, value(row, "approved_image")))
        .map(offer);
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
      const staleCutoff = new Date(Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000).toISOString();
      const row = await db.first<Row>(`SELECT o.*,f.platform_fee_bps,f.referral_reward_bps,d.agent_version device_agent_version,d.inventory_json,
          (SELECT cmd.payload_json FROM hosting_v2_verification_proofs proof JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
           WHERE proof.device_id=d.id AND proof.agent_evidence_digest=d.verification_evidence_digest ORDER BY proof.recorded_at DESC LIMIT 1) AS verification_payload_json
        FROM hosting_v2_offers o
        JOIN hosting_v2_fee_schedules f ON f.id=o.fee_schedule_id
        JOIN hosting_v2_devices d ON d.id=o.device_id
        JOIN hosting_v2_supplier_profiles p ON p.organization_id=o.organization_id
        WHERE o.id=? AND o.status='PUBLISHED' AND p.status='APPROVED' AND p.agreement_version IS NOT NULL AND p.evidence_digest IS NOT NULL AND o.available_from<=? AND o.available_until>? AND d.status='VERIFIED' AND d.verification_status='PASSED' AND d.verified_until>? AND d.last_seen_at>=?`, [offerId, context.now, context.now, context.now, staleCutoff]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源已不可租用，请刷新市场。");
      if (!gpuTradingEligibility(rowInventory(row)).passed) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源未通过真实物理 GPU 审计，请刷新市场。");
      if (!agentVersionAtLeast(value(row, "device_agent_version"), HOSTING_V2_MIN_AGENT_VERSION)) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源交付组件正在升级，请刷新市场。");
      if (!hostingV2ApprovedImages().has(value(row, "approved_image")) || !verificationAllowsImage(row, value(row, "approved_image"))) throw new ExchangeDomainError("EXCHANGE_CAPACITY_CONFLICT", 409, "资源工作负载镜像尚未通过当前验真，请刷新市场。");
      if (value(row, "organization_id") === account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "供应方不能购买自己的资源。");
      if (!Number.isInteger(reservedSeconds) || reservedSeconds < number(row, "min_rental_seconds") || reservedSeconds > number(row, "max_rental_seconds")) throw new ExchangeInputError("租用时长不在挂牌范围内。", "reservedSeconds");
      const feePreview = await supplierFeePreviewForSchedule(db, value(row, "organization_id"), value(row, "fee_schedule_id"), context.now);
      if (feePreview.tierCode == null || feePreview.platformFeeBps == null || feePreview.referralRewardBps == null) {
        throw new ExchangeDomainError("HOSTING_FEE_TIERS_UNAVAILABLE", 503, "成交费率阶梯尚未配置，成交保持关闭。");
      }
      const recordId = id("hctr");
      const snapshot = {
        title: value(row, "title"), gpuModel: value(row, "gpu_model"), region: value(row, "region"),
        cardHourMicrosPerGpuHour: number(row, "card_hour_micros_per_gpu_hour"), approvedImage: value(row, "approved_image"), termsVersion: value(row, "terms_version"),
        platformFeeBps: feePreview.platformFeeBps,
        referralRewardBps: feePreview.referralRewardBps,
        feeQualification: {
          model: HOSTING_FEE_QUALIFICATION_MODEL,
          tierCode: feePreview.tierCode,
          asOf: feePreview.asOf,
          qualifyingVolumeMicros: feePreview.qualifyingVolumeMicros,
          platformFeeBps: feePreview.platformFeeBps,
          referralRewardBps: feePreview.referralRewardBps,
        },
        acceptanceWindowSeconds: HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS,
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

    async contractEvidenceForViewer(organizationId, contractId) {
      const visible = await db.first<Row>("SELECT id FROM hosting_v2_contracts WHERE id=? AND (buyer_organization_id=? OR supplier_organization_id=?)", [contractId, organizationId, organizationId]);
      if (!visible) return null;
      const [instanceRow, meteringRow, cleanupRow, acceptanceRow, disputeRow, deliveryFailureRow, stopFailureRow, runtimeControlRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_instances WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_metering_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_cleanup_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_acceptance_proofs WHERE contract_id=?", [contractId]),
        db.first<Row>(`SELECT d.*,p.id proposal_id,p.proposal_version,p.resolution,p.status proposal_status,p.request_reason,p.decision_reason,p.requested_at,p.decided_at
          FROM hosting_v2_disputes d LEFT JOIN hosting_v2_dispute_resolution_proposals p ON p.id=(
            SELECT p2.id FROM hosting_v2_dispute_resolution_proposals p2 WHERE p2.contract_id=d.contract_id ORDER BY p2.proposal_version DESC LIMIT 1)
          WHERE d.contract_id=?`, [contractId]),
        db.first<Row>(`SELECT id,command_type,error_code,evidence_digest,completed_at FROM hosting_v2_agent_commands
          WHERE contract_id=? AND command_type IN ('PROVISION','START') AND status='FAILED'
          ORDER BY completed_at DESC,id DESC LIMIT 1`, [contractId]),
        db.first<Row>(`SELECT * FROM hosting_v2_stop_failures WHERE contract_id=? ORDER BY retry_sequence DESC LIMIT 1`, [contractId]),
        db.first<Row>(`SELECT d.last_seen_at agent_last_seen_at,cmd.id stop_command_id,cmd.status stop_command_status,cmd.attempt stop_attempt,cmd.created_at stop_requested_at,cmd.delivered_at stop_delivered_at
          FROM hosting_v2_contracts c JOIN hosting_v2_devices d ON d.id=c.device_id
          LEFT JOIN hosting_v2_agent_commands cmd ON cmd.id=(SELECT latest.id FROM hosting_v2_agent_commands latest WHERE latest.contract_id=c.id AND latest.command_type='STOP' ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
          WHERE c.id=?`, [contractId]),
      ]);
      if (!runtimeControlRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁运行控制事实不存在。");
      return contractEvidence(instanceRow, meteringRow, cleanupRow, acceptanceRow, disputeRow, deliveryFailureRow, stopFailureRow, runtimeControlRow);
    },

    async expiredAcceptanceForDevice(deviceId, now) {
      const row = await db.first<Row>(`SELECT * FROM hosting_v2_contracts
        WHERE device_id=? AND stopped_at IS NOT NULL AND (status='SETTLED' OR (status='AWAITING_ACCEPTANCE'
          AND CAST(strftime('%s',stopped_at) AS INTEGER)+COALESCE(CAST(json_extract(snapshot_json,'$.acceptanceWindowSeconds') AS INTEGER),?)<=CAST(strftime('%s',?) AS INTEGER)))
        ORDER BY CASE status WHEN 'SETTLED' THEN 0 ELSE 1 END,stopped_at,id LIMIT 1`, [deviceId, HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS, now]);
      return row ? contract(row) : null;
    },

    async failedDeliveryForDevice(deviceId) {
      const row = await db.first<Row>(`SELECT cmd.* FROM hosting_v2_agent_commands cmd
        JOIN hosting_v2_contracts c ON c.id=cmd.contract_id
        WHERE cmd.device_id=? AND cmd.command_type IN ('PROVISION','START') AND cmd.status='FAILED'
          AND c.status IN ('FAILED','CLEANING')
        ORDER BY cmd.completed_at,cmd.id LIMIT 1`, [deviceId]);
      return row ? command(row) : null;
    },

    async failedStopForDevice(deviceId) {
      const row = await db.first<Row>(`SELECT cmd.* FROM hosting_v2_agent_commands cmd
        JOIN hosting_v2_contracts c ON c.id=cmd.contract_id
        JOIN hosting_v2_stop_failures f ON f.command_id=cmd.id
        WHERE cmd.device_id=? AND cmd.command_type='STOP' AND cmd.status='FAILED'
          AND c.status='FAILED' AND f.status='RECORDED'
        ORDER BY f.retry_sequence DESC LIMIT 1`, [deviceId]);
      return row ? command(row) : null;
    },

    async cancelContract(contractId, reason, context) {
      const replayed = await replay(db, context, "CANCEL_CONTRACT");
      if (!replayed) {
        const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
        if (!/[\p{L}\p{N}]/u.test(reason) || reason.trim().length < 4) throw new ExchangeInputError("取消原因至少 4 个字符。", "reason");
        if (!["RESERVED", "CARD_HOURS_HELD", "PAID"].includes(value(current, "status"))) {
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实例开通任务已经下发，必须先停止并完成撤权清理，不能直接取消或重新挂牌。");
        }
        await db.batch([
          { sql: "UPDATE hosting_v2_contracts SET status='CANCELLED',version=version+1,updated_at=? WHERE id=? AND status IN ('RESERVED','CARD_HOURS_HELD','PAID')", values: [context.now, contractId] },
          { sql: `UPDATE hosting_v2_offers SET status=CASE WHEN EXISTS(
              SELECT 1 FROM hosting_v2_events retirement
              WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=hosting_v2_offers.device_id
                AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED')
            ) THEN 'SUSPENDED' ELSE 'PUBLISHED' END,version=version+1,updated_at=?
            WHERE id=? AND status='RESERVED'`, values: [context.now, value(current, "offer_id")] },
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
      const deviceRow = await db.first<Row>(`SELECT *,${DEVICE_RETIREMENT_EVENT_SQL} AS retirement_requested
        FROM hosting_v2_devices WHERE id=?`, [value(current, "device_id")]);
      if (!deviceRow || !agentVersionAtLeast(value(deviceRow, "agent_version"), HOSTING_V2_MIN_AGENT_VERSION)) throw new ExchangeDomainError("HOSTING_AGENT_UPGRADE_REQUIRED", 409, `Host Agent 需要升级到 ${HOSTING_V2_MIN_AGENT_VERSION} 或更高版本。`);
      const staleCutoff = new Date(Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000).toISOString();
      if (value(deviceRow, "status") !== "VERIFIED" || value(deviceRow, "verification_status") !== "PASSED"
        || Date.parse(nullable(deviceRow, "verified_until") ?? "") <= Date.parse(context.now)
        || Date.parse(nullable(deviceRow, "last_seen_at") ?? "") < Date.parse(staleCutoff)
        || number(deviceRow, "retirement_requested") === 1) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备已离线、验真失效或正在退场，不能下发开通任务。");
      }
      if (!/^ssh-(?:ed25519|rsa) [A-Za-z0-9+/=]{40,8192}(?: [^\r\n]{1,120})?$/u.test(input.publicKey.trim())) throw new ExchangeInputError("请提交有效的 OpenSSH 公钥。", "publicKey");
      if (!/^SHA256:[A-Za-z0-9+/]{20,64}$/u.test(input.fingerprint)) throw new ExchangeInputError("SSH 公钥指纹无效。", "fingerprint");
      const commandId = id("hcmd");
      const snapshot = json<HostingContract["snapshot"]>(current, "snapshot_json");
      const payload = { contractId, image: snapshot.approvedImage, publicKey: input.publicKey.trim(), reservedSeconds: number(current, "reserved_seconds"), gpuCount: 1 };
      await db.batch([
        { sql: `UPDATE hosting_v2_contracts SET status='PROVISIONING',ssh_public_key_fingerprint=?,version=version+1,updated_at=?
          WHERE id=? AND status='CARD_HOURS_HELD' AND EXISTS(
            SELECT 1 FROM hosting_v2_devices d WHERE d.id=hosting_v2_contracts.device_id
              AND d.status='VERIFIED' AND d.verification_status='PASSED' AND d.verified_until>? AND d.last_seen_at>=?
              AND NOT EXISTS(SELECT 1 FROM hosting_v2_events retirement
                WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=d.id
                  AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED'))
          )`, values: [input.fingerprint, context.now, contractId, context.now, staleCutoff] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
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
      const startDevice = await db.first<Row>(`SELECT *,${DEVICE_RETIREMENT_EVENT_SQL} AS retirement_requested
        FROM hosting_v2_devices WHERE id=?`, [value(current, "device_id")]);
      const staleCutoff = new Date(Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000).toISOString();
      if (!startDevice || value(startDevice, "status") !== "BUSY"
        || Date.parse(nullable(startDevice, "last_seen_at") ?? "") < Date.parse(staleCutoff)
        || number(startDevice, "retirement_requested") === 1) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备已离线或正在退场，不能启动实例。");
      }
      const queued = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='START' AND status IN ('PENDING','DELIVERED') ORDER BY created_at DESC LIMIT 1", [contractId]);
      if (queued) {
        await db.batch([receipt(context, "START_CONTRACT", "AGENT_COMMAND", value(queued, "id"))]);
        return { contract: contract(current), command: command(queued) };
      }
      const commandId = id("hcmd");
      await db.batch([
        { sql: `INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at)
          SELECT ?,c.device_id,c.id,'START',?,'PENDING',0,? FROM hosting_v2_contracts c
          JOIN hosting_v2_devices d ON d.id=c.device_id
          WHERE c.id=? AND c.status='READY' AND d.status='BUSY' AND d.last_seen_at>=?
            AND NOT EXISTS(SELECT 1 FROM hosting_v2_events retirement
              WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=d.id
                AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED'))`, values: [commandId, JSON.stringify({ contractId, endpointDisplay }), context.now, contractId, staleCutoff] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
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
      const queued = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='STOP' AND status IN ('PENDING','DELIVERED') ORDER BY created_at DESC LIMIT 1", [contractId]);
      if (queued) {
        await db.batch([receipt(context, "STOP_CONTRACT", "AGENT_COMMAND", value(queued, "id"))]);
        return { contract: contract(current), command: command(queued) };
      }
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

    async getCommand(deviceId, commandId) {
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=? AND device_id=?", [commandId, deviceId]);
      return row ? command(row) : null;
    },

    async pollCommand(deviceId, now, allowedTypes) {
      const deviceState = await db.first<Row>("SELECT status FROM hosting_v2_devices WHERE id=?", [deviceId]);
      if (!deviceState || value(deviceState, "status") === "REVOKED") throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在或已撤销。");
      const drainingTypes = ["STOP", "CLEANUP"] as const;
      const effectiveAllowedTypes = value(deviceState, "status") === "DRAINING"
        ? drainingTypes.filter((type) => !allowedTypes || allowedTypes.includes(type))
        : allowedTypes;
      if (effectiveAllowedTypes && effectiveAllowedTypes.length === 0) return null;
      if (!effectiveAllowedTypes || effectiveAllowedTypes.includes("STOP")) {
        const expired = await db.first<Row>(`SELECT id,supplier_organization_id,started_at,reserved_seconds
          FROM hosting_v2_contracts
          WHERE device_id=? AND status='IN_SERVICE' AND started_at IS NOT NULL
            AND CAST(strftime('%s',started_at) AS INTEGER)+reserved_seconds<=CAST(strftime('%s',?) AS INTEGER)
            AND NOT EXISTS (SELECT 1 FROM hosting_v2_agent_commands WHERE contract_id=hosting_v2_contracts.id AND command_type='STOP')
          ORDER BY started_at,id LIMIT 1`, [deviceId, now]);
        if (expired) {
          const commandId = id("hcmd");
          const contractId = value(expired, "id");
          const payload = { contractId, startedAt: value(expired, "started_at"), maximumSeconds: number(expired, "reserved_seconds") };
          const payloadDigest = await hostingAgentDigest({ operation: "LEASE_EXPIRED_STOP", deviceId, ...payload });
          await db.batch([
            { sql: `INSERT OR IGNORE INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at)
              SELECT ?,device_id,id,'STOP',?,'PENDING',0,? FROM hosting_v2_contracts
              WHERE id=? AND device_id=? AND status='IN_SERVICE' AND started_at=?
                AND CAST(strftime('%s',started_at) AS INTEGER)+reserved_seconds<=CAST(strftime('%s',?) AS INTEGER)
                AND NOT EXISTS (SELECT 1 FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='STOP')`, values: [commandId, JSON.stringify(payload), now, contractId, deviceId, value(expired, "started_at"), now, contractId] },
            { sql: `INSERT INTO hosting_v2_events(id,organization_id,entity_type,entity_id,event_type,actor_id,payload_digest,metadata_json,occurred_at)
              SELECT ?,?,'CONTRACT',?,'LEASE_EXPIRED_STOP_QUEUED','system:hosting-expiry',?,?,?
              WHERE EXISTS (SELECT 1 FROM hosting_v2_agent_commands WHERE id=?)`, values: [id("hve"), value(expired, "supplier_organization_id"), contractId, payloadDigest, JSON.stringify({ commandId, maximumSeconds: payload.maximumSeconds }), now, commandId] },
          ]);
        }
      }
      const leaseCutoff = new Date(Date.parse(now) - 60_000).toISOString();
      const typeFilter = effectiveAllowedTypes ? ` AND command_type IN (${effectiveAllowedTypes.map(() => "?").join(",")})` : "";
      const current = await db.first<Row>(`SELECT * FROM hosting_v2_agent_commands WHERE device_id=?${typeFilter} AND (status='PENDING' OR (status='DELIVERED' AND delivered_at<?)) ORDER BY created_at LIMIT 1`, [deviceId, ...(effectiveAllowedTypes ?? []), leaseCutoff]);
      if (!current) return null;
      const leased = await db.batch([{ sql: `UPDATE hosting_v2_agent_commands SET status='DELIVERED',attempt=attempt+1,delivered_at=?
        WHERE id=? AND (status='PENDING' OR (status='DELIVERED' AND delivered_at<?))
          AND EXISTS(SELECT 1 FROM hosting_v2_devices d WHERE d.id=? AND d.status!='REVOKED'
            AND (d.status!='DRAINING' OR hosting_v2_agent_commands.command_type IN ('STOP','CLEANUP')))`, values: [now, value(current, "id"), leaseCutoff, deviceId] }]);
      if (leased[0]?.changes !== 1) return null;
      const row = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [value(current, "id")]);
      return row ? command(row) : null;
    },

    async completeCommand(deviceId, commandId, input, context) {
      const [commandRow, deviceRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=? AND device_id=?", [commandId, deviceId]),
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]),
      ]);
      if (!commandRow || !deviceRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备任务不存在。");
      const type = value(commandRow, "command_type") as HostingAgentCommand["type"];
      const retirementRequested = await hasDeviceRetirementEvent(db, deviceId);
      if (value(deviceRow, "status") === "REVOKED") throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "设备不存在或已撤销。");
      if ((value(deviceRow, "status") === "DRAINING" || retirementRequested) && type !== "STOP" && type !== "CLEANUP") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "设备退场中，只能完成停止或清理任务。");
      }
      if (["SUCCEEDED", "FAILED"].includes(value(commandRow, "status"))) {
        if (nullable(commandRow, "evidence_digest") !== input.evidenceDigest || value(commandRow, "status") !== input.outcome) throw new ExchangeIdempotencyConflictError();
        const existingContract = commandRow.contract_id ? await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [value(commandRow, "contract_id")]) : null;
        return { command: command(commandRow), contract: existingContract ? contract(existingContract) : null, device: device(deviceRow) };
      }
      const success = input.outcome === "SUCCEEDED";
      if (!success && (!input.errorCode || !/^[A-Z0-9_:-]{3,80}$/u.test(input.errorCode))) throw new ExchangeInputError("失败任务必须包含有效诊断码。", "errorCode");
      const commandPayload = json<Record<string, unknown>>(commandRow, "payload_json");
      const deviceInventory = json<HostingDeviceInventory>(deviceRow, "inventory_json");
      let transportAttestation: HostingV2Sql | null = null;
      if (input.transportAttestation) {
        if (await hostingAgentDigest(input.details ?? {}) !== input.evidenceDigest) throw new ExchangeInputError("Agent 结果摘要与证据内容不一致。", "evidenceDigest");
        const signedPayload = input.transportAttestation.signedPayload;
        const issuedAt = typeof signedPayload.issuedAt === "string" ? signedPayload.issuedAt : "";
        const expiresAt = typeof signedPayload.expiresAt === "string" ? signedPayload.expiresAt : "";
        const expectedSignedPayload = {
          operation: "COMPLETE_COMMAND",
          deviceId,
          commandId,
          outcome: input.outcome,
          evidenceDigest: input.evidenceDigest,
          errorCode: input.errorCode ?? null,
          details: input.details ?? {},
          issuedAt,
          expiresAt,
        };
        if (hostingAgentCanonicalJson(signedPayload) !== hostingAgentCanonicalJson(expectedSignedPayload)) throw new ExchangeInputError("Agent 传输证明与任务结果不一致。", "transportAttestation");
        assertHostingAgentWindow(issuedAt, expiresAt, new Date(context.now));
        await verifyHostingAgentSignature(value(deviceRow, "device_public_key"), signedPayload, input.transportAttestation.signature);
        transportAttestation = {
          sql: `INSERT INTO hosting_v2_agent_transport_attestations(command_id,device_id,operation,signed_payload_json,signature,signed_payload_digest,signature_digest,issued_at,expires_at,recorded_at)
            VALUES(?,?,'COMPLETE_COMMAND',?,?,?,?,?,?,?)`,
          values: [commandId, deviceId, hostingAgentCanonicalJson(signedPayload), input.transportAttestation.signature, await hostingAgentDigest(signedPayload), await hostingAgentDigest(input.transportAttestation.signature), issuedAt, expiresAt, context.now],
        };
      }
      const recoveredStopFailureRow = type === "STOP" ? await db.first<Row>("SELECT * FROM hosting_v2_stop_failures WHERE contract_id=? AND recovery_command_id=? AND status='RETRYING'", [nullable(commandRow, "contract_id"), commandId]) : null;
      if (type === "VERIFY" && success) assertSuccessfulVerificationDetails(input.details, commandPayload, value(deviceRow, "inventory_digest"), input.controlPlaneReachabilityDigest, context.now);
      const provisionEndpoint = type === "PROVISION" && success ? assertSuccessfulProvisionDetails(input.details, commandPayload, deviceInventory, context.now) : null;
      if (type === "START" && success) assertSuccessfulStartDetails(input.details, commandPayload, context.now);
      if (type === "STOP" && success) assertSuccessfulStopDetails(input.details, commandPayload, context.now, Boolean(recoveredStopFailureRow));
      if (type === "CLEANUP" && success) assertSuccessfulCleanupDetails(input.details, commandPayload, context.now);
      const statements: HostingV2Sql[] = [
        { sql: `UPDATE hosting_v2_agent_commands SET status=?,evidence_digest=?,error_code=?,completed_at=?
          WHERE id=? AND status IN ('PENDING','DELIVERED') AND EXISTS(
            SELECT 1 FROM hosting_v2_devices d WHERE d.id=? AND d.status!='REVOKED'
              AND (hosting_v2_agent_commands.command_type IN ('STOP','CLEANUP') OR (
                d.status!='DRAINING' AND NOT EXISTS(
                  SELECT 1 FROM hosting_v2_events retirement
                  WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=d.id
                    AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED')
                )
              ))
          )`, values: [input.outcome, input.evidenceDigest, input.errorCode ?? null, context.now, commandId, deviceId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        ...(transportAttestation ? [transportAttestation] : []),
      ];
      const contractId = nullable(commandRow, "contract_id");
      let organizationId = value(deviceRow, "organization_id");
      if (type === "VERIFY") {
        const verifiedUntil = new Date(Date.parse(context.now) + 24 * 60 * 60_000).toISOString();
        if (success) statements.push({ sql: "INSERT INTO hosting_v2_verification_proofs(command_id,device_id,agent_evidence_digest,control_plane_reachability_digest,public_host,public_port,recorded_at) VALUES(?,?,?,?,?,?,?)", values: [commandId, deviceId, input.evidenceDigest, input.controlPlaneReachabilityDigest!, deviceInventory.publicHost, deviceInventory.sshPortStart, context.now] });
        statements.push(
          { sql: `UPDATE hosting_v2_devices SET status=?,verification_status=?,verification_evidence_digest=?,verified_until=?,version=version+1,updated_at=?
            WHERE id=? AND status='VERIFYING' AND NOT ${DEVICE_RETIREMENT_EVENT_SQL}`, values: [success ? "VERIFIED" : "ONLINE", success ? "PASSED" : "FAILED", input.evidenceDigest, success ? verifiedUntil : null, context.now, deviceId] },
          { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        );
        if (!success) statements.push({ sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE device_id=? AND status IN ('PUBLISHED','PAUSED')", values: [context.now, deviceId] });
      } else if (contractId) {
        const currentContract = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!currentContract) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "任务关联合同不存在。");
        organizationId = value(currentContract, "supplier_organization_id");
        const instanceRow = await db.first<Row>("SELECT * FROM hosting_v2_instances WHERE contract_id=?", [contractId]);
        const deliveryFailureRow = await db.first<Row>("SELECT * FROM hosting_v2_delivery_failures WHERE contract_id=?", [contractId]);
        if (success) {
          const requiredContractStatus: Partial<Record<HostingAgentCommand["type"], HostingContract["status"]>> = {
            PROVISION: "PROVISIONING", START: "READY", STOP: "IN_SERVICE", CLEANUP: "CLEANING",
          };
          const recoveringStop = type === "STOP" && recoveredStopFailureRow && value(currentContract, "status") === "FAILED";
          if (requiredContractStatus[type] && value(currentContract, "status") !== requiredContractStatus[type] && !recoveringStop) {
            throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同状态已经变化，Agent 结果未被采纳。");
          }
          if (type === "PROVISION" && instanceRow) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同已经存在实例记录。");
          if (["START", "STOP", "CLEANUP"].includes(type)) {
            const failedProvisionCleanup = type === "CLEANUP" && deliveryFailureRow && value(deliveryFailureRow, "failure_stage") === "PROVISION";
            if (!instanceRow && !failedProvisionCleanup) throw new ExchangeDomainError("HOSTING_INSTANCE_EVIDENCE_MISSING", 409, "实例身份记录缺失，不能继续履约或重新挂牌，请人工核验。");
            if (instanceRow && input.details?.containerDigest !== value(instanceRow, "container_digest")) throw new ExchangeInputError("Agent 返回的容器身份与开通记录不一致。", "details.containerDigest");
            const expectedInstanceStatus = type === "START" ? "READY" : type === "STOP" ? "RUNNING" : deliveryFailureRow?.failure_stage === "START" ? "READY" : "STOPPED";
            if (instanceRow && value(instanceRow, "status") !== expectedInstanceStatus) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实例状态已经变化，Agent 结果未被采纳。");
          }
        }
        if (!success) {
          statements.push({ sql: "UPDATE hosting_v2_contracts SET status=?,version=version+1,updated_at=? WHERE id=?", values: [type === "CLEANUP" ? "CLEANING" : "FAILED", context.now, contractId] });
          if (["PROVISION", "START"].includes(type)) statements.push({
            sql: `INSERT INTO hosting_v2_delivery_failures(command_id,contract_id,failure_stage,error_code,evidence_digest,status,failed_at)
              VALUES(?,?,?,?,?,'RECORDED',?)`,
            values: [commandId, contractId, type, input.errorCode!, input.evidenceDigest, context.now],
          });
          if (type === "STOP") {
            const latestStopFailure = await db.first<Row>("SELECT * FROM hosting_v2_stop_failures WHERE contract_id=? ORDER BY retry_sequence DESC LIMIT 1", [contractId]);
            const retrySequence = latestStopFailure ? number(latestStopFailure, "retry_sequence") + 1 : 1;
            if (recoveredStopFailureRow) statements.push({ sql: "UPDATE hosting_v2_stop_failures SET status='RETRY_FAILED',resolved_at=? WHERE command_id=? AND status='RETRYING'", values: [context.now, value(recoveredStopFailureRow, "command_id")] });
            statements.push({
              sql: `INSERT INTO hosting_v2_stop_failures(command_id,contract_id,retry_sequence,error_code,evidence_digest,status,failed_at)
                VALUES(?,?,?,?,?,'RECORDED',?)`,
              values: [commandId, contractId, retrySequence, input.errorCode!, input.evidenceDigest, context.now],
            });
          }
          statements.push(
              { sql: "UPDATE hosting_v2_devices SET status='DRAINING',version=version+1,updated_at=? WHERE id=?", values: [context.now, deviceId] },
              { sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE id=?", values: [context.now, value(currentContract, "offer_id")] },
            );
        } else if (type === "PROVISION") {
          statements.push(
            { sql: `INSERT INTO hosting_v2_instances(contract_id,device_id,provision_command_id,approved_image,endpoint_display,container_digest,workspace_digest,status,provision_evidence_digest,provisioned_at,updated_at)
              VALUES(?,?,?,?,?,?,?,'READY',?,?,?)`, values: [contractId, deviceId, commandId, String(commandPayload.image), provisionEndpoint, String(input.details?.containerDigest), String(input.details?.workspaceDigest), input.evidenceDigest, context.now, context.now] },
            { sql: "UPDATE hosting_v2_contracts SET status='READY',endpoint_display=?,version=version+1,updated_at=? WHERE id=? AND status='PROVISIONING'", values: [provisionEndpoint, context.now, contractId] },
            { sql: "UPDATE hosting_v2_devices SET status='BUSY',version=version+1,updated_at=? WHERE id=?", values: [context.now, deviceId] },
          );
        } else if (type === "START") {
          statements.push(
            { sql: "UPDATE hosting_v2_instances SET status='RUNNING',start_evidence_digest=?,started_at=?,updated_at=? WHERE contract_id=? AND status='READY'", values: [input.evidenceDigest, String(input.details?.startedAt), context.now, contractId] },
            { sql: "UPDATE hosting_v2_contracts SET status='IN_SERVICE',started_at=?,version=version+1,updated_at=? WHERE id=? AND status='READY'", values: [context.now, context.now, contractId] },
          );
        } else if (type === "STOP") {
          const rawMeasured = Number(input.details?.runtimeSeconds);
          const wallClockSeconds = Math.max(0, Math.ceil((Date.parse(context.now) - Date.parse(value(currentContract, "started_at"))) / 1_000));
          const measured = Math.max(180, Math.min(number(currentContract, "reserved_seconds"), wallClockSeconds, rawMeasured));
          statements.push(
            { sql: "UPDATE hosting_v2_instances SET status='STOPPED',stop_evidence_digest=?,stopped_at=?,updated_at=? WHERE contract_id=? AND status='RUNNING'", values: [input.evidenceDigest, String(input.details?.stoppedAt), context.now, contractId] },
            { sql: `INSERT INTO hosting_v2_metering_proofs(id,contract_id,command_id,container_digest,runtime_state_digest,agent_started_at,agent_stopped_at,agent_runtime_seconds,server_measured_seconds,evidence_digest,recorded_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`, values: [id("hmp"), contractId, commandId, String(input.details?.containerDigest), String(input.details?.runtimeStateDigest), String(input.details?.startedAt), String(input.details?.stoppedAt), rawMeasured, measured, input.evidenceDigest, context.now] },
            { sql: "UPDATE hosting_v2_contracts SET status='AWAITING_ACCEPTANCE',measured_seconds=?,stopped_at=?,version=version+1,updated_at=? WHERE id=? AND status IN ('IN_SERVICE','FAILED')", values: [measured, context.now, context.now, contractId] },
            ...(recoveredStopFailureRow ? [{ sql: "UPDATE hosting_v2_stop_failures SET status='RECOVERED',resolved_at=? WHERE command_id=? AND status='RETRYING'", values: [context.now, value(recoveredStopFailureRow, "command_id")] } satisfies HostingV2Sql] : []),
          );
        } else if (type === "CLEANUP") {
          const cleanupOffer = await db.first<Row>(`SELECT o.approved_image,
              (SELECT cmd.payload_json FROM hosting_v2_verification_proofs proof JOIN hosting_v2_agent_commands cmd ON cmd.id=proof.command_id
               WHERE proof.device_id=d.id AND proof.agent_evidence_digest=d.verification_evidence_digest ORDER BY proof.recorded_at DESC LIMIT 1) AS verification_payload_json
            FROM hosting_v2_offers o JOIN hosting_v2_devices d ON d.id=o.device_id WHERE o.id=?`, [value(currentContract, "offer_id")]);
          let verifiedImageCurrent = false;
          try {
            verifiedImageCurrent = Boolean(cleanupOffer && hostingV2ApprovedImages().has(value(cleanupOffer, "approved_image"))
              && verificationAllowsImage(cleanupOffer, value(cleanupOffer, "approved_image")));
          } catch { /* Missing or invalid policy keeps the cleaned device safely unlisted. */ }
          const verificationFresh = verifiedImageCurrent && value(deviceRow, "verification_status") === "PASSED"
            && Date.parse(nullable(deviceRow, "verified_until") ?? "") > Date.parse(context.now)
            && Date.parse(nullable(deviceRow, "last_seen_at") ?? "") >= Date.parse(context.now) - HOSTING_V2_AGENT_STALE_SECONDS * 1_000;
          statements.push(
            { sql: "UPDATE hosting_v2_instances SET status='CLEANED',cleaned_at=?,updated_at=? WHERE contract_id=? AND status IN ('STOPPED','READY')", values: [String(input.details?.cleanedAt), context.now, contractId] },
            { sql: `INSERT INTO hosting_v2_cleanup_proofs(id,contract_id,command_id,container_digest,cleanup_digest,container_removed,authorized_key_removed,workspace_removed,evidence_digest,cleaned_at,recorded_at)
              VALUES(?,?,?,?,?,1,1,1,?,?,?)`, values: [id("hcp"), contractId, commandId, String(input.details?.containerDigest), String(input.details?.cleanupDigest), input.evidenceDigest, String(input.details?.cleanedAt), context.now] },
            { sql: `UPDATE hosting_v2_contracts SET status=CASE WHEN EXISTS(
                SELECT 1 FROM hosting_v2_dispute_resolution_proposals p WHERE p.contract_id=hosting_v2_contracts.id AND p.status='APPLIED' AND p.resolution='REFUND'
              ) OR EXISTS(SELECT 1 FROM hosting_v2_delivery_failures f WHERE f.contract_id=hosting_v2_contracts.id AND f.status='CLEANING')
              THEN 'REFUNDED' ELSE 'CLEANED' END,version=version+1,updated_at=? WHERE id=? AND status='CLEANING'`, values: [context.now, contractId] },
            ...(deliveryFailureRow ? [{ sql: "UPDATE hosting_v2_delivery_failures SET status='CLEANED',cleaned_at=? WHERE contract_id=? AND status='CLEANING'", values: [String(input.details?.cleanedAt), contractId] } satisfies HostingV2Sql] : []),
            { sql: `UPDATE hosting_v2_devices SET
                status=CASE WHEN ${DEVICE_RETIREMENT_EVENT_SQL} THEN 'DRAINING' ELSE ? END,
                verification_status=CASE WHEN ${DEVICE_RETIREMENT_EVENT_SQL} THEN 'EXPIRED' ELSE ? END,
                verified_until=CASE WHEN ${DEVICE_RETIREMENT_EVENT_SQL} THEN NULL ELSE ? END,
                version=version+1,updated_at=? WHERE id=? AND status!='REVOKED'`, values: [verificationFresh ? "VERIFIED" : "ONLINE", verificationFresh ? "PASSED" : "EXPIRED", verificationFresh ? nullable(deviceRow, "verified_until") : null, context.now, deviceId] },
            { sql: `UPDATE hosting_v2_offers SET status=CASE WHEN EXISTS(
                SELECT 1 FROM hosting_v2_events retirement
                WHERE retirement.entity_type='DEVICE' AND retirement.entity_id=hosting_v2_offers.device_id
                  AND retirement.event_type IN ('DEVICE_RETIREMENT_REQUESTED','DEVICE_CREDENTIAL_REVOKED','DEVICE_RETIREMENT_FINALIZED')
              ) THEN 'SUSPENDED' ELSE ? END,version=version+1,updated_at=?
              WHERE id=? AND status IN ('RESERVED','SUSPENDED')`, values: [verificationFresh ? "PUBLISHED" : "SUSPENDED", context.now, value(currentContract, "offer_id")] },
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

    async queueFailedDeliveryCleanup(commandId, context) {
      const replayed = await replay(db, context, "QUEUE_FAILED_DELIVERY_CLEANUP");
      if (replayed) {
        const [contractRow, cleanupRow] = await Promise.all([
          db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=(SELECT contract_id FROM hosting_v2_agent_commands WHERE id=?)", [commandId]),
          db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId]),
        ]);
        if (!contractRow || !cleanupRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "失败交付清理任务不存在。");
        return { contract: contract(contractRow), command: command(cleanupRow) };
      }
      const failed = await db.first<Row>(`SELECT cmd.*,c.status contract_status,c.supplier_organization_id,c.offer_id,c.device_id
        ,f.status failure_status FROM hosting_v2_agent_commands cmd JOIN hosting_v2_contracts c ON c.id=cmd.contract_id
        JOIN hosting_v2_delivery_failures f ON f.command_id=cmd.id AND f.contract_id=c.id
        WHERE cmd.id=?`, [commandId]);
      if (!failed || !["PROVISION", "START"].includes(value(failed, "command_type")) || value(failed, "status") !== "FAILED"
        || nullable(failed, "evidence_digest") == null || nullable(failed, "error_code") == null) {
        throw new ExchangeDomainError("HOSTING_DELIVERY_FAILURE_INVALID", 409, "交付失败事实不完整，不能安排安全清理。");
      }
      if (!["REFUNDED", "CLEANING"].includes(value(failed, "failure_status"))) throw new ExchangeDomainError("HOSTING_DELIVERY_FAILURE_REFUND_REQUIRED", 409, "锁定卡时尚未全额退回，不能安排失败交付清理。");
      const contractId = value(failed, "contract_id");
      const existing = await db.first<Row>(`SELECT * FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='CLEANUP'
        AND status IN ('PENDING','DELIVERED','SUCCEEDED') ORDER BY created_at DESC LIMIT 1`, [contractId]);
      if (existing) {
        if (value(failed, "contract_status") === "FAILED" && value(failed, "failure_status") === "REFUNDED") {
          await db.batch([
            { sql: "UPDATE hosting_v2_contracts SET status='CLEANING',version=version+1,updated_at=? WHERE id=? AND status='FAILED'", values: [context.now, contractId] },
            { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
            { sql: "UPDATE hosting_v2_delivery_failures SET status='CLEANING',cleanup_command_id=?,cleanup_queued_at=? WHERE command_id=? AND status='REFUNDED'", values: [value(existing, "id"), context.now, commandId] },
            { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
            receipt(context, "QUEUE_FAILED_DELIVERY_CLEANUP", "AGENT_COMMAND", value(existing, "id")),
          ]);
        } else {
          await db.batch([receipt(context, "QUEUE_FAILED_DELIVERY_CLEANUP", "AGENT_COMMAND", value(existing, "id"))]);
        }
        const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "失败交付合同不存在。");
        return { contract: contract(current), command: command(existing) };
      }
      if (!["FAILED", "CLEANING"].includes(value(failed, "contract_status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "失败交付合同状态已经变化。");
      const cleanupId = id("hcmd");
      const payload = { contractId, removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true };
      const results = await db.batch([
        { sql: "UPDATE hosting_v2_contracts SET status='CLEANING',version=version+1,updated_at=? WHERE id=? AND status IN ('FAILED','CLEANING')", values: [context.now, contractId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "UPDATE hosting_v2_delivery_failures SET status='CLEANING',cleanup_command_id=?,cleanup_queued_at=? WHERE command_id=? AND status='REFUNDED'", values: [cleanupId, context.now, commandId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: `INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at)
          VALUES(?,?,?,'CLEANUP',?,'PENDING',0,?)`, values: [cleanupId, value(failed, "device_id"), contractId, JSON.stringify(payload), context.now] },
        event(context, value(failed, "supplier_organization_id"), "CONTRACT", contractId, "FAILED_DELIVERY_CLEANUP_QUEUED", { failedCommandId: commandId, cleanupCommandId: cleanupId, failureStage: value(failed, "command_type"), errorCode: value(failed, "error_code") }),
        receipt(context, "QUEUE_FAILED_DELIVERY_CLEANUP", "AGENT_COMMAND", cleanupId),
      ]);
      if (results[0]?.changes !== 1 || results[2]?.changes !== 1 || results[4]?.changes !== 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "失败交付清理任务已被其他进程安排。");
      const [contractRow, cleanupRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [cleanupId]),
      ]);
      if (!contractRow || !cleanupRow) throw new Error("HOSTING_FAILED_DELIVERY_CLEANUP_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(cleanupRow) };
    },

    async queueFailedStopRecovery(commandId, context) {
      const replayed = await replay(db, context, "QUEUE_FAILED_STOP_RECOVERY");
      const failure = await db.first<Row>(`SELECT f.*,cmd.device_id,cmd.payload_json,c.status contract_status,c.supplier_organization_id,c.started_at,c.reserved_seconds
        FROM hosting_v2_stop_failures f JOIN hosting_v2_agent_commands cmd ON cmd.id=f.command_id
        JOIN hosting_v2_contracts c ON c.id=f.contract_id WHERE f.command_id=?`, [commandId]);
      if (!failure) throw new ExchangeDomainError("HOSTING_STOP_FAILURE_INVALID", 409, "停止失败事实不存在，不能安排恢复。");
      const contractId = value(failure, "contract_id");
      if (replayed) {
        const [contractRow, recoveryRow] = await Promise.all([
          db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
          failure.recovery_command_id ? db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [value(failure, "recovery_command_id")]) : Promise.resolve(null),
        ]);
        if (!contractRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "停止恢复合同不存在。");
        return { contract: contract(contractRow), command: recoveryRow ? command(recoveryRow) : null, exhausted: value(failure, "status") === "EXHAUSTED" };
      }
      if (value(failure, "contract_status") !== "FAILED" || value(failure, "status") !== "RECORDED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "停止恢复状态已变化。");
      }
      if (number(failure, "retry_sequence") >= HOSTING_V2_AUTOMATED_STOP_ATTEMPTS) {
        await db.batch([
          { sql: "UPDATE hosting_v2_stop_failures SET status='EXHAUSTED',resolved_at=? WHERE command_id=? AND status='RECORDED'", values: [context.now, commandId] },
          { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
          event(context, value(failure, "supplier_organization_id"), "CONTRACT", contractId, "STOP_RECOVERY_EXHAUSTED", { failedCommandId: commandId, attempts: number(failure, "retry_sequence") }),
          receipt(context, "QUEUE_FAILED_STOP_RECOVERY", "STOP_FAILURE", commandId),
        ]);
        const contractRow = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
        if (!contractRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "停止恢复合同不存在。");
        return { contract: contract(contractRow), command: null, exhausted: true };
      }
      const recoveryCommandId = id("hcmd");
      const payload = JSON.stringify({ contractId, startedAt: nullable(failure, "started_at"), maximumSeconds: number(failure, "reserved_seconds") });
      const results = await db.batch([
        { sql: "UPDATE hosting_v2_stop_failures SET status='RETRYING',recovery_command_id=?,recovery_queued_at=? WHERE command_id=? AND status='RECORDED'", values: [recoveryCommandId, context.now, commandId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'STOP',?,'PENDING',0,?)", values: [recoveryCommandId, value(failure, "device_id"), contractId, payload, context.now] },
        event(context, value(failure, "supplier_organization_id"), "CONTRACT", contractId, "STOP_RECOVERY_QUEUED", { failedCommandId: commandId, recoveryCommandId, attempt: number(failure, "retry_sequence") + 1 }),
        receipt(context, "QUEUE_FAILED_STOP_RECOVERY", "AGENT_COMMAND", recoveryCommandId),
      ]);
      if (results[0]?.changes !== 1 || results[2]?.changes !== 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "停止恢复任务已由其他进程安排。");
      const [contractRow, recoveryRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [recoveryCommandId]),
      ]);
      if (!contractRow || !recoveryRow) throw new Error("HOSTING_STOP_RECOVERY_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(recoveryRow), exhausted: false };
    },

    async markContractSettled(contractId, input, context) {
      const replayed = await replay(db, context, "SETTLE_CONTRACT");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "清理任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
      if (!current || value(current, "status") !== "SETTLED") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不能完成结算。");
      const meteringProof = await db.first<Row>("SELECT contract_id FROM hosting_v2_metering_proofs WHERE contract_id=?", [contractId]);
      const acceptanceProof = await db.first<Row>("SELECT contract_id FROM hosting_v2_acceptance_proofs WHERE contract_id=?", [contractId]);
      if (!meteringProof) throw new ExchangeDomainError("HOSTING_INSTANCE_EVIDENCE_MISSING", 409, "平台计量凭证缺失，合同已停止自动结算，请人工核验。");
      if (!acceptanceProof) throw new ExchangeDomainError("HOSTING_ACCEPTANCE_EVIDENCE_MISSING", 409, "验收决定凭证缺失，合同已停止结算，请人工核验。");
      if (!Number.isSafeInteger(input.measuredSeconds) || input.measuredSeconds < 180 || input.measuredSeconds > number(current, "reserved_seconds") || !Number.isSafeInteger(input.settledMicros) || input.settledMicros < 1 || input.settledMicros > number(current, "held_micros")) throw new ExchangeInputError("合同计量或结算金额无效。");
      if (input.supplierIncomeMicros < 0 || input.commissionMicros < 0 || input.supplierIncomeMicros + input.commissionMicros > input.settledMicros) throw new ExchangeInputError("收益拆分无效。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: "UPDATE hosting_v2_contracts SET status='CLEANING',measured_seconds=?,settled_micros=?,supplier_income_micros=?,commission_micros=?,version=version+1,updated_at=? WHERE id=? AND status='SETTLED'", values: [input.measuredSeconds, input.settledMicros, input.supplierIncomeMicros, input.commissionMicros, context.now, contractId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'CLEANUP',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, JSON.stringify({ contractId, removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true }), context.now] },
        event(context, value(current, "supplier_organization_id"), "CONTRACT", contractId, "CONTRACT_SETTLED", input),
        receipt(context, "SETTLE_CONTRACT", "AGENT_COMMAND", commandId),
      ]);
      const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId])]);
      if (!contractRow || !commandRow) throw new Error("HOSTING_SETTLEMENT_CLEANUP_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(commandRow) };
    },

    async disputeContract(buyerOrganizationId, contractId, reason, context) {
      const replayed = await replay(db, context, "DISPUTE_CONTRACT");
      if (!replayed) {
        const current = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND buyer_organization_id=?", [contractId, buyerOrganizationId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
        if (value(current, "status") !== "AWAITING_ACCEPTANCE") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不能发起争议。");
        const normalizedReason = reason.trim();
        if (normalizedReason.length < 8 || normalizedReason.length > 500 || !/[\p{L}\p{N}]/u.test(normalizedReason)) throw new ExchangeInputError("争议说明应为 8 至 500 个字符。", "reason");
        const snapshot = json<HostingContract["snapshot"]>(current, "snapshot_json");
        const windowSeconds = Number.isSafeInteger(snapshot.acceptanceWindowSeconds) && snapshot.acceptanceWindowSeconds >= 0 ? snapshot.acceptanceWindowSeconds : HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS;
        const deadlineAt = new Date(Date.parse(value(current, "stopped_at")) + windowSeconds * 1_000).toISOString();
        if (Date.parse(context.now) >= Date.parse(deadlineAt)) throw new ExchangeDomainError("HOSTING_ACCEPTANCE_WINDOW_EXPIRED", 409, "验收时间已经结束，系统正在核对结算状态。");
        await db.batch([
          { sql: "UPDATE hosting_v2_contracts SET status='DISPUTED',version=version+1,updated_at=? WHERE id=? AND buyer_organization_id=? AND status='AWAITING_ACCEPTANCE'", values: [context.now, contractId, buyerOrganizationId] },
          { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
          { sql: "INSERT INTO hosting_v2_disputes(contract_id,buyer_organization_id,reason,opened_by,opened_at) VALUES(?,?,?,?,?)", values: [contractId, buyerOrganizationId, normalizedReason, context.actorId, context.now] },
          { sql: "UPDATE hosting_v2_devices SET status='DRAINING',version=version+1,updated_at=? WHERE id=?", values: [context.now, value(current, "device_id")] },
          { sql: "UPDATE hosting_v2_offers SET status='SUSPENDED',version=version+1,updated_at=? WHERE id=? AND status='RESERVED'", values: [context.now, value(current, "offer_id")] },
          event(context, buyerOrganizationId, "CONTRACT", contractId, "CONTRACT_DISPUTED", { reason: normalizedReason, deadlineAt }),
          receipt(context, "DISPUTE_CONTRACT", "CONTRACT", contractId),
        ]);
      }
      const row = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=? AND buyer_organization_id=?", [contractId, buyerOrganizationId]);
      if (!row) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
      if (value(row, "status") !== "DISPUTED") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "争议状态未能确认。");
      return contract(row);
    },

    async requestDisputeResolution(contractId, input, context) {
      const replayed = await replay(db, context, "REQUEST_DISPUTE_RESOLUTION");
      let requestedProposalId = replayed?.entityId ?? null;
      if (!replayed) {
        if (input.resolution !== "REFUND" && input.resolution !== "SETTLE") throw new ExchangeInputError("争议方案无效。", "resolution");
        if (!Number.isSafeInteger(input.expectedContractVersion) || input.expectedContractVersion < 1) throw new ExchangeInputError("合同版本无效。", "expectedContractVersion");
        const requestReason = input.requestReason.trim();
        if (requestReason.length < 8 || requestReason.length > 500) throw new ExchangeInputError("裁决申请说明应为 8–500 个字符。", "requestReason");
        if (input.evidenceDigest && !/^[a-f0-9]{64}$/u.test(input.evidenceDigest)) throw new ExchangeInputError("证据仅接受 SHA-256 摘要。", "evidenceDigest");
        const current = await db.first<Row>(`SELECT c.*,x.contract_id dispute_id FROM hosting_v2_contracts c JOIN hosting_v2_disputes x ON x.contract_id=c.id WHERE c.id=?`, [contractId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "争议合同不存在。");
        if (value(current, "status") !== "DISPUTED") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不在争议处理中。");
        if (number(current, "version") !== input.expectedContractVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "合同状态已变化，请刷新后重试。");
        const pending = await db.first<Row>("SELECT id FROM hosting_v2_dispute_resolution_proposals WHERE contract_id=? AND status IN ('REQUESTED','APPROVED')", [contractId]);
        if (pending) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该争议已有待复核或待执行方案。");
        const previous = await db.first<Row>("SELECT COALESCE(MAX(proposal_version),0) version FROM hosting_v2_dispute_resolution_proposals WHERE contract_id=?", [contractId]);
        const proposalId = id("hdsp");
        requestedProposalId = proposalId;
        const proposalVersion = Number(previous?.version ?? 0) + 1;
        await db.batch([
          { sql: `INSERT INTO hosting_v2_dispute_resolution_proposals(id,contract_id,proposal_version,resolution,request_reason,evidence_digest,requested_by,status,requested_at)
              SELECT ?,id,?,?,?,?,?,'REQUESTED',? FROM hosting_v2_contracts WHERE id=? AND status='DISPUTED' AND version=?`,
            values: [proposalId, proposalVersion, input.resolution, requestReason, input.evidenceDigest ?? null, context.actorId, context.now, contractId, input.expectedContractVersion] },
          { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
          event(context, value(current, "buyer_organization_id"), "CONTRACT", contractId, "DISPUTE_RESOLUTION_REQUESTED", { proposalId, proposalVersion, resolution: input.resolution, requestReason, evidenceDigest: input.evidenceDigest ?? null }),
          receipt(context, "REQUEST_DISPUTE_RESOLUTION", "DISPUTE_PROPOSAL", proposalId),
        ]);
      }
      const row = await disputeCaseByProposal(db, requestedProposalId ?? "");
      if (!row) throw new Error("HOSTING_DISPUTE_PROPOSAL_CREATE_FAILED");
      return disputeCase(row);
    },

    async decideDisputeResolution(proposalId, input, context) {
      const replayed = await replay(db, context, "DECIDE_DISPUTE_RESOLUTION");
      if (!replayed) {
        if (input.decision !== "APPROVE" && input.decision !== "REJECT") throw new ExchangeInputError("裁决复核决定无效。", "decision");
        const decisionReason = input.decisionReason.trim();
        if (decisionReason.length < 8 || decisionReason.length > 500) throw new ExchangeInputError("复核说明应为 8–500 个字符。", "decisionReason");
        const current = await db.first<Row>("SELECT * FROM hosting_v2_dispute_resolution_proposals WHERE id=?", [proposalId]);
        if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "争议裁决申请不存在。");
        if (value(current, "status") !== "REQUESTED") {
          const expectedStatuses = input.decision === "APPROVE" ? ["APPROVED", "APPLIED"] : ["REJECTED"];
          if (expectedStatuses.includes(value(current, "status")) && nullable(current, "decided_by") === context.actorId
            && nullable(current, "decision_reason") === decisionReason && nullable(current, "decision_payload_hash") === context.payloadHash) {
            const existing = await disputeCaseByProposal(db, proposalId);
            if (!existing) throw new Error("HOSTING_DISPUTE_PROPOSAL_DECISION_MISSING");
            return disputeCase(existing);
          }
          throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该裁决申请已经处理。");
        }
        if (value(current, "requested_by") === context.actorId) throw new ExchangeDomainError("EXCHANGE_ROLE_FORBIDDEN", 403, "裁决申请人与复核人必须是两位不同管理员。");
        const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
        await db.batch([
          { sql: "UPDATE hosting_v2_dispute_resolution_proposals SET status=?,decided_by=?,decision_reason=?,decision_payload_hash=?,decided_at=? WHERE id=? AND status='REQUESTED' AND requested_by<>?", values: [nextStatus, context.actorId, decisionReason, context.payloadHash, context.now, proposalId, context.actorId] },
          { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
          event(context, null, "DISPUTE_PROPOSAL", proposalId, `DISPUTE_RESOLUTION_${nextStatus}`, { decisionReason }),
          receipt(context, "DECIDE_DISPUTE_RESOLUTION", "DISPUTE_PROPOSAL", proposalId),
        ]);
      }
      const row = await disputeCaseByProposal(db, replayed?.entityId ?? proposalId);
      if (!row) throw new Error("HOSTING_DISPUTE_PROPOSAL_DECISION_FAILED");
      return disputeCase(row);
    },

    async queueDisputeCleanup(proposalId, context) {
      const replayed = await replay(db, context, "QUEUE_DISPUTE_CLEANUP");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT c.* FROM hosting_v2_contracts c JOIN hosting_v2_dispute_resolution_proposals p ON p.contract_id=c.id WHERE p.id=?", [proposalId]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [replayed.entityId])]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "争议清理任务不存在。");
        return { contract: contract(contractRow), command: command(commandRow) };
      }
      const current = await db.first<Row>(`SELECT c.*,p.resolution,p.status proposal_status FROM hosting_v2_contracts c JOIN hosting_v2_dispute_resolution_proposals p ON p.contract_id=c.id WHERE p.id=?`, [proposalId]);
      if (!current || value(current, "proposal_status") !== "APPLIED" || !["SETTLED", "REFUNDED"].includes(value(current, "status"))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "争议资金裁决尚未执行完成。");
      const commandId = id("hcmd");
      await db.batch([
        { sql: `UPDATE hosting_v2_contracts SET status='CLEANING',version=version+1,updated_at=? WHERE id=? AND status IN ('SETTLED','REFUNDED') AND EXISTS(SELECT 1 FROM hosting_v2_dispute_resolution_proposals WHERE id=? AND status='APPLIED')`, values: [context.now, value(current, "id"), proposalId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'CLEANUP',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), value(current, "id"), JSON.stringify({ contractId: value(current, "id"), removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true }), context.now] },
        event(context, value(current, "supplier_organization_id"), "CONTRACT", value(current, "id"), "DISPUTE_CLEANUP_QUEUED", { proposalId, resolution: value(current, "resolution") }),
        receipt(context, "QUEUE_DISPUTE_CLEANUP", "AGENT_COMMAND", commandId),
      ]);
      const [contractRow, commandRow] = await Promise.all([db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [value(current, "id")]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId])]);
      if (!contractRow || !commandRow) throw new Error("HOSTING_DISPUTE_CLEANUP_QUEUE_FAILED");
      return { contract: contract(contractRow), command: command(commandRow) };
    },

    async retryCleanup(contractId, input, context) {
      const replayed = await replay(db, context, "RETRY_CLEANUP");
      if (replayed) {
        const commandRow = await db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=? AND contract_id=?", [replayed.entityId, contractId]);
        if (!commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "清理恢复任务不存在。");
        const [contractRow, deviceRow] = await Promise.all([
          db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
          db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [value(commandRow, "device_id")]),
        ]);
        if (!contractRow || !deviceRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "清理恢复对象不存在。");
        return { contract: contract(contractRow), device: device(deviceRow), command: command(commandRow) };
      }
      const reason = input.reason.trim();
      if (reason.length < 8 || reason.length > 500) throw new ExchangeInputError("清理重试理由应为 8–500 个字符。", "reason");
      if (!Number.isSafeInteger(input.expectedContractVersion) || input.expectedContractVersion < 1 || !Number.isSafeInteger(input.expectedDeviceVersion) || input.expectedDeviceVersion < 1) {
        throw new ExchangeInputError("清理重试版本无效。", "expectedVersion");
      }
      const contractRow = await db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]);
      if (!contractRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "清理中的合同不存在。");
      const deviceId = value(contractRow, "device_id");
      const [deviceRow, offerRow, previousCleanup] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]),
        db.first<Row>("SELECT * FROM hosting_v2_offers WHERE id=?", [value(contractRow, "offer_id")]),
        db.first<Row>(`SELECT * FROM hosting_v2_agent_commands WHERE contract_id=? AND command_type='CLEANUP' AND status='FAILED'
          ORDER BY COALESCE(completed_at,created_at) DESC,created_at DESC LIMIT 1`, [contractId]),
      ]);
      if (!deviceRow || !offerRow || value(contractRow, "status") !== "CLEANING" || value(deviceRow, "status") !== "DRAINING" || value(offerRow, "status") !== "SUSPENDED" || !previousCleanup) {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "只有保持隔离且已有失败证据的清理任务可以重试。");
      }
      if (number(contractRow, "version") !== input.expectedContractVersion || number(deviceRow, "version") !== input.expectedDeviceVersion) {
        throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "合同或设备状态已变化，请刷新后重试。");
      }
      const commandId = id("hcmd");
      const payload = JSON.stringify({ contractId, removeAuthorizedKeys: true, removeContainer: true, removeWorkspace: true });
      const eventId = id("hve");
      const previousCommandId = value(previousCleanup, "id");
      const results = await db.batch([
        { sql: `INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at)
            SELECT ?,d.id,c.id,'CLEANUP',?,'PENDING',0,?
            FROM hosting_v2_contracts c JOIN hosting_v2_devices d ON d.id=c.device_id
            WHERE c.id=? AND c.status='CLEANING' AND c.version=? AND d.status='DRAINING' AND d.version=?
              AND EXISTS(SELECT 1 FROM hosting_v2_offers o WHERE o.id=c.offer_id AND o.status='SUSPENDED')
              AND EXISTS(SELECT 1 FROM hosting_v2_agent_commands f WHERE f.id=? AND f.contract_id=c.id AND f.command_type='CLEANUP' AND f.status='FAILED')
              AND NOT EXISTS(SELECT 1 FROM hosting_v2_agent_commands a WHERE a.contract_id=c.id AND a.command_type='CLEANUP' AND a.status IN ('PENDING','DELIVERED','SUCCEEDED'))`,
          values: [commandId, payload, context.now, contractId, input.expectedContractVersion, input.expectedDeviceVersion, previousCommandId] },
        { sql: `INSERT INTO hosting_v2_events(id,organization_id,entity_type,entity_id,event_type,actor_id,payload_digest,metadata_json,occurred_at)
            SELECT ?,?,'CONTRACT',?,'CLEANUP_RETRY_QUEUED',?,?,?,? WHERE EXISTS(SELECT 1 FROM hosting_v2_agent_commands WHERE id=?)`,
          values: [eventId, value(contractRow, "supplier_organization_id"), contractId, context.actorId, context.payloadHash, JSON.stringify({ commandId, previousCommandId, reason }), context.now, commandId] },
        { sql: `INSERT INTO hosting_v2_command_receipts(actor_id,idempotency_key,command_type,payload_hash,entity_type,entity_id,created_at)
            SELECT ?,?,'RETRY_CLEANUP',?,'AGENT_COMMAND',?,? WHERE EXISTS(SELECT 1 FROM hosting_v2_agent_commands WHERE id=?)`,
          values: [context.actorId, context.idempotencyKey, context.payloadHash, commandId, context.now, commandId] },
      ]);
      if (results[0]?.changes !== 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "清理任务已被其他管理员恢复，请刷新状态。");
      const [finalContract, finalDevice, finalCommand] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
        db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [deviceId]),
        db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]),
      ]);
      if (!finalContract || !finalDevice || !finalCommand) throw new Error("HOSTING_CLEANUP_RETRY_QUEUE_FAILED");
      return { contract: contract(finalContract), device: device(finalDevice), command: command(finalCommand) };
    },

    async retryFailedStop(contractId, input, context) {
      const replayed = await replay(db, context, "RETRY_FAILED_STOP");
      if (replayed) {
        const [contractRow, commandRow] = await Promise.all([
          db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]),
          db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=? AND contract_id=?", [replayed.entityId, contractId]),
        ]);
        if (!contractRow || !commandRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "停机恢复任务不存在。");
        const deviceRow = await db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [value(contractRow, "device_id")]);
        if (!deviceRow) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "停机恢复设备不存在。");
        return { contract: contract(contractRow), device: device(deviceRow), command: command(commandRow) };
      }
      const reason = input.reason.trim();
      if (reason.length < 8 || reason.length > 500) throw new ExchangeInputError("停机恢复理由应为 8–500 个字符。", "reason");
      if (!Number.isSafeInteger(input.expectedContractVersion) || input.expectedContractVersion < 1 || !Number.isSafeInteger(input.expectedDeviceVersion) || input.expectedDeviceVersion < 1) throw new ExchangeInputError("停机恢复版本无效。", "expectedVersion");
      const current = await db.first<Row>(`SELECT c.*,d.version device_version,d.status device_status,o.status offer_status,
          f.command_id failed_command_id,f.status failure_status,f.retry_sequence
        FROM hosting_v2_contracts c JOIN hosting_v2_devices d ON d.id=c.device_id JOIN hosting_v2_offers o ON o.id=c.offer_id
        JOIN hosting_v2_stop_failures f ON f.command_id=(SELECT latest.command_id FROM hosting_v2_stop_failures latest WHERE latest.contract_id=c.id ORDER BY latest.retry_sequence DESC LIMIT 1)
        WHERE c.id=?`, [contractId]);
      if (!current || value(current, "status") !== "FAILED" || value(current, "device_status") !== "DRAINING" || value(current, "offer_status") !== "SUSPENDED" || value(current, "failure_status") !== "EXHAUSTED") {
        throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "只有自动停机恢复耗尽且持续隔离的合同可以人工重试。");
      }
      if (number(current, "version") !== input.expectedContractVersion || number(current, "device_version") !== input.expectedDeviceVersion) throw new ExchangeDomainError("EXCHANGE_VERSION_CONFLICT", 409, "合同或设备状态已变化，请刷新后重试。");
      const commandId = id("hcmd");
      const failedCommandId = value(current, "failed_command_id");
      const payload = JSON.stringify({ contractId, startedAt: nullable(current, "started_at"), maximumSeconds: number(current, "reserved_seconds") });
      const results = await db.batch([
        { sql: "UPDATE hosting_v2_stop_failures SET status='RETRYING',recovery_command_id=?,recovery_queued_at=?,resolved_at=NULL WHERE command_id=? AND status='EXHAUSTED'", values: [commandId, context.now, failedCommandId] },
        { sql: "SELECT CASE WHEN changes()=1 THEN 1 ELSE abs(-9223372036854775808) END" },
        { sql: "INSERT INTO hosting_v2_agent_commands(id,device_id,contract_id,command_type,payload_json,status,attempt,created_at) VALUES(?,?,?,'STOP',?,'PENDING',0,?)", values: [commandId, value(current, "device_id"), contractId, payload, context.now] },
        event(context, value(current, "supplier_organization_id"), "CONTRACT", contractId, "STOP_MANUAL_RECOVERY_QUEUED", { commandId, failedCommandId, previousAttempts: number(current, "retry_sequence"), reason }),
        receipt(context, "RETRY_FAILED_STOP", "AGENT_COMMAND", commandId),
      ]);
      if (results[0]?.changes !== 1 || results[2]?.changes !== 1) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "停机恢复任务已由其他管理员安排。");
      const [contractRow, deviceRow, commandRow] = await Promise.all([
        db.first<Row>("SELECT * FROM hosting_v2_contracts WHERE id=?", [contractId]), db.first<Row>("SELECT * FROM hosting_v2_devices WHERE id=?", [value(current, "device_id")]), db.first<Row>("SELECT * FROM hosting_v2_agent_commands WHERE id=?", [commandId]),
      ]);
      if (!contractRow || !deviceRow || !commandRow) throw new Error("HOSTING_STOP_MANUAL_RECOVERY_QUEUE_FAILED");
      return { contract: contract(contractRow), device: device(deviceRow), command: command(commandRow) };
    },
  };
}
