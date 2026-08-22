import type { AccountSessionContext } from "./account-auth.ts";

export type CardHourPurchaseRecord = Readonly<{
  id: string;
  sourceSystem: string;
  orderId: string;
  amountMicros: number;
  cnyReferenceCents: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}>;

export type CardHourDashboard = Readonly<{
  assetCode: "KAI_CREDIT_HOUR";
  rate: Readonly<{ cardHours: "1"; cny: "1.002"; topupBlockCardHours: "5"; topupBlockCny: "5.01" }>;
  balance: Readonly<{ availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number }>;
  topups: readonly Record<string, unknown>[];
  appealNotifications: readonly CardHourTopupAppealRecord[];
  unreadAppealCount: number;
  purchases: readonly CardHourPurchaseRecord[];
  buybacks: readonly Record<string, unknown>[];
  income: Readonly<{ rentalPendingMicros: number; rentalVestedMicros: number; commissionPendingMicros: number; commissionVestedMicros: number }>;
  referral: Readonly<{ code: string; invitedOrganizations: number }>;
  ledger: readonly Readonly<{
    operation: string;
    business_key: string;
    account_code: "USER_AVAILABLE" | "USER_HELD";
    side: "DEBIT" | "CREDIT";
    amount_micros: number;
    balance_after_micros: number;
    created_at: string;
  }>[];
}>;

export type CardHourTopupProvider = "ALIPAY" | "QIXIANG_PAY";
export type CardHourTopupPaymentType = "alipay" | "wxpay";
export type CardHourTopupAppealReason = "PENDING_TIMEOUT" | "CLOSED_BUT_CHARGED" | "RECONCILIATION_REQUIRED";
export type CardHourTopupAppealStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED";
export type CardHourTopupAppealRecord = Readonly<{
  id: string;
  caseNumber: string;
  topupOrderId: string;
  organizationId: string;
  accountId: string;
  reason: CardHourTopupAppealReason;
  description: string;
  status: CardHourTopupAppealStatus;
  resolutionNote: string | null;
  assignedAdminPrincipalId: string | null;
  version: number;
  memberSeenVersion: number;
  unread: boolean;
  cardHourMicros: number;
  amountCents: number;
  topupStatus: string;
  channel: "ALIPAY" | "WXPAY" | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CardHourTopupAppealPage = Readonly<{
  records: readonly CardHourTopupAppealRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}>;

export interface CardHourStore {
  health(): Promise<Readonly<{ schemaVersion: number; integrity: "ok" }>>;
  dashboard(organizationId: string, now: string): Promise<CardHourDashboard>;
  createTopup(input: { account: AccountSessionContext; cardHourMicros: number; amountCents: number; provider?: CardHourTopupProvider; providerMerchantRef?: string | null; providerPaymentType?: CardHourTopupPaymentType | null; idempotencyKey: string; payloadHash: string; now: string; expiresAt: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  claimTopupCheckout(input: { organizationId: string; orderId: string; now: string }): Promise<{ claimed: boolean; record: Record<string, unknown> }>;
  registerTopupReconciliationRequest(input: { organizationId: string; orderId: string; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ replayed: boolean }>;
  claimTopupReconciliation(input: { organizationId: string; orderId: string; now: string; staleBefore: string; nextEligibleAt: string }): Promise<{ claimed: boolean; claimToken: string | null; record: Record<string, unknown> }>;
  releaseTopupReconciliation(input: { organizationId: string; orderId: string; claimToken: string; now: string; nextEligibleAt: string }): Promise<void>;
  attachTopupCheckout(input: { organizationId: string; orderId: string; checkoutUrl: string; now: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  markTopupReconciliationRequired(input: { organizationId: string; orderId: string; now: string }): Promise<void>;
  getTopup(orderId: string): Promise<Record<string, unknown> | null>;
  getTopupForOrganization(organizationId: string, orderId: string): Promise<Record<string, unknown> | null>;
  createTopupAppeal(input: { account: AccountSessionContext; orderId: string; reason: CardHourTopupAppealReason; description: string; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ record: CardHourTopupAppealRecord; replayed: boolean }>;
  getTopupAppealForOrganization(organizationId: string, orderId: string): Promise<CardHourTopupAppealRecord | null>;
  acknowledgeTopupAppeal(input: { organizationId: string; orderId: string; now: string }): Promise<CardHourTopupAppealRecord>;
  listTopupAppeals(input?: { page?: number; pageSize?: number; status?: CardHourTopupAppealStatus; orderId?: string; organizationId?: string }): Promise<CardHourTopupAppealPage>;
  transitionTopupAppeal(input: { appealId: string; action: "START_REVIEW" | "RESOLVE" | "CLOSE"; expectedVersion: number; resolutionNote?: string; adminPrincipalId: string; payloadHash: string; now: string }): Promise<{ record: CardHourTopupAppealRecord; replayed: boolean }>;
  applyTopupEvent(input: { orderId: string; provider?: CardHourTopupProvider; providerEventId: string; providerTransactionId: string; eventType: "CAPTURED" | "CLOSED"; amountCents: number; payloadDigest: string; occurredAt: string; receivedAt: string }): Promise<{ applied: boolean }>;
  captureOrder(input: { account: AccountSessionContext; sourceSystem: "SUPPLY_PILOT" | "EXCHANGE"; orderId: string; amountMicros: number; cnyReferenceCents: number; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  holdHostingOrder(input: { account: AccountSessionContext; orderId: string; amountMicros: number; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  settleHostingOrder(input: { buyerOrganizationId: string; orderId: string; measuredSeconds: number; settledMicros: number; supplierOrganizationId: string; supplierIncomeMicros: number; commissionMicros: number; acceptanceMode: "BUYER" | "TIMEOUT"; acceptanceDeadlineAt: string; acceptanceActorId: string; acceptancePayloadHash: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; referrerOrganizationId: string | null; applied: boolean }>;
  resolveHostingDispute(input: { proposalId: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; resolution: "REFUND" | "SETTLE"; settledMicros: number; supplierIncomeMicros: number; commissionMicros: number; applied: boolean }>;
  refundFailedHostingOrder(input: { commandId: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; contractId: string; amountMicros: number; applied: boolean }>;
  releaseHostingOrder(input: { account: AccountSessionContext; orderId: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; applied: boolean }>;
  listTrialGrants(status?: "REQUESTED" | "POSTED" | "REJECTED"): Promise<readonly Record<string, unknown>[]>;
  requestTrialGrant(input: { organizationId: string; amountMicros: number; reason: string; requestedBy: string; idempotencyKey: string; payloadHash: string; now: string }): Promise<Record<string, unknown>>;
  decideTrialGrant(input: { grantId: string; decision: "APPROVE" | "REJECT"; approvedBy: string; payloadHash: string; now: string }): Promise<Record<string, unknown>>;
  attachReferral(input: { account: AccountSessionContext; code: string; now: string }): Promise<void>;
}

declare global { var __kaiCardHourStorePromise: Promise<CardHourStore> | undefined; }

async function resolveStore(): Promise<CardHourStore> {
  try {
    const cloudflare = await import("cloudflare:workers");
    if (cloudflare.env.DB) return (await import("./card-hour-store-d1.ts")).createD1CardHourStore(cloudflare.env.DB);
  } catch { /* Node runtime. */ }
  return (await import("./card-hour-store-sqlite.ts")).createSqliteCardHourStore();
}

export function getCardHourStore() {
  globalThis.__kaiCardHourStorePromise ??= resolveStore().catch((error) => {
    globalThis.__kaiCardHourStorePromise = undefined;
    throw error;
  });
  return globalThis.__kaiCardHourStorePromise;
}
