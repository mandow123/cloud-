import type { HostingContractEvidence, HostingContractStatus, HostingDashboard, HostingDevice, HostingFeeQualificationSnapshot, HostingGpuModel, HostingSupplierFeePreview, HostingSupplierMonthlySettlement, HostingSupplierProfile } from "./hosting-v2.ts";
import { formatCardHourDisplayMicros } from "./card-hours.ts";

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
    feeQualification: HostingFeeQualificationSnapshot | null;
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
  settlementBreakdown: Readonly<{
    grossMicros: number;
    platformFeeMicros: number;
    supplierIncomeMicros: number;
    inFeeReferralCommissionMicros: number;
    platformNetMicros: number;
  }> | null;
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

export type SupplierDeviceWorkspaceState = "AVAILABLE" | "DEPLOYING" | "OPERATING" | "ACTION_REQUIRED" | "OFFLINE" | "DISABLED";

export type SupplierDeviceTask = Readonly<{
  id: string;
  deviceId: string;
  priority: "P0" | "P1" | "P2";
  title: string;
  description: string;
  href: string;
}>;

export type SupplierDeviceWorkspaceRow = Readonly<{
  id: string;
  displayName: string;
  gpuModel: HostingGpuModel;
  gpuMemoryMiB: number;
  state: SupplierDeviceWorkspaceState;
  stateLabel: string;
  stateDetail: string;
  verificationStatus: HostingDevice["verificationStatus"];
  lastSeenAt: string | null;
  activeContractId: string | null;
  activeContractStatus: HostingContractStatus | null;
  publishedOfferCount: number;
  taskCount: number;
  primaryAction: Readonly<{
    label: string;
    href: string;
  }>;
}>;

export type SupplierDeviceWorkspace = Readonly<{
  generatedAt: string;
  summary: Readonly<Record<SupplierDeviceWorkspaceState, number>>;
  records: readonly SupplierDeviceWorkspaceRow[];
  tasks: readonly SupplierDeviceTask[];
  historyCapabilities: Readonly<{
    renewal: Readonly<{ enabled: false; label: "已续约"; reason: string }>;
    buyback: Readonly<{ enabled: false; label: "已回购"; reason: string }>;
    decommission: Readonly<{ enabled: false; label: "设备关闭"; reason: string }>;
  }>;
}>;

export type SupplierHostingDashboard = Readonly<{
  profile: HostingSupplierProfile | null;
  devices: readonly HostingDevice[];
  offers: readonly SupplierHostingOffer[];
  contracts: readonly SupplierHostingContract[];
  deviceWorkspace: SupplierDeviceWorkspace;
  earnings: HostingDashboard["earnings"];
  readiness: HostingDashboard["readiness"];
}>;

export type SupplierHostingPolicy = Readonly<{
  approvedImages: readonly string[];
  termsVersion: string;
  feePreview: HostingSupplierFeePreview;
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
  feePreview: HostingSupplierFeePreview;
  monthlySettlement: HostingSupplierMonthlySettlement;
  updatedAt: string;
}>;

export function formatCardHours(micros: number) {
  try { return formatCardHourDisplayMicros(micros); } catch { return "—"; }
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
