import { hostingCardHourMicrosForSeconds, type HostingContract } from "../hosting-v2.ts";
import { accountAuthDigest, type AccountSessionContext } from "./account-auth.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import type { HostingMutationContext, HostingV2Store } from "./hosting-v2-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";

type Dependencies = Readonly<{ hosting: HostingV2Store; cardHours: CardHourStore }>;

async function dependencies(value?: Dependencies): Promise<Dependencies> {
  return value ?? { hosting: await getHostingV2Store(), cardHours: await getCardHourStore() };
}

async function internalHash(value: unknown) {
  return accountAuthDigest(JSON.stringify(value));
}

function internalMutation(actorId: string, idempotencyKey: string, payloadHash: string, now: string): HostingMutationContext {
  return { actorId, idempotencyKey, payloadHash, now };
}

async function compensateReservation(input: { account: AccountSessionContext; contract: HostingContract; now: string; reason: string }, stores: Dependencies) {
  try {
    await stores.cardHours.releaseHostingOrder({ account: input.account, orderId: input.contract.id, payloadHash: await internalHash({ operation: "RELEASE_HOSTING_HOLD", contractId: input.contract.id, reason: input.reason }), now: input.now });
  } catch { /* A hold may not have been created before the failure. */ }
  try {
    await stores.hosting.cancelContract(input.contract.id, input.reason, internalMutation(input.account.account.id, `reserve-compensation:${input.contract.id}`, await internalHash({ operation: "CANCEL_FAILED_RESERVATION", contractId: input.contract.id, reason: input.reason }), input.now));
  } catch { /* Preserve the original failure; retries resume from persisted state. */ }
}

export async function reserveHostingContract(input: {
  account: AccountSessionContext;
  offerId: string;
  reservedSeconds: number;
  mutation: HostingMutationContext;
}, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const offer = await stores.hosting.getOffer(input.offerId);
  if (!offer) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "GPU 挂牌不存在。");
  const heldMicros = hostingCardHourMicrosForSeconds(offer.cardHourMicrosPerGpuHour, input.reservedSeconds);
  const contract = await stores.hosting.reserveContract(input.account, input.offerId, input.reservedSeconds, heldMicros, input.mutation);
  if (["CANCELLED", "FAILED", "DISPUTED", "REFUNDED", "CLEANED"].includes(contract.status)) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "该预留已经终止，请重新选择资源。");
  try {
    const holdPayloadHash = await internalHash({ operation: "HOLD_HOSTING_ORDER", contractId: contract.id, heldMicros });
    const hold = await stores.cardHours.holdHostingOrder({ account: input.account, orderId: contract.id, amountMicros: heldMicros, idempotencyKey: `hosting-hold:${contract.id}`, payloadHash: holdPayloadHash, now: input.mutation.now });
    if (String(hold.record.status) !== "HELD") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单卡时锁定状态不一致。");
    const finalContract = contract.status === "RESERVED"
      ? await stores.hosting.markContractHeld(input.account.activeOrganization.id, contract.id, internalMutation(input.account.account.id, `mark-held:${contract.id}`, await internalHash({ operation: "MARK_CONTRACT_HELD", contractId: contract.id }), input.mutation.now))
      : contract;
    return { contract: finalContract, hold: hold.record, heldMicros, replayed: hold.replayed || contract.status !== "RESERVED" };
  } catch (error) {
    await compensateReservation({ account: input.account, contract, now: input.mutation.now, reason: "卡时锁定或合同确认失败，自动取消预留" }, stores);
    throw error;
  }
}

export async function cancelHostingContract(input: {
  account: AccountSessionContext;
  contractId: string;
  reason: string;
  mutation: HostingMutationContext;
}, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const current = await stores.hosting.contractForViewer(input.account.activeOrganization.id, input.contractId);
  if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
  if (current.buyerOrganizationId !== input.account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有采购方可以取消本次预留。");
  const contract = await stores.hosting.cancelContract(input.contractId, input.reason, input.mutation);
  let hold: Record<string, unknown> | null = null;
  try {
    const released = await stores.cardHours.releaseHostingOrder({ account: input.account, orderId: input.contractId, payloadHash: await internalHash({ operation: "RELEASE_HOSTING_HOLD", contractId: input.contractId, reason: input.reason }), now: input.mutation.now });
    hold = released.record;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "CARD_HOUR_HOLD_NOT_FOUND")) throw error;
  }
  return { contract, hold };
}
