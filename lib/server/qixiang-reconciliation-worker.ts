import { formatCardHourDisplayMicros } from "../card-hours.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { QixiangPayError, queryQixiangPayOrder, type QixiangPayEnvironment } from "./qixiang-pay.ts";
import { createDurableQixiangQueryProtection } from "./qixiang-query-protection.ts";

export async function runQixiangReconciliationBatch(store: CardHourStore, input: Readonly<{ now?: Date; fetcher?: typeof fetch; limit?: number; environment?: QixiangPayEnvironment }> = {}) {
  const startedAt = input.now ?? new Date();
  const now = startedAt.toISOString();
  const staleBefore = new Date(startedAt.getTime() - 120_000).toISOString();
  const due = await store.listDueTopupReconciliations({ now, staleBefore, limit: input.limit ?? 10 });
  const protection = createDurableQixiangQueryProtection(store);
  const summary = { scanned: due.length, claimed: 0, captured: 0, pending: 0, escalated: 0, failed: 0, expiredLots: 0, expiredMicros: 0 };
  const expiry = await store.expirePaidEntitlements({ now, limit: 200 });
  summary.expiredLots = expiry.expiredLots;
  summary.expiredMicros = expiry.expiredMicros;
  for (const item of due) {
    const claimTime = new Date();
    const claim = await store.claimTopupReconciliation({
      organizationId: item.organizationId,
      orderId: item.orderId,
      now: claimTime.toISOString(),
      staleBefore: new Date(claimTime.getTime() - 120_000).toISOString(),
      nextEligibleAt: new Date(claimTime.getTime() + 60_000).toISOString(),
    });
    if (!claim.claimed || !claim.claimToken) continue;
    summary.claimed += 1;
    try {
      const topup = await store.getTopup(item.orderId) as { id?: string; organizationId?: string; status?: string; cardHourMicros?: number; amountCents?: number; provider?: string; providerPaymentType?: "alipay" | "wxpay" } | null;
      if (!topup || topup.organizationId !== item.organizationId || topup.provider !== "QIXIANG_PAY" || !topup.id || !topup.cardHourMicros || !topup.amountCents || (topup.providerPaymentType !== "alipay" && topup.providerPaymentType !== "wxpay")) throw new Error("QIXIANG_RECONCILIATION_ORDER_INVALID");
      if (topup.status === "CAPTURED") continue;
      const event = await queryQixiangPayOrder({
        orderId: topup.id,
        amountCents: topup.amountCents,
        subject: `KAI Cloud 充值 ${formatCardHourDisplayMicros(topup.cardHourMicros)} KAI 标准卡时`,
        paymentType: topup.providerPaymentType,
        merchantParam: topup.id,
      }, input.environment, input.fetcher ?? fetch, protection);
      await store.applyTopupEvent({
        orderId: event.providerOrderId,
        provider: "QIXIANG_PAY",
        providerEventId: event.providerEventId,
        providerTransactionId: event.providerTransactionId,
        eventType: event.eventType,
        amountCents: event.amountCents,
        payloadDigest: event.rawPayloadDigest,
        occurredAt: event.occurredAt,
        receivedAt: event.verifiedAt,
      });
      summary.captured += 1;
    } catch (error) {
      const attemptCount = item.attemptCount + 1;
      const shouldEscalate = attemptCount >= 10 || Date.parse(now) >= Date.parse(item.expiresAt) || !(error instanceof QixiangPayError);
      if (shouldEscalate) {
        await store.escalateTopupReconciliation({ organizationId: item.organizationId, orderId: item.orderId, attemptCount, now: new Date().toISOString() });
        summary.escalated += 1;
      } else {
        summary.pending += 1;
      }
      if (!(error instanceof QixiangPayError && error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN")) summary.failed += 1;
    } finally {
      const completedAt = new Date();
      await store.releaseTopupReconciliation({
        organizationId: item.organizationId,
        orderId: item.orderId,
        claimToken: claim.claimToken,
        now: completedAt.toISOString(),
        nextEligibleAt: new Date(completedAt.getTime() + 60_000).toISOString(),
      });
    }
  }
  return Object.freeze(summary);
}
