import { AlipayLiveError, queryAlipayRefund, refundAlipayTrade } from "./alipay-live.ts";
import type { AdminMutationContext, AdminOperationsStore, AdminRefundCase } from "./admin-store.ts";
import { ExchangeInputError } from "./exchange-errors.ts";
import { getSupplyStore, type SupplyStore } from "./supply-store.ts";

type AlipayResult = Record<string, unknown>;
type RefundExecutorDependencies = Readonly<{
  supplyStore?: SupplyStore;
  refundTrade?: (orderId: string, refundRequestId: string, amountCents: number, reason: string) => Promise<AlipayResult>;
  queryRefund?: (orderId: string, refundRequestId: string) => Promise<AlipayResult>;
}>;

function errorDetails(error: unknown) {
  if (error instanceof AlipayLiveError) return { code: error.code, message: error.message };
  if (error && typeof error === "object" && "code" in error) {
    return { code: String(error.code).slice(0, 100), message: error instanceof Error ? error.message : String(error.code) };
  }
  return { code: "REFUND_EXECUTION_FAILED", message: error instanceof Error ? error.message : "Refund execution failed." };
}

function amountCents(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/u.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

async function providerConfirmedRefund(result: AlipayResult, orderId: string, refundRequestId: string, expectedAmountCents: number, queryRefund: NonNullable<RefundExecutorDependencies["queryRefund"]>) {
  if (result.code === "10000" && result.fund_change === "Y") return result;
  const queried = await queryRefund(orderId, refundRequestId);
  const queriedAmount = amountCents(queried.refund_amount ?? queried.refundAmount);
  if (queried.code === "10000" && queriedAmount === expectedAmountCents) return queried;
  const message = String(queried.sub_msg ?? queried.msg ?? result.sub_msg ?? result.msg ?? "Alipay did not confirm the refund.");
  throw new AlipayLiveError("ALIPAY_REQUEST_FAILED", message);
}

async function finishFailure(store: AdminOperationsStore, caseId: string, actor: AdminMutationContext, claimToken: string, error: unknown) {
  const detail = errorDetails(error);
  return (await store.finishRefundExecution(caseId, actor, { claimToken, status: "FAILED", errorCode: detail.code, errorMessage: detail.message.slice(0, 1000) })).record;
}

async function stableRefundDigest(record: AdminRefundCase, refundRequestId: string) {
  const payload = JSON.stringify({ refundCaseId: record.id, refundRequestId, orderId: record.entityId, amountCents: record.amountCents, currency: record.currency });
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)));
  return `sha256:${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export async function executeApprovedRefund(store: AdminOperationsStore, caseId: string, actor: AdminMutationContext, dependencies: RefundExecutorDependencies = {}, executionReason = "Execute independently approved refund"): Promise<{ record: AdminRefundCase; claimed: boolean }> {
  const claim = await store.beginRefundExecution(caseId, actor, executionReason);
  if (!claim.claimed || !claim.record.execution) return claim;
  const execution = claim.record.execution;
  try {
    if (claim.record.sourceSystem !== "SUPPLY_PILOT" || claim.record.entityType !== "PAYMENT") {
      throw Object.assign(new Error("This payment source has no LIVE Alipay refund adapter."), { code: "UNSUPPORTED_REFUND_PROVIDER" });
    }
    const supply = dependencies.supplyStore ?? await getSupplyStore();
    const detail = await supply.getTrialOrder(`admin-refund:${actor.principalId}`, execution.orderId, "ops");
    if (!detail.payment || detail.payment.provider !== "ALIPAY") {
      throw Object.assign(new Error("The order has no refundable Alipay capture."), { code: "PAYMENT_NOT_REFUNDABLE" });
    }
    const existingEvent = detail.paymentEvents.find((event) => event.provider === "ALIPAY" && event.providerEventRef === execution.refundRequestId);
    if (existingEvent) {
      if (existingEvent.operation !== "REFUND" || existingEvent.outcome !== "APPLIED" || existingEvent.amountCents !== claim.record.amountCents) {
        throw Object.assign(new Error("The stable refund request id is bound to a different domain event."), { code: "REFUND_EVENT_CONFLICT" });
      }
      const completed = await store.finishRefundExecution(caseId, actor, { claimToken: execution.claimToken, status: "SUCCEEDED", providerTransactionRef: existingEvent.providerTransactionRef });
      return { record: completed.record, claimed: true };
    }
    if (!["CAPTURED", "REFUND_PENDING"].includes(detail.payment.status)) {
      throw Object.assign(new Error("The order has no refundable Alipay capture."), { code: "PAYMENT_NOT_REFUNDABLE" });
    }
    const alreadyRefunded = detail.paymentEvents.filter((event) => event.operation === "REFUND" && event.outcome === "APPLIED").reduce((total, event) => total + event.amountCents, 0);
    if (claim.record.amountCents > detail.order.amountCents - alreadyRefunded) {
      throw Object.assign(new Error("The approved amount exceeds the remaining captured amount."), { code: "REFUND_AMOUNT_EXCEEDED" });
    }
    const providerResult = await providerConfirmedRefund(
      await (dependencies.refundTrade ?? refundAlipayTrade)(execution.orderId, execution.refundRequestId, claim.record.amountCents, claim.record.requestReason),
      execution.orderId,
      execution.refundRequestId,
      claim.record.amountCents,
      dependencies.queryRefund ?? queryAlipayRefund,
    );
    const resultingTotal = alreadyRefunded + claim.record.amountCents;
    const eventDigest = await stableRefundDigest(claim.record, execution.refundRequestId);
    await supply.applyTrialPaymentEvent(execution.orderId, { actorId: `admin:${actor.principalId}`, idempotencyKey: `approved-refund:${claim.record.id}`, payloadHash: eventDigest }, {
      provider: "ALIPAY",
      providerEventRef: execution.refundRequestId,
      providerTransactionRef: detail.payment.providerTransactionRef,
      eventType: resultingTotal === detail.order.amountCents ? "REFUNDED_FULL" : "REFUNDED_PARTIAL",
      amountCents: claim.record.amountCents,
      payloadDigest: eventDigest,
      outcome: "APPLIED",
      occurredAt: new Date().toISOString(),
      toStatus: "REFUNDED",
    });
    const providerTransactionRef = String(providerResult.trade_no ?? providerResult.tradeNo ?? detail.payment.providerTransactionRef ?? "");
    const completed = await store.finishRefundExecution(caseId, actor, { claimToken: execution.claimToken, status: "SUCCEEDED", providerTransactionRef: providerTransactionRef || null });
    return { record: completed.record, claimed: true };
  } catch (error) {
    return { record: await finishFailure(store, caseId, actor, execution.claimToken, error), claimed: true };
  }
}

export async function decideAndExecuteRefund(store: AdminOperationsStore, caseId: string, actor: AdminMutationContext, input: Record<string, unknown>, dependencies: RefundExecutorDependencies = {}) {
  const decision = await store.decideRefund(caseId, actor, input);
  if (decision.record.status !== "APPROVED") return decision;
  const executed = await executeApprovedRefund(store, caseId, actor, dependencies, String(input.reason ?? "Execute independently approved refund"));
  return { record: executed.record, replayed: decision.replayed && !executed.claimed };
}

export async function retryApprovedRefund(store: AdminOperationsStore, caseId: string, actor: AdminMutationContext, input: Record<string, unknown>, dependencies: RefundExecutorDependencies = {}) {
  const retryReason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (retryReason.length < 8 || retryReason.length > 1000) throw new ExchangeInputError("reason must contain 8-1000 characters.", "reason");
  const executed = await executeApprovedRefund(store, caseId, actor, dependencies, retryReason);
  return { record: executed.record, replayed: !executed.claimed };
}
