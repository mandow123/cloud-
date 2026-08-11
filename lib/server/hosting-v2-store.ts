import type {
  HostingAgentChallenge,
  HostingAgentCommand,
  HostingContract,
  HostingDashboard,
  HostingDevice,
  HostingDeviceInventory,
  HostingFeeSchedule,
  HostingGpuModel,
  HostingOffer,
  HostingSupplierProfile,
  HostingSupplierType,
} from "../hosting-v2.ts";
import type { AccountSessionContext } from "./account-auth.ts";

export type HostingV2Sql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export interface HostingV2DatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(items: readonly HostingV2Sql[]): Promise<Array<{ changes: number }>>;
  ensureSchema(statements: readonly string[], version: number): Promise<void>;
}

export type HostingMutationContext = Readonly<{ actorId: string; idempotencyKey: string; payloadHash: string; now: string }>;

export type HostingV2OperationalSnapshot = Readonly<{
  schemaVersion: number;
  integrity: "ok";
  activeFeeScheduleId: string | null;
  approvedSupplierCount: number;
  activeAgentCount: number;
  drainingDeviceCount: number;
  failedCleanupCount: number;
  cleaningContractCount: number;
}>;

export interface HostingV2Store {
  readiness(now: string): Promise<HostingV2OperationalSnapshot>;
  dashboard(organizationId: string, now: string): Promise<HostingDashboard>;
  saveProfile(account: AccountSessionContext, input: { supplierType: HostingSupplierType; legalDisplayName: string; contactEmail: string; expectedVersion: number }, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  submitProfile(organizationId: string, expectedVersion: number, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  listProfiles(): Promise<HostingSupplierProfile[]>;
  reviewProfile(organizationId: string, input: { decision: "APPROVE" | "REJECT" | "SUSPEND"; expectedVersion: number; reviewNote: string; evidenceDigest?: string | null }, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  issueAgentChallenge(account: AccountSessionContext, context: HostingMutationContext): Promise<HostingAgentChallenge>;
  getAgentChallenge(id: string): Promise<HostingAgentChallenge | null>;
  registerDevice(challengeId: string, input: { displayName: string; deviceKeyId: string; devicePublicKey: string; agentVersion: string; inventory: HostingDeviceInventory; inventoryDigest: string }, context: HostingMutationContext): Promise<HostingDevice>;
  getDevice(id: string): Promise<HostingDevice | null>;
  acceptHeartbeat(deviceId: string, input: { sequence: number; inventoryDigest: string; capacityState: "ONLINE" | "BUSY" | "DRAINING" | "OFFLINE"; observedAt: string }, context: HostingMutationContext): Promise<HostingDevice>;
  queueVerification(organizationId: string, deviceId: string, context: HostingMutationContext): Promise<HostingAgentCommand>;
  createFeeSchedule(input: { platformFeeBps: number; referralRewardBps: number; activate: boolean; effectiveFrom: string }, context: HostingMutationContext): Promise<HostingFeeSchedule>;
  activeFeeSchedule(now: string): Promise<HostingFeeSchedule | null>;
  createOffer(organizationId: string, input: { deviceId: string; title: string; gpuModel: HostingGpuModel; region: string; cardHourMicrosPerGpuHour: number; minRentalSeconds: number; maxRentalSeconds: number; availableFrom: string; availableUntil: string; approvedImage: string; termsVersion: string }, context: HostingMutationContext): Promise<HostingOffer>;
  updateOfferStatus(organizationId: string, offerId: string, input: { status: "PUBLISHED" | "PAUSED" | "UNLISTED"; expectedVersion: number }, context: HostingMutationContext): Promise<HostingOffer>;
  listPublicOffers(now: string): Promise<HostingOffer[]>;
  getOffer(id: string): Promise<HostingOffer | null>;
  reserveContract(account: AccountSessionContext, offerId: string, reservedSeconds: number, heldMicros: number, context: HostingMutationContext): Promise<HostingContract>;
  markContractHeld(buyerOrganizationId: string, contractId: string, context: HostingMutationContext): Promise<HostingContract>;
  attachSshKey(buyerOrganizationId: string, contractId: string, input: { publicKey: string; fingerprint: string }, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  requestContractStart(buyerOrganizationId: string, contractId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  requestContractStop(organizationId: string, contractId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  contractForViewer(organizationId: string, contractId: string): Promise<HostingContract | null>;
  pollCommand(deviceId: string, now: string): Promise<HostingAgentCommand | null>;
  completeCommand(deviceId: string, commandId: string, input: { outcome: "SUCCEEDED" | "FAILED"; evidenceDigest: string; errorCode?: string | null; details?: Record<string, unknown> }, context: HostingMutationContext): Promise<{ command: HostingAgentCommand; contract: HostingContract | null; device: HostingDevice }>;
  markContractSettled(contractId: string, input: { measuredSeconds: number; settledMicros: number; supplierIncomeMicros: number; commissionMicros: number }, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  cancelContract(contractId: string, reason: string, context: HostingMutationContext): Promise<HostingContract>;
}

let singleton: Promise<HostingV2Store> | null = null;
export async function getHostingV2Store(): Promise<HostingV2Store> {
  if (singleton) return singleton;
  singleton = (async () => {
    try {
      const cloudflare = await import("cloudflare:workers");
      if (cloudflare.env.DB) return (await import("./hosting-v2-store-d1.ts")).createD1HostingV2Store(cloudflare.env.DB);
    } catch { /* Node deployments do not expose Cloudflare bindings. */ }
    return (await import("./hosting-v2-store-sqlite.ts")).createSqliteHostingV2Store();
  })();
  return singleton;
}
