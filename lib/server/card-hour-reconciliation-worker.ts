import { formatCardHourDisplayMicros } from "../card-hours.ts";
import type { CardHourStore } from "./card-hour-store.ts";
import { queryQixiangPayOrder, type QixiangPayEnvironment } from "./qixiang-pay.ts";

export function createCardHourReconciliationWorker(dependencies: {
  store: CardHourStore; now?: () => number; query?: typeof queryQixiangPayOrder; environment?: QixiangPayEnvironment;
}) {
  const now = dependencies.now ?? Date.now;
  const query = dependencies.query ?? queryQixiangPayOrder;
  let nextScanAt = 0;
  let running = false;
  return {
    async tick() {
      const started = now();
      if (running || started < nextScanAt) return { scanned: 0, claimed: 0, captured: 0, deferred: 0, skipped: true };
      running = true;
      nextScanAt = started + 60_000;
      const result = { scanned: 0, claimed: 0, captured: 0, deferred: 0, skipped: false };
      try {
        const rows = await dependencies.store.listDueTopupReconciliations({ now: new Date(started).toISOString(), staleBefore: new Date(started - 120_000).toISOString(), limit: 50 });
        result.scanned = rows.length;
        for (const row of rows) {
          // Finish in one scheduler interval; unvisited rows retain their priority.
          if (now() >= started + 50_000) break;
          const at = now();
          const lease = await dependencies.store.claimTopupReconciliation({ ...row, now: new Date(at).toISOString(), staleBefore: new Date(at - 120_000).toISOString(), nextEligibleAt: new Date(at + 30_000).toISOString() });
          if (!lease.claimed || !lease.claimToken) continue;
          result.claimed += 1;
          try {
            const topup = await dependencies.store.getTopup(row.orderId);
            const env = dependencies.environment ?? process.env;
            if (!topup || topup.organizationId !== row.organizationId || topup.provider !== "QIXIANG_PAY" || topup.providerMerchantRef !== env.KAI_QIXIANG_PAY_PID
              || (topup.providerPaymentType !== "alipay" && topup.providerPaymentType !== "wxpay") || !Number.isSafeInteger(topup.amountCents) || !Number.isSafeInteger(topup.cardHourMicros)) throw new Error("TOPUP_RECONCILIATION_SNAPSHOT_INVALID");
            const event = await query({ orderId: row.orderId, amountCents: Number(topup.amountCents), subject: `KAI Cloud 充值 ${formatCardHourDisplayMicros(Number(topup.cardHourMicros))} KAI 标准卡时`, paymentType: topup.providerPaymentType, merchantParam: row.orderId }, env);
            const applied = await dependencies.store.applyTopupEvent({ orderId: event.providerOrderId, provider: "QIXIANG_PAY", providerEventId: event.providerEventId, providerTransactionId: event.providerTransactionId, eventType: event.eventType, amountCents: event.amountCents, payloadDigest: event.rawPayloadDigest, occurredAt: event.occurredAt, receivedAt: event.verifiedAt });
            if (applied.applied) result.captured += 1;
          } catch {
            result.deferred += 1;
            if (lease.attemptCount >= 12) await dependencies.store.escalateTopupReconciliation({ ...row, now: new Date(now()).toISOString() });
          } finally {
            const completed = now();
            await dependencies.store.releaseTopupReconciliation({ ...row, claimToken: lease.claimToken, now: new Date(completed).toISOString(), nextEligibleAt: new Date(completed + 30_000).toISOString() });
          }
        }
        return result;
      } finally { running = false; }
    },
  };
}
