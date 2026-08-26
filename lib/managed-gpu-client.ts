export type ManagedGpuFacility = Readonly<{
  id: string;
  name: string;
  region: string;
  countryCode: string;
  status: string;
}>;

export type ManagedGpuProduct = Readonly<{
  id: string;
  hardwareClassId: string;
  sku: string;
  gpuModel: string;
  vramGb: number | null;
  sellerName: string;
  currency: string | null;
  unitPriceMinor: number | null;
  cardHourReferenceMicros: number | null;
  warrantyMonths: number | null;
  estimatedDeliveryDays: number | null;
  fulfillmentModes: readonly ("BEIDOU_HOSTING" | "GLOBAL_SHIPPING")[];
  facilityIds: readonly string[];
  utilization7dBps: number | null;
  utilization30dBps: number | null;
  status: "QUOTE_REQUIRED" | "AVAILABLE" | "PAUSED";
  quoteValidUntil: string | null;
}>;

export type ManagedGpuCatalogEnvelope = Readonly<{
  enabled: boolean;
  available: boolean;
  records: readonly ManagedGpuProduct[];
  facilities: readonly ManagedGpuFacility[];
  servedAt?: string;
}>;

export type ManagedGpuOrderSummary = Readonly<{
  id: string;
  productVersionId: string;
  quantity: number;
  fulfillmentChoice: "BEIDOU_HOSTING" | "GLOBAL_SHIPPING";
  status: string;
  createdAt: string;
  updatedAt: string;
}>;

export type ManagedGpuQuoteSummary = Readonly<{
  id: string;
  productVersionId: string;
  quantity: number;
  fulfillmentChoice: "BEIDOU_HOSTING" | "GLOBAL_SHIPPING";
  status: "REQUESTED" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  issuedCurrency: string | null;
  totalAmountMinor: number | null;
  expiresAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type ManagedGpuAssetSummary = Readonly<{
  id: string;
  productVersionId: string;
  serialFingerprint: string;
  facilityId: string | null;
  status: string;
  agentBindingId: string | null;
  updatedAt: string;
}>;

export type ManagedGpuSettlementSummary = Readonly<{
  id: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  grossCardHourMicros: number;
  refundCardHourMicros: number;
  platformFeeMicros: number;
  wearMicros: number;
  facilityChargeMicros: number;
  earnedCardHourMicros: number;
  totalChargeMicros: number;
  appliedDeductionMicros: number;
  shortfallMicros: number;
  netCardHourMicros: number;
  outstandingFeeId: string | null;
  outstandingFeeStatus: "PENDING" | "PAID" | "OVERDUE" | null;
  outstandingFeeDueAt: string | null;
}>;

export type ManagedGpuMemberSummary = Readonly<{
  enabled: boolean;
  organizationId: string;
  organizationName: string | null;
  orderCount: number;
  assetCount: number;
  activeAssetCount: number;
  settlementCount: number;
  orders: readonly ManagedGpuOrderSummary[];
  assets: readonly ManagedGpuAssetSummary[];
  settlements: readonly ManagedGpuSettlementSummary[];
  provisionalIncomeCardHourMicros: number;
  confirmedIncomeCardHourMicros: number;
  incomeUnit: "CARD_HOUR_MICROS";
  withdrawable: false;
  transferable: false;
  updatedAt: string;
}>;

export type ManagedGpuRecordsEnvelope<T> = Readonly<{ records: readonly T[]; count: number }>;

export async function readManagedGpuJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", signal });
  const body = await response.json().catch(() => null) as ({ error?: { message?: string } } & T) | null;
  if (!response.ok || body === null) throw new Error(body?.error?.message ?? "GPU 云托管服务暂时无法读取。");
  return body;
}

export function formatMoneyMinor(minor: number, currency: string) {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export function formatUtilizationBps(value: number | null) {
  return value === null ? "尚无真实数据" : `${(value / 100).toFixed(2)}%`;
}

export function managedGpuStatusLabel(value: string) {
  const labels: Record<string, string> = {
    DRAFT: "草稿", QUOTED: "已报价", COMPLIANCE_PENDING: "合规审核中", COMPLIANCE_APPROVED: "合规已通过",
    REQUESTED: "已提交", AWAITING_PAYMENT: "待向供应商银行付款", PAID: "银行付款已确认",
    AWAITING_BANK_PAYMENT: "待向供应商银行付款", PAYMENT_CONFIRMED: "付款已人工确认", PROCUREMENT: "采购中",
    ASSET_ASSIGNED: "已分配实体 GPU", FULFILLED: "交付完成", FULFILLMENT_SELECTED: "已选择交付", COMPLETED: "已完成", CANCELLED: "已取消", DISPUTED: "争议处理中", REFUNDED: "已退款",
    EXPECTED: "待到货", RECEIVED: "已收货", INSPECTING: "验收中", VERIFIED: "已验证", INSTALLED: "已安装",
    ACTIVE: "运营中", MAINTENANCE: "维护中", DRAINING: "退出排空中", SHIPPING: "寄送中", DELIVERED: "已送达", REMOVED: "已拆机", SHIPPED: "已寄送",
    RETIRED: "已退役", OPEN: "待计算", HOURLY_PROVISIONAL: "小时暂估", DAILY_CONFIRMED: "每日确认",
    MONTHLY_CALCULATED: "月度已计算", REVIEW_REQUIRED: "待复核", READY: "待审批", APPROVED: "已审批", POSTED: "已入账",
    REVERSED: "已冲正",
    ONLINE: "在线", OFFLINE: "离线", UNBOUND: "未绑定 Agent", DEGRADED: "状态异常",
  };
  return labels[value] ?? value;
}
