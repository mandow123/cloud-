import { AccountAuthError } from "./account-auth.ts";
import type { CardHourStore } from "./card-hour-store.ts";

type RefundDependencies = Readonly<{
  now?: () => Date;
}>;

export async function executeApprovedTopupRefund(
  store: CardHourStore,
  refundId: string,
  actorId: string,
  dependencies: RefundDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const claim = await store.beginTopupRefund({
    refundId,
    actorId,
    now: now.toISOString(),
    staleBefore: new Date(now.getTime() - 120_000).toISOString(),
  });
  if (!claim.claimed || !claim.claimToken) return { record: claim.record, claimed: false };
  const record = await store.finishTopupRefund({
    refundId,
    claimToken: claim.claimToken,
    status: "MANUAL_REQUIRED",
    now: (dependencies.now?.() ?? new Date()).toISOString(),
  });
  return { record, claimed: true };
}

export async function decideAndExecuteTopupRefund(
  store: CardHourStore,
  refundId: string,
  actorId: string,
  input: Record<string, unknown>,
  dependencies: RefundDependencies = {},
) {
  if (input.decision !== "APPROVE" && input.decision !== "REJECT") throw new AccountAuthError("CARD_HOUR_TOPUP_REFUND_INVALID", 400, "退款审批决定无效。 ");
  const expectedVersion = Number(input.expectedVersion);
  const reason = typeof input.reason === "string" ? input.reason : "";
  const decided = await store.decideTopupRefund({
    refundId,
    decision: input.decision,
    approvedBy: actorId,
    reason,
    expectedVersion,
    now: (dependencies.now?.() ?? new Date()).toISOString(),
  });
  if (decided.status !== "APPROVED") return { record: decided, replayed: false };
  const executed = await executeApprovedTopupRefund(store, refundId, actorId, dependencies);
  return { record: executed.record, replayed: !executed.claimed };
}
