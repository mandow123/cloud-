export type AdminSourceSystem = "MARKETPLACE" | "EXCHANGE" | "SUPPLY_PILOT" | "ADMIN";
export type AdminProjectionName =
  | "supply-offers"
  | "demands"
  | "matches"
  | "pools"
  | "verifications"
  | "capacity-lots"
  | "listings"
  | "withdrawals"
  | "swaps"
  | "orders"
  | "delivery"
  | "metering"
  | "payments"
  | "settlements"
  | "commissions"
  | "standardization"
  | "exceptions";
export type AdminMutationContext = Readonly<{ principalId: string; organizationId?: string; idempotencyKey: string; payloadHash: string }>;
export type AdminListQuery = Readonly<{ limit?: number; status?: string | null; q?: string | null; sourceSystem?: AdminSourceSystem | null }>;

export type AdminProjectionItem = Readonly<{
  sourceSystem: AdminSourceSystem; entityType: string; id: string; status: string; title: string;
  subtitle?: string | null; actorIds: readonly string[]; amountCents?: number | null; currency?: string | null;
  createdAt?: string | null; updatedAt?: string | null; facts: Readonly<Record<string, unknown>>;
  ownership: AdminEntityOwnership | { organizationId: null; accountId: null; legacyActorId: null; classification: "LEGACY_ANON" };
}>;

export type AdminWorkItem = Readonly<{
  id: string; sourceSystem: AdminSourceSystem; entityType: string; entityId: string; workType: string; title: string;
  summary: string; status: "OPEN" | "CLAIMED" | "WAITING" | "RESOLVED" | "CANCELLED";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL"; assigneePrincipalId: string | null; dueAt: string | null;
  metadata: Readonly<Record<string, unknown>>; createdBy: string; version: number; createdAt: string; updatedAt: string;
}>;

export type AdminRefundCase = Readonly<{
  id: string; sourceSystem: "EXCHANGE" | "SUPPLY_PILOT"; entityType: string; entityId: string; amountCents: number;
  currency: "CNY"; businessExpectedVersion: number; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requestedBy: string; requestReason: string; decidedBy: string | null; decisionReason: string | null;
  version: number; createdAt: string; updatedAt: string; decidedAt: string | null;
  execution: AdminRefundExecution | null;
}>;

export type AdminRefundExecution = Readonly<{
  refundCaseId: string; provider: "ALIPAY"; refundRequestId: string; orderId: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED"; attemptCount: number;
  attemptedBy: string; claimToken: string; providerTransactionRef: string | null;
  lastErrorCode: string | null; lastErrorMessage: string | null;
  lastAttemptAt: string; completedAt: string | null; version: number;
  createdAt: string; updatedAt: string;
}>;

export type AdminEntityOwnership = Readonly<{
  sourceSystem: AdminSourceSystem; entityType: string; entityId: string; organizationId: string; accountId: string;
  legacyActorId: string | null; boundByPrincipalId: string; createdAt: string; updatedAt: string; version: number; classification: "BOUND";
}>;

export type MemberPersonalCounts = Readonly<{
  purchaseRequests: number;
  orders: number;
  pendingPayment: number;
  pendingAcceptance: number;
}>;

export type AdminManualDeliveryIntake = Readonly<{
  demandId: string;
  buyerOrganizationId: string;
  buyerAccountId: string;
  buyerDisplayName: string | null;
  buyerEmail: string | null;
  organizationName: string | null;
  resourceId: string;
  resourceTitle: string;
  sshPublicKeyFingerprint: string;
  status: ManualDeliveryStatus;
  statusVersion: number;
  supplierOrganizationId: string | null;
  supplierOrganizationName: string | null;
  internalNote: string | null;
  buyerVisibleNote: string | null;
  connection: ManualDeliveryConnection | null;
  deliveryTimeline: ManualDeliveryTimeline;
  createdAt: string;
  updatedAt: string;
}>;

export type ManualDeliveryConnection = Readonly<{
  host: string;
  port: number;
  username: string;
  hostKeyFingerprint: string | null;
}>;

export type ManualDeliveryStatus =
  | "PENDING_MANUAL_DELIVERY"
  | "SUPPLIER_ASSIGNED"
  | "DELIVERY_IN_PROGRESS"
  | "AWAITING_BUYER_ACCEPTANCE"
  | "COMPLETED"
  | "CANCELLED"
  | "ACCESS_REVOKED";

export type ManualDeliveryTimeline = Readonly<{
  assignedAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  revokedAt: string | null;
}>;

export type ManualDeliverySupplierCandidate = Readonly<{
  organizationId: string;
  organizationName: string;
}>;

export type AdminManualDeliveryPublicKey = Readonly<{
  demandId: string;
  canonicalSshPublicKey: string;
  sshPublicKeyFingerprint: string;
}>;

export type MemberCatalogPurchaseIntent = Readonly<{
  demandId: string;
  status: ManualDeliveryStatus;
  statusVersion: number;
  buyerVisibleNote: string | null;
  connection: ManualDeliveryConnection | null;
  deliveryTimeline: ManualDeliveryTimeline;
  resource: Readonly<{
    id: string;
    title: string;
    supplierId: string;
    supplierName: string;
    supplierLogoUrl: string | null;
    category: string;
    region: string;
    deliveryForm: string;
    summary: string;
    capacity: string;
    sla: string;
    deliveryLeadTime: string;
    sourceNotice: string | null;
    gpuDescription: string;
    gpuPackageCount: number;
    specs: Readonly<Record<string, string>>;
  }>;
  request: Readonly<{
    quantity: number;
    totalGpuCount: number;
    durationHours: number | null;
    deliveryDate: string | null;
  }>;
  pricing: Readonly<{
    pricingUnit: string;
    unitCardHourMicros: number;
    estimatedCardHourMicros: number;
  }>;
  sshPublicKeyFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type SupplierManualDeliveryTask = Readonly<{
  demandId: string;
  status: ManualDeliveryStatus;
  statusVersion: number;
  resource: MemberCatalogPurchaseIntent["resource"];
  request: MemberCatalogPurchaseIntent["request"];
  sshPublicKeyFingerprint: string | null;
  deliveryTimeline: ManualDeliveryTimeline;
  createdAt: string;
  updatedAt: string;
}>;

export type ManualAppealStatus = "OPEN"|"TRIAGED"|"AWAITING_BUYER"|"AWAITING_SUPPLIER"|"UNDER_REVIEW"|"RESOLUTION_PROPOSED"|"RESOLVED"|"CLOSED";
export type ManualAppealCategory = "DELIVERY_DELAY"|"CONNECTION_FAILURE"|"SPEC_MISMATCH"|"DELIVERY_QUALITY"|"CANCELLATION_REQUEST"|"EXTERNAL_PAYMENT_CLAIM"|"OTHER";
export type ManualAppealResolution = "NO_ACTION"|"REDELIVERY_RECOMMENDED"|"CANCEL_REQUEST_RECOMMENDED"|"OFFLINE_REFUND_RECOMMENDED"|"OTHER";
export type ManualAppealOfflineRefundStatus = "APPROVED_FOR_OFFLINE_HANDLING"|"OFFLINE_PROCESSING"|"PROOF_SUBMITTED"|"INDEPENDENTLY_VERIFIED"|"FAILED"|"CANCELLED";
export type ManualAppealMessage = Readonly<{id:string;authorType:"BUYER"|"SUPPLIER"|"ADMIN";visibility:"PARTIES"|"ADMIN_ONLY";body:string;createdAt:string}>;
export type ManualAppealTimelineItem = Readonly<{id:string;type:string;fromStatus:ManualAppealStatus|null;toStatus:ManualAppealStatus|null;occurredAt:string}>;
export type ManualAppealOfflineRefundParty = Readonly<{id:string;status:ManualAppealOfflineRefundStatus;amountMinor:number;currency:string;methodLabel:string;maskedReference:string|null;proofSubmittedAt:string|null;proofVerifiedAt:string|null}>;
export type ManualAppealPartyCase = Readonly<{id:string;caseNumber:string;sourceType:"MANUAL_DELIVERY_DEMAND";sourceId:string;category:ManualAppealCategory;subject:string;status:ManualAppealStatus;version:number;createdAt:string;updatedAt:string;partySafeResolutionOutcome:ManualAppealResolution|null;partySafeResolutionSummary:string|null;timeline:readonly ManualAppealTimelineItem[];messages:readonly ManualAppealMessage[];offlineRefunds:readonly ManualAppealOfflineRefundParty[];manualDeliveryStatus:ManualDeliveryStatus;supplierDisplayName?:string|null;buyerDisplayName?:string;resource?:SupplierManualDeliveryTask["resource"]}>;
export type AdminManualAppealCase = Omit<ManualAppealPartyCase,"messages"|"offlineRefunds"> & Readonly<{description:string;buyerOrganizationId:string;buyerAccountId:string;supplierOrganizationId:string|null;assignedAdminPrincipalId:string|null;parentCaseId:string|null;messages:readonly ManualAppealMessage[];offlineRefunds:readonly (ManualAppealOfflineRefundParty & {recordedByPrincipalId:string;verifiedByPrincipalId:string|null;verifiedFinancialReferenceId:string;method:string;externalReferenceHash:string|null;proofEvidenceId:string|null;version:number})[]}>;
export type ManualCommercialOrderStatus="OFFERED"|"CARD_HOURS_HELD"|"PREPARING"|"READY"|"CONNECTION_CONFIRMED"|"AWAITING_ACCEPTANCE"|"COMPLETED"|"CANCELLED";
export type ManualCommercialOrderView=Readonly<{id:string;demandId:string;status:ManualCommercialOrderStatus;version:number;resource:{title:string;supplierName:string;gpuDescription:string};quote:{offerVersion:number;quotedCardHourMicros:number;actualCardHourMicros:number|null;serviceSummary:string;expectedDeliveryAt:string|null};hold:{status:"NOT_HELD"|"HELD"|"CAPTURED"|"RELEASED";heldMicros:number;capturedMicros:number|null;releasedMicros:number|null};delivery:{manualDeliveryStatus:ManualDeliveryStatus;connection:ManualDeliveryConnection|null};settlement:{status:"NOT_ELIGIBLE"|"ELIGIBLE";grossCnyCents:number|null;platformFeeBps:number|null;platformFeeCnyCents:number|null;supplierReceivableCnyCents:number|null;payoutStatus:"CLOSED"};createdAt:string;updatedAt:string}>;
export type ManualCommercialOrderBuyerView=Readonly<Omit<ManualCommercialOrderView,"settlement">&{settlement:{status:"NOT_ELIGIBLE"|"ELIGIBLE"}}>;
export type ManualCommercialOrderSupplierView=ManualCommercialOrderView;
export type ManualCommercialOrderAdminView=ManualCommercialOrderView;

export type MemberAccountConsoleRecords = Readonly<{
  purchaseIntents: Readonly<{
    total: number;
    pendingManualDelivery: number;
    recent: readonly Readonly<{
      demandId: string;
      status: ManualDeliveryStatus;
      resourceTitle: string;
      supplierName: string;
      estimatedCardHourMicros: number;
      createdAt: string;
      updatedAt: string;
    }>[];
  }>;
  supplyApplications: Readonly<{
    total: number;
    pendingReview: number;
    approved: number;
    verified: number;
    published: number;
    needsAttention: number;
    recent: readonly Readonly<{
      id: string;
      productName: string;
      resourceType: string;
      status: "DRAFT" | "SUBMITTED" | "UNDER_VERIFICATION" | "VERIFIED" | "REJECTED" | "PUBLISHED";
      createdAt: string;
      updatedAt: string;
    }>[];
  }>;
}>;

export interface AdminOperationsStore {
  dashboard(): Promise<Record<string, unknown>>;
  readProjection(name: AdminProjectionName, query?: AdminListQuery): Promise<AdminProjectionItem[]>;
  search(query: AdminListQuery): Promise<AdminProjectionItem[]>;
  listWorkItems(query?: AdminListQuery): Promise<AdminWorkItem[]>;
  createWorkItem(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminWorkItem; replayed: boolean }>;
  updateWorkItem(id: string, context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminWorkItem; replayed: boolean }>;
  listRefundCases(query?: AdminListQuery): Promise<AdminRefundCase[]>;
  requestRefund(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminRefundCase; replayed: boolean }>;
  decideRefund(id: string, context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminRefundCase; replayed: boolean }>;
  getRefundCase(id: string): Promise<AdminRefundCase | null>;
  beginRefundExecution(id: string, context: AdminMutationContext, executionReason: string): Promise<{ record: AdminRefundCase; claimed: boolean }>;
  finishRefundExecution(id: string, context: AdminMutationContext, input: Readonly<{ claimToken: string; status: "SUCCEEDED" | "FAILED"; providerTransactionRef?: string | null; errorCode?: string | null; errorMessage?: string | null }>): Promise<{ record: AdminRefundCase }>;
  listPrincipals(query?: AdminListQuery): Promise<Record<string, unknown>[]>;
  listRoles(query?: AdminListQuery): Promise<Record<string, unknown>[]>;
  invitePrincipal(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  updatePrincipalStatus(accountId: string, context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  assignPrincipalRoles(accountId: string, context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  listAuditEvents(query?: AdminListQuery): Promise<Record<string, unknown>[]>;
  bindEntityOrganization(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminEntityOwnership; replayed: boolean }>;
  getEntityOwnership(sourceSystem: AdminSourceSystem, entityType: string, entityId: string): Promise<AdminEntityOwnership | null>;
  getMemberPersonalCounts(organizationId: string, asOf: string): Promise<MemberPersonalCounts>;
  recordManualDeliveryIntake(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: AdminManualDeliveryIntake; replayed: boolean }>;
  listManualDeliveryIntakes(query?: AdminListQuery): Promise<AdminManualDeliveryIntake[]>;
  getManualDeliveryIntake(demandId: string): Promise<AdminManualDeliveryIntake | null>;
  listManualDeliverySupplierCandidates(): Promise<ManualDeliverySupplierCandidate[]>;
  transitionManualDelivery(context: AdminMutationContext, demandId: string, action: "ASSIGN" | "START" | "MARK_DELIVERED" | "CANCEL" | "REVOKE", input: Record<string, unknown>): Promise<{ record: AdminManualDeliveryIntake; replayed: boolean }>;
  revealManualDeliveryPublicKey(principalId: string, demandId: string): Promise<AdminManualDeliveryPublicKey>;
  recordCatalogPurchaseIntentSnapshot(context: AdminMutationContext, input: Record<string, unknown>): Promise<{ record: MemberCatalogPurchaseIntent; replayed: boolean }>;
  listMemberCatalogPurchaseIntents(organizationId: string, limit?: number): Promise<MemberCatalogPurchaseIntent[]>;
  getMemberCatalogPurchaseIntent(organizationId: string, demandId: string): Promise<MemberCatalogPurchaseIntent | null>;
  confirmMemberManualDelivery(context: AdminMutationContext, demandId: string, input: Record<string, unknown>): Promise<{ record: MemberCatalogPurchaseIntent; replayed: boolean }>;
  listSupplierManualDeliveries(organizationId: string, limit?: number): Promise<SupplierManualDeliveryTask[]>;
  getSupplierManualDelivery(organizationId: string, demandId: string): Promise<SupplierManualDeliveryTask | null>;
  getMemberAccountConsoleRecords(organizationId: string, recentLimit?: number): Promise<MemberAccountConsoleRecords>;
  createMemberManualAppeal(context:AdminMutationContext,demandId:string,input:Record<string,unknown>):Promise<{record:ManualAppealPartyCase;replayed:boolean}>;
  listMemberManualAppeals(organizationId:string,limit?:number):Promise<ManualAppealPartyCase[]>;
  getMemberManualAppeal(organizationId:string,caseId:string):Promise<ManualAppealPartyCase|null>;
  addMemberManualAppealMessage(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:ManualAppealPartyCase;replayed:boolean}>;
  listSupplierManualAppeals(organizationId:string,limit?:number):Promise<ManualAppealPartyCase[]>;
  getSupplierManualAppeal(organizationId:string,caseId:string):Promise<ManualAppealPartyCase|null>;
  addSupplierManualAppealMessage(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:ManualAppealPartyCase;replayed:boolean}>;
  listAdminManualAppeals(limit?:number):Promise<AdminManualAppealCase[]>;
  getAdminManualAppeal(caseId:string):Promise<AdminManualAppealCase|null>;
  assignAdminManualAppeal(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  transitionAdminManualAppeal(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  addAdminManualAppealMessage(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  createAdminManualAppealOfflineRefund(context:AdminMutationContext,caseId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  transitionAdminManualAppealOfflineRefund(context:AdminMutationContext,caseId:string,recordId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  verifyAdminManualAppealOfflineRefund(context:AdminMutationContext,caseId:string,recordId:string,input:Record<string,unknown>):Promise<{record:AdminManualAppealCase;replayed:boolean}>;
  createSupplierManualOrderOffer(context:AdminMutationContext,input:Record<string,unknown>):Promise<{record:ManualCommercialOrderView;replayed:boolean}>;
  listMemberManualOrders(organizationId:string,limit?:number):Promise<ManualCommercialOrderBuyerView[]>;
  getMemberManualOrder(organizationId:string,orderId:string):Promise<ManualCommercialOrderBuyerView|null>;
  listSupplierManualOrders(organizationId:string,limit?:number):Promise<ManualCommercialOrderSupplierView[]>;
  getSupplierManualOrder(organizationId:string,orderId:string):Promise<ManualCommercialOrderSupplierView|null>;
  listAdminManualOrders(limit?:number):Promise<ManualCommercialOrderAdminView[]>;
  getAdminManualOrder(orderId:string):Promise<ManualCommercialOrderAdminView|null>;
  acceptMemberManualOrderOffer(context:AdminMutationContext,orderId:string,input:Record<string,unknown>):Promise<{record:ManualCommercialOrderBuyerView;replayed:boolean}>;
  transitionSupplierManualOrder(context:AdminMutationContext,orderId:string,action:"PREPARE"|"READY"|"SERVICE_COMPLETE",input:Record<string,unknown>):Promise<{record:ManualCommercialOrderView;replayed:boolean}>;
  transitionMemberManualOrder(context:AdminMutationContext,orderId:string,action:"CONFIRM_CONNECTION"|"ACCEPT_COMPLETION",input:Record<string,unknown>):Promise<{record:ManualCommercialOrderBuyerView;replayed:boolean}>;
}

declare global { var __kaiAdminOperationsStorePromise: Promise<AdminOperationsStore> | undefined; }

async function resolveAdminStore(): Promise<AdminOperationsStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) return (await import("./admin-store-d1.ts")).createD1AdminOperationsStore(cloudflare.env.DB);
  } catch { /* Node deployments do not expose the Workers module. */ }
  return (await import("./admin-store-sqlite.ts")).createSqliteAdminOperationsStore();
}

export function getAdminOperationsStore() {
  globalThis.__kaiAdminOperationsStorePromise ??= resolveAdminStore().catch((error) => {
    globalThis.__kaiAdminOperationsStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiAdminOperationsStorePromise;
}
