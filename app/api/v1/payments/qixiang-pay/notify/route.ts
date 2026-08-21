import { getCardHourStore } from "@/lib/server/card-hour-store";
import { verifyQixiangPayNotification } from "@/lib/server/qixiang-pay";
import { formatCardHourDisplayMicros } from "@/lib/card-hours";

export const dynamic = "force-dynamic";

function notifyResponse(value: "success" | "failure", status = 200) {
  return new Response(value, { status, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawQuery = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    if (!rawQuery || new TextEncoder().encode(rawQuery).byteLength > 32 * 1024) return notifyResponse("failure", rawQuery ? 413 : 400);
    const event = await verifyQixiangPayNotification(url.searchParams, rawQuery);
    const store = await getCardHourStore();
    const topup = await store.getTopup(event.providerOrderId) as { id?: string; cardHourMicros?: number; amountCents?: number; provider?: string; providerMerchantRef?: string; providerPaymentType?: string } | null;
    const expectedName = topup?.cardHourMicros == null ? null : `KAI Cloud 充值 ${formatCardHourDisplayMicros(topup.cardHourMicros)} KAI 标准卡时`;
    if (!topup || topup.id !== event.providerOrderId || topup.provider !== "QIXIANG_PAY" || topup.amountCents !== event.amountCents || topup.providerMerchantRef !== event.merchantAccountRef || topup.providerPaymentType !== event.paymentType || (event.merchantParam !== null && event.merchantParam !== topup.id) || (event.productName !== null && event.productName !== expectedName)) return notifyResponse("failure", 400);
    await store.applyTopupEvent({
      orderId: event.providerOrderId, provider: "QIXIANG_PAY", providerEventId: event.providerEventId,
      providerTransactionId: event.providerTransactionId, eventType: event.eventType, amountCents: event.amountCents,
      payloadDigest: event.rawPayloadDigest, occurredAt: event.occurredAt, receivedAt: event.verifiedAt,
    });
    return notifyResponse("success");
  } catch (error) {
    console.warn(JSON.stringify({ event: "qixiang_pay_notify_rejected", error: error instanceof Error ? error.name : "UnknownError", occurredAt: new Date().toISOString() }));
    return notifyResponse("failure", 400);
  }
}
