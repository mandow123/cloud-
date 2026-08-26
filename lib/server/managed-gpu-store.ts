import type {
  ManagedGpuAsset,
  ManagedGpuCurrency,
  ManagedGpuFacility,
  ManagedGpuFulfillmentChoice,
  ManagedGpuOrder,
  ManagedGpuOrderStatus,
  ManagedGpuProduct,
  ManagedGpuQuote,
  ManagedGpuSettlement,
  ManagedGpuAssetStatus,
  ManagedGpuEconomicPolicy,
} from "../managed-gpu.ts";

export type ManagedGpuMutationContext = Readonly<{
  organizationId: string;
  accountId: string;
  idempotencyKey: string;
  payloadHash: string;
  now: string;
  approvalId?: string;
}>;

export type ManagedGpuApprovalAction = "ISSUE_QUOTE" | "RECORD_PAYMENT_EVIDENCE" | "TRANSITION_ORDER" | "CREATE_ASSET" | "TRANSITION_ASSET" | "CREATE_SETTLEMENT" | "TRANSITION_SETTLEMENT" | "SHIP_ASSET" | "PUBLISH_PRODUCT_VERSION" | "ACTIVATE_FACILITY" | "PUBLISH_ECONOMIC_POLICY";
export type ManagedGpuApproval = Readonly<{ id: string; actionType: ManagedGpuApprovalAction; targetId: string; requesterAccountId: string; approverAccountId: string | null; payloadHash: string; commandPayload: Record<string, unknown>; status: "REQUESTED" | "APPROVED" | "CONSUMED" | "REJECTED" | "EXPIRED"; version: number; requestedAt: string; decidedAt: string | null; consumedAt: string | null }>;

export type ManagedGpuServiceRequest = Readonly<{
  id: string;
  organizationId: string;
  accountId: string;
  assetId: string;
  requestType: "GLOBAL_SHIPPING" | "EXIT_HOSTING";
  destinationCountryCode: string | null;
  addressReference: string | null;
  reason: string;
  status: "REQUESTED" | "REVIEWING" | "APPROVED" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED";
  earliestExecutionAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export interface ManagedGpuStore {
  requestApproval(context: ManagedGpuMutationContext, input: { actionType: ManagedGpuApprovalAction; targetId: string; commandPayloadHash: string; commandPayload: Record<string, unknown> }): Promise<{ record: ManagedGpuApproval; replayed: boolean }>;
  approveApproval(context: ManagedGpuMutationContext, approvalId: string, input: { expectedVersion: number; actionType: ManagedGpuApprovalAction }): Promise<{ record: ManagedGpuApproval; replayed: boolean }>;
  rejectApproval(context: ManagedGpuMutationContext, approvalId: string, input: { expectedVersion: number; actionType: ManagedGpuApprovalAction }): Promise<{ record: ManagedGpuApproval; replayed: boolean }>;
  listCatalog(): Promise<{ records: ManagedGpuProduct[]; facilities: ManagedGpuFacility[] }>;
  createQuote(context: ManagedGpuMutationContext, input: {
    productVersionId: string;
    facilityId: string | null;
    quantity: number;
    fulfillmentChoice: ManagedGpuFulfillmentChoice;
    requestedCurrency: ManagedGpuCurrency;
    destinationCountryCode: string | null;
  }): Promise<{ record: ManagedGpuQuote; replayed: boolean }>;
  listMemberQuotes(organizationId: string): Promise<ManagedGpuQuote[]>;
  issueQuote(adminContext: ManagedGpuMutationContext, quoteId: string, input: {
    expectedVersion: number;
    unitAmountMinor: number;
    shippingMinor: number;
    taxMinor: number;
    otherMinor: number;
    currency: ManagedGpuCurrency;
    expiresAt: string;
  }): Promise<{ record: ManagedGpuQuote; replayed: boolean }>;
  acceptQuote(context: ManagedGpuMutationContext, quoteId: string): Promise<{ record: ManagedGpuOrder; replayed: boolean }>;
  listMemberOrders(organizationId: string): Promise<ManagedGpuOrder[]>;
  getMemberOrder(organizationId: string, orderId: string): Promise<ManagedGpuOrder | null>;
  listMemberAssets(organizationId: string): Promise<ManagedGpuAsset[]>;
  listMemberSettlements(organizationId: string): Promise<ManagedGpuSettlement[]>;
  createServiceRequest(context: ManagedGpuMutationContext, input: {
    assetId: string;
    requestType: "GLOBAL_SHIPPING" | "EXIT_HOSTING";
    destinationCountryCode: string | null;
    addressReference: string | null;
    reason: string;
  }): Promise<{ record: ManagedGpuServiceRequest; replayed: boolean }>;
  payOutstandingHostingFee(context: ManagedGpuMutationContext, feeId: string, input: { expectedAmountMicros: number }): Promise<{ feeId: string; status: "PAID"; replayed: boolean }>;
  memberSummary(organizationId: string): Promise<{
    orderCount: number;
    assetCount: number;
    activeAssetCount: number;
    settlementCount: number;
    confirmedIncomeCardHourMicros: number;
    provisionalIncomeCardHourMicros: number;
    withdrawable: false;
    transferable: false;
  }>;
  listAdminOrders(): Promise<ManagedGpuOrder[]>;
  adminOverview(): Promise<{
    products: ManagedGpuProduct[]; facilities: ManagedGpuFacility[]; economicPolicies: ManagedGpuEconomicPolicy[];
    quotes: ManagedGpuQuote[]; orders: ManagedGpuOrder[]; assets: ManagedGpuAsset[];
    settlements: ManagedGpuSettlement[]; serviceRequests: ManagedGpuServiceRequest[]; approvals: ManagedGpuApproval[];
    counts: { products: number; facilities: number; economicPolicies: number; quotes: number; orders: number; assets: number; settlements: number; serviceRequests: number; approvals: number };
  }>;
  recordPaymentEvidence(adminContext: ManagedGpuMutationContext, input: {
    orderId: string; provider: string; providerReference: string; eventType: "CAPTURED" | "REFUNDED" | "CHARGEBACK" | "REVERSAL";
    amountMinor: number; currency: ManagedGpuCurrency; payloadDigest: string; occurredAt: string;
  }): Promise<{ eventId: string; replayed: boolean }>;
  transitionOrder(adminContext: ManagedGpuMutationContext, orderId: string, input: { expectedVersion: number; toStatus: ManagedGpuOrderStatus }): Promise<{ record: ManagedGpuOrder; replayed: boolean }>;
  createAsset(adminContext: ManagedGpuMutationContext, input: {
    orderId: string;
    unitIndex: number;
    serialFingerprint: string;
    facilityId: string | null;
    status: ManagedGpuAsset["status"];
  }): Promise<{ record: ManagedGpuAsset; replayed: boolean }>;
  transitionAsset(adminContext: ManagedGpuMutationContext, assetId: string, input: {
    expectedVersion: number; toStatus: ManagedGpuAssetStatus; evidenceDigest: string; agentBindingId: string | null;
    verifiedAt?: string | null; allocationCount?: number | null; processCount?: number | null;
  }): Promise<{ record: ManagedGpuAsset; replayed: boolean }>;
  createSettlement(adminContext: ManagedGpuMutationContext, input: {
    assetId: string; periodStart: string; periodEnd: string; policyVersionId: string; sourceKey: string;
  }): Promise<{ record: ManagedGpuSettlement; replayed: boolean }>;
  transitionSettlement(adminContext: ManagedGpuMutationContext, settlementId: string, input: {
    expectedStatus: ManagedGpuSettlement["status"]; toStatus: "READY" | "APPROVED" | "POSTED";
  }): Promise<{ record: ManagedGpuSettlement; replayed: boolean }>;
  shipAsset(adminContext: ManagedGpuMutationContext, serviceRequestId: string, input: {
    expectedVersion: number; evidenceDigest: string;
  }): Promise<{ record: ManagedGpuAsset; serviceRequest: ManagedGpuServiceRequest; replayed: boolean }>;
  publishProductVersion(adminContext: ManagedGpuMutationContext, input: {
    hardwareClassId: string; sku: string; manufacturer: string; model: string; displayName: string; sellerName: string;
    gpuModel: string; hardwareTier: ManagedGpuProduct["hardwareTier"]; vramGb: number; specs: Record<string, unknown>;
    verifiedInventoryCount: number; inventoryEvidenceDigest: string; currency: ManagedGpuCurrency;
    warrantyMonths: number; estimatedDeliveryDays: number; fulfillmentModes: ManagedGpuFulfillmentChoice[];
    facilityIds: string[]; quoteValidUntil: string;
  }): Promise<{ record: ManagedGpuProduct; replayed: boolean }>;
  activateFacility(adminContext: ManagedGpuMutationContext, facilityId: string, input: {
    expectedVersion: number; custodyTermsVersion: string; verificationEvidenceDigest: string;
  }): Promise<{ record: ManagedGpuFacility; replayed: boolean }>;
  publishEconomicPolicy(adminContext: ManagedGpuMutationContext, input: {
    policyCode: string; versionNumber: number; facilityId: string; facilityChargeMicrosPerAssetDay: number;
    calculation: Record<string, unknown>; effectiveFrom: string; effectiveUntil: string | null;
  }): Promise<{ record: ManagedGpuEconomicPolicy; replayed: boolean }>;
  health(): Promise<{ schemaVersion: number }>;
}

declare global { var __kaiManagedGpuStorePromise: Promise<ManagedGpuStore> | undefined; }

async function resolveManagedGpuStore(): Promise<ManagedGpuStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) return (await import("./managed-gpu-store-d1.ts")).createD1ManagedGpuStore(cloudflare.env.DB);
  } catch { /* Node deployments do not expose Cloudflare bindings. */ }
  return (await import("./managed-gpu-store-sqlite.ts")).createSqliteManagedGpuStore();
}

export function getManagedGpuStore() {
  globalThis.__kaiManagedGpuStorePromise ??= resolveManagedGpuStore().catch((error) => {
    globalThis.__kaiManagedGpuStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiManagedGpuStorePromise;
}
