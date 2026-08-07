import { verifyAlipayNotification } from "@/lib/server/alipay-live";
import { mutationHash } from "@/lib/server/api-guard";
import { getSupplyStore } from "@/lib/server/supply-store";

export const dynamic = "force-dynamic";

function notifyResponse(value: "success" | "failure", status = 200) {
  return new Response(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
      return notifyResponse("failure", 415);
    }
    const rawBody = await request.text();
    if (!rawBody || new TextEncoder().encode(rawBody).byteLength > 32 * 1024) return notifyResponse("failure", 413);
    const event = await verifyAlipayNotification(new URLSearchParams(rawBody), rawBody);
    const store = await getSupplyStore();
    const detail = await store.getTrialOrder("alipay-notify", event.providerOrderId, "ops");
    if (detail.order.id !== event.providerOrderId
      || detail.order.amountCents !== event.amountCents
      || detail.order.currency !== event.currency
      || detail.payment?.provider !== "ALIPAY"
      || detail.payment.providerOrderRef !== event.providerOrderId) {
      return notifyResponse("failure", 400);
    }
    const eventHash = await mutationHash(event);
    await store.applyTrialPaymentEvent(detail.order.id, {
      actorId: "alipay-notify",
      idempotencyKey: `alipay-notify:${eventHash.slice(0, 48)}`,
      payloadHash: eventHash,
    }, {
      provider: "ALIPAY",
      providerEventRef: event.providerEventId,
      providerTransactionRef: event.providerTransactionId,
      eventType: event.eventType,
      amountCents: event.amountCents,
      payloadDigest: event.rawPayloadDigest,
      outcome: "APPLIED",
      occurredAt: event.occurredAt,
      toStatus: event.eventType === "CAPTURED" ? "CAPTURED" : "CLOSED",
    });
    return notifyResponse("success");
  } catch (error) {
    console.warn(JSON.stringify({
      event: "alipay_notify_rejected",
      error: error instanceof Error ? error.name : "UnknownError",
      occurredAt: new Date().toISOString(),
    }));
    return notifyResponse("failure", 400);
  }
}
