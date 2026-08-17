import type { HostingAgentCommand, HostingContract, HostingDevice } from "../hosting-v2.ts";
import { AccessGatewayClient, AccessGatewayClientError, accessGatewayCapability, type AccessGatewayLease } from "./access-gateway-client.ts";
import type { HostingV2Store } from "./hosting-v2-store.ts";

type GatewayClient = Pick<AccessGatewayClient, "createLease" | "leaseStatus" | "revokeLease">;

export type HostingGatewayCommandResult = Readonly<{
  natClosedLoop: boolean;
  action: "CREATED" | "SLOT_CONFIRMED" | "REVOKED" | "NOT_CONFIGURED";
  readyForContract: boolean;
  leaseId?: string;
  buyerEndpoint?: string;
  agentBundle?: AccessGatewayLease["agentBundle"];
}>;

function gatewayExpiry(contract: HostingContract, now: string) {
  const minimumSeconds = 5 * 60;
  const acceptanceSeconds = Number.isSafeInteger(contract.snapshot.acceptanceWindowSeconds) ? contract.snapshot.acceptanceWindowSeconds : 0;
  const requestedSeconds = Math.max(minimumSeconds, contract.reservedSeconds + acceptanceSeconds + 24 * 60 * 60);
  const maximumSeconds = 32 * 24 * 60 * 60 - 60;
  return new Date(Date.parse(now) + Math.min(requestedSeconds, maximumSeconds) * 1_000).toISOString();
}

function needsRevocation(command: HostingAgentCommand, outcome: "SUCCEEDED" | "FAILED") {
  return command.type === "CLEANUP" || (outcome === "FAILED" && ["PROVISION", "START", "STOP"].includes(command.type));
}

export async function prepareHostingGatewayCommand(input: {
  store: HostingV2Store;
  command: HostingAgentCommand;
  device: HostingDevice;
  outcome: "SUCCEEDED" | "FAILED";
  now: string;
  client?: GatewayClient;
}): Promise<HostingGatewayCommandResult | null> {
  if (!input.command.contractId || (input.command.type !== "PROVISION" && !needsRevocation(input.command, input.outcome))) return null;
  const contractId = input.command.contractId;
  const binding = await input.store.gatewayBinding(contractId);
  const capability = accessGatewayCapability();
  if (input.command.type === "PROVISION" && input.outcome === "SUCCEEDED") {
    if (binding?.status === "SLOT_CONFIRMED") return { natClosedLoop: true, action: "SLOT_CONFIRMED", readyForContract: true, leaseId: binding.leaseId, buyerEndpoint: binding.buyerEndpoint };
    if (binding?.status === "REVOCATION_REQUIRED" || binding?.status === "REVOKED") {
      throw new AccessGatewayClientError("ACCESS_GATEWAY_BINDING_NOT_ACTIVE", "合同 Access Gateway 已进入撤权流程，不能继续开通。 ", 409);
    }
    if (!capability.configured) {
      const localAcceptance = process.env.KAI_ENVIRONMENT?.trim().toUpperCase() === "LOCAL"
        && ["1", "true"].includes((process.env.KAI_HOSTING_LOCAL_ACCEPTANCE ?? "").trim().toLowerCase());
      if (!binding && localAcceptance) return { natClosedLoop: false, action: "NOT_CONFIGURED", readyForContract: true };
      throw new AccessGatewayClientError(capability.reason ?? "ACCESS_GATEWAY_CONFIGURATION_MISSING", "KAI Access Gateway 未配置，NAT 合同状态未推进。 ");
    }
    const client = input.client ?? new AccessGatewayClient();
    if (binding) {
      const status = await client.leaseStatus(contractId);
      if (status.status === "ACTIVE" && status.authenticatedAgentSlots > 0) {
        const confirmed = await input.store.markGatewaySlotConfirmed(contractId, input.now);
        return { natClosedLoop: true, action: "SLOT_CONFIRMED", readyForContract: true, leaseId: confirmed.leaseId, buyerEndpoint: confirmed.buyerEndpoint };
      }
    }
    const contract = await input.store.contractForViewer(input.device.organizationId, contractId);
    if (!contract) throw new Error("HOSTING_ACCESS_GATEWAY_CONTRACT_NOT_FOUND");
    const lease = await client.createLease({
      contractId: contract.id,
      deviceId: input.device.id,
      expiresAt: binding?.expiresAt ?? gatewayExpiry(contract, input.now),
      targetPort: input.device.inventory.sshPortStart,
    });
    const recorded = await input.store.recordGatewayLease({ contractId: contract.id, deviceId: input.device.id, leaseId: lease.leaseId, buyerEndpoint: lease.buyerEndpoint, expiresAt: lease.expiresAt }, input.now);
    return { natClosedLoop: true, action: "CREATED", readyForContract: false, leaseId: recorded.leaseId, buyerEndpoint: recorded.buyerEndpoint, agentBundle: lease.agentBundle };
  }

  if (!binding) return { natClosedLoop: false, action: "NOT_CONFIGURED", readyForContract: true };
  if (binding.status === "REVOKED") return { natClosedLoop: true, action: "REVOKED", readyForContract: true, leaseId: binding.leaseId };
  if (!capability.configured) {
    await input.store.markGatewayRevocationRequired(contractId, capability.reason ?? "ACCESS_GATEWAY_CONFIGURATION_MISSING", input.now);
    throw new AccessGatewayClientError(capability.reason ?? "ACCESS_GATEWAY_CONFIGURATION_MISSING", "KAI Access Gateway 撤权配置缺失，合同终态未推进。 ");
  }
  const client = input.client ?? new AccessGatewayClient();
  try {
    await client.revokeLease(contractId, `${input.command.type}_${input.outcome}`);
    const revoked = await input.store.markGatewayRevoked(contractId, input.now);
    return { natClosedLoop: true, action: "REVOKED", readyForContract: true, leaseId: revoked.leaseId };
  } catch (error) {
    const errorCode = error instanceof AccessGatewayClientError ? error.code : "ACCESS_GATEWAY_REVOCATION_FAILED";
    await input.store.markGatewayRevocationRequired(contractId, errorCode, input.now);
    throw error;
  }
}

export async function revokeHostingGatewayBeforeCancellation(store: HostingV2Store, contractId: string, reason: string, now: string, client?: GatewayClient) {
  const binding = await store.gatewayBinding(contractId);
  if (!binding) return { natClosedLoop: false, action: "NOT_CONFIGURED" as const };
  if (binding.status === "REVOKED") return { natClosedLoop: true, action: "REVOKED" as const };
  const capability = accessGatewayCapability();
  if (!capability.configured) {
    await store.markGatewayRevocationRequired(contractId, capability.reason ?? "ACCESS_GATEWAY_CONFIGURATION_MISSING", now);
    throw new AccessGatewayClientError(capability.reason ?? "ACCESS_GATEWAY_CONFIGURATION_MISSING", "KAI Access Gateway 撤权配置缺失，合同取消未推进。 ");
  }
  try {
    await (client ?? new AccessGatewayClient()).revokeLease(contractId, reason);
    await store.markGatewayRevoked(contractId, now);
    return { natClosedLoop: true, action: "REVOKED" as const };
  } catch (error) {
    await store.markGatewayRevocationRequired(contractId, error instanceof AccessGatewayClientError ? error.code : "ACCESS_GATEWAY_REVOCATION_FAILED", now);
    throw error;
  }
}
