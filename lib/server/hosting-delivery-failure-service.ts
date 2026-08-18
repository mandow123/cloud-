import { accountAuthDigest } from "./account-auth.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import type { HostingAgentCommand } from "../hosting-v2.ts";
import type { HostingV2Store } from "./hosting-v2-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

type Dependencies = Readonly<{ hosting: HostingV2Store; cardHours: CardHourStore }>;

async function dependencies(value?: Dependencies): Promise<Dependencies> {
  return value ?? { hosting: await getHostingV2Store(), cardHours: await getCardHourStore() };
}

async function digest(value: unknown) {
  return accountAuthDigest(JSON.stringify(value));
}

export async function reconcileFailedHostingDelivery(command: HostingAgentCommand, now: string, injected?: Dependencies) {
  if (!command.contractId || !["PROVISION", "START"].includes(command.type) || command.status !== "FAILED" || !command.evidenceDigest || !command.errorCode) return null;
  const stores = await dependencies(injected);
  const refundPayloadHash = await digest({
    operation: "REFUND_FAILED_HOSTING_DELIVERY",
    commandId: command.id,
    contractId: command.contractId,
    failureStage: command.type,
    errorCode: command.errorCode,
    evidenceDigest: command.evidenceDigest,
  });
  const refund = await stores.cardHours.refundFailedHostingOrder({ commandId: command.id, payloadHash: refundPayloadHash, now });
  const cleanupPayloadHash = await digest({
    operation: "QUEUE_FAILED_HOSTING_DELIVERY_CLEANUP",
    commandId: command.id,
    contractId: command.contractId,
    failureStage: command.type,
  });
  const cleanup = await stores.hosting.queueFailedDeliveryCleanup(command.id, {
    actorId: "system:hosting-delivery-failure",
    idempotencyKey: `failed-delivery-cleanup:${command.id}`,
    payloadHash: cleanupPayloadHash,
    now,
  });
  return { refund, cleanup };
}
