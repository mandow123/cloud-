import type { AlipayReadiness } from "./alipay-live.ts";
import { hostingV2ApprovedImages, hostingV2CurrentTermsVersion } from "./hosting-v2-image-policy.ts";
import type { HostingV2OperationalSnapshot } from "./hosting-v2-store.ts";

type StorageCheck = Readonly<{ ready: boolean; errorCode?: string }>;
type CapabilityCheck = Readonly<{ ready: boolean; failClosed: true; reason?: string }>;

export type HostingV2CapabilityReadiness = Readonly<{
  enabled: boolean;
  ready: boolean;
  failClosed: true;
  rolloutMode: "DISABLED" | "INTERNAL_AGENT_TRIAL";
  fundingMode: "ADMIN_DUAL_CONTROL_TRIAL_GRANTS";
  checks: Readonly<{
    storage: CapabilityCheck;
    supplierIdentity: CapabilityCheck;
    trialGrantRequest: CapabilityCheck;
    trialGrantApproval: CapabilityCheck;
    agentDelivery: CapabilityCheck;
    feeSchedule: CapabilityCheck;
    cardHourLedger: CapabilityCheck;
    approvedImages: CapabilityCheck & Readonly<{ count: number }>;
    supplierTerms: CapabilityCheck;
    metering: CapabilityCheck;
    cleanup: CapabilityCheck;
    alipayClosed: CapabilityCheck;
  }>;
  operations: Readonly<{
    schemaVersion: number;
    integrity: "ok";
    activeFeeScheduleConfigured: boolean;
    approvedSupplierCount: number;
    activeAgentCount: number;
    drainingDeviceCount: number;
    failedCleanupCount: number;
    cleaningContractCount: number;
  }> | null;
}>;

const check = (ready: boolean, reason?: string): CapabilityCheck => ({
  ready,
  failClosed: true,
  ...(ready || !reason ? {} : { reason }),
});

export function evaluateHostingV2Capability(input: {
  environment: Record<string, string | undefined>;
  hostingStorage: StorageCheck;
  cardHourStorage: StorageCheck;
  operations: HostingV2OperationalSnapshot | null;
  kaiIdentityAvailable: boolean;
  adminPasswordAvailable: boolean;
  financeApprovalAvailable: boolean;
  alipay: AlipayReadiness;
}): HostingV2CapabilityReadiness {
  const enabled = ["1", "true"].includes((input.environment.KAI_HOSTING_V2 ?? "").trim().toLowerCase());
  let approvedImageCount = 0;
  let imagesReady = false;
  let termsReady = false;
  try {
    approvedImageCount = hostingV2ApprovedImages(input.environment).size;
    imagesReady = approvedImageCount > 0;
  } catch { /* The public capability stays closed below. */ }
  try {
    hostingV2CurrentTermsVersion(input.environment);
    termsReady = true;
  } catch { /* The public capability stays closed below. */ }

  const operations = input.operations;
  const hostingStorageReady = input.hostingStorage.ready && operations !== null;
  const cardHourStorageReady = input.cardHourStorage.ready;
  const supplierIdentityReady = input.kaiIdentityAvailable && (operations?.approvedSupplierCount ?? 0) > 0;
  const agentReady = (operations?.activeAgentCount ?? 0) > 0;
  const feeReady = Boolean(operations?.activeFeeScheduleId);
  const cleanupReady = hostingStorageReady
    && (operations?.drainingDeviceCount ?? 0) === 0
    && (operations?.failedCleanupCount ?? 0) === 0;
  const alipayClosed = !input.alipay.enabled && !input.alipay.canCreatePayment;
  const checks = {
    storage: check(hostingStorageReady, input.hostingStorage.errorCode ?? "HOSTING_V2_STORAGE_NOT_READY"),
    supplierIdentity: check(supplierIdentityReady, input.kaiIdentityAvailable ? "HOSTING_APPROVED_SUPPLIER_MISSING" : "KAI_IDENTITY_NOT_READY"),
    trialGrantRequest: check(input.adminPasswordAvailable, "HOSTING_ROOT_ADMIN_NOT_READY"),
    trialGrantApproval: check(input.financeApprovalAvailable, "HOSTING_FINANCE_APPROVER_NOT_READY"),
    agentDelivery: check(agentReady, "HOSTING_ACTIVE_AGENT_MISSING"),
    feeSchedule: check(feeReady, "HOSTING_ACTIVE_FEE_MISSING"),
    cardHourLedger: check(cardHourStorageReady, input.cardHourStorage.errorCode ?? "CARD_HOUR_STORAGE_NOT_READY"),
    approvedImages: { ...check(imagesReady, "HOSTING_APPROVED_IMAGE_POLICY_MISSING"), count: approvedImageCount },
    supplierTerms: check(termsReady, "HOSTING_TERMS_POLICY_MISSING"),
    metering: check(hostingStorageReady && cardHourStorageReady && agentReady, "HOSTING_METERING_NOT_READY"),
    cleanup: check(cleanupReady, "HOSTING_CLEANUP_NOT_READY"),
    alipayClosed: check(alipayClosed, "ALIPAY_MUST_REMAIN_DISABLED_DURING_TRIAL"),
  } as const;
  const ready = !enabled || Object.values(checks).every((item) => item.ready);
  const publicOperations = operations ? {
    schemaVersion: operations.schemaVersion,
    integrity: operations.integrity,
    activeFeeScheduleConfigured: Boolean(operations.activeFeeScheduleId),
    approvedSupplierCount: operations.approvedSupplierCount,
    activeAgentCount: operations.activeAgentCount,
    drainingDeviceCount: operations.drainingDeviceCount,
    failedCleanupCount: operations.failedCleanupCount,
    cleaningContractCount: operations.cleaningContractCount,
  } as const : null;
  return {
    enabled,
    ready,
    failClosed: true,
    rolloutMode: enabled ? "INTERNAL_AGENT_TRIAL" : "DISABLED",
    fundingMode: "ADMIN_DUAL_CONTROL_TRIAL_GRANTS",
    checks,
    operations: publicOperations,
  };
}
