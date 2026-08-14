import type { HostingContractEvidence, HostingContractStatus, HostingDashboard, HostingDevice, HostingGpuModel, HostingSupplierProfile } from "./hosting-v2.ts";

export type PublicHostingOffer = Readonly<{
  id: string;
  title: string;
  gpuModel: HostingGpuModel;
  region: string;
  minRentalSeconds: number;
  maxRentalSeconds: number;
  availableFrom: string;
  availableUntil: string;
  approvedImage: string;
  termsVersion: string;
  pricing: Readonly<{
    assetCode: "KAI_CREDIT_HOUR";
    cardHourMicrosPerGpuHour: number;
    cnyReferenceRate: "1.002";
  }>;
}>;

export type HostingReadinessCheck = Readonly<{ ready: boolean; reason?: string }>;

export type PublicHostingReadiness = Readonly<{
  enabled: boolean;
  configurationEnabled: boolean;
  ready: boolean;
  rolloutMode: "DISABLED" | "SETUP" | "INTERNAL_AGENT_TRIAL";
  checks: Readonly<{
    supplierIdentity: HostingReadinessCheck;
    agentDelivery: HostingReadinessCheck;
    feeSchedule: HostingReadinessCheck;
    cardHourLedger: HostingReadinessCheck;
    approvedImages: HostingReadinessCheck & Readonly<{ count: number }>;
    metering: HostingReadinessCheck;
    cleanup: HostingReadinessCheck;
    alipayClosed: HostingReadinessCheck;
  }>;
  operations: Readonly<{
    approvedSupplierCount: number;
    activeAgentCount: number;
    drainingDeviceCount: number;
    failedCleanupCount: number;
  }> | null;
}>;

export type HostingReadinessEnvelope = Readonly<{
  release?: string;
  environment?: Readonly<{ localAcceptance?: boolean }>;
  hostingV2?: PublicHostingReadiness;
}>;

export type BuyerHostingContract = Readonly<{
  id: string;
  offerId: string;
  snapshot: Readonly<{
    title: string;
    gpuModel: HostingGpuModel;
    region: string;
    cardHourMicrosPerGpuHour: number;
    approvedImage: string;
    termsVersion: string;
    platformFeeBps: number;
    referralRewardBps: number;
    acceptanceWindowSeconds: number;
  }>;
  reservedSeconds: number;
  measuredSeconds: number | null;
  heldMicros: number;
  settledMicros: number | null;
  status: HostingContractStatus;
  sshPublicKeyFingerprint: string | null;
  endpointDisplay: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  acceptedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  evidence?: HostingContractEvidence;
}>;

export type SupplierHostingOffer = Readonly<{
  id: string;
  deviceId: string;
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

export type SupplierHostingContract = Readonly<{
  id: string;
  offerId: string;
  deviceId: string;
  snapshot: BuyerHostingContract["snapshot"];
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
  evidence?: HostingContractEvidence;
}>;

export type SupplierHostingDashboard = Readonly<{
  profile: HostingSupplierProfile | null;
  devices: readonly HostingDevice[];
  offers: readonly SupplierHostingOffer[];
  contracts: readonly SupplierHostingContract[];
  earnings: HostingDashboard["earnings"];
  readiness: HostingDashboard["readiness"];
}>;

export type SupplierHostingPolicy = Readonly<{
  approvedImages: readonly string[];
  termsVersion: string;
}>;

export type SupplierEarningsLedgerEntry = Readonly<{
  operation: string;
  businessKey: string;
  side: "DEBIT" | "CREDIT";
  amountMicros: number;
  balanceAfterMicros: number | null;
  createdAt: string;
}>;

export type SupplierEarningsDashboard = Readonly<{
  assetCode: "KAI_CREDIT_HOUR";
  rate: Readonly<{ cardHours: "1"; cny: "1.002" }>;
  balance: Readonly<{ availableMicros: number; heldMicros: number }>;
  income: Readonly<{
    rentalPendingMicros: number;
    rentalVestedMicros: number;
    commissionPendingMicros: number;
    commissionVestedMicros: number;
  }>;
  referral: Readonly<{ code: string; invitedOrganizations: number }>;
  ledger: readonly SupplierEarningsLedgerEntry[];
  updatedAt: string;
}>;

export function formatCardHours(micros: number) {
  if (!Number.isSafeInteger(micros) || micros < 0) return "—";
  return (micros / 1_000_000).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

export function formatHostingTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function formatEvidenceDigest(value: string | null | undefined) {
  if (!value) return "—";
  return value.length > 24 ? `${value.slice(0, 16)}…${value.slice(-8)}` : value;
}

const CONTRACT_STATUS_LABELS: Record<HostingContractStatus, string> = {
  RESERVED: "已预留",
  CARD_HOURS_HELD: "卡时已锁定",
  PAID: "已支付",
  PROVISIONING: "开通中",
  READY: "可连接",
  IN_SERVICE: "服务中",
  AWAITING_ACCEPTANCE: "待验收",
  SETTLED: "已结算",
  CLEANING: "清理中",
  CLEANED: "已清理",
  CANCELLED: "已取消",
  FAILED: "交付失败",
  DISPUTED: "争议中",
  REFUNDED: "已退款",
};

export function hostingContractStatusLabel(status: HostingContractStatus) {
  return CONTRACT_STATUS_LABELS[status];
}
