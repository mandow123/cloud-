import { createAlipayCheckoutUrl, AlipayLiveError } from "@/lib/server/alipay-live";
import {
  apiErrorResponse,
  beginApiRequest,
  jsonResponse,
  mutationHash,
  prepareWrite,
  requireIdempotencyKey,
} from "@/lib/server/api-guard";
import { requireExchangeRole } from "@/lib/server/exchange-auth";
import { ExchangeDomainError } from "@/lib/server/exchange-errors";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { getSupplyStore } from "@/lib/server/supply-store";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    requireExchangeRole(request, "buyer");
    const authorization = await authorizeMarketplaceRequest(request);
    actor = authorization.actor;
    prepareWrite(request, actor);
    await persistMarketplaceSession(authorization);
    const { id } = await contextValue.params;
    const store = await getSupplyStore();
    const detail = await store.getTrialOrder(actor.id, id, "buyer");
    if (detail.order.status !== "PAYMENT_PENDING") {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 409, "订单当前不能创建支付。");
    }
    if (Date.parse(detail.order.expiresAt) <= Date.now()) {
      throw new ExchangeDomainError("EXCHANGE_STATE_CONFLICT", 410, "容量锁和支付时限已经过期。");
    }

    const checkout = createAlipayCheckoutUrl({
      orderId: detail.order.id,
      amountCents: detail.order.amountCents,
      subject: `KAI Cloud 8×H100 整机独占 ${detail.order.durationHours} 小时`,
      expiresMinutes: Math.max(1, Math.min(15, Math.ceil((Date.parse(detail.order.expiresAt) - Date.now()) / 60_000))),
    });
    const idempotencyKey = requireIdempotencyKey(request);
    const payment = await store.ensureTrialPayment(detail.order.id, {
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash({ orderId: detail.order.id, provider: "ALIPAY", amountCents: detail.order.amountCents }),
    }, { provider: "ALIPAY", providerOrderRef: detail.order.id });
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(payment.replayed));
    return jsonResponse({
      record: payment.record,
      provider: checkout.provider,
      environment: checkout.environment,
      checkoutUrl: checkout.checkoutUrl,
      amountCents: checkout.amountCents,
      currency: checkout.currency,
      expiresAt: checkout.expiresAt,
      replayed: payment.replayed,
    }, payment.replayed ? 200 : 201, headers, context);
  } catch (error) {
    if (error instanceof AlipayLiveError) {
      const status = error.code === "ALIPAY_NOT_CONFIGURED" ? 503 : 400;
      return jsonResponse({ error: { code: error.code, message: error.message, requestId: context.requestId } }, status, actor?.responseHeaders, context);
    }
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
