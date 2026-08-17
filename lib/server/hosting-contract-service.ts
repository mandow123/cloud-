import { HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS, hostingCardHourMicrosForSeconds, hostingFeeBreakdown, type HostingContract } from "../hosting-v2.ts";
import { accountAuthDigest, type AccountSessionContext } from "./account-auth.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { getCardHourStore } from "./card-hour-store.ts";
import { ExchangeDomainError } from "./exchange-errors.ts";
import type { HostingMutationContext, HostingV2Store } from "./hosting-v2-store.ts";
import { getHostingV2Store } from "./hosting-v2-store.ts";
import { revokeHostingGatewayBeforeCancellation } from "./hosting-access-gateway.ts";

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
  offerVersion: number;
  reservedSeconds: number;
  mutation: HostingMutationContext;
}, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const contract = await stores.hosting.reserveContract(input.account, input.offerId, input.offerVersion, input.reservedSeconds, input.mutation);
  const heldMicros = contract.heldMicros;
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
  await revokeHostingGatewayBeforeCancellation(stores.hosting, input.contractId, "CONTRACT_CANCELLED", input.mutation.now);
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

export async function acceptHostingContract(input: {
  account: AccountSessionContext;
  contractId: string;
  mutation: HostingMutationContext;
}, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const current = await stores.hosting.contractForViewer(input.account.activeOrganization.id, input.contractId);
  if (!current) throw new ExchangeDomainError("EXCHANGE_NOT_FOUND", 404, "租赁合同不存在。");
  if (current.buyerOrganizationId !== input.account.activeOrganization.id) throw new ExchangeDomainError("EXCHANGE_OWNERSHIP_FORBIDDEN", 403, "只有采购方可以验收本次服务。");
  return settleAcceptedContract(current, "BUYER", input.mutation, stores);
}

function acceptanceDeadline(contract: HostingContract) {
  const seconds = Number.isSafeInteger(contract.snapshot.acceptanceWindowSeconds) && contract.snapshot.acceptanceWindowSeconds >= 0
    ? contract.snapshot.acceptanceWindowSeconds
    : HOSTING_V2_ACCEPTANCE_WINDOW_SECONDS;
  if (!contract.stoppedAt || !Number.isFinite(Date.parse(contract.stoppedAt))) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同缺少有效的停止时间。");
  return new Date(Date.parse(contract.stoppedAt) + seconds * 1_000).toISOString();
}

async function settleAcceptedContract(current: HostingContract, acceptanceMode: "BUYER" | "TIMEOUT", mutation: HostingMutationContext, stores: Dependencies) {
  const replayed = current.status === "CLEANING" || current.status === "CLEANED";
  const acceptanceClaimed = current.status === "SETTLED";
  if (!replayed && !acceptanceClaimed && current.status !== "AWAITING_ACCEPTANCE") throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同当前不能验收结算。");
  const acceptanceDeadlineAt = acceptanceDeadline(current);
  if (acceptanceMode === "TIMEOUT" && Date.parse(mutation.now) < Date.parse(acceptanceDeadlineAt)) throw new ExchangeDomainError("HOSTING_ACCEPTANCE_WINDOW_ACTIVE", 409, "买家验收时间尚未结束。");
  const measuredSeconds = current.measuredSeconds;
  if (!measuredSeconds || measuredSeconds < 180) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "合同缺少有效的服务端计量结果。");
  const evidence = await stores.hosting.contractEvidenceForViewer(current.buyerOrganizationId, current.id);
  if (!evidence?.metering || evidence.metering.serverMeasuredSeconds !== measuredSeconds || !["STOPPED", "CLEANED"].includes(evidence.instance?.status ?? "")) {
    throw new ExchangeDomainError("HOSTING_INSTANCE_EVIDENCE_MISSING", 409, "平台计量凭证不完整，卡时尚未扣减，请人工核验。");
  }
  const settledMicros = hostingCardHourMicrosForSeconds(current.snapshot.cardHourMicrosPerGpuHour, measuredSeconds);
  if (settledMicros > current.heldMicros) throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "实际计量超过订单锁定额度。");
  const requestedFeeBreakdown = hostingFeeBreakdown(settledMicros, current.snapshot.platformFeeBps, current.snapshot.referralRewardBps, true);
  const { platformFeeMicros, supplierIncomeMicros } = requestedFeeBreakdown;
  const requestedCommissionMicros = requestedFeeBreakdown.commissionMicros;
  const acceptancePayloadHash = await internalHash({ operation: "CLAIM_HOSTING_ACCEPTANCE", contractId: current.id, acceptanceMode, acceptanceDeadlineAt });
  const settlementPayloadHash = await internalHash({ operation: "SETTLE_HOSTING_ORDER", contractId: current.id, measuredSeconds, settledMicros, supplierIncomeMicros, requestedCommissionMicros, feeScheduleId: current.feeScheduleId });
  const settlementInput = {
    buyerOrganizationId: current.buyerOrganizationId,
    orderId: current.id,
    measuredSeconds,
    settledMicros,
    supplierOrganizationId: current.supplierOrganizationId,
    supplierIncomeMicros,
    commissionMicros: requestedCommissionMicros,
    acceptanceMode,
    acceptanceDeadlineAt,
    acceptanceActorId: mutation.actorId,
    acceptancePayloadHash,
    payloadHash: settlementPayloadHash,
    now: mutation.now,
  } as const;
  let cardSettlement;
  try {
    cardSettlement = await stores.cardHours.settleHostingOrder(settlementInput);
  } catch (error) {
    const conflict = error instanceof Error && "code" in error && error.code === "HOSTING_ACCEPTANCE_CONFLICT";
    const converged = conflict ? await stores.hosting.contractForViewer(current.buyerOrganizationId, current.id) : null;
    if (!converged || !["SETTLED", "CLEANING", "CLEANED"].includes(converged.status)) throw error;
    cardSettlement = await stores.cardHours.settleHostingOrder(settlementInput);
  }
  const appliedFeeBreakdown = hostingFeeBreakdown(settledMicros, current.snapshot.platformFeeBps, current.snapshot.referralRewardBps, Boolean(cardSettlement.referrerOrganizationId));
  const commissionMicros = appliedFeeBreakdown.commissionMicros;
  let contract = current;
  if (!replayed) {
    try {
      contract = (await stores.hosting.markContractSettled(current.id, { measuredSeconds, settledMicros, supplierIncomeMicros, commissionMicros }, mutation)).contract;
    } catch (error) {
      const converged = await stores.hosting.contractForViewer(current.buyerOrganizationId, current.id);
      if (!converged || !["CLEANING", "CLEANED"].includes(converged.status) || converged.settledMicros !== settledMicros || converged.supplierIncomeMicros !== supplierIncomeMicros || converged.commissionMicros !== commissionMicros) throw error;
      contract = converged;
    }
  }
  return {
    contract,
    settlement: {
      heldMicros: current.heldMicros,
      settledMicros,
      releasedMicros: current.heldMicros - settledMicros,
      supplierIncomeMicros,
      commissionMicros,
      platformFeeMicros,
    },
    replayed: replayed || !cardSettlement.applied,
  };
}

export async function advanceExpiredHostingAcceptance(deviceId: string, now: string, injected?: Dependencies) {
  const stores = await dependencies(injected);
  const current = await stores.hosting.expiredAcceptanceForDevice(deviceId, now);
  if (!current) return null;
  const payloadHash = await internalHash({ operation: "AUTO_ACCEPT_HOSTING_CONTRACT", contractId: current.id, stoppedAt: current.stoppedAt, acceptanceDeadlineAt: acceptanceDeadline(current) });
  const mutation = internalMutation("system:hosting-acceptance", `auto-accept:${current.id}`, payloadHash, now);
  return settleAcceptedContract(current, "TIMEOUT", mutation, stores);
}
