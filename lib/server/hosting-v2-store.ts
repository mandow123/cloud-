import type {
  HostingAgentChallenge,
  HostingAgentRegistration,
  HostingAgentCommand,
  HostingCleanupIncident,
  HostingContract,
  HostingContractEvidence,
  HostingDashboard,
  HostingDisputeCase,
  HostingDevice,
  HostingDeviceRetirement,
  HostingDeviceInventory,
  HostingFeeSchedule,
  HostingGoldenLoopAudit,
  HostingGpuModel,
  HostingOffer,
  HostingPublicOffer,
  HostingSupplierProfile,
  HostingSupplierFeePreview,
  HostingSupplierMonthlySettlement,
  HostingSupplierType,
  HostingStopIncident,
} from "../hosting-v2.ts";
import type { AccountSessionContext } from "./account-auth.ts";

export type HostingV2Sql = Readonly<{ sql: string; values?: readonly unknown[] }>;
export interface HostingV2DatabaseAdapter {
  first<T>(sql: string, values?: readonly unknown[]): Promise<T | null>;
  all<T>(sql: string, values?: readonly unknown[]): Promise<T[]>;
  batch(items: readonly HostingV2Sql[]): Promise<Array<{ changes: number }>>;
  ensureSchema(statements: readonly string[], version: number, compatibleThrough?: number): Promise<void>;
}

export type HostingMutationContext = Readonly<{ actorId: string; idempotencyKey: string; payloadHash: string; now: string }>;

export type HostingGatewayBinding = Readonly<{
  contractId: string;
  deviceId: string;
  leaseId: string;
  mode: "ACCESS_GATEWAY";
  status: "LEASE_CREATED" | "SLOT_CONFIRMED" | "REVOCATION_REQUIRED" | "REVOKED";
  buyerEndpoint: string;
  expiresAt: string;
  lastErrorCode: string | null;
  createdAt: string;
  slotConfirmedAt: string | null;
  revocationRequiredAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
}>;

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
  listCleanupIncidents(): Promise<HostingCleanupIncident[]>;
  listStopIncidents(): Promise<HostingStopIncident[]>;
  listDisputeCases(): Promise<HostingDisputeCase[]>;
  auditGoldenLoop(contractId: string, now: string): Promise<HostingGoldenLoopAudit | null>;
  dashboard(organizationId: string, now: string): Promise<HostingDashboard>;
  saveProfile(account: AccountSessionContext, input: { supplierType: HostingSupplierType; legalDisplayName: string; contactEmail: string; expectedVersion: number }, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  submitProfile(organizationId: string, expectedVersion: number, agreementVersion: string, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  listProfiles(): Promise<HostingSupplierProfile[]>;
  reviewProfile(organizationId: string, input: { decision: "APPROVE" | "REJECT" | "SUSPEND"; expectedVersion: number; reviewNote: string; evidenceDigest?: string | null }, context: HostingMutationContext): Promise<HostingSupplierProfile>;
  issueAgentChallenge(account: AccountSessionContext, context: HostingMutationContext): Promise<HostingAgentChallenge>;
  revokeAgentChallenge(organizationId: string, challengeId: string, context: HostingMutationContext): Promise<HostingAgentChallenge>;
  getAgentChallenge(id: string): Promise<HostingAgentChallenge | null>;
  getAgentRegistration(organizationId: string, challengeId: string): Promise<HostingAgentRegistration | null>;
  registerDevice(challengeId: string, input: { displayName: string; deviceKeyId: string; devicePublicKey: string; agentVersion: string; inventory: HostingDeviceInventory; inventoryDigest: string }, context: HostingMutationContext): Promise<HostingDevice>;
  getDevice(id: string): Promise<HostingDevice | null>;
  getDeviceRetirement(organizationId: string | null, deviceId: string): Promise<HostingDeviceRetirement | null>;
  requestDeviceRetirement(organizationId: string | null, deviceId: string, input: { mode: "GRACEFUL" | "EMERGENCY"; expectedDeviceVersion: number; reasonCode: string; reason: string; evidenceDigest?: string | null }, context: HostingMutationContext): Promise<{ retirement: HostingDeviceRetirement; device: HostingDevice }>;
  finalizeDeviceRetirement(deviceId: string, input: { expectedDeviceVersion: number; expectedRetirementVersion: number; evidenceDigest: string; finalizationReason: string }, context: HostingMutationContext): Promise<{ retirement: HostingDeviceRetirement; device: HostingDevice }>;
  acceptHeartbeat(deviceId: string, input: { sequence: number; inventoryDigest: string; capacityState: "ONLINE" | "BUSY" | "DRAINING" | "OFFLINE"; observedAt: string }, context: HostingMutationContext): Promise<HostingDevice>;
  queueVerification(organizationId: string, deviceId: string, context: HostingMutationContext): Promise<HostingAgentCommand>;
  createFeeSchedule(input: { platformFeeBps: number; referralRewardBps: number; activate: boolean; effectiveFrom: string }, context: HostingMutationContext): Promise<HostingFeeSchedule>;
  activeFeeSchedule(now: string): Promise<HostingFeeSchedule | null>;
  supplierFeePreview(organizationId: string, now: string): Promise<HostingSupplierFeePreview>;
  supplierMonthlySettlement(organizationId: string, now: string): Promise<HostingSupplierMonthlySettlement>;
  createOffer(organizationId: string, input: { deviceId: string; title: string; gpuModel: HostingGpuModel; region: string; cardHourMicrosPerGpuHour: number; minRentalSeconds: number; maxRentalSeconds: number; availableFrom: string; availableUntil: string; approvedImage: string; termsVersion: string }, context: HostingMutationContext): Promise<HostingOffer>;
  updateOfferStatus(organizationId: string, offerId: string, input: { status: "PUBLISHED" | "PAUSED" | "UNLISTED"; expectedVersion: number }, context: HostingMutationContext): Promise<HostingOffer>;
  listPublicOffers(now: string): Promise<HostingPublicOffer[]>;
  getPublicOffer(id: string, now: string): Promise<HostingPublicOffer | null>;
  getOffer(id: string): Promise<HostingOffer | null>;
  reserveContract(account: AccountSessionContext, offerId: string, offerVersion: number, reservedSeconds: number, context: HostingMutationContext): Promise<HostingContract>;
  markContractHeld(buyerOrganizationId: string, contractId: string, context: HostingMutationContext): Promise<HostingContract>;
  attachSshKey(buyerOrganizationId: string, contractId: string, input: { publicKey: string; fingerprint: string }, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  requestContractStart(buyerOrganizationId: string, contractId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  requestContractStop(organizationId: string, contractId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  disputeContract(buyerOrganizationId: string, contractId: string, reason: string, context: HostingMutationContext): Promise<HostingContract>;
  requestDisputeResolution(contractId: string, input: { resolution: "REFUND" | "SETTLE"; expectedContractVersion: number; requestReason: string; evidenceDigest?: string | null }, context: HostingMutationContext): Promise<HostingDisputeCase>;
  decideDisputeResolution(proposalId: string, input: { decision: "APPROVE" | "REJECT"; decisionReason: string }, context: HostingMutationContext): Promise<HostingDisputeCase>;
  queueDisputeCleanup(proposalId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  contractForViewer(organizationId: string, contractId: string): Promise<HostingContract | null>;
  contractEvidenceForViewer(organizationId: string, contractId: string): Promise<HostingContractEvidence | null>;
  gatewayBinding(contractId: string): Promise<HostingGatewayBinding | null>;
  recordGatewayLease(input: { contractId: string; deviceId: string; leaseId: string; buyerEndpoint: string; expiresAt: string }, now: string): Promise<HostingGatewayBinding>;
  markGatewaySlotConfirmed(contractId: string, now: string): Promise<HostingGatewayBinding>;
  markGatewayRevocationRequired(contractId: string, errorCode: string, now: string): Promise<HostingGatewayBinding>;
  markGatewayRevoked(contractId: string, now: string): Promise<HostingGatewayBinding>;
  expiredAcceptanceForDevice(deviceId: string, now: string): Promise<HostingContract | null>;
  failedDeliveryForDevice(deviceId: string): Promise<HostingAgentCommand | null>;
  failedStopForDevice(deviceId: string): Promise<HostingAgentCommand | null>;
  getCommand(deviceId: string, commandId: string): Promise<HostingAgentCommand | null>;
  pollCommand(deviceId: string, now: string, allowedTypes?: readonly HostingAgentCommand["type"][]): Promise<HostingAgentCommand | null>;
  completeCommand(deviceId: string, commandId: string, input: { outcome: "SUCCEEDED" | "FAILED"; evidenceDigest: string; errorCode?: string | null; details?: Record<string, unknown>; controlPlaneReachabilityDigest?: string; transportAttestation?: { signedPayload: Record<string, unknown>; signature: string } }, context: HostingMutationContext): Promise<{ command: HostingAgentCommand; contract: HostingContract | null; device: HostingDevice }>;
  queueFailedDeliveryCleanup(commandId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  queueFailedStopRecovery(commandId: string, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand | null; exhausted: boolean }>;
  markContractSettled(contractId: string, input: { measuredSeconds: number; settledMicros: number; supplierIncomeMicros: number; commissionMicros: number }, context: HostingMutationContext): Promise<{ contract: HostingContract; command: HostingAgentCommand }>;
  retryCleanup(contractId: string, input: { expectedContractVersion: number; expectedDeviceVersion: number; reason: string }, context: HostingMutationContext): Promise<{ contract: HostingContract; device: HostingDevice; command: HostingAgentCommand }>;
  retryFailedStop(contractId: string, input: { expectedContractVersion: number; expectedDeviceVersion: number; reason: string }, context: HostingMutationContext): Promise<{ contract: HostingContract; device: HostingDevice; command: HostingAgentCommand }>;
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
