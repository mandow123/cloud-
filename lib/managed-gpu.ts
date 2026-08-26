export const MANAGED_GPU_ORDER_STATUSES = [
  "REQUESTED", "QUOTED", "AWAITING_PAYMENT", "PAID", "PROCUREMENT",
  "ASSET_ASSIGNED", "FULFILLED", "CANCELLED", "DISPUTED", "REFUNDED",
] as const;

export const MANAGED_GPU_ASSET_STATUSES = [
  "EXPECTED", "RECEIVED", "INSPECTING", "VERIFIED", "INSTALLED", "ACTIVE",
  "MAINTENANCE", "DRAINING", "SHIPPING", "DELIVERED", "RETIRED",
] as const;

export const MANAGED_GPU_SETTLEMENT_STATUSES = [
  "HOURLY_PROVISIONAL", "DAILY_CONFIRMED", "MONTHLY_CALCULATED",
  "REVIEW_REQUIRED", "READY", "APPROVED", "POSTED", "REVERSED",
] as const;

export const MANAGED_GPU_ASSET_EVIDENCE_TYPES = [
  "RECEIPT", "INSPECTION_STARTED", "VERIFICATION", "AGENT_BINDING", "AGENT_ONLINE",
  "MAINTENANCE", "DRAINING", "SHIPPING", "DELIVERY", "RETIREMENT",
] as const;

export type ManagedGpuOrderStatus = typeof MANAGED_GPU_ORDER_STATUSES[number];
export type ManagedGpuAssetStatus = typeof MANAGED_GPU_ASSET_STATUSES[number];
export type ManagedGpuSettlementStatus = typeof MANAGED_GPU_SETTLEMENT_STATUSES[number];
export type ManagedGpuAssetEvidenceType = typeof MANAGED_GPU_ASSET_EVIDENCE_TYPES[number];
export type ManagedGpuFulfillmentChoice = "BEIDOU_HOSTING" | "GLOBAL_SHIPPING";
export type ManagedGpuCurrency = "CNY" | "USD" | "HKD" | "SGD";

export class ManagedGpuDomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ManagedGpuDomainError";
  }
}

const ORDER_TRANSITIONS: Readonly<Record<ManagedGpuOrderStatus, readonly ManagedGpuOrderStatus[]>> = {
  REQUESTED: ["QUOTED", "CANCELLED"], QUOTED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["PAID", "CANCELLED", "DISPUTED"], PAID: ["PROCUREMENT", "DISPUTED", "REFUNDED"],
  PROCUREMENT: ["ASSET_ASSIGNED", "DISPUTED", "REFUNDED"], ASSET_ASSIGNED: ["FULFILLED", "DISPUTED", "REFUNDED"],
  FULFILLED: ["DISPUTED"], CANCELLED: [], DISPUTED: ["REFUNDED", "FULFILLED"], REFUNDED: [],
};

const ASSET_TRANSITIONS: Readonly<Record<ManagedGpuAssetStatus, readonly ManagedGpuAssetStatus[]>> = {
  EXPECTED: ["RECEIVED"], RECEIVED: ["INSPECTING"], INSPECTING: ["VERIFIED"],
  VERIFIED: ["INSTALLED"], INSTALLED: ["ACTIVE", "MAINTENANCE", "DRAINING"],
  ACTIVE: ["MAINTENANCE", "DRAINING"], MAINTENANCE: ["ACTIVE", "DRAINING"],
  DRAINING: ["RETIRED"], SHIPPING: ["DELIVERED"], DELIVERED: ["RETIRED"], RETIRED: [],
};

const ASSET_EVIDENCE_FOR_STATUS: Readonly<Record<Exclude<ManagedGpuAssetStatus, "EXPECTED">, ManagedGpuAssetEvidenceType>> = {
  RECEIVED: "RECEIPT", INSPECTING: "INSPECTION_STARTED", VERIFIED: "VERIFICATION", INSTALLED: "AGENT_BINDING",
  ACTIVE: "AGENT_ONLINE", MAINTENANCE: "MAINTENANCE", DRAINING: "DRAINING", SHIPPING: "SHIPPING",
  DELIVERED: "DELIVERY", RETIRED: "RETIREMENT",
};

export function assertManagedGpuOrderTransition(from: ManagedGpuOrderStatus, to: ManagedGpuOrderStatus) {
  if (!ORDER_TRANSITIONS[from]?.includes(to)) throw new ManagedGpuDomainError("MANAGED_GPU_ORDER_TRANSITION_INVALID", `不能从 ${from} 进入 ${to}。`);
}

export function requiredManagedGpuAssetEvidence(from: ManagedGpuAssetStatus, to: ManagedGpuAssetStatus) {
  if (!ASSET_TRANSITIONS[from]?.includes(to)) throw new ManagedGpuDomainError("MANAGED_GPU_ASSET_TRANSITION_INVALID", `不能从 ${from} 进入 ${to}。`);
  return ASSET_EVIDENCE_FOR_STATUS[to as Exclude<ManagedGpuAssetStatus, "EXPECTED">];
}

function micros(value: number, field: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ManagedGpuDomainError("MANAGED_GPU_CARD_HOUR_MICROS_INVALID", `${field} 必须是非负的卡时微单位整数。`);
  return value;
}

export type ManagedGpuSettlementInput = Readonly<{
  grossCardHourMicros: number;
  refundCardHourMicros: number;
  platformFeeMicros: number;
  wearMicros: number;
  facilityChargeMicros: number;
}>;

export function managedGpuNetSettlementMicros(input: ManagedGpuSettlementInput) {
  const grossCardHourMicros = micros(input.grossCardHourMicros, "grossCardHourMicros");
  const refundCardHourMicros = micros(input.refundCardHourMicros, "refundCardHourMicros");
  if (refundCardHourMicros > grossCardHourMicros) throw new ManagedGpuDomainError("MANAGED_GPU_SALES_RECONCILIATION_MISMATCH", "退款与冲正不能超过已收妥卡时。");
  const earnedCardHourMicros = grossCardHourMicros - refundCardHourMicros;
  const charges = [[input.platformFeeMicros, "platformFeeMicros"], [input.wearMicros, "wearMicros"], [input.facilityChargeMicros, "facilityChargeMicros"]] as const;
  const totalChargeMicros = charges.reduce((sum, [value, field]) => {
    const next = sum + micros(value, field);
    if (!Number.isSafeInteger(next)) throw new ManagedGpuDomainError("MANAGED_GPU_CARD_HOUR_MICROS_INVALID", "结算卡时超出安全范围。");
    return next;
  }, 0);
  const appliedDeductionMicros = Math.min(earnedCardHourMicros, totalChargeMicros);
  return { grossCardHourMicros, refundCardHourMicros, earnedCardHourMicros, totalChargeMicros, appliedDeductionMicros, shortfallMicros: totalChargeMicros - appliedDeductionMicros, netCardHourMicros: earnedCardHourMicros - appliedDeductionMicros } as const;
}

export type ManagedGpuProduct = Readonly<{
  id: string; hardwareClassId: string; sku: string; manufacturer: string; model: string; gpuModel: string; vramGb: number | null;
  hardwareTier: "CONSUMER" | "WORKSTATION" | "DATACENTER";
  displayName: string; sellerName: string; specs: Record<string, unknown>; quoteMode: "QUOTE_REQUIRED"; sellable: boolean;
  currency: ManagedGpuCurrency | null; unitPriceMinor: number | null; cardHourReferenceMicros: number | null;
  warrantyMonths: number | null; estimatedDeliveryDays: number | null; fulfillmentModes: ManagedGpuFulfillmentChoice[];
  facilityIds: string[]; utilization7dBps: number | null; utilization30dBps: number | null; quoteValidUntil: string | null;
  status: "ACTIVE" | "RETIRED"; immutableHash: string; createdAt: string;
}>;

export type ManagedGpuFacility = Readonly<{
  id: string; code: string; displayName: string; countryCode: string; region: string; timezone: string;
  status: "PLANNED" | "ACTIVE" | "SUSPENDED"; custodyTermsVersion: string; version: number; createdAt: string; updatedAt: string;
}>;

export type ManagedGpuEconomicPolicy = Readonly<{
  id: string; policyCode: string; versionNumber: number; facilityId: string; facilityChargeMicrosPerAssetDay: number;
  calculation: Record<string, unknown>; effectiveFrom: string; effectiveUntil: string | null; approvedBy: string; immutableHash: string; createdAt: string;
}>;

export type ManagedGpuQuote = Readonly<{
  id: string; organizationId: string; accountId: string; productVersionId: string; facilityId: string | null; quantity: number;
  fulfillmentChoice: ManagedGpuFulfillmentChoice; requestedCurrency: ManagedGpuCurrency; destinationCountryCode: string | null;
  status: "REQUESTED" | "ISSUED" | "ACCEPTED" | "EXPIRED" | "CANCELLED"; unitAmountMinor: number | null;
  totalAmountMinor: number | null; issuedCurrency: ManagedGpuCurrency | null;
  priceBreakdown: { hardwareSubtotalMinor: number; shippingMinor: number; taxMinor: number; otherMinor: number } | null;
  expiresAt: string | null; version: number; createdAt: string; updatedAt: string;
}>;

export type ManagedGpuOrder = Readonly<{
  id: string; quoteId: string; organizationId: string; accountId: string; productVersionId: string; facilityId: string | null;
  quantity: number; fulfillmentChoice: ManagedGpuFulfillmentChoice; currency: ManagedGpuCurrency; totalAmountMinor: number;
  status: ManagedGpuOrderStatus; version: number; createdAt: string; updatedAt: string;
}>;

export type ManagedGpuAsset = Readonly<{
  id: string; orderId: string; unitIndex: number; ownerOrganizationId: string; productVersionId: string; facilityId: string | null;
  serialFingerprint: string; acquisitionAmountMinor: number; currency: ManagedGpuCurrency; ownershipBps: 10000;
  agentBindingId: string | null; status: ManagedGpuAssetStatus; version: number; createdAt: string; updatedAt: string;
}>;

export type ManagedGpuSettlement = Readonly<ManagedGpuSettlementInput & {
  id: string; organizationId: string; assetId: string; periodStart: string; periodEnd: string; earnedCardHourMicros: number; totalChargeMicros: number; appliedDeductionMicros: number; shortfallMicros: number;
  netCardHourMicros: number; policyVersionId: string; status: ManagedGpuSettlementStatus; ledgerBatchId: string | null;
  outstandingFeeId: string | null; outstandingFeeStatus: "PENDING" | "PAID" | "OVERDUE" | null; outstandingFeeDueAt: string | null;
  withdrawable: false; transferable: false; createdAt: string;
}>;

export function managedGpuPublicCatalogRecord(product: ManagedGpuProduct) {
  const available = product.sellable && product.status === "ACTIVE";
  return { id: product.id, hardwareClassId: product.hardwareClassId, sku: product.sku, gpuModel: product.gpuModel, vramGb: product.vramGb, hardwareTier: product.hardwareTier,
    sellerName: product.sellerName, currency: product.currency, unitPriceMinor: product.unitPriceMinor,
    cardHourReferenceMicros: product.cardHourReferenceMicros, warrantyMonths: product.warrantyMonths,
    estimatedDeliveryDays: product.estimatedDeliveryDays, fulfillmentModes: product.fulfillmentModes, facilityIds: product.facilityIds,
    utilization7dBps: product.utilization7dBps, utilization30dBps: product.utilization30dBps,
    status: available ? "AVAILABLE" : "QUOTE_REQUIRED", quoteValidUntil: product.quoteValidUntil } as const;
}

export function managedGpuPublicFacilityRecord(facility: ManagedGpuFacility) {
  return { id: facility.id, name: facility.displayName, region: facility.region, countryCode: facility.countryCode, status: facility.status } as const;
}

export function managedGpuMemberSummaryRecord(input: { enabled?: boolean; organizationId: string; organizationName?: string; summary: { orderCount: number; assetCount: number; activeAssetCount: number; settlementCount: number; confirmedIncomeCardHourMicros: number; provisionalIncomeCardHourMicros: number }; orders: ManagedGpuOrder[]; assets: ManagedGpuAsset[]; settlements: ManagedGpuSettlement[] }) {
  return { enabled: input.enabled ?? true, organizationId: input.organizationId, organizationName: input.organizationName ?? null,
    orderCount: input.summary.orderCount, assetCount: input.summary.assetCount, activeAssetCount: input.summary.activeAssetCount,
    settlementCount: input.summary.settlementCount, orders: input.orders, assets: input.assets, settlements: input.settlements,
    provisionalIncomeCardHourMicros: input.summary.provisionalIncomeCardHourMicros,
    confirmedIncomeCardHourMicros: input.summary.confirmedIncomeCardHourMicros, incomeUnit: "CARD_HOUR_MICROS",
    withdrawable: false, transferable: false, updatedAt: new Date().toISOString() } as const;
}
