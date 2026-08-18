import { accountAuthDigest } from "./account-auth.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import type { HostingMutationContext, HostingV2Store } from "./hosting-v2-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

type Dependencies = Readonly<{ hosting: HostingV2Store; cardHours: CardHourStore }>;

async function dependencies(value?: Dependencies): Promise<Dependencies> {
  return value ?? { hosting: await getHostingV2Store(), cardHours: await getCardHourStore() };
}

async function digest(value: unknown) {
  return accountAuthDigest(JSON.stringify(value));
}

export async function decideAndExecuteHostingDispute(input: {
  proposalId: string;
  decision: "APPROVE" | "REJECT";
  decisionReason: string;
  mutation: HostingMutationContext;
}, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const decided = await stores.hosting.decideDisputeResolution(input.proposalId, {
    decision: input.decision,
    decisionReason: input.decisionReason,
  }, input.mutation);
  if (input.decision === "REJECT") return { record: decided, ledger: null, cleanup: null };
  const executionHash = await digest({ operation: "EXECUTE_HOSTING_DISPUTE", proposalId: input.proposalId, contractId: decided.contractId, resolution: decided.proposedResolution });
  const ledger = await stores.cardHours.resolveHostingDispute({ proposalId: input.proposalId, payloadHash: executionHash, now: input.mutation.now });
  const cleanupHash = await digest({ operation: "QUEUE_HOSTING_DISPUTE_CLEANUP", proposalId: input.proposalId, contractId: decided.contractId, resolution: ledger.resolution });
  const cleanup = await stores.hosting.queueDisputeCleanup(input.proposalId, {
    actorId: "system:hosting-dispute",
    idempotencyKey: `dispute-cleanup:${input.proposalId}`,
    payloadHash: cleanupHash,
    now: input.mutation.now,
  });
  const finalRecord = (await stores.hosting.listDisputeCases()).find((item) => item.proposalId === input.proposalId) ?? decided;
  return { record: finalRecord, ledger, cleanup };
}
