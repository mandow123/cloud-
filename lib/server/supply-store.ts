import type {
  AgentEnrollment,
  AllocationBinding,
  AvailabilityInput,
  AvailabilityWindow,
  ComponentInput,
  CreateSupplyOfferInput,
  CreatePoolInput,
  ExchangeBinding,
  MacInventoryItem,
  MemberInput,
  PromotionPolicy,
  SupplyAssetMember,
  SupplyAssetPool,
  SupplyComponent,
  SupplyMutationContext,
  SupplyPromotion,
  SupplyOffer,
  SupplyConnectionCheck,
  SupplyTrialDelivery,
  SupplyTrialOrder,
  SupplyTrialPayment,
  SupplyTrialPaymentEvent,
  VerificationEvidence,
  VerificationJob,
} from "./supply-domain.ts";

export type SupplyMutationResult<T> = Readonly<{ record: T; replayed: boolean }>;

export type PromotionPreview = Readonly<{
  pool: SupplyAssetPool;
  policy: PromotionPolicy;
  windows: ReadonlyArray<AvailabilityWindow & { nodeHours: number }>;
  committedNodeHours: number;
  candidateNodeHours: number;
  remainingNodeHours: number;
  publishable: boolean;
  blockers: readonly string[];
}>;

export interface SupplyStore {
  listOffers(actorId: string): Promise<SupplyOffer[]>;
  createOffer(context: SupplyMutationContext, input: CreateSupplyOfferInput): Promise<SupplyMutationResult<SupplyOffer>>;
  listPools(actorId: string): Promise<Array<{ pool: SupplyAssetPool; policy: PromotionPolicy; memberCount: number; verifiedCount: number }>>;
  getPool(actorId: string, poolId: string): Promise<{ pool: SupplyAssetPool; policy: PromotionPolicy }>;
  createPool(context: SupplyMutationContext, input: CreatePoolInput): Promise<SupplyMutationResult<{ pool: SupplyAssetPool; policy: PromotionPolicy }>>;
  listMembers(actorId: string, poolId: string): Promise<SupplyAssetMember[]>;
  batchMembers(poolId: string, context: SupplyMutationContext, items: readonly MemberInput[]): Promise<SupplyMutationResult<{ items: SupplyAssetMember[] }>>;
  importMacInventory(context: SupplyMutationContext, items: readonly MacInventoryItem[]): Promise<SupplyMutationResult<{ groups: Array<{ pool: SupplyAssetPool; policy: PromotionPolicy; items: SupplyAssetMember[] }> }>>;
  listComponents(actorId: string, memberId: string): Promise<SupplyComponent[]>;
  batchComponents(memberId: string, context: SupplyMutationContext, items: readonly ComponentInput[]): Promise<SupplyMutationResult<{ items: SupplyComponent[] }>>;
  createEnrollment(context: SupplyMutationContext, input: { memberId: string; publicKeyDigest: string }): Promise<SupplyMutationResult<AgentEnrollment>>;
  heartbeat(enrollmentId: string, context: SupplyMutationContext, input: { observedAt: string; payloadDigest: string }): Promise<SupplyMutationResult<AgentEnrollment>>;
  createVerificationJob(context: SupplyMutationContext, memberId: string): Promise<SupplyMutationResult<VerificationJob>>;
  getVerificationJob(actorId: string, jobId: string, allowOps?: boolean): Promise<{ job: VerificationJob; evidence: VerificationEvidence[] }>;
  addVerificationEvidence(jobId: string, context: SupplyMutationContext, input: Omit<VerificationEvidence, "id" | "jobId" | "createdAt">): Promise<SupplyMutationResult<VerificationEvidence>>;
  completeVerification(jobId: string, context: SupplyMutationContext, input: { decision: "PASS" | "FAIL"; validUntil: string | null }): Promise<SupplyMutationResult<VerificationJob>>;
  batchAvailability(poolId: string, context: SupplyMutationContext, items: readonly AvailabilityInput[]): Promise<SupplyMutationResult<{ items: AvailabilityWindow[] }>>;
  listAvailability(actorId: string, poolId: string): Promise<AvailabilityWindow[]>;
  previewPromotion(actorId: string, poolId: string, windowIds: readonly string[]): Promise<PromotionPreview>;
  commitPromotion(poolId: string, context: SupplyMutationContext, windowIds: readonly string[]): Promise<SupplyMutationResult<{ promotions: SupplyPromotion[]; bindings: ExchangeBinding[] }>>;
  listPromotions(actorId?: string): Promise<SupplyPromotion[]>;
  createTrialOrder(context: SupplyMutationContext, input: { promotionId: string; startAt: string; endAt: string }): Promise<SupplyMutationResult<SupplyTrialOrder>>;
  getTrialOrder(actorId: string, orderId: string, role: "buyer" | "supplier" | "ops"): Promise<{
    order: SupplyTrialOrder;
    allocation: AllocationBinding;
    payment: SupplyTrialPayment | null;
    paymentEvents: SupplyTrialPaymentEvent[];
    delivery: SupplyTrialDelivery | null;
    connectionChecks: SupplyConnectionCheck[];
  }>;
  listTrialOrders(actorId: string, role: "buyer" | "supplier" | "ops"): Promise<SupplyTrialOrder[]>;
  transitionTrialOrder(orderId: string, context: SupplyMutationContext, input: { expectedVersion: number; toStatus: SupplyTrialOrder["status"]; reason: string }): Promise<SupplyMutationResult<SupplyTrialOrder>>;
  ensureTrialPayment(orderId: string, context: SupplyMutationContext, input: { provider: string; providerOrderRef: string }): Promise<SupplyMutationResult<SupplyTrialPayment>>;
  applyTrialPaymentEvent(orderId: string, context: SupplyMutationContext, input: {
    provider: string;
    providerEventRef: string;
    providerTransactionRef: string | null;
    eventType: string;
    amountCents: number;
    payloadDigest: string;
    outcome: SupplyTrialPaymentEvent["outcome"];
    occurredAt: string;
    toStatus: SupplyTrialPayment["status"];
  }): Promise<SupplyMutationResult<{ payment: SupplyTrialPayment; event: SupplyTrialPaymentEvent }>>;
  updateTrialDelivery(orderId: string, context: SupplyMutationContext, input: {
    expectedVersion: number;
    toStatus: SupplyTrialDelivery["status"];
    buyerPublicKeyFingerprint?: string | null;
    secureEndpointRef?: string | null;
    hostKeyFingerprint?: string | null;
    credentialExpiresAt?: string | null;
    cleanupEvidenceDigest?: string | null;
  }): Promise<SupplyMutationResult<SupplyTrialDelivery>>;
  recordTrialConnectionCheck(orderId: string, context: SupplyMutationContext, input: Omit<SupplyConnectionCheck, "id" | "orderId">): Promise<SupplyMutationResult<SupplyConnectionCheck>>;
}

declare global {
  var __kaiSupplyStorePromise: Promise<SupplyStore> | undefined;
}

async function resolveSupplyStore(): Promise<SupplyStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) {
      const { createD1SupplyStore } = await import("./supply-store-d1.ts");
      return createD1SupplyStore(cloudflare.env.DB);
    }
  } catch {
    // Node deployments do not expose the Cloudflare environment module.
  }
  const { createSqliteSupplyStore } = await import("./supply-store-sqlite.ts");
  return createSqliteSupplyStore();
}

export function getSupplyStore() {
  globalThis.__kaiSupplyStorePromise ??= resolveSupplyStore().catch((error) => {
    globalThis.__kaiSupplyStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiSupplyStorePromise;
}
