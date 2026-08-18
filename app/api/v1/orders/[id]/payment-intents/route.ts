import { cnyCentsToCardHourMicros, formatCardHourMicros } from "@/lib/card-hours";
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
import { AccountAuthError } from "@/lib/server/account-auth";
import { authorizeMarketplaceRequest, persistMarketplaceSession } from "@/lib/server/marketplace-auth";
import { getSupplyStore } from "@/lib/server/supply-store";
import { getCardHourStore } from "@/lib/server/card-hour-store";
import { requireTradingAccountSession } from "@/lib/server/entity-ownership";
import type { MarketplaceActor } from "@/lib/server/marketplace-actor";
import { requireLegacyGpuMutationSimulation } from "@/lib/server/legacy-gpu-mutation-gate";

export const dynamic = "force-dynamic";

export async function POST(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const context = beginApiRequest(request);
  let actor: MarketplaceActor | undefined;
  try {
    requireLegacyGpuMutationSimulation();
    const account = await requireTradingAccountSession(request);
    if (!account) throw new AccountAuthError("ACCOUNT_AUTH_REQUIRED", 401, "请先登录交易账户。 ");
    await requireExchangeRole(request, "buyer");
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

    const idempotencyKey = requireIdempotencyKey(request);
    const amountMicros = cnyCentsToCardHourMicros(detail.order.amountCents);
    // Bind the service order to the internal settlement rail before moving value.
    // If the wallet is short, the pending payment can safely be retried after a
    // top-up; the reverse order could debit the wallet and then fail to persist
    // the service-side payment record.
    const payment = await store.ensureTrialPayment(detail.order.id, {
      actorId: actor.id,
      idempotencyKey,
      payloadHash: await mutationHash({ orderId: detail.order.id, provider: "KAI_CARD_HOUR", amountMicros }),
    }, { provider: "KAI_CARD_HOUR", providerOrderRef: detail.order.id });
    const cardHourPayment = await (await getCardHourStore()).captureOrder({
      account,
      sourceSystem: "SUPPLY_PILOT",
      orderId: detail.order.id,
      amountMicros,
      cnyReferenceCents: detail.order.amountCents,
      idempotencyKey,
      payloadHash: await mutationHash({ orderId: detail.order.id, assetCode: "KAI_CREDIT_HOUR", amountMicros }),
      now: new Date().toISOString(),
    });
    const captured = await store.applyTrialPaymentEvent(detail.order.id, {
      actorId: actor.id,
      idempotencyKey: `${idempotencyKey}:capture`,
      payloadHash: await mutationHash({ orderId: detail.order.id, provider: "KAI_CARD_HOUR", amountMicros, eventType: "CAPTURED" }),
    }, {
      provider: "KAI_CARD_HOUR",
      providerEventRef: `capture:${detail.order.id}`,
      providerTransactionRef: `KCH_${detail.order.id}`,
      eventType: "CAPTURED",
      amountCents: detail.order.amountCents,
      payloadDigest: await mutationHash(cardHourPayment.record),
      outcome: "APPLIED",
      occurredAt: new Date().toISOString(),
      toStatus: "CAPTURED",
    });
    const replayed = payment.replayed && cardHourPayment.replayed;
    const headers = new Headers(actor.responseHeaders);
    headers.set("idempotency-replayed", String(replayed));
    return jsonResponse({
      record: captured.record.payment,
      provider: "KAI_CARD_HOUR",
      assetCode: "KAI_CREDIT_HOUR",
      amountCardHours: formatCardHourMicros(amountMicros),
      amountMicros,
      cnyReferenceCents: detail.order.amountCents,
      rate: { cardHours: "1", cny: "1.002" },
      replayed,
    }, replayed ? 200 : 201, headers, context);
  } catch (error) {
    return apiErrorResponse(error, actor?.responseHeaders, context);
  }
}
