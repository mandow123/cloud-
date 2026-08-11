import type { HostingContractStatus, HostingGpuModel } from "./hosting-v2.ts";

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
