import { getCardHourStore } from "@/lib/server/card-hour-store";
import { confirmQixiangPayNotification, qixiangPayReconciliationReadiness, QixiangPayError, verifyQixiangPayNotification } from "@/lib/server/qixiang-pay";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";
import { createDurableQixiangQueryProtection } from "@/lib/server/qixiang-query-protection";

export const dynamic = "force-dynamic";

function notifyResponse(value: "success" | "failure", status = 200) {
  return new Response(value, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
}

export async function GET(request: Request) {
  try {
    if (!qixiangPayReconciliationReadiness().canReconcilePayment) return notifyResponse("failure", 503);
    const url = new URL(request.url);
    const rawQuery = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    if (!rawQuery || new TextEncoder().encode(rawQuery).byteLength > 32 * 1024) return notifyResponse("failure", rawQuery ? 413 : 400);
    const notification = await verifyQixiangPayNotification(url.searchParams, rawQuery);
    const store = await getCardHourStore();
    const topup = await store.getTopup(notification.providerOrderId) as { id?: string; organizationId?: string; status?: string; cardHourMicros?: number; amountCents?: number; provider?: string; providerMerchantRef?: string; providerPaymentType?: "alipay" | "wxpay"; providerTransactionId?: string | null } | null;
    const expectedName = topup?.cardHourMicros == null ? null : `KAI Cloud 充值 ${formatCardHourDisplayMicros(topup.cardHourMicros)} KAI 标准卡时`;
    if (!topup || !expectedName || !topup.id || !topup.amountCents || (topup.providerPaymentType !== "alipay" && topup.providerPaymentType !== "wxpay")
      || topup.id !== notification.providerOrderId || topup.provider !== "QIXIANG_PAY" || topup.amountCents !== notification.amountCents
      || topup.providerMerchantRef !== notification.merchantAccountRef || topup.providerPaymentType !== notification.paymentType
      || (notification.merchantParam !== null && notification.merchantParam !== topup.id)
      || (notification.productName !== null && notification.productName !== expectedName)) return notifyResponse("failure", 400);
    if (topup.status === "CAPTURED" && topup.providerTransactionId === notification.providerTransactionId) return notifyResponse("success");
    if (!topup.organizationId) return notifyResponse("failure", 400);
    const now = new Date();
    const claim = await store.claimTopupReconciliation({
      organizationId: topup.organizationId,
      orderId: topup.id,
      now: now.toISOString(),
      staleBefore: new Date(now.getTime() - 120_000).toISOString(),
      nextEligibleAt: new Date(now.getTime() + 30_000).toISOString(),
    });
    if (!claim.claimed || !claim.claimToken) return notifyResponse("failure", 503);
    try {
      const event = await confirmQixiangPayNotification(notification, {
        orderId: topup.id,
        amountCents: topup.amountCents,
        subject: expectedName,
        paymentType: topup.providerPaymentType,
        merchantParam: topup.id,
      }, undefined, fetch, createDurableQixiangQueryProtection(store));
      await store.applyTopupEvent({
        orderId: event.providerOrderId, provider: "QIXIANG_PAY", providerEventId: event.providerEventId,
        providerTransactionId: event.providerTransactionId, eventType: event.eventType, amountCents: event.amountCents,
        payloadDigest: event.rawPayloadDigest, occurredAt: event.occurredAt, receivedAt: event.verifiedAt,
      });
      return notifyResponse("success");
    } finally {
      const completedAt = new Date();
      await store.releaseTopupReconciliation({ organizationId: topup.organizationId, orderId: topup.id, claimToken: claim.claimToken, now: completedAt.toISOString(), nextEligibleAt: new Date(completedAt.getTime() + 30_000).toISOString() });
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "qixiang_pay_notify_rejected", error: error instanceof Error ? error.name : "UnknownError", occurredAt: new Date().toISOString() }));
    return notifyResponse("failure", error instanceof QixiangPayError && error.code === "QIXIANG_PAY_OUTCOME_UNKNOWN" ? 503 : 400);
  }
}
