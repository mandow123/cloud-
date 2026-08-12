import type { AccountSessionContext } from "./account-auth.ts";

export type CardHourDashboard = Readonly<{
  assetCode: "KAI_CREDIT_HOUR";
  rate: Readonly<{ cardHours: "1"; cny: "1.002"; topupBlockCardHours: "5"; topupBlockCny: "5.01" }>;
  balance: Readonly<{ availableMicros: number; heldMicros: number; lifetimeTopupMicros: number; lifetimeSpentMicros: number }>;
  topups: readonly Record<string, unknown>[];
  purchases: readonly Record<string, unknown>[];
  buybacks: readonly Record<string, unknown>[];
  income: Readonly<{ rentalPendingMicros: number; rentalVestedMicros: number; commissionPendingMicros: number; commissionVestedMicros: number }>;
  referral: Readonly<{ code: string; invitedOrganizations: number }>;
  ledger: readonly Record<string, unknown>[];
}>;

export interface CardHourStore {
  health(): Promise<Readonly<{ schemaVersion: number; integrity: "ok" }>>;
  dashboard(organizationId: string, now: string): Promise<CardHourDashboard>;
  createTopup(input: { account: AccountSessionContext; cardHourMicros: number; amountCents: number; idempotencyKey: string; payloadHash: string; now: string; expiresAt: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  getTopup(orderId: string): Promise<Record<string, unknown> | null>;
  applyTopupEvent(input: { orderId: string; providerEventId: string; providerTransactionId: string; eventType: "CAPTURED" | "CLOSED"; amountCents: number; payloadDigest: string; occurredAt: string; receivedAt: string }): Promise<{ applied: boolean }>;
  captureOrder(input: { account: AccountSessionContext; sourceSystem: "SUPPLY_PILOT" | "EXCHANGE"; orderId: string; amountMicros: number; cnyReferenceCents: number; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  holdHostingOrder(input: { account: AccountSessionContext; orderId: string; amountMicros: number; idempotencyKey: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; replayed: boolean }>;
  settleHostingOrder(input: { buyerOrganizationId: string; orderId: string; measuredSeconds: number; settledMicros: number; supplierOrganizationId: string; supplierIncomeMicros: number; commissionMicros: number; acceptanceMode: "BUYER" | "TIMEOUT"; acceptanceDeadlineAt: string; acceptanceActorId: string; acceptancePayloadHash: string; payloadHash: string; now: string }): Promise<{ record: Record<string, unknown>; referrerOrganizationId: string | null; applied: boolean }>;
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
