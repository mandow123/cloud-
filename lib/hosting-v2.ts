export const HOSTING_V2_MIN_RENTAL_SECONDS = 180;
export const HOSTING_V2_AGENT_STALE_SECONDS = 90;
export const HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS = 30 * 60;
export const HOSTING_V2_CARD_HOUR_MICROS = 1_000_000;
export const HOSTING_FEE_QUALIFICATION_MODEL = "LIFETIME_SUPPLIER_SETTLED_GROSS_V1" as const;
export const HOSTING_FEE_LEGACY_QUALIFICATION_MODEL = "PREVIOUS_CALENDAR_MONTH_SUPPLIER_SETTLED_GROSS_V1" as const;
export const HOSTING_FEE_QUALIFICATION_TIME_ZONE = "Asia/Shanghai" as const;

export type HostingFeeTier = Readonly<{
  code: string;
  minimumQualifyingMicros: number;
  platformFeeBps: number;
  referralRewardBps: number;
}>;

export type HostingFeeQualificationPeriod = Readonly<{
  key: string;
  startAt: string;
  endAt: string;
  timeZone: typeof HOSTING_FEE_QUALIFICATION_TIME_ZONE;
}>;

type HostingFeeQualificationSnapshotBase = Readonly<{
  tierCode: string;
  qualifyingVolumeMicros: number;
  platformFeeBps: number;
  referralRewardBps: number;
}>;

export type HostingFeeQualificationSnapshot =
  | (HostingFeeQualificationSnapshotBase & Readonly<{
    model: typeof HOSTING_FEE_QUALIFICATION_MODEL;
    asOf: string;
  }>)
  | (HostingFeeQualificationSnapshotBase & Readonly<{
    model: typeof HOSTING_FEE_LEGACY_QUALIFICATION_MODEL;
    period: HostingFeeQualificationPeriod;
  }>);

export type HostingSupplierFeePreview = Readonly<{
  activeFeeScheduleId: string | null;
  model: typeof HOSTING_FEE_QUALIFICATION_MODEL;
  tierCode: string | null;
  asOf: string;
  qualifyingVolumeMicros: number;
  platformFeeBps: number | null;
  referralRewardBps: number | null;
  tiers: readonly HostingFeeTier[];
  nextTierCode: string | null;
  nextTierMinimumMicros: number | null;
  remainingToNextTierMicros: number | null;
}>;

export type HostingSupplierMonthlySettlement = Readonly<{
  period: HostingFeeQualificationPeriod;
  grossMicros: number;
  platformFeeMicros: number;
  supplierIncomeMicros: number;
  inFeeReferralCommissionMicros: number;
  platformNetMicros: number;
}>;

const HOSTING_DEFAULT_PLATFORM_FEE_TIERS = [
  { code: "STARTER", minimumQualifyingMicros: 0, platformFeeBps: 100 },
  { code: "GROWTH", minimumQualifyingMicros: 10_000 * HOSTING_V2_CARD_HOUR_MICROS, platformFeeBps: 80 },
  { code: "SCALE", minimumQualifyingMicros: 50_000 * HOSTING_V2_CARD_HOUR_MICROS, platformFeeBps: 60 },
  { code: "VOLUME", minimumQualifyingMicros: 200_000 * HOSTING_V2_CARD_HOUR_MICROS, platformFeeBps: 40 },
  { code: "STRATEGIC", minimumQualifyingMicros: 1_000_000 * HOSTING_V2_CARD_HOUR_MICROS, platformFeeBps: 20 },
] as const;

export const HOSTING_SUPPLIER_TYPES = ["INDIVIDUAL", "COMPANY", "IDC", "CLOUD_VENDOR"] as const;
export type HostingSupplierType = (typeof HOSTING_SUPPLIER_TYPES)[number];

export const HOSTING_GPU_MODELS = ["RTX_4090", "H100_80GB", "H100_94GB"] as const;
export type HostingGpuModel = (typeof HOSTING_GPU_MODELS)[number];

export type HostingSupplierProfile = Readonly<{
  organizationId: string;
  accountId: string;
  supplierType: HostingSupplierType;
  legalDisplayName: string;
  contactEmail: string;
  agreementVersion: string | null;
  evidenceDigest: string | null;
  reviewNote: string | null;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "SUSPENDED";
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export function isHostingSupplierProfileReady(profile: HostingSupplierProfile | null | undefined) {
  return Boolean(
    profile?.status === "APPROVED"
    && profile.agreementVersion
    && profile.evidenceDigest,
  );
}

export type HostingAgentChallenge = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  nonce: string;
  minimumAgentVersion: string;
  expiresAt: string;
  consumedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}>;

export type HostingAgentRegistration = Readonly<{
  challenge: HostingAgentChallenge;
  device: HostingDevice | null;
}>;

export type HostingDeviceInventory = Readonly<{
  hostnameDigest: string;
  gpuModel: HostingGpuModel;
  gpuUuidDigest: string;
  gpuMemoryMiB: number;
  driverVersion: string;
  cudaVersion: string;
  cpuModel: string;
  memoryMiB: number;
  storageGiB: number;
  publicHost: string;
  sshPortStart: number;
  sshPortEnd: number;
}>;

export type HostingDevice = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  displayName: string;
  deviceKeyId: string;
  devicePublicKey: string;
  agentVersion: string;
  inventory: HostingDeviceInventory;
  inventoryDigest: string;
  status: "ONLINE" | "VERIFYING" | "VERIFIED" | "BUSY" | "DRAINING" | "OFFLINE" | "REVOKED";
  verificationStatus: "NOT_RUN" | "PENDING" | "PASSED" | "FAILED" | "EXPIRED";
  verificationEvidenceDigest: string | null;
  verifiedUntil: string | null;
  lastSequence: number;
  lastSeenAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type HostingDeviceRetirement = Readonly<{
  id: string;
  deviceId: string;
  organizationId: string;
  mode: "GRACEFUL" | "EMERGENCY";
  status: "DRAINING" | "MANUAL_ACTION_REQUIRED" | "FINALIZED";
  reasonCode: string;
  reason: string;
  evidenceDigest: string | null;
  requestedBy: string;
  requestedAt: string;
  finalizedBy: string | null;
  finalizedAt: string | null;
  version: number;
}>;

export type HostingFeeSchedule = Readonly<{
  id: string;
  platformFeeBps: number;
  referralRewardBps: number;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}>;

export type HostingOffer = Readonly<{
  id: string;
  organizationId: string;
  deviceId: string;
  feeScheduleId: string;
  title: string;
  gpuModel: HostingGpuModel;
  region: string;
  cardHourMicrosPerGpuHour: number;
  minRentalSeconds: number;
  maxRentalSeconds: number;
  availableFrom: string;
  availableUntil: string;
  approvedImage: string;
  termsVersion: string;
  status: "DRAFT" | "PUBLISHED" | "RESERVED" | "PAUSED" | "UNLISTED" | "SUSPENDED";
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type HostingPublicOffer = HostingOffer & Readonly<{
  verificationSummary: Readonly<{
    status: "PASSED";
    checks: readonly ["GPU_IDENTITY", "WORKLOAD_IMAGE", "PORT_REACHABILITY"];
  }>;
  verifiedUntil: string;
}>;

export type HostingContractStatus =
  | "RESERVED"
  | "CARD_HOURS_HELD"
  | "PAID"
  | "PROVISIONING"
  | "READY"
  | "IN_SERVICE"
  | "AWAITING_ACCEPTANCE"
  | "SETTLED"
  | "CLEANING"
  | "CLEANED"
  | "CANCELLED"
  | "FAILED"
  | "DISPUTED"
  | "REFUNDED";

export type HostingContract = Readonly<{
  id: string;
  offerId: string;
  deviceId: string;
  buyerOrganizationId: string;
  buyerAccountId: string;
  supplierOrganizationId: string;
  feeScheduleId: string;
  snapshot: Readonly<{
    offerVersion: number;
    title: string;
    gpuModel: HostingGpuModel;
    region: string;
    cardHourMicrosPerGpuHour: number;
    approvedImage: string;
    termsVersion: string;
    platformFeeBps: number;
    referralRewardBps: number;
    feeQualification: HostingFeeQualificationSnapshot | null;
    acceptanceWindowSeconds: number;
  }>;
  reservedSeconds: number;
  measuredSeconds: number | null;
  heldMicros: number;
  settledMicros: number | null;
  supplierIncomeMicros: number | null;
  commissionMicros: number | null;
  status: HostingContractStatus;
  sshPublicKeyFingerprint: string | null;
  endpointDisplay: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  acceptedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type HostingContractEvidence = Readonly<{
  instance: Readonly<{
    status: "READY" | "RUNNING" | "STOPPED" | "CLEANED" | "FAILED";
    containerDigest: string;
    workspaceDigest: string;
    provisionEvidenceDigest: string;
    startEvidenceDigest: string | null;
    stopEvidenceDigest: string | null;
    provisionedAt: string;
    startedAt: string | null;
    stoppedAt: string | null;
    cleanedAt: string | null;
  }> | null;
  metering: Readonly<{
    runtimeStateDigest: string;
    agentStartedAt: string;
    agentStoppedAt: string;
    agentRuntimeSeconds: number;
    serverMeasuredSeconds: number;
    evidenceDigest: string;
    recordedAt: string;
  }> | null;
  cleanup: Readonly<{
    cleanupDigest: string;
    containerRemoved: true;
    authorizedKeyRemoved: true;
    workspaceRemoved: true;
    evidenceDigest: string;
    cleanedAt: string;
    recordedAt: string;
  }> | null;
  acceptance: Readonly<{
    mode: "BUYER" | "TIMEOUT";
    acceptanceWindowSeconds: number;
    deadlineAt: string;
    decidedAt: string;
  }> | null;
  dispute: Readonly<{
    reason: string;
    openedAt: string;
    proposalId: string | null;
    proposalVersion: number | null;
    proposedResolution: "REFUND" | "SETTLE" | null;
    proposalStatus: "REQUESTED" | "APPROVED" | "REJECTED" | "APPLIED" | null;
    requestedAt: string | null;
    decidedAt: string | null;
  }> | null;
  deliveryFailure: Readonly<{
    commandId: string;
    stage: "PROVISION" | "START";
    errorCode: string;
    evidenceDigest: string;
    failedAt: string;
  }> | null;
  stopFailure: Readonly<{
    commandId: string;
    errorCode: string;
    evidenceDigest: string;
    retrySequence: number;
    status: "RECORDED" | "RETRYING" | "RETRY_FAILED" | "RECOVERED" | "EXHAUSTED";
    recoveryCommandId: string | null;
    failedAt: string;
  }> | null;
  runtimeControl: Readonly<{
    agentLastSeenAt: string | null;
    stopCommandId: string | null;
    stopCommandStatus: "PENDING" | "DELIVERED" | "SUCCEEDED" | "FAILED" | null;
    stopAttempt: number;
    stopRequestedAt: string | null;
    stopDeliveredAt: string | null;
  }>;
}>;

export type HostingDisputeCase = Readonly<{
  contractId: string;
  contractVersion: number;
  contractStatus: HostingContractStatus;
  buyerOrganizationId: string;
  supplierOrganizationId: string;
  deviceId: string;
  deviceDisplayName: string;
  offerId: string;
  offerTitle: string;
  measuredSeconds: number;
  heldMicros: number;
  reason: string;
  openedAt: string;
  proposalId: string | null;
  proposalVersion: number | null;
  proposedResolution: "REFUND" | "SETTLE" | null;
  proposalStatus: "REQUESTED" | "APPROVED" | "REJECTED" | "APPLIED" | null;
  requestReason: string | null;
  evidenceDigest: string | null;
  requestedBy: string | null;
  requestedAt: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}>;

export type HostingAgentCommand = Readonly<{
  id: string;
  deviceId: string;
  contractId: string | null;
  type: "VERIFY" | "PROVISION" | "START" | "STOP" | "CLEANUP";
  payload: Readonly<Record<string, unknown>>;
  status: "PENDING" | "DELIVERED" | "SUCCEEDED" | "FAILED";
  attempt: number;
  evidenceDigest: string | null;
  errorCode: string | null;
  createdAt: string;
  deliveredAt: string | null;
  completedAt: string | null;
}>;

export type HostingCleanupIncident = Readonly<{
  contractId: string;
  contractVersion: number;
  contractStatus: "CLEANING";
  supplierOrganizationId: string;
  deviceId: string;
  deviceDisplayName: string;
  deviceStatus: "DRAINING";
  deviceVersion: number;
  deviceLastSeenAt: string | null;
  offerId: string;
  offerStatus: HostingOffer["status"];
  cleanupCommandId: string;
  cleanupCommandStatus: "PENDING" | "DELIVERED" | "FAILED";
  cleanupAttempt: number;
  evidenceDigest: string | null;
  errorCode: string | null;
  failedAt: string | null;
  updatedAt: string;
}>;

export type HostingStopIncident = Readonly<{
  contractId: string;
  contractVersion: number;
  supplierOrganizationId: string;
  deviceId: string;
  deviceDisplayName: string;
  deviceVersion: number;
  deviceLastSeenAt: string | null;
  offerId: string;
  offerStatus: HostingOffer["status"];
  failedCommandId: string;
  retrySequence: number;
  failureStatus: "RECORDED" | "RETRYING" | "RETRY_FAILED" | "EXHAUSTED";
  errorCode: string;
  evidenceDigest: string;
  recoveryCommandId: string | null;
  failedAt: string;
}>;

export type HostingGoldenLoopAuditCheck = Readonly<{
  key: string;
  label: string;
  status: "PASS" | "FAIL";
  detail: string;
}>;

export type HostingGoldenLoopAudit = Readonly<{
  contractId: string;
  verdict: "PASS" | "FAIL";
  checkedAt: string;
  passedChecks: number;
  totalChecks: number;
  facts: Readonly<{
    gpuModel: HostingGpuModel;
    deviceId: string;
    deviceStatus: HostingDevice["status"];
    offerStatus: HostingOffer["status"];
    agentVersion: string;
    measuredSeconds: number | null;
    heldMicros: number;
    settledMicros: number | null;
    supplierIncomeMicros: number | null;
    commissionMicros: number | null;
    approvedImage: string;
  }>;
  checks: readonly HostingGoldenLoopAuditCheck[];
}>;

export type HostingDashboard = Readonly<{
  profile: HostingSupplierProfile | null;
  devices: readonly HostingDevice[];
  offers: readonly HostingOffer[];
  contracts: readonly HostingContract[];
  earnings: Readonly<{
    pendingMicros: number;
    vestedMicros: number;
    commissionPendingMicros: number;
    commissionVestedMicros: number;
  }>;
  readiness: Readonly<{
    supplierApproved: boolean;
    onlineVerifiedDevices: number;
    activeFeeSchedule: boolean;
    cardHourSettlement: boolean;
    alipayPublicTopup: boolean;
    buyback: boolean;
  }>;
}>;

export function hostingCardHourMicrosForSeconds(rateMicrosPerGpuHour: number, seconds: number) {
  if (!Number.isSafeInteger(rateMicrosPerGpuHour) || rateMicrosPerGpuHour < 1) throw new Error("HOSTING_RATE_INVALID");
  if (!Number.isSafeInteger(seconds) || seconds < HOSTING_V2_MIN_RENTAL_SECONDS) throw new Error("HOSTING_DURATION_INVALID");
  const result = Number((BigInt(rateMicrosPerGpuHour) * BigInt(seconds) + 3_599n) / 3_600n);
  if (!Number.isSafeInteger(result)) throw new Error("HOSTING_AMOUNT_INVALID");
  return result;
}

export function hostingFeeRatesAreValid(platformFeeBps: number, referralRewardBps: number) {
  return Number.isInteger(platformFeeBps)
    && platformFeeBps >= 0
    && platformFeeBps <= 5_000
    && Number.isInteger(referralRewardBps)
    && referralRewardBps >= 0
    && referralRewardBps <= platformFeeBps;
}

export function hostingDefaultFeeTiers(schedulePlatformFeeBps: number, scheduleReferralRewardBps: number): readonly HostingFeeTier[] {
  if (!hostingFeeRatesAreValid(schedulePlatformFeeBps, scheduleReferralRewardBps)) throw new Error("HOSTING_FEE_RATES_INVALID");
  return HOSTING_DEFAULT_PLATFORM_FEE_TIERS.map((tier) => ({
    ...tier,
    referralRewardBps: schedulePlatformFeeBps === 0
      ? 0
      : Math.floor(tier.platformFeeBps * scheduleReferralRewardBps / schedulePlatformFeeBps),
  }));
}

function hostingShanghaiCalendarMonth(now: string | Date, monthOffset: number): HostingFeeQualificationPeriod {
  const timestamp = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(timestamp)) throw new Error("HOSTING_FEE_QUALIFICATION_TIME_INVALID");
  const offsetMs = 8 * 60 * 60 * 1_000;
  const local = new Date(timestamp + offsetMs);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const startAt = new Date(Date.UTC(year, month + monthOffset, 1) - offsetMs);
  const endAt = new Date(Date.UTC(year, month + monthOffset + 1, 1) - offsetMs);
  const periodLocal = new Date(startAt.getTime() + offsetMs);
  return Object.freeze({
    key: `${periodLocal.getUTCFullYear()}-${String(periodLocal.getUTCMonth() + 1).padStart(2, "0")}`,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    timeZone: HOSTING_FEE_QUALIFICATION_TIME_ZONE,
  });
}

export function hostingPreviousCalendarMonth(now: string | Date): HostingFeeQualificationPeriod {
  return hostingShanghaiCalendarMonth(now, -1);
}

export function hostingCurrentCalendarMonth(now: string | Date): HostingFeeQualificationPeriod {
  return hostingShanghaiCalendarMonth(now, 0);
}

export function hostingSelectFeeTier(tiers: readonly HostingFeeTier[], qualifyingVolumeMicros: number): HostingFeeTier {
  if (!Number.isSafeInteger(qualifyingVolumeMicros) || qualifyingVolumeMicros < 0) throw new Error("HOSTING_FEE_QUALIFYING_VOLUME_INVALID");
  const ordered = [...tiers].sort((left, right) => left.minimumQualifyingMicros - right.minimumQualifyingMicros);
  if (!ordered.length || ordered[0].minimumQualifyingMicros !== 0) throw new Error("HOSTING_FEE_TIERS_INVALID");
  const codes = new Set<string>();
  for (let index = 0; index < ordered.length; index += 1) {
    const tier = ordered[index];
    const previous = ordered[index - 1];
    if (!/^[A-Z][A-Z0-9_]{1,31}$/u.test(tier.code) || codes.has(tier.code)
      || !Number.isSafeInteger(tier.minimumQualifyingMicros) || tier.minimumQualifyingMicros < 0
      || !Number.isInteger(tier.platformFeeBps) || tier.platformFeeBps < 20 || tier.platformFeeBps > 100
      || !hostingFeeRatesAreValid(tier.platformFeeBps, tier.referralRewardBps)
      || (previous && (tier.minimumQualifyingMicros <= previous.minimumQualifyingMicros || tier.platformFeeBps >= previous.platformFeeBps))) {
      throw new Error("HOSTING_FEE_TIERS_INVALID");
    }
    codes.add(tier.code);
  }
  return ordered.reduce((selected, tier) => tier.minimumQualifyingMicros <= qualifyingVolumeMicros ? tier : selected, ordered[0]);
}

export function hostingFeeBreakdown(grossMicros: number, platformFeeBps: number, referralRewardBps: number, referralApplied: boolean) {
  if (!Number.isSafeInteger(grossMicros) || grossMicros < 0) throw new Error("HOSTING_GROSS_AMOUNT_INVALID");
  if (!hostingFeeRatesAreValid(platformFeeBps, referralRewardBps)) throw new Error("HOSTING_FEE_RATES_INVALID");
  const gross = BigInt(grossMicros);
  const platformFeeMicros = Number(gross * BigInt(platformFeeBps) / 10_000n);
  const commissionMicros = referralApplied ? Number(gross * BigInt(referralRewardBps) / 10_000n) : 0;
  const supplierIncomeMicros = grossMicros - platformFeeMicros;
  const platformNetMicros = platformFeeMicros - commissionMicros;
  if (supplierIncomeMicros < 0 || commissionMicros < 0 || platformNetMicros < 0
    || grossMicros !== supplierIncomeMicros + commissionMicros + platformNetMicros) {
    throw new Error("HOSTING_FEE_BREAKDOWN_INVALID");
  }
  return Object.freeze({
    grossMicros,
    supplierIncomeMicros,
    platformFeeMicros,
    commissionMicros,
    platformNetMicros,
  });
}

export function hostingActualFeeBreakdown(grossMicros: number, supplierIncomeMicros: number, inFeeReferralCommissionMicros: number) {
  if (![grossMicros, supplierIncomeMicros, inFeeReferralCommissionMicros].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("HOSTING_ACTUAL_FEE_AMOUNTS_INVALID");
  }
  const platformFeeMicros = grossMicros - supplierIncomeMicros;
  const platformNetMicros = platformFeeMicros - inFeeReferralCommissionMicros;
  if (platformFeeMicros < 0 || platformNetMicros < 0 || inFeeReferralCommissionMicros > platformFeeMicros
    || grossMicros !== supplierIncomeMicros + inFeeReferralCommissionMicros + platformNetMicros) {
    throw new Error("HOSTING_ACTUAL_FEE_AMOUNTS_INVALID");
  }
  return Object.freeze({ grossMicros, platformFeeMicros, supplierIncomeMicros, inFeeReferralCommissionMicros, platformNetMicros });
}

export function hostingCnyReferenceCents(cardHourMicros: number) {
  if (!Number.isSafeInteger(cardHourMicros) || cardHourMicros < 0) throw new Error("HOSTING_CARD_HOURS_INVALID");
  return Number((BigInt(cardHourMicros) * 1002n + 5_000_000n) / 10_000_000n);
}
