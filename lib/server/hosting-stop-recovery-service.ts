import { accountAuthDigest } from "./account-auth.ts";
import type { HostingAgentCommand } from "../hosting-v2.ts";
import type { HostingV2Store } from "./hosting-v2-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

async function digest(value: unknown) {
  return accountAuthDigest(JSON.stringify(value));
}

export async function reconcileFailedHostingStop(command: HostingAgentCommand, now: string, injected?: HostingV2Store) {
  if (!command.contractId || command.type !== "STOP" || command.status !== "FAILED" || !command.evidenceDigest || !command.errorCode) return null;
  const store = injected ?? await getHostingV2Store();
  const payloadHash = await digest({
    operation: "QUEUE_FAILED_HOSTING_STOP_RECOVERY",
    commandId: command.id,
    contractId: command.contractId,
    errorCode: command.errorCode,
    evidenceDigest: command.evidenceDigest,
  });
  return store.queueFailedStopRecovery(command.id, {
    actorId: "system:hosting-stop-recovery",
    idempotencyKey: `failed-stop-recovery:${command.id}`,
    payloadHash,
    now,
  });
}
